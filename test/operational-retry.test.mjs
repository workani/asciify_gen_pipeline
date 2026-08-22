import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "generator-operational-retry-"));
process.env.GEN_DB = join(root, "state.sqlite");

const state = await import("../src/state.mjs");

const entities = [1, 2, 3, 4].map((rank) => ({
  key: `character:${rank}`,
  target_key: String(rank),
  kind: "character",
  code_point: 64 + rank,
  hex: (64 + rank).toString(16),
  name: `FIXTURE ${rank}`,
  character: String.fromCodePoint(64 + rank),
  category_key: "fixture",
  popularity: 1,
  existing_synonyms: "",
  general_category: "letter",
  render_mode: "standalone",
  selection_rank: rank,
  selection_tier: 0,
  selection_score: 100 - rank,
  selection_reasons: ["test"],
}));

test("retryable operational work is scheduled before untouched entities", () => {
  state.replaceSelection(entities, "selection-test");
  state.beginCheckpoint({ entityId: "character:4", stage: "blind_ground", version: "blind-test", inputHash: "failed" });
  state.finishCheckpoint({ entityId: "character:4", stage: "blind_ground", version: "blind-test", status: "failed" });
  state.beginCheckpoint({ entityId: "character:3", stage: "blind_ground", version: "blind-test", inputHash: "neighbor" });
  state.finishCheckpoint({
    entityId: "character:3",
    stage: "blind_ground",
    version: "blind-test",
    status: "quarantined",
    quality: { reason: "no_renderable_confusion_neighbors" },
  });

  assert.deepEqual(
    state.nextCheckpointEntities({ stage: "blind_ground", version: "blind-test", limit: 4, maxAttempts: 2 })
      .map((row) => row.entity_id),
    ["character:4", "character:3", "character:1", "character:2"],
  );
});

test("transport outages use a separate bounded retry budget", () => {
  const args = {
    entityId: "character:2", stage: "verify", version: "transport-test", inputHash: "x",
  };
  const quality = { contract_errors: [{ kind: "job", message: "startup timeout without an event" }] };

  state.beginCheckpoint(args);
  state.finishCheckpoint({
    entityId: args.entityId, stage: args.stage, version: args.version,
    status: "failed", error: "provider unavailable", quality,
  });
  let row = state.checkpoint(args.entityId, args.stage, args.version);
  assert.equal(row.attempts, 0);
  assert.equal(row.operational_failures, 1);
  assert.equal(row.quality.failure_kind, "transport");
  assert.equal(state.nextCheckpointEntities({
    stage: args.stage, version: args.version, limit: 1,
    maxAttempts: 1, maxOperationalAttempts: 2,
  })[0].entity_id, args.entityId);

  state.beginCheckpoint(args);
  state.finishCheckpoint({
    entityId: args.entityId, stage: args.stage, version: args.version,
    status: "failed", error: "provider unavailable", quality,
  });
  row = state.checkpoint(args.entityId, args.stage, args.version);
  assert.equal(row.attempts, 0);
  assert.equal(row.operational_failures, 2);
  assert.notEqual(state.nextCheckpointEntities({
    stage: args.stage, version: args.version, limit: 1,
    maxAttempts: 1, maxOperationalAttempts: 2,
  })[0]?.entity_id, args.entityId);
});
