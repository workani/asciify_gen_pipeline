import { COLOR_NAMES } from './taxonomy-colors.mjs';
import { FAMILIES, SUBFAMILIES, resolveTaxonomy } from './taxonomy.mjs';
export { FAMILIES } from './taxonomy.mjs';
// The serving contract is one record per entity. Collections describe uses;
// properties describe the glyph. Neither is an exact query -> winner alias.
export const RECORD_SCHEMA_VERSION = 8;
export const MAX_NAMES = 16;
export const PROPERTY_KEYS = Object.freeze([
  "direction", "head_direction", "path_directions", "barb_side", "orientation", "fill", "weight", "shape",
  "components", "style", "enclosure", "count", "case", "script", "emotion",
  "color", "accent_color", "ornate", "filled", "size", "script_style", "stroke",
]);
// No normalization or aliases: enum names must be echoed verbatim.
export function canonicalFamily(value) {
  ensure(FAMILIES.includes(value), `unknown semantic family: ${value}`);
  return value;
}

function validateTaxonomy(value, fixed, renders) {
  ensure(fixed.subfamily_gap === null, `known taxonomy gap cannot be filled by a model: ${fixed.subfamily_gap}`);
  ensure(value.family === fixed.family, `family must equal fixed Unicode family ${fixed.family}`);
  const allowed = SUBFAMILIES[fixed.family];
  if (!allowed) {
    ensure(value.subfamily === null && value.subfamily_basis === null, "family without a subfamily axis requires null subfamily and basis");
  } else if (fixed.subfamily !== null) {
    ensure(value.subfamily === fixed.subfamily && value.subfamily_basis === "unicode", `subfamily must equal fixed Unicode subfamily ${fixed.subfamily} with unicode basis`);
  } else {
    ensure(allowed.includes(value.subfamily), `subfamily must be a verbatim member of ${fixed.family}: ${allowed.join(", ")}`);
    ensure(value.subfamily_basis === "model", "fallback subfamily requires model basis");
    ensure(renders.length > 0, "model subfamily assignment requires renders");
  }
}

const BASES = ["render", "identity", "convention"];
const DIRECTIONS = ["left", "right", "up", "down", "up-right", "up-left", "down-right", "down-left", "left-right", "up-down", "clockwise", "counterclockwise"];

