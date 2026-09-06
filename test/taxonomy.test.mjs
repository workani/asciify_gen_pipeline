import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, SUBFAMILIES, resolveTaxonomy, characterMetadata } from '../src/taxonomy.mjs';
import { FAMILY_RULES, headNoun, assignFamily } from '../src/taxonomy-family.mjs';
import { unicodeCharacter } from '../src/unicode-data.mjs';
import { parseRecord, parseRecordReview, reviewPaths, compileEmbeddingRecord } from '../src/records.mjs';
import { recordDraftUser, recordDiscoveryUser } from '../src/prompts-records.mjs';
import { summarize } from '../scripts/taxonomy/coverage.mjs';
import { entity, draft, renders, factualReview } from './record-fixtures.mjs';

test('exact ordered family predicates and head nouns', () => {
  assert.equal(FAMILY_RULES.length, 15);
  assert.deepEqual(FAMILY_RULES.map(([, family]) => family), ['whitespace-control', 'arrow', 'emoji', 'box-drawing', 'bullet', 'math', 'shape', 'letter', 'digit', 'emoji', 'currency', 'math', 'punctuation', 'misc-symbol', 'unknown']);
  for (const [name, noun] of [['CIRCLE WITH LEFT HALF BLACK', 'CIRCLE'], ['BLACK UP-POINTING TRIANGLE', 'TRIANGLE'], ['SQUARE POINTING UP', 'SQUARE'], ['TRIANGLE POINTED DOWN', 'TRIANGLE']]) assert.equal(headNoun(name), noun);
  for (const [glyph, family] of [['\n','whitespace-control'], ['→','arrow'], ['➳','arrow'], ['⃗','unknown'], ['♥','emoji'], ['❥','emoji'], ['❧','emoji'], ['─','box-drawing'], ['█','box-drawing'], ['•','bullet'], ['∙','math'], ['🚅','emoji'], ['🔴','shape'], ['🟥','shape'], ['⬛','shape'], ['△','shape'], ['Ⓐ','letter'], ['🅰','letter'], ['A','letter'], ['α','letter'], ['1','digit'], ['½','digit'], ['©','misc-symbol'], ['®','misc-symbol'], ['™','misc-symbol'], ['©️','misc-symbol'], ['😀','emoji'], ['$','currency'], ['+','math'], ['?','punctuation'], ['Ⅰ','unknown'], ['\u0300','unknown'], ['\uE000','unknown'], ['\uD800','unknown']]) assert.equal(resolveTaxonomy(glyph).family, family, glyph);
  // Moving rules changes precedence; no category stage can override the winner.
  const c = characterMetadata('•');
  assert.equal(assignFamily(c).familyBasis, 'rule-5');
  assert.equal(FAMILY_RULES.find(([predicate]) => predicate(c))[1], 'bullet');
});

test('all Unicode code points resolve to closed enums with coherent basis', () => {
  for (let cp = 0; cp <= 0x10FFFF; cp++) {
    const c = unicodeCharacter(cp), family = assignFamily(c).family;
    assert.ok(family === 'unknown' || FAMILIES.includes(family), cp.toString(16));
  }
  for (const glyph of ['→', '↔', '❧', '🟥', 'Ⓐ', '🅰', '𝛼', '𝟘', '漢', '∈', '✓', '🇺🇸', '👩‍💻', '1️⃣']) {
    const t = resolveTaxonomy(glyph);
    assert.ok(t.subfamily === null || SUBFAMILIES[t.family]?.includes(t.subfamily));
    assert.equal(t.subfamily_basis, t.subfamily === null ? null : 'unicode');
  }
});

test('hearts, colored shapes, enclosed letters and mathematical styles use code', () => {
  for (const glyph of ['❤','❥','❧']) assert.equal(resolveTaxonomy(glyph).subfamily, 'heart');
  for (const [glyph, subfamily, color] of [['🔴','circle','red'], ['🟥','square','red'], ['⬛','square','black'], ['⬛️','square','black']]) {
    const t = resolveTaxonomy(glyph);
    assert.equal(t.subfamily, subfamily);
    assert.deepEqual(t.properties.find(p => p.key === 'color')?.values, [color]);
  }
  for (const glyph of ['Ⓐ','🅰','ℬ']) assert.equal(resolveTaxonomy(glyph).subfamily, 'latin');
  for (let cp = 0x1D400; cp <= 0x1D7FF; cp++) {
    const t = resolveTaxonomy(String.fromCodePoint(cp));
    if (t.family === 'letter') {
      assert.equal(t.subfamily, 'latin');
      assert.ok(t.properties.some(p => p.key === 'script_style'), cp.toString(16));
    }
  }
  assert.equal(resolveTaxonomy('α').subfamily, 'greek');
});

