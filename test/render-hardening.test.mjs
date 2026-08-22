import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

const root = mkdtempSync(join(tmpdir(), "generator-render-hardening-"));
process.env.GEN_RENDER_DIR = root;
process.env.CHROME_BIN = "fake-chrome";

const {
  analyzeGlyphPng,
  analyzeGridPng,
  assertDistinctVendorFingerprints,
  buildGlyphHtml,
  buildGridHtml,
  inspectSfntFont,
  renderGlyph,
  renderGlyphCandidates,
  renderGrid,
  requireRealNotoFont,
} = await import("../src/render.mjs");

const items = ["👾", "💌", "💓", "💕", "💖", "💗"].map((character, index) => ({
  entity_id: `character:${index + 1}`,
  character,
  name: `fixture ${index}`,
  hex: String(index + 1),
}));

function fixturePng(path, { glyphs = true, labels = true } = {}) {
  const width = 765;
  const height = 328;
  const png = new PNG({ width, height, colorType: 6 });
  png.data.fill(255);
  const columns = 3;
  const rows = 2;
  const padding = 8;
  const gap = 6;
  const cellWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const cellHeight = (height - padding - gap * (rows - 1)) / rows;
  const paint = (left, top, right, bottom, rgba) => {
    for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      for (let x = Math.floor(left); x < Math.ceil(right); x++) {
        const offset = (y * width + x) * 4;
        png.data.set(rgba, offset);
      }
    }
  };
  for (let index = 0; index < items.length; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = padding + column * (cellWidth + gap);
    const top = padding + row * (cellHeight + gap);
    if (labels) paint(left + 7, top + 5, left + 36, top + 34, [197, 31, 51, 255]);
    if (glyphs) paint(left + 90, top + 65, left + 110, top + 85, [25, 30, 35, 255]);
  }
  writeFileSync(path, PNG.sync.write(png));
}

function singleGlyphCapture({ htmlPath, pngPath }) {
  const html = readFileSync(htmlPath, "utf8");
  const notdef = html.includes("\u0378");
  const png = new PNG({ width: 320, height: 280, colorType: 6 });
  png.data.fill(255);
  const width = notdef ? 18 : 30;
  const height = notdef ? 42 : 30;
  for (let y = 90; y < 90 + height; y++) for (let x = 100; x < 100 + width; x++) {
    png.data.set([20, 30, 40, 255], (y * png.width + x) * 4);
  }
  writeFileSync(pngPath, PNG.sync.write(png));
}

test("render HTML is visible without a timer-dependent paint gate", () => {
  const html = buildGridHtml(items, { revealIdentity: false });
  assert.doesNotMatch(html, /render-pending/);
  assert.doesNotMatch(html, /document\.fonts/);
});

test("single-glyph HTML has no grid, label, identity, or positional cue", () => {
  const html = buildGlyphHtml(items[0], { vendor: "noto" });
  assert.doesNotMatch(html, /class="(?:grid|cell|index|identity)"/);
  assert.doesNotMatch(html, /data-index/);
  assert.match(html, /👾/);
});

test("single-glyph analysis rejects empty rasters and exact .notdef hashes", () => {
  const empty = join(root, "glyph-empty.png");
  const tofu = join(root, "glyph-tofu.png");
  const png = new PNG({ width: 320, height: 280, colorType: 6 });
  png.data.fill(255);
  writeFileSync(empty, PNG.sync.write(png));
  for (let y = 80; y < 180; y++) for (let x = 110; x < 210; x++) {
    if (x < 116 || x >= 204 || y < 86 || y >= 174) png.data.set([20, 20, 20, 255], (y * png.width + x) * 4);
  }
  writeFileSync(tofu, PNG.sync.write(png));
  assert.equal(analyzeGlyphPng(empty).empty, true);
  const analysis = analyzeGlyphPng(tofu, { notdefPath: tofu });
  assert.equal(analysis.tofu, true);
  assert.equal(analysis.valid, false);
});

test("configured Noto vendor is real and equal valid vendor pixels are allowed", () => {
  const noto = requireRealNotoFont();
  assert.ok(noto.bytes >= 1_000_000);
  assert.ok(noto.names.some((name) => /noto color emoji/i.test(name)));
  assert.deepEqual(inspectSfntFont(noto.path).fingerprint, noto.fingerprint);
  assert.equal(assertDistinctVendorFingerprints([
    { vendor: "noto", path: "noto.png", analysis: { ink_hash: "same" } },
    { vendor: "platform", path: "platform.png", analysis: { ink_hash: "same" } },
  ]).distinct, false);
  assert.equal(assertDistinctVendorFingerprints([
    { vendor: "noto", analysis: { ink_hash: "noto" } },
    { vendor: "platform", analysis: { ink_hash: "platform" } },
  ]).distinct, true);
  assert.throws(() => assertDistinctVendorFingerprints([
    { vendor: "noto", analysis: {} },
    { vendor: "platform", analysis: { ink_hash: "platform" } },
  ]), (error) => error.details?.reason === "missing_vendor_fingerprint");
});

