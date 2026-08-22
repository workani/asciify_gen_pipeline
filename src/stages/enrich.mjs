import { config, STAGE_VERSIONS } from "../config.mjs";
import { parseEnrichOutput } from "../contracts.mjs";
import { extractJsonMatching } from "../jsonextract.mjs";
import { LlmJob } from "../llm.mjs";
import { emit } from "../log.mjs";
import { pool } from "../pool.mjs";
import { ENRICH_SYSTEM, enrichUser } from "../prompts.mjs";
import {
  beginCheckpoint,
  checkpoint,
  finishCheckpoint,
  neighborsFor,
  nextCheckpointEntities,
  selectedEntity,
  upsertClaimsV2,
  upsertConfusionEdges,
} from "../state.mjs";
import {
  collectContractVotes,
  compactBlindAnalysis,
  compactEntity,
  compactNeighbor,
  runConcurrentUnits,
  stageInputHash,
} from "./common.mjs";

function mergeEnrichment(entities, parsedVotes, runIds) {
  const byEntity = new Map(entities.map((entity) => [entity.entity_id, new Map()]));
  const wrong = [];
  for (const vote of parsedVotes) {
    for (const item of vote) {
      const claims = byEntity.get(item.entity_id);
      if (!claims) continue;
      for (const claim of item.claims) {
        const key = `${claim.family}:${claim.normalized_phrase}`;
        const row = claims.get(key) ?? { ...claim, support: 0, evidence_rows: [] };
        row.support++;
        row.evidence_rows.push({
          scope: claim.scope, evidence: claim.evidence, rationale: claim.rationale,
        });
        claims.set(key, row);
      }
      for (const trap of item.tempting_but_wrong) {
        if (trap?.confused_entity_id) wrong.push({ entity_id: item.entity_id, ...trap });
      }
    }
  }
  const rowsByEntity = new Map();
  for (const entity of entities) {
    const rows = [...byEntity.get(entity.entity_id).values()].map((claim) => ({
      entity_id: entity.entity_id,
      family: claim.family,
      phrase: claim.phrase,
      normalized_phrase: claim.normalized_phrase,
      confidence: claim.support / Math.max(1, parsedVotes.length),
      status: "proposed",
      source_stage: "enrich",
      prompt_version: STAGE_VERSIONS.enrich,
      evidence: {
        agreement: claim.support / Math.max(1, parsedVotes.length),
        support_count: claim.support,
        clear_votes: parsedVotes.length,
        rows: claim.evidence_rows,
        run_ids: runIds,
      },
    }));
    rowsByEntity.set(entity.entity_id, rows);
  }
  return { rowsByEntity, wrong };
}

function uniqueCompactNeighbors(entityId, limit = 4) {
  const rows = neighborsFor(entityId, limit * 3).map(compactNeighbor);
  return [...new Map(rows.map((row) => [row.entity_id, row])).values()].slice(0, limit);
}

export function cleanBlindAnalysis(value) {
  const slotKeys = ["overall_form", "count", "color_fill", "orientation", "distinctive_feature"];
  const adaptive = value?.adaptive_generation;
  if (adaptive && adaptive.render_status === "clear" && adaptive.shared_slots) {
    const slots = Object.fromEntries(slotKeys.map((slot) => [slot, adaptive.shared_slots[slot] ?? null]));
    const observations = slotKeys.map((slot) => slots[slot]).filter(Boolean);
    if (!observations.some((observation) =>
      ["overall_form", "distinctive_feature"].some((slot) => observation.facets?.includes(slot)))) {
      throw new Error("Adaptive blind-ground invariant violated: no shared form/detail");
    }
    const vendorVotes = Object.fromEntries(config.renderVendors.map((vendor) => [vendor, [{
      render_status: "clear",
      slots,
      observations,
      notes: adaptive.notes ?? [],
    }]]));
    return {
      votes: Object.values(vendorVotes).flat(),
      vendor_votes: vendorVotes,
      clear_vote_quorum: 1,
      adaptive_generation: adaptive,
      recovery: value.recovery,
    };
  }
  throw new Error("Blind-ground invariant violated: adaptive two-call output is required");
}

