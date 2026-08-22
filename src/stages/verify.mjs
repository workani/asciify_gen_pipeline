import { config, STAGE_VERSIONS } from "../config.mjs";
import { parseVerifyBatchOutput } from "../contracts.mjs";
import { extractJsonMatching } from "../jsonextract.mjs";
import { LlmJob } from "../llm.mjs";
import { emit } from "../log.mjs";
import { pool } from "../pool.mjs";
import { VERIFY_SYSTEM, verifyBatchUser } from "../prompts.mjs";
import { renderGlyphCandidates } from "../render.mjs";
import {
  beginCheckpoint,
  claimsV2ForEntity,
  finishCheckpoint,
  neighborsFor,
  nextCheckpointEntities,
  updateClaimVerification,
} from "../state.mjs";
import {
  collectContractVotes,
  compactClaimEvidence,
  compactEntity,
  compactNeighbor,
  runConcurrentUnits,
  stageInputHash,
  uniqueTag,
} from "./common.mjs";

export function decideVerification(claim, reviews, validVoteCount) {
  const counts = Object.fromEntries(
    ["supported", "platform_specific", "too_broad", "wrong", "duplicate"].map((key) => [key, 0]),
  );
  for (const review of reviews) counts[review.verdict]++;
  const majority = Math.floor(validVoteCount / 2) + 1;
  const negative = counts.wrong + counts.too_broad + counts.duplicate;
  let status = "contested";
  if (negative >= majority) {
    status = "rejected";
  } else if (counts.supported >= majority && negative === 0 && counts.platform_specific === 0) {
    status = "verified";
  } else if (counts.supported + counts.platform_specific >= majority && negative === 0 && counts.platform_specific > 0) {
    status = "platform_specific";
  }
  const confidence = status === "verified"
    ? counts.supported / validVoteCount
    : status === "platform_specific"
      ? (counts.supported + counts.platform_specific) / validVoteCount
      : status === "rejected"
        ? negative / validVoteCount
        : Math.max(...Object.values(counts)) / validVoteCount;
  return {
    status,
    confidence,
    support_count: Math.round(confidence * validVoteCount),
    clear_votes: validVoteCount,
    counts,
    reviews,
    decision_rule: "deterministic-majority-derived-confidence-v2",
  };
}

