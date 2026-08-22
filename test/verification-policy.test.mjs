import test from "node:test";
import assert from "node:assert/strict";
import { decideVerification } from "../src/stages/verify.mjs";

const claim = { confidence: 0.99 };
const review = (verdict, confidence = 0.99) => ({ verdict, confidence });

test("verification ignores self-confidence and requires a clean deterministic majority", () => {
  const accepted = decideVerification(claim, [
    review("supported", 0.1), review("supported", 0.2), review("supported", 0.3),
  ], 3);
  assert.equal(accepted.status, "verified");
  assert.equal(accepted.confidence, 1);

  const contradicted = decideVerification(claim, [
    review("supported"), review("supported"), review("wrong"),
  ], 3);
  assert.equal(contradicted.status, "contested");
  assert.equal(contradicted.confidence, 2 / 3);

  const rejected = decideVerification(claim, [
    review("wrong"), review("too_broad"), review("supported"),
  ], 3);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.confidence, 2 / 3);
});

test("platform-specific acceptance stays distinct from universal evidence", () => {
  const result = decideVerification(claim, [
    review("supported"), review("platform_specific"), review("platform_specific"),
  ], 3);
  assert.equal(result.status, "platform_specific");
  assert.equal(result.confidence, 1);
});
