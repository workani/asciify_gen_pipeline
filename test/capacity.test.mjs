import test from "node:test";
import assert from "node:assert/strict";
import { estimateCapacity } from "../src/capacity.mjs";

test("capacity estimates the default draft plus review pipeline", () => {
  const estimate = estimateCapacity({
    entities: 10_000,
    observedCalls: 68,
    observedMinutes: 10,
    observedTokens: 200_000,
    rewriteShare: 1,
    safetyFactor: 2,
  });
  assert.deepEqual(estimate.calls, { records: 20_000 });
  assert.equal(estimate.total_calls, 20_000);
});
