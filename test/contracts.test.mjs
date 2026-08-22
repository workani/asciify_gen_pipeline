import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContractError,
  parseAdjudicateOutput,
  parseAdjudicateBatchOutput,
  parseBlindOutput,
  parseBlindGlyphOutput,
  parseBlindConsensusOutput,
  parseEnrichOutput,
  parseRewriteOutput,
  parseSynthOutput,
  parseVerifyOutput,
  parseVerifyBatchOutput,
  parseRecoverOutput,
} from "../src/contracts.mjs";
import {
  BLIND_GENERATE_SYSTEM,
  BLIND_RECOVER_SYSTEM,
  CONTRAST_SYSTEM,
  blindGenerateUser,
  blindRecoverUser,
} from "../src/prompts.mjs";

test("blind prompt withholds target identity", () => {
  const user = blindGenerateUser([{ candidate_label: "target", role: "target", attachments: [] }]);
  assert.ok(!user.includes("RIGHT-POINTING TRIANGLE"));
  assert.ok(!user.includes("25B6"));
  assert.match(BLIND_GENERATE_SYSTEM, /no Unicode names or code points/i);
  const recovery = blindRecoverUser({ claims: [], candidates: [] });
  assert.match(BLIND_RECOVER_SYSTEM, /no images, Unicode names/i);
  assert.doesNotMatch(recovery, /unicode name|official name/i);
});

test("single-glyph perception requires fixed slots and discards self-confidence", () => {
  const parsed = parseBlindGlyphOutput({
    render_status: "clear",
    confidence: 0.99,
    slots: {
      overall_form: "round ring",
      count: "one outer ring",
      color_fill: "black outline",
      orientation: null,
      distinctive_feature: "small center dot",
    },
  });
  assert.equal(parsed.slots.distinctive_feature.normalized_phrase, "small center dot");
  assert.equal(Object.hasOwn(parsed, "confidence"), false);
});

test("semantic consensus preserves vote coverage and cannot cite incoherent or null slots", () => {
  const expected = new Map([
    ["noto:1", { vote: { slots: { overall_form: { phrase: "round ring" } } } }],
    ["platform:1", { vote: { slots: { overall_form: { phrase: "circular outline" } } } }],
  ]);
  const value = {
    votes: [
      { vote_id: "noto:1", coherent: true, reason: "consistent ring description" },
      { vote_id: "platform:1", coherent: true, reason: "consistent outline description" },
    ],
    clusters: [{ slot: "overall_form", vote_ids: ["noto:1", "platform:1"] }],
  };
  assert.equal(parseBlindConsensusOutput(value, expected).clusters.length, 1);
  assert.throws(() => parseBlindConsensusOutput({ ...value, votes: value.votes.slice(0, 1) }, expected), ContractError);
  assert.throws(() => parseBlindConsensusOutput({
    votes: value.votes.map((vote) => vote.vote_id === "platform:1" ? { ...vote, coherent: false } : vote),
    clusters: value.clusters,
  }, expected), ContractError);
});

test("blind recovery accepts only supplied candidates", () => {
  const ids = new Set(["character:1", "character:2"]);
  assert.equal(parseRecoverOutput({ picked_entity_id: "character:2", reason: "center dot" }, ids).picked_entity_id, "character:2");
  assert.throws(() => parseRecoverOutput({ picked_entity_id: "character:3" }, ids), ContractError);
});

test("batched verification and adjudication preserve exact per-case coverage", () => {
  const verification = parseVerifyBatchOutput({ cases: [
    { case_id: "character:1", reviews: [{ claim_id: 11, verdict: "supported", confidence: 0.9 }] },
    { case_id: "character:2", reviews: [{ claim_id: 22, verdict: "wrong", confidence: 0.9 }] },
  ] }, [
    { case_id: "character:1", claim_ids: [11] },
    { case_id: "character:2", claim_ids: [22] },
  ]);
  assert.equal(verification[1].reviews[0].verdict, "wrong");

  const adjudication = parseAdjudicateBatchOutput({ cases: [
    {
      case_id: "query:1",
      ranking: [{ entity_id: "character:1", p: 0.8 }, { entity_id: "character:2", p: 0.2 }],
      none_of_these: 0, ambiguous: false,
    },
  ] }, [{ case_id: "query:1", entity_ids: ["character:1", "character:2"] }]);
  assert.equal(adjudication[0].result.ranking[0].entity_id, "character:1");
  assert.throws(() => parseVerifyBatchOutput({ cases: [] }, [
    { case_id: "character:1", claim_ids: [11] },
  ]), ContractError);
});

test("query synthesis is bounded to six queries and one contrastive case per entity", () => {
  const queries = Array.from({ length: 14 }, (_, index) => ({
    q: `triangle query ${index}`,
    class: index < 2 ? "constraint" : "visual",
    intent: "find triangle",
    confidence: 0.8,
    claim_ids: [7],
    must_beat: index < 2 ? ["character:2"] : [],
    must_not: [],
  }));
  const parsed = parseSynthOutput({ targets: [{ entity_id: "character:1", queries }] },
    ["character:1"], new Set([7]), new Set(["character:2"]));
  assert.equal(parsed[0].queries.length, 6);
  assert.equal(parsed[0].queries.filter((query) => query.must_beat.length > 0).length, 1);
});

