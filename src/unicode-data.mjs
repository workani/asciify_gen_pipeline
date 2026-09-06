// Pinned UCD inputs; no corpus names, model labels, network, or ref.db at runtime.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../data/unicode/17.0.0/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
export const UNICODE_VERSION = manifest.unicode_version;
export const UNICODE_DATA_HASH = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
function read(name) {
  const bytes = readFileSync(new URL(name, root));
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.sources[name].sha256) throw new Error(`Unicode data checksum mismatch: ${name}`);
  return bytes.toString('utf8');
}
const entries = new Map(), ranges = [], aliases = new Map(), blocks = [], emojis = new Map(), pictographs = [];
let first;
for (const line of read('UnicodeData.txt').trim().split('\n')) {
  const f = line.split(';'), cp = parseInt(f[0], 16);
  const value = { name: f[1], gc: f[2], decomposition: f[5] };
  if (f[1].endsWith(', First>')) { first = { lo: cp, ...value }; continue; }
  if (f[1].endsWith(', Last>')) { ranges.push({ ...first, hi: cp }); first = null; continue; }
  entries.set(cp, value);
}
for (const line of read('NameAliases.txt').split('\n')) {
  const [hex, name, type] = line.split('#')[0].trim().split(';').map(s => s.trim());
  if (['control', 'figment'].includes(type) && !aliases.has(parseInt(hex, 16))) aliases.set(parseInt(hex, 16), name);
}
for (const line of read('Blocks.txt').split('\n')) {
  const [range, name] = line.split('#')[0].trim().split(';').map(s => s.trim());
  if (!name) continue;
  const [lo, hi = lo] = range.split('..').map(s => parseInt(s, 16));
  blocks.push({ lo, hi, name });
}
for (const line of read('emoji-data.txt').split('\n')) {
  const [range, property] = line.split('#')[0].trim().split(';').map(s => s.trim());
  if (property !== 'Extended_Pictographic') continue;
  const [lo, hi = lo] = range.split('..').map(s => parseInt(s, 16));
  pictographs.push({ lo, hi });
}
function rangeAt(list, cp) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, row = list[mid];
    if (cp < row.lo) hi = mid - 1;
    else if (cp > row.hi) lo = mid + 1;
    else return row;
  }
  return null;
}
export const sequenceKey = cps => cps.map(cp => cp.toString(16).toUpperCase().padStart(4, '0')).join(' ');
let group, subgroup;
for (const line of read('emoji-test.txt').split('\n')) {
  if (line.startsWith('# group:')) group = line.slice(8).trim();
  else if (line.startsWith('# subgroup:')) subgroup = line.slice(11).trim();
  else if (/^[0-9A-F]/.test(line)) {
    const [hex, rest] = line.split(';');
    const status = rest.split('#')[0].trim();
    const name = rest.match(/#.*? E[\d.]+ (.*)$/)?.[1] ?? '';
    emojis.set(sequenceKey(hex.trim().split(/\s+/).map(s => parseInt(s, 16))), Object.freeze({ group, subgroup, status, name }));
  }
}
export function emojiInfo(cps) { return emojis.get(sequenceKey(cps)) ?? null; }
export function unicodeCharacter(cp) {
  const row = entries.get(cp) ?? rangeAt(ranges, cp);
  const name = aliases.get(cp) ?? row?.name ?? '';
  return { cp, hex: sequenceKey([cp]), char: String.fromCodePoint(cp), gc: row?.gc ?? 'Cn',
    block: rangeAt(blocks, cp)?.name ?? null, name, upperName: name.toUpperCase(), decomposition: row?.decomposition ?? '',
    extendedPictographic: rangeAt(pictographs, cp) !== null, emojiInfo: emojiInfo([cp]) };
}

// Fresh metadata objects; callers cannot mutate the source lookup table.
export function fullyQualifiedEmoji() {
  return [...emojis].filter(([, info]) => info.status === 'fully-qualified').map(([hex, info]) => ({
    hex, glyph: hex.split(' ').map(token => String.fromCodePoint(parseInt(token, 16))).join(''), ...info,
  }));
}
