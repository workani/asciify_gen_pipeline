import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "generator-prereq-"));
process.env.GEN_DB = join(root, "state.sqlite");

const state = await import("../src/state.mjs");

const entity = {
  key: "character:9654", target_key: "9654", kind: "character", code_point: 9654,
  hex: "25b6", name: "BLACK RIGHT-POINTING TRIANGLE", character: "▶", category_key: "geometric-shapes",
  popularity: 1, existing_synonyms: "", general_category: "symbol", render_mode: "standalone",
  selection_rank: 1, selection_tier: 0, selection_score: 100, selection_reasons: ["test"],
};

test("rewrite can consume a finalized failed verification checkpoint", () => {
  state.replaceSelection([entity], "selection-test");
  state.beginCheckpoint({ entityId: entity.key, stage: "verify", version: "verify-test", inputHash: "x" });
  state.finishCheckpoint({ entityId: entity.key, stage: "verify", version: "verify-test", status: "failed" });

  assert.equal(state.nextCheckpointEntities({
    stage: "rewrite", version: "rewrite-test",
    prerequisite: { stage: "verify", version: "verify-test" },
  }).length, 0);
  assert.equal(state.nextCheckpointEntities({
    stage: "rewrite", version: "rewrite-test",
    prerequisite: { stage: "verify", version: "verify-test", statuses: ["passed", "failed"] },
  })[0].entity_id, entity.key);
});
