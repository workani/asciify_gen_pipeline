import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecord, parseRecordReview, reviewPaths, compileEmbeddingRecord, MAX_NAMES } from '../src/records.mjs';
import { baselineVocabulary, factReferences, parseDiscovery, parseVocabularyReview, compileVocabulary, intentEmbeddingCandidates } from '../src/record-vocabulary.mjs';
import { draft, renders, factualReview } from './record-fixtures.mjs';

const hamsa = { entity_id: 'character:129708', target_kind: 'character', target_key: '129708', character: '🪬', name: 'HAMSA', hex: '1faac' };
const irony = { entity_id: 'character:11822', target_kind: 'character', target_key: '11822', character: '⸮', name: 'REVERSED QUESTION MARK', hex: '2e2e' };
const naming = name => ({ name, basis: 'convention', source: 'Fixture naming convention', evidence: 'Fixture evidence for this complete object name.' });
function record(entity = hamsa, names = ['hand of Fatima', 'hand of Miriam', 'khamsa']) {
  return parseRecord({ ...draft(entity), properties: [], names: names.map(naming),
    description: { identity: entity === hamsa ? 'A hamsa hand amulet.' : 'A reversed question mark.', appearance: null, meaning: null } }, entity, { renders }).record;
}
const discovery = record => ({ entity_id: record.entity_id, candidates: record.names.map((row, i) => ({
  id: `n${i}`, phrase: row.name, intent: 'name', register: 'technical', supports: [`names.${i}`] })) });
function assessment(discovery, baseline) {
  return { entity_id: discovery.entity_id, checks: discovery.candidates.map(c => ({
    candidate_id: c.id, relevance: 'direct', grounding: 'Exact name matches its reviewed naming fact.',
    baseline_relation: 'rewording', baseline_ids: [baseline[0].id], comparison: 'Alternative name for the same object.', group_id: 'names' })),
  groups: [{ id: 'names', intent: 'name', description: 'Find the object by its established name.', representative_id: 'n0' }] };
}
function pipeline(value, entity = hamsa) {
  const baseline = baselineVocabulary(entity, { sources: [{ source: 'fixture-old', text: 'hand of Fatima; unrelated historical phrase' }] });
  const d = parseDiscovery(discovery(value), value), raw = assessment(d, baseline);
  const compile = () => compileVocabulary(d, parseVocabularyReview(raw, d, baseline), baseline);
  return { baseline, d, raw, compile };
}

test('names are required, bounded, distinct lexical facts with their own attribution', () => {
  const valid = record();
  const parse = value => parseRecord(value, hamsa, { renders });
  const missing = { ...valid }; delete missing.names;
  assert.throws(() => parse(missing), /missing fields/);
  for (const names of [null, [naming('hand of Fatima'), naming('HAND OF FATIMA')], [naming('!!!')],
    [{ ...naming('khamsa'), basis: 'render' }], [{ ...naming('khamsa'), source: '' }],
    [{ ...naming('khamsa'), evidence: '' }], [{ ...naming('khamsa'), attachments: [1] }],
    Array.from({ length: MAX_NAMES + 1 }, (_, i) => naming(`fixture ${i}`))]) {
    assert.throws(() => parse({ ...valid, names }), /names|duplicate/);
  }
});

test('empty and populated names require an independent completeness review', () => {
  for (const names of [[], ['khamsa']]) {
    const value = record(hamsa, names), paths = reviewPaths(value), review = factualReview(value, paths);
    assert.ok(paths.includes('names'));
    assert.throws(() => parseRecordReview({ ...review, checks: review.checks.filter(c => c.path !== 'names') }, value), /every factual field/);
    const coverage = review.checks.find(c => c.path === 'names');
    coverage.verdict = 'wrong'; coverage.evidence = 'Fixture omission: hand of Fatima is missing.';
    assert.equal(parseRecordReview(review, value).accepted, false);
    coverage.verdict = 'uncertain';
    assert.equal(parseRecordReview(review, value).accepted, false);
    coverage.verdict = 'supported'; coverage.basis = 'identity';
    assert.throws(() => parseRecordReview(review, value), /completeness review requires convention/);
  }
});

