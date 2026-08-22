import { config, STAGE_VERSIONS } from "../config.mjs";
import { parseBlindGenerationOutput, parseBlindRecoveryOutput, VISUAL_SLOTS } from "../contracts.mjs";
import { extractJsonMatching } from "../jsonextract.mjs";
import { LlmJob } from "../llm.mjs";
import { emit } from "../log.mjs";
import {
  claimContradictsFormalIdentity,
  contentHash,
  normalizePhrase,
  normalizeTerm,
  uniqueVisualEntities,
} from "../normalize.mjs";
import { pool } from "../pool.mjs";
import {
  BLIND_GENERATE_SYSTEM,
  BLIND_RECOVER_SYSTEM,
  blindGenerateUser,
  blindRecoverUser,
} from "../prompts.mjs";
import {
  RenderQuarantineError,
  renderVendorPair,
  requireRealNotoFont,
  vendorPairFingerprint,
} from "../render.mjs";
import {
  beginCheckpoint,
  claimsV2ForEntity,
  fallbackNeighborsFor,
  finishCheckpoint,
  freezeEvaluationHoldout,
  modifierNeighborsFor,
  neighborsFor,
  nextCheckpointEntities,
  upsertClaimsV2,
  upsertQueriesV2,
} from "../state.mjs";
import { collectContractVotes, runConcurrentUnits, stageInputHash, uniqueTag } from "./common.mjs";

const NUMBER_WORDS = new Set(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);
const LOW_INFORMATION_WORDS = new Set([
  ...NUMBER_WORDS,
  "single", "multiple", "component", "components", "element", "elements", "object", "objects", "shape", "shapes",
  "glyph", "icon", "mark", "symbol", "part", "parts",
  "solid", "filled", "fill", "outline", "outlined", "hollow", "gradient", "shaded", "shading",
  "black", "white", "gray", "grey", "red", "orange", "yellow", "green", "blue", "purple", "pink", "brown",
  "tan", "gold", "golden", "dark", "light", "pale", "bright", "medium", "background", "foreground",
]);

function phraseForSlot(slots, slot) {
  return slots?.[slot]?.phrase ?? null;
}

export function isUsefulVisualPhrase(slot, value) {
  if (!["overall_form", "distinctive_feature"].includes(slot)) return false;
  const phrase = normalizePhrase(value, { maxWords: 24, maxLength: 240 });
  if (!phrase) return false;
  const useful = normalizeTerm(phrase.normalized)
    .split(" ")
    .filter((token) => token && !/^\d+$/.test(token) && !LOW_INFORMATION_WORDS.has(token));
  return useful.length >= 2;
}

export { claimContradictsFormalIdentity };

/** Structural checks only; semantic cross-slot coherence is handled by recovery. */
export function assertAdaptiveBlindGeneration(generation) {
  if (generation.render_status !== "clear") return generation;
  for (const vendor of config.renderVendors) {
    const slots = generation.vendor_slots?.[vendor];
    const populated = VISUAL_SLOTS.filter((slot) => phraseForSlot(slots, slot));
    if (populated.length < 2) {
      const error = new Error(`${vendor} description has fewer than two perceptible slots`);
      error.details = { kind: "cross_slot_incoherent", reason: "insufficient_slots", vendor, populated };
      throw error;
    }
    if (!["overall_form", "distinctive_feature"].some((slot) =>
      isUsefulVisualPhrase(slot, phraseForSlot(slots, slot)))) {
      const error = new Error(`${vendor} description lacks a useful shape anchor`);
      error.details = { kind: "cross_slot_incoherent", reason: "no_useful_shape_anchor", vendor, populated };
      throw error;
    }
  }
  const sharedAnchor = ["overall_form", "distinctive_feature"].some((slot) =>
    isUsefulVisualPhrase(slot, phraseForSlot(generation.shared_slots, slot)));
  if (!sharedAnchor) {
    const error = new Error("Dual-vendor generation has no useful shared shape/detail");
    error.details = { kind: "cross_vendor_incoherent", reason: "no_shared_shape_anchor" };
    throw error;
  }
  const usefulClaims = generation.claims.filter((claim) => isUsefulVisualPhrase(claim.slot, claim.phrase));
  if (usefulClaims.length !== generation.claims.length || usefulClaims.length === 0) {
    const error = new Error("Dual-vendor generation contains generic or unusable standalone claims");
    error.details = { kind: "low_information_claim", useful: usefulClaims.length, total: generation.claims.length };
    throw error;
  }
  return generation;
}

