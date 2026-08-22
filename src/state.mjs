import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { config, STAGE_VERSIONS } from "./config.mjs";
import { emit } from "./log.mjs";
import { claimContradictsFormalIdentity, visualEntityKey } from "./normalize.mjs";

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
const PROCESS_OWNER = `${process.pid}:${randomUUID()}`;
const CURRENT_CLAIM_VERSIONS = [
  STAGE_VERSIONS.blind_ground,
  STAGE_VERSIONS.enrich,
  STAGE_VERSIONS.contrast,
  STAGE_VERSIONS.rewrite,
];
const CURRENT_CONFUSION_SOURCES = [
  "failure-report",
  "deterministic-name-cluster-v1",
  STAGE_VERSIONS.blind_ground,
  STAGE_VERSIONS.enrich,
  STAGE_VERSIONS.contrast,
];

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
PRAGMA wal_autocheckpoint = 1000;

CREATE TABLE IF NOT EXISTS entities (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  code_point INTEGER,
  hex TEXT,
  name TEXT,
  character TEXT,
  category_key TEXT,
  popularity INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 3,
  ground_status TEXT DEFAULT 'pending',
  synth_status TEXT DEFAULT 'pending',
  adjudicate_status TEXT DEFAULT 'pending',
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  stage TEXT,
  scope TEXT,
  session_id TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  ok INTEGER,
  raw_file TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  stage TEXT,
  entity_key TEXT,
  data_json TEXT,
  votes INTEGER,
  status TEXT DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key TEXT,
  query TEXT,
  qclass TEXT,
  source TEXT,
  roundtrip_rank INTEGER,
  status TEXT DEFAULT 'unvalidated'
);

CREATE TABLE IF NOT EXISTS judgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  cluster_json TEXT,
  query TEXT,
  votes_json TEXT,
  winner TEXT,
  agreement REAL
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  stage TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER
);

CREATE TABLE IF NOT EXISTS entity_selection (
  entity_id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('character','emoji_sequence')),
  target_key TEXT NOT NULL,
  code_point INTEGER,
  hex TEXT NOT NULL,
  name TEXT NOT NULL,
  character TEXT,
  category_key TEXT,
  emoji_group TEXT,
  emoji_subgroup TEXT,
  popularity INTEGER NOT NULL DEFAULT 0,
  existing_synonyms TEXT NOT NULL DEFAULT '',
  general_category TEXT NOT NULL,
  render_mode TEXT NOT NULL DEFAULT 'standalone',
  selection_version TEXT NOT NULL,
  selection_rank INTEGER NOT NULL,
  selection_tier INTEGER NOT NULL,
  selection_score REAL NOT NULL,
  selection_reasons_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE(target_kind, target_key)
);
CREATE INDEX IF NOT EXISTS entity_selection_active_rank_idx
  ON entity_selection(active, selection_rank);
CREATE INDEX IF NOT EXISTS entity_selection_category_idx
  ON entity_selection(category_key, selection_rank);

