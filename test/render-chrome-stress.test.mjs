import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isExecutable, resolveChromeBin } from "../src/binaries.mjs";

const chrome = resolveChromeBin();
const root = mkdtempSync(join(tmpdir(), "generator-render-stress-"));
if (chrome) process.env.CHROME_BIN = chrome;
process.env.GEN_RENDER_DIR = root;

const { analyzeGridPng, renderGrid } = await import("../src/render.mjs");

test("concurrent Chrome captures never return a partially painted grid", {
  skip: !isExecutable(chrome),
  timeout: 60_000,
}, async () => {
  const items = ["👾", "💌", "💓", "💕", "💖", "💗"].map((character, index) => ({
    entity_id: `stress:${index}`,
    character,
    name: `stress ${index}`,
    hex: String(index),
  }));
  const stamp = Date.now();
  const paths = await Promise.all(
    Array.from({ length: 8 }, (_, index) => renderGrid(items, `chrome-stress-${stamp}-${index}`)),
  );
  for (const path of paths) {
    const analysis = analyzeGridPng(path, { items });
    assert.equal(analysis.valid, true, JSON.stringify(analysis));
    assert.equal(analysis.valid_cells, items.length);
  }
});