function callRunIds(collected) {
  return [...new Set([
    ...collected.accepted.map((entry) => entry.job.runDbId),
    ...collected.errors.map((error) => error.run_id).filter(Number.isInteger),
  ])];
}

function renderRecord(render) {
  return { vendor: render.vendor, png: render.path, validation: render.analysis };
}

async function renderContext(entity, candidates) {
  const targetPair = await renderVendorPair(entity, uniqueTag("blind-adaptive-target", [entity]));
  const fingerprints = new Map([[vendorPairFingerprint(targetPair), entity.entity_id]]);
  const renderedNeighbors = [];
  for (const [index, neighbor] of candidates.entries()) {
    if (renderedNeighbors.length >= config.contrastNeighbors) break;
    try {
      const pair = await renderVendorPair(neighbor, uniqueTag(`blind-adaptive-neighbor-${index}`, [entity, neighbor]));
      const fingerprint = vendorPairFingerprint(pair);
      if (fingerprint && fingerprints.has(fingerprint)) {
        emit("render_candidate_duplicate", {
          stage: "blind_ground",
          entity_id: neighbor.entity_id,
          kept_entity_id: fingerprints.get(fingerprint),
          reason: "vendor_pair_fingerprint",
        });
        continue;
      }
      renderedNeighbors.push({
        label: `neighbor-${renderedNeighbors.length + 1}`,
        entity: neighbor,
        pair,
      });
      if (fingerprint) fingerprints.set(fingerprint, neighbor.entity_id);
    } catch (error) {
      emit("neighbor_render_skipped", {
        stage: "blind_ground",
        entity_id: entity.entity_id,
        neighbor_id: neighbor.entity_id,
        reason: error.message,
      });
    }
  }
  return {
    target: { label: "target", entity, pair: targetPair },
    neighbors: renderedNeighbors,
  };
}

function renderMapping(rendered) {
  return [rendered.target, ...rendered.neighbors].map((candidate, position) => ({
    candidate_label: candidate.label,
    role: position === 0 ? "target" : "confusion_neighbor",
    attachments: candidate.pair.vendors.map((vendor, vendorPosition) => ({
      vendor,
      ordinal: position * config.renderVendors.length + vendorPosition + 1,
    })),
  }));
}

function shuffledRecoveryCandidates(entity, neighbors) {
  return [entity, ...neighbors.map((row) => row.entity)]
    .map((candidate) => ({
      entity_id: candidate.entity_id,
      glyph: candidate.character,
      hex: candidate.hex,
      category: candidate.general_category,
    }))
    .sort((left, right) =>
      contentHash(`${entity.entity_id}:${left.entity_id}`).localeCompare(contentHash(`${entity.entity_id}:${right.entity_id}`)));
}

