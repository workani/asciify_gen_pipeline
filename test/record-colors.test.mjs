import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecord, compileEmbeddingRecord, parseRecordReview, reviewPaths } from '../src/records.mjs';
import { resolveTaxonomy } from '../src/taxonomy.mjs';
import { renders } from './record-fixtures.mjs';

const target = (glyph, name) => ({ entity_id: `character:${glyph.codePointAt(0)}`, target_kind: 'character',
  target_key: String(glyph.codePointAt(0)), character: glyph, hex: glyph.codePointAt(0).toString(16), name });
const face = target('🥲', 'SMILING FACE WITH TEAR');
const property = (key, values, evidence, attachments = [1, 2]) => ({ key, values, basis: 'render', attachments, evidence });
function record(entity = face) {
  const fixed = resolveTaxonomy(entity);
  return { entity_id: entity.entity_id, status: 'ready', family: fixed.family,
    subfamily: fixed.subfamily, subfamily_basis: fixed.subfamily_basis,
    description: { identity: 'A face emoji with a smile and tear.', appearance: 'A yellow face with a small blue tear on its cheek.', meaning: null },
    meaning_evidence: null, names: [], collections: [], uncertainties: [], properties: [
      property('color', ['yellow'], 'Yellow fills the main face in each distinct view.'),
      property('accent_color', ['blue'], 'The small tear on the cheek is blue.'),
    ] };
}
const parse = value => parseRecord(value, face, { renders }).record;

test('a blue tear is separate from the dominant yellow face in the exported facets', () => {
  const doc = compileEmbeddingRecord(parse(record()), face, { renders });
  assert.deepEqual(doc.facets.color, ['yellow']);
  assert.deepEqual(doc.facets.accent_color, ['blue']);
  assert.equal(doc.facets.color.includes('blue'), false);
  assert.match(doc.embedding_text, /blue tear/);
});

test('the old color bag is rejected at parsing AND export, never truncated to the first hue', () => {
  const value = record(); value.properties[0].values = ['yellow', 'blue'];
  assert.throws(() => parse(value), /exactly one dominant/);
  assert.throws(() => compileEmbeddingRecord(value, face, { renders }), /exactly one dominant/);
});

test('accents cannot be repeated as dominant or laundered as convention', () => {
  const value = record(); value.properties[1].values = ['yellow'];
  assert.throws(() => parse(value), /must not repeat/);
  value.properties[1].values = ['blue']; value.properties[1].basis = 'convention'; value.properties[1].attachments = [];
  assert.throws(() => parse(value), /accent_color requires rendered evidence/);
});

test('color palette and rendered dominance evidence are required', () => {
  const value = record(); value.properties[0].values = ['multicolor'];
  assert.throws(() => parse(value), /canonical color palette/);
  value.properties[0].values = ['yellow']; value.properties[0].basis = 'identity'; value.properties[0].attachments = [];
  assert.throws(() => parse(value), /rendered dominance evidence/);
  value.properties[0].basis = 'render'; value.properties[0].attachments = [1];
  assert.throws(() => parse(value), /every supplied distinct render/);
});

test('absent dominant color never gets inferred from component colors', () => {
  const value = record(); value.properties.shift();
  const doc = compileEmbeddingRecord(value, face, { renders });
  assert.equal(Object.hasOwn(doc.facets, 'color'), false);
  assert.deepEqual(doc.facets.accent_color, ['blue']);
  value.properties = [];
  assert.equal(Object.hasOwn(compileEmbeddingRecord(value, face, { renders }).facets, 'color'), false);
});

test('fixed Unicode swatch colors survive unchanged and cannot gain incidental dominant values', () => {
  const entity = target('🟢', 'LARGE GREEN CIRCLE'), fixed = resolveTaxonomy(entity);
  const value = { ...record(entity), description: { identity: 'A green circle.', appearance: 'A solid green circle.', meaning: null }, properties: fixed.properties };
  assert.deepEqual(compileEmbeddingRecord(value, entity, { renders }).facets.color, ['green']);
  const bad = { ...value, properties: value.properties.map(p => ({ ...p, values: p.key === 'color' ? ['green', 'blue'] : p.values })) };
  assert.throws(() => parseRecord(bad, entity, { renders }), /exactly one dominant/);
});

test('factual review can reject a single incidental color even when the JSON shape is valid', () => {
  const value = record(); value.properties = [property('color', ['blue'], 'The tear is blue in both renders.')];
  const parsed = parse(value);
  const review = { entity_id: face.entity_id, checks: reviewPaths(parsed).map(path => ({ path,
    verdict: path === 'properties.0' ? 'wrong' : 'supported', basis: ['description.meaning', 'names'].includes(path) ? 'convention' : path === 'description.identity' ? 'identity' : 'render',
    attachments: ['description.identity', 'description.meaning', 'names'].includes(path) ? [] : [1, 2],
    evidence: path === 'properties.0' ? 'Blue belongs only to the small tear; the main face is yellow.' : 'The depicted face matches this description.' })) };
  assert.equal(parseRecordReview(review, parsed, { renders }).accepted, false);
});
