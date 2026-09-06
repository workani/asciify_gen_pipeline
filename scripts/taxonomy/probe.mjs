// Ad-hoc probe: grep a family dump for a pattern.
// usage: node scripts/taxonomy/probe.mjs <family> <regex> [limit]
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [family, pattern, limitRaw] = process.argv.slice(2);
const limit = Number(limitRaw) || 20;
const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".ucd", "families", `${family}.txt`);
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
const re = new RegExp(pattern, "i");
const hits = rows.filter((r) => re.test(r.at(-1)));
console.log(`${hits.length}/${rows.length} match /${pattern}/`);
for (const r of hits.slice(0, limit)) console.log(` ${r[0]}  ${r[1]}  ${r.at(-1)}`);
