// Swatches are complete color-bearing glyph identities, not scenes containing a
// colored feature. Official emoji-test names distinguish pink/grey/light blue
// hearts, and avoid inferring color from monochrome BLACK/WHITE Unicode names.
export const COLOR_NAMES = Object.freeze(['red', 'orange', 'yellow', 'green', 'blue', 'light blue', 'purple', 'pink', 'brown', 'black', 'grey', 'white']);
export function colorSwatch(c) {
  const info = c.emojiInfo;
  if (!info || !['heart', 'geometric'].includes(info.subgroup)) return null;
  const match = info.name.match(/^(light blue|red|orange|yellow|green|blue|purple|brown|black|white|pink|grey) (?:(large|medium|medium-small|small) )?(heart|circle|square)$/);
  if (!match) return null;
  // Explicit text presentation is not a reliable color swatch.
  if (c.char?.includes('\uFE0E')) return null;
  return { color: match[1], shape: match[3], size: match[2] ?? null };
}
