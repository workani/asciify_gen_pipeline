import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draft, discovery, factualReview, vocabularyReview, renders } from "./record-fixtures.mjs";
const dir = mkdtempSync(join(tmpdir(), "record-stage-v3-"));
process.env.GEN_DB = join(dir, "state.sqlite");
process.env.GEN_RUNS_DIR = join(dir, "runs");
process.env.GEN_OUT_DIR = join(dir, "out");
process.env.GEN_ASCIIFY_ROOT = dir;
const state = await import("../src/state.mjs");
const { STAGE_VERSIONS } = await import("../src/config.mjs");
const { processRecord } = await import("../src/stages/records.mjs");
const { emitRecordArtifacts } = await import("../src/emit-records.mjs");
let cp = 10163;
function select(target = {}) {
  const n = target.cp ?? cp++;
  state.replaceSelection([{ key: `character:${n}`, entity_id: `character:${n}`, kind: "character", target_key: String(n), code_point: n,
    hex: n.toString(16), name: target.name ?? "WHITE-FEATHERED RIGHTWARDS ARROW", character: String.fromCodePoint(n), category_key: "arrows", popularity: 0,
    existing_synonyms: "feathered arrow; SECRET_BASELINE", general_category: "symbol", render_mode: "standalone",
    selection_rank: 1, selection_tier: 0, selection_score: 1, selection_reasons: [] }], STAGE_VERSIONS.select);
  return state.selectedEntity(`character:${n}`);
}
const render = async () => ({ renders, images: renders.map((r) => r.path) });
const saved = (entity) => state.checkpoint(entity.entity_id, "records", STAGE_VERSIONS.records);
function provider(entity, { failAt = null, rejectFacts = false, empty = false, rejectPhrases = false } = {}) {
  const calls = [];
  return { calls, submit: async (job) => {
    let input = JSON.parse(job.user); input = input.original_task ?? input;
    calls.push(input.task);
    assert.ok(!Object.hasOwn(input, "collection_catalog"));
    assert.ok(!Object.hasOwn(input.taxonomy, "collection_ids"));
    if (input.task !== "vocabulary_review") assert.doesNotMatch(job.user, /SECRET_BASELINE/);
    if (input.task === failAt) {
      const error = new Error(`startup timeout in ${failAt}`); error.job = { runDbId: null }; throw error;
    }
    let json;
    if (input.task === "facts") {
      json = draft(entity);
      json.properties[1].attachments = job.images.map((_, i) => i + 1);
    } else if (input.task === "fact_review") {
      assert.ok(saved(entity).output.draft, "draft persisted before review");
      json = factualReview(input.record, input.review_paths);
      if (rejectFacts) json.checks[0].verdict = "wrong";
    } else if (input.task === "discovery") {
      assert.equal(saved(entity).output.fact_review.accepted, true, "facts verified before discovery");
      json = discovery(input.reviewed_facts);
      if (empty) json.candidates = [];
    } else {
      assert.ok(saved(entity).output.discovery, "discovery persisted before assessment");
      assert.match(job.user, /SECRET_BASELINE/);
      json = vocabularyReview(input.discovery, input.baseline);
      if (rejectPhrases) {
        json.groups = [];
        json.checks.forEach((row) => { row.relevance = "unsupported"; row.group_id = null; });
      }
    }
    return { json, text: "" };
  } };
}

