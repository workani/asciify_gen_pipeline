import { test } from "node:test";
import assert from "node:assert/strict";
import { collectContractVotes } from "../src/stages/common.mjs";

test("contract collection retries only malformed votes until the required count is reached", async () => {
  const fixtures = [
    { runDbId: 1, json: { wrong: [] } },
    { runDbId: 2, json: { items: ["first"] } },
    { runDbId: 3, json: { items: ["replacement"] } },
  ];
  let cursor = 0;
  const result = await collectContractVotes({
    desired: 2,
    retries: 2,
    stage: "test",
    makeJob: () => Promise.resolve(fixtures[cursor++]),
    parse: (job) => {
      if (!Array.isArray(job.json?.items)) throw new Error("items missing");
      return job.json.items;
    },
  });
  assert.equal(result.launched, 3);
  assert.equal(result.accepted.length, 2);
  assert.deepEqual(result.accepted.map((entry) => entry.job.runDbId), [2, 3]);
  assert.equal(result.errors.length, 1);
});