test("new query contract requires two to five phrasings for every verified claim", () => {
  const output = { targets: [{
    entity_id: "character:1",
    claim_queries: [7, 8].map((claimId) => ({
      claim_id: claimId,
      queries: [1, 2].map((number) => ({
        q: `claim ${claimId} phrasing ${number}`,
        class: "identity",
        intent: "find exact character",
        must_beat: [],
        must_not: [],
      })),
    })),
  }] };
  const parsed = parseSynthOutput(
    output,
    ["character:1"],
    new Map([["character:1", [7, 8]]]),
    new Set(),
  );
  assert.equal(parsed[0].queries.length, 4);
  assert.deepEqual(parsed[0].claim_queries.map((group) => group.claim_id), [7, 8]);
  assert.throws(() => parseSynthOutput({ targets: [{
    entity_id: "character:1",
    claim_queries: [{ claim_id: 7, queries: output.targets[0].claim_queries[0].queries }],
  }] }, ["character:1"], new Map([["character:1", [7, 8]]]), new Set()), ContractError);
});

test("enrichment is bounded to six high-value proposals per entity", () => {
  const claims = Array.from({ length: 12 }, (_, index) => ({
    family: "identity",
    phrase: `identity alias ${index}`,
    confidence: 0.8,
    scope: "universal",
    evidence: "established_name",
    rationale: "fixture",
  }));
  const parsed = parseEnrichOutput({ items: [{ entity_id: "character:1", claims }] }, ["character:1"]);
  assert.equal(parsed[0].claims.length, 6);
});

test("contrast accepts bounded detailed claims and rejects an empty filtered vote", () => {
  const value = { items: [{
    entity_id: "character:1",
    claims: [{
      family: "constraint",
      phrase: "a single bare bone with two knobby rounded ends and a plain shaft with no meat or flesh anywhere on it",
      scope: "universal",
      evidence: "contrastive",
      rationale: "distinguishes from meat on bone",
    }],
  }] };
  const parsed = parseEnrichOutput(value, ["character:1"], {
    claimMaxWords: 24,
    claimMaxLength: 240,
    requireClaims: true,
  });
  assert.equal(parsed[0].claims.length, 1);
  assert.match(CONTRAST_SYSTEM, /between 6 and 24 words and at most 240 characters/i);
  assert.throws(() => parseEnrichOutput(value, ["character:1"], {
    claimMaxWords: 10,
    claimMaxLength: 100,
    requireClaims: true,
  }), (error) => error instanceof ContractError && error.details?.entity_ids?.[0] === "character:1");
});

test("blind contract enforces exact grid coverage", () => {
  const parsed = parseBlindOutput({ items: [
    { i: 0, render_status: "clear", observations: [{ phrase: "filled right triangle", facets: ["shape"], confidence: 0.9 }], resembles: [], confusable_indices: [] },
    { i: 1, render_status: "clear", observations: [], resembles: [{ phrase: "play button shape", confidence: 0.7 }], confusable_indices: [{ i: 0, reason: "triangle", confidence: 0.8 }] },
  ] }, [0, 1]);
  assert.equal(parsed[0].observations[0].normalized_phrase, "filled right triangle");
  assert.throws(() => parseBlindOutput({ items: [{ i: 0, observations: [] }] }, [0, 1]), ContractError);
});

test("enrich, verify, synth, and adjudication contracts reject ungrounded structure", () => {
  const enriched = parseEnrichOutput({ items: [{
    entity_id: "character:9654",
    claims: [{ family: "usage", phrase: "video play control", confidence: 0.9, scope: "universal", evidence: "established_usage", rationale: "common UI" }],
  }] }, ["character:9654"]);
  assert.equal(enriched[0].claims.length, 1);

  const rewritten = parseRewriteOutput({ items: [{
    entity_id: "character:9654",
    claims: [{ family: "visual", phrase: "filled triangle pointing right", confidence: 0.8, scope: "universal", evidence: "visual", rationale: "fixes direction" }],
  }] }, ["character:9654"]);
  assert.equal(rewritten[0].claims[0].normalized_phrase, "filled triangle pointing right");

  const reviews = parseVerifyOutput({ reviews: [{
    claim_id: 7, verdict: "supported", confidence: 0.95, reason: "common player control", corrected_phrase: null,
  }] }, [7]);
  assert.equal(reviews[0].verdict, "supported");

  const synth = parseSynthOutput({ targets: [{
    entity_id: "character:9654",
    queries: [{ q: "play button", class: "colloquial", intent: "insert play control", confidence: 0.9, claim_ids: [7], must_beat: ["character:10148"], must_not: [] }],
  }] }, ["character:9654"], new Set([7]), new Set(["character:10148"]));
  assert.equal(synth[0].queries[0].normalized_query, "play button");

  const adjudication = parseAdjudicateOutput({
    ranking: [
      { entity_id: "character:9654", p: 0.8, reason: "everyday play glyph" },
      { entity_id: "character:10148", p: 0.15, reason: "specialist arrowhead" },
    ],
    none_of_these: 0.05,
    ambiguous: false,
    ambiguity_reason: null,
  }, ["character:9654", "character:10148"]);
  assert.equal(adjudication.ranking[0].entity_id, "character:9654");
  assert.throws(() => parseAdjudicateOutput({
    ranking: [{ entity_id: "character:9654", p: 0.2 }], none_of_these: 0,
  }, ["character:9654"]), ContractError);
});
