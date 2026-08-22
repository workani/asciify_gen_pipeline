import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, PIPELINE_VERSION, STAGE_VERSIONS } from "./config.mjs";
import { emit } from "./log.mjs";
import { normalizeTerm } from "./normalize.mjs";
import {
  allAdjudicationsV2,
  allClaimsV2,
  allConfusionEdges,
  allQueriesV2,
  checkpointSummary,
  queryV2ById,
  selectedEntities,
  selectionSummary,
  totals,
} from "./state.mjs";

const FAMILY_WEIGHT = {
  identity: 1,
  colloquial: 0.98,
  usage: 0.93,
  cultural: 0.9,
  technical: 0.9,
  visual: 0.86,
  constraint: 0.82,
};

function sql(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function jsonl(rows) {
  return rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function termWeight(claim, documentFrequency) {
  const family = FAMILY_WEIGHT[claim.family] ?? 0.8;
  const scope = claim.status === "platform_specific" ? 0.82 : 1;
  const distinctiveness = 1 / Math.max(1, Math.log2(documentFrequency + 1));
  return clamp(Number(claim.confidence) * family * scope * distinctiveness, 0.25, 1);
}

function buildQualityReport({ entities, claims, queries, adjudications, phraseFrequency }) {
  const checkpoints = checkpointSummary();
  const verifiedByEntity = new Map();
  for (const claim of claims) verifiedByEntity.set(claim.entity_id, (verifiedByEntity.get(claim.entity_id) ?? 0) + 1);
  const aliasesPerEntity = entities.map((entity) => verifiedByEntity.get(entity.entity_id) ?? 0);
  aliasesPerEntity.sort((a, b) => a - b);
  const percentile = (p) => aliasesPerEntity.length
    ? aliasesPerEntity[Math.min(aliasesPerEntity.length - 1, Math.floor((aliasesPerEntity.length - 1) * p))]
    : 0;
  const byFamily = {};
  for (const claim of claims) byFamily[claim.family] = (byFamily[claim.family] ?? 0) + 1;
  const byQueryClass = {};
  const byBaseline = {};
  const byEvalSplit = {};
  let augmentedTop5 = 0;
  const queryEntities = new Set();
  let contrastiveQueries = 0;
  for (const query of queries) {
    queryEntities.add(query.entity_id);
    if (query.must_beat.length > 0 || query.must_not.length > 0) contrastiveQueries++;
    byQueryClass[query.qclass] = (byQueryClass[query.qclass] ?? 0) + 1;
    byBaseline[query.status] = (byBaseline[query.status] ?? 0) + 1;
    byEvalSplit[query.eval_split ?? "development"] = (byEvalSplit[query.eval_split ?? "development"] ?? 0) + 1;
    if (query.augmented_rank !== null && query.augmented_rank !== undefined && query.augmented_rank > 0 && query.augmented_rank <= 5) {
      augmentedTop5++;
    }
  }
  const adjudicatedQueryIds = new Set(adjudications.map((row) => row.query_id).filter(Boolean));
  const adjudicatedContrastive = queries.filter((query) =>
    (query.must_beat.length > 0 || query.must_not.length > 0) && adjudicatedQueryIds.has(query.id),
  ).length;
  const recoverVersions = checkpoints.recover?.versions ?? {};
  const recoverCounts = recoverVersions[STAGE_VERSIONS.recover] ?? {};
  const recoverEvaluated = Number(recoverCounts.passed ?? 0) + Number(recoverCounts.failed ?? 0);
  const recoverPassed = Number(recoverCounts.passed ?? 0);
  return {
    pipeline_version: PIPELINE_VERSION,
    generated_at: new Date().toISOString(),
    selection: selectionSummary(),
    checkpoints,
    claim_recovery: {
      passed: recoverPassed,
      failed: Number(recoverCounts.failed ?? 0),
      quarantined: Number(recoverCounts.quarantined ?? 0),
      evaluated: recoverEvaluated,
      top1_rate: recoverEvaluated ? recoverPassed / recoverEvaluated : 0,
      entity_coverage_rate: entities.length ? recoverPassed / entities.length : 0,
    },
    aliases: {
      total_verified: claims.length,
      covered_entities: verifiedByEntity.size,
      uncovered_entities: entities.length - verifiedByEntity.size,
      coverage_rate: entities.length ? verifiedByEntity.size / entities.length : 0,
      per_entity: { p0: percentile(0), p50: percentile(0.5), p90: percentile(0.9), p100: percentile(1) },
      by_family: byFamily,
      broad_phrases_over_12_targets: [...phraseFrequency.values()].filter((count) => count > 12).length,
    },
    queries: {
      total: queries.length,
      covered_entities: queryEntities.size,
      entity_coverage_rate: entities.length ? queryEntities.size / entities.length : 0,
      by_class: byQueryClass,
      by_baseline_status: byBaseline,
      by_eval_split: byEvalSplit,
      augmented_top5_rate: queries.length ? augmentedTop5 / queries.length : 0,
      contrastive: contrastiveQueries,
      adjudicated_contrastive: adjudicatedContrastive,
      contrastive_adjudication_rate: contrastiveQueries ? adjudicatedContrastive / contrastiveQueries : 0,
    },
    adjudications: {
      total: adjudications.length,
      high_agreement: adjudications.filter((row) => row.agreement >= 0.8).length,
      mean_agreement: adjudications.length
        ? adjudications.reduce((sum, row) => sum + row.agreement, 0) / adjudications.length
        : 0,
    },
    tokens: totals(),
  };
}

export function publishGateFailures(quality) {
  const failures = [];
  if (quality.selection.total < 20_000 || quality.selection.total > 30_000) {
    failures.push(`selected entity count ${quality.selection.total} is outside 20,000..30,000`);
  }
  if (quality.aliases.coverage_rate < 0.95) {
    failures.push(`verified alias coverage ${(quality.aliases.coverage_rate * 100).toFixed(2)}% is below 95%`);
  }
  if (quality.aliases.per_entity.p50 < 3) {
    failures.push(`median verified aliases per entity ${quality.aliases.per_entity.p50} is below 3`);
  }
  if (quality.claim_recovery && quality.claim_recovery.entity_coverage_rate < 0.9) {
    failures.push(`claim-recovery coverage ${(quality.claim_recovery.entity_coverage_rate * 100).toFixed(2)}% is below 90%`);
  }
  if (quality.claim_recovery?.evaluated > 0 && quality.claim_recovery.top1_rate < 0.9) {
    failures.push(`claim-recovery Top-1 ${(quality.claim_recovery.top1_rate * 100).toFixed(2)}% is below 90%`);
  }
  if (quality.queries.entity_coverage_rate < 0.9) {
    failures.push(`query coverage ${(quality.queries.entity_coverage_rate * 100).toFixed(2)}% is below 90%`);
  }
  if ((quality.queries.by_baseline_status.unvalidated ?? 0) > 0) {
    failures.push(`${quality.queries.by_baseline_status.unvalidated} queries have not been round-trip measured`);
  }
  if (!(quality.queries.augmented_top5_rate >= 0.9)) {
    failures.push(`augmented query Top-5 rate ${(quality.queries.augmented_top5_rate * 100).toFixed(2)}% is below 90%`);
  }
  if (quality.queries.contrastive > 0 && quality.queries.contrastive_adjudication_rate < 0.9) {
    failures.push(
      `contrastive adjudication coverage ${(quality.queries.contrastive_adjudication_rate * 100).toFixed(2)}% is below 90%`,
    );
  }
  for (const [stage, value] of Object.entries(quality.checkpoints)) {
    for (const [version, statuses] of Object.entries(value.versions ?? {})) {
      if ((statuses.running ?? 0) > 0) failures.push(`${stage}@${version} still has ${statuses.running} running checkpoints`);
    }
  }
  return failures;
}

function buildSearchTermRows(claims, adjudications, phraseFrequency, entitiesById) {
  const terms = [];
  for (const claim of claims) {
    const frequency = phraseFrequency.get(claim.normalized_phrase) ?? 1;
    if (claim.confidence < 0.62 || frequency > 12) continue;
    if (claim.status === "platform_specific" && claim.confidence < 0.78) continue;
    terms.push({
      target_kind: claim.target_kind,
      target_key: claim.target_key,
      term: claim.phrase,
      normalized_term: claim.normalized_phrase,
      weight: termWeight(claim, frequency),
      provenance: "verified-claim",
      notes: {
        claim_id: claim.id,
        family: claim.family,
        confidence: claim.confidence,
        prompt_version: claim.prompt_version,
      },
    });
  }
  for (const adjudication of adjudications) {
    if (!adjudication.winner_entity_id || adjudication.agreement < 0.7) continue;
    const query = queryV2ById(adjudication.query_id);
    const winner = entitiesById.get(adjudication.winner_entity_id);
    if (!query || !winner) continue;
    const normalized = normalizeTerm(query.query);
    if (!normalized) continue;
    terms.push({
      target_kind: winner.target_kind,
      target_key: winner.target_key,
      term: query.query,
      normalized_term: normalized,
      weight: clamp(adjudication.agreement * 1.05, 0.5, 1.05),
      provenance: "cluster-adjudication",
      notes: {
        adjudication_id: adjudication.id,
        agreement: adjudication.agreement,
        entropy: adjudication.entropy,
        query_id: query.id,
      },
    });
  }
  const deduped = new Map();
  for (const term of terms) {
    const key = `${term.target_kind}|${term.target_key}|${term.normalized_term}`;
    const previous = deduped.get(key);
    if (!previous || term.weight > previous.weight) deduped.set(key, term);
  }
  return [...deduped.values()].sort((a, b) =>
    a.target_kind.localeCompare(b.target_kind) ||
    a.target_key.localeCompare(b.target_key, "en", { numeric: true }) ||
    b.weight - a.weight ||
    a.normalized_term.localeCompare(b.normalized_term),
  );
}

function searchTermsSql(rows) {
  const lines = [
    "BEGIN IMMEDIATE;",
    `DELETE FROM unicode_search_terms WHERE source=${sql(config.source)};`,
  ];
  for (const row of rows) {
    const notes = JSON.stringify({ pipeline_version: PIPELINE_VERSION, provenance: row.provenance, ...row.notes });
    lines.push(
      `INSERT INTO unicode_search_terms (target_kind,target_key,term,normalized_term,weight,source,locale,notes) VALUES (` +
      `${sql(row.target_kind)},${sql(row.target_key)},${sql(row.term)},${sql(row.normalized_term)},${row.weight.toFixed(4)},${sql(config.source)},'en',${sql(notes)}) ` +
      "ON CONFLICT(locale,normalized_term,target_kind,target_key,source) DO UPDATE SET " +
      "term=excluded.term,weight=excluded.weight,notes=excluded.notes,updated_at=unixepoch();",
    );
  }
  lines.push("COMMIT;", "");
  return lines.join("\n");
}

function synonymsSql(entities, claimsByEntity, phraseFrequency) {
  const lines = [
    `-- Idempotent snapshot for Asciify ref.db; generator ${PIPELINE_VERSION}`,
    "BEGIN IMMEDIATE;",
  ];
  for (const entity of entities) {
    if (entity.target_kind !== "character") continue;
    const accepted = (claimsByEntity.get(entity.entity_id) ?? []).filter((claim) =>
      claim.confidence >= 0.6 && (phraseFrequency.get(claim.normalized_phrase) ?? 1) <= 50,
    );
    if (accepted.length === 0) continue;
    const pieces = [String(entity.existing_synonyms ?? "").trim(), ...accepted.map((claim) => claim.phrase)]
      .filter(Boolean);
    const seen = new Set();
    const merged = pieces.filter((piece) => {
      const key = normalizeTerm(piece);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(" ");
    lines.push(`UPDATE characters SET synonyms=${sql(merged)} WHERE code_point=${Number(entity.code_point)};`);
  }
  lines.push("COMMIT;", "");
  return lines.join("\n");
}

export function emitArtifacts({ allowPartial = true } = {}) {
  const entities = selectedEntities();
  const claims = allClaimsV2();
  const queries = allQueriesV2();
  const adjudications = allAdjudicationsV2();
  const confusionEdges = allConfusionEdges();
  if (entities.length === 0) throw new Error("No active entity selection. Run the plan command first.");
  if (!allowPartial && claims.length === 0) throw new Error("No verified claims are available to publish.");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = join(config.outDir, `${stamp}-${PIPELINE_VERSION}`);
  mkdirSync(directory, { recursive: true });
  const entitiesById = new Map(entities.map((entity) => [entity.entity_id, entity]));
  const claimsByEntity = new Map();
  const phraseTargets = new Map();
  for (const claim of claims) {
    const bucket = claimsByEntity.get(claim.entity_id) ?? [];
    bucket.push(claim);
    claimsByEntity.set(claim.entity_id, bucket);
    const targets = phraseTargets.get(claim.normalized_phrase) ?? new Set();
    targets.add(claim.entity_id);
    phraseTargets.set(claim.normalized_phrase, targets);
  }
  const phraseFrequency = new Map([...phraseTargets].map(([phrase, targets]) => [phrase, targets.size]));
  const searchTerms = buildSearchTermRows(claims, adjudications, phraseFrequency, entitiesById);

  const aliasRows = entities.map((entity) => {
    const grouped = {};
    for (const claim of claimsByEntity.get(entity.entity_id) ?? []) {
      const family = grouped[claim.family] ?? [];
      family.push({
        text: claim.phrase,
        normalized: claim.normalized_phrase,
        confidence: claim.confidence,
        status: claim.status,
        claim_id: claim.id,
      });
      grouped[claim.family] = family;
    }
    return {
      entity_id: entity.entity_id,
      target_kind: entity.target_kind,
      target_key: entity.target_key,
      hex: entity.hex,
      character: entity.character,
      name: entity.name,
      category_key: entity.category_key,
      selection_rank: entity.selection_rank,
      aliases: grouped,
    };
  });
  const aliasDocs = claims.map((claim) => ({
    id: `factory:${PIPELINE_VERSION}:${claim.id}`,
    entity_id: claim.entity_id,
    target_kind: claim.target_kind,
    target_key: claim.target_key,
    hex: claim.hex,
    text: claim.phrase,
    normalized_text: claim.normalized_phrase,
    family: claim.family,
    weight: termWeight(claim, phraseFrequency.get(claim.normalized_phrase) ?? 1),
    source: config.source,
    model: config.model,
    prompt_version: claim.prompt_version,
    metadata: {
      entity: claim.target_key,
      entity_id: claim.entity_id,
      family: claim.family,
      generator: PIPELINE_VERSION,
      confidence: claim.confidence,
      category_key: claim.category_key,
    },
  }));
  const goldens = queries.map((query) => ({
    query: query.query,
    class: query.qclass,
    expect: { [query.hex]: 3 },
    forbid: query.must_not.map((id) => entitiesById.get(id)?.hex).filter(Boolean),
    must_beat: query.must_beat.map((id) => entitiesById.get(id)?.hex).filter(Boolean),
    target_kind: query.target_kind,
    target_key: query.target_key,
    source: config.source,
    confidence: query.confidence,
    eval_split: query.eval_split ?? "development",
    retrieval: {
      status: query.status,
      baseline_rank: query.baseline_rank,
      augmented_rank: query.augmented_rank,
    },
    claim_ids: query.claim_ids,
  }));
  const preferencePairs = [];
  const guards = [];
  for (const adjudication of adjudications) {
    const query = queryV2ById(adjudication.query_id);
    if (!query || !adjudication.winner_entity_id) continue;
    const winnerProbability = adjudication.distribution[adjudication.winner_entity_id] ?? 0;
    for (const [loserId, loserProbability] of Object.entries(adjudication.distribution)) {
      if (loserId === adjudication.winner_entity_id || winnerProbability - loserProbability < 0.15) continue;
      preferencePairs.push({
        query: query.query,
        winner: adjudication.winner_entity_id,
        loser: loserId,
        winner_p: winnerProbability,
        loser_p: loserProbability,
        margin: winnerProbability - loserProbability,
        agreement: adjudication.agreement,
        source: config.source,
      });
      if (adjudication.winner_entity_id === query.entity_id && adjudication.agreement >= 0.6) {
        guards.push({
          query: query.query,
          victim: query.entity_id,
          thief: loserId,
          p_victim: winnerProbability,
          p_thief: loserProbability,
          agreement: adjudication.agreement,
        });
      }
    }
  }
  const quality = buildQualityReport({ entities, claims, queries, adjudications, phraseFrequency });
  quality.publish_gate = {
    passed: publishGateFailures(quality).length === 0,
    failures: publishGateFailures(quality),
  };
  if (!allowPartial && !quality.publish_gate.passed) {
    throw new Error(`Dataset is not publishable:\n- ${quality.publish_gate.failures.join("\n- ")}`);
  }

  const files = new Map([
    ["entities.jsonl", jsonl(entities.map((entity) => ({
      entity_id: entity.entity_id, target_kind: entity.target_kind, target_key: entity.target_key,
      hex: entity.hex, character: entity.character, name: entity.name, category_key: entity.category_key,
      popularity: entity.popularity, selection_rank: entity.selection_rank,
      selection_tier: entity.selection_tier, selection_score: entity.selection_score,
      selection_reasons: entity.selection_reasons,
    })))],
    ["aliases.jsonl", jsonl(aliasRows)],
    ["claims.jsonl", jsonl(claims)],
    ["alias_docs.jsonl", jsonl(aliasDocs)],
    ["search_terms.jsonl", jsonl(searchTerms)],
    ["unicode_search_terms.sql", searchTermsSql(searchTerms)],
    ["synonyms_backfill.sql", synonymsSql(entities, claimsByEntity, phraseFrequency)],
    ["goldens.jsonl", jsonl(goldens)],
    ["heldout_goldens.jsonl", jsonl(goldens.filter((row) => row.eval_split === "held_out"))],
    ["confusion_edges.jsonl", jsonl(confusionEdges)],
    ["preference_pairs.jsonl", jsonl(preferencePairs)],
    ["guards.jsonl", jsonl(guards)],
    ["quality_report.json", `${JSON.stringify(quality, null, 2)}\n`],
  ]);
  const manifestFiles = [];
  for (const [name, contents] of files) {
    const path = join(directory, name);
    writeFileSync(path, contents);
    manifestFiles.push({ name, bytes: Buffer.byteLength(contents), sha256: sha256(path) });
  }
  const manifest = {
    dataset: "asciify-unicode-search-evidence",
    version: PIPELINE_VERSION,
    created_at: new Date().toISOString(),
    model: config.model,
    source: config.source,
    stage_versions: STAGE_VERSIONS,
    counts: {
      entities: entities.length,
      verified_claims: claims.length,
      alias_docs: aliasDocs.length,
      search_terms: searchTerms.length,
      queries: queries.length,
      adjudications: adjudications.length,
      preference_pairs: preferencePairs.length,
      guards: guards.length,
      confusion_edges: confusionEdges.length,
    },
    quality,
    files: manifestFiles,
  };
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  emit("emit", { dir: directory, ...manifest.counts });
  return directory;
}
