import { config, STAGE_VERSIONS } from "../config.mjs";
import { parseRewriteOutput } from "../contracts.mjs";
import { extractJsonMatching } from "../jsonextract.mjs";
import { LlmJob } from "../llm.mjs";
import { emit } from "../log.mjs";
import { pool } from "../pool.mjs";
import { REWRITE_SYSTEM, rewriteUser } from "../prompts.mjs";
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
  compactBlindAnalysis,
  compactEntity,
  compactNeighbor,
  runConcurrentUnits,
  stageInputHash,
} from "./common.mjs";

function rewriteContext(entity) {
  const claims = claimsV2ForEntity(entity.entity_id)
    .filter((claim) => claim.source_stage !== "blind_ground" ||
      config.renderVendors.every((vendor) => Number(claim.evidence?.vendor_support?.[vendor] ?? 0) > 0));
  const accepted = claims.filter((claim) => ["verified", "platform_specific"].includes(claim.status))
    .sort((a, b) => b.confidence - a.confidence).slice(0, 6);
  const repair = claims.filter((claim) => ["rejected", "contested"].includes(claim.status));
  const unresolved = claims.filter((claim) => claim.status === "proposed");
  const blindOutput = checkpoint(entity.entity_id, "blind_ground", STAGE_VERSIONS.blind_ground)?.output;
  return {
    entity: compactEntity(entity),
    blind_analysis: compactBlindAnalysis(blindOutput),
    accepted_aliases: accepted.map((claim) => ({
      family: claim.family, phrase: claim.phrase, normalized_phrase: claim.normalized_phrase, status: claim.status,
    })),
    rejected_or_contested: [...repair, ...unresolved]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8)
      .map((claim) => ({
      claim_id: claim.id,
      family: claim.family,
      phrase: claim.phrase,
      normalized_phrase: claim.normalized_phrase,
      status: claim.status,
      reviews: (claim.verifier?.reviews ?? []).slice(0, 2).map((review) => ({
        verdict: review.verdict,
        reason: String(review.reason ?? "").slice(0, 160),
        corrected_phrase: review.corrected_phrase ?? null,
      })),
      decision_counts: claim.verifier?.counts ?? null,
    })),
    competitors: neighborsFor(entity.entity_id, 4).map(compactNeighbor),
    verified_alias_gap: Math.max(0, config.minimumVerifiedAliases - accepted.length),
  };
}

function mergeRewrites(entities, contexts, votes, runIds) {
  const existing = new Map(entities.map((entity) => [
    entity.entity_id,
    new Set(claimsV2ForEntity(entity.entity_id).map((claim) => claim.normalized_phrase)),
  ]));
  const buckets = new Map(entities.map((entity) => [entity.entity_id, new Map()]));
  for (const vote of votes) {
    for (const item of vote) {
      const bucket = buckets.get(item.entity_id);
      if (!bucket) continue;
      for (const claim of item.claims) {
        if (existing.get(item.entity_id)?.has(claim.normalized_phrase)) continue;
        const key = `${claim.family}:${claim.normalized_phrase}`;
        const row = bucket.get(key) ?? { ...claim, support: 0, rationales: [] };
        row.support++;
        row.rationales.push(claim.rationale);
        bucket.set(key, row);
      }
    }
  }
  return new Map(entities.map((entity) => [
    entity.entity_id,
    [...buckets.get(entity.entity_id).values()]
      .sort((a, b) => b.support - a.support ||
        a.normalized_phrase.localeCompare(b.normalized_phrase))
      .slice(0, 6)
      .map((claim) => ({
      entity_id: entity.entity_id,
      family: claim.family,
      phrase: claim.phrase,
      normalized_phrase: claim.normalized_phrase,
      confidence: claim.support / votes.length,
      status: "proposed",
      source_stage: "rewrite",
      prompt_version: STAGE_VERSIONS.rewrite,
      evidence: {
        deterministic_vote_support: `${claim.support}/${votes.length}`,
        rationales: claim.rationales,
        run_ids: runIds,
      },
      })),
  ]));
}

