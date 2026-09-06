import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecord, parseRecordReview, reviewPaths, compileEmbeddingRecord } from '../src/records.mjs';
import { parseDiscovery, parseVocabularyReview, compileVocabulary } from '../src/record-vocabulary.mjs';
import { draft, renders, factualReview } from './record-fixtures.mjs';

const entity = { entity_id: 'character:8862', target_kind: 'character', target_key: '8862', character: '⊞', name: 'SQUARED PLUS', hex: '229e' };
function meaningRecord() {
  return { ...draft(entity), properties: [],
    description: { identity: 'A squared plus operator.', appearance: 'A plus centered inside a square outline.',
      meaning: 'A text stand-in for the Windows logo key in keyboard shortcuts, not the official Windows logo.' },
    meaning_evidence: { basis: 'convention', source: 'Windows keyboard-shortcut documentation',
      evidence: 'Keyboard-shortcut notation uses the squared plus as a text stand-in for the Windows logo key.' } };
}
const parse = value => parseRecord(value, entity, { renders }).record;
const candidates = record => ({ entity_id: record.entity_id, candidates: ['windows key', 'win key', 'windows logo key'].map((phrase, i) => ({
  id: `c${i}`, phrase, intent: 'use', register: 'casual', supports: ['description.meaning'] })) });
const assessment = discovery => ({ entity_id: discovery.entity_id,
  checks: discovery.candidates.map(c => ({ candidate_id: c.id, relevance: 'direct', grounding: 'Names the key represented in the stated shortcut convention.',
    baseline_relation: 'proposed-new-intent', baseline_ids: [], comparison: 'One conventional key use.', group_id: 'windows' })),
  groups: [{ id: 'windows', intent: 'use', description: 'Refer to the Windows logo key in shortcuts.', representative_id: 'c0' }] });

test('non-null meaning requires convention evidence and a named source', () => {
  assert.equal(parse(meaningRecord()).meaning_evidence.basis, 'convention');
  for (const evidence of [null, { basis: 'render', source: 'Image', evidence: 'A plus is visible.' },
    { basis: 'convention', source: '', evidence: 'Commonly used.' }]) {
    assert.throws(() => parse({ ...meaningRecord(), meaning_evidence: evidence }), /meaning_evidence|convention basis/);
  }
  assert.throws(() => parse({ ...meaningRecord(), description: { ...meaningRecord().description, meaning: null } }), /null meaning/);
});

test('review always checks null meaning and can reject an omitted convention', () => {
  const value = meaningRecord(); value.description.meaning = null; value.meaning_evidence = null;
  const record = parse(value), paths = reviewPaths(record), review = factualReview(record, paths);
  assert.ok(paths.includes('description.meaning'));
  assert.throws(() => parseRecordReview({ ...review, checks: review.checks.filter(c => c.path !== 'description.meaning') }, record, { renders }), /every factual field/);
  const check = review.checks.find(c => c.path === 'description.meaning');
  check.verdict = 'wrong'; check.basis = 'convention'; check.evidence = 'The Windows-key convention in keyboard-shortcut notation was omitted.';
  assert.equal(parseRecordReview(review, record, { renders }).accepted, false);
  check.verdict = 'uncertain';
  assert.equal(parseRecordReview(review, record, { renders }).accepted, false);
  check.verdict = 'supported'; check.basis = 'identity';
  assert.throws(() => parseRecordReview(review, record, { renders }), /convention basis/);
});

test('pixels or identity alone cannot support a non-null convention', () => {
  const record = parse(meaningRecord()), review = factualReview(record, reviewPaths(record));
  const check = review.checks.find(c => c.path === 'description.meaning');
  check.evidence = 'Keyboard-shortcut notation uses this as the Windows logo key stand-in.';
  assert.equal(parseRecordReview(review, record, { renders }).accepted, true);
  check.basis = 'render'; check.attachments = [1];
  assert.throws(() => parseRecordReview(review, record, { renders }), /convention basis/);
});

test('meaning cannot have empty discovery, appearance-only phrases or use phrases with unrelated support', () => {
  const record = parse(meaningRecord());
  assert.throws(() => parseDiscovery({ entity_id: record.entity_id, candidates: [] }, record), /use-intent candidate/);
  let value = candidates(record); value.candidates.forEach(c => { c.intent = 'appearance'; c.phrase = 'plus in a square'; });
  assert.throws(() => parseDiscovery(value, record), /use-intent candidate/);
  value = candidates(record); value.candidates.forEach(c => { c.supports = ['description.appearance']; });
  assert.throws(() => parseDiscovery(value, record), /citing description.meaning/);
});

test('Windows-key vocabulary survives as one use intent with evidence outside embedding prose', () => {
  const record = parse(meaningRecord()), discovery = parseDiscovery(candidates(record), record);
  const review = parseVocabularyReview(assessment(discovery), discovery, []);
  const vocabulary = compileVocabulary(discovery, review, []);
  const result = compileEmbeddingRecord(record, entity, { renders, vocabulary });
  assert.deepEqual(result.retrieval_phrases.map(p => p.phrase), ['windows key', 'win key', 'windows logo key']);
  assert.equal(result.intent_groups.length, 1);
  assert.equal(result.meaning_evidence.source, 'Windows keyboard-shortcut documentation');
  assert.doesNotMatch(result.embedding_text, /documentation/);
  assert.match(result.embedding_text, /Windows logo key/);
});

test('export rejects meaning if review withholds or reclassifies every conventional use', () => {
  const record = parse(meaningRecord()), discovery = parseDiscovery(candidates(record), record);
  const raw = assessment(discovery); raw.groups[0].intent = 'appearance';
  let vocabulary = compileVocabulary(discovery, parseVocabularyReview(raw, discovery, []), []);
  assert.throws(() => compileEmbeddingRecord(record, entity, { renders, vocabulary }), /retained use-intent/);
  raw.groups = []; raw.checks.forEach(c => { c.relevance = 'unsupported'; c.group_id = null; });
  vocabulary = compileVocabulary(discovery, parseVocabularyReview(raw, discovery, []), []);
  assert.throws(() => compileEmbeddingRecord(record, entity, { renders, vocabulary }), /retained use-intent/);
  assert.throws(() => compileEmbeddingRecord(record, entity, { renders }), /retained use-intent/);
});
