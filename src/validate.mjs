import * as nodeModule from "node:module";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";
import { emit } from "./log.mjs";

let harness = null;

export async function getHarness() {
  if (harness) return harness;
  const resolver = join(config.asciifyRoot, "scripts", "_ts_resolver.mjs");
  if (!existsSync(resolver)) throw new Error("asciify _ts_resolver.mjs not found");
  if (typeof nodeModule.registerHooks === "function") {
    nodeModule.registerHooks({
      resolve(specifier, context, nextResolve) {
        try {
          return nextResolve(specifier, context);
        } catch (error) {
          const relative = specifier.startsWith("./") || specifier.startsWith("../");
          const extensionless = !/\.[a-zA-Z]+$/.test(specifier);
          if (relative && extensionless) return nextResolve(`${specifier}.ts`, context);
          throw error;
        }
      },
    });
  } else {
    nodeModule.register(resolver, import.meta.url);
  }

  const { synonymsTextFor } = await import(join(config.asciifyRoot, "scripts", "_synonyms.mjs"));
  const { sequenceSynonymsFor } = await import(
    join(config.asciifyRoot, "scripts", "_sequence_synonyms.mjs")
  );

  const ref = new DatabaseSync(config.refDb, { readOnly: true });
  const mem = new DatabaseSync(":memory:");
  mem.exec(`
    CREATE TABLE characters (code_point INTEGER PRIMARY KEY, hex_code TEXT, name TEXT, meaning TEXT,
      character TEXT, category_key TEXT, popularity INTEGER, synonyms TEXT);
    CREATE VIRTUAL TABLE characters_fts USING fts5(name, category_key, synonyms, code_point UNINDEXED,
      tokenize='porter unicode61 remove_diacritics 1');
    CREATE TABLE emoji_sequences (sequence_key TEXT PRIMARY KEY, hex_sequence TEXT, name TEXT, emoji TEXT,
      category_key TEXT, emoji_group TEXT, emoji_subgroup TEXT, sort_order INTEGER, popularity INTEGER, synonyms TEXT);
  `);
  for (const row of ref
    .prepare("SELECT code_point, hex_code, name, character, category_key, popularity FROM characters")
    .all()) {
    const syn = synonymsTextFor(row) ?? "";
    mem
      .prepare("INSERT INTO characters VALUES (?,?,?,?,?,?,?,?)")
      .run(row.code_point, row.hex_code, row.name, null, row.character, row.category_key, row.popularity ?? 0, syn);
    mem
      .prepare("INSERT INTO characters_fts (rowid,name,category_key,synonyms,code_point) VALUES (?,?,?,?,?)")
      .run(row.code_point, row.name, row.category_key ?? "", syn, row.code_point);
  }
  ref
    .prepare(
      "SELECT sequence_key, hex_sequence, name, emoji, category_key, emoji_group, emoji_subgroup, popularity FROM emoji_sequences ORDER BY popularity DESC",
    )
    .all()
    .forEach((row, i) => {
      const s = sequenceSynonymsFor(row);
      mem
        .prepare("INSERT INTO emoji_sequences VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(
          row.sequence_key, row.hex_sequence, row.name, row.emoji, row.category_key,
          row.emoji_group, row.emoji_subgroup, i, row.popularity ?? 0, s.length ? s.join(" ") : null,
        );
    });
  ref.close();

  const baseCharacterSynonyms = new Map(
    mem.prepare("SELECT code_point,synonyms FROM characters").all()
      .map((row) => [String(row.code_point), row.synonyms ?? ""]),
  );
  const baseSequenceSynonyms = new Map(
    mem.prepare("SELECT sequence_key,synonyms FROM emoji_sequences").all()
      .map((row) => [String(row.sequence_key).toLowerCase(), row.synonyms ?? ""]),
  );

  const shim = {
    prepare(sql) {
      const stmt = mem.prepare(sql);
      const runner = (binds) => ({
        all: () => Promise.resolve({ results: stmt.all(...binds) }),
        first: () => Promise.resolve(stmt.get(...binds) ?? null),
      });
      return { bind: (...b) => runner(b), ...runner([]) };
    },
  };

  const { lexicalSearch } = await import(
    join(config.asciifyRoot, "lib", "unicode", "search", "pipeline", "lexical.ts")
  );
  const { searchEmojiSequences } = await import(
    join(config.asciifyRoot, "lib", "unicode", "search", "queries", "sequences.ts")
  );
  const { mergeSearchResults } = await import(
    join(config.asciifyRoot, "lib", "unicode", "search", "ranking", "merge.ts")
  );

  async function search(query, targetKey) {
    try {
      const [chars, seqs] = await Promise.all([
        lexicalSearch(shim, query.toLowerCase(), config.roundTripTopN),
        searchEmojiSequences(shim, query.toLowerCase(), config.roundTripTopN),
      ]);
      const merged = mergeSearchResults(seqs, chars, config.roundTripTopN);
      const rank = merged.findIndex((r) => {
        if (targetKey.includes("-")) return String(r.id).toLowerCase() === targetKey.toLowerCase();
        return Number(r.code_point) === Number(targetKey);
      });
      return rank === -1 ? -1 : rank + 1;
    } catch (e) {
      emit("roundtrip_err", { query, err: String(e).slice(0, 200) });
      return -1;
    }
  }

  harness = async function roundTrip(query, targetKey, { aliases = [] } = {}) {
    const additions = [...new Set(aliases.map((value) => String(value).trim()).filter(Boolean))];
    if (additions.length === 0) return search(query, targetKey);
    const sequence = String(targetKey).includes("-");
    const key = String(targetKey).toLowerCase();
    const base = sequence ? baseSequenceSynonyms.get(key) : baseCharacterSynonyms.get(String(Number(targetKey)));
    if (base === undefined) return search(query, targetKey);
    const augmented = `${base} ${additions.join(" ")}`.trim();
    try {
      if (sequence) {
        mem.prepare("UPDATE emoji_sequences SET synonyms=? WHERE LOWER(sequence_key)=?").run(augmented, key);
      } else {
        const codePoint = Number(targetKey);
        mem.prepare("UPDATE characters SET synonyms=? WHERE code_point=?").run(augmented, codePoint);
        mem.prepare("UPDATE characters_fts SET synonyms=? WHERE rowid=?").run(augmented, codePoint);
      }
      return await search(query, targetKey);
    } finally {
      if (sequence) {
        mem.prepare("UPDATE emoji_sequences SET synonyms=? WHERE LOWER(sequence_key)=?").run(base, key);
      } else {
        const codePoint = Number(targetKey);
        mem.prepare("UPDATE characters SET synonyms=? WHERE code_point=?").run(base, codePoint);
        mem.prepare("UPDATE characters_fts SET synonyms=? WHERE rowid=?").run(base, codePoint);
      }
    }
  };

  emit("harness", { ready: true });
  return harness;
}
