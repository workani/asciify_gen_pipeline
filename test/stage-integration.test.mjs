import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isExecutable, resolveChromeBin } from "../src/binaries.mjs";

const chrome = resolveChromeBin();
const root = mkdtempSync(join(tmpdir(), "generator-stage-test-"));
const fake = join(root, "fake-opencode.mjs");
const slots = {
  overall_form: "three parallel rectangular bars",
  count: "three bars",
  color_fill: "solid black bars",
  orientation: "horizontal bars stacked vertically",
  distinctive_feature: "equal length bars with even gaps",
};
const generation = {
  render_status: "clear",
  vendor_slots: { noto: slots, platform: slots },
  shared_slots: slots,
  claims: [{
    claim_key: "c1",
    family: "constraint",
    slot: "overall_form",
    phrase: "three parallel rectangular bars",
    supported_by: ["noto", "platform"],
    distinguishes_from: ["neighbor-1"],
    queries: ["three parallel bars", "three stacked horizontal bars"],
  }],
  notes: [],
};
const recovery = {
  picked_entity_id: "character:9776",
  reviews: [{ claim_key: "c1", verdict: "supported", reason: "matches the three-bar candidate" }],
};
writeFileSync(fake, `#!/usr/bin/env node
const recovering=process.argv.some((arg)=>arg.includes('fresh, text-only discriminative gate'));
const payload=JSON.stringify(recovering?${JSON.stringify(recovery)}:${JSON.stringify(generation)});
process.stdout.write(JSON.stringify({sessionID:"ses_stage"})+"\\n");
process.stdout.write(JSON.stringify({type:"text",part:{text:payload}})+"\\n");
process.stdout.write(JSON.stringify({type:"step_finish",part:{tokens:{input:100,output:50,reasoning:10}}})+"\\n");
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

test("adaptive blind-ground uses exactly one generation and one recovery call", {
  skip: !isExecutable(chrome),
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
  assert.equal(await runBlindGround(1), 1);
  const checkpoint = state.checkpoint("character:9776", "blind_ground", STAGE_VERSIONS.blind_ground);
  assert.equal(checkpoint.status, "passed");
  assert.equal(checkpoint.quality.model_calls, 2);
  assert.equal(checkpoint.output.recovery.passed, true);
  assert.notEqual(
    checkpoint.output.renders[0].validation.ink_hash,
    checkpoint.output.renders[1].validation.ink_hash,
  );
  assert.ok(state.claimsV2ForEntity("character:9776").some((claim) => claim.phrase === "three parallel rectangular bars"));
  assert.equal(state.queriesV2ForEntity("character:9776").length, 2);
  const db = new DatabaseSync(process.env.GEN_DB, { readOnly: true });
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE stage='blind_ground'").get().n), 2);
  db.close();
});
