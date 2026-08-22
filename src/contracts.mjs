import { normalizePhrase, normalizeTerm } from "./normalize.mjs";

export class ContractError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "ContractError";
    this.details = details;
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError(`${label} must be an object`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new ContractError(`${label} must be an array`);
  return value;
}

function boundedConfidence(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function exactCoverage(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (actualSet.size !== actual.length) throw new ContractError(`${label} contains duplicate identifiers`);
  const missing = expected.filter((id) => !actualSet.has(id));
  const extra = actual.filter((id) => !expectedSet.has(id));
  if (missing.length || extra.length) {
    throw new ContractError(`${label} coverage mismatch`, { missing, extra });
  }
}

export function parseBlindOutput(value, expectedIndices) {
  const root = object(value, "blind output");
  const items = array(root.items, "blind output.items");
  const parsed = items.map((raw, position) => {
    const item = object(raw, `items[${position}]`);
    const i = Number(item.i);
    if (!Number.isInteger(i)) throw new ContractError(`items[${position}].i must be an integer`);
    const renderStatus = ["clear", "ambiguous", "missing"].includes(item.render_status)
      ? item.render_status
      : "ambiguous";
    const phrases = (values, label) => array(values ?? [], label).map((entry, index) => {
      const claim = object(entry, `${label}[${index}]`);
      const phrase = normalizePhrase(claim.phrase);
      if (!phrase) return null;
      return {
        phrase: phrase.display,
        normalized_phrase: phrase.normalized,
        confidence: boundedConfidence(claim.confidence),
        facets: Array.isArray(claim.facets) ? claim.facets.map(String).slice(0, 8) : [],
      };
    }).filter(Boolean);
    const confusable = array(item.confusable_indices ?? [], `items[${position}].confusable_indices`)
      .map((entry) => ({
        i: Number(entry?.i),
        reason: String(entry?.reason ?? "visual similarity").slice(0, 160),
        confidence: boundedConfidence(entry?.confidence),
      }))
      .filter((entry) => Number.isInteger(entry.i) && expectedIndices.includes(entry.i) && entry.i !== i);
    return {
      i,
      render_status: renderStatus,
      observations: phrases(item.observations, `items[${position}].observations`),
      resembles: phrases(item.resembles, `items[${position}].resembles`),
      confusable_indices: confusable,
      notes: Array.isArray(item.notes) ? item.notes.map(String).slice(0, 8) : [],
    };
  });
  exactCoverage(parsed.map((item) => item.i), expectedIndices, "blind item indices");
  return parsed.sort((a, b) => a.i - b.i);
}

export const VISUAL_SLOTS = ["overall_form", "count", "color_fill", "orientation", "distinctive_feature"];

export function parseBlindGlyphOutput(value, { legacyIndex = 0 } = {}) {
  const root = object(value, "blind glyph output");
  if (root.slots && typeof root.slots === "object" && !Array.isArray(root.slots)) {
    const slots = {};
    for (const slot of VISUAL_SLOTS) {
      const phrase = root.slots[slot] === null || root.slots[slot] === undefined
        ? null
        : normalizePhrase(root.slots[slot], { maxWords: 10, maxLength: 120 });
      slots[slot] = phrase && !/\b(?:image|grid|cell|index|position)\b/.test(phrase.normalized)
        ? { phrase: phrase.display, normalized_phrase: phrase.normalized, facets: [slot] }
        : null;
    }
    return {
      render_status: ["clear", "ambiguous"].includes(root.render_status) ? root.render_status : "ambiguous",
      slots,
      observations: VISUAL_SLOTS.map((slot) => slots[slot]).filter(Boolean),
      notes: Array.isArray(root.notes) ? root.notes.map(String).slice(0, 4) : [],
    };
  }

  // Read-only compatibility for paid v4 fixtures. New prompts never ask for
  // indices, free-form observations, or self-reported confidence.
  const legacy = parseBlindOutput(root, array(root.items, "blind output.items").map((item) => Number(item?.i)));
  const item = legacy.find((entry) => entry.i === legacyIndex) ?? legacy[0];
  const slots = Object.fromEntries(VISUAL_SLOTS.map((slot) => [slot, null]));
  for (const observation of item.observations) {
    const facets = new Set(observation.facets);
    let slot = facets.has("count") ? "count"
      : (facets.has("color") || facets.has("fill")) ? "color_fill"
        : (facets.has("orientation") || facets.has("direction")) ? "orientation"
          : (facets.has("shape") || facets.has("arrangement")) ? "overall_form"
            : "distinctive_feature";
    if (slots[slot]) slot = VISUAL_SLOTS.find((candidate) => !slots[candidate]) ?? slot;
    slots[slot] = {
      phrase: observation.phrase,
      normalized_phrase: observation.normalized_phrase,
      facets: [slot],
    };
  }
  return {
    render_status: item.render_status,
    slots,
    observations: VISUAL_SLOTS.map((slot) => slots[slot]).filter(Boolean),
    notes: item.notes,
    legacy_contract: true,
  };
}

export function parseBlindConsensusOutput(value, expectedVotes) {
  const root = object(value, "blind consensus output");
  const lookup = expectedVotes instanceof Map
    ? expectedVotes
    : new Map(array(expectedVotes, "expected blind votes").map((vote) => [String(vote.vote_id), vote]));
  const expectedIds = [...lookup.keys()];
  const votes = array(root.votes, "blind consensus output.votes").map((raw, index) => {
    const vote = object(raw, `votes[${index}]`);
    const voteId = String(vote.vote_id ?? "");
    if (!lookup.has(voteId)) throw new ContractError(`votes[${index}] has unknown vote_id`);
    if (typeof vote.coherent !== "boolean") throw new ContractError(`votes[${index}].coherent must be boolean`);
    return {
      vote_id: voteId,
      coherent: vote.coherent,
      reason: String(vote.reason ?? "").slice(0, 240),
    };
  });
  exactCoverage(votes.map((vote) => vote.vote_id), expectedIds, "blind consensus vote ids");
  const coherentIds = new Set(votes.filter((vote) => vote.coherent).map((vote) => vote.vote_id));
  const assigned = new Set();
  const clusters = array(root.clusters ?? [], "blind consensus output.clusters").map((raw, index) => {
    const cluster = object(raw, `clusters[${index}]`);
    const slot = String(cluster.slot ?? "");
    if (!VISUAL_SLOTS.includes(slot)) throw new ContractError(`clusters[${index}] has invalid slot`);
    const voteIds = array(cluster.vote_ids, `clusters[${index}].vote_ids`).map(String);
    if (new Set(voteIds).size !== voteIds.length) throw new ContractError(`clusters[${index}] contains duplicate vote_ids`);
    if (voteIds.length < 2) throw new ContractError(`clusters[${index}] must contain at least two semantically equivalent votes`);
    for (const voteId of voteIds) {
      const expected = lookup.get(voteId);
      if (!expected) throw new ContractError(`clusters[${index}] has unknown vote_id ${voteId}`);
      if (!coherentIds.has(voteId)) throw new ContractError(`clusters[${index}] cites incoherent vote ${voteId}`);
      if (!expected.vote?.slots?.[slot]) throw new ContractError(`clusters[${index}] cites a null ${slot} in ${voteId}`);
      const key = `${slot}:${voteId}`;
      if (assigned.has(key)) throw new ContractError(`${voteId} occurs in multiple ${slot} clusters`);
      assigned.add(key);
    }
    return { slot, vote_ids: voteIds };
  });
  return { votes, clusters };
}

function parseFixedVisualSlots(value, label) {
  const raw = object(value, label);
  return Object.fromEntries(VISUAL_SLOTS.map((slot) => {
    if (raw[slot] === null || raw[slot] === undefined) return [slot, null];
    const phrase = normalizePhrase(raw[slot], { maxWords: 16, maxLength: 180 });
    if (!phrase || /\b(?:image|grid|cell|index|position|candidate|attachment)\b/.test(phrase.normalized)) {
      return [slot, null];
    }
    return [slot, {
      phrase: phrase.display,
      normalized_phrase: phrase.normalized,
      facets: [slot],
    }];
  }));
}

/** Parse the single multimodal call in the adaptive two-call blind stage. */
export function parseBlindGenerationOutput(value, {
  vendors = ["noto", "platform"],
  neighborLabels = [],
} = {}) {
  const root = object(value, "adaptive blind generation output");
  const vendorRoot = object(root.vendor_slots, "adaptive blind generation output.vendor_slots");
  const missingVendors = vendors.filter((vendor) => !vendorRoot[vendor] || typeof vendorRoot[vendor] !== "object");
  if (missingVendors.length) {
    throw new ContractError(`adaptive blind vendor slots missing ${missingVendors.join(",")}`);
  }
  const vendorSlots = Object.fromEntries(vendors.map((vendor) => [
    vendor,
    parseFixedVisualSlots(vendorRoot[vendor], `vendor_slots.${vendor}`),
  ]));
  const sharedSlots = parseFixedVisualSlots(
    root.shared_slots ?? vendorRoot.shared_slots ?? vendorRoot.shared,
    "adaptive blind generation output.shared_slots",
  );
  const allowedNeighbors = new Set(neighborLabels.map(String));
  const seenKeys = new Set();
  const seenPhrases = new Set();
  const claims = array(root.claims ?? [], "adaptive blind generation output.claims").map((raw, index) => {
    const claim = object(raw, `claims[${index}]`);
    const claimKey = String(claim.claim_key ?? "");
    if (!/^c[1-9]\d*$/.test(claimKey) || seenKeys.has(claimKey)) {
      return null;
    }
    if (!["visual", "constraint"].includes(claim.family)) {
      return null;
    }
    const slot = String(claim.slot ?? "");
    if (!["overall_form", "distinctive_feature"].includes(slot)) {
      return null;
    }
    const phrase = normalizePhrase(claim.phrase, { maxWords: 24, maxLength: 240 });
    if (!phrase || seenPhrases.has(phrase.normalized)) {
      return null;
    }
    const supportedBy = Array.isArray(claim.supported_by) ? claim.supported_by.map(String) : [];
    if (supportedBy.length !== vendors.length || new Set(supportedBy).size !== vendors.length ||
        vendors.some((vendor) => !supportedBy.includes(vendor))) return null;
    const distinguishesFrom = Array.isArray(claim.distinguishes_from)
      ? [...new Set(claim.distinguishes_from.map(String).filter((label) => allowedNeighbors.has(label)))]
      : [];
    if (claim.family === "constraint" && distinguishesFrom.length === 0) {
      return null;
    }
    const querySeen = new Set();
    const queries = array(claim.queries, `claims[${index}].queries`).map((rawQuery) => {
      const query = normalizePhrase(rawQuery, { maxWords: 10, maxLength: 120 });
      if (!query || querySeen.has(query.normalized)) return null;
      if (/\b(?:this|target|candidate|image|grid|index|attachment|neighbor-?\d+)\b/.test(query.normalized)) return null;
      querySeen.add(query.normalized);
      return { query: query.display, normalized_query: query.normalized };
    }).filter(Boolean).slice(0, 5);
    if (queries.length < 2) return null;
    seenKeys.add(claimKey);
    seenPhrases.add(phrase.normalized);
    return {
      claim_key: claimKey,
      family: claim.family,
      slot,
      phrase: phrase.display,
      normalized_phrase: phrase.normalized,
      supported_by: supportedBy,
      distinguishes_from: distinguishesFrom,
      queries,
    };
  }).filter(Boolean).slice(0, 5);
  const renderStatus = ["clear", "ambiguous"].includes(root.render_status) ? root.render_status : "ambiguous";
  if (renderStatus === "clear" && claims.length === 0) {
    throw new ContractError("clear adaptive blind generation requires at least one useful claim");
  }
  return {
    render_status: renderStatus,
    vendor_slots: vendorSlots,
    shared_slots: sharedSlots,
    claims,
    notes: Array.isArray(root.notes) ? root.notes.map(String).slice(0, 4) : [],
  };
}

/** Parse the fresh text-only recovery call and cover every generated claim. */
export function parseBlindRecoveryOutput(value, { claimKeys = null, claims = null, validEntityIds }) {
  const root = object(value, "adaptive blind recovery output");
  const picked = root.picked_entity_id === null ? null : String(root.picked_entity_id ?? "");
  if (picked !== null && !validEntityIds.has(picked)) {
    throw new ContractError("adaptive blind recovery picked an unknown entity_id");
  }
  const suppliedClaims = Array.isArray(claims) ? claims : (claimKeys ?? []).map((claim_key) => ({ claim_key, queries: [] }));
  const allowedKeys = new Set(suppliedClaims.map((claim) => String(claim.claim_key)));
  const queriesByClaim = new Map(suppliedClaims.map((claim) => [
    String(claim.claim_key),
    new Map((claim.queries ?? []).map((query) => [
      String(query.normalized_query ?? normalizeTerm(query.query ?? query)),
      String(query.query ?? query),
    ])),
  ]));
  const reviews = array(root.reviews, "adaptive blind recovery output.reviews").map((raw, index) => {
    const review = object(raw, `reviews[${index}]`);
    const claimKey = String(review.claim_key ?? "");
    if (!allowedKeys.has(claimKey)) throw new ContractError(`reviews[${index}] has unknown claim_key`);
    const verdict = String(review.verdict ?? "");
    if (!["supported", "too_broad", "wrong"].includes(verdict)) {
      throw new ContractError(`reviews[${index}] has invalid verdict`);
    }
    const suppliedQueries = queriesByClaim.get(claimKey) ?? new Map();
    const rejectedQueries = Array.isArray(review.rejected_queries)
      ? [...new Set(review.rejected_queries.map((query) => normalizeTerm(query)).filter((query) => suppliedQueries.has(query)))]
      : [];
    return {
      claim_key: claimKey,
      verdict,
      reason: String(review.reason ?? "").slice(0, 300),
      rejected_queries: rejectedQueries,
    };
  });
  exactCoverage(reviews.map((review) => review.claim_key), [...allowedKeys], "adaptive blind recovery claim keys");
  return { picked_entity_id: picked, reviews };
}

const CLAIM_FAMILIES = new Set([
  "identity", "colloquial", "visual", "usage", "cultural", "technical", "constraint",
]);

export function parseEnrichOutput(value, expectedEntityIds, {
  claimMaxWords = 10,
  claimMaxLength = 100,
  requireClaims = false,
} = {}) {
  const root = object(value, "enrich output");
  const items = array(root.items, "enrich output.items");
  const parsed = items.map((raw, index) => {
    const item = object(raw, `items[${index}]`);
    const entityId = String(item.entity_id ?? "");
    const seen = new Set();
    const claims = array(item.claims ?? [], `items[${index}].claims`).map((rawClaim, claimIndex) => {
      const claim = object(rawClaim, `items[${index}].claims[${claimIndex}]`);
      if (!CLAIM_FAMILIES.has(claim.family)) return null;
      const phrase = normalizePhrase(claim.phrase, { maxWords: claimMaxWords, maxLength: claimMaxLength });
      if (!phrase) return null;
      const dedupeKey = `${claim.family}:${phrase.normalized}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      return {
        family: claim.family,
        phrase: phrase.display,
        normalized_phrase: phrase.normalized,
        scope: ["universal", "platform_specific", "community", "specialist"].includes(claim.scope)
          ? claim.scope
          : "universal",
        evidence: String(claim.evidence ?? "").slice(0, 80),
        rationale: String(claim.rationale ?? "").slice(0, 300),
      };
    }).filter(Boolean).slice(0, 6);
    return {
      entity_id: entityId,
      claims,
      tempting_but_wrong: Array.isArray(item.tempting_but_wrong) ? item.tempting_but_wrong.slice(0, 3) : [],
      notes: Array.isArray(item.notes) ? item.notes.map(String).slice(0, 2) : [],
    };
  });
  exactCoverage(parsed.map((item) => item.entity_id), expectedEntityIds, "enrich entity ids");
  if (requireClaims) {
    const empty = parsed.filter((item) => item.claims.length === 0).map((item) => item.entity_id);
    if (empty.length) {
      throw new ContractError(`required claims were empty or outside the phrase bounds for ${empty.join(",")}`, {
        entity_ids: empty,
        claim_max_words: claimMaxWords,
        claim_max_length: claimMaxLength,
      });
    }
  }
  return parsed;
}

export const parseRewriteOutput = parseEnrichOutput;

const VERDICTS = new Set(["supported", "platform_specific", "too_broad", "wrong", "duplicate"]);

export function parseVerifyOutput(value, expectedClaimIds) {
  const root = object(value, "verify output");
  const reviews = array(root.reviews, "verify output.reviews").map((raw, index) => {
    const review = object(raw, `reviews[${index}]`);
    const claimId = Number(review.claim_id);
    if (!Number.isInteger(claimId)) throw new ContractError(`reviews[${index}].claim_id must be an integer`);
    if (!VERDICTS.has(review.verdict)) throw new ContractError(`reviews[${index}] has invalid verdict`);
    const correction = review.corrected_phrase ? normalizePhrase(review.corrected_phrase) : null;
    return {
      claim_id: claimId,
      verdict: review.verdict,
      reason: String(review.reason ?? "").slice(0, 400),
      corrected_phrase: correction?.display ?? null,
      corrected_normalized_phrase: correction?.normalized ?? null,
      confused_entity_id: review.confused_entity_id ? String(review.confused_entity_id) : null,
    };
  });
  exactCoverage(reviews.map((review) => review.claim_id), expectedClaimIds, "verification claim ids");
  return reviews;
}

export function parseVerifyBatchOutput(value, expectedCases) {
  const root = object(value, "verify batch output");
  const cases = array(root.cases, "verify batch output.cases").map((raw, index) => {
    const item = object(raw, `cases[${index}]`);
    const caseId = String(item.case_id ?? "");
    const expected = expectedCases.find((entry) => entry.case_id === caseId);
    if (!expected) throw new ContractError(`cases[${index}] has unknown case_id`);
    return {
      case_id: caseId,
      reviews: parseVerifyOutput({ reviews: item.reviews }, expected.claim_ids),
    };
  });
  exactCoverage(cases.map((item) => item.case_id), expectedCases.map((item) => item.case_id), "verification case ids");
  return cases;
}

const QUERY_CLASSES = new Set([
  "identity", "visual", "colloquial", "usage", "compositional", "constraint", "typo",
]);

export function parseSynthOutput(value, expectedEntityIds, validClaimIds, validNeighborIds) {
  const root = object(value, "synth output");
  const targets = array(root.targets, "synth output.targets").map((raw, index) => {
    const target = object(raw, `targets[${index}]`);
    const entityId = String(target.entity_id ?? "");
    const seen = new Set();
    const expectedClaims = validClaimIds instanceof Map
      ? new Set(validClaimIds.get(entityId) ?? [])
      : validClaimIds;
    const rawGroups = Array.isArray(target.claim_queries)
      ? target.claim_queries
      : [{ claim_id: null, queries: target.queries ?? [], legacy: true }];
    const claimQueries = rawGroups.map((rawGroup, groupIndex) => {
      const group = object(rawGroup, `targets[${index}].claim_queries[${groupIndex}]`);
      const fallbackClaimId = group.legacy ? Number(group.queries?.[0]?.claim_ids?.[0]) : null;
      const claimId = Number(group.claim_id ?? fallbackClaimId);
      if (!Number.isInteger(claimId) || !expectedClaims.has(claimId)) {
        throw new ContractError(`targets[${index}].claim_queries[${groupIndex}] has invalid claim_id`);
      }
      const seen = new Set();
      let typoCount = 0;
      let contrastiveCount = 0;
      const queries = array(group.queries ?? [], `targets[${index}].claim_queries[${groupIndex}].queries`).map((rawQuery, queryIndex) => {
      const query = object(rawQuery, `targets[${index}].queries[${queryIndex}]`);
      if (!QUERY_CLASSES.has(query.class)) return null;
      const phrase = normalizePhrase(query.q, { maxWords: 10, maxLength: 120 });
      if (!phrase || seen.has(phrase.normalized)) return null;
      if (/\b(?:this|target|candidate|image|grid|index|glyph shown)\b/.test(phrase.normalized)) return null;
      if (query.class === "typo" && ++typoCount > 1) return null;
      seen.add(phrase.normalized);
      const neighborList = (list) => Array.isArray(list)
        ? [...new Set(list.map(String).filter((id) => validNeighborIds.has(id)))]
        : [];
      const mustBeat = neighborList(query.must_beat);
      const mustNot = neighborList(query.must_not);
      if ((mustBeat.length > 0 || mustNot.length > 0) && ++contrastiveCount > 1) return null;
      return {
        q: phrase.display,
        normalized_query: phrase.normalized,
        qclass: query.class,
        intent: String(query.intent ?? "").slice(0, 240),
        claim_id: claimId,
        claim_ids: [claimId],
        must_beat: mustBeat,
        must_not: mustNot,
      };
      }).filter(Boolean).slice(0, group.legacy ? 6 : 5);
      if (!group.legacy && queries.length < 2) {
        throw new ContractError(`claim ${claimId} requires 2-5 query phrasings`);
      }
      return { claim_id: claimId, queries };
    });
    if (validClaimIds instanceof Map) {
      exactCoverage(claimQueries.map((group) => group.claim_id), [...expectedClaims], `synth claims for ${entityId}`);
    }
    return { entity_id: entityId, claim_queries: claimQueries, queries: claimQueries.flatMap((group) => group.queries) };
  });
  exactCoverage(targets.map((target) => target.entity_id), expectedEntityIds, "synth entity ids");
  return targets;
}

export function parseRecoverOutput(value, validEntityIds) {
  const root = object(value, "recover output");
  const picked = root.picked_entity_id === null ? null : String(root.picked_entity_id ?? "");
  if (picked !== null && !validEntityIds.has(picked)) throw new ContractError("recover output picked an unknown entity_id");
  return {
    picked_entity_id: picked,
    reason: String(root.reason ?? "").slice(0, 300),
  };
}

export function parseAdjudicateOutput(value, expectedEntityIds) {
  const root = object(value, "adjudicate output");
  const ranking = array(root.ranking, "adjudicate output.ranking").map((raw, index) => {
    const row = object(raw, `ranking[${index}]`);
    return {
      entity_id: String(row.entity_id ?? ""),
      p: boundedConfidence(row.p, 0),
      reason: String(row.reason ?? "").slice(0, 400),
    };
  });
  exactCoverage(ranking.map((row) => row.entity_id), expectedEntityIds, "adjudication entity ids");
  const none = boundedConfidence(root.none_of_these, 0);
  const total = ranking.reduce((sum, row) => sum + row.p, 0) + none;
  if (total < 0.95 || total > 1.05) throw new ContractError(`adjudication probabilities sum to ${total}`);
  const normalizedRanking = ranking.map((row) => ({ ...row, p: row.p / total }));
  return {
    ranking: normalizedRanking.sort((a, b) => b.p - a.p),
    none_of_these: none / total,
    ambiguous: Boolean(root.ambiguous),
    ambiguity_reason: root.ambiguity_reason ? String(root.ambiguity_reason).slice(0, 400) : null,
  };
}

export function parseAdjudicateBatchOutput(value, expectedCases) {
  const root = object(value, "adjudication batch output");
  const cases = array(root.cases, "adjudication batch output.cases").map((raw, index) => {
    const item = object(raw, `cases[${index}]`);
    const caseId = String(item.case_id ?? "");
    const expected = expectedCases.find((entry) => entry.case_id === caseId);
    if (!expected) throw new ContractError(`cases[${index}] has unknown case_id`);
    return {
      case_id: caseId,
      result: parseAdjudicateOutput(item, expected.entity_ids),
    };
  });
  exactCoverage(cases.map((item) => item.case_id), expectedCases.map((item) => item.case_id), "adjudication case ids");
  return cases;
}

export function normalizedFormalName(entity) {
  return normalizeTerm(entity.name);
}
