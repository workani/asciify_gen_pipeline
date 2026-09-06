import { createHash } from "node:crypto";
import { ensure, keys, text, list, normalizeRecordText, ensureNameCoverage } from "./records.mjs";

export const INTENTS = Object.freeze(["name", "appearance", "meaning", "use"]);
export const REGISTERS = Object.freeze(["technical", "descriptive", "casual", "conversational", "slang", "typo", "non-native"]);
export const VOCABULARY_CONTRACT_VERSION = 4;
export const MAX_CANDIDATES = 40;
export const PHRASE_TARGET = Object.freeze({ min: 10, max: 30 });
const idFor = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

// Baseline is preservation, not newly verified fact or model discovery. Keep
// source text verbatim as well as phrase entries; never split natural text on spaces.
export function baselineVocabulary(entity, existing) {
  const entries = new Map();
  function add(phrase, source, verification) {
    const key = normalizeRecordText(phrase);
    if (!key) return;
    const row = entries.get(key) ?? { id: `baseline:${idFor(key)}`, phrase: phrase.trim(), sources: [], verification };
    if (!row.sources.includes(source)) row.sources.push(source);
    if (verification === "identity") row.verification = verification;
    entries.set(key, row);
  }
  add(entity.name, "unicode-name", "identity");
  if (entity.hex) add(`U+${entity.hex.toUpperCase()}`, "unicode-codepoint", "identity");
  for (const source of existing.sources ?? []) {
    for (const phrase of source.text.split(/[;\n|]+/u)) add(phrase, source.source, "source-unverified");
  }
  return [...entries.values()];
}

export function factReferences(record) {
  const map = new Map(Object.entries(record.description).filter(([, v]) => v !== null)
    .map(([key]) => [`description.${key}`, `description.${key}`]));
  record.names.forEach((_, i) => map.set(`names.${i}`, `names.${i}`));
  for (const [group, rows, key] of [["properties", record.properties, "key"]]) {
    if (rows.length) map.set(group, group);
    rows.forEach((row, i) => {
      map.set(`${group}.${i}`, `${group}.${i}`);
      map.set(`${group}.${row[key]}`, `${group}.${i}`);
    });
  }
  return map;
}

export function parseDiscovery(value, record) {
  keys(value, ["entity_id", "candidates"], "discovery");
  ensure(value.entity_id === record.entity_id, "discovery.entity_id mismatch");
  const references = factReferences(record);
  const candidates = list(value.candidates, "candidates", MAX_CANDIDATES).map((row) => {
    keys(row, ["id", "phrase", "intent", "register", "supports"], "candidate");
    const id = text(row.id, "candidate.id", 32);
    ensure(/^[a-zA-Z0-9_-]+$/.test(id), "candidate ID must be a simple stable identifier");
    ensure(INTENTS.includes(row.intent), "invalid candidate intent");
    ensure(REGISTERS.includes(row.register), "invalid candidate register");
    const supports = list(row.supports, "candidate.supports", 4).map((path) => {
      ensure(references.has(path), `candidate ${id} references missing or empty fact ${JSON.stringify(path)}`);
      return references.get(path);
    });
    ensure(supports.length > 0, "candidate must cite supporting facts");
    return { id, phrase: text(row.phrase, "candidate.phrase", 100), intent: row.intent,
      register: row.register, supports: [...new Set(supports)] };
  });
  ensure(new Set(candidates.map((row) => row.id)).size === candidates.length, "duplicate candidate IDs");
  ensureNameCoverage(record, candidates);
  ensure(record.description.meaning === null || candidates.some(candidate => candidate.intent === "use" &&
    candidate.supports.includes("description.meaning")),
    "non-null meaning requires a use-intent candidate citing description.meaning");
  // Echoes and duplicated wording are audited rather than causing a full-record
  // rejection. Empty discovery is legitimate only without names or meaning to cover.
  return { entity_id: value.entity_id, candidates };
}

export function lexicalMatches(discovery, baseline) {
  return discovery.candidates.map((candidate) => ({ candidate_id: candidate.id,
    exact_baseline_ids: baseline.filter((row) => normalizeRecordText(row.phrase) === normalizeRecordText(candidate.phrase)).map((row) => row.id),
    // A token-span hit is evidence of overlap, not a semantic equivalence verdict.
    contained_in_baseline_ids: baseline.filter((row) => ` ${normalizeRecordText(row.phrase)} `.includes(` ${normalizeRecordText(candidate.phrase)} `)).map((row) => row.id),
    duplicate_candidate_ids: discovery.candidates.filter((row) => row.id !== candidate.id && normalizeRecordText(row.phrase) === normalizeRecordText(candidate.phrase)).map((row) => row.id),
  }));
}

