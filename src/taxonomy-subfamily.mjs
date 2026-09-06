import { headNoun, isHeartIdentity, isCardSuitIdentity } from './taxonomy-family.mjs';
// Subfamily assignment. Closed enum scoped to each family, one axis per family.
// Rules use the official Unicode names. Within each family the first match wins,
// so specific patterns sit above general ones.
export const SUBFAMILIES = Object.freeze(Object.fromEntries(Object.entries({
  arrow: ["right", "left", "up", "down", "diagonal"],
  emoji: ["face", "hand", "heart", "animal", "food", "flag", "object", "card-suit"],
  shape: ["circle", "square", "triangle", "diamond", "star"],
  letter: ["latin", "greek", "cyrillic", "hebrew", "arabic"],
  math: ["operator", "relation", "set", "logic"],
  punctuation: ["quote", "dash", "bracket", "terminal", "annotation"],
  bullet: ["dot", "dash", "arrowhead", "checkmark"],
}).map(([family, values]) => [family, Object.freeze(values)])));

// Families with no subfamily axis: digit, currency, box-drawing, whitespace-control,
// misc-symbol. Subfamily stays null for those — code does not assign, model is not asked.
export const NO_SUBFAMILY = Object.freeze(["digit", "currency", "box-drawing", "whitespace-control", "misc-symbol"]);

// Returns the value whose pattern matches earliest in the string. Unicode names put the
// head noun before its modifiers ("BLACK UP-POINTING TRIANGLE"), so leftmost wins.
function earliest(name, candidates) {
  let best = null;
  for (const [value, pattern] of candidates) {
    const match = name.match(pattern);
    if (match && (best === null || match.index < best.index)) best = { value, index: match.index };
  }
  return best?.value ?? null;
}

// ---------------------------------------------------------------- arrow
// Everything after " WITH " is a modifier, not the arrow's direction:
// "LEFTWARDS HARPOON WITH BARB UPWARDS" points left, not up.
const ARROW_DIAGONAL = /\bNORTH[ -]?EAST\b|\bNORTH[ -]?WEST\b|\bSOUTH[ -]?EAST\b|\bSOUTH[ -]?WEST\b|\b(UP(?:WARDS)?|DOWN(?:WARDS)?) AND (RIGHT(?:WARDS)?|LEFT(?:WARDS)?)\b|\b(RIGHT(?:WARDS)?|LEFT(?:WARDS)?) AND (UP(?:WARDS)?|DOWN(?:WARDS)?)\b|\bDIAGONAL\b/;
// Bidirectional and rotational arrows have no value on a single-direction axis.
const ARROW_BIDIRECTIONAL = /\bLEFT RIGHT\b|\bUP DOWN\b/;
const ARROW_ROTATIONAL = /CLOCKWISE/;
const ARROW_DIRECTIONS = [
  ["right", /\bRIGHTWARDS\b|\bEASTWARDS\b|\bRIGHT\b|\bEAST\b/],
  ["left", /\bLEFTWARDS\b|\bWESTWARDS\b|\bLEFT\b|\bWEST\b/],
  ["up", /\bUPWARDS\b|\bNORTHWARDS\b|\bUP\b|\bNORTH\b/],
  ["down", /\bDOWNWARDS\b|\bSOUTHWARDS\b|\bDOWN\b|\bSOUTH\b/],
];

function arrowSubfamily(name) {
  const head = name.split(" WITH ")[0];
  if (/\bLEFT BARB\b.*\bRIGHT BARB\b|\bUP BARB\b.*\bDOWN BARB\b/.test(head)) return null;
  if (ARROW_ROTATIONAL.test(head) || ARROW_BIDIRECTIONAL.test(head)) return null;
  // Multiple arrow heads / opposing directions are not one diagonal direction.
  if (/\b(?:ARROWS|HARPOONS)\b/.test(head) && new Set(head.match(/LEFT|RIGHT|UP|DOWN|NORTH|SOUTH|EAST|WEST/g)).size > 1) return null;
  if (ARROW_DIAGONAL.test(head)) return "diagonal";
  if (/\b(?:LEFTWARDS|RIGHTWARDS|UPWARDS|DOWNWARDS)\b.*\b(?:LEFTWARDS|RIGHTWARDS|UPWARDS|DOWNWARDS)\b/.test(head)) return null;
  const tip = name.match(/\bWITH (?:LONG )?TIP (LEFTWARDS|RIGHTWARDS|UPWARDS|DOWNWARDS)\b/);
  if (tip) return earliest(tip[1], ARROW_DIRECTIONS);
  // Decoration before the head noun (LEFT-SHADED RIGHTWARDS) is not direction.
  return earliest(head.replace(/\b(?:LEFT|RIGHT|UPPER|LOWER)[ -]SHADED\b/g, ""), ARROW_DIRECTIONS);
}

