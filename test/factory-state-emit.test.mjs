import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = mkdtempSync(join(tmpdir(), "generator-factory-test-"));
process.env.GEN_DB = join(root, "factory.sqlite");
process.env.GEN_OUT_DIR = join(root, "out");

const state = await import("../src/state.mjs");
const { STAGE_VERSIONS } = await import("../src/config.mjs");
const { emitArtifacts, publishGateFailures } = await import("../src/emit.mjs");

const entities = [
  {
    key: "character:167", target_key: "167", kind: "character", code_point: 167,
    hex: "00a7", name: "SECTION SIGN", character: "§", category_key: "latin-1-supplement",
    popularity: 10, existing_synonyms: "section", general_category: "punctuation", render_mode: "standalone",
    selection_rank: 1, selection_tier: 0, selection_score: 1000, selection_reasons: ["failure"],
  },
  {
    key: "character:169", target_key: "169", kind: "character", code_point: 169,
    hex: "00a9", name: "COPYRIGHT SIGN", character: "©", category_key: "latin-1-supplement",
    popularity: 9, existing_synonyms: "copyright", general_category: "symbol", render_mode: "standalone",
    selection_rank: 2, selection_tier: 0, selection_score: 900, selection_reasons: ["competitor"],
  },
];

test("versioned checkpoints and artifact emission are resumable, quoted, and Asciify-compatible", () => {
  state.replaceSelection(entities, STAGE_VERSIONS.select);
  state.beginCheckpoint({
    entityId: "character:167", stage: "blind_ground", version: STAGE_VERSIONS.blind_ground, inputHash: "abc",
  });
  state.finishCheckpoint({
    entityId: "character:167", stage: "blind_ground", version: STAGE_VERSIONS.blind_ground,
    status: "passed", output: { ok: true }, quality: { aliases: 1 }, runIds: [1],
  });
  const checkpoint = state.checkpoint("character:167", "blind_ground", STAGE_VERSIONS.blind_ground);
  assert.equal(checkpoint.status, "passed");
  assert.deepEqual(checkpoint.output, { ok: true });

  state.upsertClaimsV2([{
    entity_id: "character:167", family: "usage", phrase: "lawyer's section mark",
    normalized_phrase: "lawyer s section mark", confidence: 0.95, status: "verified",
    source_stage: "enrich", prompt_version: STAGE_VERSIONS.enrich,
    evidence: { reason: "legal references" },
  }]);
  const claim = state.claimsV2ForEntity("character:167")[0];
  state.upsertQueriesV2([{
    entity_id: "character:167", query: "lawyers section symbol", normalized_query: "lawyers section symbol",
    qclass: "usage", intent: "legal citation", confidence: 0.9, claim_ids: [claim.id],
    must_beat: ["character:169"], must_not: ["character:169"], prompt_version: STAGE_VERSIONS.synth,
  }]);
  const query = state.queriesV2ForEntity("character:167")[0];
  state.setQueryRoundtripV2(query.id, 1, "pass");
  state.upsertConfusionEdges([{
    left_entity_id: "character:167", right_entity_id: "character:169", reason: "legal marks",
    strength: 0.9, source: "test", evidence: {},
  }]);

  const artifactDir = emitArtifacts({ allowPartial: true });
  const manifest = JSON.parse(readFileSync(join(artifactDir, "manifest.json"), "utf8"));
  assert.equal(manifest.counts.entities, 2);
  assert.equal(manifest.counts.verified_claims, 1);
  assert.equal(manifest.counts.search_terms, 1);
  assert.equal(manifest.quality.publish_gate.passed, false);
  assert.ok(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));

  const termSql = readFileSync(join(artifactDir, "unicode_search_terms.sql"), "utf8");
  const synonymSql = readFileSync(join(artifactDir, "synonyms_backfill.sql"), "utf8");
  assert.match(termSql, /lawyer''s section mark/);
  assert.match(synonymSql, /lawyer''s section mark/);

  const target = new DatabaseSync(join(root, "asciify-target.sqlite"));
  target.exec(`
    CREATE TABLE unicode_search_terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,target_kind TEXT,target_key TEXT,term TEXT,
      normalized_term TEXT,weight REAL,source TEXT,locale TEXT,notes TEXT,
      created_at INTEGER DEFAULT (unixepoch()),updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(locale,normalized_term,target_kind,target_key,source)
    );
    CREATE TABLE characters (code_point INTEGER PRIMARY KEY,synonyms TEXT);
    INSERT INTO characters VALUES (167,'section');
  `);
  target.exec(termSql);
  target.exec(synonymSql);
  assert.equal(target.prepare("SELECT term FROM unicode_search_terms").get().term, "lawyer's section mark");
  assert.match(target.prepare("SELECT synonyms FROM characters WHERE code_point=167").get().synonyms, /lawyer's section mark/);
  target.close();

  assert.deepEqual(publishGateFailures({
    selection: { total: 25_000 },
    aliases: { coverage_rate: 0.96, per_entity: { p50: 4 } },
    queries: {
      entity_coverage_rate: 0.92,
      augmented_top5_rate: 0.95,
      by_baseline_status: { pass: 100 },
      contrastive: 50,
      contrastive_adjudication_rate: 0.94,
    },
    checkpoints: {},
  }), []);
});
