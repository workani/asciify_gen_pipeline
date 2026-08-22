import { config, STAGE_VERSIONS } from "../config.mjs";
import { parseSynthOutput } from "../contracts.mjs";
import { extractJsonMatching } from "../jsonextract.mjs";
import { LlmJob } from "../llm.mjs";
import { emit } from "../log.mjs";
import { pool } from "../pool.mjs";
import { SYNTH_SYSTEM, synthUser } from "../prompts.mjs";
import {
  beginCheckpoint,
  claimsV2ForEntity,
  finishCheckpoint,
  freezeEvaluationHoldout,
  neighborsFor,
  nextCheckpointEntities,
  pendingQueriesV2,
  queriesV2ForEntity,
  selectedEntity,
  setQueryRoundtripV2,
  setQueryValidationV2,
  upsertQueriesV2,
} from "../state.mjs";
import { getHarness } from "../validate.mjs";
import { collectContractVotes, compactEntity, compactNeighbor, runConcurrentUnits, stageInputHash } from "./common.mjs";

function synthTarget(entity) {
  const currentVerifierVersions = new Set([STAGE_VERSIONS.verify, STAGE_VERSIONS.reverify]);
  const allClaims = [...new Map(
    claimsV2ForEntity(entity.entity_id, { statuses: ["verified", "platform_specific"] })
      .filter((claim) => currentVerifierVersions.has(claim.verifier?.prompt_version))
      .sort((a, b) => b.confidence - a.confidence)
      .map((claim) => [claim.normalized_phrase, claim]),
  ).values()];
  const existingQueries = queriesV2ForEntity(entity.entity_id)
    .filter((query) => query.prompt_version === STAGE_VERSIONS.synth);
  const coverage = new Map();
  for (const query of existingQueries) {
    for (const claimId of query.claim_ids) coverage.set(claimId, (coverage.get(claimId) ?? 0) + 1);
  }
  const claims = allClaims.filter((claim) => (coverage.get(claim.id) ?? 0) < 2);
  const neighbors = neighborsFor(entity.entity_id, 6);
  return {
    entity: compactEntity(entity),
    verified_claims: claims.map((claim) => ({
      claim_id: claim.id,
      family: claim.family,
      phrase: claim.phrase,
      status: claim.status,
    })),
    pre_generated_queries: existingQueries.length,
    covered_claims: allClaims.length - claims.length,
    competitors: neighbors.map(compactNeighbor),
  };
}

function mergeQueries(entities, parsedVotes, contexts) {
  const out = new Map(entities.map((entity) => [entity.entity_id, new Map()]));
  const claimsByEntity = new Map(contexts.map((context) => [
    context.entity.entity_id,
    new Set(context.verified_claims.map((claim) => claim.claim_id)),
  ]));
  const neighborsByEntity = new Map(contexts.map((context) => [
    context.entity.entity_id,
    new Set(context.competitors.map((neighbor) => neighbor.entity_id)),
  ]));
  for (const [voteIndex, vote] of parsedVotes.entries()) {
    for (const target of vote) {
      const bucket = out.get(target.entity_id);
      if (!bucket) continue;
      const validClaims = claimsByEntity.get(target.entity_id);
      const validNeighbors = neighborsByEntity.get(target.entity_id);
      const seenInVote = new Set();
      for (const query of target.queries) {
        const claimIds = query.claim_ids.filter((id) => validClaims.has(id));
        if (claimIds.length === 0) continue;
        const key = query.normalized_query;
        const row = bucket.get(key) ?? {
          ...query,
          support_votes: new Set(),
          claim_ids: new Set(),
          must_beat: new Set(),
          must_not: new Set(),
        };
        if (!seenInVote.has(key)) row.support_votes.add(voteIndex);
        seenInVote.add(key);
        for (const id of claimIds) row.claim_ids.add(id);
        for (const id of query.must_beat) if (validNeighbors.has(id)) row.must_beat.add(id);
        for (const id of query.must_not) if (validNeighbors.has(id)) row.must_not.add(id);
        bucket.set(key, row);
      }
    }
  }
  const rowsByEntity = new Map();
  for (const entity of entities) {
    const ranked = [...out.get(entity.entity_id).values()]
      .sort((a, b) => b.support_votes.size - a.support_votes.size || a.normalized_query.localeCompare(b.normalized_query));
    const selected = [];
    const selectedKeys = new Set();
    const coverage = new Map([...claimsByEntity.get(entity.entity_id)].map((claimId) => [claimId, 0]));
    const take = (row) => {
      if (selectedKeys.has(row.normalized_query)) return false;
      if ([...row.claim_ids].some((claimId) => (coverage.get(claimId) ?? 0) >= 5)) return false;
      selected.push(row);
      selectedKeys.add(row.normalized_query);
      for (const claimId of row.claim_ids) coverage.set(claimId, (coverage.get(claimId) ?? 0) + 1);
      return true;
    };
    const claimIds = claimsByEntity.get(entity.entity_id);
    // Guarantee two phrasings per verified claim before adding up to five.
    for (const claimId of claimIds) {
      const candidates = ranked.filter((row) => row.claim_ids.has(claimId));
      for (const row of candidates) {
        if ((coverage.get(claimId) ?? 0) >= 2) break;
        take(row);
      }
    }
    for (const claimId of claimIds) {
      for (const row of ranked.filter((candidate) => candidate.claim_ids.has(claimId))) {
        if ((coverage.get(claimId) ?? 0) >= 5) break;
        take(row);
      }
    }
    rowsByEntity.set(entity.entity_id, selected.map((row) => ({
      entity_id: entity.entity_id,
      query: row.q,
      normalized_query: row.normalized_query,
      qclass: row.qclass,
      intent: row.intent,
      confidence: row.support_votes.size / Math.max(1, parsedVotes.length),
      claim_ids: [...row.claim_ids],
      must_beat: [...row.must_beat],
      must_not: [...row.must_not],
      prompt_version: STAGE_VERSIONS.synth,
    })));
  }
  return rowsByEntity;
}

