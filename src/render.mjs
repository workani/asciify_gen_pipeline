import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { CHROME_CANDIDATES } from "./binaries.mjs";
import { config } from "./config.mjs";
import { emit } from "./log.mjs";
import { visualEntityKey } from "./normalize.mjs";

mkdirSync(config.renderDir, { recursive: true });

// Chrome's sandbox needs an unprivileged user namespace, which root shells and
// most containers deny, and /dev/shm is commonly capped at 64MB there. Neither
// flag is applied on a normal desktop session, where the sandbox works.
const platformChromeFlags = [
  ...(process.platform === "linux" ? ["--disable-dev-shm-usage"] : []),
  ...(process.env.GEN_CHROME_NO_SANDBOX === "1" || (process.platform === "linux" && process.getuid?.() === 0)
    ? ["--no-sandbox"]
    : []),
];

function requireChromeBin() {
  if (config.chromeBin) return config.chromeBin;
  throw new Error([
    "Chrome executable not found. Set CHROME_BIN to an absolute path, for example:",
    '  macOS: CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
    "  Linux: CHROME_BIN=/usr/bin/google-chrome",
    `Searched PATH and: ${CHROME_CANDIDATES.join(", ")}`,
  ].join("\n"));
}

let activeCaptures = 0;
const captureWaiters = [];
const captureChildren = new Set();
const captureProfiles = new Set();

function terminateCaptureTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch {}
  }
}