CREATE TABLE IF NOT EXISTS checkpoints (
  entity_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  version TEXT NOT NULL,
  input_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(
    status IN ('pending','running','passed','failed','quarantined','stale')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_ids_json TEXT NOT NULL DEFAULT '[]',
  output_json TEXT,
  quality_json TEXT,
  error TEXT,
  owner_id TEXT,
  owner_pid INTEGER,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(entity_id, stage, version),
  FOREIGN KEY(entity_id) REFERENCES entity_selection(entity_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS checkpoints_stage_status_idx
  ON checkpoints(stage, version, status, updated_at);

CREATE TABLE IF NOT EXISTS claims_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  family TEXT NOT NULL CHECK(
    family IN ('visual','colloquial','identity','usage','cultural','technical','constraint')
  ),
  phrase TEXT NOT NULL,
  normalized_phrase TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(
    status IN ('proposed','verified','platform_specific','rejected','contested')
  ),
  source_stage TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  verifier_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entity_selection(entity_id) ON DELETE CASCADE,
  UNIQUE(entity_id, family, normalized_phrase, prompt_version)
);
CREATE INDEX IF NOT EXISTS claims_v2_entity_status_idx
  ON claims_v2(entity_id, status, family);
CREATE INDEX IF NOT EXISTS claims_v2_phrase_idx
  ON claims_v2(normalized_phrase, status);

CREATE TABLE IF NOT EXISTS generated_queries_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  query TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  qclass TEXT NOT NULL,
  intent TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  must_beat_json TEXT NOT NULL DEFAULT '[]',
  must_not_json TEXT NOT NULL DEFAULT '[]',
  claim_ids_json TEXT NOT NULL DEFAULT '[]',
  prompt_version TEXT NOT NULL,
  baseline_rank INTEGER,
  augmented_rank INTEGER,
  roundtrip_rank INTEGER,
  status TEXT NOT NULL DEFAULT 'unvalidated' CHECK(
    status IN ('unvalidated','pass','hard','miss','rejected')
  ),
  adjudication_status TEXT NOT NULL DEFAULT 'pending' CHECK(
    adjudication_status IN ('pending','passed','skipped','failed')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entity_selection(entity_id) ON DELETE CASCADE,
  UNIQUE(entity_id, normalized_query, prompt_version)
);
CREATE INDEX IF NOT EXISTS generated_queries_v2_status_idx
  ON generated_queries_v2(status, entity_id);

CREATE TABLE IF NOT EXISTS confusion_edges (
  left_entity_id TEXT NOT NULL,
  right_entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(left_entity_id, right_entity_id, reason, source),
  FOREIGN KEY(left_entity_id) REFERENCES entity_selection(entity_id) ON DELETE CASCADE,
  FOREIGN KEY(right_entity_id) REFERENCES entity_selection(entity_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS confusion_edges_left_idx ON confusion_edges(left_entity_id, strength DESC);
CREATE INDEX IF NOT EXISTS confusion_edges_right_idx ON confusion_edges(right_entity_id, strength DESC);

CREATE TABLE IF NOT EXISTS adjudications_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id INTEGER,
  cluster_hash TEXT NOT NULL,
  cluster_json TEXT NOT NULL,
  votes_json TEXT NOT NULL,
  distribution_json TEXT NOT NULL,
  winner_entity_id TEXT,
  agreement REAL NOT NULL,
  entropy REAL,
  prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(query_id) REFERENCES generated_queries_v2(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS adjudications_v2_query_idx ON adjudications_v2(query_id, created_at);

CREATE TABLE IF NOT EXISTS evaluation_holdout (
  entity_id TEXT PRIMARY KEY,
  stratum TEXT NOT NULL,
  cohort_version TEXT NOT NULL,
  frozen_at INTEGER NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entity_selection(entity_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS evaluation_holdout_stratum_idx ON evaluation_holdout(stratum, entity_id);
`);

function ensureColumn(table, column, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn(
  "generated_queries_v2",
  "adjudication_status",
  "TEXT NOT NULL DEFAULT 'pending' CHECK(adjudication_status IN ('pending','passed','skipped','failed'))",
);
ensureColumn("checkpoints", "owner_id", "TEXT");
ensureColumn("checkpoints", "owner_pid", "INTEGER");
ensureColumn("checkpoints", "operational_failures", "INTEGER NOT NULL DEFAULT 0");

// Repair existing rows whose attempt budget was consumed entirely by failed
// OpenCode transport calls. This keeps v7 state in place; no checkpoint or
// generated output is discarded.
db.exec(`
  UPDATE checkpoints
  SET operational_failures=attempts,
      attempts=0,
      quality_json=json_set(COALESCE(quality_json,'{}'),'$.failure_kind','transport')
  WHERE status='failed'
    AND COALESCE(operational_failures,0)=0
    AND json_array_length(json_extract(quality_json,'$.contract_errors')) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(json_extract(quality_json,'$.contract_errors')) AS error
      WHERE COALESCE(json_extract(error.value,'$.kind'),'') != 'job'
    )
`);
ensureColumn("runs", "error", "TEXT");
ensureColumn("generated_queries_v2", "baseline_rank", "INTEGER");
ensureColumn("generated_queries_v2", "augmented_rank", "INTEGER");
ensureColumn("generated_queries_v2", "adjudication_attempts", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("generated_queries_v2", "eval_split", "TEXT NOT NULL DEFAULT 'development'");

// Recover only checkpoints whose owning process is gone. Read-only status
// processes must never steal work from a live generator using the same DB.
for (const row of db.prepare("SELECT entity_id,stage,version,owner_pid FROM checkpoints WHERE status='running'").all()) {
  let ownerAlive = false;
  if (Number.isInteger(row.owner_pid) && row.owner_pid > 0) {
    try {
      process.kill(row.owner_pid, 0);
      ownerAlive = true;
    } catch (error) {
      ownerAlive = error?.code === "EPERM";
    }
  }
  if (!ownerAlive) {
    db.prepare(`
      UPDATE checkpoints
      SET status='stale',error=COALESCE(error,'owning process exited before completion'),updated_at=?
      WHERE entity_id=? AND stage=? AND version=? AND status='running'
    `).run(Date.now(), row.entity_id, row.stage, row.version);
  }
}

// A current adaptive checkpoint is valid only when two independently validated
// vendor renders produced useful shared claims and a fresh blind recovery call
// selected the expected entity. Equal valid pixels are legitimate for simple
// symbols; each renderer's separate .notdef validation is the safety boundary.
db.prepare(`
  UPDATE checkpoints
  SET status='quarantined',
      error='compatibility quarantine: adaptive two-call gate not met',
      updated_at=?
  WHERE stage='blind_ground' AND version=? AND status='passed'
    AND (
      COALESCE(json_type(output_json, '$.adaptive_generation'),'')!='object'
      OR COALESCE(json_extract(output_json, '$.adaptive_generation.render_status'),'')!='clear'
      OR COALESCE(json_type(output_json, '$.recovery'),'')!='object'
      OR COALESCE(json_extract(output_json, '$.recovery.passed'),0)!=1
      OR COALESCE(json_extract(output_json, '$.recovery.picked_entity_id'),'')
         != COALESCE(json_extract(output_json, '$.recovery.expected_entity_id'),'')
      OR COALESCE(json_array_length(output_json, '$.renders'),0)!=2
      OR COALESCE(json_extract(output_json, '$.renders[0].validation.ink_hash'),'')=''
      OR COALESCE(json_extract(output_json, '$.renders[1].validation.ink_hash'),'')=''
      OR NOT EXISTS (
        SELECT 1 FROM json_each(output_json, '$.accepted_claims')
        WHERE json_extract(value, '$.evidence.slot') IN ('overall_form','distinctive_feature')
          AND json_extract(value, '$.evidence.vendor_support.noto') >= 1
          AND json_extract(value, '$.evidence.vendor_support.platform') >= 1
      )
    )
`).run(Date.now(), STAGE_VERSIONS.blind_ground);

// Older v7 contrast workers accepted verbose model responses as structurally
// valid and then silently dropped every claim at the shared ten-word bound.
// Retry only that exact legacy failure under the corrected contrast contract.
db.prepare(`
  UPDATE checkpoints
  SET status='stale',
      error='operational retry: contrast phrase bounds aligned',
      owner_id=NULL,
      owner_pid=NULL,
      updated_at=?
  WHERE stage='contrast' AND version=? AND status='failed'
    AND error='No valid contrastive claims proposed'
`).run(Date.now(), STAGE_VERSIONS.contrast);

// Earlier v7 processes treated matching valid vendor pixels as proof of font
// fallback and quarantined otherwise complete rows. Make those rows retryable
// in place; no pipeline-version fork or evidence migration is involved.
db.prepare(`
  UPDATE checkpoints
  SET status='stale',
      error='operational retry: equal valid vendor fingerprints are allowed',
      owner_id=NULL,
      owner_pid=NULL,
      updated_at=?
  WHERE stage='blind_ground' AND version=? AND status='quarantined'
    AND error='compatibility quarantine: adaptive two-call gate not met'
    AND COALESCE(json_type(output_json, '$.adaptive_generation'),'')='object'
    AND COALESCE(json_extract(output_json, '$.adaptive_generation.render_status'),'')='clear'
    AND COALESCE(json_extract(output_json, '$.recovery.passed'),0)=1
    AND COALESCE(json_extract(output_json, '$.recovery.picked_entity_id'),'')
       = COALESCE(json_extract(output_json, '$.recovery.expected_entity_id'),'')
    AND COALESCE(json_array_length(output_json, '$.renders'),0)=2
    AND COALESCE(json_extract(output_json, '$.renders[0].validation.ink_hash'),'')!=''
    AND json_extract(output_json, '$.renders[0].validation.ink_hash')
       = json_extract(output_json, '$.renders[1].validation.ink_hash')
`).run(Date.now(), STAGE_VERSIONS.blind_ground);

// Deterministically retire already-written current-version evidence when a
// formal directional/modifier name proves the phrase is its opposite. This is
// a data hygiene pass, not another model call.
const contradictoryClaims = db.prepare(`
  SELECT c.id,c.phrase,e.name
  FROM claims_v2 c JOIN entity_selection e ON e.entity_id=c.entity_id
  WHERE c.prompt_version=? AND c.status IN ('verified','platform_specific')
`).all(STAGE_VERSIONS.blind_ground)
  .filter((row) => claimContradictsFormalIdentity(row, row.phrase));
const rejectContradictoryClaim = db.prepare(`
  UPDATE claims_v2
  SET status='rejected',confidence=1,verifier_json=?,updated_at=?
  WHERE id=?
`);
const rejectContradictoryQueries = db.prepare(`
  UPDATE generated_queries_v2
  SET status='rejected',updated_at=?
  WHERE EXISTS (SELECT 1 FROM json_each(claim_ids_json) WHERE CAST(value AS INTEGER)=?)
`);
for (const claim of contradictoryClaims) {
  const verifier = JSON.stringify({
    verdict: "wrong",
    reason: "phrase contradicts the formal Unicode direction or modifier",
    decision_rule: "deterministic-formal-identity-exclusion-v1",
    prompt_version: STAGE_VERSIONS.verify,
  });
  rejectContradictoryClaim.run(verifier, Date.now(), claim.id);
  rejectContradictoryQueries.run(Date.now(), claim.id);
}

process.once("exit", () => {
  try {
    db.prepare(`
      UPDATE checkpoints
      SET status='stale',error=COALESCE(error,'owner process exited before completion'),updated_at=?
      WHERE owner_id=? AND status='running'
    `).run(Date.now(), PROCESS_OWNER);
  } catch {}
});

function json(value, fallback = null) {
  try {
    return value === null || value === undefined ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function totals() {
  const row = db.prepare(
    "SELECT COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout, COUNT(*) AS calls FROM runs WHERE ok=1",
  ).get();
  return { tokensIn: Number(row.tin), tokensOut: Number(row.tout), calls: Number(row.calls) };
}

export function currentPipelineTotals() {
  const versions = Object.values(STAGE_VERSIONS);
  const row = db.prepare(`
    WITH current_run_ids AS (
      SELECT DISTINCT CAST(j.value AS INTEGER) AS run_id
      FROM checkpoints c, json_each(c.run_ids_json) j
      WHERE c.version IN (${versions.map(() => "?").join(",")})
    )
    SELECT COALESCE(SUM(r.tokens_in),0) AS tin,
           COALESCE(SUM(r.tokens_out),0) AS tout,
           COUNT(*) AS calls
    FROM runs r JOIN current_run_ids c ON c.run_id=r.id
    WHERE r.ok=1
  `).get(...versions);
  return { tokensIn: Number(row.tin), tokensOut: Number(row.tout), calls: Number(row.calls) };
}

export function recordRun({ stage, scope, sessionId, model, tokensIn = 0, tokensOut = 0, ok, rawFile, error = null }) {
  const result = db.prepare(
    "INSERT INTO runs (ts,stage,scope,session_id,model,tokens_in,tokens_out,ok,raw_file,error) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    Date.now(), stage, scope ?? null, sessionId ?? null, model ?? null,
    Number(tokensIn ?? 0), Number(tokensOut ?? 0), ok ? 1 : 0, rawFile ?? null,
    error === null ? null : String(error).slice(0, 2000),
  );
  if (ok) {
    db.prepare("INSERT INTO ledger (ts,stage,tokens_in,tokens_out) VALUES (?,?,?,?)").run(
      Date.now(), stage, Number(tokensIn ?? 0), Number(tokensOut ?? 0),
    );
  }
  emit("tokens", totals());
  return Number(result.lastInsertRowid);
}

// Compatibility API retained for existing state and tests while factory-v2 migrates.
export function upsertEntities(rows) {
  const stmt = db.prepare(`
    INSERT INTO entities (key,kind,code_point,hex,name,character,category_key,popularity,priority,updated_at)
    VALUES (@key,@kind,@code_point,@hex,@name,@character,@category_key,@popularity,@priority,@updated_at)
    ON CONFLICT(key) DO UPDATE SET
      kind=excluded.kind, code_point=excluded.code_point, hex=excluded.hex,
      name=excluded.name, character=excluded.character, category_key=excluded.category_key,
      popularity=excluded.popularity, priority=MIN(entities.priority,excluded.priority),
      updated_at=excluded.updated_at
  `);
  transaction(() => {
    for (const row of rows) stmt.run({ ...row, updated_at: Date.now() });
  });
}

const LEGACY_STAGES = new Set(["ground", "synth", "adjudicate"]);
export function setStatus(stage, key, status) {
  if (!LEGACY_STAGES.has(stage)) throw new Error(`Unknown legacy stage: ${stage}`);
  db.prepare(`UPDATE entities SET ${stage}_status=?,updated_at=? WHERE key=?`).run(status, Date.now(), key);
}

export function countByStatus(stage) {
  if (!LEGACY_STAGES.has(stage)) throw new Error(`Unknown legacy stage: ${stage}`);
  const rows = db.prepare(`SELECT ${stage}_status AS s,COUNT(*) AS n FROM entities GROUP BY ${stage}_status`).all();
  return Object.fromEntries(rows.map((row) => [row.s, Number(row.n)]));
}

export function nextBatch(stage, limit, filterFn = null) {
  if (!LEGACY_STAGES.has(stage)) throw new Error(`Unknown legacy stage: ${stage}`);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 4000) : 100;
  const rows = db.prepare(
    `SELECT * FROM entities WHERE ${stage}_status IN ('pending','failed') ORDER BY priority,popularity DESC LIMIT 4000`,
  ).all();
  const out = [];
  for (const row of rows) {
    if (!filterFn || filterFn(row)) out.push(row);
    if (out.length >= safeLimit) break;
  }
  return out;
}

export function addClaim({ stage, entityKey, data, votes }) {
  return db.prepare("INSERT INTO claims (ts,stage,entity_key,data_json,votes) VALUES (?,?,?,?,?)")
    .run(Date.now(), stage, entityKey, JSON.stringify(data), votes).lastInsertRowid;
}

export function claimsFor(entityKey, stage) {
  return db.prepare("SELECT * FROM claims WHERE entity_key=? AND stage=? ORDER BY id").all(entityKey, stage)
    .map((row) => ({ id: row.id, ...json(row.data_json, {}), votes: row.votes, status: row.status }));
}

export function setClaimStatus(id, status) {
  db.prepare("UPDATE claims SET status=? WHERE id=?").run(status, id);
}

export function addQueries(rows) {
  const stmt = db.prepare("INSERT INTO queries (entity_key,query,qclass,source) VALUES (?,?,?,?)");
  transaction(() => {
    for (const row of rows) stmt.run(row.entityKey, row.query, row.qclass ?? null, row.source ?? null);
  });
}

export function pendingQueries(limit) {
  return db.prepare("SELECT * FROM queries WHERE status='unvalidated' LIMIT ?").all(limit);
}

export function setQueryRoundtrip(id, rank, status) {
  db.prepare("UPDATE queries SET roundtrip_rank=?,status=? WHERE id=?").run(rank, status, id);
}

export function addJudgment({ cluster, query, votes, winner, agreement }) {
  return db.prepare(
    "INSERT INTO judgments (ts,cluster_json,query,votes_json,winner,agreement) VALUES (?,?,?,?,?,?)",
  ).run(Date.now(), JSON.stringify(cluster), query, JSON.stringify(votes), winner, agreement).lastInsertRowid;
}

export function allJudgments() {
  return db.prepare("SELECT * FROM judgments ORDER BY id").all()
    .map((row) => ({ ...row, cluster: json(row.cluster_json, []), votes: json(row.votes_json, {}) }));
}

export function validatedClaims(stage) {
  return db.prepare("SELECT * FROM claims WHERE stage=? AND status='validated'").all(stage)
    .map((row) => ({ id: row.id, entityKey: row.entity_key, ...json(row.data_json, {}) }));
}

export function goldenQueries() {
  return db.prepare(
    "SELECT entity_key,query,qclass,roundtrip_rank,status FROM queries WHERE status IN ('pass','hard')",
  ).all();
}

export function entityByKey(key) {
  return db.prepare("SELECT * FROM entities WHERE key=?").get(key) ?? null;
}

export function allEntities() {
  return db.prepare("SELECT * FROM entities").all();
}

export function stats() {
  const legacyEntities = db.prepare("SELECT COUNT(*) AS n FROM entities").get();
  const queryRows = db.prepare("SELECT status,COUNT(*) AS n FROM queries GROUP BY status").all();
  const judgments = db.prepare("SELECT COUNT(*) AS n FROM judgments").get();
  return {
    entities: Number(legacyEntities.n),
    selected: Number(db.prepare("SELECT COUNT(*) AS n FROM entity_selection WHERE active=1").get().n),
    queries: Object.fromEntries(queryRows.map((row) => [row.status, Number(row.n)])),
    judgments: Number(judgments.n),
    byStage: Object.fromEntries(
      db.prepare("SELECT stage,status,COUNT(*) AS n FROM checkpoints GROUP BY stage,status").all()
        .reduce((entries, row) => {
          const found = entries.find(([stage]) => stage === row.stage);
          if (found) found[1][row.status] = Number(row.n);
          else entries.push([row.stage, { [row.status]: Number(row.n) }]);
          return entries;
        }, []),
    ),
  };
}

export function replaceSelection(entities, selectionVersion) {
  const stmt = db.prepare(`
    INSERT INTO entity_selection (
      entity_id,target_kind,target_key,code_point,hex,name,character,category_key,
      emoji_group,emoji_subgroup,popularity,existing_synonyms,general_category,render_mode,
      selection_version,selection_rank,selection_tier,selection_score,selection_reasons_json,active,updated_at
    ) VALUES (
      @key,@kind,@target_key,@code_point,@hex,@name,@character,@category_key,
      @emoji_group,@emoji_subgroup,@popularity,@existing_synonyms,@general_category,@render_mode,
      @selection_version,@selection_rank,@selection_tier,@selection_score,@selection_reasons_json,1,@updated_at
    )
    ON CONFLICT(entity_id) DO UPDATE SET
      target_kind=excluded.target_kind,target_key=excluded.target_key,code_point=excluded.code_point,
      hex=excluded.hex,name=excluded.name,character=excluded.character,category_key=excluded.category_key,
      emoji_group=excluded.emoji_group,emoji_subgroup=excluded.emoji_subgroup,
      popularity=excluded.popularity,existing_synonyms=excluded.existing_synonyms,
      general_category=excluded.general_category,render_mode=excluded.render_mode,
      selection_version=excluded.selection_version,selection_rank=excluded.selection_rank,
      selection_tier=excluded.selection_tier,selection_score=excluded.selection_score,
      selection_reasons_json=excluded.selection_reasons_json,active=1,updated_at=excluded.updated_at
  `);
  transaction(() => {
    db.prepare("UPDATE entity_selection SET active=0").run();
    for (const entity of entities) {
      stmt.run({
        key: entity.key,
        kind: entity.kind,
        target_key: entity.target_key,
        code_point: entity.code_point ?? null,
        hex: entity.hex,
        name: entity.name,
        character: entity.character ?? "",
        category_key: entity.category_key ?? "",
        emoji_group: entity.emoji_group ?? null,
        emoji_subgroup: entity.emoji_subgroup ?? null,
        popularity: Number(entity.popularity ?? 0),
        existing_synonyms: entity.existing_synonyms ?? "",
        general_category: entity.general_category,
        render_mode: entity.render_mode,
        selection_version: selectionVersion,
        selection_rank: entity.selection_rank,
        selection_tier: entity.selection_tier,
        selection_score: entity.selection_score,
        selection_reasons_json: JSON.stringify(entity.selection_reasons ?? []),
        updated_at: Date.now(),
      });
    }
  });
  emit("selection", { total: entities.length, version: selectionVersion });
}

function hydrateSelection(row) {
  if (!row) return null;
  return { ...row, selection_reasons: json(row.selection_reasons_json, []) };
}

export function selectedEntities({ limit = 100_000, offset = 0 } = {}) {
  return db.prepare(
    "SELECT * FROM entity_selection WHERE active=1 ORDER BY selection_rank LIMIT ? OFFSET ?",
  ).all(limit, offset).map(hydrateSelection);
}

export function selectedEntity(entityId) {
  return hydrateSelection(db.prepare("SELECT * FROM entity_selection WHERE entity_id=?").get(entityId));
}

export function freezeEvaluationHoldout({ size = config.evalHoldoutSize, cohortVersion = "stratified-holdout-v1" } = {}) {
  const existing = db.prepare(`
    SELECT h.*,e.active FROM evaluation_holdout h
    LEFT JOIN entity_selection e ON e.entity_id=h.entity_id
    ORDER BY h.stratum,h.entity_id
  `).all();
  if (existing.length) return existing;

  const entities = db.prepare(`
    SELECT entity_id,target_kind,general_category,selection_tier,selection_rank
    FROM entity_selection WHERE active=1 ORDER BY selection_rank
  `).all();
  const targetSize = Math.min(Math.max(0, Number(size) || 0), entities.length);
  const groups = new Map();
  for (const entity of entities) {
    const stratum = `${entity.target_kind}|tier:${entity.selection_tier}|${entity.general_category}`;
    const rows = groups.get(stratum) ?? [];
    rows.push(entity);
    groups.set(stratum, rows);
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const picked = [];
  for (let round = 0; picked.length < targetSize; round++) {
    let advanced = false;
    for (const [stratum, rows] of orderedGroups) {
      const entity = rows[round];
      if (!entity) continue;
      picked.push({ entity_id: entity.entity_id, stratum });
      advanced = true;
      if (picked.length >= targetSize) break;
    }
    if (!advanced) break;
  }
  const stmt = db.prepare(`
    INSERT INTO evaluation_holdout (entity_id,stratum,cohort_version,frozen_at)
    VALUES (?,?,?,?)
  `);
  transaction(() => {
    const frozenAt = Date.now();
    for (const row of picked) stmt.run(row.entity_id, row.stratum, cohortVersion, frozenAt);
  });
  emit("evaluation_holdout_frozen", { entities: picked.length, strata: new Set(picked.map((row) => row.stratum)).size, cohortVersion });
  return db.prepare("SELECT * FROM evaluation_holdout ORDER BY stratum,entity_id").all();
}

export function evaluationHoldout() {
  return db.prepare("SELECT * FROM evaluation_holdout ORDER BY stratum,entity_id").all();
}

export function selectionSummary() {
  const total = db.prepare("SELECT COUNT(*) AS n FROM entity_selection WHERE active=1").get();
  const byTier = db.prepare(
    "SELECT selection_tier AS key,COUNT(*) AS n FROM entity_selection WHERE active=1 GROUP BY selection_tier",
  ).all();
  const byKind = db.prepare(
    "SELECT target_kind AS key,COUNT(*) AS n FROM entity_selection WHERE active=1 GROUP BY target_kind",
  ).all();
  const byCategory = db.prepare(
    "SELECT general_category AS key,COUNT(*) AS n FROM entity_selection WHERE active=1 GROUP BY general_category",
  ).all();
  const asObject = (rows) => Object.fromEntries(rows.map((row) => [row.key, Number(row.n)]));
  return { total: Number(total.n), byTier: asObject(byTier), byKind: asObject(byKind), byCategory: asObject(byCategory) };
}

export function checkpointSummary({ currentVersionOnly = true } = {}) {
  const rows = db.prepare(
    "SELECT stage,version,status,COUNT(*) AS n FROM checkpoints GROUP BY stage,version,status ORDER BY stage,version,status",
  ).all().filter((row) => !currentVersionOnly || STAGE_VERSIONS[row.stage] === row.version);
  const out = {};
  for (const row of rows) {
    const stage = out[row.stage] ?? { versions: {} };
    const version = stage.versions[row.version] ?? {};
    version[row.status] = Number(row.n);
    stage.versions[row.version] = version;
    out[row.stage] = stage;
  }
  return out;
}

export function factoryStats() {
  const claimRows = db.prepare(`
    SELECT status,COUNT(*) AS n FROM claims_v2
    WHERE prompt_version IN (${CURRENT_CLAIM_VERSIONS.map(() => "?").join(",")})
    GROUP BY status
  `).all(...CURRENT_CLAIM_VERSIONS);
  const queryRows = db.prepare(
    "SELECT status,COUNT(*) AS n FROM generated_queries_v2 WHERE prompt_version=? GROUP BY status",
  ).all(STAGE_VERSIONS.synth);
  const adjudicationRows = db.prepare(
    "SELECT adjudication_status AS status,COUNT(*) AS n FROM generated_queries_v2 WHERE prompt_version=? GROUP BY adjudication_status",
  ).all(STAGE_VERSIONS.synth);
  const splitRows = db.prepare(
    "SELECT eval_split AS status,COUNT(*) AS n FROM generated_queries_v2 WHERE prompt_version=? GROUP BY eval_split",
  ).all(STAGE_VERSIONS.synth);
  const asObject = (rows) => Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
  return {
    selection: selectionSummary(),
    checkpoints: checkpointSummary(),
    claims: asObject(claimRows),
    queries: asObject(queryRows),
    querySplits: asObject(splitRows),
    evaluationHoldout: Number(db.prepare("SELECT COUNT(*) AS n FROM evaluation_holdout").get().n),
    queryAdjudication: asObject(adjudicationRows),
    adjudications: Number(db.prepare("SELECT COUNT(*) AS n FROM adjudications_v2 WHERE prompt_version=?").get(STAGE_VERSIONS.adjudicate).n),
    confusionEdges: Number(db.prepare(`
      SELECT COUNT(*) AS n FROM confusion_edges
      WHERE source IN (${CURRENT_CONFUSION_SOURCES.map(() => "?").join(",")})
    `).get(...CURRENT_CONFUSION_SOURCES).n),
    pipelineTokens: currentPipelineTotals(),
    tokens: totals(),
  };
}

export function beginCheckpoint({ entityId, stage, version, inputHash }) {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO checkpoints (entity_id,stage,version,input_hash,status,attempts,owner_id,owner_pid,started_at,updated_at)
    VALUES (?,?,?,?,'running',1,?,?,?,?)
    ON CONFLICT(entity_id,stage,version) DO UPDATE SET
      input_hash=excluded.input_hash,status='running',attempts=checkpoints.attempts+1,
      error=NULL,owner_id=excluded.owner_id,owner_pid=excluded.owner_pid,
      started_at=excluded.started_at,updated_at=excluded.updated_at
    WHERE checkpoints.status!='running' OR checkpoints.owner_id=excluded.owner_id
  `).run(entityId, stage, version, inputHash ?? null, PROCESS_OWNER, process.pid, now, now);
  if (Number(result.changes) !== 1) {
    throw new Error(`Checkpoint already leased by another live generator: ${stage}@${version} ${entityId}`);
  }
}

export function releaseOwnedCheckpoints({ stage = null, reason = "stage exited before checkpoint completion" } = {}) {
  const result = stage
    ? db.prepare(`
        UPDATE checkpoints SET status='stale',error=?,updated_at=?
        WHERE owner_id=? AND stage=? AND status='running'
      `).run(reason, Date.now(), PROCESS_OWNER, stage)
    : db.prepare(`
        UPDATE checkpoints SET status='stale',error=?,updated_at=?
        WHERE owner_id=? AND status='running'
      `).run(reason, Date.now(), PROCESS_OWNER);
  return Number(result.changes);
}

export function finishCheckpoint({
  entityId, stage, version, status, output = null, quality = null, error = null, runIds = [],
}) {
  const allowed = new Set(["passed", "failed", "quarantined", "stale"]);
  if (!allowed.has(status)) throw new Error(`Invalid final checkpoint status: ${status}`);
  const contractErrors = Array.isArray(quality?.contract_errors) ? quality.contract_errors : [];
  const transportFailure = status === "failed" && contractErrors.length > 0
    && contractErrors.every((entry) => entry?.kind === "job");
  const storedQuality = transportFailure ? { ...quality, failure_kind: "transport" } : quality;
  const result = db.prepare(`
    UPDATE checkpoints SET
      status=?,output_json=?,quality_json=?,error=?,run_ids_json=?,updated_at=?,
      attempts=CASE WHEN ? THEN MAX(0,attempts-1) ELSE attempts END,
      operational_failures=operational_failures+CASE WHEN ? THEN 1 ELSE 0 END
    WHERE entity_id=? AND stage=? AND version=? AND owner_id=? AND status='running'
  `).run(
    status,
    output === null ? null : JSON.stringify(output),
    storedQuality === null ? null : JSON.stringify(storedQuality),
    error === null ? null : String(error).slice(0, 2000),
    JSON.stringify(runIds),
    Date.now(), transportFailure ? 1 : 0, transportFailure ? 1 : 0,
    entityId, stage, version, PROCESS_OWNER,
  );
  if (Number(result.changes) !== 1) {
    throw new Error(`Checkpoint lease lost before finish: ${stage}@${version} ${entityId}`);
  }
}

export function checkpoint(entityId, stage, version) {
  const row = db.prepare(
    "SELECT * FROM checkpoints WHERE entity_id=? AND stage=? AND version=?",
  ).get(entityId, stage, version);
  if (!row) return null;
  return {
    ...row,
    output: json(row.output_json), quality: json(row.quality_json), run_ids: json(row.run_ids_json, []),
  };
}

export function markCheckpointsStale(entityId, stages, reason) {
  const uniqueStages = [...new Set(stages)].filter((stage) => STAGE_VERSIONS[stage]);
  if (!uniqueStages.length) return 0;
  const result = db.prepare(`
    UPDATE checkpoints
    SET status='stale',error=$reason,owner_id=NULL,owner_pid=NULL,updated_at=$now
    WHERE entity_id=$entityId
      AND status!='running'
      AND (${uniqueStages.map((_, index) => `(stage=$stage${index} AND version=$version${index})`).join(" OR ")})
  `).run({
    ...Object.fromEntries(uniqueStages.flatMap((stage, index) => [
      [`stage${index}`, stage],
      [`version${index}`, STAGE_VERSIONS[stage]],
    ])),
    reason: String(reason).slice(0, 2000),
    now: Date.now(),
    entityId,
  });
  return Number(result.changes);
}

export function nextCheckpointEntities({
  stage, version, prerequisite = null, limit = 12, maxAttempts = 3,
  maxOperationalAttempts = config.maxOperationalAttempts,
}) {
  const prerequisiteStatuses = prerequisite?.statuses?.length ? prerequisite.statuses : ["passed"];
  const prereqJoin = prerequisite
    ? `JOIN checkpoints p ON p.entity_id=e.entity_id AND p.stage=$prereqStage AND p.version=$prereqVersion
       AND p.status IN (${prerequisiteStatuses.map((_, index) => `$prereqStatus${index}`).join(",")})`
    : "";
  const statement = db.prepare(`
    SELECT e.* FROM entity_selection e
    ${prereqJoin}
    LEFT JOIN checkpoints c ON c.entity_id=e.entity_id AND c.stage=$stage AND c.version=$version
    WHERE e.active=1
      AND (
        c.entity_id IS NULL
        OR c.status='stale'
        OR (c.status='pending' AND COALESCE(c.attempts,0) < $maxAttempts)
        OR (
          c.status='failed' AND (
            (
              COALESCE(json_extract(c.quality_json,'$.failure_kind'),'')='transport'
              AND COALESCE(c.operational_failures,0) < $maxOperationalAttempts
            )
            OR (
              COALESCE(json_extract(c.quality_json,'$.failure_kind'),'')!='transport'
              AND COALESCE(c.attempts,0) < $maxAttempts
            )
          )
        )
        OR (
          c.status='quarantined' AND COALESCE(c.attempts,0) < $maxAttempts
          AND (
            COALESCE(json_extract(c.quality_json,'$.reason'),'') IN (
              'identical_vendor_fingerprint','no_renderable_confusion_neighbors'
            )
            OR c.error LIKE 'compatibility quarantine:%'
          )
        )
      )
    ORDER BY CASE
               WHEN c.status='stale' THEN 0
               WHEN c.status IN ('pending','failed') THEN 1
               WHEN c.status='quarantined' THEN 2
               ELSE 3
             END,
             e.selection_rank
    LIMIT $limit
  `);
  const params = { stage, version, maxAttempts, maxOperationalAttempts, limit };
  if (prerequisite) {
    params.prereqStage = prerequisite.stage;
    params.prereqVersion = prerequisite.version;
    prerequisiteStatuses.forEach((status, index) => { params[`prereqStatus${index}`] = status; });
  }
  const rows = statement.all(params);
  return rows.map(hydrateSelection);
}

export function upsertClaimsV2(claims) {
  const stmt = db.prepare(`
    INSERT INTO claims_v2 (
      entity_id,family,phrase,normalized_phrase,confidence,status,source_stage,prompt_version,
      evidence_json,verifier_json,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(entity_id,family,normalized_phrase,prompt_version) DO UPDATE SET
      phrase=excluded.phrase,confidence=MAX(claims_v2.confidence,excluded.confidence),
      status=CASE WHEN claims_v2.status='verified' THEN claims_v2.status ELSE excluded.status END,
      evidence_json=excluded.evidence_json,updated_at=excluded.updated_at
  `);
  transaction(() => {
    for (const claim of claims) {
      const now = Date.now();
      stmt.run(
        claim.entity_id, claim.family, claim.phrase, claim.normalized_phrase,
        Number(claim.confidence), claim.status ?? "proposed", claim.source_stage,
        claim.prompt_version, JSON.stringify(claim.evidence ?? {}),
        claim.verifier ? JSON.stringify(claim.verifier) : null, now, now,
      );
    }
  });
}

export function claimsV2ForEntity(entityId, {
  statuses = null,
  currentVersionOnly = true,
  promptVersions = CURRENT_CLAIM_VERSIONS,
} = {}) {
  const params = [entityId];
  const clauses = [];
  if (statuses?.length) {
    clauses.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (currentVersionOnly) {
    clauses.push(`prompt_version IN (${promptVersions.map(() => "?").join(",")})`);
    params.push(...promptVersions);
  }
  const clause = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM claims_v2 WHERE entity_id=?${clause} ORDER BY family,id`).all(...params)
    .map((row) => ({ ...row, evidence: json(row.evidence_json, {}), verifier: json(row.verifier_json) }));
}

export function updateClaimVerification(id, { status, confidence, verifier }) {
  db.prepare(
    "UPDATE claims_v2 SET status=?,confidence=?,verifier_json=?,updated_at=? WHERE id=?",
  ).run(status, confidence, JSON.stringify(verifier ?? {}), Date.now(), id);
}

export function allClaimsV2({
  statuses = ["verified", "platform_specific"],
  currentVersionOnly = true,
} = {}) {
  const clauses = [];
  const params = [];
  if (statuses.length) {
    clauses.push(`c.status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (currentVersionOnly) {
    clauses.push(`c.prompt_version IN (${CURRENT_CLAIM_VERSIONS.map(() => "?").join(",")})`);
    params.push(...CURRENT_CLAIM_VERSIONS);
  }
  const clause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT c.*,e.target_kind,e.target_key,e.hex,e.name,e.character,e.category_key,e.selection_rank
    FROM claims_v2 c JOIN entity_selection e ON e.entity_id=c.entity_id
    ${clause} ORDER BY e.selection_rank,c.family,c.id
  `).all(...params).map((row) => ({ ...row, evidence: json(row.evidence_json, {}), verifier: json(row.verifier_json) }));
}

export function upsertQueriesV2(rows) {
  const stmt = db.prepare(`
    INSERT INTO generated_queries_v2 (
      entity_id,query,normalized_query,qclass,intent,confidence,must_beat_json,must_not_json,
      claim_ids_json,prompt_version,eval_split,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(entity_id,normalized_query,prompt_version) DO UPDATE SET
      query=excluded.query,qclass=excluded.qclass,intent=excluded.intent,
      confidence=MAX(generated_queries_v2.confidence,excluded.confidence),
      must_beat_json=excluded.must_beat_json,must_not_json=excluded.must_not_json,
      claim_ids_json=excluded.claim_ids_json,updated_at=excluded.updated_at
  `);
  transaction(() => {
    for (const row of rows) {
      const now = Date.now();
      stmt.run(
        row.entity_id, row.query, row.normalized_query, row.qclass, row.intent ?? null,
        Number(row.confidence ?? 0.5), JSON.stringify(row.must_beat ?? []),
        JSON.stringify(row.must_not ?? []), JSON.stringify(row.claim_ids ?? []),
        row.prompt_version,
        db.prepare("SELECT 1 FROM evaluation_holdout WHERE entity_id=?").get(row.entity_id) ? "held_out" : "development",
        now, now,
      );
    }
  });
}

function hydrateQuery(row) {
  return {
    ...row,
    must_beat: json(row.must_beat_json, []), must_not: json(row.must_not_json, []),
    claim_ids: json(row.claim_ids_json, []),
  };
}

export function queriesV2ForEntity(entityId) {
  return db.prepare("SELECT * FROM generated_queries_v2 WHERE entity_id=? ORDER BY id").all(entityId).map(hydrateQuery);
}

export function pendingQueriesV2(limit = 5000) {
  return db.prepare(`
    SELECT * FROM generated_queries_v2
    WHERE status='unvalidated' AND prompt_version=?
    ORDER BY id LIMIT ?
  `).all(STAGE_VERSIONS.synth, limit).map(hydrateQuery);
}

export function setQueryRoundtripV2(id, rank, status) {
  db.prepare(
    "UPDATE generated_queries_v2 SET baseline_rank=?,augmented_rank=?,roundtrip_rank=?,status=?,updated_at=? WHERE id=?",
  ).run(rank, rank, rank, status, Date.now(), id);
}

export function setQueryValidationV2(id, baselineRank, augmentedRank, status) {
  db.prepare(`
    UPDATE generated_queries_v2
    SET baseline_rank=?,augmented_rank=?,roundtrip_rank=?,status=?,updated_at=?
    WHERE id=?
  `).run(baselineRank, augmentedRank, augmentedRank, status, Date.now(), id);
}

export function allQueriesV2({ statuses = null, currentVersionOnly = true } = {}) {
  const clauses = [];
  const params = [];
  if (statuses?.length) {
    clauses.push(`q.status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (currentVersionOnly) {
    clauses.push("q.prompt_version=?");
    params.push(STAGE_VERSIONS.synth);
  }
  const clause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT q.*,e.target_kind,e.target_key,e.hex,e.name,e.character,e.category_key,e.selection_rank
    FROM generated_queries_v2 q JOIN entity_selection e ON e.entity_id=q.entity_id
    ${clause} ORDER BY e.selection_rank,q.id
  `).all(...params).map(hydrateQuery);
}

export function pendingAdjudicationQueries(limit = 100) {
  return db.prepare(`
    SELECT q.*,e.target_kind,e.target_key,e.hex,e.name,e.character,e.category_key,e.selection_rank
    FROM generated_queries_v2 q JOIN entity_selection e ON e.entity_id=q.entity_id
    WHERE q.adjudication_status IN ('pending','failed')
      AND q.adjudication_attempts < 3
      AND q.status != 'rejected'
      AND q.prompt_version=$promptVersion
      AND (json_array_length(q.must_beat_json)>0 OR json_array_length(q.must_not_json)>0)
    ORDER BY CASE WHEN json_array_length(q.must_beat_json)>0 THEN 0 ELSE 1 END,
             e.selection_rank,q.id
    LIMIT $limit
  `).all({ limit, promptVersion: STAGE_VERSIONS.synth }).map(hydrateQuery);
}

export function skipNonContrastiveAdjudications() {
  const result = db.prepare(`
    UPDATE generated_queries_v2
    SET adjudication_status='skipped',updated_at=?
    WHERE adjudication_status IN ('pending','failed')
      AND prompt_version=?
      AND json_array_length(must_beat_json)=0
      AND json_array_length(must_not_json)=0
  `).run(Date.now(), STAGE_VERSIONS.synth);
  return Number(result.changes);
}

export function setQueryAdjudicationStatus(id, status) {
  if (!["passed", "skipped", "failed"].includes(status)) throw new Error(`Invalid adjudication status: ${status}`);
  db.prepare(`
    UPDATE generated_queries_v2
    SET adjudication_status=?,
        adjudication_attempts=adjudication_attempts+CASE WHEN ?='failed' THEN 1 ELSE 0 END,
        updated_at=?
    WHERE id=?
  `).run(status, status, Date.now(), id);
}

export function upsertConfusionEdges(edges) {
  const stmt = db.prepare(`
    INSERT INTO confusion_edges (
      left_entity_id,right_entity_id,reason,strength,source,evidence_json,updated_at
    ) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(left_entity_id,right_entity_id,reason,source) DO UPDATE SET
      strength=MAX(confusion_edges.strength,excluded.strength),
      evidence_json=excluded.evidence_json,updated_at=excluded.updated_at
  `);
  transaction(() => {
    for (const edge of edges) {
      if (!edge.left_entity_id || !edge.right_entity_id || edge.left_entity_id === edge.right_entity_id) continue;
      const [left, right] = [edge.left_entity_id, edge.right_entity_id].sort();
      stmt.run(left, right, edge.reason, Number(edge.strength ?? 0.5), edge.source, JSON.stringify(edge.evidence ?? {}), Date.now());
    }
  });
}

export function neighborsFor(entityId, limit = 12) {
  const fetchLimit = Math.max(limit, limit * 8);
  const target = db.prepare(
    "SELECT character,render_mode FROM entity_selection WHERE entity_id=? AND active=1",
  ).get(entityId);
  const targetVisualKey = visualEntityKey(target);
  const rows = db.prepare(`
    SELECT x.*,e.* FROM (
      SELECT CASE WHEN left_entity_id=? THEN right_entity_id ELSE left_entity_id END AS neighbor_id,
             reason,strength,source,evidence_json
      FROM confusion_edges
      WHERE (left_entity_id=? OR right_entity_id=?)
        AND source IN (${CURRENT_CONFUSION_SOURCES.map(() => "?").join(",")})
      ORDER BY strength DESC LIMIT ?
    ) x JOIN entity_selection e ON e.entity_id=x.neighbor_id
    ORDER BY x.strength DESC,e.selection_rank
  `).all(entityId, entityId, entityId, ...CURRENT_CONFUSION_SOURCES, fetchLimit)
    .map((row) => ({ ...hydrateSelection(row), reason: row.reason, strength: row.strength, evidence: json(row.evidence_json, {}) }));
  const unique = new Map();
  const visualKeys = new Set(targetVisualKey ? [targetVisualKey] : []);
  for (const row of rows) {
    if (unique.has(row.entity_id)) continue;
    const visualKey = visualEntityKey(row);
    if (visualKey && visualKeys.has(visualKey)) continue;
    unique.set(row.entity_id, row);
    if (visualKey) visualKeys.add(visualKey);
  }
  return [...unique.values()].slice(0, limit);
}

/**
 * Add the visually dangerous same-base modifier variants that broad name-edge
 * scoring can miss (for example a-with-grave versus a-with-acute).
 */
export function modifierNeighborsFor(entityId, limit = 2) {
  const entity = db.prepare(
    "SELECT entity_id,name,code_point FROM entity_selection WHERE entity_id=? AND active=1",
  ).get(entityId);
  const marker = entity?.name?.indexOf(" WITH ") ?? -1;
  if (!entity || marker < 1) return [];
  const stem = entity.name.slice(0, marker);
  return db.prepare(`
    SELECT * FROM entity_selection
    WHERE active=1 AND entity_id!=? AND name LIKE ?
    ORDER BY ABS(COALESCE(code_point,0)-COALESCE(?,0)),selection_rank
    LIMIT ?
  `).all(entityId, `${stem} WITH %`, entity.code_point, limit).map(hydrateSelection);
}

/**
 * Supply deterministic contrast candidates when the confusion graph is sparse.
 * Category and target-kind matches win, then nearby selection ranks keep the
 * fallback stable across runs.
 */
export function fallbackNeighborsFor(entityId, limit = 12) {
  return db.prepare(`
    SELECT candidate.*
    FROM entity_selection target
    JOIN entity_selection candidate
      ON candidate.active=1 AND candidate.entity_id!=target.entity_id
    WHERE target.entity_id=? AND target.active=1
    ORDER BY CASE
      WHEN candidate.category_key=target.category_key THEN 0
      WHEN candidate.general_category=target.general_category
           AND candidate.target_kind=target.target_kind THEN 1
      WHEN candidate.target_kind=target.target_kind THEN 2
      ELSE 3
    END,
    ABS(candidate.selection_rank-target.selection_rank),candidate.selection_rank
    LIMIT ?
  `).all(entityId, limit).map(hydrateSelection);
}

export function allConfusionEdges({ currentVersionOnly = true } = {}) {
  const clause = currentVersionOnly
    ? `WHERE source IN (${CURRENT_CONFUSION_SOURCES.map(() => "?").join(",")})`
    : "";
  return db.prepare(`SELECT * FROM confusion_edges ${clause} ORDER BY strength DESC,left_entity_id,right_entity_id`)
    .all(...(currentVersionOnly ? CURRENT_CONFUSION_SOURCES : []))
    .map((row) => ({ ...row, evidence: json(row.evidence_json, {}) }));
}

export function queryV2ById(id) {
  const row = db.prepare(`
    SELECT q.*,e.target_kind,e.target_key,e.hex,e.name,e.character,e.category_key,e.selection_rank
    FROM generated_queries_v2 q JOIN entity_selection e ON e.entity_id=q.entity_id
    WHERE q.id=?
  `).get(id);
  return row ? hydrateQuery(row) : null;
}

export function addAdjudicationV2({
  queryId = null, clusterHash, cluster, votes, distribution, winnerEntityId, agreement, entropy = null, promptVersion,
}) {
  return Number(db.prepare(`
    INSERT INTO adjudications_v2 (
      query_id,cluster_hash,cluster_json,votes_json,distribution_json,winner_entity_id,
      agreement,entropy,prompt_version,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    queryId, clusterHash, JSON.stringify(cluster), JSON.stringify(votes), JSON.stringify(distribution),
    winnerEntityId, agreement, entropy, promptVersion, Date.now(),
  ).lastInsertRowid);
}

export function allAdjudicationsV2({ currentVersionOnly = true } = {}) {
  const clause = currentVersionOnly ? "WHERE prompt_version=?" : "";
  return db.prepare(`SELECT * FROM adjudications_v2 ${clause} ORDER BY id`)
    .all(...(currentVersionOnly ? [STAGE_VERSIONS.adjudicate] : [])).map((row) => ({
    ...row,
    cluster: json(row.cluster_json, []), votes: json(row.votes_json, []), distribution: json(row.distribution_json, {}),
  }));
}
