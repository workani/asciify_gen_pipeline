import { config, STAGE_VERSIONS } from "../config.mjs";
import { parseAdjudicateBatchOutput } from "../contracts.mjs";
import { extractJsonMatching } from "../jsonextract.mjs";
import { LlmJob } from "../llm.mjs";
import { emit } from "../log.mjs";
import { contentHash, uniqueVisualEntities } from "../normalize.mjs";
import { pool } from "../pool.mjs";
import { ADJUDICATE_SYSTEM, adjudicateBatchUser } from "../prompts.mjs";
import { renderGlyphCandidates } from "../render.mjs";
import {
  addAdjudicationV2,
  neighborsFor,
  pendingAdjudicationQueries,
  selectedEntity,
  setQueryAdjudicationStatus,
  skipNonContrastiveAdjudications,
} from "../state.mjs";
import { collectContractVotes, compactEntity, runConcurrentUnits } from "./common.mjs";

function seededShuffle(values, seed) {
  const out = [...values];
  let state = parseInt(contentHash(seed).slice(0, 8), 16) >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function entropy(distribution) {
  return -Object.values(distribution).reduce((sum, value) => value > 0 ? sum + value * Math.log2(value) : sum, 0);
}

function aggregateVotes(votes, entityIds) {
  const totals = Object.fromEntries(entityIds.map((id) => [id, 0]));
  const winners = {};
  for (const vote of votes) {
    for (const row of vote.ranking) totals[row.entity_id] += row.p;
    const winner = vote.ranking[0]?.entity_id;
    if (winner) winners[winner] = (winners[winner] ?? 0) + 1;
  }
  const distribution = Object.fromEntries(
    Object.entries(totals).map(([id, total]) => [id, total / votes.length]),
  );
  const winnerEntityId = Object.entries(winners)
    .sort((a, b) => b[1] - a[1] || (distribution[b[0]] ?? 0) - (distribution[a[0]] ?? 0))[0]?.[0] ?? null;
  const agreement = winnerEntityId ? winners[winnerEntityId] / votes.length : 0;
  return { distribution, winnerEntityId, agreement, winners };
}

function prepareCase(query) {
  const target = selectedEntity(query.entity_id);
  if (!target) {
    setQueryAdjudicationStatus(query.id, "skipped");
    return null;
  }
  const requestedIds = [...query.must_beat, ...query.must_not];
  const candidates = [
    target,
    ...requestedIds.map(selectedEntity).filter(Boolean),
    ...neighborsFor(target.entity_id, 10),
  ];
  const cluster = uniqueVisualEntities(candidates).slice(0, 8);
  if (cluster.length < 2) {
    setQueryAdjudicationStatus(query.id, "skipped");
    return null;
  }
  return { case_id: `query:${query.id}`, query, cluster };
}

async function makeBatchJob(cases, voteIndex) {
  const rendered = cases.map((item) => {
    const shuffled = seededShuffle(
      item.renderedCandidates,
      `${item.query.id}:${voteIndex}:${STAGE_VERSIONS.adjudicate}`,
    );
    return {
      images: shuffled.flatMap((candidate) => candidate.images),
      payload: {
        case_id: item.case_id,
        query: item.query.query,
        candidates: shuffled.map((candidate) => compactEntity(candidate.entity)),
        render_mapping: shuffled.map((candidate, position) => ({
          entity_id: candidate.entity_id,
          attachments: candidate.vendors.map((vendor, vendorPosition) => ({
            vendor,
            ordinal: position * candidate.vendors.length + vendorPosition + 1,
          })),
        })),
      },
    };
  });
  return pool.submit(new LlmJob({
    stage: "adjudicate",
    scope: { query_ids: cases.map((item) => item.query.id), cases: cases.length, vote: voteIndex },
    system: ADJUDICATE_SYSTEM,
    user: adjudicateBatchUser(rendered.map((item) => item.payload)),
    images: rendered.flatMap((item) => item.images),
    promptVersion: STAGE_VERSIONS.adjudicate,
  }));
}

async function processAdjudicationBatch(queries) {
  const prepared = queries.map(prepareCase).filter(Boolean);
  if (prepared.length === 0) return { processed: queries.length };
  const cases = (await Promise.all(prepared.map(async (item) => {
    try {
      const candidateRenders = await renderGlyphCandidates(item.cluster, `adj-${item.query.id}`);
      const entities = new Map(item.cluster.map((entity) => [entity.entity_id, entity]));
      const renderedCandidates = candidateRenders.candidates.map((candidate) => ({
        ...candidate,
        entity: entities.get(candidate.entity_id),
      })).filter((candidate) => candidate.entity);
      if (renderedCandidates.length < 2) {
        setQueryAdjudicationStatus(item.query.id, "skipped");
        emit("adjudication_pruned", {
          query_id: item.query.id,
          reason: "fewer than two visually distinct candidates",
          duplicates: candidateRenders.duplicates,
        });
        return null;
      }
      return {
        ...item,
        cluster: renderedCandidates.map((candidate) => candidate.entity),
        renderedCandidates,
      };
    } catch (error) {
      setQueryAdjudicationStatus(item.query.id, "failed");
      emit("stage_warning", { stage: "adjudicate", query_id: item.query.id, error: `render: ${error.message}` });
      return null;
    }
  }))).filter(Boolean);
  if (cases.length === 0) return { processed: queries.length };
  const expectedCases = cases.map((item) => ({
    case_id: item.case_id,
    entity_ids: item.cluster.map((entity) => entity.entity_id),
  }));
  const collected = await collectContractVotes({
    desired: config.adjudicateVotes,
    retries: config.contractRetries,
    stage: "adjudicate",
    makeJob: (attempt) => makeBatchJob(cases, attempt),
    parse: (job) => parseAdjudicateBatchOutput(
      extractJsonMatching(job.text, (value) => Array.isArray(value?.cases)) ?? job.json,
      expectedCases,
    ),
  });
  const votes = collected.accepted.map((entry) => entry.value);
  if (votes.length < config.adjudicateVotes) {
    for (const item of cases) setQueryAdjudicationStatus(item.query.id, "failed");
    emit("stage_warning", {
      stage: "adjudicate",
      error: `Insufficient valid votes: ${votes.length}/${config.adjudicateVotes}`,
      queries: cases.map((item) => item.query.id),
    });
    return { processed: queries.length };
  }

  let lastWinner = null;
  let lastAgreement = null;
  for (const item of cases) {
    const caseVotes = votes.map((vote) =>
      vote.find((entry) => entry.case_id === item.case_id)?.result,
    ).filter(Boolean);
    const aggregate = aggregateVotes(caseVotes, item.cluster.map((entity) => entity.entity_id));
    addAdjudicationV2({
      queryId: item.query.id,
      clusterHash: contentHash(item.cluster.map((entity) => entity.entity_id).sort()),
      cluster: item.cluster.map(compactEntity),
      votes: caseVotes,
      distribution: aggregate.distribution,
      winnerEntityId: aggregate.winnerEntityId,
      agreement: aggregate.agreement,
      entropy: entropy(aggregate.distribution),
      promptVersion: STAGE_VERSIONS.adjudicate,
    });
    setQueryAdjudicationStatus(item.query.id, "passed");
    lastWinner = aggregate.winnerEntityId;
    lastAgreement = aggregate.agreement;
  }
  return { processed: queries.length, query: cases.at(-1)?.query, winner: lastWinner, agreement: lastAgreement };
}

export async function runAdjudicate(limit = 20) {
  const skipped = skipNonContrastiveAdjudications();
  if (skipped) emit("adjudication_pruned", { skipped, reason: "non-contrastive queries use deterministic round-trip validation" });
  const queries = pendingAdjudicationQueries(limit);
  let cursor = 0;
  const result = await runConcurrentUnits({
    limit: queries.length,
    maxInFlight: () => pool.snapshot().threads,
    next: (remaining) => {
      if (cursor >= queries.length) return null;
      const batch = queries.slice(cursor, cursor + Math.min(1, remaining));
      cursor += batch.length;
      return { queries: batch, size: batch.length };
    },
    run: ({ queries: batch }) => processAdjudicationBatch(batch),
    onProgress: ({ completed, scheduled, active, value }) => emit("stage_progress", {
      stage: "adjudicate", done: completed, scheduled, requested: queries.length,
      query: value?.query?.query,
      winner: value?.winner,
      agreement: value?.agreement,
      active_cohorts: active,
    }),
  });
  return result.completed;
}
