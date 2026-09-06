import test from "node:test";
import assert from "node:assert/strict";
import { parseRecord } from "../src/records.mjs";
import { baselineVocabulary, parseDiscovery, lexicalMatches, parseVocabularyReview, compileVocabulary, intentEmbeddingCandidates, vocabularyReviewPayload } from "../src/record-vocabulary.mjs";
import { recordDraftUser, recordDiscoveryUser, recordReviewUser } from "../src/prompts-records.mjs";
import { entity, renders, draft, discovery, vocabularyReview } from "./record-fixtures.mjs";
const record = parseRecord(draft(), entity, { renders }).record;
const baseline = baselineVocabulary(entity, { sources: [{ source: "fixture", text: "feathered arrow; known phrase" }] });
const candidates = () => parseDiscovery(discovery(record), record);

test("neither writer nor factual review receives baseline aliases through context", () => {
  const context = { identity: { entity_id: entity.entity_id, name: entity.name, existing_synonyms: "SECRET_SEED" },
    vocabulary_seeds: [{ text: "SECRET_SEED" }], baseline: ["SECRET_SEED"], render_mapping: [], render_note: "No images." };
  for (const value of [recordDraftUser(context), recordDiscoveryUser(context, record), recordReviewUser(context, record, [])]) {
    assert.doesNotMatch(value, /SECRET_SEED|existing_synonyms|vocabulary_seeds|baseline/);
  }
});

test("baseline preserves provenance without assigning discovery credit", () => {
  assert.ok(baseline.some((row) => row.phrase === entity.name && row.verification === "identity"));
  assert.ok(baseline.some((row) => row.phrase === "feathered arrow" && row.verification === "source-unverified"));
  assert.equal(lexicalMatches(candidates(), baseline)[0].exact_baseline_ids.length, 1);
});

test("empty discovery is valid; intent and register are independent", () => {
  assert.deepEqual(parseDiscovery({ entity_id: entity.entity_id, candidates: [] }, record).candidates, []);
  const value = discovery(record); value.candidates[0].register = "conversational";
  assert.equal(parseDiscovery(value, record).candidates[0].intent, "appearance");
});

test("named/numbered evidence resolves consistently while absent facts fail", () => {
  const value = discovery(record);
  assert.deepEqual(parseDiscovery(value, record).candidates[1].supports, ["properties.1"]);
  value.candidates[1].supports = ["properties.1", "properties.components"];
  assert.deepEqual(parseDiscovery(value, record).candidates[1].supports, ["properties.1"]);
  value.candidates[1].supports = ["properties.fake"];
  assert.throws(() => parseDiscovery(value, record), /missing or empty fact/);
  value.candidates[1].supports = ["description.meaning"];
  assert.throws(() => parseDiscovery(value, record), /missing or empty fact/);
});

test("exact echoes cannot be credited as new intents and grouping preserves truth separately", () => {
  const d = candidates(), raw = vocabularyReview(d, baseline);
  raw.checks[0].baseline_relation = "proposed-new-intent"; raw.checks[0].baseline_ids = [];
  const review = parseVocabularyReview(raw, d, baseline);
  assert.equal(review.checks[0].baseline_relation, "existing");
  assert.equal(review.checks[0].relation_overridden_by_code, true);
  const vocabulary = compileVocabulary(d, review, baseline);
  assert.equal(vocabulary.phrases.length, 3);
  assert.equal(vocabulary.contribution.generated_candidates, 3);
  assert.equal(vocabulary.contribution.retained_intent_groups, 2);
  assert.equal(vocabulary.contribution.proposed_new_intent_groups, 1);
  assert.equal(vocabulary.groups[0].baseline_relation, "existing");
  assert.equal(intentEmbeddingCandidates(entity.entity_id, vocabulary).length, 1);
  assert.doesNotThrow(() => parseVocabularyReview(vocabularyReviewPayload(review), d, baseline));
});

test("unsupported and uncertain phrases are withheld without discarding factual records", () => {
  const d = candidates(), raw = vocabularyReview(d, baseline);
  raw.checks[2].relevance = "uncertain"; raw.checks[2].group_id = null; raw.groups.pop();
  const vocabulary = compileVocabulary(d, parseVocabularyReview(raw, d, baseline), baseline);
  assert.equal(vocabulary.phrases.length, 2);
  assert.equal(vocabulary.contribution.uncertain_candidates, 1);
  assert.deepEqual(intentEmbeddingCandidates(entity.entity_id, vocabulary), []);
});

