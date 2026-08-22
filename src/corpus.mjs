import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config, STAGE_VERSIONS } from "./config.mjs";
import { loadFailures } from "./failures.mjs";
import { emit } from "./log.mjs";
import { seedEntityIds } from "./seeds.mjs";
import { selectEntities } from "./selection.mjs";
import { freezeEvaluationHoldout, replaceSelection } from "./state.mjs";
import { buildInitialConfusions } from "./clusters.mjs";

export function readReferenceCorpus(refDb = config.refDb) {
  if (!existsSync(refDb)) throw new Error(`Asciify reference database not found: ${refDb}`);
  const db = new DatabaseSync(refDb, { readOnly: true });
  try {
    const characters = db.prepare(`
      SELECT code_point,hex_code,name,character,category_key,popularity,COALESCE(synonyms,'') AS synonyms
      FROM characters
      WHERE code_point IS NOT NULL AND name IS NOT NULL
    `).all();
    const sequences = db.prepare(`
      SELECT sequence_key,hex_sequence,name,emoji,category_key,emoji_group,emoji_subgroup,popularity
      FROM emoji_sequences
      WHERE sequence_key IS NOT NULL AND name IS NOT NULL
    `).all();
    return { characters, sequences };
  } finally {
    db.close();
  }
}

export function planCorpus({
  target = config.targetEntities,
  failureFile = config.failureFile,
  explorationShare = config.explorationShare,
  persist = true,
} = {}) {
  const { characters, sequences } = readReferenceCorpus();
  const failures = loadFailures(failureFile);
  const result = selectEntities({
    characters,
    sequences,
    failures,
    seedKeys: seedEntityIds(),
    target,
    explorationShare,
  });
  let confusions = null;
  if (persist) {
    replaceSelection(result.selected, STAGE_VERSIONS.select);
    freezeEvaluationHoldout();
    confusions = buildInitialConfusions();
  }
  emit("corpus", {
    sourceCharacters: characters.length,
    sourceSequences: sequences.length,
    failureRecords: failures.length,
    candidates: result.candidates,
    selected: result.selected.length,
    stats: result.stats,
    confusions,
  });
  return result;
}

// Compatibility entrypoint used by the original CLI.
export function loadCorpus(options = {}) {
  return planCorpus(options).selected.length;
}