async function processRewriteCohort(entities) {
  const contexts = entities.map(rewriteContext);
  const inputHash = stageInputHash("rewrite", STAGE_VERSIONS.rewrite, contexts);
  for (const entity of entities) beginCheckpoint({
    entityId: entity.entity_id, stage: "rewrite", version: STAGE_VERSIONS.rewrite, inputHash,
  });

  const eligible = contexts
    .filter((context) => context.verified_alias_gap > 0)
    .map((context) => ({ ...context }));
  const eligibleIds = new Set(eligible.map((context) => context.entity.entity_id));
  for (const entity of entities) {
    if (eligibleIds.has(entity.entity_id)) continue;
    finishCheckpoint({
      entityId: entity.entity_id, stage: "rewrite", version: STAGE_VERSIONS.rewrite,
      status: "passed", output: { rewritten_claims: 0, reason: "verified coverage already sufficient" },
      quality: {
        accepted_before_rewrite: contexts.find((context) => context.entity.entity_id === entity.entity_id)
          ?.accepted_aliases.length ?? 0,
      },
    });
  }
  if (eligible.length === 0) return entities.length;

  const expectedIds = eligible.map((context) => context.entity.entity_id);
  const user = rewriteUser(eligible);
  const collected = await collectContractVotes({
    desired: config.rewriteVotes,
    retries: config.contractRetries,
    stage: "rewrite",
    makeJob: () => pool.submit(new LlmJob({
      stage: "rewrite",
      scope: { entities: expectedIds },
      system: REWRITE_SYSTEM,
      user,
      promptVersion: STAGE_VERSIONS.rewrite,
    })),
    parse: (job) => parseRewriteOutput(
      extractJsonMatching(job.text, (value) => Array.isArray(value?.items)) ?? job.json,
      expectedIds,
    ),
  });
  const votes = collected.accepted.map((entry) => entry.value);
  const runIds = collected.accepted.map((entry) => entry.job.runDbId);
  if (votes.length < config.rewriteVotes) {
    for (const context of eligible) finishCheckpoint({
      entityId: context.entity.entity_id, stage: "rewrite", version: STAGE_VERSIONS.rewrite,
      status: "failed", error: `Insufficient valid votes: ${votes.length}/${config.rewriteVotes}`, runIds,
      quality: { contract_errors: collected.errors },
    });
    return entities.length;
  }

  const eligibleEntities = entities.filter((entity) => eligibleIds.has(entity.entity_id));
  const rowsByEntity = mergeRewrites(eligibleEntities, eligible, votes, runIds);
  for (const entity of eligibleEntities) {
    const rows = rowsByEntity.get(entity.entity_id) ?? [];
    if (rows.length) upsertClaimsV2(rows);
    const before = eligible.find((context) => context.entity.entity_id === entity.entity_id);
    const hasEnoughExisting = before.accepted_aliases.length >= config.minimumVerifiedAliases;
    finishCheckpoint({
      entityId: entity.entity_id, stage: "rewrite", version: STAGE_VERSIONS.rewrite,
      status: rows.length || hasEnoughExisting ? "passed" : "failed",
      output: { rewritten_claims: rows.length, proposed_claims: rows },
      quality: {
        valid_votes: votes.length,
        rejected_inputs: before.rejected_or_contested.length,
        accepted_before_rewrite: before.accepted_aliases.length,
      },
      error: rows.length || hasEnoughExisting ? null : "No truthful replacement aliases were proposed",
      runIds,
    });
  }
  return entities.length;
}

export async function runRewrite(limit = 60) {
  const result = await runConcurrentUnits({
    limit,
    maxInFlight: () => pool.snapshot().threads,
    next: (remaining) => {
      const candidates = nextCheckpointEntities({
        stage: "rewrite",
        version: STAGE_VERSIONS.rewrite,
        prerequisite: {
          stage: "verify", version: STAGE_VERSIONS.verify, statuses: ["passed", "failed", "quarantined"],
        },
        limit: 1,
        maxAttempts: config.maxAttempts,
      });
      if (!candidates.length) return null;
      const entities = candidates.slice(0, 1);
      return { entities, size: entities.length };
    },
    run: ({ entities }) => processRewriteCohort(entities),
    onProgress: ({ completed, scheduled, active }) => {
      emit("stage_progress", {
        stage: "rewrite", processed: completed, scheduled, requested: limit, active_cohorts: active,
      });
    },
  });
  return result.completed;
}