test("four phases preserve baseline, separate discovery and export validated lexical variants and grouped intent candidates", async () => {
  const entity = select(), fake = provider(entity);
  await processRecord(entity, { render, submit: fake.submit });
  assert.deepEqual(fake.calls, ["facts", "fact_review", "discovery", "vocabulary_review"]);
  assert.equal(saved(entity).status, "passed");
  const out = await emitRecordArtifacts();
  const document = JSON.parse(readFileSync(join(out, "embedding_records.jsonl"), "utf8").trim());
  assert.equal(document.schema_version, 8);
  assert.deepEqual(document.collections, []);
  assert.deepEqual(document.collection_memberships, []);
  for (const file of ['collection_docs.jsonl', 'collection_memberships.jsonl', 'colors_collection.json']) assert.equal(existsSync(join(out, file)), false);
  assert.equal(document.retrieval_phrases.length, 3);
  assert.equal(document.contribution.exact_baseline_echoes, 1);
  assert.match(readFileSync(join(out, "baseline_vocabulary.jsonl"), "utf8"), /SECRET_BASELINE/);
  assert.match(readFileSync(join(out, "intent_embedding_candidates.jsonl"), "utf8"), /candidate_not_embedded/);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json")));
  assert.equal(manifest.integration, "none");
  assert.equal(manifest.vectors_created, 0);
});

test("semantic factual rejection is terminal and never reaches discovery", async () => {
  const entity = select(), fake = provider(entity, { rejectFacts: true });
  await processRecord(entity, { render, submit: fake.submit });
  assert.equal(saved(entity).status, "quarantined");
  assert.deepEqual(fake.calls, ["facts", "fact_review"]);
  await processRecord(entity, { render, submit: fake.submit });
  assert.equal(fake.calls.length, 2);
  await assert.rejects(emitRecordArtifacts(), /no reviewed records/);
});

test("empty discovery and rejected phrases do not discard valid facts or baseline", async () => {
  for (const options of [{ empty: true }, { rejectPhrases: true }]) {
    const entity = select(), fake = provider(entity, options);
    await processRecord(entity, { render, submit: fake.submit });
    assert.equal(saved(entity).status, "passed");
    assert.equal(saved(entity).output.vocabulary.phrases.length, 0);
    assert.ok(saved(entity).output.baseline.length > 0);
    assert.equal(fake.calls.length, options.empty ? 3 : 4);
  }
});

test("each missing phase resumes after transport failure without redoing completed phases", async () => {
  const tasks = ["facts", "fact_review", "discovery", "vocabulary_review"];
  for (const [i, task] of tasks.entries()) {
    const entity = select(), broken = provider(entity, { failAt: task });
    await processRecord(entity, { render, submit: broken.submit });
    assert.equal(saved(entity).status, "failed");
    const retry = provider(entity);
    await processRecord(entity, { render, submit: retry.submit });
    assert.deepEqual(retry.calls, tasks.slice(i));
    assert.equal(saved(entity).status, "passed");
  }
});

test("changed baseline invalidates only assessment; facts and blind discovery are reusable", async () => {
  const entity = select(), fake = provider(entity);
  await processRecord(entity, { render, submit: fake.submit });
  state.replaceSelection([{ ...entity, key: entity.entity_id, kind: entity.target_kind, existing_synonyms: "feathered arrow; SECRET_BASELINE; updated route" }], STAGE_VERSIONS.select);
  await assert.rejects(emitRecordArtifacts(), /lack current reviewed records/);
  const current = state.selectedEntity(entity.entity_id), retry = provider(current);
  await processRecord(current, { render, submit: retry.submit });
  assert.deepEqual(retry.calls, ["vocabulary_review"]);
  assert.equal(saved(current).status, "passed");
});

test("identical pixels collapse to one attachment for all phases", async () => {
  const entity = select(), fake = provider(entity);
  const identical = async () => ({ renders: renders.map((r) => ({ ...r, analysis: { ink_hash: "same" } })) });
  await processRecord(entity, { render: identical, submit: async (job) => {
    assert.deepEqual(job.images, ["noto.png"]);
    return fake.submit(job);
  } });
  assert.equal(saved(entity).status, "passed");
});

test("bounded structural repairs do not turn into retry-until-approved", async () => {
  const entity = select(); let calls = 0;
  await processRecord(entity, { render, submit: async () => { calls++; return { json: {}, text: "" }; } });
  assert.equal(calls, 2);
  assert.equal(saved(entity).status, "failed");
});

