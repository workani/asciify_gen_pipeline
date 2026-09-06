import { test } from "node:test";
import assert from "node:assert/strict";
import { selectEntities, generationGroup } from "../src/selection.mjs";

const character = (code_point, hex_code, name, category_key, character, popularity = 0) => ({
  code_point, hex_code, name, category_key, character, popularity, synonyms: "",
});

test("selection is deterministic, family-first, and deduplicates scalar emoji sequences", () => {
  const characters = [
    character(9654, "25B6", "BLACK RIGHT-POINTING TRIANGLE", "geometric-shapes", "▶", 418),
    character(10148, "27A4", "BLACK RIGHTWARDS ARROWHEAD", "dingbats", "➤", 4),
    character(36, "0024", "DOLLAR SIGN", "basic-latin", "$", 100),
    character(945, "03B1", "GREEK SMALL LETTER ALPHA", "greek-and-coptic", "α", 1),
    character(769, "0301", "COMBINING ACUTE ACCENT", "combining-diacritical-marks", "́"),
    character(19968, "4E00", "CJK UNIFIED IDEOGRAPH-4E00", "cjk-unified-ideographs", "一"),
    character(57344, "E000", "PRIVATE USE", "private-use-area", ""),
    character(65, "0041", "LATIN CAPITAL LETTER A", "basic-latin", "A", 10),
  ];
  const sequences = [
    { sequence_key: "25b6", hex_sequence: "25B6", name: "play button", emoji: "▶️", category_key: "emoji", popularity: 1 },
    { sequence_key: "25b6-fe0f", hex_sequence: "25B6 FE0F", name: "play button emoji presentation", emoji: "▶️", category_key: "emoji", popularity: 1 },
    { sequence_key: "1f1ec-1f1f7", hex_sequence: "1F1EC 1F1F7", name: "flag: Greece", emoji: "🇬🇷", category_key: "emoji", popularity: 1 },
  ];
  const failures = [
    { target_kind: "character", target_key: "19968", query: "chinese one", count: 2, severity: 5 },
  ];
  const input = { characters, sequences, failures, target: 7, explorationShare: 0.15 };
  const first = selectEntities(input);
  const second = selectEntities(input);
  assert.deepEqual(first.selected, second.selected);
  assert.equal(first.selected.length, 7);
  assert.equal(first.selected[0].entity_id ?? first.selected[0].key, "character:10148");
  assert.ok(first.selected.findIndex((row) => row.key === "character:19968") > first.selected.findIndex((row) => row.key === "emoji_sequence:1f1ec-1f1f7"));
  assert.ok(first.selected.some((row) => row.key === "emoji_sequence:1f1ec-1f1f7"));
  assert.ok(!first.selected.some((row) => row.key === "emoji_sequence:25b6"), "scalar emoji duplicated character row");
  assert.ok(!first.selected.some((row) => row.key === "emoji_sequence:25b6-fe0f"), "presentation selector duplicated character row");
  assert.ok(!first.selected.some((row) => row.key === "character:57344"), "private use leaked into corpus");
  assert.equal(new Set(first.selected.map((row) => row.key)).size, first.selected.length);
});

test("internal entity ids prevent character/sequence key collisions", () => {
  const result = selectEntities({
    characters: [character(1234, "04D2", "CYRILLIC LETTER", "cyrillic", "Ӓ", 1)],
    sequences: [{
      sequence_key: "1234-200d-5678", hex_sequence: "1234 200D 5678", name: "test sequence",
      emoji: "x", category_key: "emoji", popularity: 1,
    }],
    target: 2,
    explorationShare: 0,
  });
  assert.deepEqual(new Set(result.selected.map((row) => row.key)), new Set([
    "character:1234", "emoji_sequence:1234-200d-5678",
  ]));
});

test("all priority groups survive a small target and popularity cannot jump families", () => {
  const result = selectEntities({ characters: [
    character(8594, "2192", "RIGHTWARDS ARROW", "arrows", "→"),
    character(10163, "27B3", "WHITE-FEATHERED RIGHTWARDS ARROW", "dingbats", "➳"),
    character(8195, "2003", "EM SPACE", "general-punctuation", " "),
    character(8226, "2022", "BULLET", "general-punctuation", "•"),
    character(33, "0021", "EXCLAMATION MARK", "basic-latin", "!"),
    character(128512, "1F600", "GRINNING FACE", "emoticons", "😀", 100000),
    character(19968, "4E00", "CJK UNIFIED IDEOGRAPH-4E00", "cjk-unified-ideographs", "一", 1000000),
  ], sequences: [], failures: [{ target_kind: "character", target_key: "19968", query: "one", count: 99999 }], target: 2 });
  assert.equal(result.selected.length, 6, "target is a soft cap for complete priority coverage");
  assert.deepEqual(result.selected.map(generationGroup), ["arrows", "arrows", "formatting", "formatting", "punctuation", "emoji"]);
});

test("everything else includes unseeded assigned ideographs after priority coverage", () => {
  const result = selectEntities({ characters: [character(19968, "4E00", "CJK UNIFIED IDEOGRAPH-4E00", "cjk-unified-ideographs", "一")], sequences: [], target: 10 });
  assert.equal(result.selected.length, 1);
});

test("keyboard and special symbols precede emoji; zigzag arrows remain in the first group", () => {
  assert.equal(generationGroup({ character: "⊞", name: "SQUARED PLUS", category_key: "mathematical-operators" }), "special-symbols");
  assert.equal(generationGroup({ character: "⌘", name: "PLACE OF INTEREST SIGN", category_key: "miscellaneous-technical" }), "special-symbols");
  assert.equal(generationGroup({ character: "↯", name: "DOWNWARDS ZIGZAG ARROW", category_key: "arrows" }), "arrows");
});
