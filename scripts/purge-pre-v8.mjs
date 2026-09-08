#!/usr/bin/env node
// Deletes every pre-v8 session run from the checkpoint database: stage
// checkpoints, OpenCode runs, the token ledger, and the claim/query/edge
// outputs those runs produced. Dry run by default; pass --apply to commit.
//
// Not touched: entity_selection (the planned corpus) and evaluation_holdout
// (a frozen evaluation split, not a run). Deleting the holdout would make a
// later split incomparable with any evaluation already reported against it.
import { copyFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config, PIPELINE_VERSION } from "../src/config.mjs";

const apply = process.argv.includes("--apply");
const statements = [
  ["checkpoints (pre-v8)", "DELETE FROM checkpoints WHERE version NOT LIKE ?||'%'", [PIPELINE_VERSION]],
  ["claims_v2 (pre-v8)", "DELETE FROM claims_v2 WHERE prompt_version NOT LIKE ?||'%'", [PIPELINE_VERSION]],
  ["generated_queries_v2 (pre-v8)", "DELETE FROM generated_queries_v2 WHERE prompt_version NOT LIKE ?||'%'", [PIPELINE_VERSION]],
  ["adjudications_v2 (legacy)", "DELETE FROM adjudications_v2", []],
  ["judgments (legacy)", "DELETE FROM judgments", []],
  ["claims (legacy)", "DELETE FROM claims", []],
  ["queries (legacy)", "DELETE FROM queries", []],
  ["runs (non-records sessions)", "DELETE FROM runs WHERE stage <> 'records'", []],
  ["ledger (non-records)", "DELETE FROM ledger WHERE stage <> 'records'", []],
  ["confusion_edges (model-stage)", "DELETE FROM confusion_edges WHERE source LIKE '2026-0%'", []],
];

const db = new DatabaseSync(config.dbPath);
console.log(`${apply ? "Purging" : "Dry run against"} ${config.dbPath}\nKeeping ${PIPELINE_VERSION} and later\n`);
if (!apply) {
  for (const [label, sql, params] of statements) {
    const count = db.prepare(sql.replace(/^DELETE FROM (\w+)/, "SELECT COUNT(*) c FROM $1")).get(...params).c;
    console.log(`  ${label.padEnd(32)} ${count}`);
  }
  console.log("\nNothing deleted. Re-run with --apply to commit.");
} else {
  const backup = `${config.dbPath}.pre-v8-purge-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  copyFileSync(config.dbPath, backup);
  console.log(`Backup: ${backup}\n`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [label, sql, params] of statements) {
      console.log(`  ${label.padEnd(32)} ${Number(db.prepare(sql).run(...params).changes)}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  db.exec("VACUUM");
  console.log("\nPurged and vacuumed.");
}
db.close();
