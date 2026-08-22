import { test } from "node:test";
import assert from "node:assert/strict";
import { selectEntities } from "../src/selection.mjs";

const character = (code_point, hex_code, name, category_key, character, popularity = 0) => ({
  code_point, hex_code, name, category_key, character, popularity, synonyms: "",
});

test("selection is deterministic, failure-first, and deduplicates scalar emoji sequences", () => {
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
  assert.equal(first.selected[0].entity_id ?? first.selected[0].key, "character:19968");
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
