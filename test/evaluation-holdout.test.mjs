import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "generator-holdout-"));
process.env.GEN_DB = join(root, "state.sqlite");
process.env.GEN_RUNS_DIR = join(root, "runs");

const state = await import("../src/state.mjs");
const { STAGE_VERSIONS } = await import("../src/config.mjs");

const entities = Array.from({ length: 8 }, (_, index) => ({
  key: `character:${200 + index}`,
  target_key: String(200 + index),
  kind: "character",
  code_point: 200 + index,
  hex: (200 + index).toString(16),
  name: `HOLDOUT ${index}`,
  character: String.fromCodePoint(200 + index),
  category_key: index % 2 ? "letters" : "symbols",
  popularity: 1,
  existing_synonyms: "",
  general_category: index % 2 ? "letter" : "symbol",
  render_mode: "standalone",
  selection_rank: index + 1,
  selection_tier: index % 2,
  selection_score: 100 - index,
  selection_reasons: ["test"],
}));

test("evaluation holdout is stratified, frozen once, and persisted on queries", () => {
  state.replaceSelection(entities, STAGE_VERSIONS.select);
  const first = state.freezeEvaluationHoldout({ size: 4 });
  const second = state.freezeEvaluationHoldout({ size: 7 });
  assert.equal(first.length, 4);
  assert.deepEqual(second.map((row) => row.entity_id), first.map((row) => row.entity_id));
  assert.ok(new Set(first.map((row) => row.stratum)).size >= 2);

  const heldOut = first[0].entity_id;
  state.upsertQueriesV2([{
    entity_id: heldOut,
    query: "held out query",
    normalized_query: "held out query",
    qclass: "identity",
    intent: "fixture",
    confidence: 1,
    claim_ids: [],
    must_beat: [],
    must_not: [],
    prompt_version: STAGE_VERSIONS.synth,
  }]);
  assert.equal(state.queriesV2ForEntity(heldOut)[0].eval_split, "held_out");
});