export function parseVocabularyReview(value, discovery, baseline) {
  keys(value, ["entity_id", "checks", "groups"], "vocabulary review");
  ensure(value.entity_id === discovery.entity_id, "vocabulary review.entity_id mismatch");
  const byId = new Map(discovery.candidates.map((row) => [row.id, row]));
  const baselineIds = new Set(baseline.map((row) => row.id));
  const matches = new Map(lexicalMatches(discovery, baseline).map((row) => [row.candidate_id, row]));
  const checks = list(value.checks, "vocabulary checks", MAX_CANDIDATES).map((row) => {
    keys(row, ["candidate_id", "relevance", "grounding", "baseline_relation", "baseline_ids", "comparison", "group_id"], "vocabulary check");
    ensure(byId.has(row.candidate_id), "unknown candidate in vocabulary review");
    ensure(["direct", "related", "unsupported", "uncertain"].includes(row.relevance), "invalid candidate relevance");
    ensure(["existing", "rewording", "proposed-new-intent", "uncertain"].includes(row.baseline_relation), "invalid baseline relation");
    const baseline_ids = list(row.baseline_ids, "baseline_ids", baseline.length);
    ensure(new Set(baseline_ids).size === baseline_ids.length && baseline_ids.every((id) => baselineIds.has(id)), "unknown or duplicate baseline reference");
    if (["existing", "rewording"].includes(row.baseline_relation)) ensure(baseline_ids.length > 0, "existing/rewording decision must name the baseline it overlaps");
    const eligible = ["direct", "related"].includes(row.relevance);
    ensure(eligible ? typeof row.group_id === "string" && row.group_id.length > 0 : row.group_id === null, "only grounded candidates may belong to an intent group");
    const exact = matches.get(row.candidate_id).exact_baseline_ids;
    return { ...row, grounding: text(row.grounding, "grounding", 300), comparison: text(row.comparison, "comparison", 300),
      baseline_ids: exact.length ? exact : baseline_ids,
      baseline_relation: exact.length ? "existing" : row.baseline_relation,
      relation_overridden_by_code: exact.length > 0 && row.baseline_relation !== "existing" };
  });
  ensure(checks.length === byId.size && new Set(checks.map((row) => row.candidate_id)).size === byId.size, "review must cover every candidate exactly once");
  const eligible = checks.filter((row) => ["direct", "related"].includes(row.relevance));
  const groups = list(value.groups, "intent groups", MAX_CANDIDATES).map((row) => {
    keys(row, ["id", "intent", "description", "representative_id"], "intent group");
    const id = text(row.id, "group.id", 32);
    ensure(/^[a-zA-Z0-9_-]+$/.test(id), "group ID must be a simple identifier");
    ensure(INTENTS.includes(row.intent), "invalid group intent");
    const members = eligible.filter((check) => check.group_id === id);
    ensure(members.length > 0 && members.some((check) => check.candidate_id === row.representative_id), "representative must be a grounded member of a nonempty group");
    ensure(!members.some(check => check.relevance === "direct") ||
      members.find(check => check.candidate_id === row.representative_id).relevance === "direct",
      "representative must be direct when the group has direct members");
    // One group per user intent, even when wording/register or original writer
    // intent labels differ. The assessor may correct the writer's intent label.
    return { id, intent: row.intent, description: text(row.description, "group.description", 200), representative_id: row.representative_id };
  });
  ensure(new Set(groups.map((row) => row.id)).size === groups.length, "duplicate intent groups");
  ensure(eligible.every((row) => groups.some((group) => group.id === row.group_id)), "grounded candidate missing its intent group");
  const duplicateGroups = new Map();
  for (const row of eligible) {
    const key = normalizeRecordText(byId.get(row.candidate_id).phrase);
    ensure(!duplicateGroups.has(key) || duplicateGroups.get(key) === row.group_id, "identical phrases cannot inflate intent group counts");
    duplicateGroups.set(key, row.group_id);
  }
  return { entity_id: value.entity_id, checks, groups };
}

