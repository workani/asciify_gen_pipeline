import { config, STAGE_VERSIONS } from "../config.mjs";
import { parseRecoverOutput } from "../contracts.mjs";
import { extractJsonMatching } from "../jsonextract.mjs";
import { LlmJob } from "../llm.mjs";
import { emit } from "../log.mjs";
import { contentHash } from "../normalize.mjs";
import { pool } from "../pool.mjs";
import { RECOVER_SYSTEM, recoverUser } from "../prompts.mjs";
import {
  beginCheckpoint,
  claimsV2ForEntity,
  finishCheckpoint,
  markCheckpointsStale,
  neighborsFor,
  nextCheckpointEntities,
} from "../state.mjs";
import { collectContractVotes, runConcurrentUnits, stageInputHash } from "./common.mjs";

function recoveryContext(entity) {
  const claims = claimsV2ForEntity(entity.entity_id, { statuses: ["verified", "platform_specific"] })
    .map((claim) => ({ family: claim.family, phrase: claim.phrase, scope: claim.status }));
  const neighbors = neighborsFor(entity.entity_id, config.contrastNeighbors);
  const candidates = [entity, ...neighbors]
    .map((candidate) => ({
      entity_id: candidate.entity_id,
      glyph: candidate.character,
      hex: candidate.hex,
      category: candidate.general_category,
    }))
    .sort((a, b) => contentHash(`${entity.entity_id}:${a.entity_id}`).localeCompare(contentHash(`${entity.entity_id}:${b.entity_id}`)));
  return { claims, neighbors, candidates };
}

async function processRecoverEntity(entity) {
  const context = recoveryContext(entity);
  const payload = { anonymous_claims: context.claims, candidates: context.candidates };
  const inputHash = stageInputHash("recover", STAGE_VERSIONS.recover, payload);
  beginCheckpoint({ entityId: entity.entity_id, stage: "recover", version: STAGE_VERSIONS.recover, inputHash });
  if (!context.claims.length || context.candidates.length < 2) {
    finishCheckpoint({
      entityId: entity.entity_id, stage: "recover", version: STAGE_VERSIONS.recover,
      status: "failed", error: !context.claims.length ? "No verified claims to recover" : "No confusion neighbors to test",
      quality: { recoverable: false, claims: context.claims.length, candidates: context.candidates.length },
    });
    return 1;
  }

  const validIds = new Set(context.candidates.map((candidate) => candidate.entity_id));
  const collected = await collectContractVotes({
    desired: config.recoverVotes,
    retries: config.contractRetries,
    stage: "recover",
    makeJob: () => pool.submit(new LlmJob({
      stage: "recover",
      scope: { entity: entity.entity_id, candidates: context.candidates.length },
      system: RECOVER_SYSTEM,
      user: recoverUser(payload),
      promptVersion: STAGE_VERSIONS.recover,
    })),
    parse: (job) => parseRecoverOutput(
      extractJsonMatching(job.text, (value) => value && Object.hasOwn(value, "picked_entity_id")) ?? job.json,
      validIds,
    ),
  });
  const votes = collected.accepted.map((entry) => entry.value);
  const runIds = collected.accepted.map((entry) => entry.job.runDbId);
  if (votes.length < config.recoverVotes) {
    finishCheckpoint({
      entityId: entity.entity_id, stage: "recover", version: STAGE_VERSIONS.recover,
      status: "failed", error: `Insufficient valid votes: ${votes.length}/${config.recoverVotes}`,
      quality: { contract_errors: collected.errors }, runIds,
    });
    return 1;
  }

  const supportCount = votes.filter((vote) => vote.picked_entity_id === entity.entity_id).length;
  const passed = supportCount === votes.length;
  finishCheckpoint({
    entityId: entity.entity_id, stage: "recover", version: STAGE_VERSIONS.recover,
    status: passed ? "passed" : "failed",
    output: { votes, picked_correctly: supportCount, expected_entity_id: entity.entity_id },
    quality: {
      recoverable: passed,
      support_count: supportCount,
      clear_votes: votes.length,
      confidence: supportCount / votes.length,
      candidates: context.candidates.length,
      claims: context.claims.length,
    },
    error: passed ? null : "Claims were non-discriminative; scheduled another contrastive pass",
    runIds,
  });
  if (!passed) {
    markCheckpointsStale(
      entity.entity_id,
      ["contrast", "verify", "rewrite", "reverify"],
      "recover stage could not identify the target; repeat the contrastive loop",
    );
    emit("contrast_retry_scheduled", { entity_id: entity.entity_id, picked: votes.map((vote) => vote.picked_entity_id) });
  }
  return 1;
}

export async function runRecover(limit = 60) {
  const seen = new Set();
  const result = await runConcurrentUnits({
    limit,
    maxInFlight: () => Math.max(1, Math.floor(pool.snapshot().threads / config.recoverVotes)),
    next: () => {
      const entities = nextCheckpointEntities({
        stage: "recover",
        version: STAGE_VERSIONS.recover,
        prerequisite: { stage: "reverify", version: STAGE_VERSIONS.reverify },
        limit: Math.max(16, limit),
        maxAttempts: config.maxAttempts,
      });
      const entity = entities.find((candidate) => !seen.has(candidate.entity_id));
      if (!entity) return null;
      seen.add(entity.entity_id);
      return { entity, size: 1 };
    },
    run: ({ entity }) => processRecoverEntity(entity),
    onProgress: ({ completed, scheduled, active }) => emit("stage_progress", {
      stage: "recover", processed: completed, scheduled, requested: limit, active_entities: active,
    }),
  });
  return result.completed;
}
