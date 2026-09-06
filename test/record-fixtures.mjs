import { resolveTaxonomy } from '../src/taxonomy.mjs';
export const entity = { entity_id: "character:10163", target_kind: "character", target_key: "10163", character: "➳", name: "WHITE-FEATHERED RIGHTWARDS ARROW", hex: "27b3" };
export const renders = [{ vendor: "noto", path: "noto.png", analysis: { ink_hash: "a" } }, { vendor: "platform", path: "platform.png", analysis: { ink_hash: "b" } }];
export function draft(target = entity) {
  const fixed = resolveTaxonomy(target);
  return { entity_id: target.entity_id, status: "ready", family: fixed.family,
    subfamily: fixed.subfamily ?? fixed.allowed_subfamilies?.[0] ?? null,
    subfamily_basis: fixed.subfamily_basis ?? (fixed.allowed_subfamilies ? "model" : null),
    description: { identity: "A feathered right arrow.", appearance: "A right-pointing arrow with a fletched tail and narrow straight shaft.", meaning: null },
    meaning_evidence: null, names: [], collections: [],
    properties: [{ key: "direction", values: ["right"], basis: "identity", attachments: [], evidence: "Official name says rightwards." },
      { key: "components", values: ["fletched tail", "triangular arrowhead"], basis: "render", attachments: [1, 2], evidence: "Tail fletching and triangular head are visible." }], uncertainties: [] };
}
export function discovery(record) {
  return { entity_id: record.entity_id, candidates: [
    { id: "c1", phrase: "feathered arrow", intent: "appearance", register: "descriptive", supports: ["description.appearance"] },
    { id: "c2", phrase: "arrow with feathers", intent: "appearance", register: "casual", supports: ["properties.components"] },
    { id: "c3", phrase: "heading ornament", intent: "use", register: "descriptive", supports: ["properties.components"] },
  ] };
}
export function factualReview(record, paths) {
  return { entity_id: record.entity_id, checks: paths.map((path) => ({ path, verdict: "supported",
    basis: (path === "description.meaning" || path === "names") ? "convention" : path.startsWith("names.") ? record.names[Number(path.split(".")[1])].basis : path === "subfamily" ? "render" : path === "description.appearance" || path === "properties.1" ? "render" : "identity",
    attachments: path === "subfamily" ? [1] : path === "properties.1" ? record.properties[1].attachments : path === "description.appearance" ? [1] : [],
    evidence: "Fixture observation or supplied identity establishes this feature." })) };
}
export function vocabularyReview(value, baseline) {
  const known = baseline.find((row) => row.phrase === "feathered arrow");
  return { entity_id: value.entity_id, checks: value.candidates.map((row, i) => ({ candidate_id: row.id,
    relevance: "direct", grounding: "The fletching or ornamental use supports this phrase.",
    baseline_relation: i < 2 && known ? (i === 0 ? "existing" : "rewording") : "proposed-new-intent",
    baseline_ids: i < 2 && known ? [known.id] : [], comparison: "One visual intent and one ornamental use.", group_id: i < 2 ? "shape" : "use" })),
    groups: [{ id: "shape", intent: "appearance", description: "Find an arrow by its feathered tail.", representative_id: "c1" },
      { id: "use", intent: "use", description: "Decorate a heading with an ornamental pointer.", representative_id: "c3" }] };
}
