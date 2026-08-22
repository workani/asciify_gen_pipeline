import { DatabaseSync } from "node:sqlite";
import { config } from "./config.mjs";
import { upsertEntities } from "./state.mjs";
import { emit } from "./log.mjs";
import { entityId } from "./normalize.mjs";

const cp = (hex) => parseInt(hex, 16);

function lookupRef(hex) {
  try {
    const ref = new DatabaseSync(config.refDb, { readOnly: true });
    if (hex.includes("-")) {
      const r = ref.prepare("SELECT name, emoji AS character FROM emoji_sequences WHERE sequence_key = ?").get(hex);
      ref.close();
      return r ?? null;
    }
    const c = cp(hex);
    const r = ref.prepare("SELECT name, character FROM characters WHERE code_point = ?").get(c);
    ref.close();
    return r ?? null;
  } catch {
    return null;
  }
}

export const THIEF_PAIRS = [
  { query: "greek flag", victim: "1f1ec-1f1f7", thief: "1f6a1" },
  { query: "red cross symbol", victim: "2720", thief: "1f534" },
  { query: "hamburger menu icon", victim: "2630", thief: "1f354" },
  { query: "smiling cat", victim: "1f63a", thief: "1f408" },
  { query: "middle finger", victim: "1f595", thief: "1f596" },
  { query: "earth planet", victim: "1f30d", thief: "2641" },
  { query: "mars planet", victim: "2642", thief: "2641" },
  { query: "yellow star", victim: "2b50", thief: "1f4ab" },
  { query: "french a", victim: "00e0", thief: "1f35f" },
  { query: "billed cap", victim: "1f9e2", thief: "1f3d4" },
  { query: "billed cap", victim: "1f9e2", thief: "22c2" },
  { query: "cookie", victim: "1f36a", thief: "1f353" },
  { query: "shaka surf hand", victim: "1f919", thief: "1f590" },
  { query: "settings icon", victim: "2699", thief: "1f39a" },
  { query: "polish currency", victim: "0142", thief: "1f485" },
  { query: "at sign", victim: "0040", thief: "1f690" },
  { query: "esset german b", victim: "00df", thief: "2200" },
  { query: "question mark outline", victim: "2754", thief: "003f" },
  { query: "therefore symbol three dots triangle", victim: "2234", thief: "23ef" },
  { query: "section symbol lawyers", victim: "00a7", thief: "00a9" },
  { query: "hammer and sickle", victim: "262d", thief: "2692" },
  { query: "chess horse piece", victim: "265e", thief: "1fa7a" },
];

