import {
  canonicalEntityKey,
  entityId,
  presentationOnlySequenceBase,
  unicodeGroup,
} from "./normalize.mjs";

const HARD_EXCLUDE_BLOCK_RE =
  /(?:private-use|surrogate|variation-selectors|tags|specials|unassigned)/i;
const MASS_SCRIPT_BLOCK_RE =
  /(?:cjk-unified|cjk-compatibility-ideographs|hangul-syllables|tangut(?!-components)|nushu|khitan-small-script|yi-syllables)/i;
const PREFERRED_LETTER_BLOCK_RE =
  /(?:basic-latin|latin-|ipa-extensions|phonetic-extensions|spacing-modifier|greek|cyrillic|armenian|georgian|hebrew|arabic$|arabic-supplement|devanagari|bengali|gurmukhi|gujarati|oriya|tamil|telugu|kannada|malayalam|sinhala|thai|lao|tibetan|myanmar|ethiopic|cherokee|hiragana|katakana|hangul-jamo|bopomofo|letterlike|alphabetic-presentation|halfwidth-and-fullwidth)/i;
const VISUAL_BLOCK_RE =
  /(?:arrow|symbol|dingbat|shape|pictograph|technical|operator|currency|punctuation|alchemical|chess|card|domino|mahjong|musical|braille|box-drawing|block-elements|geometric|ornamental)/i;

const GROUP_SCORE = {
  symbol: 9_000,
  punctuation: 8_500,
  number: 7_500,
  separator: 7_000,
  mark: 6_500,
  letter: 2_000,
  other: 0,
};

function popularityScore(popularity) {
  return Math.round(Math.log2(1 + Math.max(0, Number(popularity ?? 0))) * 250);
}

function failureInfo(failures, kind, key) {
  return failures.get(entityId(kind, key)) ?? failures.get(key) ?? { count: 0, severity: 0, roles: [] };
}

export function classifyCharacter(row) {
  const character = row.character || String.fromCodePoint(Number(row.code_point));
  const generalCategory = unicodeGroup(character);
  const block = String(row.category_key ?? "");
  const hardExcluded = HARD_EXCLUDE_BLOCK_RE.test(block);
  const massScript = MASS_SCRIPT_BLOCK_RE.test(block);
  const preferredLetter = generalCategory === "letter" && PREFERRED_LETTER_BLOCK_RE.test(block);
  const intrinsicallyUseful = ["mark", "number", "punctuation", "symbol", "separator"].includes(
    generalCategory,
  );
  return {
    generalCategory,
    hardExcluded,
    massScript,
    preferredLetter,
    intrinsicallyUseful,
    visualBlock: VISUAL_BLOCK_RE.test(block),
    renderMode: generalCategory === "mark" || /\bCOMBINING\b/i.test(row.name ?? "")
      ? "combining"
      : "standalone",
  };
}

function scoreCharacter(row, meta, failure, seedKeys) {
  const targetKey = String(row.code_point);
  const key = entityId("character", targetKey);
  const reasons = [];
  let tier = 5;
  let score = GROUP_SCORE[meta.generalCategory] ?? 0;

  if (failure.count > 0) {
    tier = 0;
    score += 1_000_000 + failure.count * 20_000 + failure.severity * 5_000;
    reasons.push(`failure:${failure.count}`);
  }
  if (seedKeys.has(key) || seedKeys.has(targetKey)) {
    tier = Math.min(tier, 0);
    score += 900_000;
    reasons.push("failure-seed");
  }
  if ((row.popularity ?? 0) > 0) {
    tier = Math.min(tier, 2);
    score += 20_000 + popularityScore(row.popularity);
    reasons.push("popular");
  }
  if (meta.intrinsicallyUseful) {
    tier = Math.min(tier, 2);
    reasons.push(meta.generalCategory);
  }
  if (meta.visualBlock) {
    tier = Math.min(tier, 2);
    score += 4_000;
    reasons.push("visual-block");
  }
  if (meta.preferredLetter) {
    tier = Math.min(tier, 3);
    score += 3_000;
    reasons.push("searchable-script");
  }
  if (!row.synonyms || !String(row.synonyms).trim()) {
    score += 150;
    reasons.push("alias-gap");
  }

  return { tier, score, reasons };
}

