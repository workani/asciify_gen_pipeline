import test from "node:test";
import assert from "node:assert/strict";
import { parseRecord, parseRecordReview, reviewPaths, compileEmbeddingRecord, propertyScope, canonicalFamily } from "../src/records.mjs";
import { entity, renders, draft, factualReview } from "./record-fixtures.mjs";
const parse = (value, options = {}) => parseRecord(value, entity, { renders, ...options });

test("factual records contain no generated vocabulary or count quota", () => {
  const record = parse(draft()).record;
  const doc = compileEmbeddingRecord(record, entity, { renders });
  assert.equal(doc.embedding_text, record.description.appearance);
  assert.deepEqual(doc.facets.components, ["fletched tail", "triangular arrowhead"]);
  assert.throws(() => parse({ ...draft(), retrieval_phrases: [] }), /unknown fields/);
  assert.throws(() => parse({ ...draft(), new_aliases: [] }), /unknown fields/);
});

test("families use verbatim enum names and the fixed Unicode assignment", () => {
  assert.equal(canonicalFamily("arrow"), "arrow");
  for (const family of ["arrows", "dingbat arrow", "face emoji", "Arrow", " arrow ", "dingbats", "invented"]) {
    assert.throws(() => canonicalFamily(family), /unknown semantic family/);
    assert.throws(() => parse({ ...draft(), family }), /fixed Unicode family/);
  }
  assert.throws(() => parse({ ...draft(), family: "emoji" }), /fixed Unicode family/);
});

test("duplicate keys cannot overwrite components and duplicate pixels cannot establish cross-render support", () => {
  const value = draft(); value.properties.push({ ...value.properties[1], values: ["shaft"] });
  assert.throws(() => parse(value), /duplicate property key/);
  const property = draft().properties[1];
  assert.equal(propertyScope(property, renders), "cross_render");
  const same = [{ analysis: { ink_hash: "a" } }, { analysis: { ink_hash: "a" } }];
  assert.equal(propertyScope(property, same), "observed");
  const another = draft(); another.properties[1].evidence = "Both renders show fletching.";
  const parsed = parse(another, { renders: same });
  assert.equal(parsed.warnings[0].code, 'render_wording_mismatch');
  assert.equal(parsed.warnings[0].distinct_renders, 1);
  assert.equal(compileEmbeddingRecord(parsed.record, entity, {renders:same}).properties[1].scope, 'observed');
});

test('mixed identity wording warns without inventing visual citations or rejecting the review', () => {
  const target = {entity_id:'character:9878', target_kind:'character', target_key:'9878', character:'⚖', name:'SCALES', hex:'2696'};
  const value = draft(target);
  value.description = {identity:'A balance scale with two suspended pans.', appearance:'A central pillar and horizontal beam support two hanging pans.', meaning:null};
  value.properties = [];
  const record = parseRecord(value, target, {renders}).record;
  const review = factualReview(record, reviewPaths(record));
  review.checks[0].evidence = 'U+2696 named SCALES is balance scale; both renders show central pillar with two suspended pans.';
  const parsed = parseRecordReview(review, record, {renders});
  assert.equal(parsed.accepted, true);
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.warnings[0].path, 'description.identity');
  assert.equal(parsed.warnings[0].distinct_renders, 0);
  assert.equal(parsed.checks[0].basis, 'identity');
  assert.deepEqual(parsed.checks[0].attachments, []);
  assert.equal(parsed.checks[0].evidence, review.checks[0].evidence);
  review.checks[0].basis = 'render'; review.checks[0].attachments = [1,2];
  assert.deepEqual(parseRecordReview(review, record, {renders}).warnings, []);
});

test('prose never bypasses required visual citations, basis or full property coverage', () => {
  const record = parse(draft()).record;
  for (const attachments of [[], [1], [1,3], [1,1]]) {
    const review = factualReview(record, reviewPaths(record));
    const property = review.checks.find(row => row.path === 'properties.1');
    property.attachments = attachments;
    property.evidence = 'Both renders show the fletched tail.';
    assert.throws(() => parseRecordReview(review, record, {renders}), /basis and attachments|every claimed attachment|invalid review attachment/);
  }
  const review = factualReview(record, reviewPaths(record));
  review.checks[0].attachments = [1,2];
  assert.throws(() => parseRecordReview(review, record, {renders}), /basis and attachments/);
  for (const attachments of [[], [3], [1,1]]) {
    const value = draft(); value.properties[1].attachments = attachments;
    value.properties[1].evidence = 'Both renders show fletching.';
    assert.throws(() => parse(value), /evidence needs attachments|unknown or duplicate/);
  }
});