process.once("exit", () => {
  for (const child of captureChildren) terminateCaptureTree(child);
  for (const profileDir of captureProfiles) {
    try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
});

async function acquireCaptureSlot() {
  if (activeCaptures < config.renderConcurrency) {
    activeCaptures++;
    return;
  }
  await new Promise((resolvePromise) => captureWaiters.push(resolvePromise));
  activeCaptures++;
}

function releaseCaptureSlot() {
  activeCaptures--;
  captureWaiters.shift()?.();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fontUrl(relativePath) {
  const file = resolve(config.asciifyRoot, relativePath);
  return existsSync(file) ? pathToFileURL(file).href : null;
}

let notoInspectionCache = null;

function utf16be(bytes) {
  const swapped = Buffer.allocUnsafe(bytes.length - (bytes.length % 2));
  for (let index = 0; index < swapped.length; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }
  return swapped.toString("utf16le").replace(/\0/g, "").trim();
}

/** Read enough of an sfnt name table to prove the configured file is Noto. */
export function inspectSfntFont(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 12) throw new Error(`Font file is truncated: ${path}`);
  const signature = bytes.subarray(0, 4).toString("latin1");
  const numericSignature = bytes.readUInt32BE(0);
  if (signature !== "OTTO" && numericSignature !== 0x00010000) {
    throw new Error(`Font is not a supported TTF/OTF sfnt: ${path}`);
  }
  const tableCount = bytes.readUInt16BE(4);
  let nameOffset = null;
  let nameLength = null;
  for (let index = 0; index < tableCount; index++) {
    const record = 12 + index * 16;
    if (record + 16 > bytes.length) throw new Error(`Font table directory is truncated: ${path}`);
    if (bytes.subarray(record, record + 4).toString("ascii") !== "name") continue;
    nameOffset = bytes.readUInt32BE(record + 8);
    nameLength = bytes.readUInt32BE(record + 12);
    break;
  }
  if (nameOffset === null || nameOffset + nameLength > bytes.length || nameLength < 6) {
    throw new Error(`Font has no readable name table: ${path}`);
  }
  const count = bytes.readUInt16BE(nameOffset + 2);
  const stringOffset = nameOffset + bytes.readUInt16BE(nameOffset + 4);
  const names = new Set();
  for (let index = 0; index < count; index++) {
    const record = nameOffset + 6 + index * 12;
    if (record + 12 > nameOffset + nameLength) break;
    const platformId = bytes.readUInt16BE(record);
    const nameId = bytes.readUInt16BE(record + 6);
    const length = bytes.readUInt16BE(record + 8);
    const offset = stringOffset + bytes.readUInt16BE(record + 10);
    if (![1, 4, 6].includes(nameId) || offset + length > bytes.length || length === 0) continue;
    const raw = bytes.subarray(offset, offset + length);
    const name = platformId === 0 || platformId === 3 ? utf16be(raw) : raw.toString("latin1").replace(/\0/g, "").trim();
    if (name) names.add(name);
  }
  return {
    path,
    bytes: bytes.length,
    names: [...names].sort(),
    fingerprint: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function requireRealNotoFont() {
  const path = config.notoColorEmojiFont;
  if (!path) {
    throw new Error("A full Noto Color Emoji font is required. Set GEN_NOTO_COLOR_EMOJI_FONT to Noto-COLRv1.ttf.");
  }
  const stat = statSync(path);
  const cacheKey = `${path}:${stat.size}:${stat.mtimeMs}`;
  if (notoInspectionCache?.key === cacheKey) return notoInspectionCache.value;
  const inspection = inspectSfntFont(path);
  const normalizedNames = inspection.names.map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  if (inspection.bytes < 1_000_000 || !normalizedNames.some((name) => name.includes("notocoloremoji"))) {
    throw new Error(`Configured font is not a full Noto Color Emoji font: ${path}`);
  }
  notoInspectionCache = { key: cacheKey, value: inspection };
  return inspection;
}

function fontCss() {
  const fonts = [
    ["AsciifyNotoColorEmoji", "public/fonts/unicode/generated/AsciifyColorEmojiCoverage.woff2", "woff2"],
    ["AsciifySymbols2", "public/fonts/unicode/NotoSansSymbols2-Regular.ttf", "truetype"],
    ["AsciifySymbols", "public/fonts/unicode/NotoSansSymbols-Regular.ttf", "truetype"],
    ["AsciifyUnifontUpper", "public/fonts/unicode/generated/AsciifyUnifontUpper.woff2", "woff2"],
    ["AsciifyUnifontLower", "public/fonts/unicode/generated/AsciifyUnifontLower.woff2", "woff2"],
  ];
  const localNoto = config.notoColorEmojiFont
    ? `@font-face{font-family:'AsciifyNotoColorEmojiFull';src:url('${pathToFileURL(config.notoColorEmojiFont).href}') format('truetype');font-display:block;}`
    : "";
  return [localNoto, ...fonts.map(([family, path, format]) => {
    const url = fontUrl(path);
    return url ? `@font-face{font-family:'${family}';src:url('${url}') format('${format}');font-display:swap;}` : "";
  })].join("\n");
}

export const RENDER_VENDORS = Object.freeze(["noto", "platform"]);

// Linux ships no vendor emoji font of its own. Naming the common third-party
// faces ahead of Noto keeps the platform slot a second opinion instead of a
// duplicate of the noto slot; if none are installed the pair does converge,
// which is why every render records the platform it was produced on.
const LINUX_PLATFORM_FAMILIES = [
  "'Twemoji Mozilla'",
  "'JoyPixels'",
  "'OpenMoji Color'",
  "'Noto Color Emoji'",
  "'Noto Sans Symbols 2'",
  "'Noto Sans Symbols'",
  "'Noto Sans Math'",
  "'DejaVu Sans'",
  "'Symbola'",
].join(",");

// Appended only on Linux so macOS and Windows renders stay byte-identical to
// the ones already grounded in state.sqlite.
const platformSystemFamilies = process.platform === "linux" ? `,${LINUX_PLATFORM_FAMILIES}` : "";

function vendorFontFamily(vendor) {
  if (vendor === "noto") {
    return `'AsciifyNotoColorEmojiFull','AsciifySymbols2','AsciifySymbols','AsciifyUnifontUpper','AsciifyUnifontLower'`;
  }
  if (vendor === "platform") {
    return `'Apple Color Emoji','Apple Symbols','Segoe UI Emoji','Segoe UI Symbol'${platformSystemFamilies},sans-serif,'AsciifySymbols2','AsciifySymbols','AsciifyUnifontUpper','AsciifyUnifontLower'`;
  }
  throw new Error(`Unknown render vendor: ${vendor}`);
}

function glyphOnlyMarkup(item) {
  const glyph = escapeHtml(item.character?.length ? item.character : "\u{10ffff}");
  if (item.render_mode === "combining") {
    return `<div class="single combining-single"><span>◌${glyph}</span><small>a${glyph}&nbsp;&nbsp;o${glyph}</small></div>`;
  }
  return `<div class="single">${glyph}</div>`;
}

/** A deliberately label-free page: one render, one glyph, no positional cues. */
export function buildGlyphHtml(item, { vendor = "platform" } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontCss()}
:root{color-scheme:light}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:#fff;overflow:hidden}
body{display:grid;place-items:center}.single{width:100%;height:100%;display:grid;place-items:center;padding:24px;background:#fff;color:#111;font-family:${vendorFontFamily(vendor)};font-size:156px;line-height:1;text-align:center;font-variant-emoji:emoji}
.combining-single{grid-template-rows:1fr auto;font-size:132px}.combining-single small{padding-bottom:18px;color:#555;font:42px/1 ${vendorFontFamily(vendor)}}
</style></head><body>${glyphOnlyMarkup(item)}</body></html>`;
}

function glyphMarkup(item) {
  const glyph = escapeHtml(item.character?.trim() ? item.character : "□");
  if (item.render_mode === "combining") {
    return `<div class="combining"><span class="combining-main">◌${glyph}</span><span class="combining-sample">a${glyph} o${glyph}</span></div>`;
  }
  return `<div class="glyph">${glyph}</div>`;
}

export function buildGridHtml(items, {
  revealIdentity = true,
  columns = config.gridCols,
  title = "",
} = {}) {
  const cells = items.map((item, index) => {
    const identity = revealIdentity
      ? `<div class="identity">${escapeHtml(item.name ?? "")}<br><span>${escapeHtml(item.hex ?? "")}</span></div>`
      : "";
    return `<section class="cell" data-index="${index}"><div class="index">${index}</div>${glyphMarkup(item)}${identity}</section>`;
  }).join("\n");
  const rows = Math.max(1, Math.ceil(items.length / columns));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontCss()}
:root{color-scheme:light}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#111;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:8px}
.title{height:${title ? 28 : 0}px;font-size:16px;font-weight:650;text-align:center;overflow:hidden}
.grid{display:grid;grid-template-columns:repeat(${columns},1fr);grid-template-rows:repeat(${rows},1fr);gap:6px;height:calc(100vh - ${title ? 36 : 8}px)}
.cell{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px solid #bcc2c8;border-radius:9px;background:#fff;overflow:hidden;padding:8px}
.index{position:absolute;left:7px;top:5px;min-width:29px;height:29px;padding:1px 5px;border-radius:6px;background:#c51f33;color:#fff;font:bold 20px/27px ui-monospace,SFMono-Regular,monospace;text-align:center;z-index:2}
.glyph,.combining-main{font-family:-apple-system,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"${platformSystemFamilies},"AsciifySymbols2","AsciifySymbols","AsciifyUnifontUpper","AsciifyUnifontLower",sans-serif;font-size:76px;line-height:1.05;min-height:82px;display:grid;place-items:center;text-align:center}
.combining{display:flex;flex-direction:column;align-items:center;gap:5px}.combining-main{font-size:70px}.combining-sample{font:32px/1.1 "AsciifySymbols2","AsciifySymbols",serif;color:#555;letter-spacing:12px}
.identity{height:34px;max-width:100%;font-size:10px;line-height:1.15;text-align:center;color:#30343a;overflow:hidden}.identity span{color:#747b83}
</style></head><body>${title ? `<div class="title">${escapeHtml(title)}</div>` : ""}<main class="grid">${cells}</main></body></html>`;
}

function safeTag(tag) {
  return String(tag).replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 120);
}

function plausiblePng(path, width, height, minBytes = 1_000) {
  try {
    if (statSync(path).size < minBytes) return false;
    const bytes = readFileSync(path);
    return bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(16) === width && bytes.readUInt32BE(20) === height;
  } catch {
    return false;
  }
}

function countPixels(png, left, top, right, bottom, predicate) {
  let count = 0;
  const x0 = Math.max(0, Math.floor(left));
  const y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(png.width, Math.ceil(right));
  const y1 = Math.min(png.height, Math.ceil(bottom));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * png.width + x) * 4;
      if (predicate(png.data[offset], png.data[offset + 1], png.data[offset + 2], png.data[offset + 3])) count++;
    }
  }
  return count;
}

