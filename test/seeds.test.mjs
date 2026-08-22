import { test, before } from "node:test";
import assert from "node:assert/strict";

const tmpDb = "./test/seeds.test.sqlite";
process.env.GEN_DB = tmpDb;

let seeds, state, render;

before(async () => {
  seeds = await import("../src/seeds.mjs");
  state = await import("../src/state.mjs");
  render = await import("../src/render.mjs");
});

test("seeds load with priority 0 and valid codepoints", () => {
  const n = seeds.loadSeeds();
  assert.ok(n >= 60, `expected >=60 seed entities, got ${n}`);
  const rows = state.nextBatch("ground", 200).filter((r) => r.priority === 0);
  assert.ok(rows.length >= 60);
  for (const r of rows) {
    if (r.kind === "character") {
      assert.ok(Number.isFinite(r.code_point) && r.code_point > 32, `${r.key} bad cp`);
      assert.ok(r.name && r.name.length > 1, `${r.key} missing name`);
    }
  }
});

test("every thief pair references two distinct seed entities", () => {
  const keys = new Set(seeds.THIEF_PAIRS.flatMap((p) => [p.victim, p.thief]));
  for (const k of keys) {
    if (k.includes("-")) continue;
    const ent = state.entityByKey(String(parseInt(k, 16)));
    assert.ok(ent, `thief-pair entity ${k} not in store`);
  }
  for (const p of seeds.THIEF_PAIRS) {
    assert.notEqual(p.victim, p.thief, "victim==thief");
    assert.ok(p.query.length > 2, "query too short");
  }
});

test("grid html labels every index and escapes glyphs", () => {
  const items = [
    { character: "☰", name: "TRIGRAM" },
    { character: "", name: "<script>alert(1)</script>" },
    { character: "ß", name: "SHARP S" },
    { character: "✚", name: "MALTESE CROSS" },
    { character: "🍔", name: "HAMBURGER" },
  ];
  const html = render.buildGridHtml(items);
  for (let i = 0; i < items.length; i++) {
    assert.ok(html.includes(`>${i}<`), `index ${i} label missing`);
  }
  assert.ok(!html.includes("<script>alert"), "unescaped html injected!");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("□"), "empty char placeholder missing");
});
