import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "generator-blind-hardening-"));
process.env.GEN_DB = join(root, "state.sqlite");
process.env.GEN_RUNS_DIR = join(root, "runs");

const {
  assertAdaptiveBlindGeneration,
  blindGroundEntityConcurrency,
  claimContradictsFormalIdentity,
  isUsefulVisualPhrase,
} = await import("../src/stages/ground.mjs");
const { parseBlindGenerationOutput, parseBlindRecoveryOutput } = await import("../src/contracts.mjs");
const { cleanBlindAnalysis } = await import("../src/stages/enrich.mjs");

const slots = {
  overall_form: "three parallel rectangular bars",
  count: "three bars",
  color_fill: "solid black bars",
  orientation: "horizontal bars stacked vertically",
  distinctive_feature: "equal length bars with even gaps",
};

function rawGeneration(overrides = {}) {
  return {
    render_status: "clear",
    vendor_slots: { noto: slots, platform: slots },
    shared_slots: slots,
    claims: [{
      claim_key: "c1", family: "constraint", slot: "overall_form",
      phrase: "three parallel rectangular bars", supported_by: ["noto", "platform"],
      distinguishes_from: ["neighbor-1"],
      queries: ["three parallel bars", "three stacked horizontal bars"],
    }],
    notes: [],
    ...overrides,
  };
}

function parseGeneration(value = rawGeneration()) {
  return parseBlindGenerationOutput(value, {
    vendors: ["noto", "platform"],
    neighborLabels: ["neighbor-1"],
  });
}

test("adaptive contract requires both vendor supports and two queries", () => {
  assert.throws(() => parseGeneration(rawGeneration({
    claims: [{
      claim_key: "c1", family: "visual", slot: "overall_form",
      phrase: "three parallel rectangular bars", supported_by: ["noto"],
      distinguishes_from: [], queries: ["three parallel bars", "three stacked bars"],
    }],
  })), /at least one useful claim/);
  assert.throws(() => parseGeneration(rawGeneration({
    claims: [{
      claim_key: "c1", family: "visual", slot: "overall_form",
      phrase: "three parallel rectangular bars", supported_by: ["noto", "platform"],
      distinguishes_from: [], queries: ["three parallel bars"],
    }],
  })), /at least one useful claim/);
});

test("constraints must cite a real supplied confusion neighbor", () => {
  assert.throws(() => parseGeneration(rawGeneration({
    claims: [{
      claim_key: "c1", family: "constraint", slot: "distinctive_feature",
      phrase: "equal bars separated by narrow gaps", supported_by: ["noto", "platform"],
      distinguishes_from: ["neighbor-99"], queries: ["equal bars with gaps", "three evenly spaced bars"],
    }],
  })), /at least one useful claim/);
});

test("one malformed optional claim cannot discard otherwise valid two-call evidence", () => {
  const value = rawGeneration({
    vendor_slots: { noto: slots, platform: slots, shared: null },
    claims: [
      rawGeneration().claims[0],
      {
        claim_key: "c2", family: "constraint", slot: "color_fill",
        phrase: "solid black fill", supported_by: ["noto", "platform"],
        distinguishes_from: ["neighbor-1"], queries: ["solid black", "black fill"],
      },
    ],
  });
  const parsed = parseGeneration(value);
  assert.equal(parsed.claims.length, 1);
  assert.equal(parsed.claims[0].claim_key, "c1");
});

test("shared slots accidentally nested beside vendor slots are salvaged", () => {
  const value = rawGeneration();
  delete value.shared_slots;
  value.vendor_slots = { ...value.vendor_slots, shared_slots: slots };
  assert.equal(parseGeneration(value).shared_slots.overall_form.phrase, "three parallel rectangular bars");
});

test("generic counts and fill-only descriptions never become claims", () => {
  assert.equal(isUsefulVisualPhrase("count", "three"), false);
  assert.equal(isUsefulVisualPhrase("color_fill", "solid black fill"), false);
  assert.equal(isUsefulVisualPhrase("overall_form", "one hand"), false);
  assert.equal(isUsefulVisualPhrase("overall_form", "five pointed star"), true);
  assert.equal(isUsefulVisualPhrase("distinctive_feature", "small detached center dot"), true);
});

