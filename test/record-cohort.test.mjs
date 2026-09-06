import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRecordCohort, auditRecordCohort } from '../src/record-cohort.mjs';
import { resolveTaxonomy } from '../src/taxonomy.mjs';
import { unicodeCharacter } from '../src/unicode-data.mjs';

const source = cp => { const u = unicodeCharacter(cp); return { code_point: cp, character: u.char, name: u.name, hex_code: u.hex, category_key: u.block }; };
const bulletCps = [0x2022, 0x2023, 0x2043, 0x204c, 0x204d, 0x25d8, 0x25e6];
const corpus = { characters: [...bulletCps, 0x2219, 0x1f685, 0x2192].map(source), sequences: [] };
const compileFixture = e => { const t = resolveTaxonomy(e); return { entity_id: e.entity_id, family: t.family,
  subfamily: t.subfamily ?? t.allowed_subfamilies?.[0] ?? null, subfamily_basis: t.subfamily_basis ?? (t.allowed_subfamilies ? "model" : null), description: { identity: e.name.toLowerCase(), appearance: null },
  properties: [], retrieval_phrases: [{ register: 'casual' }] }; };

test('whole bullet family includes every member and excludes operator/train contamination', () => {
  const cohort = selectRecordCohort(corpus, { family: 'bullet' });
  assert.deepEqual(cohort.entities.map(e => e.code_point).sort((a,b) => a-b), bulletCps);
  const docs = cohort.entities.map(compileFixture);
  const audit = auditRecordCohort(cohort.entities, docs, cohort);
  assert.equal(audit.full_family_complete, true);
  assert.equal(audit.families.bullet.accepted, 7);
  assert.equal(audit.families.bullet.registers.casual, 7);
  assert.equal(audit.families.bullet.registers.typo, 0);
  assert.equal(audit.semantic_review, 'requires_human_review');
  const missing = auditRecordCohort(cohort.entities, docs.slice(1), cohort);
  assert.equal(missing.full_family_complete, false);
  assert.equal(missing.missing.length, 1);
  docs[0].family = 'math';
  assert.equal(auditRecordCohort(cohort.entities, docs, cohort).errors[0].reason, 'fixed_taxonomy_mismatch');
});

test('sample, duplicate records and unexpected records cannot masquerade as full-family coverage', () => {
  const cohort = selectRecordCohort(corpus, { cps: [0x2022] });
  const docs = cohort.entities.map(compileFixture);
  assert.equal(auditRecordCohort(cohort.entities, docs, cohort).full_family_complete, false);
  const audit = auditRecordCohort(cohort.entities, [...docs, docs[0], { ...docs[0], entity_id: 'fake' }], cohort);
  assert.deepEqual(audit.errors.map(e => e.reason), ['duplicate_record', 'unexpected_record']);
  assert.equal(audit.complete, false);
  assert.throws(() => selectRecordCohort(corpus, { family: 'invented' }), /Unknown family/);
  assert.throws(() => selectRecordCohort(corpus, { family: 'bullet', cps: [0x2022] }), /not both/);
});

test('cross-character copied descriptions flag differing facts, shared generic phrases are legitimate', () => {
  const cohort = selectRecordCohort({ characters: [0x2190, 0x2192].map(source), sequences: [] }, { family: 'arrow' });
  const docs = cohort.entities.map(compileFixture);
  for (const doc of docs) {
    doc.description.appearance = 'A straight arrow.';
    doc.retrieval_phrases = [{ phrase: 'arrow', register: 'casual' }];
  }
  const audit = auditRecordCohort(cohort.entities, docs, cohort);
  assert.equal(audit.errors.length, 0);
  assert.equal(audit.review_flags.length, 1);
  assert.equal(audit.review_flags[0].entity_ids.length, 2);
  docs[0].description.appearance = 'A left arrow with a straight shaft.';
  assert.equal(auditRecordCohort(cohort.entities, docs, cohort).review_flags.length, 0);
});

test('presentation-only duplicate sequences are folded, composite family members remain included', () => {
  const cohort = selectRecordCohort({ characters: [0x2764].map(source), sequences: [
    { sequence_key: '2764-fe0f', hex_sequence: '2764 fe0f', emoji: '❤️', name: 'red heart' },
    { sequence_key: '2764-fe0f-200d-1f525', hex_sequence: '2764 fe0f 200d 1f525', emoji: '❤️‍🔥', name: 'heart on fire' },
  ] }, { family: 'emoji' });
  assert.equal(cohort.source_rows, 3);
  assert.equal(cohort.presentation_duplicates_omitted, 1);
  assert.equal(cohort.entities.length, 2);
});