function glyphInk(png) {
  const points = [];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4;
      const r = png.data[offset];
      const g = png.data[offset + 1];
      const b = png.data[offset + 2];
      const a = png.data[offset + 3];
      if (a > 40 && (255 - r) + (255 - g) + (255 - b) > 45) points.push({ x, y, r, g, b, a });
    }
  }
  return points;
}

function canonicalGlyphHash(png, points) {
  if (!points.length) return null;
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  const hash = createHash("sha256");
  hash.update(`${right - left + 1}x${bottom - top + 1}:`);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const offset = (y * png.width + x) * 4;
      hash.update(png.data.subarray(offset, offset + 4));
    }
  }
  return {
    hash: hash.digest("hex"),
    bounds: { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 },
  };
}

export function analyzeGlyphPng(path, {
  notdefPath = null,
  minInkPixels = config.renderMinInkPixels,
} = {}) {
  const png = PNG.sync.read(readFileSync(path));
  if (png.width < 64 || png.height < 64) throw new Error(`Rendered glyph PNG is implausibly small: ${png.width}x${png.height}`);
  const points = glyphInk(png);
  const canonical = canonicalGlyphHash(png, points);
  let notdef = null;
  if (notdefPath) {
    const referencePng = PNG.sync.read(readFileSync(notdefPath));
    const referencePoints = glyphInk(referencePng);
    notdef = canonicalGlyphHash(referencePng, referencePoints);
  }
  const empty = points.length < minInkPixels;
  const tofu = Boolean(canonical?.hash && notdef?.hash && canonical.hash === notdef.hash);
  return {
    valid: !empty && !tofu,
    empty,
    tofu,
    ink_pixels: points.length,
    ink_hash: canonical?.hash ?? null,
    notdef_hash: notdef?.hash ?? null,
    bounds: canonical?.bounds ?? null,
    width: png.width,
    height: png.height,
  };
}