export class RecordContractError extends Error {}
export function ensure(condition, message) { if (!condition) throw new RecordContractError(message); }
function object(value, path) {
  ensure(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
  return value;
}
export function keys(value, expected, path) {
  object(value, path);
  ensure(Object.keys(value).every((key) => expected.includes(key)), `${path} has unknown fields`);
  ensure(expected.every((key) => Object.hasOwn(value, key)), `${path} has missing fields`);
}
export function text(value, path, max, nullable = false) {
  if (nullable && value === null) return null;
  ensure(typeof value === "string" && value.trim().length > 0, `${path} must be nonempty text`);
  const out = value.trim().replace(/\s+/g, " ");
  ensure(out.length <= max, `${path} exceeds ${max} characters`);
  return out;
}
export function list(value, path, max) {
  ensure(Array.isArray(value) && value.length <= max, `${path} must be an array of at most ${max} items`);
  return value;
}
export function normalizeRecordText(value) {
  // Keep all scripts and meaningful words (including negation and direction).
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
// Prose can be imprecise, but never grants corroboration. Only structured
// citations determine coverage; wording disagreements stay in the audit.
function renderWordingWarning(evidence, path, basis, attachments, renders) {
  const distinct = new Set(attachments.map(id => renders[id - 1]?.analysis?.ink_hash).filter(Boolean));
  if (distinct.size >= 2 || !/\b(?:both|two|independent|shared|all)\s+(?:(?:target|vendor|glyph)\s+)?(?:renders?|images?|fonts?|sources?|attachments?)\b/i.test(evidence)) return [];
  return [{ code: "render_wording_mismatch", path, basis, attachments: [...attachments],
    distinct_renders: distinct.size,
    message: `${path} mentions multiple renders but cites ${distinct.size} distinct renders with ${basis} evidence; wording grants no additional visual support.` }];
}
export function parseRecord(value, entity, { renders = [] } = {}) {
  const warnings = [];
  keys(value, ["entity_id", "status", "description", "meaning_evidence", "names", "family", "subfamily", "subfamily_basis", "collections", "properties", "uncertainties"], "record");
  ensure(value.entity_id === entity.entity_id, "record.entity_id must match the supplied entity");
  const fixed = resolveTaxonomy(entity);
  validateTaxonomy(value, fixed, renders);
  ensure(["ready", "needs_review"].includes(value.status), "invalid record.status");
  keys(value.description, ["identity", "appearance", "meaning"], "description");
  const description = {
    identity: text(value.description.identity, "description.identity", 180),
    appearance: text(value.description.appearance, "description.appearance", 300, true),
    meaning: text(value.description.meaning, "description.meaning", 260, true),
  };
  // Names are independently reviewable facts, not inferred uses or an old
  // synonym blob. Keep attribution alongside each spelling, outside prose.
  const names = list(value.names, "names", MAX_NAMES).map((row, i) => {
    const path = `names.${i}`;
    keys(row, ["name", "basis", "source", "evidence"], path);
    ensure(["identity", "convention"].includes(row.basis), `${path} requires identity or convention basis`);
    const name = text(row.name, `${path}.name`, 100);
    ensure(normalizeRecordText(name).length > 0, `${path}.name must contain a lexical name`);
    return { name, basis: row.basis, source: text(row.source, `${path}.source`, 180),
      evidence: text(row.evidence, `${path}.evidence`, 300) };
  });
  ensure(new Set(names.map(row => normalizeRecordText(row.name))).size === names.length, "duplicate names; preserve distinct established spellings only");
  let meaning_evidence = null;
  if (description.meaning === null) {
    ensure(value.meaning_evidence === null, "null meaning requires null meaning_evidence");
  } else {
    keys(value.meaning_evidence, ["basis", "source", "evidence"], "meaning_evidence");
    ensure(value.meaning_evidence.basis === "convention", "meaning evidence requires convention basis");
    meaning_evidence = { basis: "convention", source: text(value.meaning_evidence.source, "meaning_evidence.source", 180),
      evidence: text(value.meaning_evidence.evidence, "meaning_evidence.evidence", 300) };
  }
  for (const [field, value] of Object.entries(description)) {
    ensure(!value || !/\b(?:(?:both|supplied|attached|provided|these|the two)\s+(?:(?:target|vendor|glyph)\s+)?(?:renders?|images?|screenshots?|fonts?)|(?:as\s+)?shown\s+(?:here|above|in the image))\b/i.test(value),
      `description.${field} contains generation commentary; move provenance to evidence`);
  }
  for (const [field, value] of Object.entries(description)) {
    if (!value) continue;
    ensure(!/\bU\+[0-9A-F]{4,6}\b|\bUnicode\b/i.test(value),
      `description.${field} contains Unicode metadata; keep names/codepoints in metadata fields`);
    const officialName = String(entity.name ?? "").trim();
    ensure(!(officialName.split(/\s+/).length > 1 && officialName === officialName.toUpperCase() && value.includes(officialName)),
      `description.${field} recites the uppercase official name; use natural prose`);
    ensure(!/\b(?:among other (?:related )?interpretations|depending on (?:the )?context|interpretations? may vary)\b/i.test(value),
      `description.${field} contains a generic hedge; preserve specific qualifications, put unresolved doubts in uncertainties`);
  }
  const nameWords = normalizeRecordText(entity.name);
  if (nameWords.split(" ").length >= 4 && description.appearance) {
    const repeatsName = prose => ` ${normalizeRecordText(prose)} `.includes(` ${nameWords} `);
    ensure(!(repeatsName(description.identity) && repeatsName(description.appearance)),
      "description.appearance repeats the full name from identity; lead with distinguishing geometry");
  }
  // Reserved for later curation; symbol generation never assigns memberships.
  const collections = list(value.collections, "collections", 0);
  const properties = list(value.properties, "properties", 12).map((row, index) => {
    keys(row, ["key", "values", "basis", "attachments", "evidence"], "property");
    ensure(PROPERTY_KEYS.includes(row.key), `unknown property: ${row.key}`);
    ensure(BASES.includes(row.basis), "invalid evidence basis");
    const values = list(row.values, "property.values", 6).map((val) => text(val, "property.value", 70));
    ensure(values.length > 0 && new Set(values).size === values.length, "property values must be nonempty and unique");
    if (["direction", "head_direction", "path_directions", "barb_side"].includes(row.key)) {
      ensure(values.every((val) => DIRECTIONS.includes(val)), `invalid ${row.key}`);
    }
    if (row.key === "stroke") ensure(values.every(v => ["double", "curved", "harpoon"].includes(v)), "invalid stroke value");
    if (["color", "accent_color"].includes(row.key)) {
      ensure(values.every(v => COLOR_NAMES.includes(v)), `invalid ${row.key}: use the canonical color palette`);
      if (row.key === "color") {
        ensure(values.length === 1, "color must contain exactly one dominant whole-symbol color; component colors belong in accent_color");
        const fixedColor = fixed.properties.find(p => p.key === "color");
        ensure(fixedColor ? row.basis === "identity" : row.basis === "render",
          "color requires rendered dominance evidence unless fixed by Unicode swatch identity");
      } else {
        ensure(row.basis === "render", "accent_color requires rendered evidence identifying the colored component");
      }
    }
    const attachments = list(row.attachments, "property.attachments", renders.length);
    ensure(new Set(attachments).size === attachments.length && attachments.every((id) => Number.isInteger(id) && id >= 1 && id <= renders.length), "unknown or duplicate render attachment");
    ensure(row.basis === "render" ? attachments.length > 0 : attachments.length === 0, "render evidence needs attachments; identity/convention evidence must not claim them");
    if (row.key === "color" && row.basis === "render") {
      ensure(attachments.length === renders.length, "dominant color must be supported across every supplied distinct render; omit color when they disagree");
    }
    const evidence = text(row.evidence, "property.evidence", 220);
    warnings.push(...renderWordingWarning(evidence, `properties.${index}`, row.basis, attachments, renders));
    return { key: row.key, values, basis: row.basis, attachments, evidence };
  });
  ensure(new Set(properties.map((row) => row.key)).size === properties.length, "duplicate property key; group components in one values array");
  const dominant = properties.find(p => p.key === "color")?.values[0];
  const accents = properties.find(p => p.key === "accent_color")?.values ?? [];
  ensure(!dominant || !accents.includes(dominant), "accent_color must not repeat the dominant color");
  for (const expected of fixed.properties) {
    const supplied = properties.find(p => p.key === expected.key);
    ensure(supplied && JSON.stringify(supplied.values) === JSON.stringify(expected.values) && supplied.basis === "identity",
      `fixed Unicode property ${expected.key} must be preserved`);
  }
  ensure(renders.length > 0 || description.appearance === null, "appearance requires a render");
  // The official compound trajectory is a hard invariant, independent of model
  // judgment. Match the direction phrase immediately before ARROW, not shading.
  const directions = { UPWARDS: "up", DOWNWARDS: "down", LEFTWARDS: "left", RIGHTWARDS: "right" };
  const compound = entity.name?.match(/(UPWARDS|DOWNWARDS) AND (LEFTWARDS|RIGHTWARDS) ARROW/);
  if (compound) {
    const expected = `${directions[compound[1]]}-${directions[compound[2]]}`;
    ensure(properties.find((p) => p.key === "direction")?.values.includes(expected), `official compound direction requires ${expected}`);
    if (/CURVED/.test(entity.name)) {
      const path = properties.find((p) => p.key === "path_directions")?.values ?? [];
      ensure(path.includes(directions[compound[1]]) && path.includes(directions[compound[2]]), "curved arrow must preserve both path directions");
      ensure(properties.some((p) => p.key === "head_direction"), "curved arrow needs a separately observed head_direction");
    }
  }
  const uncertainties = list(value.uncertainties, "uncertainties", 5).map((row) => text(row, "uncertainty", 200));
  ensure(value.status !== "ready" || uncertainties.length === 0, "unresolved uncertainty must use needs_review");
  return {
    record: { entity_id: entity.entity_id, status: value.status, description, meaning_evidence, names, family: fixed.family, subfamily: value.subfamily, subfamily_basis: value.subfamily_basis, collections, properties, uncertainties },
    warnings,
  };
}

export function reviewPaths(record) {
  return [...(record.subfamily_basis === "model" ? ["subfamily"] : []), ...Object.entries(record.description).filter(([key, value]) => key === "meaning" || value !== null).map(([key]) => `description.${key}`),
    "names", ...record.names.map((_, i) => `names.${i}`),
    ...record.properties.map((_, i) => `properties.${i}`)];
}

export function parseRecordReview(value, record, { renders = [] } = {}) {
  const warnings = [];
  keys(value, ["entity_id", "checks"], "review");
  ensure(value.entity_id === record.entity_id, "review.entity_id mismatch");
  const paths = reviewPaths(record);
  const checks = list(value.checks, "checks", paths.length).map((row) => {
    keys(row, ["path", "verdict", "basis", "attachments", "evidence"], "check");
    ensure(paths.includes(row.path), `unknown review path: ${row.path}`);
    ensure(["supported", "wrong", "unsupported", "uncertain"].includes(row.verdict), "invalid factual verdict");
    ensure(["render", "identity", "convention", "insufficient"].includes(row.basis), "invalid review evidence basis");
    const attachments = list(row.attachments, "check.attachments", renders.length);
    ensure(new Set(attachments).size === attachments.length && attachments.every((n) => Number.isInteger(n) && n > 0 && n <= renders.length), "invalid review attachment");
    ensure(row.basis === "render" ? attachments.length > 0 : attachments.length === 0, "review basis and attachments disagree");
    ensure(row.verdict !== "supported" || row.basis !== "insufficient", "insufficient evidence cannot support a claim");
    if (row.path === "subfamily" && row.verdict === "supported") ensure(row.basis === "render", "model subfamily review requires render evidence");
    if (row.path === "description.appearance" && row.verdict === "supported") ensure(row.basis === "render", "appearance review needs independent rendered evidence");
    if (row.verdict === "supported" && row.path === "description.meaning") ensure(row.basis === "convention", "meaning review requires convention basis, including review of a null meaning");
    if (row.verdict === "supported" && row.path === "names") ensure(row.basis === "convention", "names completeness review requires convention basis, including an empty list");
    if (row.verdict === "supported" && row.path.startsWith("names.")) {
      const name = record.names[Number(row.path.split(".")[1])];
      ensure(row.basis === name.basis, "name review must independently verify its identity or convention basis");
    }
    const property = row.path.startsWith("properties.") ? record.properties[Number(row.path.split(".")[1])] : null;
    if (row.verdict === "supported" && property?.basis === "render") {
      ensure(row.basis === "render" && property.attachments.every((id) => attachments.includes(id)), "visual property review must verify every claimed attachment");
    }
    const evidence = text(row.evidence, "check.evidence", 300);
    warnings.push(...renderWordingWarning(evidence, row.path, row.basis, attachments, renders));
    return { path: row.path, verdict: row.verdict, basis: row.basis, attachments, evidence };
  });
  ensure(checks.length === paths.length && new Set(checks.map((row) => row.path)).size === paths.length, "review must cover every factual field exactly once");
  return { entity_id: value.entity_id, checks, warnings, accepted: record.status === "ready" && checks.every((row) => row.verdict === "supported") };
}

// Scope is computed from the exact attachments actually supplied. Matching pixels
// never count as cross-render corroboration. Even cross_render is not universal.
export function propertyScope(property, renders = []) {
  if (property.basis !== "render") return "established";
  const all = new Set(renders.map((r) => r.analysis?.ink_hash).filter(Boolean));
  const cited = new Set(property.attachments.map((id) => renders[id - 1]?.analysis?.ink_hash).filter(Boolean));
  return all.size > 1 && cited.size === all.size ? "cross_render" : "observed";
}

export function compileEmbeddingRecord(record, entity, { renders = [], vocabulary = null, baseline = [] } = {}) {
  record = parseRecord(record, entity, { renders }).record;
  ensure(record.status === "ready", "cannot compile an unresolved record");
  ensureNameCoverage(record, vocabulary?.phrases ?? [], { retained: true });
  if (record.description.meaning !== null) {
    ensure(vocabulary?.phrases.some(phrase => phrase.intent === "use" &&
      ["direct", "related"].includes(phrase.relevance) && phrase.supports.includes("description.meaning")),
      "non-null meaning requires a retained use-intent phrase citing description.meaning");
  }
  const memberships = record.collections;
  const properties = record.properties.map((row) => ({ ...row, scope: propertyScope(row, renders) }));
  // Appearance already names the object and foregrounds its distinguishing form.
  // Collections and facets have their own retrieval paths; repeating them here
  // drowns out the teardrop, fletching, outline or bend that identifies this glyph.
  const body = [...new Set([record.description.appearance ?? record.description.identity,
    record.names.length ? `Also known as: ${record.names.map(row => row.name).join("; ")}.` : null,
    record.description.meaning].filter(Boolean))].join("\n");
  return {
    schema_version: RECORD_SCHEMA_VERSION, id: entity.entity_id, entity_id: entity.entity_id,
    target_kind: entity.target_kind, target_key: entity.target_key, character: entity.character,
    name: entity.name, hex: entity.hex, family: record.family, subfamily: record.subfamily, subfamily_basis: record.subfamily_basis,
    taxonomy_version: resolveTaxonomy(entity).version, description: record.description, meaning_evidence: record.meaning_evidence, names: record.names,
    collections: memberships.map((row) => row.id), collection_memberships: memberships,
    properties, facets: Object.fromEntries(properties.map((row) => [row.key, row.values])),
    baseline_vocabulary: baseline, retrieval_phrases: vocabulary?.phrases ?? [],
    intent_groups: vocabulary?.groups ?? [], contribution: vocabulary?.contribution ?? null,
    embedding_text: body,
  };
}

// Check individual spellings, not merely one name-intent candidate. Neither a
// baseline hit nor a related phrase can stand in for the reviewed name itself.
export function ensureNameCoverage(record, phrases, { retained = false } = {}) {
  record.names.forEach((row, i) => {
    const path = `names.${i}`;
    ensure(phrases.some(phrase => phrase.intent === "name" &&
      (!retained || phrase.relevance === "direct") && phrase.supports.includes(path) &&
      normalizeRecordText(phrase.phrase) === normalizeRecordText(row.name)),
    `${path} (${row.name}) requires a ${retained ? "retained direct name-intent phrase" : "name-intent candidate"} with the exact name citing ${path}`);
  });
}