test('export rejects stale taxonomy and corrupted family; source changes rerun factual phases', async () => {
  const entity = select(), fake = provider(entity);
  await processRecord(entity, {render, submit: fake.submit});
  const prior = saved(entity);
  assert.equal(prior.status, 'passed');
  const tampered = structuredClone(prior.output);
  tampered.source_context.taxonomy.version = 'stale';
  tampered.source_key = 'stale';
  state.beginCheckpoint({entityId:entity.entity_id, stage:'records', version:STAGE_VERSIONS.records, inputHash:prior.input_hash});
  state.finishCheckpoint({entityId:entity.entity_id, stage:'records', version:STAGE_VERSIONS.records, status:'passed', output:tampered});
  await assert.rejects(emitRecordArtifacts(), /lack current reviewed records/);
  const retry = provider(entity);
  await processRecord(entity, {render, submit:retry.submit});
  assert.deepEqual(retry.calls, ['facts','fact_review','discovery','vocabulary_review']);
  const corrupt = structuredClone(saved(entity).output);
  corrupt.draft.family = 'emoji';
  state.beginCheckpoint({entityId:entity.entity_id, stage:'records', version:STAGE_VERSIONS.records, inputHash:prior.input_hash});
  state.finishCheckpoint({entityId:entity.entity_id, stage:'records', version:STAGE_VERSIONS.records, status:'passed', output:corrupt});
  await assert.rejects(emitRecordArtifacts(), /lack current reviewed records/);
});


test('known enum gaps are quarantined before rendering or any provider call', async () => {
  for (const [character, code_point] of [['漢',0x6F22], ['&',0x26], ['／',0xFF0F]]) {
    const entity = select();
    const target = {...entity, code_point, character};
    await processRecord(target, {render:async () => {throw new Error('must not render');}, submit:async () => {throw new Error('must not call provider');}});
    assert.equal(saved(target).status, 'quarantined');
    assert.equal(saved(target).quality.reason, 'taxonomy_enum_gap');
    assert.equal(saved(target).quality.model_calls, 0);
    assert.ok(saved(target).error.includes(character));
  }
});

test('wording warnings survive checkpoints, resume and export without a repair call', async () => {
  const entity = select(), fake = provider(entity);
  await processRecord(entity, {render, submit:async job => {
    const response = await fake.submit(job);
    const input = JSON.parse(job.user);
    if (input.task === 'facts') response.json.properties[0].evidence = 'Both renders show rightward direction.';
    if (input.task === 'fact_review') response.json.checks[0].evidence = 'Both renders show an arrow.';
    return response;
  }});
  assert.equal(saved(entity).status, 'passed');
  assert.equal(fake.calls.length, 4);
  assert.equal(saved(entity).quality.evidence_warnings.length, 2);
  assert.equal(saved(entity).output.attempt_audit.filter(a => a.warnings?.length).length, 2);
  const retry = provider(entity);
  await processRecord(entity, {render, submit:retry.submit});
  assert.deepEqual(retry.calls, []);
  assert.equal(saved(entity).quality.evidence_warnings.length, 2);
  const out = await emitRecordArtifacts();
  const evidence = JSON.parse(readFileSync(join(out, 'record_evidence.jsonl'), 'utf8').trim());
  assert.equal(evidence.evidence_warnings.draft.length, 1);
  assert.equal(evidence.evidence_warnings.fact_review.length, 1);
  const quality = JSON.parse(readFileSync(join(out, 'quality_report.json'), 'utf8'));
  assert.equal(quality.evidence_warnings.length, 2);
  assert.equal(quality.contract_rejections, 0);
  assert.ok(quality.evidence_warnings.every(w => w.distinct_renders === 0));
  assert.doesNotMatch(readFileSync(join(out, 'embedding_records.jsonl'), 'utf8'), /render_wording_mismatch/);
});