test("missing candidate checks, invented baseline IDs and invalid representatives fail", () => {
  const d = candidates();
  let raw = vocabularyReview(d, baseline); raw.checks.pop();
  assert.throws(() => parseVocabularyReview(raw, d, baseline), /every candidate/);
  raw = vocabularyReview(d, baseline); raw.checks[0].baseline_ids = ["missing"];
  assert.throws(() => parseVocabularyReview(raw, d, baseline), /baseline reference/);
  raw = vocabularyReview(d, baseline); raw.groups[0].representative_id = "c3";
  assert.throws(() => parseVocabularyReview(raw, d, baseline), /representative/);
});

test("typo, non-native and slang variants survive within one intent without novelty inflation", () => {
  const value = discovery(record);
  value.candidates = [
    { ...value.candidates[0], id: 'standard', phrase: 'feathered arrow' },
    { ...value.candidates[0], id: 'typo', phrase: 'fethered arrow', register: 'typo' },
    { ...value.candidates[0], id: 'simple', phrase: 'arrow have feathers', register: 'non-native' },
    { ...value.candidates[0], id: 'slang', phrase: 'fancy arrow', register: 'slang' },
    { ...value.candidates[0], id: 'duplicate', phrase: 'FEATHERED ARROW!' },
  ];
  const d = parseDiscovery(value, record);
  const baseId = baseline.find(row => row.phrase === 'feathered arrow').id;
  const raw = { entity_id: record.entity_id, checks: d.candidates.map(c => ({ candidate_id: c.id,
    relevance: 'direct', grounding: 'Fletched form supports this wording.', baseline_relation: 'rewording', baseline_ids: [baseId],
    comparison: 'Same appearance intent.', group_id: 'one' })),
    groups: [{ id: 'one', intent: 'appearance', description: 'Find the feathered arrow.', representative_id: 'standard' }] };
  const v = compileVocabulary(d, parseVocabularyReview(raw, d, baseline), baseline);
  assert.equal(v.phrases.length, 4);
  assert.equal(v.groups.length, 1);
  assert.equal(v.contribution.proposed_new_intent_groups, 0);
  assert.equal(v.contribution.new_wordings, 3);
  assert.equal(v.contribution.duplicate_wordings_removed, 1);
  assert.equal(v.contribution.phrase_shortfall, 6);
  assert.equal(v.contribution.new_wording_shortfall, 7);
  for (const register of ['typo', 'non-native', 'slang']) assert.equal(v.contribution.registers[register], 1);
  assert.deepEqual(intentEmbeddingCandidates(entity.entity_id, v), []);
});

test("one direct representative controls embeddings even when lexical alternatives are retained", () => {
  const d = candidates(), raw = vocabularyReview(d, baseline);
  raw.groups[0].intent = 'use';
  raw.checks[0].relevance = 'related';
  assert.throws(() => parseVocabularyReview(raw, d, baseline), /representative must be direct/);
  raw.groups[0].representative_id = 'c2';
  const v = compileVocabulary(d, parseVocabularyReview(raw, d, baseline), baseline);
  assert.equal(v.phrases.length, 3);
  const docs = intentEmbeddingCandidates(entity.entity_id, v);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].embedding_text, 'arrow with feathers');
});

test("thirty grounded candidates can pass every contract and empty yield is reported honestly", () => {
  const template = discovery(record).candidates[0];
  const d = parseDiscovery({ entity_id: record.entity_id,
    candidates: Array.from({ length: 30 }, (_, i) => ({ ...template, id: `c${i}`, phrase: `fixture wording ${i}` })) }, record);
  const raw = { entity_id: record.entity_id, checks: d.candidates.map(c => ({ candidate_id: c.id, relevance: 'direct',
    grounding: 'Fixture only.', baseline_relation: 'proposed-new-intent', baseline_ids: [], comparison: 'One fixture intent.', group_id: 'one' })),
    groups: [{ id: 'one', intent: 'appearance', description: 'One fixture intent.', representative_id: 'c0' }] };
  const v = compileVocabulary(d, parseVocabularyReview(raw, d, baseline), baseline);
  assert.equal(v.phrases.length, 30);
  assert.equal(v.contribution.proposed_new_intent_groups, 1);
  assert.equal(v.contribution.phrase_shortfall, 0);
  const empty = compileVocabulary({ candidates: [] }, { checks: [], groups: [] }, baseline);
  assert.equal(empty.contribution.phrase_shortfall, 10);
  assert.equal(empty.contribution.new_wordings, 0);
});
