import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { isExecutable, opencodeCandidates, resolveBinary, resolveChromeBin, resolveOpencodeBin } from "../src/binaries.mjs";

const root = mkdtempSync(join(tmpdir(), "generator-binaries-"));
const onPath = join(root, "google-chrome");
const notExecutable = join(root, "chromium");
writeFileSync(onPath, "#!/bin/sh\nexit 0\n");
chmodSync(onPath, 0o755);
writeFileSync(notExecutable, "not a program\n");

test("a bare command name is resolved through PATH, not the working directory", () => {
  const previous = process.env.PATH;
  process.env.PATH = `${root}${delimiter}${previous}`;
  try {
    // The macOS-only regression: existsSync("google-chrome") asks about a file
    // in cwd, so every bare candidate silently lost and the first absolute
    // macOS path was returned on hosts that had no /Applications at all.
    assert.equal(resolveBinary(["google-chrome"]), onPath);
    assert.equal(isExecutable("google-chrome"), true);
  } finally {
    process.env.PATH = previous;
  }
});

test("candidates that cannot be spawned are skipped, and exhausting them yields null", () => {
  assert.equal(resolveBinary([notExecutable]), null, "a non-executable file is not a binary");
  assert.equal(resolveBinary([join(root, "absent")]), null);
  assert.equal(resolveBinary(["generator-no-such-binary-xyz"]), null);
  assert.equal(resolveBinary([null, undefined, ""]), null);
  assert.equal(isExecutable(null), false);
});

test("an explicit override wins verbatim so a typo surfaces by name", () => {
  assert.equal(resolveChromeBin("/nowhere/my-chrome"), "/nowhere/my-chrome");
  assert.equal(resolveOpencodeBin("/nowhere/my-opencode"), "/nowhere/my-opencode");
});

test("opencode is looked for in the documented install location and on PATH", () => {
  const previous = process.env.HOME;
  process.env.HOME = "/home/factory";
  try {
    assert.deepEqual(opencodeCandidates(), ["/home/factory/.opencode/bin/opencode", "opencode"]);
  } finally {
    process.env.HOME = previous;
  }
});