function scoreSequence(row, failure, seedKeys) {
  const targetKey = canonicalEntityKey(row.sequence_key);
  const key = entityId("emoji_sequence", targetKey);
  const reasons = ["emoji-sequence"];
  let tier = 2;
  let score = 30_000 + popularityScore(row.popularity);
  if (failure.count > 0) {
    tier = 0;
    score += 1_000_000 + failure.count * 20_000 + failure.severity * 5_000;
    reasons.push(`failure:${failure.count}`);
  }
  if (seedKeys.has(key) || seedKeys.has(targetKey)) {
    tier = 0;
    score += 900_000;
    reasons.push("failure-seed");
  }
  if ((row.popularity ?? 0) > 0) reasons.push("popular");
  if (!row.synonyms || !String(row.synonyms).trim()) reasons.push("alias-gap");
  return { tier, score, reasons };
}

function entitySort(a, b) {
  return a.selection_tier - b.selection_tier ||
    b.selection_score - a.selection_score ||
    a.kind.localeCompare(b.kind) ||
    a.key.localeCompare(b.key, "en", { numeric: true });
}

function failureMap(records = []) {
  const map = new Map();
  for (const record of records) {
    const targets = [
      { key: record.target_key, kind: record.target_kind },
      ...(record.thief_keys ?? []).map((key) => ({ key, kind: null })),
      ...(record.candidate_keys ?? []).map((key) => ({ key, kind: null })),
    ];
    for (const target of targets) {
      const targetKey = canonicalEntityKey(target.key);
      if (!targetKey) continue;
      const mapKey = target.kind ? entityId(target.kind, targetKey) : targetKey;
      const current = map.get(mapKey) ?? { count: 0, severity: 0, roles: [] };
      current.count += Math.max(1, Number(record.count ?? 1));
      current.severity = Math.max(current.severity, Number(record.severity ?? 1));
      if (targetKey === canonicalEntityKey(record.target_key)) current.roles.push("target");
      else current.roles.push("competitor");
      map.set(mapKey, current);
    }
  }
  return map;
}

function addExploration(selected, pool, capacity) {
  if (capacity <= 0) return;
  const byCategory = new Map();
  for (const entity of pool) {
    if (selected.has(entity.key)) continue;
    const bucket = byCategory.get(entity.category_key) ?? [];
    bucket.push(entity);
    byCategory.set(entity.category_key, bucket);
  }
  for (const bucket of byCategory.values()) bucket.sort(entitySort);
  const categories = [...byCategory.keys()].sort();
  let cursor = 0;
  while (capacity > 0 && categories.length > 0) {
    const index = cursor % categories.length;
    const category = categories[index];
    const bucket = byCategory.get(category);
    const entity = bucket.shift();
    if (entity) {
      entity.selection_reasons.push("category-exploration");
      selected.set(entity.key, entity);
      capacity--;
    }
    if (bucket.length === 0) categories.splice(index, 1);
    else cursor++;
  }
}

