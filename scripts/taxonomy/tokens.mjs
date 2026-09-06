// Step 2: tokenize the character names in one family and count frequency, so subfamily
// rules are written from the vocabulary that actually exists rather than from memory.
// usage: node scripts/taxonomy/tokens.mjs <family> [minCount] [--ngrams]
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [family, minRaw, ...flags] = process.argv.slice(2);
const min = Number(minRaw) || 3;
const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".ucd", "families", `${family}.txt`);
const names = readFileSync(file, "utf8").split("\n").filter(Boolean)
  .map((line) => line.split("\t").at(-1)).filter(Boolean);

const unigrams = new Map();
const ngrams = new Map();
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

for (const name of names) {
  const words = name.toUpperCase().split(/[ ]+/);
  for (const word of new Set(words)) bump(unigrams, word);
  // hyphenated compounds carry direction/shape info: RIGHT-POINTING, UP-POINTING
  for (const word of new Set(words.filter((w) => w.includes("-")))) bump(unigrams, `«${word}»`);
  if (flags.includes("--ngrams")) {
    for (let n = 2; n <= 3; n++) {
      const seen = new Set();
      for (let i = 0; i + n <= words.length; i++) seen.add(words.slice(i, i + n).join(" "));
      for (const gram of seen) bump(ngrams, gram);
    }
  }
}

const show = (map, label) => {
  const rows = [...map].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]);
  console.log(`\n== ${label} (${names.length} names, >=${min}) ==`);
  console.log(rows.map(([token, n]) => `${String(n).padStart(5)}  ${token}`).join("\n"));
};

show(unigrams, `${family} tokens`);
if (flags.includes("--ngrams")) show(ngrams, `${family} n-grams`);
