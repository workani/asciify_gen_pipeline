import { colorSwatch } from './taxonomy-colors.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FAMILIES, assignFamily } from './taxonomy-family.mjs';
import { SUBFAMILIES, NO_SUBFAMILY, assignSubfamily } from './taxonomy-subfamily.mjs';
import { UNICODE_VERSION, UNICODE_DATA_HASH, unicodeCharacter, emojiInfo, sequenceKey } from './unicode-data.mjs';
export { FAMILIES, SUBFAMILIES, NO_SUBFAMILY, UNICODE_VERSION };
// Version both code and data, including JS Script-property behavior, so cached
// model output cannot survive changes to the fixed taxonomy inputs.
export const TAXONOMY_VERSION = 'taxonomy-v1-' + createHash('sha256')
  .update(UNICODE_DATA_HASH).update(process.versions.unicode)
  .update(['taxonomy.mjs', 'taxonomy-family.mjs', 'taxonomy-subfamily.mjs', 'taxonomy-colors.mjs', 'unicode-data.mjs']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')).digest('hex').slice(0, 16);

export function characterMetadata(input) {
  const glyph = typeof input === 'string' ? input : input.character ?? input.glyph ?? input.char;
  if (typeof glyph !== 'string' || glyph.length === 0) throw new Error('Taxonomy requires a nonempty Unicode character or sequence');
  const cps = Array.from(glyph, c => c.codePointAt(0));
  if (typeof input === 'object' && input.target_kind === 'character' && cps.length !== 1) throw new Error('Character entity must contain exactly one code point');
  if (typeof input === 'object' && input.code_point != null && (cps.length !== 1 || input.code_point !== cps[0])) throw new Error('Taxonomy code point and character disagree');
  if (cps.length === 1) return unicodeCharacter(cps[0]);
  const info = emojiInfo(cps);
  // Variation selectors change presentation, not the base Unicode identity.
  if (cps.length === 2 && [0xFE0E, 0xFE0F].includes(cps[1])) {
    return { ...unicodeCharacter(cps[0]), sequence: true, char: glyph, hex: sequenceKey(cps), emojiInfo: info ?? emojiInfo([cps[0]]) };
  }
  return { sequence: true, char: glyph, hex: sequenceKey(cps), gc: null, block: null,
    name: info?.name ?? '', upperName: info?.name.toUpperCase() ?? '', emojiInfo: info, extendedPictographic: false };
}
function knownSubfamilyGap(c, family, subfamily) {
  if (subfamily !== null) return null;
  if (family === 'letter' && /^L/.test(c.gc ?? '') && !/[\p{Script=Common}\p{Script=Inherited}]/u.test(String.fromCodePoint(c.cp))) return 'script-outside-enum';
  if (family === 'shape' && /\b(?:RECTANGLE|PENTAGON|HEXAGON|PARALLELOGRAM|SALTIRE|ARC)\b/.test(c.upperName.split(' WITH ')[0])) return 'shape-outside-enum';
  if (family === 'arrow' && /CLOCKWISE|\bLEFT RIGHT\b|\bUP DOWN\b|\bLEFT BARB\b.*\bRIGHT BARB\b|\bUP BARB\b.*\bDOWN BARB\b/.test(c.upperName)) return 'direction-outside-enum';
  if (family === 'punctuation' && /^(?:(?:FULLWIDTH|SMALL) )?(?:AMPERSAND|NUMBER SIGN|COMMERCIAL AT|(?:REVERSE )?SOLIDUS|PERCENT SIGN|PER MILLE SIGN|PER TEN THOUSAND SIGN)$/.test(c.upperName)) return 'punctuation-outside-enum';
  return null;
}
export function resolveTaxonomy(input) {
  const c = characterMetadata(input);
  const { family, familyBasis } = assignFamily(c);
  const { subfamily, basis } = assignSubfamily(c, family);
  const style = family === 'letter' && c.block === 'Mathematical Alphanumeric Symbols'
    ? c.upperName.match(/^MATHEMATICAL (.+?) (?:CAPITAL|SMALL|DOTLESS|EPSILON|THETA|KAPPA|PHI|RHO|PI)/)?.[1]?.toLowerCase() ?? null : null;
  const properties = style ? [{ key: 'script_style', values: [style], basis: 'identity', attachments: [], evidence: 'Style specified by the Unicode character name.' }] : [];
  const swatch = colorSwatch(c);
  if (swatch) properties.push({ key: 'color', values: [swatch.color], basis: 'identity', attachments: [], evidence: 'Color specified by the official emoji-test swatch identity.' });
  return { version: TAXONOMY_VERSION, unicode_version: UNICODE_VERSION, family, family_basis: familyBasis,
    subfamily, subfamily_basis: basis, subfamily_gap: knownSubfamilyGap(c, family, subfamily), allowed_subfamilies: SUBFAMILIES[family] ?? null,
    properties, collection_ids: swatch ? ["colors"] : [] };
}
