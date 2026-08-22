import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isExecutable, resolveChromeBin } from "../src/binaries.mjs";

const chrome = resolveChromeBin();
const root = mkdtempSync(join(tmpdir(), "generator-batched-verify-"));
const fake = join(root, "fake-opencode.mjs");
writeFileSync(fake, `#!/usr/bin/env node
const title=process.argv[process.argv.indexOf('--title')+1]??'';
const run=Number(title.match(/verify-\\d+-(\\d+)-/)?.[1]??0);
const index=Math.floor(run/2);
const payload=JSON.stringify({cases:[{case_id:'character:'+(100+index),reviews:[{
  claim_id:index+1,verdict:'supported',reason:'supported fixture claim',corrected_phrase:null,confused_entity_id:null
}]}]});
process.stdout.write(JSON.stringify({sessionID:"ses_verify_batch"})+"\\n");
process.stdout.write(JSON.stringify({type:"text",part:{text:payload}})+"\\n");
process.stdout.write(JSON.stringify({type:"step_finish",part:{tokens:{input:100,output:50,reasoning:10}}})+"\\n");
`);
chmodSync(fake, 0o755);
process.env.OPENCODE_BIN = fake;
if (chrome) process.env.CHROME_BIN = chrome;
process.env.GEN_DB = join(root, "state.sqlite");
process.env.GEN_RUNS_DIR = join(root, "runs");
process.env.GEN_RENDER_DIR = join(root, "render");

const state = await import("../src/state.mjs");
const { STAGE_VERSIONS } = await import("../src/config.mjs");
const { runVerify } = await import("../src/stages/verify.mjs");

test("verification gives every entity a fresh model context", { skip: !isExecutable(chrome) }, async () => {
  const entities = Array.from({ length: 4 }, (_, index) => ({
    key: `character:${100 + index}`, target_key: String(100 + index), kind: "character",
    code_point: 100 + index, hex: (100 + index).toString(16), name: `FIXTURE ${index}`,
    character: String.fromCodePoint(100 + index), category_key: "basic-latin", popularity: 1,
    existing_synonyms: "", general_category: "letter", render_mode: "standalone",
    selection_rank: index + 1, selection_tier: 0, selection_score: 100 - index,
    selection_reasons: ["test"],
  }));
  state.replaceSelection(entities, STAGE_VERSIONS.select);
  for (const [index, entity] of entities.entries()) {
    state.beginCheckpoint({ entityId: entity.key, stage: "enrich", version: STAGE_VERSIONS.enrich, inputHash: "fixture" });
    state.finishCheckpoint({ entityId: entity.key, stage: "enrich", version: STAGE_VERSIONS.enrich, status: "passed" });
    state.beginCheckpoint({ entityId: entity.key, stage: "contrast", version: STAGE_VERSIONS.contrast, inputHash: "fixture" });
    state.finishCheckpoint({ entityId: entity.key, stage: "contrast", version: STAGE_VERSIONS.contrast, status: "passed" });
    state.upsertClaimsV2([{
      entity_id: entity.key, family: "identity", phrase: `fixture alias ${index}`,
      normalized_phrase: `fixture alias ${index}`, confidence: 0.9, status: "proposed",
      source_stage: "enrich", prompt_version: STAGE_VERSIONS.enrich, evidence: {},
    }]);
  }

  assert.equal(await runVerify(4), 4);
  assert.equal(state.totals().calls, 8, "two fresh votes should run for each of four entities");
  for (const entity of entities) {
    assert.equal(state.checkpoint(entity.key, "verify", STAGE_VERSIONS.verify).status, "passed");
    assert.equal(state.claimsV2ForEntity(entity.key)[0].status, "verified");
  }
});