// ---------------------------------------------------------------- shape
const SHAPE_KEYWORDS = [
  ["circle", /\bCIRCLE\b|\bFISHEYE\b|\bBULLSEYE\b|\bCIRCULAR\b/],
  ["square", /\bSQUARE\b/],
  ["triangle", /\bTRIANGLE\b/],
  ["diamond", /\bDIAMOND\b|\bLOZENGE\b|\bRHOMBUS\b/],
  ["star", /\bSTAR\b|\bASTERISK\b/],
];
const shapeSubfamily = (name) => {
  const noun = headNoun(name);
  if (["CIRCLE", "SQUARE", "TRIANGLE", "DIAMOND", "STAR"].includes(noun)) return noun.toLowerCase();
  if (noun === "LOZENGE") return "diamond";
  const head = name.replace(/\s+(?:WITH|POINTING|POINTED)\b.*$/, "");
  if (/\b(?:ARC|QUADRANT|RECTANGLE|HEXAGON|PENTAGON|PARALLELOGRAM|SECTOR)\b/.test(head)) return null;
  return earliest(head, SHAPE_KEYWORDS);
};

// ---------------------------------------------------------------- math
// Set and logic are checked before broad relation and operator names.
const MATH_SET = /\bSUBSET\b|\bSUPERSET\b|\bELEMENT OF\b|\bUNION\b|\bINTERSECTION\b|\bEMPTY SET\b|\bCONTAINS AS MEMBER\b|\bMEMBERSHIP\b/;
const MATH_LOGIC = /\bLOGICAL\b|\bFOR ALL\b|\bTHERE EXISTS\b|\bTACK\b|\bTHEREFORE\b|\bBECAUSE\b|\bTURNSTILE\b|\bMODELS\b|\bASSERTION\b/;
const MATH_RELATION = /\bEQUAL\b|\bEQUALS\b|\bLESS-THAN\b|\bGREATER-THAN\b|\bEQUIVALENT\b|\bIDENTICAL\b|\bCONGRUENT\b|\bPRECEDES\b|\bSUCCEEDS\b|\bPARALLEL\b|\bPERPENDICULAR\b|\bPROPORTIONAL\b|\bSIMILAR\b|\bTILDE OPERATOR\b|\bRELATION\b|\bDIVIDES\b|\bLESS-THAN\b|\bGREATER-THAN\b/;
const MATH_OPERATOR = /\bPLUS\b|\bMINUS\b|\bTIMES\b|\bDIVISION\b|\bMULTIPLICATION\b|\bN-ARY\b|\bINTEGRAL\b|\bSUMMATION\b|\bPRODUCT\b|\bOPERATOR\b|\bRADICAL\b|\b(?:SQUARE|CUBE|FOURTH) ROOT\b|\bPARTIAL DIFFERENTIAL\b|\bNABLA\b/;

function mathSubfamily(name) {
  name = name.split(" WITH ")[0];
  if (MATH_SET.test(name)) return "set";
  if (MATH_LOGIC.test(name)) return "logic";
  if (MATH_RELATION.test(name)) return "relation";
  if (MATH_OPERATOR.test(name)) return "operator";
  return null;
}

// ---------------------------------------------------------------- punctuation
// Driven by Unicode names only. Bracket outranks quote because
// CJK corner brackets (U+300C) carry Quotation_Mark=Yes but are named and shaped as brackets.
// Sentence-ending marks that Unicode does not flag as Terminal_Punctuation, because the
// property marks where a sentence ends: ¡ and ¿ open one, and several script marks are unflagged.
const TERMINAL_NAME = /\bEXCLAMATION\b|\bQUESTION\b|\bCOMMA\b|\bFULL STOP\b|\bPERIOD\b|\bCOLON\b|\bSEMICOLON\b|\bDANDA\b|\bINTERROBANG\b/;

function punctuationSubfamily(char) {
  const name = char.upperName;
  // Editorial reference markers; mathematical operators and ornamental stars
  // have already been assigned other families and do not enter this rule.
  if (/\b(?:REFERENCE MARK|DAGGER|ASTERISKS?|SECTION SIGN|PILCROW SIGN|ASTERISM)\b/.test(name)) return "annotation";
  if (/\b(?:BRACKET|PARENTHESIS|PARENTHESES|BRACE)\b/.test(name)) return "bracket";
  if (/\b(?:QUOTATION MARK|APOSTROPHE|GUILLEMET)\b/.test(name)) return "quote";
  if (/\b(?:DASH|HYPHEN)\b/.test(name)) return "dash";
  if (TERMINAL_NAME.test(name) || /\bELLIPSIS\b/.test(name)) return "terminal";
  return null;
}