async function processSynthCohort(entities) {
    const contexts = entities.map(synthTarget);
    const inputHash = stageInputHash("synth", STAGE_VERSIONS.synth, contexts);
    for (const entity of entities) beginCheckpoint({
      entityId: entity.entity_id, stage: "synth", version: STAGE_VERSIONS.synth, inputHash,
    });
    const eligible = contexts.filter((context) => context.verified_claims.length > 0);
    const ineligible = contexts.filter((context) => context.verified_claims.length === 0);
    const ineligibleIds = new Set(ineligible.map((context) => context.entity.entity_id));
    for (const entity of entities) {
      if (!ineligibleIds.has(entity.entity_id)) continue;
      const context = ineligible.find((row) => row.entity.entity_id === entity.entity_id);
      const covered = context?.covered_claims > 0 && context?.pre_generated_queries > 0;
      finishCheckpoint({
        entityId: entity.entity_id, stage: "synth", version: STAGE_VERSIONS.synth,
        status: covered ? "passed" : "failed",
        output: covered ? { query_count: context.pre_generated_queries, reused_from_blind_ground: true } : null,
        quality: covered ? {
          queries: context.pre_generated_queries,
          covered_claims: context.covered_claims,
          model_calls: 0,
        } : null,
        error: covered ? null : "No verified claims available for query synthesis",
      });
    }
    if (eligible.length === 0) {
      return entities.length;
    }

    const user = synthUser(eligible);
    const expectedIds = eligible.map((context) => context.entity.entity_id);
    const allClaimIds = new Map(eligible.map((context) => [
      context.entity.entity_id,
      context.verified_claims.map((claim) => claim.claim_id),
    ]));
    const allNeighborIds = new Set(eligible.flatMap((context) => context.competitors.map((neighbor) => neighbor.entity_id)));
    const collected = await collectContractVotes({
      desired: config.synthVotes,
      retries: config.contractRetries,
      stage: "synth",
      makeJob: () => pool.submit(new LlmJob({
        stage: "synth",
        scope: { entities: expectedIds },
        system: SYNTH_SYSTEM,
        user,
        promptVersion: STAGE_VERSIONS.synth,
      })),
      parse: (job) => parseSynthOutput(
        extractJsonMatching(job.text, (value) => Array.isArray(value?.targets)) ?? job.json,
        expectedIds,
        allClaimIds,
        allNeighborIds,
      ),
    });
    const parsedVotes = collected.accepted.map((entry) => entry.value);
    const runIds = collected.accepted.map((entry) => entry.job.runDbId);
    const eligibleEntities = entities.filter((entity) => !ineligibleIds.has(entity.entity_id));
    if (parsedVotes.length < config.synthVotes) {
      for (const entity of eligibleEntities) finishCheckpoint({
        entityId: entity.entity_id, stage: "synth", version: STAGE_VERSIONS.synth,
        status: "failed", error: `Insufficient valid votes: ${parsedVotes.length}/${config.synthVotes}`, runIds,
        quality: { contract_errors: collected.errors },
      });
      return entities.length;
    }
    const rowsByEntity = mergeQueries(eligibleEntities, parsedVotes, eligible);
    for (const entity of eligibleEntities) {
      const rows = rowsByEntity.get(entity.entity_id) ?? [];
      const expectedClaimIds = eligible.find((context) => context.entity.entity_id === entity.entity_id)
        ?.verified_claims.map((claim) => claim.claim_id) ?? [];
      const perClaim = Object.fromEntries(expectedClaimIds.map((claimId) => [
        claimId,
        rows.filter((row) => row.claim_ids.includes(claimId)).length,
      ]));
      const invalidCoverage = Object.entries(perClaim).filter(([, count]) => count < 2 || count > 5);
      if (parsedVotes.length === 0 || rows.length === 0 || invalidCoverage.length) {
        finishCheckpoint({
          entityId: entity.entity_id, stage: "synth", version: STAGE_VERSIONS.synth,
          status: "failed",
          error: invalidCoverage.length
            ? `Per-claim query coverage outside 2..5: ${invalidCoverage.map(([id, count]) => `${id}:${count}`).join(",")}`
            : "No valid synthesized queries",
          quality: { per_claim_queries: perClaim },
          runIds,
        });
      } else {
        upsertQueriesV2(rows);
        finishCheckpoint({
          entityId: entity.entity_id, stage: "synth", version: STAGE_VERSIONS.synth,
          status: "passed", output: { query_count: rows.length },
          quality: { valid_votes: parsedVotes.length, queries: rows.length, per_claim_queries: perClaim }, runIds,
        });
      }
    }
    return entities.length;
}