test('duplicate image hashes and a single cited view warn without acquiring corroboration', () => {
  const record = parse(draft()).record;
  const review = factualReview(record, reviewPaths(record));
  review.checks.find(row => row.path === 'description.appearance').evidence = 'Both attachments show an arrow.';
  const parsed = parseRecordReview(review, record, {renders});
  assert.equal(parsed.accepted, true);
  assert.equal(parsed.warnings[0].distinct_renders, 1);
  review.checks.find(row => row.path === 'properties.1').evidence = 'Both renders show fletching.';
  const same = renders.map(row => ({...row, analysis:{ink_hash:'same'}}));
  const duplicate = parseRecordReview(review, record, {renders:same});
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.warnings.length, 2);
  assert.ok(duplicate.warnings.every(warning => warning.distinct_renders === 1));
  review.checks[0].verdict = 'wrong';
  assert.equal(parseRecordReview(review, record, {renders:same}).accepted, false);
});

test("compound curves retain extent, path and terminal head roles", () => {
  const curved = { ...entity, name: "HEAVY BLACK CURVED UPWARDS AND RIGHTWARDS ARROW" };
  const value = draft();
  assert.throws(() => parseRecord(value, curved, { renders }), /requires up-right/);
  value.properties[0].values = ["up-right"];
  assert.throws(() => parseRecord(value, curved, { renders }), /both path directions/);
  value.properties.push({ key: "path_directions", values: ["up", "right"], basis: "identity", attachments: [], evidence: "Named extent." },
    { key: "head_direction", values: ["right"], basis: "render", attachments: [1], evidence: "Terminal head points right." });
  assert.doesNotThrow(() => parseRecord(value, curved, { renders }));
});

test("collection memberships are deferred and cannot block factual review", () => {
  const record = parse(draft()).record;
  assert.deepEqual(record.collections, []);
  assert.ok(!reviewPaths(record).some(path => path.startsWith("collections")));
  assert.throws(() => parse({ ...draft(), collections: [{ id: "decoration" }] }), /at most 0/);
});

test("factual review requires independent evidence, covers all fields, and has no rejection quota", () => {
  const record = parse(draft()).record;
  const review = factualReview(record, reviewPaths(record));
  assert.equal(parseRecordReview(review, record, { renders }).accepted, true);
  const appearance = review.checks.find((row) => row.path === "description.appearance");
  appearance.basis = "identity"; appearance.attachments = [];
  assert.throws(() => parseRecordReview(review, record, { renders }), /independent rendered evidence/);
  appearance.basis = "insufficient";
  assert.throws(() => parseRecordReview(review, record, { renders }), /insufficient evidence/);
  appearance.verdict = "uncertain";
  assert.equal(parseRecordReview(review, record, { renders }).accepted, false);
  assert.throws(() => parseRecordReview({ ...review, checks: review.checks.slice(1) }, record, { renders }), /every factual field/);
});

test("generation commentary and unresolved facts cannot ship as ready", () => {
  assert.throws(() => parse({ ...draft(), uncertainties: ["Shape uncertain"] }), /needs_review/);
  const value = draft(); value.description.appearance = "Both renders show a filled dot.";
  assert.throws(() => parse(value), /generation commentary/);
});

test("description metadata and generic hedge tails are rejected, technical distinctions survive", () => {
  for (const [field, prose] of [
    ['identity', 'The character is U+27B3, a feathered right arrow.'],
    ['identity', 'The Unicode arrow character.'],
    ['appearance', 'The WHITE-FEATHERED RIGHTWARDS ARROW has a fletched tail.'],
    ['meaning', 'Can express gratitude, among other related interpretations.'],
    ['meaning', 'Can express gratitude depending on context.'],
  ]) {
    const value = draft(); value.description[field] = prose;
    if (field === "meaning") value.meaning_evidence = { basis: "convention", source: "Fixture practice", evidence: "Fixture support." };
    assert.throws(() => parse(value), /metadata|official name|generic hedge/);
  }
  const value = draft();
  value.description.meaning = 'Can mark an ornamental pointer; not a claim of an official logo.';
  value.meaning_evidence = { basis: 'convention', source: 'Editorial typography', evidence: 'A pointer directs attention to text.' };
  const doc = compileEmbeddingRecord(parse(value).record, entity, { renders, vocabulary: { phrases: [
    { phrase: 'point to text', intent: 'use', relevance: 'direct', supports: ['description.meaning'] }], groups: [] } });
  assert.match(doc.embedding_text, /not a claim of an official logo/);
  assert.doesNotMatch(doc.embedding_text, /U\+|WHITE-FEATHERED/);
  assert.equal(doc.name, entity.name);
});

test("invisible records embed natural identity without metadata or requiring an appearance", () => {
  const space = { entity_id: 'character:8195', target_kind: 'character', target_key: '8195', character: '\u2003', name: 'EM SPACE', hex: '2003' };
  const value = draft(space);
  value.description = { identity: 'An em space, a spacing character one em wide.', appearance: null, meaning: null };
  value.properties = [];
  assert.equal(compileEmbeddingRecord(value, space).embedding_text, value.description.identity);
});


test("appearance cannot repeat the long official identity in lowercase either", () => {
  const value = draft();
  value.description.identity = 'A white-feathered rightwards arrow.';
  value.description.appearance = 'The white-feathered rightwards arrow has a fletched tail.';
  assert.throws(() => parse(value), /repeats the full name/);
});
