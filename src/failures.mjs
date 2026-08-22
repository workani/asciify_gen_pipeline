import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { THIEF_PAIRS, P0_TARGETS, SEQUENCE_TARGETS } from "./seeds.mjs";

function hexTarget(hex) {
  const raw = String(hex).toLowerCase();
  return raw.includes("-")
    ? { target_kind: "emoji_sequence", target_key: raw }
    : { target_kind: "character", target_key: String(parseInt(raw, 16)) };
}

export function builtInFailures() {
  const records = THIEF_PAIRS.map((pair) => {
    const target = hexTarget(pair.victim);
    const thief = hexTarget(pair.thief);
    return {
      query: pair.query,
      ...target,
      candidate_keys: [thief.target_key],
      candidate_entity_ids: [`${thief.target_kind}:${thief.target_key}`],
      count: 10,
      severity: 5,
      source: "failure-report:thief-pairs",
    };
  });
  for (const [hex] of P0_TARGETS) {
    records.push({
      ...hexTarget(hex), count: 3, severity: 3, source: "failure-report:p0-targets",
    });
  }
  for (const [hex] of SEQUENCE_TARGETS) {
    records.push({
      ...hexTarget(hex), count: 3, severity: 3, source: "failure-report:p0-targets",
    });
  }
  return records;
}

function normalizeRecord(record, source) {
  if (!record || typeof record !== "object") return null;
  let targetKind = record.target_kind;
  let targetKey = record.target_key;
  if (!targetKey && record.victim) {
    const target = hexTarget(record.victim);
    targetKind = target.target_kind;
    targetKey = target.target_key;
  }
  if (!targetKey) return null;
  if (!targetKind) targetKind = String(targetKey).includes("-") ? "emoji_sequence" : "character";
  const thiefKeys = record.thief_keys ?? (record.thief ? [hexTarget(record.thief).target_key] : []);
  return {
    query: String(record.query ?? "").trim(),
    target_kind: targetKind,
    target_key: String(targetKey),
    thief_keys: Array.isArray(thiefKeys) ? thiefKeys.map(String) : [],
    candidate_keys: Array.isArray(record.candidate_keys) ? record.candidate_keys.map(String) : [],
    count: Math.max(1, Number(record.count ?? record.events ?? 1)),
    severity: Math.max(1, Math.min(5, Number(record.severity ?? 3))),
    source: record.source ?? source,
    metadata: record.metadata ?? null,
  };
}

function parseJsonLines(text, source) {
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const record = normalizeRecord(JSON.parse(line), source);
      if (record) rows.push(record);
    } catch (error) {
      throw new Error(`Invalid failure JSONL at line ${index + 1}: ${error.message}`);
    }
  }
  return rows;
}

export function loadFailures(file = null, { includeBuiltIn = true } = {}) {
  const rows = includeBuiltIn ? builtInFailures() : [];
  if (!file) return rows;
  if (!existsSync(file)) throw new Error(`Failure input not found: ${file}`);
  const text = readFileSync(file, "utf8");
  const extension = extname(file).toLowerCase();
  if (extension === ".jsonl" || extension === ".ndjson") {
    rows.push(...parseJsonLines(text, file));
  } else {
    const parsed = JSON.parse(text);
    const records = Array.isArray(parsed) ? parsed : parsed.failures ?? [];
    for (const raw of records) {
      const record = normalizeRecord(raw, file);
      if (record) rows.push(record);
    }
  }
  return rows;
}