test("formal modifier contradictions are rejected deterministically", () => {
  const entity = { name: "LATIN SMALL LETTER A WITH GRAVE" };
  assert.equal(claimContradictsFormalIdentity(entity, "lowercase a with an acute accent above"), true);
  assert.equal(claimContradictsFormalIdentity(entity, "lowercase a with a grave accent above"), false);
  assert.equal(claimContradictsFormalIdentity({ name: "RIGHTWARDS ARROW" }, "arrow pointing left"), true);
});

test("adaptive structural gate requires useful coherent anchors in both vendors", () => {
  const parsed = parseGeneration();
  assert.equal(assertAdaptiveBlindGeneration(parsed), parsed);
  const broken = parseGeneration();
  broken.vendor_slots.platform = {
    overall_form: null,
    count: { phrase: "three bars" },
    color_fill: null,
    orientation: null,
    distinctive_feature: null,
  };
  assert.throws(() => assertAdaptiveBlindGeneration(broken),
    (error) => error.details?.kind === "cross_slot_incoherent");
});

test("subcomponent numbers do not trigger the former false conflict retry", () => {
  const value = rawGeneration({
    vendor_slots: {
      noto: { ...slots, overall_form: "one hand with one raised finger", count: "one hand with one extended finger" },
      platform: { ...slots, overall_form: "single fist with two folded sides", count: "one extended finger" },
    },
    shared_slots: { ...slots, overall_form: "closed fist with one raised finger" },
    claims: [{
      claim_key: "c1", family: "visual", slot: "overall_form",
      phrase: "closed fist with one raised finger", supported_by: ["noto", "platform"],
      distinguishes_from: [], queries: ["fist with raised finger", "one finger above closed fist"],
    }],
  });
  assert.doesNotThrow(() => assertAdaptiveBlindGeneration(parseGeneration(value)));
});

test("blind recovery covers every claim and only accepts supplied entities", () => {
  const parsed = parseBlindRecoveryOutput({
    picked_entity_id: "character:1",
    reviews: [{ claim_key: "c1", verdict: "supported", reason: "specific match" }],
  }, { claimKeys: ["c1"], validEntityIds: new Set(["character:1", "character:2"]) });
  assert.equal(parsed.picked_entity_id, "character:1");
  assert.throws(() => parseBlindRecoveryOutput({
    picked_entity_id: "character:3",
    reviews: [{ claim_key: "c1", verdict: "supported" }],
  }, { claimKeys: ["c1"], validEntityIds: new Set(["character:1", "character:2"]) }), /unknown entity/);
});

test("blind recovery can remove drifting query phrasings without another call", () => {
  const generated = parseGeneration();
  const parsed = parseBlindRecoveryOutput({
    picked_entity_id: "character:1",
    reviews: [{
      claim_key: "c1", verdict: "supported", reason: "claim matches",
      rejected_queries: ["three parallel bars"],
    }],
  }, {
    claims: generated.claims,
    validEntityIds: new Set(["character:1", "character:2"]),
  });
  assert.deepEqual(parsed.reviews[0].rejected_queries, ["three parallel bars"]);
});

test("enrichment receives only the adaptive cross-vendor shared slots", () => {
  const generation = parseGeneration();
  const cleaned = cleanBlindAnalysis({
    adaptive_generation: generation,
    recovery: { passed: true, picked_entity_id: "character:1" },
  });
  assert.equal(cleaned.votes.length, 2);
  assert.ok(cleaned.votes.every((vote) => vote.render_status === "clear"));
  assert.ok(cleaned.votes.every((vote) => vote.slots.overall_form.phrase === "three parallel rectangular bars"));
  assert.throws(() => cleanBlindAnalysis({ votes: [] }), /adaptive two-call output is required/);
});

test("blind grounding keeps one entity in flight per configured API worker", () => {
  assert.equal(blindGroundEntityConcurrency(1), 1);
  assert.equal(blindGroundEntityConcurrency(2), 2);
  assert.equal(blindGroundEntityConcurrency(4), 4);
  assert.equal(blindGroundEntityConcurrency(99), 4);
});
