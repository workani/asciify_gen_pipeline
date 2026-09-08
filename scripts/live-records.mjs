#!/usr/bin/env node
// Real provider + real glyphs. Isolated DB; never changes production search or
// the main generator's selection/checkpoints. No retry-until-green loop.
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRecordConsole } from "../src/record-console.mjs";

const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const family = arg("family") ?? null;
if (family && arg("cps")) throw new Error("Choose --family or --cps, not both");
const cps = family ? [] : (arg("cps") ?? "27bb,27a6,21af,2022,2003,2014,229e,1f972,261e,1f64f,2661,1f494,250c,256c,2260,2297").split(",").map((value) => Number.parseInt(value, 16));
if (cps.some((value) => !Number.isInteger(value) || value < 0 || value > 0x10ffff)) throw new Error("--cps requires comma-separated hex code points");
const printCount = Number.parseInt(arg("print") ?? "5", 10);
if (!Number.isInteger(printCount) || printCount < 0) throw new Error("--print must be a nonnegative integer");
const printCps = (arg("print-cps") ?? "").split(",").filter(Boolean).map((value) => Number.parseInt(value, 16));
if (printCps.some((value) => !Number.isInteger(value) || (!family && !cps.includes(value)))) throw new Error("--print-cps must be a subset of --cps");
const directory = resolve(arg("out") ?? `out/live-records-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const reportPath = resolve(arg("report") ?? join(directory, "live-report.json"));
mkdirSync(directory, { recursive: true });
mkdirSync(resolve(reportPath, ".."), { recursive: true });
process.env.GEN_DB = join(directory, "state.sqlite");
process.env.GEN_RUNS_DIR = join(directory, "runs");
process.env.GEN_OUT_DIR = join(directory, "artifacts");
// Share only validated image cache, not generated records.
process.env.GEN_RENDER_DIR ??= resolve("runs/render");
const { config, STAGE_VERSIONS } = await import("../src/config.mjs");
const { readReferenceCorpus } = await import("../src/corpus.mjs");
const { replaceSelection, selectedEntities, checkpoint } = await import("../src/state.mjs");
const { processRecord } = await import("../src/stages/records.mjs");
const { emitRecordArtifacts } = await import("../src/emit-records.mjs");
const { selectRecordCohort } = await import("../src/record-cohort.mjs");
const { buildRecordReport, recordResults, writeRecordReport } = await import("../src/record-report.mjs");
const { pool } = await import("../src/pool.mjs");
pool.setThreads(Number(arg("threads") ?? 2));
const corpus = readReferenceCorpus();
const cohort = selectRecordCohort(corpus, { family, cps });
replaceSelection(cohort.entities, STAGE_VERSIONS.select);
const entities = selectedEntities();
const terminal = createRecordConsole({ total: entities.length });
terminal.start({ directory, reportPath, model: config.model, version: STAGE_VERSIONS.records });
function saveReport(status, artifactDirectory = null, exportError = null) {
  const summary = buildRecordReport({ entities, cohort, status, results: recordResults(entities),
    runDirectory: directory, artifactDirectory, exportError });
  // Refresh immediately and after each result. A running or interrupted run must
  // not leave the stable report looking like the previous successful run.
  return writeRecordReport([join(directory, "live-report.json"), reportPath], summary);
}
let cursor = 0;
saveReport("running");
await Promise.all(Array.from({ length: pool.snapshot().threads }, async () => {
  while (cursor < entities.length) {
    const entity = entities[cursor++];
    await processRecord(entity);
    const row = checkpoint(entity.entity_id, "records", STAGE_VERSIONS.records);
    terminal.result({ ...row, glyph: entity.character, hex: entity.hex });
    saveReport("running");
  }
}));
let artifactDirectory = null, exportError = null;
try { artifactDirectory = await emitRecordArtifacts({ allowPartial: true }); }
catch (error) { exportError = String(error.message ?? error); process.stderr.write(`Export failed: ${exportError}\n`); }
const summary = saveReport("complete", artifactDirectory, exportError);
const results = summary.results;
const requested = printCps.length
  ? printCps.map((cp) => results.find((row) => Number.parseInt(row.hex, 16) === cp)).filter(Boolean)
  : results.slice(0, printCount);
const printed = requested.slice(0, printCount);
terminal.finish(summary, reportPath, printed);
if (exportError || summary.accepted < summary.total || !summary.family_consistency.complete) process.exitCode = 1;
