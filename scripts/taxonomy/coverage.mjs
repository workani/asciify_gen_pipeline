import { buildColorsCollection } from '../../src/dataset-collections.mjs';
// Offline only. Classify the entire corpus, including emoji sequences, before
// generation. Report ALL rows; a second view explicitly excludes private/surrogate.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCharacters } from './ucd.mjs';
import { resolveTaxonomy, FAMILIES, SUBFAMILIES, TAXONOMY_VERSION } from '../../src/taxonomy.mjs';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function summarize(rows) {
  const families = Object.fromEntries([...FAMILIES, 'unknown'].map(family => [family, {
    count: 0, assigned: 0, nulls: 0, has_axis: Object.hasOwn(SUBFAMILIES, family),
    subfamilies: Object.fromEntries((SUBFAMILIES[family] ?? []).map(value => [value, 0])),
  }]));
  const unknownCategories = {}, knownGaps = {};
  for (const row of rows) {
    if (row.subfamily_gap) knownGaps[row.subfamily_gap] = (knownGaps[row.subfamily_gap] ?? 0) + 1;
    const bucket = families[row.family];
    bucket.count++;
    if (row.subfamily === null) bucket.nulls++;
    else { bucket.assigned++; bucket.subfamilies[row.subfamily]++; }
    if (row.family === 'unknown') unknownCategories[row.gc ?? 'sequence'] = (unknownCategories[row.gc ?? 'sequence'] ?? 0) + 1;
  }
  return { total: rows.length, assigned: rows.filter(r => r.subfamily !== null).length,
    nulls: rows.filter(r => r.subfamily === null).length, unknowns: families.unknown.count,
    unknown_categories: unknownCategories, known_enum_gaps: knownGaps, families };
}
export function coverageText(report) {
  const lines = [`Taxonomy: ${report.version}`, `Unicode: 17.0.0; Script escapes: runtime Unicode ${process.versions.unicode}`,
    `Corpus: ${report.characters.total} characters + ${report.sequences.total} emoji sequence rows = ${report.full.total} rows`,
    `Full totals: ${report.full.unknowns} unknown families; ${report.full.assigned} assigned subfamilies; ${report.full.nulls} null subfamilies`,
    `Known enum gaps (withheld before model calls): ${JSON.stringify(report.full.known_enum_gaps)}`,
    `Null includes families without an axis; unknown is a sentinel, not a model-selectable family.`];
  for (const [name, summary] of [['FULL CORPUS', report.full], ['CHARACTERS', report.characters], ['EMOJI SEQUENCE ROWS', report.sequences], ['SCORABLE (excluding Co/Cs)', report.scorable]]) {
    lines.push('', `${name}: ${summary.total}`, 'family                 count   assigned      null');
    for (const [family, row] of Object.entries(summary.families)) lines.push(`${family.padEnd(20)} ${String(row.count).padStart(7)} ${String(row.assigned).padStart(10)} ${String(row.nulls).padStart(9)}${row.has_axis ? '' : '  (no axis)'}`);
    lines.push(`Unknown categories: ${JSON.stringify(summary.unknown_categories)}`);
  }
  lines.push('', 'SUBFAMILIES (full corpus)');
  for (const family of Object.keys(SUBFAMILIES)) {
    const row = report.full.families[family];
    lines.push(`${family}: ${Object.entries(row.subfamilies).map(([k,v]) => `${k}=${v}`).join(', ')}, null=${row.nulls}`);
  }
  return lines.join('\n') + '\n';
}
export function sampleFamilies(rows, seed = 20260905) {
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return Object.fromEntries(['arrow', 'bullet', 'shape', 'emoji'].map(family => {
    // Corpus tables overlap. Sample distinct encoded glyphs, without replacement.
    const members = [...new Map(rows.filter(r => r.family === family).map(r => [r.hex, r])).values()];
    const sample = [];
    while (sample.length < 10 && members.length) {
      const [r] = members.splice(Math.floor(random() * members.length), 1);
      sample.push({ hex: r.hex, glyph: r.char, name: r.name || r.corpusName, subfamily: r.subfamily });
    }
    return [family, sample];
  }));
}
export function samplesText(samples, seed) {
  return `Random family samples (seed ${seed}; distinct encoded glyphs, without replacement)\n` +
    Object.entries(samples).map(([family, rows]) => `\n${family}\n` + rows.map(r => `U+${r.hex}\t${r.glyph}\t${r.name}\t${r.subfamily ?? '(null)'}`).join('\n')).join('\n') + '\n';
}
export function runCoverage({ refDb, outDir = resolve(ROOT, 'out/taxonomy') } = {}) {
  const corpus = loadCharacters(refDb);
  const assign = row => ({ ...row, ...resolveTaxonomy(row.char) });
  const characters = corpus.characters.map(assign), sequences = corpus.sequences.map(assign);
  const all = [...characters, ...sequences];
  const report = { version: TAXONOMY_VERSION, full: summarize(all), characters: summarize(characters), sequences: summarize(sequences),
    scorable: summarize(all.filter(row => !['Co', 'Cs'].includes(row.gc))) };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'colors_collection.json'), JSON.stringify(buildColorsCollection(), null, 2) + '\n');
  writeFileSync(resolve(outDir, 'coverage.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'coverage.txt'), coverageText(report));
  const dumpDir = resolve(ROOT, '.ucd/families');
  mkdirSync(dumpDir, { recursive: true });
  for (const family of [...FAMILIES, 'unknown']) {
    writeFileSync(resolve(dumpDir, `${family}.txt`), all.filter(row => row.family === family)
      .map(row => `U+${row.hex}\t${row.gc ?? 'sequence'}\t${row.block ?? '-'}\t${row.family_basis ?? '-'}\t${row.subfamily ?? '-'}\t${row.name || row.corpusName || '(unnamed)'}`).join('\n') + '\n');
  }
  return { report, rows: all };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const { report, rows } = runCoverage({ refDb: option('--ref-db'), outDir: option('--out') });
  console.log(coverageText(report));
  const seed = Number(option('--seed') ?? 20260905) >>> 0;
  const samples = sampleFamilies(rows, seed);
  const sampleText = samplesText(samples, seed);
  const outDir = option('--out') ?? resolve(ROOT, 'out/taxonomy');
  writeFileSync(resolve(outDir, 'family-samples.txt'), sampleText);
  writeFileSync(resolve(outDir, 'family-samples.json'), JSON.stringify(samples, null, 2) + '\n');
  if (args.includes('--sample-families')) console.log(sampleText);
  if (args.includes('--write-doc')) writeFileSync(resolve(ROOT, 'families.txt'),
    readFileSync(resolve(ROOT, 'docs/taxonomy-policy.txt'), 'utf8') + '\n' + coverageText(report) + '\n' + sampleText);
  if (args.includes('--nulls')) {
    const family = option('--nulls');
    if (![...FAMILIES, 'unknown'].includes(family)) throw new Error(`Invalid --nulls family: ${family}`);
    const nulls = rows.filter(r => r.family === family && r.subfamily === null);
    console.log(`${family}: ${nulls.length} nulls; first 40:`);
    for (const r of nulls.slice(0, 40)) console.log(`U+${r.hex}\t${r.name || r.corpusName}`);
  }
  if (args.includes('--spot')) {
    let seed = Number(option('--seed') ?? 20260905) >>> 0;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (const [family, values] of Object.entries(SUBFAMILIES)) for (const value of values) {
      const members = rows.filter(r => r.family === family && r.subfamily === value);
      console.log(`\n${family}/${value}:`);
      for (let n = 0; n < 10 && members.length; n++) {
        const [r] = members.splice(Math.floor(random() * members.length), 1);
        console.log(`U+${r.hex}\t${r.name || r.corpusName}`);
      }
    }
  }
}
