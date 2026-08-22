import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "generator-selective-adj-"));
process.env.GEN_DB = join(root, "state.sqlite");

const state = await import("../src/state.mjs");
const { STAGE_VERSIONS } = await import("../src/config.mjs");

const entity = (key, rank) => ({
  key: `character:${key}`, target_key: String(key), kind: "character", code_point: key,
  hex: key.toString(16), name: `TEST ${key}`, character: "x", category_key: "test",
  popularity: 1, existing_synonyms: "", general_category: "symbol", render_mode: "standalone",
  selection_rank: rank, selection_tier: 0, selection_score: 10, selection_reasons: ["test"],
});

test("only the single contrastive query consumes adjudication calls", () => {
  state.replaceSelection([entity(1, 1), entity(2, 2)], STAGE_VERSIONS.select);
  state.upsertQueriesV2([
    {
      entity_id: "character:1", query: "easy identity", normalized_query: "easy identity",
      qclass: "identity", intent: "easy", confidence: 1, claim_ids: [], must_beat: [], must_not: [],
      prompt_version: STAGE_VERSIONS.synth,
    },
    {
      entity_id: "character:1", query: "contrastive identity", normalized_query: "contrastive identity",
      qclass: "constraint", intent: "hard", confidence: 1, claim_ids: [],
      must_beat: ["character:2"], must_not: [], prompt_version: STAGE_VERSIONS.synth,
    },
  ]);

  assert.equal(state.skipNonContrastiveAdjudications(), 1);
  const pending = state.pendingAdjudicationQueries(10);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].query, "contrastive identity");
  assert.equal(state.queriesV2ForEntity("character:1").find((query) => query.query === "easy identity").adjudication_status, "skipped");
});