test('reviewed names survive all four phases, resume and artifact revalidation for both reported symbols', async () => {
  for (const target of [
    { cp: 0x1faac, name: 'HAMSA', identity: 'A hamsa hand amulet.', names: ['hand of Fatima', 'hand of Miriam', 'khamsa'] },
    { cp: 0x2e2e, name: 'REVERSED QUESTION MARK', identity: 'A reversed question mark.', names: ['irony mark'] },
  ]) {
    const entity = select(target), calls = [];
    const submit = async job => {
      const input = JSON.parse(job.user); calls.push(input.task);
      if (input.task !== 'vocabulary_review') assert.doesNotMatch(job.user, /SECRET_BASELINE/);
      if (input.task === 'facts') return { json: { ...draft(entity), properties: [],
        description: { identity: target.identity, appearance: null, meaning: null },
        names: target.names.map(name => ({ name, basis: 'convention', source: 'Fixture naming practice', evidence: 'Fixture attribution for the full name.' })) }, text: '' };
      if (input.task === 'fact_review') return { json: factualReview(input.record, input.review_paths), text: '' };
      if (input.task === 'discovery') return { json: { entity_id: entity.entity_id,
        candidates: input.reviewed_facts.names.map((row, i) => ({ id: `n${i}`, phrase: row.name,
          intent: 'name', register: 'technical', supports: [`names.${i}`] })) }, text: '' };
      return { json: { entity_id: entity.entity_id,
        checks: input.discovery.candidates.map(c => ({ candidate_id: c.id, relevance: 'direct',
          grounding: 'Matches its reviewed name.', baseline_relation: 'rewording', baseline_ids: [input.baseline[0].id],
          comparison: 'Names the same identity.', group_id: 'naming' })),
        groups: [{ id: 'naming', intent: 'name', description: 'Find the object by name.', representative_id: 'n0' }] }, text: '' };
    };
    await processRecord(entity, { render, submit });
    assert.equal(saved(entity).status, 'passed', saved(entity).error);
    assert.deepEqual(calls, ['facts', 'fact_review', 'discovery', 'vocabulary_review']);
    await processRecord(entity, { render, submit: async () => { throw new Error('No new call expected on resume'); } });
    assert.equal(saved(entity).status, 'passed');
    const directory = await emitRecordArtifacts();
    const document = JSON.parse(readFileSync(join(directory, 'embedding_records.jsonl'), 'utf8').trim());
    assert.deepEqual(document.names.map(row => row.name), target.names);
    const lexical = readFileSync(join(directory, 'retrieval_vocabulary.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(lexical.map(row => row.phrase), target.names);
    assert.equal(readFileSync(join(directory, 'intent_embedding_candidates.jsonl'), 'utf8'), '');

    // A passed checkpoint and a cached embedding cannot hide a lost name on export.
    const prior = saved(entity), corrupt = structuredClone(prior.output);
    corrupt.vocabulary_review.checks[0].relevance = 'unsupported';
    corrupt.vocabulary_review.checks[0].group_id = null;
    if (target.names.length > 1) corrupt.vocabulary_review.groups[0].representative_id = 'n1';
    else corrupt.vocabulary_review.groups = [];
    state.beginCheckpoint({ entityId: entity.entity_id, stage: 'records', version: STAGE_VERSIONS.records, inputHash: prior.input_hash });
    state.finishCheckpoint({ entityId: entity.entity_id, stage: 'records', version: STAGE_VERSIONS.records, status: 'passed', output: corrupt });
    await assert.rejects(emitRecordArtifacts(), /lack current reviewed records/);
    const partial = await emitRecordArtifacts({ allowPartial: true });
    const quality = JSON.parse(readFileSync(join(partial, 'quality_report.json'), 'utf8'));
    assert.match(quality.excluded[0].reason, /names.0.*retained direct name-intent/);
  }
});
