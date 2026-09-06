import test from 'node:test';
import assert from 'node:assert/strict';
import { buildColorsCollection } from '../src/dataset-collections.mjs';
import { COLOR_NAMES } from '../src/taxonomy-colors.mjs';
import { resolveTaxonomy } from '../src/taxonomy.mjs';
import { parseRecord, compileEmbeddingRecord } from '../src/records.mjs';
import { draft, entity, renders } from './record-fixtures.mjs';

test('complete Unicode colors dataset contains every color, not arbitrary colored scenes', () => {
  const set = buildColorsCollection();
  assert.equal(set.color_count, 12);
  assert.equal(set.member_count, 36);
  assert.equal(set.complete, true);
  assert.equal(new Set(set.members.map(r => r.id)).size, 36);
  assert.deepEqual(set.colors.map(row => row.color), [...COLOR_NAMES]);
  for (const color of COLOR_NAMES) assert.ok(set.colors.find(row => row.color === color).members.length > 0, color);
  for (const glyph of ['🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪','🟥','🟧','🟨','🟩','🟦','🟪','🟫','⬛','⬜','🩷','🩶','🩵']) assert.ok(set.members.some(row => row.character === glyph), glyph);
  for (const glyph of ['🚗','🍎','😀','💙','🟢','🩵','©','♥','❥','🚅']) {
    const t = resolveTaxonomy(glyph);
    assert.equal(t.collection_ids.includes('colors'), ['💙','🟢','🩵'].includes(glyph), glyph);
  }
  // Pink/grey/light-blue lack circle and square emoji; do not invent those glyphs.
  for (const color of ['pink','grey','light blue']) assert.ok(set.members.filter(r => r.color === color).every(r => r.subfamily === 'heart'));
  assert.equal(set.retrieval_unit, 'complete_collection');
});

test('symbol records keep color properties without automatic collection memberships', () => {
  const target = {...entity, character:'🟢'}, t = resolveTaxonomy(target);
  const record = {...draft(target), properties:t.properties, collections:[]};
  const doc = compileEmbeddingRecord(record, target, {renders});
  assert.deepEqual(doc.collections, []);
  assert.deepEqual(doc.collection_memberships, []);
  assert.deepEqual(doc.facets.color, ['green']);
  const wrong = {...record, collections:[{id:'colors',fit:'primary',prefer_over:null,reason:'Green swatch.'}]};
  assert.throws(() => parseRecord(wrong, target, {renders}), /at most 0/);
});