export async function runSynth(limit = 60) {
  freezeEvaluationHoldout();
  const result = await runConcurrentUnits({
    limit,
    maxInFlight: () => pool.snapshot().threads,
    next: (remaining) => {
      const entities = nextCheckpointEntities({
        stage: "synth",
        version: STAGE_VERSIONS.synth,
        prerequisite: { stage: "recover", version: STAGE_VERSIONS.recover },
        limit: Math.min(config.synthBatch, remaining),
        maxAttempts: config.maxAttempts,
      });
      if (entities.length === 0) return null;
      return { entities, size: entities.length };
    },
    run: ({ entities }) => processSynthCohort(entities),
    onProgress: ({ completed, scheduled, active }) => emit("stage_progress", {
      stage: "synth", processed: completed, scheduled, requested: limit,
      active_cohorts: active,
    }),
  });
  return result.completed;
}

export async function runRoundtrip(limit = 5000) {
  const pending = pendingQueriesV2(limit);
  if (pending.length === 0) return 0;
  const harness = await getHarness();
  const byEntity = new Map();
  for (const query of pending) {
    const entity = selectedEntity(query.entity_id);
    if (!entity) {
      setQueryRoundtripV2(query.id, -1, "rejected");
      continue;
    }
    const bucket = byEntity.get(entity.entity_id) ?? { entity, queries: [] };
    bucket.queries.push(query);
    byEntity.set(entity.entity_id, bucket);
  }
  for (const { entity, queries } of byEntity.values()) {
    const aliases = claimsV2ForEntity(entity.entity_id, { statuses: ["verified", "platform_specific"] })
      .map((claim) => claim.phrase);
    const inputHash = stageInputHash("roundtrip", STAGE_VERSIONS.roundtrip, {
      entity_id: entity.entity_id,
      queries: queries.map((query) => query.normalized_query),
    });
    beginCheckpoint({ entityId: entity.entity_id, stage: "roundtrip", version: STAGE_VERSIONS.roundtrip, inputHash });
    const counts = { pass: 0, hard: 0, miss: 0, baseline_top5: 0, augmented_top5: 0 };
    for (const query of queries) {
      const baselineRank = await harness(query.query, entity.target_key);
      const augmentedRank = await harness(query.query, entity.target_key, { aliases });
      const status = augmentedRank === -1 ? "miss" : augmentedRank <= config.roundTripPassRank ? "pass" : "hard";
      counts[status]++;
      if (baselineRank !== -1 && baselineRank <= config.roundTripPassRank) counts.baseline_top5++;
      if (augmentedRank !== -1 && augmentedRank <= config.roundTripPassRank) counts.augmented_top5++;
      setQueryValidationV2(query.id, baselineRank, augmentedRank, status);
    }
    finishCheckpoint({
      entityId: entity.entity_id, stage: "roundtrip", version: STAGE_VERSIONS.roundtrip,
      status: "passed", output: counts,
      quality: {
        total: queries.length,
        baseline_top5_rate: counts.baseline_top5 / queries.length,
        augmented_top5_rate: counts.augmented_top5 / queries.length,
      },
    });
    emit("stage_progress", { stage: "roundtrip", entity: entity.entity_id, ...counts });
  }
  return pending.length;
}
