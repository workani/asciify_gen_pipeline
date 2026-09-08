import { resolveTaxonomy } from '../taxonomy.mjs';
import { config, STAGE_VERSIONS } from "../config.mjs";
import { extractJsonMatching } from "../jsonextract.mjs";
import { LlmJob } from "../llm.mjs";
import { pool } from "../pool.mjs";
import { emit } from "../log.mjs";
import { renderVendorPair, RenderQuarantineError } from "../render.mjs";
import { recordContext, uniqueRecordRenders } from "../record-context.mjs";
import { RecordContractError, parseRecord, parseRecordReview, reviewPaths, compileEmbeddingRecord } from "../records.mjs";
import { baselineVocabulary, parseDiscovery, lexicalMatches, parseVocabularyReview, compileVocabulary, vocabularyReviewPayload } from "../record-vocabulary.mjs";
import { RECORD_DRAFT_SYSTEM, RECORD_REVIEW_SYSTEM, RECORD_DISCOVERY_SYSTEM, RECORD_VOCABULARY_SYSTEM,
  recordDraftUser, recordReviewUser, recordDiscoveryUser, recordVocabularyUser, blindRecordContext } from "../prompts-records.mjs";
import { beginCheckpoint, finishCheckpoint, saveCheckpointProgress, checkpoint, nextCheckpointEntities } from "../state.mjs";
import { contentHash } from "../normalize.mjs";
import { runConcurrentUnits, stageInputHash } from "./common.mjs";

const version = STAGE_VERSIONS.records;
const invisible = (entity) => /^[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}]+$/u.test(entity.character ?? "");

