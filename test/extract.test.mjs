import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractJson, extractJsonMatching } from "../src/jsonextract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function textFromJsonl(file) {
  const lines = readFileSync(file, "utf8").trim().split("\n");
  let text = "";
  for (const l of lines) {
    try {
      const ev = JSON.parse(l);
      if (ev.type === "text" && ev.part?.text) text += ev.part.text;
    } catch {}
  }
  return text;
}

test("clean JSON object parses", () => {
  assert.deepEqual(extractJson('{"a":1,"b":["x","y"]}'), { a: 1, b: ["x", "y"] });
});

test("fenced json parses", () => {
  assert.deepEqual(extractJson('sure!\n```json\n{"ok":true}\n```'), { ok: true });
});

test("prose around json parses", () => {
  assert.deepEqual(extractJson('Here is the result:\n{"n":3}\nDone.'), { n: 3 });
});

test("legit nested object returns the OUTER object, not inner array", () => {
  assert.deepEqual(extractJson('{"a":1,"b":["x","y"]}'), { a: 1, b: ["x", "y"] });
  assert.deepEqual(extractJson('{"outer":{"deep":{"x":2}}}'), { outer: { deep: { x: 2 } } });
});

test("abandoned draft + restart returns the valid restart", () => {
  const tricky = '{"glyphs":[{"i":0,"visual":["closed-eye smiley fl';
  const good = '{"glyphs":[{"i":0,"visual":["solid box"]}]}';
  const j = extractJson(tricky + good);
  assert.ok(j?.glyphs, "recovers the second complete object");
  assert.equal(j.glyphs[0].visual[0], "solid box");
});

test("string containing braces does not break depth counting", () => {
  assert.deepEqual(extractJson('{"s":"a } b { c","n":2}'), { s: "a } b { c", n: 2 });
});

test("escaped quotes inside strings survive", () => {
  const j = extractJson('{"s":"he said \\"hi\\" to her","k":1}');
  assert.equal(j.s, 'he said "hi" to her');
});

test("schema-aware extraction never mistakes an inner object for the required envelope", () => {
  const malformed = '{"items":[{"i":0,"facets" ["shape"]}]}';
  assert.equal(extractJsonMatching(malformed, (value) => Array.isArray(value?.items)), null);
  assert.deepEqual(
    extractJsonMatching('{"noise":1}{"items":[]}', (value) => Array.isArray(value?.items)),
    { items: [] },
  );
});

test("captured OpenCode fixtures parse to glyphs", () => {
  const dir = join(__dirname, "fixtures");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  assert.ok(files.length > 0, "no captured runs found");
  let parsed = 0;
  for (const f of files) {
    const text = textFromJsonl(join(dir, f));
    if (!text) continue;
    const j = extractJson(text);
    if (j?.glyphs) {
      parsed++;
      assert.ok(Array.isArray(j.glyphs), `${f} glyphs not array`);
      for (const g of j.glyphs) {
        assert.ok(Number.isInteger(Number(g.i)), `${f}: glyph index invalid`);
      }
    }
  }
  assert.ok(parsed > 0, `no fixture produced glyphs (${files.length} files scanned)`);
});