async function processEnrichCohort(entities) {
    const groundCheckpoints = entities.map((entity) =>
      checkpoint(entity.entity_id, "blind_ground", STAGE_VERSIONS.blind_ground),
    );
    const items = entities.map((entity, entityIndex) => ({
      identity: compactEntity(entity, { includeExisting: true }),
      blind_analysis: compactBlindAnalysis(cleanBlindAnalysis(groundCheckpoints[entityIndex]?.output)),
      competitors: uniqueCompactNeighbors(entity.entity_id, 4),
    }));
    const inputHash = stageInputHash("enrich", STAGE_VERSIONS.enrich, items);
    for (const entity of entities) {
      beginCheckpoint({ entityId: entity.entity_id, stage: "enrich", version: STAGE_VERSIONS.enrich, inputHash });
    }

    const user = enrichUser(items);
    const expectedIds = entities.map((entity) => entity.entity_id);
    const votes = await collectContractVotes({
      desired: config.enrichVotes,
      retries: config.contractRetries,
      stage: "enrich",
      makeJob: () => pool.submit(new LlmJob({
        stage: "enrich",
        scope: { entities: expectedIds },
        system: ENRICH_SYSTEM,
        user,
        promptVersion: STAGE_VERSIONS.enrich,
      })),
      parse: (job) => parseEnrichOutput(
        extractJsonMatching(job.text, (value) => Array.isArray(value?.items)) ?? job.json,
        expectedIds,
      ),
    });
    const parsedVotes = votes.accepted.map((entry) => entry.value);
    const runIds = votes.accepted.map((entry) => entry.job.runDbId);
    if (parsedVotes.length < config.enrichVotes) {
      const error = `Insufficient valid votes: ${parsedVotes.length}/${config.enrichVotes}`;
      for (const entity of entities) finishCheckpoint({
        entityId: entity.entity_id, stage: "enrich", version: STAGE_VERSIONS.enrich,
        status: "failed", error, runIds,
        quality: { valid_votes: parsedVotes.length, required_votes: config.enrichVotes, contract_errors: votes.errors },
      });
      return entities.length;
    }
    const { rowsByEntity, wrong } = mergeEnrichment(entities, parsedVotes, runIds);
    upsertConfusionEdges(wrong.filter((trap) => selectedEntity(trap.confused_entity_id)).map((trap) => ({
      left_entity_id: trap.entity_id,
      right_entity_id: trap.confused_entity_id,
      reason: `negative-claim:${String(trap.phrase ?? "").slice(0, 80)}`,
      strength: 0.8,
      source: STAGE_VERSIONS.enrich,
      evidence: { reason: trap.reason },
    })));
    for (const entity of entities) {
      const rows = rowsByEntity.get(entity.entity_id) ?? [];
      if (parsedVotes.length === 0 || rows.length === 0) {
        finishCheckpoint({
          entityId: entity.entity_id, stage: "enrich", version: STAGE_VERSIONS.enrich,
          status: "failed", error: "No valid enrichment claims", runIds,
        });
      } else {
        upsertClaimsV2(rows);
        finishCheckpoint({
          entityId: entity.entity_id, stage: "enrich", version: STAGE_VERSIONS.enrich,
          status: "passed", output: { proposed_claims: rows },
          quality: { valid_votes: parsedVotes.length, proposed_claims: rows.length }, runIds,
        });
      }
    }
    return entities.length;
}

export async function runEnrich(limit = 60) {
  const result = await runConcurrentUnits({
    limit,
    maxInFlight: () => Math.max(1, Math.ceil(pool.snapshot().threads / config.enrichVotes)),
    next: (remaining) => {
      const candidates = nextCheckpointEntities({
        stage: "enrich",
        version: STAGE_VERSIONS.enrich,
        prerequisite: { stage: "blind_ground", version: STAGE_VERSIONS.blind_ground },
        limit: 1,
        maxAttempts: config.maxAttempts,
      });
      if (candidates.length === 0) return null;
      const entities = candidates.slice(0, 1);
      return { entities, size: entities.length };
    },
    run: ({ entities }) => processEnrichCohort(entities),
    onProgress: ({ completed, scheduled, active }) => emit("stage_progress", {
      stage: "enrich", processed: completed, scheduled, requested: limit,
      active_cohorts: active,
    }),
  });
  return result.completed;
}
