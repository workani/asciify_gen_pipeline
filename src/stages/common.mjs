import { contentHash, normalizeTerm } from "../normalize.mjs";
import { STAGE_VERSIONS } from "../config.mjs";
import { emit } from "../log.mjs";
import { neighborsFor } from "../state.mjs";

export function compactEntity(entity, { includeExisting = false } = {}) {
  const out = {
    entity_id: entity.entity_id,
    target_kind: entity.target_kind,
    target_key: entity.target_key,
    glyph: entity.character,
    name: entity.name,
    hex: entity.hex,
    category: entity.category_key,
    general_category: entity.general_category,
    render_mode: entity.render_mode,
    popularity: entity.popularity,
  };
  if (includeExisting) {
    out.existing_search_tokens_unverified = String(entity.existing_synonyms ?? "")
      .split(/\s+/).filter(Boolean).slice(0, 12);
  }
  return out;
}

export function compactNeighbor(entity) {
  return {
    entity_id: entity.entity_id,
    glyph: entity.character,
    name: entity.name,
    hex: entity.hex,
    category: entity.category_key,
    general_category: entity.general_category,
    render_mode: entity.render_mode,
    relation: entity.reason ? {
      reason: String(entity.reason).slice(0, 120),
      strength: Number(entity.strength ?? 0.5),
    } : undefined,
  };
}

