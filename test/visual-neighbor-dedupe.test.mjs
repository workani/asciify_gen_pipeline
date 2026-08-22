import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "generator-visual-neighbor-dedupe-"));
process.env.GEN_DB = join(root, "state.sqlite");

const state = await import("../src/state.mjs");

const entity = ({ key, targetKey, kind, character, rank }) => ({
  key, target_key: targetKey, kind, code_point: kind === "character" ? Number(targetKey) : null,
  hex: kind === "character" ? Number(targetKey).toString(16) : targetKey,
  name: key, character, category_key: "fixture", popularity: 1, existing_synonyms: "",
  general_category: "symbol", render_mode: "standalone", selection_rank: rank,
  selection_tier: 0, selection_score: 100 - rank, selection_reasons: ["test"],
});

test("neighbor cohorts cannot contain a base glyph and its FE0F duplicate", () => {
  const entities = [
    entity({ key: "character:1", targetKey: "1", kind: "character", character: "A", rank: 1 }),
    entity({ key: "character:128433", targetKey: "128433", kind: "character", character: "🖱", rank: 2 }),
    entity({ key: "emoji_sequence:1f5b1-fe0f", targetKey: "1f5b1-fe0f", kind: "emoji_sequence", character: "🖱️", rank: 3 }),
    entity({ key: "character:2", targetKey: "2", kind: "character", character: "B", rank: 4 }),
  ];
  state.replaceSelection(entities, "selection-test");
  state.upsertConfusionEdges(entities.slice(1).map((neighbor, index) => ({
    left_entity_id: "character:1", right_entity_id: neighbor.key,
    reason: `fixture-${index}`, strength: 1 - index / 10, source: "failure-report", evidence: {},
  })));

  assert.deepEqual(
    state.neighborsFor("character:1", 10).map((row) => row.entity_id),
    ["character:128433", "character:2"],
  );
  assert.deepEqual(
    state.neighborsFor("character:128433", 10).map((row) => row.entity_id),
    ["character:1"],
    "the visually identical FE0F entity must also be excluded when the base is the target",
  );
});