export function selectEntities({
  characters,
  sequences,
  failures = [],
  seedKeys = new Set(),
  target = 25_000,
  explorationShare = 0.1,
}) {
  const failuresByKey = failureMap(failures);
  const candidates = [];
  const characterHexes = new Set(
    characters.map((row) => String(row.hex_code ?? Number(row.code_point).toString(16)).toLowerCase().replace(/^0+/, "")),
  );

  for (const row of characters) {
    const targetKey = String(row.code_point);
    const key = entityId("character", targetKey);
    const failure = failureInfo(failuresByKey, "character", targetKey);
    const meta = classifyCharacter(row);
    const forced = failure.count > 0 || seedKeys.has(key) || seedKeys.has(targetKey);
    if (meta.hardExcluded && !forced) continue;
    if (meta.massScript && !forced && !(row.popularity > 0)) continue;
    if (
      !forced &&
      !meta.intrinsicallyUseful &&
      !meta.preferredLetter &&
      !meta.visualBlock &&
      !(row.popularity > 0) &&
      meta.generalCategory !== "letter"
    ) continue;
    const rank = scoreCharacter(row, meta, failure, seedKeys);
    candidates.push({
      key,
      entity_id: key,
      target_key: targetKey,
      kind: "character",
      code_point: row.code_point,
      hex: String(row.hex_code ?? row.code_point.toString(16)).toLowerCase(),
      name: row.name,
      character: row.character,
      category_key: row.category_key,
      popularity: Number(row.popularity ?? 0),
      existing_synonyms: row.synonyms ?? "",
      general_category: meta.generalCategory,
      render_mode: meta.renderMode,
      selection_tier: rank.tier,
      selection_score: rank.score,
      selection_reasons: rank.reasons,
    });
    if (meta.generalCategory === "letter" && !meta.preferredLetter) {
      candidates[candidates.length - 1].selection_reasons.push("exploration-eligible");
    }
  }

  for (const row of sequences) {
    const targetKey = canonicalEntityKey(row.sequence_key);
    // Single-scalar emoji also exist in characters. Generate one authoritative
    // record for the character instead of paying twice for conflicting aliases.
    const presentationBase = presentationOnlySequenceBase(targetKey);
    if (
      (!targetKey.includes("-") && characterHexes.has(targetKey.replace(/^0+/, ""))) ||
      (presentationBase && characterHexes.has(presentationBase))
    ) continue;
    const key = entityId("emoji_sequence", targetKey);
    const rank = scoreSequence(row, failureInfo(failuresByKey, "emoji_sequence", targetKey), seedKeys);
    candidates.push({
      key,
      entity_id: key,
      target_key: targetKey,
      kind: "emoji_sequence",
      code_point: null,
      hex: String(row.hex_sequence ?? key).toLowerCase().replace(/\s+/g, "-"),
      name: row.name,
      character: row.emoji,
      category_key: row.category_key,
      emoji_group: row.emoji_group,
      emoji_subgroup: row.emoji_subgroup,
      popularity: Number(row.popularity ?? 0),
      existing_synonyms: row.synonyms ?? "",
      general_category: "emoji_sequence",
      render_mode: "standalone",
      selection_tier: rank.tier,
      selection_score: rank.score,
      selection_reasons: rank.reasons,
    });
  }

  candidates.sort(entitySort);
  const selected = new Map();
  const explorationSlots = Math.min(
    Math.floor(target * explorationShare),
    Math.max(0, target - candidates.filter((entity) => entity.selection_tier === 0).length),
  );
  const exploitationSlots = Math.max(0, target - explorationSlots);

  for (const entity of candidates) {
    if (selected.size >= exploitationSlots) break;
    selected.set(entity.key, entity);
  }
  addExploration(selected, candidates, Math.min(explorationSlots, target - selected.size));
  if (selected.size < target) {
    for (const entity of candidates) {
      if (selected.size >= target) break;
      selected.set(entity.key, entity);
    }
  }

  const out = [...selected.values()].sort(entitySort).slice(0, target);
  out.forEach((entity, index) => {
    entity.selection_rank = index + 1;
  });
  return {
    selected: out,
    candidates: candidates.length,
    stats: summarizeSelection(out),
  };
}

export function summarizeSelection(entities) {
  const stats = { total: entities.length, byKind: {}, byTier: {}, byGeneralCategory: {} };
  for (const entity of entities) {
    stats.byKind[entity.kind] = (stats.byKind[entity.kind] ?? 0) + 1;
    stats.byTier[entity.selection_tier] = (stats.byTier[entity.selection_tier] ?? 0) + 1;
    stats.byGeneralCategory[entity.general_category] =
      (stats.byGeneralCategory[entity.general_category] ?? 0) + 1;
  }
  return stats;
}
