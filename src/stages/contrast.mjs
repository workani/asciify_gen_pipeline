import { config, STAGE_VERSIONS } from "../config.mjs";
import { parseEnrichOutput } from "../contracts.mjs";
import { extractJsonMatching } from "../jsonextract.mjs";
import { LlmJob } from "../llm.mjs";
import { emit } from "../log.mjs";
import { uniqueVisualEntities } from "../normalize.mjs";
import { pool } from "../pool.mjs";
import { CONTRAST_SYSTEM, contrastUser } from "../prompts.mjs";
import { RenderQuarantineError, renderVendorPair, vendorPairFingerprint } from "../render.mjs";
import {
  beginCheckpoint,
  checkpoint,
  claimsV2ForEntity,
  finishCheckpoint,
  neighborsFor,
  nextCheckpointEntities,
  upsertClaimsV2,
} from "../state.mjs";
import {
  collectContractVotes,
  compactEntity,
  compactNeighbor,
  runConcurrentUnits,
  stageInputHash,
  uniqueTag,
} from "./common.mjs";

const CONTEXT_LANGUAGE = /\b(?:image|index|grid|cell|candidate\s+(?:one|two|three|four|five|six|\d+))\b/i;

export function mergeContrastClaims(entity, votes, runIds) {
  const rows = new Map();
  for (const vote of votes) {
    const item = vote.find((entry) => entry.entity_id === entity.entity_id);
    for (const claim of item?.claims ?? []) {
      if (claim.family !== "constraint" || CONTEXT_LANGUAGE.test(claim.phrase)) continue;
      const row = rows.get(claim.normalized_phrase) ?? { ...claim, support: 0, rationales: [] };
      row.support++;
      row.rationales.push(claim.rationale);
      rows.set(claim.normalized_phrase, row);
    }
  }
  return [...rows.values()].map((claim) => ({
    entity_id: entity.entity_id,
    family: "constraint",
    phrase: claim.phrase,
    normalized_phrase: claim.normalized_phrase,
    confidence: claim.support / Math.max(1, votes.length),
    status: "proposed",
    source_stage: "contrast",
    prompt_version: STAGE_VERSIONS.contrast,
    evidence: {
      agreement: claim.support / Math.max(1, votes.length),
      support_count: claim.support,
      clear_votes: votes.length,
      rationales: claim.rationales,
      run_ids: runIds,
    },
  }));
}

async function renderCandidates(entity, neighbors) {
  const rows = [];
  const fingerprints = new Map();
  for (const [position, candidate] of uniqueVisualEntities([entity, ...neighbors]).entries()) {
    try {
      const pair = await renderVendorPair(candidate, uniqueTag(`contrast-${entity.entity_id}-${position}`, [candidate]));
      const fingerprint = vendorPairFingerprint(pair);
      if (fingerprint && fingerprints.has(fingerprint)) {
        emit("render_candidate_duplicate", {
          stage: "contrast", entity_id: candidate.entity_id,
          kept_entity_id: fingerprints.get(fingerprint), reason: "vendor_pair_fingerprint",
        });
        continue;
      }
      rows.push({ candidate, pair });
      if (fingerprint) fingerprints.set(fingerprint, candidate.entity_id);
    } catch (error) {
      if (position === 0 || !(error instanceof RenderQuarantineError)) throw error;
      emit("render_neighbor_quarantine", {
        stage: "contrast", entity_id: entity.entity_id, neighbor_id: candidate.entity_id, error: error.message,
      });
    }
  }
  return rows;
}

