import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = mkdtempSync(join(tmpdir(), "generator-llm-test-"));
const fake = join(root, "fake-opencode.mjs");
writeFileSync(fake, `#!/usr/bin/env node
const fail = process.argv.some((arg) => arg.includes("FORCE_FAIL"));
if (fail) { process.stderr.write("intentional failure"); process.exit(7); }
const hang = process.argv.some((arg) => arg.includes("FORCE_HANG"));
if (hang) { setInterval(() => {}, 1000); }
const silent = process.argv.some((arg) => arg.includes("FORCE_SILENT"));
if (silent) { setInterval(() => {}, 1000); }
else {
process.stdout.write(JSON.stringify({sessionID:"ses_test"})+"\\n");
process.stdout.write(JSON.stringify({type:"text",part:{text:'{"ok":true}'}})+"\\n");
process.stdout.write(JSON.stringify({type:"step_finish",part:{tokens:{input:11,output:7,reasoning:2}}}));
}
`);
chmodSync(fake, 0o755);
process.env.OPENCODE_BIN = fake;
process.env.GEN_DB = join(root, "state.sqlite");
process.env.GEN_RUNS_DIR = join(root, "runs");
process.env.GEN_LLM_START_TIMEOUT_MS = "1000";
process.env.GEN_REQUEST_TIMEOUT_MS = "1250";

const { LlmJob, OpencodePool } = await import("../src/llm.mjs");

test("OpenCode pool consumes trailing NDJSON, records usage once, and rejects failed jobs", async () => {
  const pool = new OpencodePool(2);
  const job = await pool.submit(new LlmJob({
    stage: "test", scope: "tail", system: "system", user: "user", promptVersion: "v1",
  }));
  assert.deepEqual(job.json, { ok: true });
  assert.deepEqual(job.usage, { tokensIn: 11, tokensOut: 9 });
  assert.equal(job.sessionId, "ses_test");
  await assert.rejects(() => pool.submit(new LlmJob({
    stage: "test", scope: "failure", system: "system", user: "FORCE_FAIL", promptVersion: "v1",
  })), /exit=7/);
});

test("OpenCode pool kills and rejects a worker that never completes", async () => {
  const pool = new OpencodePool(1);
  const started = Date.now();
  await assert.rejects(() => pool.submit(new LlmJob({
    stage: "test", scope: "timeout", system: "system", user: "FORCE_HANG", promptVersion: "v1",
  })), /request timeout|SIGKILL|signal/i);
  assert.ok(Date.now() - started < 3_000, "timed-out worker did not settle promptly");
  assert.equal(pool.snapshot().active.length, 0);
});

test("OpenCode pool recycles a worker that emits no initial event and persists the reason", async () => {
  const pool = new OpencodePool(1);
  await assert.rejects(() => pool.submit(new LlmJob({
    stage: "test", scope: "silent", system: "system", user: "FORCE_SILENT", promptVersion: "v1",
  })), /startup timeout.*without an event/i);
  assert.equal(pool.snapshot().active.length, 0);

  const db = new DatabaseSync(join(root, "state.sqlite"));
  const row = db.prepare("SELECT ok,error FROM runs WHERE scope='silent' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.ok, 0);
  assert.match(row.error, /startup timeout.*without an event/i);
  db.close();
});
