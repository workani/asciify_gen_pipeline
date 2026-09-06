// Dataset construction only: no query resolver, search index, ranking or model.
import { fullyQualifiedEmoji } from './unicode-data.mjs';
import { characterMetadata, resolveTaxonomy, TAXONOMY_VERSION } from './taxonomy.mjs';
import { colorSwatch, COLOR_NAMES } from './taxonomy-colors.mjs';
export const COLORS_COLLECTION = Object.freeze({
  id: 'colors', label: 'Colors',
  description: 'The complete Unicode color swatch set: colored circles, squares and solid hearts. Hearts cover pink, grey and light blue where circle and square emoji do not exist.',
  queries: Object.freeze(['colors', 'colours', 'all colors', 'all colours', 'color palette', 'colour palette', 'color swatches']),
});
export function buildColorsCollection() {
  const members = fullyQualifiedEmoji().flatMap(row => {
    const c = characterMetadata(row.glyph), swatch = colorSwatch(c);
    if (!swatch) return [];
    const taxonomy = resolveTaxonomy(row.glyph);
    return [{ id: `unicode:${row.hex.toLowerCase().replaceAll(' ', '-')}`, collection_id: 'colors', character: row.glyph, hex: row.hex, name: row.name, family: taxonomy.family,
      subfamily: taxonomy.subfamily, color: swatch.color, size: swatch.size,
      basis: 'unicode', source: 'emoji-test.txt', presentation: 'fully-qualified' }];
  }).sort((a,b) => COLOR_NAMES.indexOf(a.color) - COLOR_NAMES.indexOf(b.color) || ['circle','square','heart'].indexOf(a.subfamily) - ['circle','square','heart'].indexOf(b.subfamily) || a.hex.localeCompare(b.hex));
  const colors = COLOR_NAMES.map(color => ({ color, members: members.filter(row => row.color === color).map(row => row.hex) }));
  if (colors.some(row => !row.members.length)) throw new Error('Incomplete Unicode colors collection');
  return { ...COLORS_COLLECTION, taxonomy_version: TAXONOMY_VERSION, membership_basis: 'unicode',
    complete: true, retrieval_unit: 'complete_collection', membership_policy: 'expand_all_members_without_semantic_pruning', color_count: colors.length, member_count: members.length, colors, members };
}
export function codeCollectionMemberships(taxonomy) {
  return taxonomy.collection_ids.includes('colors') ? [{ id: 'colors', fit: 'secondary', prefer_over: null,
    reason: 'Official Unicode color swatch; deterministic membership in the complete colors set.', basis: 'unicode' }] : [];
}
