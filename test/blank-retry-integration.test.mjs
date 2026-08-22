import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isExecutable, resolveChromeBin } from "../src/binaries.mjs";

const chrome = resolveChromeBin();
const root = mkdtempSync(join(tmpdir(), "generator-no-hidden-retry-"));
const fake = join(root, "fake-opencode.mjs");
const slots = {
  overall_form: "three parallel rectangular bars",
  count: "three bars",
  color_fill: "solid black bars",
  orientation: "horizontal bars stacked vertically",
  distinctive_feature: "equal length bars with even gaps",
};
const good = {
  render_status: "clear",
  vendor_slots: { noto: slots, platform: slots },
  shared_slots: slots,
  claims: [{
    claim_key: "c1", family: "visual", slot: "overall_form",
    phrase: "three parallel rectangular bars", supported_by: ["noto", "platform"],
    distinguishes_from: [], queries: ["three parallel bars", "three stacked bars"],
  }],
  notes: [],
};
const recovery = {
  picked_entity_id: "character:9776",
  reviews: [{ claim_key: "c1", verdict: "supported", reason: "matches the bar glyph" }],
};
const malformed = { render_status: "clear", claims: [] };
writeFileSync(fake, `#!/usr/bin/env node
const titleIndex=process.argv.indexOf('--title');
const title=titleIndex>=0?process.argv[titleIndex+1]:'';
const first=/-\\d+-0-/.test(title);
const recovering=process.argv.some((arg)=>arg.includes('fresh, text-only discriminative gate'));
const payload=JSON.stringify(recovering?${JSON.stringify(recovery)}:(first?${JSON.stringify(malformed)}:${JSON.stringify(good)}));
process.stdout.write(JSON.stringify({sessionID:'ses_no_hidden_retry'})+'\\n');
process.stdout.write(JSON.stringify({type:'text',part:{text:payload}})+'\\n');
process.stdout.write(JSON.stringify({type:'step_finish',part:{tokens:{input:10,output:10,reasoning:0}}})+'\\n');
`);
chmodSync(fake, 0o755);
process.env.OPENCODE_BIN = fake;
if (chrome) process.env.CHROME_BIN = chrome;
process.env.GEN_DB = join(root, "state.sqlite");
process.env.GEN_RUNS_DIR = join(root, "runs");
process.env.GEN_RENDER_DIR = join(root, "render");
process.env.GEN_RENDER_CAPTURE_TIMEOUT_MS = "20000";

const state = await import("../src/state.mjs");
const { STAGE_VERSIONS } = await import("../src/config.mjs");
const { runBlindGround } = await import("../src/stages/ground.mjs");

test("blind-ground makes one bounded repair call after a malformed generation contract", {
  skip: !isExecutable(chrome),
  timeout: 30_000,
}, async () => {
  state.replaceSelection([
    {
      key: "character:9776", target_key: "9776", kind: "character", code_point: 9776,
      hex: "2630", name: "TRIGRAM FOR HEAVEN", character: "☰", category_key: "miscellaneous-symbols",
      popularity: 1, existing_synonyms: "", general_category: "symbol", render_mode: "standalone",
      selection_rank: 1, selection_tier: 0, selection_score: 100, selection_reasons: ["test"],
    },
    {
      key: "character:11088", target_key: "11088", kind: "character", code_point: 11088,
      hex: "2B50", name: "WHITE MEDIUM STAR", character: "⭐", category_key: "miscellaneous-symbols",
      popularity: 1, existing_synonyms: "", general_category: "symbol", render_mode: "standalone",
      selection_rank: 2, selection_tier: 0, selection_score: 90, selection_reasons: ["test"],
    },
  ], STAGE_VERSIONS.select);
  state.upsertConfusionEdges([{
    left_entity_id: "character:9776", right_entity_id: "character:11088",
    reason: "test-neighbor", strength: 1, source: "failure-report", evidence: {},
  }]);
  state.beginCheckpoint({
    entityId: "character:11088", stage: "blind_ground",
    version: STAGE_VERSIONS.blind_ground, inputHash: "neighbor-fixture",
  });
  state.finishCheckpoint({
    entityId: "character:11088", stage: "blind_ground",
    version: STAGE_VERSIONS.blind_ground, status: "quarantined",
    error: "neighbor fixture is not the entity under test",
  });

  assert.equal(await runBlindGround(1), 1);
  const checkpoint = state.checkpoint("character:9776", "blind_ground", STAGE_VERSIONS.blind_ground);
  assert.equal(checkpoint.status, "passed");
  assert.equal(checkpoint.quality.model_calls, 3);
  const db = new DatabaseSync(process.env.GEN_DB, { readOnly: true });
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE stage='blind_ground'").get().n), 3);
  db.close();
  assert.equal(await runBlindGround(1), 0);
});
