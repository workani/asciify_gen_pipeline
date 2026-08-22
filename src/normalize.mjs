import { createHash } from "node:crypto";

const GENERIC_ONLY_RE = /^(?:character|glyph|icon|letter|mark|sign|symbol|unicode)$/;
const CONTENT_STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
  "capital", "small", "letter", "sign", "symbol", "emoji", "character",
]);

export function normalizeTerm(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhrase(value, { maxWords = 10, maxLength = 100 } = {}) {
  const display = String(value ?? "")
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'`.,;:!?()[\]{}]+|[\s"'`.,;:!?()[\]{}]+$/g, "")
    .trim();
  const normalized = normalizeTerm(display);
  if (!normalized || normalized.length < 2 || normalized.length > maxLength) return null;
  if (normalized.split(" ").length > maxWords) return null;
  if (GENERIC_ONLY_RE.test(normalized)) return null;
  return { display, normalized };
}

const IDENTITY_EXCLUSIONS = [
  [["acute"], ["grave"]],
  [["left", "leftward", "leftwards"], ["right", "rightward", "rightwards"]],
  [["up", "upward", "upwards"], ["down", "downward", "downwards"]],
  [["above"], ["below"]],
  [["clockwise"], ["anticlockwise", "counterclockwise"]],
  [["horizontal"], ["vertical"]],
];

export function claimContradictsFormalIdentity(entity, phrase) {
  const name = new Set(normalizeTerm(entity?.name).split(" ").filter(Boolean));
  const claim = new Set(normalizeTerm(phrase).split(" ").filter(Boolean));
  if (!name.size || !claim.size) return false;
  const hasAny = (tokens, alternatives) => alternatives.some((token) => tokens.has(token));
  return IDENTITY_EXCLUSIONS.some(([left, right]) =>
    (hasAny(name, left) && !hasAny(name, right) && hasAny(claim, right)) ||
    (hasAny(name, right) && !hasAny(name, left) && hasAny(claim, left)));
}

export function contentTokens(value) {
  return normalizeTerm(value)
    .split(" ")
    .filter((token) => token.length > 1 && !CONTENT_STOPWORDS.has(token));
}

export function canonicalEntityKey(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw
    .replace(/^u\+/, "")
    .replace(/[ _]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function entityId(kind, targetKey) {
  const normalizedKind = kind === "emoji_sequence" ? "emoji_sequence" : "character";
  return `${normalizedKind}:${canonicalEntityKey(targetKey)}`;
}

/**
 * Identity of the pixels requested from the renderer. VS15/VS16 are omitted
 * because every single-glyph page explicitly requests emoji presentation;
 * keeping both the base scalar and base+FE0F in one candidate set therefore
 * presents the model with the same glyph twice under different entity ids.
 */
export function visualEntityKey(entity) {
  const glyph = String(entity?.character ?? "").replace(/[\ufe0e\ufe0f]/gu, "");
  if (!glyph) return "";
  return `${entity?.render_mode ?? "standalone"}:${[...glyph]
    .map((character) => character.codePointAt(0).toString(16))
    .join("-")}`;
}

export function uniqueVisualEntities(entities) {
  const seenIds = new Set();
  const seenVisuals = new Set();
  return (entities ?? []).filter((entity) => {
    if (!entity?.entity_id || seenIds.has(entity.entity_id)) return false;
    const visualKey = visualEntityKey(entity);
    if (visualKey && seenVisuals.has(visualKey)) return false;
    seenIds.add(entity.entity_id);
    if (visualKey) seenVisuals.add(visualKey);
    return true;
  });
}

export function presentationOnlySequenceBase(value) {
  const parts = canonicalEntityKey(value).split("-").filter(Boolean);
  const visible = parts.filter((part) => !["fe0e", "fe0f"].includes(part));
  return visible.length === 1 && visible.length < parts.length
    ? visible[0].replace(/^0+(?=[0-9a-f])/i, "")
    : null;
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function contentHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function unicodeGroup(character) {
  if (/^\p{Letter}$/u.test(character)) return "letter";
  if (/^\p{Mark}$/u.test(character)) return "mark";
  if (/^\p{Number}$/u.test(character)) return "number";
  if (/^\p{Punctuation}$/u.test(character)) return "punctuation";
  if (/^\p{Symbol}$/u.test(character)) return "symbol";
  if (/^\p{Separator}$/u.test(character)) return "separator";
  return "other";
}

export function isCombiningEntity(entity) {
  return entity.general_category === "mark" || /\bCOMBINING\b/i.test(entity.name ?? "");
}