function acceptedClaims(entity, generation, recovery, neighborIdsByLabel, runIds) {
  const reviews = new Map(recovery.reviews.map((review) => [review.claim_key, review]));
  return generation.claims
    .map((claim) => {
      const rejected = new Set(reviews.get(claim.claim_key)?.rejected_queries ?? []);
      return { ...claim, queries: claim.queries.filter((query) => !rejected.has(query.normalized_query)) };
    })
    .filter((claim) => reviews.get(claim.claim_key)?.verdict === "supported" && claim.queries.length >= 2)
    .filter((claim) => !claimContradictsFormalIdentity(entity, claim.phrase))
    .map((claim) => ({
      entity_id: entity.entity_id,
      family: claim.family,
      phrase: claim.phrase,
      normalized_phrase: claim.normalized_phrase,
      confidence: 1,
      status: "verified",
      source_stage: "blind_ground",
      prompt_version: STAGE_VERSIONS.blind_ground,
      evidence: {
        slot: claim.slot,
        slots: [claim.slot],
        agreement: 1,
        support_count: config.renderVendors.length,
        clear_votes: config.renderVendors.length,
        vendor_support: Object.fromEntries(config.renderVendors.map((vendor) => [vendor, 1])),
        distinguishes_from: claim.distinguishes_from.map((label) => neighborIdsByLabel.get(label)).filter(Boolean),
        generation_run_id: runIds.generation[0] ?? null,
        recovery_run_id: runIds.recovery[0] ?? null,
      },
      verifier: {
        verdict: "supported",
        reason: reviews.get(claim.claim_key)?.reason ?? "blind recovery supported the claim",
        support_count: 1,
        clear_votes: 1,
        confidence: 1,
        decision_rule: "adaptive-two-call-blind-recovery-v1",
        run_ids: runIds.recovery,
        prompt_version: STAGE_VERSIONS.verify,
      },
      claim_key: claim.claim_key,
      queries: claim.queries,
      distinguishes_from: claim.distinguishes_from,
    }));
}

function persistQueries(entity, claims, neighborIdsByLabel) {
  const storedClaims = new Map(claimsV2ForEntity(entity.entity_id)
    .filter((claim) => claim.prompt_version === STAGE_VERSIONS.blind_ground)
    .map((claim) => [claim.normalized_phrase, claim]));
  const rows = claims.flatMap((claim) => {
    const stored = storedClaims.get(claim.normalized_phrase);
    if (!stored) return [];
    const competitors = claim.distinguishes_from.map((label) => neighborIdsByLabel.get(label)).filter(Boolean);
    return claim.queries.map((query) => ({
      entity_id: entity.entity_id,
      query: query.query,
      normalized_query: query.normalized_query,
      qclass: claim.family === "constraint" ? "constraint" : "visual",
      intent: `find the character described as ${claim.phrase}`,
      confidence: 1,
      claim_ids: [stored.id],
      must_beat: claim.family === "constraint" ? competitors : [],
      must_not: [],
      prompt_version: STAGE_VERSIONS.synth,
    }));
  });
  if (rows.length) upsertQueriesV2(rows);
  return rows.length;
}