export const P0_TARGETS = [
  ["2630", "TRIGRAM FOR HEAVEN"],
  ["2720", "MALTESE CROSS"],
  ["2695", "STAFF OF AESCULAPIUS"],
  ["1f595", "REVERSED HAND WITH MIDDLE FINGER EXTENDED"],
  ["5350", "SWASTIKA"],
  ["534d", "LEFTWARDS SWASTIKA"],
  ["16d2", "RUNIC LETTER BERKANAN BEORC BJARKAN B"],
  ["2699", "GEAR"],
  ["2139", "INFORMATION SOURCE"],
  ["265e", "BLACK CHESS KNIGHT"],
  ["1f451", "CROWN"],
  ["2654", "WHITE CHESS KING"],
  ["2642", "MALE SIGN"],
  ["1f9ff", "NAZAR AMULET"],
  ["1f515", "BELL WITH CANCELLATION STROKE"],
  ["00bf", "INVERTED QUESTION MARK"],
  ["0040", "COMMERCIAL AT"],
  ["00df", "LATIN SMALL LETTER SHARP S"],
  ["00e0", "LATIN SMALL LETTER A WITH GRAVE"],
  ["2754", "WHITE QUESTION MARK ORNAMENT"],
  ["0142", "LATIN SMALL LETTER L WITH STROKE"],
  ["20b4", "HRYVNIA SIGN"],
  ["0457", "CYRILLIC SMALL LETTER YI"],
  ["00b6", "PILCROW SIGN"],
  ["00a7", "SECTION SIGN"],
  ["27e6", "MATHEMATICAL LEFT WHITE SQUARE BRACKET"],
  ["27e7", "MATHEMATICAL RIGHT WHITE SQUARE BRACKET"],
  ["220c", "DOES NOT CONTAIN AS MEMBER"],
  ["2203", "THERE EXISTS"],
  ["229e", "SQUARED PLUS"],
  ["1f9e2", "BILLED CAP"],
  ["2b50", "WHITE MEDIUM STAR"],
  ["1f976", "COLD FACE"],
  ["1f4cd", "ROUND PUSHPIN"],
  ["1f5b1", "MOUSE"],
  ["222e", "CONTOUR INTEGRAL"],
  ["262d", "HAMMER AND SICKLE"],
  ["1fae9", "FACE WITH BAGS UNDER EYES"],
  ["2299", "CIRCLED DOT OPERATOR"],
  ["0259", "LATIN SMALL LETTER SCHWA"],
  ["1f382", "BIRTHDAY CAKE"],
  ["2234", "THEREFORE"],
  ["2014", "EM DASH"],
  ["00d7", "MULTIPLICATION SIGN"],
  ["00b7", "MIDDLE DOT"],
  ["00b0", "DEGREE SIGN"],
  ["2029", "PARAGRAPH SEPARATOR"],
  ["2800", "BRAILLE PATTERN BLANK"],
  ["1f63a", "SMILING CAT FACE WITH OPEN MOUTH"],
  ["1f63b", "SMILING CAT FACE WITH HEART-SHAPED EYES"],
  ["1f63c", "CAT WITH WRY SMILE"],
  ["1f63e", "POUTING CAT FACE"],
  ["1f36a", "COOKIE"],
  ["1f355", "SLICE OF PIZZA"],
  ["1f919", "CALL ME HAND"],
  ["1f30d", "EARTH GLOBE EUROPE-AFRICA"],
  ["2641", "EARTH"],
  ["1f596", "VULCAN SALUTE"],
  ["1f6a1", "TRIANGULAR FLAG ON POST"],
  ["1f534", "LARGE RED CIRCLE"],
  ["1f354", "HAMBURGER"],
  ["1f408", "CAT"],
  ["1f4ab", "DIZZY"],
  ["1f35f", "FRENCH FRIES"],
  ["1f3d4", "SNOW-CAPPED MOUNTAIN"],
  ["22c2", "N-ARY INTERSECTION"],
  ["1f353", "STRAWBERRY"],
  ["1f590", "RAISED HAND WITH FINGERS SPLAYED"],
  ["1f39a", "LEVEL SLIDER"],
  ["1f485", "NAIL POLISH"],
  ["1f690", "MINIBUS"],
  ["2124", "DOUBLE-STRUCK CAPITAL Z"],
  ["266d", "MUSIC FLAT SIGN"],
  ["2200", "FOR ALL"],
  ["003f", "QUESTION MARK"],
  ["23ef", "PAUSE BUTTON"],
  ["00a9", "COPYRIGHT"],
  ["2692", "HAMMER AND PICK"],
  ["1fa7a", "XIANGQI HORSE"],
];

export const SEQUENCE_TARGETS = [
  ["1f1ec-1f1f7", "FLAG: GREECE"],
  ["2764-fe0f-200d-1f525", "HEART ON FIRE"],
  ["1f642-200d-2194-fe0f", "HEAD SHAKING HORIZONTALLY"],
  ["1fae8", "SHAKING FACE"],
  ["1f9d1-200d-2695-fe0f", "HEALTH WORKER"],
];

export function loadSeeds() {
  const rows = [];
  const all = [...P0_TARGETS.map(([hex, name]) => [hex, name]), ...SEQUENCE_TARGETS];
  for (const [hex, fallbackName] of all) {
    const isSeq = hex.includes("-");
    const refRow = lookupRef(hex);
    const key = isSeq ? hex : String(cp(hex));
    if (!isSeq && !Number.isFinite(cp(hex))) continue;
    rows.push({
      key,
      kind: isSeq ? "emoji_sequence" : "character",
      code_point: isSeq ? null : cp(hex),
      hex,
      name: refRow?.name ?? fallbackName,
      character: refRow?.character ?? "",
      category_key: null,
      popularity: 9999,
      priority: 0,
    });
  }
  upsertEntities(rows);
  emit("seeds", { p0Targets: rows.length, thiefPairs: THIEF_PAIRS.length });
  return rows.length;
}

export function seedEntityIds() {
  const ids = new Set();
  for (const [hex] of P0_TARGETS) ids.add(entityId("character", String(parseInt(hex, 16))));
  for (const [key] of SEQUENCE_TARGETS) {
    ids.add(key.includes("-") ? entityId("emoji_sequence", key) : entityId("character", String(parseInt(key, 16))));
  }
  for (const pair of THIEF_PAIRS) {
    for (const hex of [pair.victim, pair.thief]) {
      ids.add(hex.includes("-") ? entityId("emoji_sequence", hex) : entityId("character", String(parseInt(hex, 16))));
    }
  }
  return ids;
}