test('names cannot borrow pixels or identity to verify a convention; each name is reviewed', () => {
  const value = record(), review = factualReview(value, reviewPaths(value));
  assert.equal(parseRecordReview(review, value).accepted, true);
  assert.throws(() => parseRecordReview({ ...review, checks: review.checks.filter(c => c.path !== 'names.1') }, value), /every factual field/);
  const name = review.checks.find(c => c.path === 'names.0');
  name.basis = 'render'; name.attachments = [1];
  assert.throws(() => parseRecordReview(review, value, { renders }), /name review/);
  name.basis = 'identity'; name.attachments = [];
  assert.throws(() => parseRecordReview(review, value), /name review/);
  name.basis = 'convention'; name.verdict = 'unsupported';
  assert.equal(parseRecordReview(review, value).accepted, false);
});

test('every full name needs its own name-intent candidate and exact supporting path', () => {
  const value = record();
  for (const mutate of [d => { d.candidates = []; }, d => d.candidates.pop(),
    d => { d.candidates[0].intent = 'use'; }, d => { d.candidates[0].phrase = 'Fatima'; },
    d => { d.candidates[0].supports = ['names.1']; }, d => { d.candidates[0].supports = ['description.identity']; }]) {
    const d = discovery(value); mutate(d);
    assert.throws(() => parseDiscovery(d, value), /name-intent candidate/);
  }
  for (const path of ['names', 'names.99', 'names.0.source']) {
    const d = discovery(value); d.candidates[0].supports = [path];
    assert.throws(() => parseDiscovery(d, value), /missing or empty fact/);
  }
  assert.equal(factReferences(record(hamsa, [])).has('names.0'), false);
});

test('hamsa names and irony mark survive with null meaning, attribution and baseline provenance', () => {
  for (const [entity, names] of [[hamsa, ['hand of Fatima', 'hand of Miriam', 'khamsa']], [irony, ['irony mark']]]) {
    const value = record(entity, names), { d, compile, baseline } = pipeline(value, entity);
    assert.equal(parseRecordReview(factualReview(value, reviewPaths(value)), value).accepted, true);
    const vocabulary = compile(), result = compileEmbeddingRecord(value, entity, { renders, vocabulary, baseline });
    assert.deepEqual(result.names, value.names);
    assert.deepEqual(result.retrieval_phrases.map(p => p.phrase), names);
    assert.ok(names.every(name => result.embedding_text.includes(name)));
    assert.doesNotMatch(result.embedding_text, /Fixture naming convention|Fixture evidence|unrelated historical phrase/);
    assert.equal(vocabulary.groups.length, 1);
    assert.equal(vocabulary.contribution.proposed_new_intent_groups, 0);
    assert.deepEqual(intentEmbeddingCandidates(entity.entity_id, vocabulary), []);
    assert.equal(result.baseline_vocabulary.find(b => b.phrase === 'hand of Fatima').verification, 'source-unverified');
    if (entity === hamsa) assert.equal(vocabulary.phrases[0].baseline_relation, 'existing');
    assert.equal(d.candidates.length, names.length);
  }
});

test('export blocks each missing, shortened, weak, uncited or reclassified reviewed name', () => {
  const value = record(), { d, raw, compile, baseline } = pipeline(value);
  assert.throws(() => compileEmbeddingRecord(value, hamsa, { renders, baseline }), /retained direct name-intent/);
  for (const mutate of [v => v.phrases.pop(), v => { v.phrases[0].phrase = 'Fatima'; },
    v => { v.phrases[0].supports = ['names.1']; }]) {
    const v = compile(); mutate(v);
    assert.throws(() => compileEmbeddingRecord(value, hamsa, { renders, vocabulary: v, baseline }), /retained direct name-intent/);
  }
  for (const relevance of ['related', 'unsupported', 'uncertain']) {
    const review = structuredClone(raw); review.checks[1].relevance = relevance;
    if (relevance !== 'related') review.checks[1].group_id = null;
    const vocabulary = compileVocabulary(d, parseVocabularyReview(review, d, baseline), baseline);
    assert.throws(() => compileEmbeddingRecord(value, hamsa, { renders, vocabulary }), /names.1.*retained direct name-intent/);
  }
  raw.groups[0].intent = 'use';
  assert.throws(() => compileEmbeddingRecord(value, hamsa, { renders, vocabulary: compile() }), /retained direct name-intent/);
});
