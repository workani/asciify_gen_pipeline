import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { unicodeCharacter } from '../../src/unicode-data.mjs';
import { characterMetadata } from '../../src/taxonomy.mjs';
export function loadCharacters(refDb = process.env.GEN_REF_DB ?? resolve(process.env.GEN_ASCIIFY_ROOT ?? fileURLToPath(new URL('../../../asciify/', import.meta.url)), 'gen/out/ref.db')) {
  const db = new DatabaseSync(refDb, { readOnly: true });
  try {
    const rows = db.prepare('SELECT code_point, character, name FROM characters ORDER BY code_point').all();
    const seqs = db.prepare('SELECT sequence_key, emoji, name FROM emoji_sequences ORDER BY sequence_key').all();
    return {
      characters: rows.map(row => ({ ...unicodeCharacter(row.code_point), corpusName: row.name })),
      sequences: seqs.map(row => ({ ...characterMetadata(row.emoji), sequenceKey: row.sequence_key, corpusName: row.name })),
    };
  } finally { db.close(); }
}
