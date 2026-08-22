import test from "node:test";
import assert from "node:assert/strict";
import {
  WorkerRegistry,
  compactScope,
  formatCount,
  formatDuration,
  progressBar,
  sanitizeStream,
  stageProgress,
} from "../src/tui-model.mjs";

test("dashboard formats long-running token and time counters compactly", () => {
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(12_400), "12k");
  assert.equal(formatCount(2_450_000), "2.5m");
  assert.equal(formatDuration(3_725_000), "1h 02m");
});

test("stage progress uses the latest checkpoint version and includes quarantine as complete", () => {
  const checkpoints = {
    verify: {
      versions: {
        "v1": { passed: 900 },
        "v2": { passed: 12, quarantined: 3, failed: 2, running: 1 },
      },
    },
  };
  const result = stageProgress(checkpoints, "verify", 100);
  assert.deepEqual(
    { passed: result.passed, quarantined: result.quarantined, failed: result.failed, running: result.running },
    { passed: 12, quarantined: 3, failed: 2, running: 1 },
  );
  assert.equal(result.complete, 15);
  assert.equal(result.processed, 18);
  assert.equal(result.percent, 15);
  assert.equal(result.processedPercent, 18);
  assert.equal(progressBar(result.percent, 10).length, 10);
});

test("processed progress stays stable while a completed checkpoint is retried", () => {
  const before = stageProgress({
    verify: { versions: { v2: { passed: 12, quarantined: 3, failed: 2 } } },
  }, "verify", 100);
  const duringRetry = stageProgress({
    verify: { versions: { v2: { passed: 12, quarantined: 2, failed: 2, running: 1 } } },
  }, "verify", 100);

  assert.equal(before.processed, 17);
  assert.equal(duringRetry.processed, 17);
  assert.equal(duringRetry.complete, before.complete - 1);
});

test("worker output stays attached to its OpenCode job instead of round-robin panes", () => {
  const registry = new WorkerRegistry(4);
  const first = registry.start({ id: "job-a", stage: "enrich", scope: { entities: ["A"] } }, 1_000);
  const second = registry.start({ id: "job-b", stage: "verify", scope: { entities: ["B"] } }, 2_000);

  registry.text({ id: "job-b", delta: "second response" });
  registry.text({ id: "job-a", delta: "first response" });
  registry.text({ id: "job-b", delta: " continues" });
  registry.done({ id: "job-a", ok: true, tokensIn: 50, tokensOut: 20 }, 3_000);

  assert.equal(first.text, "first response");
  assert.equal(first.status, "done");
  assert.equal(first.tokensIn + first.tokensOut, 70);
  assert.equal(second.text, "second response continues");
  assert.equal(second.status, "running");
});

test("worker registry retains exact non-text OpenCode API events alongside model text", () => {
  const registry = new WorkerRegistry(2);
  const slot = registry.start({ id: "api-job", stage: "blind_ground", scope: { entities: ["A", "B"] } });
  const raw = '{"type":"step_start","sessionID":"ses_123"}';

  registry.api({ id: "api-job", raw, sessionId: "ses_123" });
  registry.text({ id: "api-job", delta: '{"items":[]}' });

  assert.equal(slot.apiRaw, raw);
  assert.equal(slot.apiEvents, 2);
  assert.equal(slot.sessionId, "ses_123");
  assert.equal(slot.text, '{"items":[]}');
  assert.ok(slot.firstTokenAt);
});

test("worker slots are reused only after work finishes", () => {
  const registry = new WorkerRegistry(2);
  const a = registry.start({ id: "a", stage: "ground" });
  const b = registry.start({ id: "b", stage: "ground" });
  registry.done({ id: "a", ok: true });
  const c = registry.start({ id: "c", stage: "synth" });

  assert.equal(c.index, a.index);
  assert.notEqual(c.index, b.index);
  assert.equal(registry.byId.has("a"), false);
});

test("worker registry retains the terminal failure reason", () => {
  const registry = new WorkerRegistry(1);
  const slot = registry.start({ id: "failed-job", stage: "contrast" });
  registry.done({ id: "failed-job", ok: false, error: "startup timeout without an event" });

  assert.equal(slot.status, "failed");
  assert.equal(slot.error, "startup timeout without an event");
});

test("model stream sanitization preserves readable JSON and removes terminal controls", () => {
  assert.equal(sanitizeStream("{\"ok\":\ttrue}\u0007\r\n"), "{\"ok\":  true}\n");
  assert.equal(compactScope({ query: "right triangle arrow" }), "“right triangle arrow”");
});
