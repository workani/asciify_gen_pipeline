import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

function glyphPng({ width, height }) {
  const png = new PNG({ width: 320, height: 280, colorType: 6 });
  png.data.fill(255);
  for (let y = 90; y < 90 + height; y++) for (let x = 100; x < 100 + width; x++) {
    png.data.set([20, 30, 40, 255], (y * png.width + x) * 4);
  }
  return PNG.sync.write(png).toString("base64");
}

function run(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`render worker exited ${code}: ${stderr}`)));
  });
}

test("content-addressed file lock prevents duplicate rendering across processes", { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "generator-render-process-lock-"));
  const renderDir = join(root, "render");
  const counter = join(root, "captures.log");
  const fakeChrome = join(root, "fake-chrome.mjs");
  const worker = join(root, "worker.mjs");
  mkdirSync(renderDir);
  writeFileSync(fakeChrome, `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const screenshot = process.argv.find((value) => value.startsWith("--screenshot="))?.slice(13);
const htmlUrl = process.argv.find((value) => value.startsWith("file:"));
const html = readFileSync(fileURLToPath(htmlUrl), "utf8");
appendFileSync(${JSON.stringify(counter)}, "capture\\n");
const bytes = html.includes("\\u0378")
  ? ${JSON.stringify(glyphPng({ width: 18, height: 42 }))}
  : ${JSON.stringify(glyphPng({ width: 30, height: 30 }))};
writeFileSync(screenshot, Buffer.from(bytes, "base64"));
`);
  chmodSync(fakeChrome, 0o755);
  const renderModule = fileURLToPath(new URL("../src/render.mjs", import.meta.url));
  writeFileSync(worker, `
import { renderGlyph } from ${JSON.stringify(`file://${renderModule}`)};
const result = await renderGlyph(
  { entity_id: "shared:1", character: "🧪", render_mode: "standalone" },
  "process-context",
  { vendor: "platform" },
);
process.stdout.write(result.path);
`);

  const env = {
    ...process.env,
    CHROME_BIN: fakeChrome,
    GEN_RENDER_DIR: renderDir,
    GEN_RENDER_CAPTURE_TIMEOUT_MS: "5000",
  };
  const paths = await Promise.all([run(worker, env), run(worker, env)]);
  assert.equal(paths[0], paths[1]);
  assert.equal(readFileSync(counter, "utf8").trim().split("\n").length, 2,
    "one shared .notdef capture plus one shared glyph capture");
});