export class RenderQuarantineError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "RenderQuarantineError";
    this.details = details;
  }
}

export function analyzeGridPng(path, {
  items,
  columns = config.gridCols,
  revealIdentity = false,
  title = "",
  minInkPixels = config.renderMinInkPixels,
} = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("PNG analysis requires expected grid items");
  const png = PNG.sync.read(readFileSync(path));
  if (png.width < 100 || png.height < 100) throw new Error(`Rendered PNG is implausibly small: ${png.width}x${png.height}`);
  const rows = Math.ceil(items.length / columns);
  const pagePadding = 8;
  const gap = 6;
  const gridTop = pagePadding + (title ? 28 : 0);
  const gridWidth = png.width - pagePadding * 2;
  const gridHeight = png.height - gridTop;
  const cellWidth = (gridWidth - gap * (columns - 1)) / columns;
  const cellHeight = (gridHeight - gap * (rows - 1)) / rows;
  const cells = items.map((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = pagePadding + column * (cellWidth + gap);
    const top = gridTop + row * (cellHeight + gap);
    const right = left + cellWidth;
    const bottom = top + cellHeight;
    const labelPixels = countPixels(
      png, left + 3, top + 2, left + 42, top + 40,
      (r, g, b, a) => a > 180 && r > 125 && r > g * 1.45 && r > b * 1.25,
    );
    const inkPixels = countPixels(
      png, left + 38, top + 34, right - 12, bottom - (revealIdentity ? 42 : 12),
      (r, g, b, a) => a > 100 && (255 - r) + (255 - g) + (255 - b) > 75,
    );
    return {
      index,
      entity_id: item.entity_id ?? null,
      label_pixels: labelPixels,
      glyph_ink_pixels: inkPixels,
      valid: labelPixels >= 40 && inkPixels >= minInkPixels,
    };
  });
  const invalidCells = cells.filter((cell) => !cell.valid);
  const invalidLabels = cells.filter((cell) => cell.label_pixels < 40);
  const inkCells = cells.filter((cell) => cell.glyph_ink_pixels >= minInkPixels);
  return {
    valid: invalidCells.length === 0,
    layout_valid: invalidLabels.length === 0,
    glyphs_valid: invalidCells.length === 0,
    // A few genuinely invisible or unsupported Unicode cells are legitimate.
    // An entire cohort with painted labels but zero glyph ink is the known
    // headless-Chrome failure mode and must never reach a vision model.
    render_viable: invalidLabels.length === 0 && inkCells.length > 0,
    width: png.width,
    height: png.height,
    expected_cells: items.length,
    valid_cells: cells.length - invalidCells.length,
    invalid_cells: invalidCells.map((cell) => cell.index),
    cells,
  };
}

