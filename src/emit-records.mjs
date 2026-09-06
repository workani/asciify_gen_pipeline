import { auditRecordCohort } from "./record-cohort.mjs";
import { resolveTaxonomy, SUBFAMILIES, TAXONOMY_VERSION, UNICODE_VERSION } from './taxonomy.mjs';
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { config, PIPELINE_VERSION, STAGE_VERSIONS } from "./config.mjs";
import { FAMILIES, RECORD_SCHEMA_VERSION, compileEmbeddingRecord, parseRecord, parseRecordReview } from "./records.mjs";
import { baselineVocabulary, parseDiscovery, parseVocabularyReview, vocabularyReviewPayload, compileVocabulary, intentEmbeddingCandidates } from "./record-vocabulary.mjs";
import { existingVocabulary } from "./record-context.mjs";
import { checkpoint, checkpointSummary, selectedEntities } from "./state.mjs";
import { emit } from "./log.mjs";

export async function emitRecordArtifacts({ allowPartial = false } = {}) {
  const entities = selectedEntities();
  const records = [], evidence = [], excluded = [], attempts = [], intentDocuments = [], baselineSources = [];
  for (const entity of entities) {
    const row = checkpoint(entity.entity_id, "records", STAGE_VERSIONS.records);
    if (row) attempts.push({ entity_id: entity.entity_id, status: row.status, error: row.error,
      attempts: row.output?.attempt_audit ?? [], quality: row.quality });
    if (row?.status !== "passed") { excluded.push({ entity_id: entity.entity_id, reason: row?.status ?? "not_generated" }); continue; }
    const current = await existingVocabulary(entity);
    if (current.fingerprint !== row.output?.vocabulary_fingerprint) {
      excluded.push({ entity_id: entity.entity_id, reason: "source_vocabulary_changed" }); continue;
    }
    try {
      if (JSON.stringify(row.output.source_context?.taxonomy) !== JSON.stringify(resolveTaxonomy(entity))) {
        throw new Error("source taxonomy changed or missing");
      }
      const renders = row.output.renders ?? [];
      const { record, warnings } = parseRecord(row.output.draft, entity, { renders });
      const { entity_id, checks } = row.output.fact_review;
      const review = parseRecordReview({ entity_id, checks }, record, { renders });
      if (!review.accepted) throw new Error("record lacks accepted factual review");
      const baseline = baselineVocabulary(entity, current);
      const discovery = parseDiscovery(row.output.discovery, record);
      const assessment = parseVocabularyReview(vocabularyReviewPayload(row.output.vocabulary_review), discovery, baseline);
      const vocabulary = compileVocabulary(discovery, assessment, baseline);
      records.push(compileEmbeddingRecord(record, entity, { renders, baseline, vocabulary }));
      intentDocuments.push(...intentEmbeddingCandidates(entity.entity_id, vocabulary));
      baselineSources.push({ entity_id: entity.entity_id, fingerprint: current.fingerprint, sources: current.sources });
      evidence.push({ entity_id: entity.entity_id, stage_version: STAGE_VERSIONS.records, run_ids: row.run_ids,
        input_hash: row.input_hash, ...row.output,
        evidence_warnings: { draft: warnings, fact_review: review.warnings } });
    } catch (error) { excluded.push({ entity_id: entity.entity_id, reason: `invalid_review: ${error.message}` }); }
  }
  const failures = [];
  if (!records.length) failures.push("no reviewed records available");
  if (excluded.length) failures.push(`${excluded.length}/${entities.length} selected entities lack current reviewed records`);
  const reviews = attempts.flatMap((row) => row.attempts.filter((a) => a.review));
  const counts = (phase, field, values) => Object.fromEntries(values.map((value) => [value,
    reviews.filter((a) => a.phase === phase).flatMap((a) => a.review.checks).filter((c) => c[field] === value).length]));
  const quality = {
    family_consistency: auditRecordCohort(entities, records),
    selected: entities.length, reviewed: records.length, excluded, checkpoints: checkpointSummary(),
    factual_verdicts_all_attempts: counts("fact_review", "verdict", ["supported", "wrong", "unsupported", "uncertain"]),
    candidate_relevance_all_attempts: counts("vocabulary_review", "relevance", ["direct", "related", "unsupported", "uncertain"]),
    contract_rejections: attempts.reduce((n, row) => n + row.attempts.filter((a) => a.outcome === "contract_rejected").length, 0),
    evidence_warnings: evidence.flatMap(row => Object.entries(row.evidence_warnings).flatMap(([phase, warnings]) =>
      warnings.map(warning => ({ entity_id: row.entity_id, phase, ...warning })))),
    contributions: records.map((row) => ({ entity_id: row.entity_id, ...row.contribution })),
    reviewer_calibration: "not_run", measured_search_improvement: null,
    note: "Generator-only artifact. Factual support and model-assessed intent overlap are separate. Proposed new intents are not proof of search improvement. No integration or retrieval benchmark is performed.",
  };
  if (failures.length && !allowPartial) throw new Error(`Record export refused: ${failures.join("; ")}. Use --allow-partial for an explicitly incomplete inspection artifact.`);
  const directory = join(config.outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${PIPELINE_VERSION}`);
  mkdirSync(directory, { recursive: true });
  const files = {};
  const write = (name, body) => {
    writeFileSync(join(directory, name), body);
    files[name] = { sha256: createHash("sha256").update(body).digest("hex"), bytes: Buffer.byteLength(body) };
  };
  const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  write("embedding_records.jsonl", jsonl(records));
  write("record_evidence.jsonl", jsonl(evidence));
  write("record_attempts.jsonl", jsonl(attempts));
  write("baseline_sources.jsonl", jsonl(baselineSources));
  write("baseline_vocabulary.jsonl", jsonl(records.flatMap((row) => row.baseline_vocabulary.map((entry) => ({ entity_id: row.entity_id, ...entry })))));
  write("retrieval_vocabulary.jsonl", jsonl(records.flatMap((row) => row.retrieval_phrases.map((phrase) => ({ entity_id: row.entity_id, ...phrase })))));
  write("intent_embedding_candidates.jsonl", jsonl(intentDocuments));
  write("family_catalog.json", JSON.stringify(FAMILIES, null, 2) + "\n");
  write("subfamily_catalog.json", JSON.stringify(SUBFAMILIES, null, 2) + "\n");
  write("quality_report.json", JSON.stringify(quality, null, 2) + "\n");
  write("records.md", records.map((row) => `### ${row.character} — ${row.name}\n\n${row.embedding_text}\n`).join("\n"));
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ schema_version: RECORD_SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION, taxonomy_version: TAXONOMY_VERSION, unicode_version: UNICODE_VERSION, stage_version: STAGE_VERSIONS.records, model: config.model,
    model_variant: config.modelVariant, partial: failures.length > 0, gate_failures: failures,
    records: records.length, vectors_created: 0, character_description_documents: records.length,
    optional_intent_documents: intentDocuments.length, document_merge_key: "entity_id",
    contract: { baseline: "preserved lexical data, not new discoveries", description: "one compact document per entity",
      intents: "optional text candidates, one per grounded meaning/use group; no automatic embedding or promotion",
      collections: "deferred to later curation", phrases: "distinct grounded lexical variants, grouped by intent; never exact-query winner rules" },
    integration: "none", measured_search_improvement: null, files }, null, 2) + "\n");
  emit("emit", { directory, records: records.length, partial: failures.length > 0 });
  return directory;
}
