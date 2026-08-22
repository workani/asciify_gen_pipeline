import test from "node:test";
import assert from "node:assert/strict";
import { estimateCapacity } from "../src/capacity.mjs";

test("capacity fixes adaptive blind grounding at two calls per entity", () => {
  const estimate = estimateCapacity({
    entities: 10_000,
    observedCalls: 68,
    observedMinutes: 10,
    observedTokens: 200_000,
    rewriteShare: 1,
    safetyFactor: 2,
  });
  assert.equal(estimate.calls.blind_ground, 20_000);
  assert.equal(estimate.calls.contrast, 20_000);
  assert.equal(estimate.calls.verify, 20_000);
  assert.equal(estimate.calls.recover, 10_000);
  assert.equal(estimate.calls.adjudicate, 5_000);
});