export async function captureWithChrome({ chromeBin, htmlPath, pngPath, width, height, timeoutMs, minPngBytes = 1_000 }) {
  await acquireCaptureSlot();
  const profileDir = mkdtempSync(join(tmpdir(), "asciify-render-"));
  captureProfiles.add(profileDir);
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let timer = null;
      let poller = null;
      let lastSize = -1;
      let stablePngPolls = 0;
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (poller) clearInterval(poller);
        if (error) rejectPromise(error);
        else resolvePromise();
      };
      const child = spawn(chromeBin, [
        "--headless=new",
        ...platformChromeFlags,
        "--disable-gpu",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        "--force-color-profile=srgb",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-features=PaintHolding",
        "--run-all-compositor-stages-before-draw",
        `--user-data-dir=${profileDir}`,
        `--screenshot=${pngPath}`,
        `--window-size=${width},${height}`,
        pathToFileURL(htmlPath).href,
      ], {
        stdio: ["ignore", "ignore", "pipe"],
        // Chrome fans out helper processes. Owning a process group lets timeout
        // and parent-exit cleanup terminate the entire capture, not just its root.
        detached: process.platform !== "win32",
      });
      captureChildren.add(child);
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
      child.once("error", (error) => {
        captureChildren.delete(child);
        finish(error);
      });
      child.once("close", (code) => {
        captureChildren.delete(child);
        if (code !== 0 && !plausiblePng(pngPath, width, height, minPngBytes)) finish(new Error(`Chrome exited ${code}: ${stderr.slice(-500)}`));
        else if (!plausiblePng(pngPath, width, height, minPngBytes)) finish(new Error("Chrome produced an invalid screenshot"));
        else finish();
      });
      // Chrome can finish --screenshot without exiting. A valid PNG observed
      // at the same size twice is the completion signal that matters.
      poller = setInterval(() => {
        if (!plausiblePng(pngPath, width, height, minPngBytes)) {
          stablePngPolls = 0;
          lastSize = -1;
          return;
        }
        const size = statSync(pngPath).size;
        stablePngPolls = size === lastSize ? stablePngPolls + 1 : 1;
        lastSize = size;
        if (stablePngPolls >= 2) {
          terminateCaptureTree(child);
          finish();
        }
      }, 50);
      timer = setTimeout(() => {
        terminateCaptureTree(child);
        finish(new Error(`Chrome rendering timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  } finally {
    try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
    captureProfiles.delete(profileDir);
    releaseCaptureSlot();
  }
}

const glyphWidth = 320;
const glyphHeight = 280;
const notdefPromises = new Map();
const glyphRenderPromises = new Map();
const GLYPH_RENDER_CACHE_REVISION = "single-glyph-content-v1";

function vendorRenderRevision(vendor) {
  const identity = vendor === "noto"
    ? requireRealNotoFont().fingerprint
    : `${process.platform}:${vendorFontFamily(vendor)}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 12);
}

function glyphRenderCacheTag(item, vendor) {
  const digest = createHash("sha256").update(JSON.stringify({
    revision: GLYPH_RENDER_CACHE_REVISION,
    character: String(item?.character ?? ""),
    render_mode: item?.render_mode ?? "standalone",
    vendor,
    vendor_revision: vendorRenderRevision(vendor),
    width: glyphWidth,
    height: glyphHeight,
  })).digest("hex").slice(0, 24);
  return `cache-${digest}`;
}

async function acquireRenderFileLock(lockPath, {
  timeoutMs = Math.max(60_000, config.renderCaptureTimeoutMs * config.renderAttempts + 30_000),
} = {}) {
  const started = Date.now();
  while (true) {
    try {
      const descriptor = openSync(lockPath, "wx");
      return () => {
        try { closeSync(descriptor); } catch {}
        try { unlinkSync(lockPath); } catch {}
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > timeoutMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {}
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`Timed out waiting for shared glyph render lock: ${lockPath}`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
}

async function captureGlyphPng(item, tag, vendor, {
  capture = captureWithChrome,
  force = false,
} = {}) {
  const cleanTag = safeTag(tag);
  const htmlPath = join(config.renderDir, `glyph-${cleanTag}-${vendor}.html`);
  const pngPath = join(config.renderDir, `glyph-${cleanTag}-${vendor}.png`);
  if (!force && plausiblePng(pngPath, glyphWidth, glyphHeight, 100)) return pngPath;
  writeFileSync(htmlPath, buildGlyphHtml(item, { vendor }));
  try {
    try { unlinkSync(pngPath); } catch {}
    await capture({
      chromeBin: config.chromeBin,
      htmlPath,
      pngPath,
      width: glyphWidth,
      height: glyphHeight,
      timeoutMs: config.renderCaptureTimeoutMs,
      minPngBytes: 100,
    });
    if (!plausiblePng(pngPath, glyphWidth, glyphHeight, 100)) throw new Error("Chrome produced an invalid single-glyph screenshot");
    return pngPath;
  } finally {
    try { unlinkSync(htmlPath); } catch {}
  }
}

async function notdefFor(vendor, renderMode, capture) {
  const revision = vendorRenderRevision(vendor);
  const key = `${vendor}:${renderMode}:${revision}`;
  const tag = `notdef-${safeTag(renderMode)}-${revision}`;
  const expectedPath = join(config.renderDir, `glyph-${tag}-${vendor}.png`);
  if (plausiblePng(expectedPath, glyphWidth, glyphHeight, 100)) return expectedPath;
  if (!notdefPromises.has(key)) {
    const promise = (async () => {
      const release = await acquireRenderFileLock(`${expectedPath}.lock`);
      try {
        if (plausiblePng(expectedPath, glyphWidth, glyphHeight, 100)) return expectedPath;
        return await captureGlyphPng({ character: "\u0378", render_mode: renderMode }, tag, vendor, { capture });
      } finally {
        release();
      }
    })()
      .finally(() => notdefPromises.delete(key));
    notdefPromises.set(key, promise);
  }
  return notdefPromises.get(key);
}

/**
 * Render exactly one glyph in exactly one vendor stack. The screenshot is
 * deterministically rejected before any model job when it is empty or hashes
 * to that stack's .notdef rendering.
 */
async function renderGlyphOnce(item, tag, {
  vendor = "platform",
  attempts = config.renderAttempts,
  capture = captureWithChrome,
} = {}) {
  if (!item || typeof item !== "object") throw new Error("renderGlyph requires one entity");
  if (!RENDER_VENDORS.includes(vendor)) throw new Error(`Unknown render vendor: ${vendor}`);
  if (vendor === "noto") requireRealNotoFont();
  if (capture === captureWithChrome) requireChromeBin();
  const notdefPath = await notdefFor(vendor, item.render_mode ?? "standalone", capture);
  const cleanTag = safeTag(`${tag}-${vendorRenderRevision(vendor)}`);
  const pngPath = join(config.renderDir, `glyph-${cleanTag}-${vendor}.png`);
  if (plausiblePng(pngPath, glyphWidth, glyphHeight, 100)) {
    const cached = analyzeGlyphPng(pngPath, { notdefPath });
    if (cached.valid) {
      emit("render_cache_hit", { tag: cleanTag, vendor, platform: process.platform, png: pngPath, validation: cached });
      return { path: pngPath, vendor, platform: process.platform, analysis: cached, notdef_path: notdefPath };
    }
    emit("render_cache_rejected", { tag: cleanTag, vendor, png: pngPath, validation: cached });
  }

  let lastAnalysis = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await captureGlyphPng(item, cleanTag, vendor, { capture, force: true });
      lastAnalysis = analyzeGlyphPng(pngPath, { notdefPath });
      if (!lastAnalysis.valid) {
        throw new RenderQuarantineError(
          lastAnalysis.empty ? "single-glyph render contains no perceptible mark" : "single-glyph render matches the font .notdef box",
          { vendor, ...lastAnalysis },
        );
      }
      emit("render", { tag: cleanTag, vendor, platform: process.platform, png: pngPath, attempt, validation: lastAnalysis });
      return { path: pngPath, vendor, platform: process.platform, analysis: lastAnalysis, notdef_path: notdefPath };
    } catch (error) {
      lastError = error;
      const rejectedPath = pngPath.replace(/\.png$/, `.rejected-${attempt}.png`);
      try { unlinkSync(rejectedPath); } catch {}
      try { renameSync(pngPath, rejectedPath); } catch {}
      emit("render_retry", {
        tag: cleanTag, vendor, attempt, attempts, error: error.message,
        validation: error.details ?? lastAnalysis, rejected_png: existsSync(rejectedPath) ? rejectedPath : null,
      });
    }
  }
  throw new RenderQuarantineError(
    `Glyph quarantined after ${attempts} validated ${vendor} render attempts: ${lastError?.message ?? "unknown error"}`,
    { vendor, analysis: lastError?.details ?? lastAnalysis },
  );
}

export async function renderGlyph(item, tag, options = {}) {
  const vendor = options.vendor ?? "platform";
  if (!item || typeof item !== "object") throw new Error("renderGlyph requires one entity");
  if (!RENDER_VENDORS.includes(vendor)) throw new Error(`Unknown render vendor: ${vendor}`);
  const capture = options.capture ?? captureWithChrome;
  const cache = options.cache ?? capture === captureWithChrome;
  const { cache: _cache, ...renderOptions } = options;
  if (!cache) return renderGlyphOnce(item, tag, renderOptions);

  const canonicalTag = glyphRenderCacheTag(item, vendor);
  const flightKey = `${config.renderDir}:${canonicalTag}:${vendor}`;
  const existing = glyphRenderPromises.get(flightKey);
  if (existing) {
    emit("render_singleflight_hit", {
      requested_tag: safeTag(tag), cache_tag: canonicalTag, vendor,
      entity_id: item.entity_id ?? null,
    });
    return existing;
  }
  const cleanTag = safeTag(`${canonicalTag}-${vendorRenderRevision(vendor)}`);
  const expectedPath = join(config.renderDir, `glyph-${cleanTag}-${vendor}.png`);
  const promise = (async () => {
    const release = await acquireRenderFileLock(`${expectedPath}.lock`);
    try {
      return await renderGlyphOnce(item, canonicalTag, { ...renderOptions, vendor, capture });
    } finally {
      release();
    }
  })()
    .finally(() => glyphRenderPromises.delete(flightKey));
  glyphRenderPromises.set(flightKey, promise);
  return promise;
}

export async function renderVendorPair(item, tag, options = {}) {
  requireRealNotoFont();
  const renders = await Promise.all(RENDER_VENDORS.map((vendor) => renderGlyph(item, tag, { ...options, vendor })));
  const fingerprintAgreement = assertDistinctVendorFingerprints(renders);
  if (!fingerprintAgreement.distinct) {
    emit("render_vendor_fingerprint_match", {
      tag,
      entity_id: item.entity_id ?? null,
      platform: process.platform,
      fingerprints: fingerprintAgreement.fingerprints,
    });
  }
  return {
    images: renders.map((render) => render.path),
    renders,
    vendors: [...RENDER_VENDORS],
    platform: process.platform,
    fingerprints_distinct: fingerprintAgreement.distinct,
  };
}

export function vendorPairFingerprint(pair) {
  if (!pair?.renders?.length) return null;
  const rows = pair.renders
    .map((render) => [render?.vendor, render?.analysis?.ink_hash])
    .filter(([, hash]) => Boolean(hash))
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  return rows.length === pair.renders.length
    ? rows.map(([vendor, hash]) => `${vendor}:${hash}`).join("|")
    : null;
}

export function assertDistinctVendorFingerprints(renders) {
  const fingerprints = renders.map((render) => render?.analysis?.ink_hash).filter(Boolean);
  if (fingerprints.length !== renders.length) {
    throw new RenderQuarantineError("Vendor render is missing a validated pixel fingerprint", {
      reason: "missing_vendor_fingerprint",
      renders: renders.map((render) => ({ vendor: render?.vendor, hash: render?.analysis?.ink_hash ?? null })),
    });
  }
  // Equal pixels are expected for many simple Unicode symbols. Independence is
  // established by validating each stack against its own .notdef render, not
  // by requiring the resulting glyph shapes to differ.
  return {
    distinct: new Set(fingerprints).size === fingerprints.length,
    fingerprints,
  };
}

export async function renderGlyphCandidates(items, tag, options = {}) {
  const candidates = [];
  const duplicates = [];
  const visualKeys = new Map();
  const fingerprints = new Map();
  for (const [index, item] of items.entries()) {
    const visualKey = visualEntityKey(item);
    if (visualKey && visualKeys.has(visualKey)) {
      const duplicate = {
        entity_id: item.entity_id,
        kept_entity_id: visualKeys.get(visualKey),
        reason: "visual_identity",
      };
      duplicates.push(duplicate);
      emit("render_candidate_duplicate", { tag, ...duplicate });
      continue;
    }
    const pair = await renderVendorPair(item, `${tag}-candidate-${index}`, options);
    const fingerprint = vendorPairFingerprint(pair);
    if (fingerprint && fingerprints.has(fingerprint)) {
      const keptEntityId = fingerprints.get(fingerprint);
      const duplicate = {
        entity_id: item.entity_id,
        kept_entity_id: keptEntityId,
        reason: "vendor_pair_fingerprint",
      };
      duplicates.push(duplicate);
      if (visualKey) visualKeys.set(visualKey, keptEntityId);
      emit("render_candidate_duplicate", { tag, ...duplicate });
      continue;
    }
    candidates.push({ entity_id: item.entity_id, ...pair });
    if (visualKey) visualKeys.set(visualKey, item.entity_id);
    if (fingerprint) fingerprints.set(fingerprint, item.entity_id);
  }
  return {
    candidates,
    images: candidates.flatMap((candidate) => candidate.images),
    duplicates,
  };
}

export async function renderGrid(items, tag, {
  revealIdentity = false,
  columns = config.gridCols,
  title = "",
  attempts = config.renderAttempts,
  capture = captureWithChrome,
} = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Cannot render an empty grid");
  if (capture === captureWithChrome) requireChromeBin();
  const cleanTag = safeTag(tag);
  const rows = Math.ceil(items.length / columns);
  const width = Math.max(640, columns * 255);
  const height = Math.max(260, rows * (revealIdentity ? 178 : 156) + (title ? 38 : 16));
  const htmlPath = join(config.renderDir, `grid-${cleanTag}.html`);
  const pngPath = join(config.renderDir, `grid-${cleanTag}.png`);
  if (plausiblePng(pngPath, width, height)) {
    try {
      const analysis = analyzeGridPng(pngPath, { items, columns, revealIdentity, title });
      if (analysis.render_viable) {
        emit("render_cache_hit", { tag: cleanTag, png: pngPath, items: items.length, revealIdentity, validation: analysis });
        return pngPath;
      }
      emit("render_cache_rejected", { tag: cleanTag, png: pngPath, validation: analysis });
    } catch (error) {
      emit("render_cache_rejected", { tag: cleanTag, png: pngPath, error: error.message });
    }
  }
  writeFileSync(htmlPath, buildGridHtml(items, { revealIdentity, columns, title }));
  try {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try { unlinkSync(pngPath); } catch {}
      try {
        await capture({
          chromeBin: config.chromeBin,
          htmlPath,
          pngPath,
          width,
          height,
          timeoutMs: config.renderCaptureTimeoutMs,
          attempt,
        });
        const analysis = analyzeGridPng(pngPath, { items, columns, revealIdentity, title });
        if (!analysis.render_viable) {
          throw new Error(analysis.layout_valid
            ? "render validation found a painted grid with zero glyph ink"
            : "render validation found an unpainted grid layout");
        }
        if (!analysis.glyphs_valid) emit("render_warning", {
          tag: cleanTag,
          warning: "Some cells contain little glyph ink; the perception stage must classify them as ambiguous or missing.",
          invalid_indices: analysis.invalid_cells,
        });
        emit("render", { tag: cleanTag, png: pngPath, items: items.length, revealIdentity, attempt, validation: analysis });
        return pngPath;
      } catch (error) {
        lastError = error;
        let rejectedPath = null;
        if (existsSync(pngPath)) {
          rejectedPath = pngPath.replace(/\.png$/, `.rejected-${attempt}.png`);
          try { unlinkSync(rejectedPath); } catch {}
          try { renameSync(pngPath, rejectedPath); } catch {}
        }
        emit("render_retry", { tag: cleanTag, attempt, attempts, error: error.message, rejected_png: rejectedPath });
      }
    }
    throw new Error(`Unable to produce a validated glyph grid after ${attempts} attempts: ${lastError?.message ?? "unknown error"}`);
  } finally {
    try { unlinkSync(htmlPath); } catch {}
  }
}

export async function renderCluster(items, tag) {
  return renderGrid(items, tag, {
    revealIdentity: true,
    columns: Math.min(4, Math.max(2, Math.ceil(Math.sqrt(items.length)))),
    title: "Candidate glyphs — labels are randomized",
  });
}