export async function processRecord(entity, { render = renderVendorPair, submit = (job) => pool.submit(job), contextFor = recordContext } = {}) {
  const prior = checkpoint(entity.entity_id, "records", version);
  if (prior?.status === "quarantined") return 1;
  const runIds = [...(prior?.run_ids ?? [])];
  let calls = 0, phase = "context", output = prior?.output ?? null;
  beginCheckpoint({ entityId: entity.entity_id, stage: "records", version,
    inputHash: stageInputHash("records", version, { entity, model: config.model }) });
  const finish = (status, quality, error = null) => finishCheckpoint({ entityId: entity.entity_id,
    stage: "records", version, status, output, quality: { model_calls: calls, phase, ...quality,
      evidence_warnings: Object.entries(output?.evidence_warnings ?? {}).flatMap(([phase, warnings]) => warnings.map(warning => ({ phase, ...warning }))) }, error, runIds });
  const persist = () => saveCheckpointProgress({ entityId: entity.entity_id, stage: "records", version,
    output, quality: { model_calls: calls, phase }, runIds });
  try {
    const taxonomy = resolveTaxonomy(entity);
    if (taxonomy.subfamily_gap) {
      output = {source_context:{taxonomy}, attempt_audit:[]};
      finish("quarantined", {reason:"taxonomy_enum_gap"}, `${entity.character} (${entity.entity_id}): ${taxonomy.subfamily_gap}; no supported ${taxonomy.family} subfamily is available`);
      return 1;
    }
    const pair = invisible(entity) ? { renders: [] } : await render(entity, `records-${entity.entity_id}`);
    const renders = uniqueRecordRenders(pair.renders);
    const images = renders.map((row) => row.path);
    const { context: suppliedContext, existing } = await contextFor(entity, renders);
    const context = { ...suppliedContext, taxonomy: resolveTaxonomy(entity) };
    const sourceKey = contentHash({ version, context: blindRecordContext(context), model: config.model, variant: config.modelVariant });
    const sourceMatches = prior?.output?.source_key === sourceKey;
    const baselineMatches = sourceMatches && prior.output.vocabulary_fingerprint === existing.fingerprint;
    output = {
      source_context: context, source_key: sourceKey, vocabulary_fingerprint: existing.fingerprint,
      baseline_sources: existing.sources, baseline: baselineVocabulary(entity, existing),
      model: config.model, model_variant: config.modelVariant, renders,
      attempt_audit: [...(prior?.output?.attempt_audit ?? [])], resumed_phases: [], evidence_warnings: {},
      ...(sourceMatches ? Object.fromEntries(["draft", "fact_review", "discovery"]
        .filter((key) => prior.output[key]).map((key) => [key, prior.output[key]])) : {}),
      ...(baselineMatches && prior.output.vocabulary_review ? { vocabulary_review: prior.output.vocabulary_review } : {}),
    };
    persist();

    async function step(key, system, user, parse, storedInput = (value) => value) {
      phase = key;
      if (output[key]) {
        const parsed = parse(storedInput(output[key]));
        output[key] = parsed;
        output.resumed_phases.push(key);
        persist();
        return parsed;
      }
      let contractError;
      for (let attempt = 0; attempt <= config.recordContractRepairs; attempt++) {
        calls++;
        const job = await submit(new LlmJob({ stage: "records", scope: { entities: [entity.entity_id], phase: key }, system,
          user: contractError ? JSON.stringify({ original_task: JSON.parse(user), repair: `The prior response violated the contract: ${contractError.message}. Return one complete corrected object.` }) : user,
          images, promptVersion: version }));
        if (job.runDbId != null) runIds.push(job.runDbId);
        try {
          const parsed = parse(extractJsonMatching(job.text, (value) => value?.entity_id === entity.entity_id) ?? job.json);
          output[key] = parsed;
          output.attempt_audit.push({ phase: key, run_id: job.runDbId ?? null, outcome: "parsed",
            warnings: output.evidence_warnings[key] ?? [],
            ...(["fact_review", "vocabulary_review"].includes(key) ? { review: parsed } : {}) });
          // Persist output atomically before any subsequent model call.
          persist();
          return parsed;
        } catch (error) {
          if (!(error instanceof RecordContractError)) throw error;
          contractError = error;
          output.attempt_audit.push({ phase: key, run_id: job.runDbId ?? null, outcome: "contract_rejected", error: error.message });
          persist();
        }
      }
      throw contractError;
    }

    const draft = await step("draft", RECORD_DRAFT_SYSTEM, recordDraftUser(context),
      (value) => {
        const parsed = parseRecord(value, entity, { renders });
        output.evidence_warnings.draft = parsed.warnings;
        return parsed.record;
      });
    if (draft.status !== "ready") {
      finish("quarantined", { reason: "unresolved_facts" }, draft.uncertainties.join("; ") || "Unresolved factual record"); return 1;
    }
    const factual = await step("fact_review", RECORD_REVIEW_SYSTEM, recordReviewUser(context, draft, reviewPaths(draft)),
      (value) => {
        const parsed = parseRecordReview(value, draft, { renders });
        output.evidence_warnings.fact_review = parsed.warnings;
        return parsed;
      }, ({ entity_id, checks }) => ({ entity_id, checks }));
    if (!factual.accepted) {
      finish("quarantined", { reason: "fact_review_rejected", rejected_fields: factual.checks.filter((row) => row.verdict !== "supported") }, "Independent factual review rejected the record"); return 1;
    }
    const discovery = await step("discovery", RECORD_DISCOVERY_SYSTEM, recordDiscoveryUser(context, draft),
      (value) => parseDiscovery(value, draft));
    if (!discovery.candidates.length) {
      output.vocabulary_review = { entity_id: entity.entity_id, checks: [], groups: [] };
      persist();
    }
    const assessment = await step("vocabulary_review", RECORD_VOCABULARY_SYSTEM,
      recordVocabularyUser(context, draft, discovery, output.baseline, lexicalMatches(discovery, output.baseline)),
      (value) => parseVocabularyReview(value, discovery, output.baseline), vocabularyReviewPayload);
    output.vocabulary = compileVocabulary(discovery, assessment, output.baseline);
    output.embedding_record = compileEmbeddingRecord(draft, entity, { renders, baseline: output.baseline, vocabulary: output.vocabulary });
    finish("passed", { factual_checks: factual.checks.length, ...output.vocabulary.contribution, resumed_phases: output.resumed_phases });
  } catch (error) {
    if (error.job?.runDbId != null) runIds.push(error.job.runDbId);
    if (output) {
      output.attempt_audit ??= [];
      output.attempt_audit.push({ phase, outcome: "operation_failed", error: String(error.message ?? error), run_id: error.job?.runDbId ?? null });
    }
    const quarantine = error instanceof RenderQuarantineError;
    finish(quarantine ? "quarantined" : "failed", {
      reason: quarantine ? "invalid_render" : error instanceof RecordContractError ? "record_contract" : "record_operation",
      failure_kind: error.job ? "transport" : "quality",
      ...(error.job ? { contract_errors: [{ kind: "job", message: error.message }] } : {}),
    }, String(error.message ?? error).slice(0, 1000));
  }
  return 1;
}

export async function runRecords(limit = 100) {
  const result = await runConcurrentUnits({ limit, maxInFlight: () => pool.snapshot().threads,
    next: () => {
      const [entity] = nextCheckpointEntities({ stage: "records", version, limit: 1, maxAttempts: config.maxAttempts });
      return entity ? { entity, size: 1 } : null;
    },
    run: ({ entity }) => processRecord(entity),
    onProgress: ({ completed, scheduled, unit }) => emit("stage_progress", { stage: "records", processed: completed, scheduled, requested: limit, entity: unit.entity }),
  });
  return result.completed;
}