function prepareVerification(entity, {
  stage = "verify",
  version = STAGE_VERSIONS.verify,
  retainVerifierVersions = [STAGE_VERSIONS.verify],
} = {}) {
    const allClaims = claimsV2ForEntity(entity.entity_id)
      // One-off blind wording remains available to enrichment as evidence,
      // but only perception consensus is expensive enough to verify as an
      // alias candidate.
      .filter((claim) => claim.source_stage !== "blind_ground" ||
        config.renderVendors.every((vendor) => Number(claim.evidence?.vendor_support?.[vendor] ?? 0) > 0));
    const uniqueClaims = new Map();
    const duplicateClaims = [];
    for (const claim of allClaims) {
      // The same phrase in two claimed families is still one search alias.
      // Keep one canonical row so exact semantic duplicates cannot inflate
      // coverage or the production alias count.
      const key = claim.normalized_phrase;
      const current = uniqueClaims.get(key);
      const claimAccepted = ["verified", "platform_specific"].includes(claim.status);
      const currentAccepted = current && ["verified", "platform_specific"].includes(current.status);
      if (!current || (claimAccepted && !currentAccepted) || (claimAccepted === currentAccepted && claim.confidence > current.confidence)) {
        if (current) duplicateClaims.push(current);
        uniqueClaims.set(key, claim);
      } else duplicateClaims.push(claim);
    }
    for (const duplicate of duplicateClaims) {
      updateClaimVerification(duplicate.id, {
        status: "rejected",
        confidence: 1,
        verifier: {
          verdict: "duplicate",
          reason: "exact normalized phrase already represented by the canonical alias",
          prompt_version: version,
          decision_rule: "deterministic-exact-dedupe-v1",
        },
      });
    }
    const canonicalClaims = [...uniqueClaims.values()];
    const acceptedStatus = (claim) => ["verified", "platform_specific"].includes(claim.status);
    const freshlyAccepted = (claim) => acceptedStatus(claim) && retainVerifierVersions.includes(claim.verifier?.prompt_version);
    const claims = canonicalClaims.filter((claim) =>
      ["proposed", "contested"].includes(claim.status) || (acceptedStatus(claim) && !freshlyAccepted(claim)),
    );
    const alreadyAccepted = canonicalClaims.filter(freshlyAccepted);
    const neighbors = neighborsFor(entity.entity_id, config.contrastNeighbors);
    const targets = [entity, ...neighbors];
    const promptClaims = claims.map((claim) => ({
      claim_id: claim.id,
      entity_id: claim.entity_id,
      family: claim.family,
      phrase: claim.phrase,
      evidence: compactClaimEvidence(claim.evidence),
    }));
    const payload = {
      case_id: entity.entity_id,
      targets: [compactEntity(entity), ...neighbors.map(compactNeighbor)],
      claims: promptClaims,
    };
    const inputHash = stageInputHash(stage, version, payload);
    beginCheckpoint({ entityId: entity.entity_id, stage, version, inputHash });
    if (claims.length === 0) {
      const required = Math.min(config.minimumVerifiedAliases, canonicalClaims.length);
      if (alreadyAccepted.length >= Math.max(1, required)) {
        finishCheckpoint({
          entityId: entity.entity_id, stage, version,
          status: "passed", output: { decisions: [], retained_verified: alreadyAccepted.length },
          quality: { proposed: allClaims.length, accepted: alreadyAccepted.length },
        });
        return { ready: false, accepted: alreadyAccepted.length };
      }
      finishCheckpoint({
        entityId: entity.entity_id, stage, version,
        status: "failed", error: "No proposed claims to verify",
      });
      return { ready: false, accepted: 0 };
    }

    return {
      ready: true,
      entity,
      canonicalClaims,
      duplicateClaims,
      claims,
      alreadyAccepted,
      targets,
      payload,
    };
}

