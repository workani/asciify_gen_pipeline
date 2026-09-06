// One ordered [predicate, family] list. Names are evidence of the encoded
// identity, not bag-of-words tags. Uncertain identities fall through unchanged.
export const FAMILIES = Object.freeze([
  'arrow', 'emoji', 'letter', 'digit', 'punctuation', 'math', 'currency', 'shape',
  'box-drawing', 'bullet', 'whitespace-control', 'misc-symbol',
]);
const MATH = new Set(['Mathematical Operators', 'Supplemental Mathematical Operators', 'Miscellaneous Mathematical Symbols-A', 'Miscellaneous Mathematical Symbols-B']);
const SHAPES = new Set(['Geometric Shapes', 'Geometric Shapes Extended']);
const BOXES = new Set(['Box Drawing', 'Block Elements']);
const SHAPE_HEADS = new Set(['CIRCLE', 'SQUARE', 'TRIANGLE', 'DIAMOND', 'STAR', 'LOZENGE', 'HEXAGON', 'PENTAGON', 'RECTANGLE']);
const SHAPE_NAME_BLOCKS = new Set(['Dingbats', 'Ornamental Dingbats', 'Miscellaneous Symbols', 'Miscellaneous Symbols and Arrows', 'Miscellaneous Technical', 'Symbols for Legacy Computing', 'Symbols for Legacy Computing Supplement']);
const EMOJI_EXCLUDED = new Set([0x00A9, 0x00AE, 0x2122]);
const isSymbol = c => /^S/.test(c.gc ?? '');
export function nameHead(name) {
  // UP-POINTING is an adjective, not a standalone trailing clause.
  return name.toUpperCase().replace(/\s+(?:WITH|POINTING|POINTED)\b.*$/, '').trim();
}
export function headNoun(name) { return nameHead(name).split(/\s+/).at(-1) ?? ''; }
export function isHeartIdentity(c) {
  if (c.emojiInfo?.subgroup === 'heart' && c.emojiInfo.name !== 'love letter') return true;
  return isSymbol(c) && /\bHEART(?: SUIT| BULLET)?$/.test(nameHead(c.upperName));
}
export function isCardSuitIdentity(c) {
  return isSymbol(c) && /^(?:BLACK|WHITE) (?:SPADE|HEART|DIAMOND|CLUB) SUIT$/.test(c.upperName);
}
function isArrow(c) {
  if (!isSymbol(c) || c.block === 'Sutton SignWriting' || /^MODIFIER LETTER\b/.test(c.upperName)) return false;
  // A bow-and-arrow weapon, heart pierced by an arrow, or person scene is not
  // a standalone directional arrow. Official subgroup is stronger evidence.
  if (c.emojiInfo && c.emojiInfo.subgroup !== 'arrow') return false;
  const head = nameHead(c.upperName);
  if (/\b(?:SHAFT|FUNCTIONAL|SYMBOL|SIGNWRITING)\b/.test(head)) return false;
  if (/^(?:SUBSET|SUPERSET|EQUALS|MEASURED ANGLE|RIGHT ANGLE|ANGLE|EMPTY SET|INTEGRAL)\b/.test(head)) return false;
  return /\b(?:ARROWS?|ARROWHEADS?|HARPOONS?)\b/.test(head);
}
function isListBullet(c) {
  // Unicode's standalone typographic list markers. Sm bullet operators retain
  // their mathematical identity. HEART ornaments already match the heart rule.
  return ['Po', 'So'].includes(c.gc) && /^(?:(?:BLACK (?:LEFTWARDS|RIGHTWARDS)|WHITE|INVERSE|TRIANGULAR|HYPHEN) )?BULLET$/.test(c.upperName);
}
function isNamedMath(c) {
  return isSymbol(c) && /^(?:(?:HEAVY|FULLWIDTH|SMALL) )?(?:PLUS SIGN|MINUS SIGN|MULTIPLICATION SIGN|DIVISION SIGN|EQUALS SIGN)$/.test(nameHead(c.upperName));
}
function isShape(c) {
  if (!isSymbol(c) || MATH.has(c.block) || isNamedMath(c)) return false;
  if (SHAPES.has(c.block)) return true;
  if (!SHAPE_NAME_BLOCKS.has(c.block) && c.emojiInfo?.subgroup !== 'geometric') return false;
  const head = nameHead(c.upperName);
  // A shape used as an enclosure/operand/notation component is not the identity.
  if (/\b(?:SIGN|SYMBOL|LETTER|NUMBER|DIGIT|CUP|FOOT|INDICATOR|POSITION|NOTE|MUSICAL|APL|SIGNWRITING|CJK|IDEOGRAPH|DENTISTRY|IN|ON)\b/.test(head)) return false;
  return SHAPE_HEADS.has(headNoun(head));
}
function isLetter(c) {
  if (/^L/.test(c.gc ?? '')) return true;
  // Only names encoding an enclosed alphabetic character. LOVE LETTER,
  // INPUT SYMBOL FOR LATIN LETTERS, and combining letter marks do not qualify.
  return c.gc === 'So' && /^(?:(?:NEGATIVE|CIRCLED|PARENTHESIZED|SQUARED|DOUBLE-CIRCLED) )+(?:LATIN|GREEK|CYRILLIC|HEBREW|ARABIC) (?:CAPITAL |SMALL )?LETTER\b/.test(c.upperName);
}
export const FAMILY_RULES = Object.freeze([
  [c => /^(?:Cc|Cf|Zs|Zl|Zp)$/.test(c.gc), 'whitespace-control'],
  [isArrow, 'arrow'],
  [c => isHeartIdentity(c) || isCardSuitIdentity(c), 'emoji'],
  [c => isSymbol(c) && (BOXES.has(c.block) || /^BOX DRAWINGS\b/.test(c.upperName)), 'box-drawing'],
  [isListBullet, 'bullet'],
  [isNamedMath, 'math'],
  [isShape, 'shape'],
  [isLetter, 'letter'],
  [c => /^(?:Nd|No)$/.test(c.gc), 'digit'],
  // EP is defined on code points. Exact official emoji sequences admit flags,
  // keycaps and ZWJ forms. Arbitrary concatenated emoji/text does not qualify.
  [c => !EMOJI_EXCLUDED.has(c.cp) && (c.extendedPictographic || (c.sequence && c.emojiInfo && c.emojiInfo.status !== 'component')), 'emoji'],
  [c => c.gc === 'Sc', 'currency'],
  [c => c.gc === 'Sm' || (isSymbol(c) && MATH.has(c.block)), 'math'],
  [c => /^P/.test(c.gc), 'punctuation'],
  [isSymbol, 'misc-symbol'],
  [() => true, 'unknown'],
].map(pair => Object.freeze(pair)));
export function assignFamily(c) {
  const index = FAMILY_RULES.findIndex(([predicate]) => predicate(c));
  const family = FAMILY_RULES[index][1];
  return { family, familyBasis: family === 'unknown' ? null : `rule-${index + 1}` };
}
