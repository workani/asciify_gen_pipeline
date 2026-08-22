import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const tmpDb = "./test/state.test.sqlite";
rmSync(tmpDb, { force: true });
rmSync(tmpDb + "-wal", { force: true });
rmSync(tmpDb + "-shm", { force: true });
process.env.GEN_DB = tmpDb;

const { upsertEntities, setStatus, nextBatch, addClaim, claimsFor, addQueries, pendingQueries, setQueryRoundtrip, addJudgment, allJudgments, totals, recordRun } = await import("../src/state.mjs");

test("priority queue: P0 seeds beat P2 popular beats P3 sweep", () => {
  const ts = Date.now();
  upsertEntities([
    { key: "sweep", kind: "character", code_point: 1, hex: "0001", name: "Sweep Char", character: "x", category_key: null, popularity: 0, priority: 3 },
    { key: "popular", kind: "character", code_point: 2, hex: "0002", name: "Popular", character: "y", category_key: null, popularity: 5000, priority: 2 },
    { key: "seed0", kind: "character", code_point: 3, hex: "0003", name: "Seed Zero", character: "z", category_key: null, popularity: 9999, priority: 0 },
    { key: "seed0b", kind: "character", code_point: 4, hex: "0004", name: "Seed Zero B", character: "w", category_key: null, popularity: 9999, priority: 0 },
  ]);
  const batch = nextBatch("ground", 10);
  const keys = batch.map((b) => b.key);
  assert.ok(keys.indexOf("seed0") < keys.indexOf("popular"), `seed before popular: ${keys}`);
  assert.ok(keys.indexOf("popular") < keys.indexOf("sweep"), `popular before sweep: ${keys}`);
});

test("stage status transitions gate nextBatch", () => {
  setStatus("ground", "seed0", "done");
  setStatus("ground", "seed0b", "running");
  const batch = nextBatch("ground", 10);
  assert.ok(!batch.some((b) => b.key === "seed0"), "done excluded");
});

test("claims round-trip through store", () => {
  const id = addClaim({ stage: "ground", entityKey: "popular", data: { visual: ["round thing"], colloquial: ["circle"], usage: ["decor"] }, votes: 2 });
  const cs = claimsFor("popular", "ground");
  assert.equal(cs.length, 1);
  assert.deepEqual(cs[0].visual, ["round thing"]);
});

test("queries + roundtrip statuses", () => {
  addQueries([{ entityKey: "seed0", query: "seed zero symbol", qclass: "identity" }]);
  const q = pendingQueries(10);
  assert.ok(q.length >= 1);
  setQueryRoundtrip(q[0].id, 3, "pass");
  assert.equal(pendingQueries(10).some((x) => x.id === q[0].id), false);
});

test("judgments store and retrieve", () => {
  addJudgment({ cluster: [{ key: "a" }, { key: "b" }], query: "q1", votes: { 0: 3, 1: 1 }, winner: "a", agreement: 0.75 });
  assert.ok(allJudgments().length >= 1);
  assert.equal(allJudgments()[0].winner, "a");
});

test("token ledger accumulates only successful runs", () => {
  const t0 = totals();
  recordRun({ stage: "t", scope: "x", model: "m", tokensIn: 100, tokensOut: 20, ok: true });
  recordRun({ stage: "t", scope: "x", model: "m", tokensIn: 999, tokensOut: 999, ok: false });
  const t1 = totals();
  assert.equal(t1.tokensIn - t0.tokensIn, 100);
  assert.equal(t1.tokensOut - t0.tokensOut, 20);
});
