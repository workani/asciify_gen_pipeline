#!/usr/bin/env node
// Real provider + real glyphs. Isolated DB; never changes production search or
// the main generator's selection/checkpoints. No retry-until-green loop.
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";

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
const { generationGroup } = await import("../src/selection.mjs");
const { replaceSelection, selectedEntities, checkpoint } = await import("../src/state.mjs");
const { processRecord } = await import("../src/stages/records.mjs");
const { emitRecordArtifacts } = await import("../src/emit-records.mjs");
const { selectRecordCohort, auditRecordCohort } = await import("../src/record-cohort.mjs");
const { pool } = await import("../src/pool.mjs");
pool.setThreads(Number(arg("threads") ?? 2));
const corpus = readReferenceCorpus();
const cohort = selectRecordCohort(corpus, { family, cps });
replaceSelection(cohort.entities, STAGE_VERSIONS.select);
const sample = cohort.entities.map((row) => ({ glyph: row.character, hex: row.hex, family: family ?? null, group: generationGroup(row) }));
process.stderr.write(`Run directory: ${directory}\nReport: ${reportPath}\n`);
process.stderr.write(`Running ${sample.length} characters through ${config.model} (${STAGE_VERSIONS.records})\n`);
const entities = selectedEntities();
const readResults = () => entities.map((entity) => {
  const row = checkpoint(entity.entity_id, "records", STAGE_VERSIONS.records);
  return { entity_id: entity.entity_id, glyph: entity.character, hex: entity.hex, status: row?.status ?? "not_started",
    quality: row?.quality ?? null, embedding_record: row?.output?.embedding_record ?? null,
    baseline: row?.output?.baseline ?? [], draft: row?.output?.draft ?? null,
    fact_review: row?.output?.fact_review ?? null, discovery: row?.output?.discovery ?? null,
    vocabulary_review: row?.output?.vocabulary_review ?? null, contribution: row?.output?.vocabulary?.contribution ?? null, source_context: row?.output?.source_context ?? null,
    model: row?.output?.model ?? config.model, model_variant: row?.output?.model_variant ?? config.modelVariant,
    run_ids: row?.run_ids ?? [], error: row?.error ?? null };
});
function saveReport(status, artifactDirectory = null, exportError = null) {
  const results = readResults();
  const summary = { generated_at: new Date().toISOString(), status, model: config.model, model_variant: config.modelVariant,
    stage_version: STAGE_VERSIONS.records, run_directory: directory, artifact_directory: artifactDirectory,
    cohort: { scope: cohort.scope, family: cohort.family, source_rows: cohort.source_rows,
      presentation_duplicates_omitted: cohort.presentation_duplicates_omitted },
    family_consistency: auditRecordCohort(entities, results.filter(row => row.status === "passed" && row.embedding_record).map(row => row.embedding_record), cohort),
    sample, total: results.length, completed: results.filter((row) => ["passed", "failed", "quarantined"].includes(row.status)).length,
    accepted: results.filter((row) => row.status === "passed").length, export_error: exportError, results };
  // Refresh immediately and after each result. A running or interrupted run must
  // not leave the stable report looking like the previous successful run.
  const localReport = join(directory, "live-report.json");
  for (const path of new Set([localReport, reportPath])) {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(summary, null, 2) + "\n");
    renameSync(temporary, path);
  }
  return summary;
}
let cursor = 0;
saveReport("running");
await Promise.all(Array.from({ length: pool.snapshot().threads }, async () => {
  while (cursor < entities.length) {
    const entity = entities[cursor++];
    await processRecord(entity);
    const row = checkpoint(entity.entity_id, "records", STAGE_VERSIONS.records);
    const reason = row.error ? ` — ${String(row.error).replace(/\s+/g, " ")}` : "";
    process.stderr.write(`${entity.character} U+${entity.hex.toUpperCase()} ${row.status} (${row.quality?.model_calls ?? 0} calls)${reason}\n`);
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
process.stdout.write(JSON.stringify({ report: reportPath, accepted: summary.accepted, total: summary.total, printed }, null, 2) + "\n");
process.stderr.write(`All ${summary.total} results saved to ${reportPath}\n`);
if (exportError || summary.accepted < summary.total || !summary.family_consistency.complete) process.exitCode = 1;
