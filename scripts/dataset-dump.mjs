import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

function parseArgs(argv) {
  const args = { db: "state.sqlite", outDir: "out", help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--db=")) args.db = arg.slice("--db=".length);
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice("--out-dir=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/dataset-dump.mjs [options]

Options:
  --db=PATH          SQLite database path (default: state.sqlite)
  --out-dir=PATH     Output directory (default: out)
  -h, --help         Show this help`);
  process.exit(0);
}

const dbPath = resolve(args.db);
const outDir = resolve(args.outDir);
const db = new DatabaseSync(dbPath, { readOnly: true });
mkdirSync(outDir, { recursive: true });

const all = (sql, params = []) => db.prepare(sql).all(...params);
const one = (sql, params = []) => db.prepare(sql).get(...params);
const summary = {
  generated_at: new Date().toISOString(),
  source: "state.sqlite",
  entities_active: one("SELECT COUNT(*) AS n FROM entity_selection WHERE active=1").n,
  characters_active: one("SELECT COUNT(*) AS n FROM entity_selection WHERE active=1 AND target_kind='character'").n,
  emoji_sequences_active: one("SELECT COUNT(*) AS n FROM entity_selection WHERE active=1 AND target_kind='emoji_sequence'").n,
  claims_v2: one("SELECT COUNT(*) AS n FROM claims_v2").n,
  generated_queries_v2: one("SELECT COUNT(*) AS n FROM generated_queries_v2").n,
  confusion_edges: one("SELECT COUNT(*) AS n FROM confusion_edges").n,
};

const checkpoints = all("SELECT stage,status,COUNT(*) AS n FROM checkpoints GROUP BY stage,status ORDER BY stage,status");
const claimBreakdown = all("SELECT family,status,COUNT(*) AS n FROM claims_v2 GROUP BY family,status ORDER BY family,status");
const entities = all(`
  SELECT e.entity_id,e.target_kind,e.target_key,e.code_point,e.hex,e.name,e.character,
         e.category_key,e.selection_rank,e.selection_tier,e.selection_score,
         e.popularity,COUNT(c.id) AS claim_count
  FROM entity_selection e
  LEFT JOIN claims_v2 c ON c.entity_id=e.entity_id
  WHERE e.active=1
  GROUP BY e.entity_id
  HAVING claim_count > 0
  ORDER BY e.selection_rank
`);
const claims = all(`
  SELECT c.id,c.entity_id,c.family,c.phrase,c.normalized_phrase,c.confidence,c.status,
         c.source_stage,c.prompt_version,c.evidence_json,c.verifier_json,c.created_at,c.updated_at
  FROM claims_v2 c
  ORDER BY c.entity_id,c.family,c.id
`);
const claimByEntity = new Map();
for (const claim of claims) {
  if (!claimByEntity.has(claim.entity_id)) claimByEntity.set(claim.entity_id, []);
  claimByEntity.get(claim.entity_id).push({
    id: claim.id,
    family: claim.family,
    phrase: claim.phrase,
    normalized_phrase: claim.normalized_phrase,
    confidence: claim.confidence,
    status: claim.status,
    source_stage: claim.source_stage,
    prompt_version: claim.prompt_version,
    evidence: JSON.parse(claim.evidence_json || "{}"),
    verifier: claim.verifier_json ? JSON.parse(claim.verifier_json) : null,
  });
}
const records = entities.map((entity) => ({
  ...entity,
  claims: claimByEntity.get(entity.entity_id) ?? [],
}));

const quarantine = all(`
  SELECT c.entity_id,e.character,e.name,c.stage,c.version,c.status,c.attempts,c.run_ids_json,c.quality_json,c.error
  FROM checkpoints c JOIN entity_selection e ON e.entity_id=c.entity_id
  WHERE c.status='quarantined' ORDER BY e.selection_rank
`);
const auditEntity = one(`
  SELECT e.entity_id,e.character,e.name,c.status,c.run_ids_json,c.quality_json
  FROM entity_selection e JOIN checkpoints c ON c.entity_id=e.entity_id
  WHERE e.entity_id='character:129494' AND c.stage='blind_ground'
`);

const jsonl = [
  JSON.stringify({ type: "header", summary, checkpoints, claim_breakdown: claimBreakdown }),
  ...records.map((record) => JSON.stringify({ type: "entity", ...record })),
  ...quarantine.map((row) => JSON.stringify({ type: "quarantine", ...row })),
].join("\n") + "\n";
const jsonlPath = resolve(outDir, "dataset-dump.jsonl");
const markdownPath = resolve(outDir, "dataset-dump.md");
writeFileSync(jsonlPath, jsonl);

const top = [...records].sort((a, b) => b.claim_count - a.claim_count).slice(0, 12);
const md = [];
md.push("# Dataset dump");
md.push("");
md.push(`Generated ${summary.generated_at} from ${dbPath}. This is a snapshot of the current pipeline state, not a claim that every proposed record is verified.`);
md.push("");
md.push("## Snapshot");
md.push("");
md.push("| Metric | Count |");
md.push("|---|---:|");
for (const [key, value] of Object.entries(summary).filter(([key]) => key !== "generated_at" && key !== "source")) md.push(`| ${key.replaceAll("_", " ")} | ${value.toLocaleString()} |`);
md.push("");
md.push("## Checkpoint status");
md.push("");
md.push("| Stage | Status | Count |");
md.push("|---|---|---:|");
for (const row of checkpoints) md.push(`| ${row.stage} | ${row.status} | ${row.n.toLocaleString()} |`);
md.push("");
md.push("## Persisted claims by family/status");
md.push("");
md.push("| Family | Status | Count |");
md.push("|---|---|---:|");
for (const row of claimBreakdown) md.push(`| ${row.family} | ${row.status} | ${row.n.toLocaleString()} |`);
md.push("");
md.push("## Largest entity claim sets");
md.push("");
md.push("| Rank | Glyph | Name | Claims |");
md.push("|---:|---|---|---:|");
for (const row of top) md.push(`| ${row.selection_rank} | ${row.character || "□"} | ${row.name.replaceAll("|", "\\|")} | ${row.claim_count} |`);
md.push("");
md.push("## Example records");
md.push("");
for (const row of records.slice(0, 8)) {
  md.push(`### ${row.character || "□"} — ${row.name} (selection rank ${row.selection_rank})`);
  for (const claim of row.claims.slice(0, 5)) md.push(`- **${claim.family}** (${claim.confidence.toFixed(2)}, ${claim.status}): ${claim.phrase}`);
  md.push("");
}
md.push("## Quarantine and contamination audit");
md.push("");
md.push(`Quarantined checkpoints: **${quarantine.length}**. The full quarantine list is included as \`type=quarantine\` records in [dataset-dump.jsonl](./dataset-dump.jsonl).`);
if (auditEntity) md.push(`For ${auditEntity.character} (${auditEntity.name}), checkpoint status is **${auditEntity.status}** with runs ${auditEntity.run_ids_json}; quality: ${auditEntity.quality_json}. No active claims were persisted for this entity.`);
md.push("");
md.push("## Full machine-readable dump");
md.push("");
md.push("See [dataset-dump.jsonl](./dataset-dump.jsonl): one header record, one record per entity with persisted claims, and one record per quarantined checkpoint.");
md.push("");
writeFileSync(markdownPath, md.join("\n"));

console.log(JSON.stringify({ markdown: markdownPath, jsonl: jsonlPath, entities: records.length, claims: claims.length, quarantined: quarantine.length }, null, 2));
