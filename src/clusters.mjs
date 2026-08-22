import { contentTokens, entityId } from "./normalize.mjs";
import { THIEF_PAIRS } from "./seeds.mjs";
import { selectedEntities, selectedEntity, upsertConfusionEdges } from "./state.mjs";

const DISTINCTIVE_TOKENS = new Set([
  "arrow", "triangle", "circle", "square", "star", "heart", "cross", "hand", "face", "flag",
  "left", "right", "up", "down", "black", "white", "filled", "outline", "open", "closed",
  "small", "large", "double", "triple", "curved", "straight", "horizontal", "vertical",
  "letter", "digit", "mark", "operator", "currency", "music", "chess",
]);

function fromSeedHex(hex) {
  return hex.includes("-")
    ? entityId("emoji_sequence", hex.toLowerCase())
    : entityId("character", String(parseInt(hex, 16)));
}

export function seedFailureConfusions() {
  const edges = [];
  for (const pair of THIEF_PAIRS) {
    const left = fromSeedHex(pair.victim);
    const right = fromSeedHex(pair.thief);
    if (!selectedEntity(left) || !selectedEntity(right)) continue;
    edges.push({
      left_entity_id: left,
      right_entity_id: right,
      reason: `failure-query:${pair.query}`,
      strength: 1,
      source: "failure-report",
      evidence: { query: pair.query, victim: left, thief: right },
    });
  }
  upsertConfusionEdges(edges);
  return edges.length;
}

function similarity(left, right, shared) {
  const leftSet = new Set(left.name_tokens);
  const rightSet = new Set(right.name_tokens);
  const union = new Set([...leftSet, ...rightSet]);
  const jaccard = union.size ? shared.length / union.size : 0;
  const distinctive = shared.filter((token) => DISTINCTIVE_TOKENS.has(token)).length;
  const categoryBonus = left.category_key === right.category_key ? 0.1 : 0;
  return Math.min(0.95, jaccard * 0.65 + Math.min(0.3, distinctive * 0.12) + categoryBonus);
}

export function buildLexicalConfusions({ maxNeighbors = 6, maxTokenFanout = 350 } = {}) {
  const entities = selectedEntities().map((entity) => ({
    ...entity,
    name_tokens: [...new Set(contentTokens(entity.name))],
  }));
  const byId = new Map(entities.map((entity) => [entity.entity_id, entity]));
  const tokenIndex = new Map();
  for (const entity of entities) {
    for (const token of entity.name_tokens) {
      const ids = tokenIndex.get(token) ?? [];
      ids.push(entity.entity_id);
      tokenIndex.set(token, ids);
    }
  }

  const edges = [];
  for (const entity of entities) {
    const sharedCounts = new Map();
    for (const token of entity.name_tokens) {
      const ids = tokenIndex.get(token) ?? [];
      if (ids.length > maxTokenFanout && !DISTINCTIVE_TOKENS.has(token)) continue;
      for (const id of ids) {
        if (id === entity.entity_id) continue;
        const found = sharedCounts.get(id) ?? new Set();
        found.add(token);
        sharedCounts.set(id, found);
      }
    }
    const neighbors = [...sharedCounts.entries()].map(([id, sharedSet]) => {
      const neighbor = byId.get(id);
      const shared = [...sharedSet];
      return { neighbor, shared, strength: similarity(entity, neighbor, shared) };
    }).filter((row) => row.strength >= 0.22)
      .sort((a, b) => b.strength - a.strength || a.neighbor.selection_rank - b.neighbor.selection_rank)
      .slice(0, maxNeighbors);
    for (const row of neighbors) {
      edges.push({
        left_entity_id: entity.entity_id,
        right_entity_id: row.neighbor.entity_id,
        reason: `name-overlap:${row.shared.join("+")}`,
        strength: row.strength,
        source: "deterministic-name-cluster-v1",
        evidence: { shared_tokens: row.shared },
      });
    }
  }
  upsertConfusionEdges(edges);
  return edges.length;
}

export function buildInitialConfusions(options = {}) {
  return {
    failureEdges: seedFailureConfusions(),
    lexicalEdges: buildLexicalConfusions(options),
  };
}