export function compileVocabulary(discovery, review, baseline) {
  const byId = new Map(discovery.candidates.map((row) => [row.id, row]));
  const eligible = review.checks.filter((row) => ["direct", "related"].includes(row.relevance));
  const groups = review.groups.map((group) => {
    const members = eligible.filter((row) => row.group_id === group.id);
    const relations = members.map((row) => row.baseline_relation);
    // New wording within a known intent never counts as a new intent.
    const baseline_relation = relations.includes("existing") ? "existing" : relations.includes("rewording") ? "rewording"
      : relations.every((v) => v === "proposed-new-intent") ? "proposed-new-intent" : "uncertain";
    return { ...group, baseline_relation, candidate_ids: members.map((row) => row.candidate_id),
      representative_phrase: byId.get(group.representative_id).phrase,
      registers: [...new Set(members.map((row) => byId.get(row.candidate_id).register))] };
  });
  // Preserve useful lexical variants; semantic grouping controls intent credit
  // and embedding candidates, not which register a user is allowed to type.
  const unique = new Map();
  for (const check of eligible) {
    const candidate = byId.get(check.candidate_id);
    const group = groups.find(row => row.id === check.group_id);
    const key = normalizeRecordText(candidate.phrase);
    const prior = unique.get(key);
    if (!prior || (prior.relevance !== "direct" && check.relevance === "direct")) {
      unique.set(key, { ...candidate, intent: group.intent, group_id: group.id,
        relevance: check.relevance, baseline_relation: check.baseline_relation });
    }
  }
  const phrases = [...unique.values()];
  const baselineKeys = new Set(baseline.map(row => normalizeRecordText(row.phrase)));
  const newWordings = phrases.filter(row => !baselineKeys.has(normalizeRecordText(row.phrase))).length;
  return { phrases, groups, contribution: {
    baseline_entries_preserved: baseline.length, generated_candidates: discovery.candidates.length,
    verbatim_baseline_spans: lexicalMatches(discovery, baseline).filter((row) => row.contained_in_baseline_ids.length).length,
    exact_baseline_echoes: lexicalMatches(discovery, baseline).filter((row) => row.exact_baseline_ids.length).length,
    retained_phrases: phrases.length,
    new_wordings: newWordings,
    duplicate_wordings_removed: eligible.length - phrases.length,
    phrase_target: PHRASE_TARGET,
    phrase_shortfall: Math.max(0, PHRASE_TARGET.min - phrases.length),
    new_wording_shortfall: Math.max(0, PHRASE_TARGET.min - newWordings),
    registers: Object.fromEntries(REGISTERS.map(register => [register, phrases.filter(row => row.register === register).length])),
    retained_intent_groups: groups.length,
    known_intent_groups: groups.filter((row) => ["existing", "rewording"].includes(row.baseline_relation)).length,
    proposed_new_intent_groups: groups.filter((row) => row.baseline_relation === "proposed-new-intent").length,
    uncertain_intent_groups: groups.filter((row) => row.baseline_relation === "uncertain").length,
    rejected_candidates: review.checks.filter((row) => row.relevance === "unsupported").length,
    uncertain_candidates: review.checks.filter((row) => row.relevance === "uncertain").length,
    measured_search_improvement: null, assessment: "model_assessed_not_human_validated",
  } };
}

export function intentEmbeddingCandidates(entityId, vocabulary) {
  // Export text candidates only. At most one representative per intent, never
  // every paraphrase. Ambiguous related phrases stay lexical suggestions.
  return vocabulary.groups.filter((group) => ["meaning", "use"].includes(group.intent))
    .filter((group) => vocabulary.phrases.some((p) => p.group_id === group.id && normalizeRecordText(p.phrase) === normalizeRecordText(group.representative_phrase) && p.relevance === "direct"))
    .map((group) => ({ id: `${entityId}:intent:${idFor(group.description)}`, entity_id: entityId,
      group_id: group.id, baseline_relation: group.baseline_relation,
      embedding_text: group.representative_phrase,
      status: "candidate_not_embedded", merge_key: entityId }));
}

export function vocabularyReviewPayload(review) {
  return { entity_id: review.entity_id, groups: review.groups,
    checks: review.checks.map(({ candidate_id, relevance, grounding, baseline_relation, baseline_ids, comparison, group_id }) =>
      ({ candidate_id, relevance, grounding, baseline_relation, baseline_ids, comparison, group_id })) };
}
