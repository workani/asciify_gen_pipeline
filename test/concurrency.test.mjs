import test from "node:test";
import assert from "node:assert/strict";
import { collectContractVotes, runConcurrentUnits } from "../src/stages/common.mjs";

const turn = () => new Promise((resolve) => setImmediate(resolve));

test("rolling stage queue replaces a completed unit while a slower sibling is still running", async () => {
  const started = [];
  const resolvers = new Map();
  let cursor = 0;

  const resultPromise = runConcurrentUnits({
    limit: 4,
    maxInFlight: 2,
    next: () => cursor < 4 ? { id: cursor++, size: 1 } : null,
    run: ({ id }) => {
      started.push(id);
      return new Promise((resolve) => resolvers.set(id, resolve));
    },
  });

  assert.deepEqual(started, [0, 1]);
  resolvers.get(1)(1);
  await turn();
  assert.deepEqual(started, [0, 1, 2], "unit 2 should start without waiting for slow unit 0");

  resolvers.get(2)(1);
  await turn();
  assert.deepEqual(started, [0, 1, 2, 3]);

  resolvers.get(0)(1);
  resolvers.get(3)(1);
  const result = await resultPromise;
  assert.deepEqual(result, { completed: 4, scheduled: 4 });
});

test("vote collection replaces a failed call without waiting for its slow sibling", async () => {
  const launched = [];
  const resolvers = new Map();
  const resultPromise = collectContractVotes({
    desired: 2,
    retries: 1,
    stage: "test",
    makeJob: (index) => {
      launched.push(index);
      return new Promise((resolve, reject) => resolvers.set(index, { resolve, reject }));
    },
    parse: (job) => job.value,
  });

  await turn();
  assert.deepEqual(launched, [0, 1]);
  resolvers.get(0).reject(new Error("fast transport failure"));
  await turn();
  assert.deepEqual(launched, [0, 1, 2], "replacement should launch while vote 1 is still unresolved");

  resolvers.get(2).resolve({ value: "replacement" });
  await turn();
  resolvers.get(1).resolve({ value: "slow sibling" });
  const result = await resultPromise;
  assert.deepEqual(result.accepted.map((row) => row.value).sort(), ["replacement", "slow sibling"]);
  assert.equal(result.launched, 3);
});
