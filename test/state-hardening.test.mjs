import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = mkdtempSync(join(tmpdir(), "generator-state-hardening-"));
const dbPath = join(root, "state.sqlite");
process.env.GEN_DB = dbPath;

const state = await import("../src/state.mjs");
const { STAGE_VERSIONS } = await import("../src/config.mjs");

const modifierNames = [
  "LATIN SMALL LETTER A WITH GRAVE",
  "LATIN SMALL LETTER A WITH ACUTE",
  "LATIN SMALL LETTER A WITH CIRCUMFLEX",
];
const entities = [1, 2, 3].map((value) => ({
  key: `character:${value}`,
  target_key: String(value),
  kind: "character",
  code_point: value,
  hex: value.toString(16),
  name: modifierNames[value - 1],
  character: String.fromCodePoint(64 + value),
  category_key: "test",
  popularity: 1,
  existing_synonyms: "",
  general_category: "letter",
  render_mode: "standalone",
  selection_rank: value,
  selection_tier: 0,
  selection_score: 100 - value,
  selection_reasons: ["test"],
}));

test("current pipeline reads cannot consume verified claims from an old run", () => {
  state.replaceSelection(entities, STAGE_VERSIONS.select);
  state.upsertClaimsV2([
    {
      entity_id: "character:1", family: "identity", phrase: "current alias",
      normalized_phrase: "current alias", confidence: 0.9, status: "verified",
      source_stage: "enrich", prompt_version: STAGE_VERSIONS.enrich, evidence: {},
    },
    {
      entity_id: "character:1", family: "identity", phrase: "poisoned legacy alias",
      normalized_phrase: "poisoned legacy alias", confidence: 1, status: "verified",
      source_stage: "enrich", prompt_version: "legacy.pipeline.enrich", evidence: {},
    },
  ]);
  assert.deepEqual(state.claimsV2ForEntity("character:1").map((row) => row.phrase), ["current alias"]);
  assert.deepEqual(state.allClaimsV2().map((row) => row.phrase), ["current alias"]);
  assert.equal(state.claimsV2ForEntity("character:1", { currentVersionOnly: false }).length, 2);
});

test("checkpoint summaries exclude stale pipeline versions by default", () => {
  const external = new DatabaseSync(dbPath);
  external.prepare(`
    INSERT INTO checkpoints (entity_id,stage,version,status,attempts,updated_at)
    VALUES ('character:3','blind_ground','legacy.blind','passed',1,?)
  `).run(Date.now());
  external.close();
  assert.equal(state.checkpointSummary().blind_ground, undefined);
  assert.equal(state.checkpointSummary({ currentVersionOnly: false }).blind_ground.versions["legacy.blind"].passed, 1);
});

test("neighbor retrieval deduplicates entities and excludes stale model edges", () => {
  state.upsertConfusionEdges([
    {
      left_entity_id: "character:1", right_entity_id: "character:2", reason: "first",
      strength: 0.9, source: "failure-report", evidence: {},
    },
    {
      left_entity_id: "character:1", right_entity_id: "character:2", reason: "second",
      strength: 0.8, source: "deterministic-name-cluster-v1", evidence: {},
    },
    {
      left_entity_id: "character:1", right_entity_id: "character:3", reason: "legacy hallucination",
      strength: 1, source: "2026.old.blind-ground-v1", evidence: {},
    },
  ]);
  const neighbors = state.neighborsFor("character:1", 10);
  assert.deepEqual(neighbors.map((row) => row.entity_id), ["character:2"]);
  assert.equal(neighbors[0].strength, 0.9);
});

test("same-base modifier variants supplement broad confusion edges", () => {
  assert.deepEqual(
    state.modifierNeighborsFor("character:1", 2).map((row) => row.entity_id),
    ["character:2", "character:3"],
  );
});

test("deterministic fallback neighbors cover sparse confusion graphs", () => {
  assert.deepEqual(
    state.fallbackNeighborsFor("character:1", 2).map((row) => row.entity_id),
    ["character:2", "character:3"],
  );
});

test("checkpoint fencing prevents a stale worker from finishing a stolen lease", () => {
  state.beginCheckpoint({
    entityId: "character:1", stage: "blind_ground", version: STAGE_VERSIONS.blind_ground, inputHash: "lease",
  });
  const external = new DatabaseSync(dbPath);
  external.prepare(`
    UPDATE checkpoints SET owner_id='different-owner',owner_pid=999999
    WHERE entity_id='character:1' AND stage='blind_ground' AND version=?
  `).run(STAGE_VERSIONS.blind_ground);
  external.close();
  assert.throws(() => state.finishCheckpoint({
    entityId: "character:1", stage: "blind_ground", version: STAGE_VERSIONS.blind_ground, status: "passed",
  }), /lease lost/);
});

test("owned unfinished checkpoints are explicitly released for immediate retry", () => {
  state.beginCheckpoint({
    entityId: "character:2", stage: "enrich", version: STAGE_VERSIONS.enrich, inputHash: "owned",
  });
  assert.equal(state.releaseOwnedCheckpoints({ stage: "enrich", reason: "test recovery" }), 1);
  const checkpoint = state.checkpoint("character:2", "enrich", STAGE_VERSIONS.enrich);
  assert.equal(checkpoint.status, "stale");
  assert.equal(checkpoint.error, "test recovery");
});

test("failed claim recovery can schedule the contrastive chain again", () => {
  for (const stage of ["contrast", "verify", "rewrite", "reverify"]) {
    state.beginCheckpoint({
      entityId: "character:3", stage, version: STAGE_VERSIONS[stage], inputHash: "closed-loop",
    });
    state.finishCheckpoint({
      entityId: "character:3", stage, version: STAGE_VERSIONS[stage], status: "passed",
    });
  }
  assert.equal(state.markCheckpointsStale(
    "character:3",
    ["contrast", "verify", "rewrite", "reverify"],
    "recovery miss",
  ), 4);
  for (const stage of ["contrast", "verify", "rewrite", "reverify"]) {
    assert.equal(state.checkpoint("character:3", stage, STAGE_VERSIONS[stage]).status, "stale");
  }
});