async function processBlindGroundEntity(entity) {
  const neighborCandidates = uniqueVisualEntities([entity, ...[
    ...modifierNeighborsFor(entity.entity_id, 2),
    ...neighborsFor(entity.entity_id, config.contrastNeighbors * 2),
    ...fallbackNeighborsFor(entity.entity_id, config.contrastNeighbors * 2),
  ]]).slice(1);
  const payload = {
    entity_id: entity.entity_id,
    neighbor_ids: neighborCandidates.map((neighbor) => neighbor.entity_id),
    vendors: config.renderVendors,
    slots: VISUAL_SLOTS,
    architecture: "adaptive-two-call",
  };
  const inputHash = stageInputHash("blind_ground", STAGE_VERSIONS.blind_ground, payload);
  beginCheckpoint({ entityId: entity.entity_id, stage: "blind_ground", version: STAGE_VERSIONS.blind_ground, inputHash });

  let rendered;
  try {
    rendered = await renderContext(entity, neighborCandidates);
  } catch (error) {
    const quarantined = error instanceof RenderQuarantineError;
    finishCheckpoint({
      entityId: entity.entity_id,
      stage: "blind_ground",
      version: STAGE_VERSIONS.blind_ground,
      status: quarantined ? "quarantined" : "failed",
      error: `render: ${error.message}`,
      quality: {
        reason: quarantined ? (error.details?.reason ?? "deterministic_render_quarantine") : "render_failure",
        render_validation: error.details ?? null,
        model_calls: 0,
      },
    });
    emit("stage_error", { stage: "blind_ground", entity_id: entity.entity_id, error: error.message });
    return 1;
  }

  if (rendered.neighbors.length === 0) {
    finishCheckpoint({
      entityId: entity.entity_id,
      stage: "blind_ground",
      version: STAGE_VERSIONS.blind_ground,
      status: "quarantined",
      error: "No renderable confusion neighbors for blind recovery",
      quality: { reason: "no_renderable_confusion_neighbors", model_calls: 0 },
    });
    return 1;
  }

  const mapping = renderMapping(rendered);
  const images = [rendered.target, ...rendered.neighbors].flatMap((candidate) => candidate.pair.images);
  const generated = await collectContractVotes({
    desired: 1,
    retries: Math.min(1, config.contractRetries),
    stage: "blind_ground",
    makeJob: () => pool.submit(new LlmJob({
      stage: "blind_ground",
      scope: { entity: entity.entity_id, phase: "dual_vendor_generate", neighbors: rendered.neighbors.length },
      system: BLIND_GENERATE_SYSTEM,
      user: blindGenerateUser(mapping),
      images,
      promptVersion: STAGE_VERSIONS.blind_ground,
    })),
    parse: (job) => assertAdaptiveBlindGeneration(parseBlindGenerationOutput(
      extractJsonMatching(job.text, (value) => value?.vendor_slots && Array.isArray(value?.claims)) ?? job.json,
      { vendors: config.renderVendors, neighborLabels: rendered.neighbors.map((row) => row.label) },
    )),
  });
  const generationRunIds = callRunIds(generated);
  if (generated.accepted.length !== 1) {
    finishCheckpoint({
      entityId: entity.entity_id,
      stage: "blind_ground",
      version: STAGE_VERSIONS.blind_ground,
      status: "failed",
      error: "Generation calls exhausted the bounded JSON/quality repair retry",
      runIds: generationRunIds,
      quality: { reason: "generation_contract_failed", contract_errors: generated.errors, model_calls: generated.launched },
    });
    return 1;
  }
  const generation = generated.accepted[0].value;
  if (generation.render_status !== "clear") {
    finishCheckpoint({
      entityId: entity.entity_id,
      stage: "blind_ground",
      version: STAGE_VERSIONS.blind_ground,
      status: "quarantined",
      output: { adaptive_generation: generation, renders: rendered.target.pair.renders.map(renderRecord) },
      error: "Dual-vendor target remained visually ambiguous",
      runIds: generationRunIds,
      quality: { reason: "ambiguous_generation", model_calls: generated.launched },
    });
    return 1;
  }

  const candidates = shuffledRecoveryCandidates(entity, rendered.neighbors);
  const recoveryPayload = {
    claims: generation.claims.map((claim) => ({
      claim_key: claim.claim_key,
      family: claim.family,
      phrase: claim.phrase,
      queries: claim.queries.map((query) => query.query),
    })),
    candidates,
  };
  const recovered = await collectContractVotes({
    desired: 1,
    retries: Math.min(1, config.contractRetries),
    stage: "blind_ground",
    makeJob: () => pool.submit(new LlmJob({
      stage: "blind_ground",
      scope: { entity: entity.entity_id, phase: "blind_recovery", candidates: candidates.length },
      system: BLIND_RECOVER_SYSTEM,
      user: blindRecoverUser(recoveryPayload),
      promptVersion: STAGE_VERSIONS.blind_ground,
    })),
    parse: (job) => parseBlindRecoveryOutput(
      extractJsonMatching(job.text, (value) => Object.hasOwn(value ?? {}, "picked_entity_id") && Array.isArray(value?.reviews)) ?? job.json,
      {
        claims: generation.claims,
        validEntityIds: new Set(candidates.map((candidate) => candidate.entity_id)),
      },
    ),
  });
  const recoveryRunIds = callRunIds(recovered);
  const allRunIds = [...generationRunIds, ...recoveryRunIds];
  if (recovered.accepted.length !== 1) {
    finishCheckpoint({
      entityId: entity.entity_id,
      stage: "blind_ground",
      version: STAGE_VERSIONS.blind_ground,
      status: "failed",
      output: { adaptive_generation: generation, renders: rendered.target.pair.renders.map(renderRecord) },
      error: "Blind-recovery calls exhausted the bounded JSON repair retry",
      runIds: allRunIds,
      quality: {
        reason: "recovery_contract_failed",
        contract_errors: recovered.errors,
        model_calls: generated.launched + recovered.launched,
      },
    });
    return 1;
  }

  const recovery = recovered.accepted[0].value;
  const neighborIdsByLabel = new Map(rendered.neighbors.map((row) => [row.label, row.entity.entity_id]));
  const claims = acceptedClaims(entity, generation, recovery, neighborIdsByLabel, {
    generation: generationRunIds,
    recovery: recoveryRunIds,
  });
  const passed = recovery.picked_entity_id === entity.entity_id && claims.length > 0;
  const output = {
    adaptive_generation: generation,
    recovery: {
      ...recovery,
      expected_entity_id: entity.entity_id,
      passed,
    },
    accepted_claims: claims.map(({ queries, distinguishes_from, ...claim }) => claim),
    renders: rendered.target.pair.renders.map(renderRecord),
    neighbor_renders: rendered.neighbors.map((row) => ({
      label: row.label,
      entity_id: row.entity.entity_id,
      renders: row.pair.renders.map(renderRecord),
    })),
  };
  if (!passed) {
    finishCheckpoint({
      entityId: entity.entity_id,
      stage: "blind_ground",
      version: STAGE_VERSIONS.blind_ground,
      status: "quarantined",
      output,
      error: recovery.picked_entity_id === entity.entity_id
        ? "Blind recovery rejected every generated claim"
        : "Claims did not recover the target from its confusion neighbors",
      runIds: allRunIds,
      quality: {
        reason: recovery.picked_entity_id === entity.entity_id ? "no_supported_claims" : "non_discriminative_claims",
        picked_entity_id: recovery.picked_entity_id,
        supported_claims: claims.length,
        model_calls: generated.launched + recovered.launched,
      },
    });
    return 1;
  }

  upsertClaimsV2(claims);
  const queryCount = persistQueries(entity, claims, neighborIdsByLabel);
  output.query_count = queryCount;
  finishCheckpoint({
    entityId: entity.entity_id,
    stage: "blind_ground",
    version: STAGE_VERSIONS.blind_ground,
    status: "passed",
    output,
    quality: {
      architecture: "adaptive-two-call",
      model_calls: generated.launched + recovered.launched,
      render_vendors: config.renderVendors.length,
      rendered_neighbors: rendered.neighbors.length,
      proposed_claims: generation.claims.length,
      accepted_claims: claims.length,
      generated_queries: queryCount,
      recovery_top1: 1,
      cross_vendor_agreement: "single_joint_observation",
    },
    runIds: allRunIds,
  });
  return 1;
}

export async function runBlindGround(limit = 100) {
  requireRealNotoFont();
  freezeEvaluationHoldout();
  const result = await runConcurrentUnits({
    limit,
    maxInFlight: () => blindGroundEntityConcurrency(pool.snapshot().threads),
    next: () => {
      const [entity] = nextCheckpointEntities({
        stage: "blind_ground",
        version: STAGE_VERSIONS.blind_ground,
        limit: 1,
        maxAttempts: config.maxAttempts,
      });
      return entity ? { entity, size: 1 } : null;
    },
    run: ({ entity }) => processBlindGroundEntity(entity),
    onProgress: ({ completed, scheduled, active }) => emit("stage_progress", {
      stage: "blind_ground", processed: completed, scheduled, requested: limit, active_entities: active,
    }),
  });
  return result.completed;
}

export function blindGroundEntityConcurrency(threads) {
  return Math.max(1, Math.min(config.maxThreads, Number(threads) || 1));
}

export const runGround = runBlindGround;