// ---------------------------------------------------------------- bullet
const BULLET_RULES = [
  ["checkmark", /\bCHECK MARK\b/],
  ["arrowhead", /\bARROWHEAD\b/],
  ["dash", /\bHYPHEN\b|\bDASH\b/],
  ["dot", /^(?:(?:CIRCLED (?:WHITE )?|INVERSE |WHITE |BLACK )?BULLET(?: OPERATOR)?)$|\b(?:DOT|DOT LEADER)\b/],
];
function bulletSubfamily(name) {
  for (const [value, pattern] of BULLET_RULES) if (pattern.test(name)) return value;
  return null;
}

// ---------------------------------------------------------------- letter
const SCRIPTS = [
  ["latin", /\p{Script=Latin}/u], ["greek", /\p{Script=Greek}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u], ["hebrew", /\p{Script=Hebrew}/u], ["arabic", /\p{Script=Arabic}/u],
];
function letterSubfamily(char) {
  // Explicit product taxonomy convention for styled mathematical letters.
  // Category still wins: mathematical digits remain digit and operators math.
  if (char.block === "Mathematical Alphanumeric Symbols") return "latin";
  const direct = SCRIPTS.find(([, pattern]) => pattern.test(char.char))?.[0];
  if (direct) return direct;
  // Enclosed/styled letters often have Script=Common. Test their official
  // decomposition with the same Script escapes; never normalize the source glyph.
  const decomposition = char.decomposition?.replace(/<[^>]+>\s*/, '').trim();
  const namedLatin = char.upperName.match(/\bLATIN (?:CAPITAL|SMALL) LETTER ([A-Z])$/)?.[1];
  if (!decomposition && !namedLatin) return null;
  const base = decomposition ? decomposition.split(/\s+/).map(hex => String.fromCodePoint(parseInt(hex, 16))).join('') : namedLatin;
  return SCRIPTS.find(([, pattern]) => pattern.test(base))?.[0] ?? null;
}

// ---------------------------------------------------------------- emoji
// emoji-test.txt group/subgroup -> enum. Subgroup is checked before group so that
// "heart" and the cat/monkey faces split correctly out of Smileys & Emotion.
const EMOJI_SUBGROUP = new Map([
  // Only the "heart" subgroup is hearts. "emotion" holds 💫 💢 💤 💨, which are not.
  ["heart", "heart"],
  ["hand-fingers-open", "hand"], ["hand-fingers-partial", "hand"], ["hand-single-finger", "hand"],
  ["hand-fingers-closed", "hand"], ["hands", "hand"], ["hand-prop", "hand"],
  ["animal-mammal", "animal"], ["animal-bird", "animal"], ["animal-amphibian", "animal"],
  ["animal-reptile", "animal"], ["animal-marine", "animal"], ["animal-bug", "animal"],
  ["food-fruit", "food"], ["food-vegetable", "food"], ["food-prepared", "food"],
  ["food-asian", "food"], ["food-sweet", "food"], ["drink", "food"], ["dishware", "object"],
  ["flag", "flag"], ["country-flag", "flag"], ["subdivision-flag", "flag"],
]);

// Official groups are organizational, not an assertion that every member is
// an instance of our narrower enum. These identities need explicit exceptions.
const EMOJI_IDENTITY_OVERRIDES = new Map([
  ['love letter', 'object'], ['spider web', 'object'],
  ['paw prints', null], ['pig nose', null], ['microbe', null],
  ['pile of poo', null], ['alien monster', null], ['bowl with spoon', null],
]);
function emojiSubfamily(char) {
  // A heart suit remains a card suit, including text/emoji presentation forms.
  if (isCardSuitIdentity(char)) return "card-suit";
  if (EMOJI_IDENTITY_OVERRIDES.has(char.emojiInfo?.name)) return EMOJI_IDENTITY_OVERRIDES.get(char.emojiInfo.name);
  const subgroup = char.emojiInfo?.subgroup;
  const group = char.emojiInfo?.group;
  if (subgroup && EMOJI_SUBGROUP.has(subgroup)) return EMOJI_SUBGROUP.get(subgroup);
  if (subgroup?.startsWith("face-") || subgroup === "cat-face" || subgroup === "monkey-face") return "face";
  if (group === "Objects") return "object";
  if (isHeartIdentity(char)) return "heart";
  return null;
}

export function assignSubfamily(char, family) {
  const subfamily = ({
    arrow: () => arrowSubfamily(char.upperName), shape: () => shapeSubfamily(char.upperName),
    math: () => mathSubfamily(char.upperName), punctuation: () => punctuationSubfamily(char),
    bullet: () => bulletSubfamily(char.upperName), letter: () => letterSubfamily(char),
    emoji: () => emojiSubfamily(char),
  })[family]?.() ?? null;
  return { subfamily, basis: subfamily === null ? null : "unicode" };
}