async function processVerificationCohort(entities, options) {
    const { stage, version } = options;
    const prepared = entities.map((entity) => prepareVerification(entity, options));
    const ready = prepared.filter((item) => item.ready);
    if (ready.length === 0) {
      return { processed: entities.length, accepted: prepared.reduce((sum, item) => sum + item.accepted, 0) };
    }

    const rendered = (await Promise.all(ready.map(async (item) => {
      try {
        const candidateRenders = await renderGlyphCandidates(item.targets, uniqueTag("verify-candidates", item.targets));
        const renderedIds = new Set(candidateRenders.candidates.map((candidate) => candidate.entity_id));
        return {
          ...item,
          targets: item.targets.filter((target) => renderedIds.has(target.entity_id)),
          payload: {
            ...item.payload,
            targets: item.payload.targets.filter((target) => renderedIds.has(target.entity_id)),
          },
          candidateRenders,
        };
      } catch (error) {
        finishCheckpoint({
          entityId: item.entity.entity_id, stage, version,
          status: "failed", error: `render: ${error.message}`,
        });
        return null;
      }
    }))).filter(Boolean);
    if (rendered.length === 0) return { processed: entities.length, accepted: 0 };

    const cases = rendered.map((item) => ({
      ...item.payload,
      render_mapping: item.candidateRenders.candidates.map((candidate, position) => ({
        entity_id: candidate.entity_id,
        role: position === 0 ? "target" : "competitor",
        attachments: candidate.vendors.map((vendor, vendorPosition) => ({
          vendor,
          ordinal: position * candidate.vendors.length + vendorPosition + 1,
        })),
      })),
    }));
    const expectedCases = rendered.map((item) => ({
      case_id: item.entity.entity_id,
      claim_ids: item.claims.map((claim) => claim.id),
    }));
    const user = verifyBatchUser(cases);
    const collected = await collectContractVotes({
      desired: config.verifyVotes,
      retries: config.contractRetries,
      stage,
      makeJob: () => pool.submit(new LlmJob({
        stage,
        scope: { entities: rendered.map((item) => item.entity.entity_id), cases: rendered.length },
        system: VERIFY_SYSTEM,
        user,
        images: rendered.flatMap((item) => item.candidateRenders.images),
        promptVersion: version,
      })),
      parse: (job) => parseVerifyBatchOutput(
        extractJsonMatching(job.text, (value) => Array.isArray(value?.cases)) ?? job.json,
        expectedCases,
      ),
    });
    const parsedVotes = collected.accepted.map((entry) => entry.value);
    const runIds = collected.accepted.map((entry) => entry.job.runDbId);
    if (parsedVotes.length < config.verifyVotes) {
      for (const item of rendered) finishCheckpoint({
          entityId: item.entity.entity_id, stage, version,
          status: "failed", error: `Insufficient valid votes: ${parsedVotes.length}/${config.verifyVotes}`, runIds,
          quality: { contract_errors: collected.errors },
        });
      return { processed: entities.length, accepted: 0 };
    }
    let acceptedAcrossCohort = 0;
    for (const item of rendered) {
      const decisions = [];
      for (const claim of item.claims) {
        const reviews = parsedVotes.map((vote) =>
          vote.find((entry) => entry.case_id === item.entity.entity_id)?.reviews
            .find((review) => review.claim_id === claim.id),
        ).filter(Boolean);
        const decision = decideVerification(claim, reviews, parsedVotes.length);
        updateClaimVerification(claim.id, {
          status: decision.status,
          confidence: decision.confidence,
          verifier: { ...decision, run_ids: runIds, prompt_version: version },
        });
        decisions.push({ claim_id: claim.id, ...decision });
      }
      const accepted = decisions.filter((decision) => ["verified", "platform_specific"].includes(decision.status));
      const acceptedTotal = item.alreadyAccepted.length + accepted.length;
      acceptedAcrossCohort += acceptedTotal;
      const required = Math.min(config.minimumVerifiedAliases, item.canonicalClaims.length);
      const passed = acceptedTotal >= Math.max(1, required);
      finishCheckpoint({
        entityId: item.entity.entity_id, stage, version,
        status: passed ? "passed" : "failed",
        output: { decisions },
        quality: {
          proposed: item.canonicalClaims.length,
          duplicates: item.duplicateClaims.length,
          accepted: acceptedTotal,
          rejected: decisions.length - accepted.length,
          batch_size: rendered.length,
        },
        error: passed ? null : `Only ${acceptedTotal}/${required} required claims verified`,
        runIds,
      });
    }
    return { processed: entities.length, accepted: acceptedAcrossCohort };
}

export async function runVerify(limit = 60) {
  return runVerificationStage(limit, {
    stage: "verify",
    version: STAGE_VERSIONS.verify,
    prerequisite: { stage: "contrast", version: STAGE_VERSIONS.contrast },
    retainVerifierVersions: [STAGE_VERSIONS.verify],
  });
}

export async function runReverify(limit = 60) {
  return runVerificationStage(limit, {
    stage: "reverify",
    version: STAGE_VERSIONS.reverify,
    prerequisite: { stage: "rewrite", version: STAGE_VERSIONS.rewrite },
    retainVerifierVersions: [STAGE_VERSIONS.verify, STAGE_VERSIONS.reverify],
  });
}

async function runVerificationStage(limit, { stage, version, prerequisite, retainVerifierVersions }) {
  const result = await runConcurrentUnits({
    limit,
    // Call concurrency is enforced by OpencodePool; prefetch entity work so
    // rendering and one slow vote cannot strand otherwise free model slots.
    maxInFlight: () => pool.snapshot().threads,
    next: (remaining) => {
      const candidates = nextCheckpointEntities({
        stage,
        version,
        prerequisite,
        limit: 1,
        maxAttempts: config.maxAttempts,
      });
      if (!candidates.length) return null;
      const entities = candidates.slice(0, 1);
      return { entities, size: entities.length };
    },
    run: ({ entities }) => processVerificationCohort(entities, { stage, version, retainVerifierVersions }),
    onProgress: ({ completed, scheduled, active, value }) => emit("stage_progress", {
      stage, processed: completed, scheduled, requested: limit,
      accepted: value?.accepted ?? 0,
      active_cohorts: active,
    }),
  });
  return result.completed;
}