function rankedPhrases(votes, field, limit) {
  const rows = new Map();
  for (const vote of votes) {
    const seen = new Set();
    for (const claim of vote?.[field] ?? []) {
      const key = normalizeTerm(claim?.phrase);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const row = rows.get(key) ?? { phrase: String(claim.phrase), support: 0, facets: new Set() };
      row.support++;
      for (const facet of claim.facets ?? []) row.facets.add(String(facet));
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .sort((a, b) => b.support - a.support || a.phrase.localeCompare(b.phrase))
    .slice(0, limit)
    .map((row) => ({
      phrase: row.phrase,
      support: row.support,
      confidence: Number((row.support / Math.max(1, votes.length)).toFixed(3)),
      ...(row.facets.size ? { facets: [...row.facets].slice(0, 6) } : {}),
    }));
}

export function compactBlindAnalysis(output) {
  const votes = Array.isArray(output?.votes) ? output.votes : [];
  const clearVotes = votes.filter((vote) => vote?.render_status === "clear");
  const renderStatus = { clear: 0, ambiguous: 0, missing: 0 };
  for (const vote of votes) {
    if (vote?.render_status in renderStatus) renderStatus[vote.render_status]++;
  }
  return {
    vote_count: votes.length,
    render_status: renderStatus,
    observations: rankedPhrases(clearVotes, "observations", 5),
    resemblance_hypotheses: rankedPhrases(clearVotes, "resembles", 3),
  };
}

export function compactClaimEvidence(evidence) {
  const value = evidence && typeof evidence === "object" ? evidence : {};
  const out = {};
  for (const key of ["agreement", "support_count", "clear_votes", "deterministic_vote_support"]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  if (value.slot) out.slot = value.slot;
  if (Array.isArray(value.slots)) out.slots = value.slots.slice(0, 5);
  if (value.vendor_support && typeof value.vendor_support === "object") out.vendor_support = value.vendor_support;
  if (Array.isArray(value.rows)) {
    out.rows = value.rows.slice(0, 3).map((row) => ({
      scope: row?.scope,
      evidence: row?.evidence,
      rationale: String(row?.rationale ?? "").slice(0, 160),
    }));
  }
  if (Array.isArray(value.observations)) out.observations = value.observations.slice(0, 5);
  if (Array.isArray(value.rationales)) out.rationales = value.rationales.slice(0, 3).map((row) => String(row).slice(0, 160));
  return out;
}

export function chooseRelatedCohort(candidates, maxItems) {
  if (candidates.length <= maxItems) return candidates;
  const first = candidates[0];
  const neighborIds = new Set(neighborsFor(first.entity_id, maxItems * 2).map((row) => row.entity_id));
  const scored = candidates.map((entity, index) => {
    let affinity = 0;
    if (neighborIds.has(entity.entity_id)) affinity += 100;
    if (entity.category_key === first.category_key) affinity += 40;
    if (entity.general_category === first.general_category) affinity += 10;
    if (entity.selection_tier === first.selection_tier) affinity += 2;
    return { entity, affinity, index };
  });
  scored.sort((a, b) => b.affinity - a.affinity || a.index - b.index);
  return scored.slice(0, maxItems).map((row) => row.entity);
}

export function stageInputHash(stage, version, payload) {
  return contentHash({ stage, version, payload });
}

export async function settleJobs(jobs) {
  const settled = await Promise.allSettled(jobs);
  return {
    succeeded: settled.filter((row) => row.status === "fulfilled").map((row) => row.value),
    failed: settled.filter((row) => row.status === "rejected").map((row) => row.reason),
  };
}

export async function runConcurrentUnits({
  limit,
  maxInFlight,
  next,
  run,
  onProgress = null,
}) {
  let scheduled = 0;
  let completed = 0;
  let exhausted = false;
  let fatalError = null;
  const active = new Set();

  const capacity = () => Math.max(1, Number(typeof maxInFlight === "function" ? maxInFlight() : maxInFlight) || 1);
  const launch = () => {
    while (!fatalError && !exhausted && scheduled < limit && active.size < capacity()) {
      const unit = next(limit - scheduled);
      if (!unit) {
        exhausted = true;
        break;
      }
      const size = Math.max(1, Number(unit.size ?? 1));
      scheduled += size;
      let task;
      task = Promise.resolve(run(unit))
        .then((value) => {
          const advanced = Math.max(0, Number(value?.processed ?? value ?? size));
          completed += advanced;
          onProgress?.({ completed, scheduled, advanced, active: Math.max(0, active.size - 1), unit, value });
        })
        .catch((error) => {
          fatalError ??= error;
        })
        .finally(() => active.delete(task));
      active.add(task);
    }
  };

  launch();
  while (active.size > 0) {
    await Promise.race(active);
    launch();
  }
  if (fatalError) throw fatalError;
  return { completed, scheduled };
}

export async function collectContractVotes({
  desired,
  retries,
  stage,
  makeJob,
  parse,
}) {
  const accepted = [];
  const errors = [];
  let launched = 0;
  const maximum = desired * (1 + retries);
  const active = new Map();

  const refill = () => {
    // Keep exactly enough calls in flight to satisfy the remaining vote slots.
    // A rejected transport or malformed response is replaced as soon as it
    // settles instead of waiting for unrelated slow siblings in the same wave.
    while (launched < maximum && accepted.length + active.size < desired) {
      const index = launched++;
      const token = Symbol(`vote-${index}`);
      const promise = Promise.resolve()
        .then(() => makeJob(index))
        .then(
          (job) => ({ token, status: "fulfilled", job }),
          (error) => ({ token, status: "rejected", error }),
        );
      active.set(token, promise);
    }
  };

  refill();
  while (accepted.length < desired && active.size > 0) {
    const result = await Promise.race(active.values());
    active.delete(result.token);
    let lastError = null;
    if (result.status === "rejected") {
      lastError = { kind: "job", message: String(result.error?.message ?? result.error).slice(0, 500) };
      errors.push(lastError);
    } else {
      try {
        accepted.push({ value: parse(result.job), job: result.job });
      } catch (error) {
        lastError = {
          kind: "contract",
          message: String(error?.message ?? error).slice(0, 500),
          details: error?.details ?? null,
          run_id: result.job.runDbId,
          raw_file: result.job.rawFile,
        };
        errors.push(lastError);
      }
    }
    if (lastError && accepted.length < desired && launched < maximum) {
      emit("contract_retry", {
        stage,
        accepted: accepted.length,
        desired,
        launched,
        remaining_attempts: maximum - launched,
        last_error: lastError.message,
      });
    }
    refill();
  }

  if (accepted.length < desired) {
    emit("contract_error", {
      stage,
      error: `Only ${accepted.length}/${desired} structurally valid votes after ${launched} calls`,
      attempts: launched,
      errors: errors.slice(-4),
    });
  }
  return { accepted, errors, launched };
}

export function uniqueTag(stage, entities) {
  const revision = contentHash(STAGE_VERSIONS.blind_ground).slice(0, 8);
  return `render-${revision}-single-${stage}-${contentHash(entities.map((entity) => entity.entity_id)).slice(0, 16)}`;
}