test("pixel validation rejects a dimensionally valid blank grid", () => {
  const blank = join(root, "blank.png");
  const good = join(root, "good.png");
  fixturePng(blank, { glyphs: false });
  fixturePng(good, { glyphs: true });
  const rejected = analyzeGridPng(blank, { items });
  const accepted = analyzeGridPng(good, { items });
  assert.equal(rejected.valid, false);
  assert.deepEqual(rejected.invalid_cells, [0, 1, 2, 3, 4, 5]);
  assert.equal(accepted.valid, true);
  assert.equal(accepted.valid_cells, 6);
});

test("renderer quarantines a painted grid with zero glyph ink and retries", async () => {
  let calls = 0;
  const capture = async ({ pngPath }) => {
    calls++;
    fixturePng(pngPath, { glyphs: calls > 1, labels: true });
  };
  const path = await renderGrid(items, "blank-then-good", { attempts: 3, capture });
  assert.equal(calls, 2);
  assert.equal(analyzeGridPng(path, { items }).valid, true);
  assert.equal(existsSync(path.replace(/\.png$/, ".rejected-1.png")), true);
});

test("renderer never returns an unpainted layout after bounded retries", async () => {
  let calls = 0;
  const capture = async ({ pngPath }) => {
    calls++;
    fixturePng(pngPath, { glyphs: false, labels: false });
  };
  await assert.rejects(
    renderGrid(items, "always-blank", { attempts: 3, capture }),
    /Unable to produce a validated glyph grid after 3 attempts/,
  );
  assert.equal(calls, 3);
});

test("renderer permits one genuinely blank cell when the cohort has visible glyphs", async () => {
  const partialItems = items;
  const capture = async ({ pngPath }) => {
    fixturePng(pngPath, { glyphs: true, labels: true });
    const png = PNG.sync.read(await import("node:fs").then(({ readFileSync }) => readFileSync(pngPath)));
    // White out the first glyph region while preserving its red index label.
    for (let y = 50; y < 130; y++) for (let x = 45; x < 200; x++) {
      const offset = (y * png.width + x) * 4;
      png.data.set([255, 255, 255, 255], offset);
    }
    writeFileSync(pngPath, PNG.sync.write(png));
  };
  const path = await renderGrid(partialItems, "one-legitimate-blank", { attempts: 1, capture });
  const analysis = analyzeGridPng(path, { items: partialItems });
  assert.equal(analysis.render_viable, true);
  assert.deepEqual(analysis.invalid_cells, [0]);
});

test("content-addressed single-flight renders one glyph once across concurrent contextual tags", async () => {
  let calls = 0;
  const capture = async (options) => {
    calls++;
    singleGlyphCapture(options);
  };
  const item = { entity_id: "singleflight:1", character: "🧪", render_mode: "standalone" };
  const [first, second] = await Promise.all([
    renderGlyph(item, "context-a", { vendor: "platform", capture, cache: true }),
    renderGlyph(item, "context-b", { vendor: "platform", capture, cache: true }),
  ]);

  assert.equal(first.path, second.path);
  assert.equal(calls, 2, "one .notdef capture plus one shared glyph capture");
});

test("candidate rendering drops FE0F aliases before capture and pixel-identical pairs after capture", async () => {
  let calls = 0;
  const capture = async (options) => {
    calls++;
    singleGlyphCapture(options);
  };
  const presentationDuplicates = await renderGlyphCandidates([
    { entity_id: "character:128433", character: "🖱", render_mode: "standalone" },
    { entity_id: "emoji_sequence:1f5b1-fe0f", character: "🖱️", render_mode: "standalone" },
  ], "presentation-duplicates", { capture });
  assert.deepEqual(presentationDuplicates.candidates.map((row) => row.entity_id), ["character:128433"]);
  assert.equal(presentationDuplicates.duplicates[0].reason, "visual_identity");

  const pixelDuplicates = await renderGlyphCandidates([
    { entity_id: "fixture:x", character: "X", render_mode: "standalone" },
    { entity_id: "fixture:y", character: "Y", render_mode: "standalone" },
  ], "pixel-duplicates", { capture });
  assert.deepEqual(pixelDuplicates.candidates.map((row) => row.entity_id), ["fixture:x"]);
  assert.equal(pixelDuplicates.duplicates[0].reason, "vendor_pair_fingerprint");
  assert.ok(calls > 0);
});
