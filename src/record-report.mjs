import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config, STAGE_VERSIONS } from "./config.mjs";
import { generationGroup } from "./selection.mjs";
import { checkpoint } from "./state.mjs";
import { auditRecordCohort } from "./record-cohort.mjs";

// Shared report shape for record cohorts. `test.sh` (isolated DB) and
// `generator --100` (main DB) both emit this, so a run against the fixed
// cohort is comparable no matter which entry point produced it.
export function recordResults(entities) {
  return entities.map((entity) => {
    const row = checkpoint(entity.entity_id, "records", STAGE_VERSIONS.records);
    return { entity_id: entity.entity_id, glyph: entity.character, hex: entity.hex, status: row?.status ?? "not_started",
      quality: row?.quality ?? null, embedding_record: row?.output?.embedding_record ?? null,
      baseline: row?.output?.baseline ?? [], draft: row?.output?.draft ?? null,
      fact_review: row?.output?.fact_review ?? null, discovery: row?.output?.discovery ?? null,
      vocabulary_review: row?.output?.vocabulary_review ?? null, contribution: row?.output?.vocabulary?.contribution ?? null, source_context: row?.output?.source_context ?? null,
      model: row?.output?.model ?? config.model, model_variant: row?.output?.model_variant ?? config.modelVariant,
      run_ids: row?.run_ids ?? [], error: row?.error ?? null };
  });
}

export const isCompleted = (row) => ["passed", "failed", "quarantined"].includes(row.status);

export function buildRecordReport({ entities, cohort, status, results = recordResults(entities),
  runDirectory = null, artifactDirectory = null, exportError = null }) {
  return { generated_at: new Date().toISOString(), status, model: config.model, model_variant: config.modelVariant,
    stage_version: STAGE_VERSIONS.records, run_directory: runDirectory, artifact_directory: artifactDirectory,
    cohort: { scope: cohort.scope, family: cohort.family, source_rows: cohort.source_rows,
      presentation_duplicates_omitted: cohort.presentation_duplicates_omitted },
    family_consistency: auditRecordCohort(entities, results.filter(row => row.status === "passed" && row.embedding_record).map(row => row.embedding_record), cohort),
    sample: entities.map((row) => ({ glyph: row.character, hex: row.hex, family: cohort.family ?? null, group: generationGroup(row) })),
    // `total` is the cohort size, not the result count: run100.json appends
    // characters as they finish, so results grows toward total.
    total: entities.length, completed: results.filter(isCompleted).length,
    accepted: results.filter((row) => row.status === "passed").length, export_error: exportError, results };
}

export function writeRecordReport(paths, summary) {
  for (const path of new Set(paths)) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(summary, null, 2) + "\n");
    renameSync(temporary, path);
  }
  return summary;
}
