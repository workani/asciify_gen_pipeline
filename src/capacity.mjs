import { config } from "./config.mjs";

function ceil(value) {
  return Math.ceil(Math.max(0, value));
}

export function estimateCapacity({
  entities = 10_000,
  observedCalls = 68,
  observedMinutes = 10,
  observedTokens = 200_000,
  rewriteShare = 1,
  safetyFactor = 2,
  legacy = false,
} = {}) {
  const calls = legacy ? {
    blind_ground: ceil(entities * config.blindCallsPerEntity),
    enrich: ceil(entities * config.enrichVotes),
    contrast: ceil(entities * config.contrastVotes),
    verify: ceil(entities * config.verifyVotes),
    rewrite: ceil(entities * rewriteShare * config.rewriteVotes),
    reverify: ceil(entities * rewriteShare * config.verifyVotes),
    recover: ceil(entities * config.recoverVotes),
    synth: ceil(entities * config.synthVotes / config.synthBatch),
    adjudicate: ceil(entities * config.adjudicateVotes / config.adjudicateBatch),
  } : { records: ceil(entities * 2) };
  const totalCalls = Object.values(calls).reduce((sum, value) => sum + value, 0);
  const callsPerMinute = observedCalls / observedMinutes;
  const rawMinutes = totalCalls / callsPerMinute;
  const projectedMinutes = rawMinutes * safetyFactor;
  const tokensPerCall = observedTokens / observedCalls;
  return {
    entities,
    assumptions: {
      pipeline: legacy ? "legacy-alias-research" : "reviewed-records",
      structural_repairs: "up to one additional call per phase; covered approximately by safety factor",
      rewrite_share: rewriteShare,
      contrastive_queries_per_entity: 1,
      observed_calls_per_minute: callsPerMinute,
      observed_tokens_per_call: tokensPerCall,
      safety_factor: safetyFactor,
    },
    calls,
    total_calls: totalCalls,
    projected_tokens: ceil(totalCalls * tokensPerCall * safetyFactor),
    projected_hours: projectedMinutes / 60,
    projected_days: projectedMinutes / 60 / 24,
    weekly_capacity: Math.floor(entities * (7 * 24 * 60) / projectedMinutes),
  };
}