test('official sequences share classification while arbitrary concatenation is unknown', () => {
  for (const [glyph, subfamily] of [['🇺🇸','flag'], ['👋🏽','hand'], ['😀','face'], ['❤️','heart']]) assert.equal(resolveTaxonomy(glyph).subfamily, subfamily);
  assert.equal(resolveTaxonomy('A😀').family, 'unknown');
  assert.throws(() => characterMetadata({character:'A', code_point:66}), /disagree/);
  assert.throws(() => characterMetadata(''), /nonempty/);
  assert.equal(resolveTaxonomy({ character: 'A', name: 'RIGHTWARDS ARROW', category_key: 'arrows' }).family, 'letter');
});

test('fixed taxonomy rejects family, subfamily, basis and property mutations', () => {
  const parse = value => parseRecord(value, entity, { renders });
  for (const patch of [{family:'emoji'}, {family:'Arrow'}, {subfamily:'left'}, {subfamily:'invented'}, {subfamily_basis:'model'}, {subfamily:null}]) assert.throws(() => parse({...draft(), ...patch}));
  const styled = { ...entity, character:'𝑨' }, t = resolveTaxonomy(styled);
  const record = {...draft(styled), properties: t.properties};
  assert.doesNotThrow(() => parseRecord(record, styled, { renders }));
  assert.throws(() => parseRecord({...record, properties:[]}, styled, { renders }), /script_style/);
  const doc = compileEmbeddingRecord(parse(draft()).record, entity, {renders});
  assert.equal(doc.subfamily, 'right');
  assert.equal(doc.subfamily_basis, 'unicode');
});

test('only null code assignments permit a rendered model fallback from that family', () => {
  const target = {...entity, character:'🚗'}, t = resolveTaxonomy(target);
  assert.equal(t.subfamily, null);
  const value = {...draft(target), properties:[], description:{identity:'An arrow.', appearance:null, meaning:null}};
  const record = parseRecord(value, target, {renders}).record;
  assert.equal(record.subfamily_basis, 'model');
  assert.throws(() => parseRecord({...value, subfamily:'right'}, target, {renders}), /verbatim/);
  assert.throws(() => parseRecord({...value, subfamily:null}, target, {renders}), /verbatim/);
  assert.throws(() => parseRecord({...value, subfamily_basis:'unicode'}, target, {renders}), /model basis/);
  assert.throws(() => parseRecord(value, target), /requires renders/);
  const paths = reviewPaths(record), review = factualReview(record, paths);
  assert.ok(paths.includes('subfamily'));
  review.checks.find(c => c.path === 'subfamily').basis = 'identity';
  review.checks.find(c => c.path === 'subfamily').attachments = [];
  assert.throws(() => parseRecordReview(review, record, {renders}), /render evidence/);
  const space = {...entity, character:' '}, noAxis = {...draft(space), properties:[], description:{identity:'A space.',appearance:null,meaning:null}};
  assert.doesNotThrow(() => parseRecord(noAxis, space));
  assert.throws(() => parseRecord({...noAxis, subfamily:'dot'}, space), /without a subfamily axis/);
});

test('fixed inputs reach both writers and unknown/null counts reconcile', () => {
  const taxonomy = resolveTaxonomy(entity), context = {taxonomy:{...taxonomy, baseline:'SECRET'}, identity:{entity_id:entity.entity_id}};
  for (const input of [recordDraftUser(context), recordDiscoveryUser(context, draft())]) {
    const value = JSON.parse(input);
    const {collection_ids, ...symbolTaxonomy} = taxonomy;
    assert.deepEqual(value.taxonomy, symbolTaxonomy);
    assert.doesNotMatch(input, /SECRET/);
  }
  const rows = ['A','漢','•','\uE000'].map(glyph => ({...characterMetadata(glyph),...resolveTaxonomy(glyph)}));
  const summary = summarize(rows);
  assert.equal(summary.total, 4);
  assert.equal(summary.unknowns, 1);
  assert.equal(summary.assigned + summary.nulls, summary.total);
  assert.equal(Object.values(summary.families).reduce((n,r) => n+r.count, 0), summary.total);
});