async function processContrastEntity(entity) {
  const neighbors = neighborsFor(entity.entity_id, config.contrastNeighbors);
  const previousRecovery = checkpoint(entity.entity_id, "recover", STAGE_VERSIONS.recover);
  const priorClaims = previousRecovery?.status === "failed"
    ? claimsV2ForEntity(entity.entity_id)
      .filter((claim) => claim.family === "constraint")
      .map((claim) => claim.phrase)
      .slice(0, 8)
    : [];
  const payload = {
    target: compactEntity(entity),
    competitors: neighbors.map(compactNeighbor),
    vendor_order: config.renderVendors,
    prior_non_discriminative_claims: priorClaims,
    previous_recovery_result: previousRecovery?.status === "failed" ? previousRecovery.output?.votes ?? [] : [],
  };
  const inputHash = stageInputHash("contrast", STAGE_VERSIONS.contrast, payload);
  beginCheckpoint({ entityId: entity.entity_id, stage: "contrast", version: STAGE_VERSIONS.contrast, inputHash });
  if (neighbors.length === 0) {
    finishCheckpoint({
      entityId: entity.entity_id, stage: "contrast", version: STAGE_VERSIONS.contrast,
      status: "passed", output: { proposed_claims: [], reason: "no confusion neighbors" },
      quality: { neighbors: 0, proposed_claims: 0 },
    });
    return 1;
  }

  let rendered;
  try {
    rendered = await renderCandidates(entity, neighbors);
  } catch (error) {
    finishCheckpoint({
      entityId: entity.entity_id, stage: "contrast", version: STAGE_VERSIONS.contrast,
      status: error instanceof RenderQuarantineError ? "quarantined" : "failed",
      error: `render: ${error.message}`, quality: { render_validation: error.details ?? null },
    });
    return 1;
  }
  if (rendered.length < 2) {
    finishCheckpoint({
      entityId: entity.entity_id, stage: "contrast", version: STAGE_VERSIONS.contrast,
      status: "failed", error: "No renderable confusion neighbors",
    });
    return 1;
  }

  const images = rendered.flatMap((row) => row.pair.images);
  const imageMap = rendered.map((row, position) => ({
    role: position === 0 ? "target" : "neighbor",
    entity: position === 0 ? compactEntity(row.candidate) : compactNeighbor(row.candidate),
    attached_images: row.pair.vendors.map((vendor, vendorPosition) => ({
      vendor,
      attachment_ordinal: position * row.pair.vendors.length + vendorPosition + 1,
    })),
  }));
  const user = contrastUser({
    entity_id: entity.entity_id,
    target: compactEntity(entity),
    competitors: rendered.slice(1).map((row) => compactNeighbor(row.candidate)),
    render_mapping: imageMap,
    prior_non_discriminative_claims: priorClaims,
    previous_recovery_result: previousRecovery?.status === "failed" ? previousRecovery.output?.votes ?? [] : [],
  });
  const collected = await collectContractVotes({
    desired: config.contrastVotes,
    retries: config.contractRetries,
    stage: "contrast",
    makeJob: () => pool.submit(new LlmJob({
      stage: "contrast",
      scope: { entity: entity.entity_id, neighbors: rendered.length - 1 },
      system: CONTRAST_SYSTEM,
      user,
      images,
      promptVersion: STAGE_VERSIONS.contrast,
    })),
    parse: (job) => parseEnrichOutput(
      extractJsonMatching(job.text, (value) => Array.isArray(value?.items)) ?? job.json,
      [entity.entity_id],
      { claimMaxWords: 24, claimMaxLength: 240, requireClaims: true },
    ),
  });
  const votes = collected.accepted.map((entry) => entry.value);
  const runIds = collected.accepted.map((entry) => entry.job.runDbId);
  if (votes.length < config.contrastVotes) {
    finishCheckpoint({
      entityId: entity.entity_id, stage: "contrast", version: STAGE_VERSIONS.contrast,
      status: "failed", error: `Insufficient valid votes: ${votes.length}/${config.contrastVotes}`,
      quality: { contract_errors: collected.errors }, runIds,
    });
    return 1;
  }
  const claims = mergeContrastClaims(entity, votes, runIds);
  if (claims.length) upsertClaimsV2(claims);
  finishCheckpoint({
    entityId: entity.entity_id, stage: "contrast", version: STAGE_VERSIONS.contrast,
    status: claims.length ? "passed" : "failed",
    output: { proposed_claims: claims, neighbor_ids: rendered.slice(1).map((row) => row.candidate.entity_id) },
    quality: { neighbors: rendered.length - 1, proposed_claims: claims.length, valid_votes: votes.length },
    error: claims.length ? null : "No usable contrastive claims after vote merge",
    runIds,
  });
  return 1;
}

export async function runContrast(limit = 60) {
  const result = await runConcurrentUnits({
    limit,
    // The LLM pool already enforces the global call limit. Keep enough entity
    // work prefetched to cover rendering and provider stragglers; dividing the
    // entity count by vote count leaves otherwise usable worker slots empty.
    maxInFlight: () => pool.snapshot().threads,
    next: () => {
      const [entity] = nextCheckpointEntities({
        stage: "contrast",
        version: STAGE_VERSIONS.contrast,
        prerequisite: { stage: "enrich", version: STAGE_VERSIONS.enrich },
        limit: 1,
        maxAttempts: config.maxAttempts,
      });
      return entity ? { entity, size: 1 } : null;
    },
    run: ({ entity }) => processContrastEntity(entity),
    onProgress: ({ completed, scheduled, active }) => emit("stage_progress", {
      stage: "contrast", processed: completed, scheduled, requested: limit, active_entities: active,
    }),
  });
  return result.completed;
}
