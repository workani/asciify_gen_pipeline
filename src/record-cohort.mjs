import { resolveTaxonomy, FAMILIES } from './taxonomy.mjs';
import { selectEntities } from './selection.mjs';
import { normalizeRecordText } from './records.mjs';
import { REGISTERS } from './record-vocabulary.mjs';

// Pure dataset selection and consistency checks. No queries, ranking or model calls.
export function selectRecordCohort(corpus, { family = null, cps = [] } = {}) {
  if (family && !FAMILIES.includes(family)) throw new Error(`Unknown family: ${family}`);
  if (family && cps.length) throw new Error('Choose --family or --cps, not both');
  const characters = corpus.characters.filter(row => family
    ? resolveTaxonomy(row).family === family : cps.includes(row.code_point));
  const sequences = family ? corpus.sequences.filter(row => resolveTaxonomy({ character: row.emoji }).family === family) : [];
  if (!family && characters.length !== new Set(cps).size) throw new Error('Some requested code points are missing from ref.db');
  if (!characters.length && !sequences.length) throw new Error('No members in the requested cohort');
  // An explicit full family includes even normally low-priority/excluded characters.
  // The existing selector folds scalar/VS-only duplicate sequences into their character.
  const selection = selectEntities({ characters, sequences, target: characters.length + sequences.length,
    explorationShare: 0, seedKeys: new Set(characters.map(row => `character:${row.code_point}`)) });
  return { entities: selection.selected, scope: family ? 'full-family' : 'sample', family,
    source_rows: characters.length + sequences.length,
    presentation_duplicates_omitted: characters.length + sequences.length - selection.selected.length };
}

export function auditRecordCohort(entities, records, { scope = 'selection', family = null } = {}) {
  const expected = new Map(entities.map(entity => [entity.entity_id, resolveTaxonomy(entity)]));
  const seen = new Set(), errors = [], families = {}, descriptions = new Map();
  for (const [id, fixed] of expected) {
    const row = families[fixed.family] ??= { expected: 0, accepted: 0, missing: [], code_subfamilies: {}, subfamilies: {}, below_phrase_target: [], registers: Object.fromEntries(REGISTERS.map(r => [r, 0])) };
    row.expected++;
    const subfamily = fixed.subfamily ?? 'null';
    row.code_subfamilies[subfamily] = (row.code_subfamilies[subfamily] ?? 0) + 1;
  }
  for (const record of records) {
    const id = record.entity_id, fixed = expected.get(id);
    if (!fixed) { errors.push({ entity_id: id, reason: 'unexpected_record' }); continue; }
    if (seen.has(id)) { errors.push({ entity_id: id, reason: 'duplicate_record' }); continue; }
    seen.add(id);
    if (fixed.subfamily_gap !== null || record.family !== fixed.family || (fixed.subfamily === null &&
        record.subfamily_basis !== (fixed.allowed_subfamilies ? 'model' : null)) || (fixed.subfamily !== null &&
        (record.subfamily !== fixed.subfamily || record.subfamily_basis !== 'unicode')) ||
        (fixed.allowed_subfamilies ? !fixed.allowed_subfamilies.includes(record.subfamily) : record.subfamily !== null)) {
      errors.push({ entity_id: id, reason: 'fixed_taxonomy_mismatch' });
    }
    const row = families[fixed.family];
    row.accepted++;
    const subfamily = record.subfamily ?? 'null';
    row.subfamilies[subfamily] = (row.subfamilies[subfamily] ?? 0) + 1;
    if (record.contribution?.phrase_shortfall > 0) row.below_phrase_target.push(id);
    for (const register of new Set((record.retrieval_phrases ?? []).map(p => p.register))) row.registers[register]++;
    const body = normalizeRecordText(record.description?.appearance ?? record.description?.identity);
    if (body) {
      const bucket = descriptions.get(body) ?? [];
      // Different explicit geometry/identity under identical prose deserves inspection.
      // This is a review flag, not proof of an error: some distinct characters look alike.
      const signature = JSON.stringify([record.family, record.subfamily,
        [...(record.properties ?? [])].filter(p => ['direction', 'head_direction', 'shape', 'components', 'enclosure', 'filled', 'color', 'stroke'].includes(p.key))
          .map(p => [p.key, [...p.values].sort()]).sort(([a], [b]) => a.localeCompare(b))]);
      bucket.push({ entity_id: id, signature });
      descriptions.set(body, bucket);
    }
  }
  for (const [id, fixed] of expected) if (!seen.has(id)) families[fixed.family].missing.push(id);
  const reviewFlags = [...descriptions].filter(([, rows]) => new Set(rows.map(r => r.signature)).size > 1)
    .map(([description, rows]) => ({ reason: 'identical_description_for_different_facts', description, entity_ids: rows.map(r => r.entity_id) }));
  const missing = [...expected.keys()].filter(id => !seen.has(id));
  return { scope, family, expected: expected.size, accepted: seen.size, missing, errors,
    complete: missing.length === 0 && errors.length === 0,
    full_family_complete: scope === 'full-family' && missing.length === 0 && errors.length === 0,
    families, review_flags: reviewFlags, semantic_review: 'requires_human_review',
    note: 'Checks fixed taxonomy, cohort completeness, per-family register coverage and repeated descriptions across different facts. Counts refer to canonical reference entities. No search evaluation or semantic correctness claim.' };
}