test('identity guards prevent contamination across every specialized family', () => {
  const cases = [
    [0x1C82, 'letter', 'cyrillic'], // NARROW must not match ARROW.
    [0x1F498, 'emoji', 'heart'], // HEART WITH ARROW is a heart.
    [0x1F3F9, 'emoji', 'object'], // BOW AND ARROW is a weapon.
    [0x1F685, 'emoji', null], // Train has a bullet nose, not a list-marker identity.
    [0x1F48C, 'emoji', 'object'], // LOVE LETTER is correspondence, not an alphabetic letter.
    [0x1F60D, 'emoji', 'face'], // Heart eyes do not reclassify a face as a heart.
    [0x1F63B, 'emoji', 'face'],
    [0x1F578, 'emoji', 'object'], [0x1F43E, 'emoji', null], [0x1F9A0, 'emoji', null],
    [0x29B3, 'math', 'set'], // EMPTY SET WITH RIGHT ARROW ABOVE.
    [0x29A8, 'math', null], // MEASURED ANGLE ... ARROW.
    [0x2A17, 'math', 'operator'], // INTEGRAL ... ARROW.
    [0x2A39, 'math', 'operator'], // PLUS SIGN IN TRIANGLE.
    [0x233A, 'misc-symbol', null], // APL ... QUAD DIAMOND is notation.
    [0x26FE, 'misc-symbol', null], // CUP ON BLACK SQUARE.
    [0x3248, 'digit', null], // CIRCLED NUMBER TEN ON BLACK SQUARE.
    [0x1D8EB, 'misc-symbol', null], // SIGNWRITING ... CIRCLE.
    [0x1DA44, 'unknown', null], // SIGNWRITING ... CIRCLE, a combining mark.
    [0x1F7F0, 'math', 'relation'], // HEAVY EQUALS SIGN in Geometric Shapes Extended.
    [0x1FBAE, 'box-drawing', null], // BOX DRAWINGS ... DIAMOND.
    [0x2219, 'math', 'operator'], [0x29BE, 'math', null],
    [0x2950, 'arrow', null], // Both left and right harpoons; barb directions aren't travel.
  ];
  for (const [cp, family, subfamily] of cases) {
    const t = resolveTaxonomy(String.fromCodePoint(cp));
    assert.equal(t.family, family, unicodeCharacter(cp).name);
    assert.equal(t.subfamily, subfamily, unicodeCharacter(cp).name);
  }
  // Inspect the entire list-marker family, including all excluded competitors.
  const bullets = [];
  for (let cp = 0; cp <= 0x10FFFF; cp++) if (assignFamily(unicodeCharacter(cp)).family === 'bullet') bullets.push(cp);
  assert.deepEqual(bullets, [0x2022,0x2023,0x2043,0x204C,0x204D,0x25D8,0x25E6]);
});


test('known enum gaps cannot be laundered into plausible but false model labels', () => {
  for (const [glyph, reason] of [['漢','script-outside-enum'],['▮','shape-outside-enum'],['↔','direction-outside-enum'],['&','punctuation-outside-enum'],['／','punctuation-outside-enum']]) {
    const target = {...entity, character:glyph};
    assert.equal(resolveTaxonomy(target).subfamily_gap, reason);
    assert.throws(() => parseRecord(draft(target), target, {renders}), /known taxonomy gap/);
  }
  assert.equal(resolveTaxonomy('🚗').subfamily_gap, null);
});

test('reference and editorial markers have a fixed annotation subfamily', () => {
  for (const glyph of ['※','†','‡','*','⁎','⁑','⁂','§','¶','⁋','⹋','＊']) {
    const target = {...entity, character:glyph};
    const t = resolveTaxonomy(target);
    assert.equal(t.family, 'punctuation', glyph);
    assert.equal(t.subfamily, 'annotation', glyph);
    assert.equal(t.subfamily_basis, 'unicode');
    assert.equal(t.subfamily_gap, null);
    const record = parseRecord(draft(target), target, {renders}).record;
    assert.ok(!reviewPaths(record).includes('subfamily'));
    assert.throws(() => parseRecord({...record, subfamily:'terminal'}, target, {renders}), /fixed Unicode subfamily annotation/);
  }
  for (const [glyph, family, subfamily] of [['?', 'punctuation','terminal'], ['—','punctuation','dash'], ['“','punctuation','quote'], ['(','punctuation','bracket'], ['∗','math','operator'], ['✱','misc-symbol',null]]) {
    const t = resolveTaxonomy(glyph);
    assert.deepEqual([t.family,t.subfamily], [family,subfamily], glyph);
  }
});

test('all black and white card suits retain their identity across presentation variants', () => {
  for (const glyph of ['♠','♡','♢','♣','♤','♥','♦','♧']) {
    for (const presentation of ['', '\uFE0E', '\uFE0F']) {
      const character = glyph + presentation;
      const t = resolveTaxonomy(character);
      assert.deepEqual([t.family,t.subfamily,t.subfamily_basis,t.subfamily_gap], ['emoji','card-suit','unicode',null], character);
      const target = {...entity, character, target_kind:presentation ? 'sequence' : 'character'};
      const record = parseRecord(draft(target), target, {renders}).record;
      assert.ok(!reviewPaths(record).includes('subfamily'));
      assert.equal(compileEmbeddingRecord(record, target, {renders}).subfamily, 'card-suit');
      assert.throws(() => parseRecord({...record, subfamily:'object'}, target, {renders}), /fixed Unicode subfamily card-suit/);
    }
  }
  for (const glyph of ['❤','❤️','💔','💘','❥']) assert.equal(resolveTaxonomy(glyph).subfamily, 'heart', glyph);
  assert.equal(resolveTaxonomy('💎').subfamily, 'object');
  assert.equal(resolveTaxonomy('◆').family, 'shape');
  assert.equal(resolveTaxonomy('♠A').family, 'unknown');
});
