import { TAXONOMY_VERSION, SUBFAMILIES } from './taxonomy.mjs';
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { RECORD_DRAFT_SYSTEM, RECORD_REVIEW_SYSTEM, RECORD_DISCOVERY_SYSTEM, RECORD_VOCABULARY_SYSTEM } from "./prompts-records.mjs";
import { PROPERTY_KEYS, FAMILIES, RECORD_SCHEMA_VERSION } from "./records.mjs";
import { INTENTS, REGISTERS, VOCABULARY_CONTRACT_VERSION } from "./record-vocabulary.mjs";
import { resolveChromeBin, resolveOpencodeBin } from "./binaries.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASCIIFY = resolve(process.env.GEN_ASCIIFY_ROOT ?? resolve(ROOT, "..", "asciify"));

function intEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function existingOrNull(paths) {
  return paths.find((path) => path && existsSync(path)) ?? null;
}

export const PIPELINE_VERSION = "2026-09-05.factory-v8-embedding-records";
const LEGACY_VERSION = "2026-08-22.factory-v7-adaptive-two-call";
const MODEL = process.env.GEN_MODEL ?? "opencode/muse-spark-1.3-contributor-free";
const RECORD_REVISION = createHash("sha256").update(JSON.stringify({
  schema: RECORD_SCHEMA_VERSION, taxonomy: TAXONOMY_VERSION, subfamilies: SUBFAMILIES, writer: RECORD_DRAFT_SYSTEM, reviewer: RECORD_REVIEW_SYSTEM, discovery: RECORD_DISCOVERY_SYSTEM, vocabularyReviewer: RECORD_VOCABULARY_SYSTEM,
  vocabularyContract: VOCABULARY_CONTRACT_VERSION, intents: INTENTS, registers: REGISTERS, families: FAMILIES,
  properties: PROPERTY_KEYS, model: MODEL, variant: process.env.GEN_MODEL_VARIANT ?? "medium",
})).digest("hex").slice(0, 16);

export const STAGE_VERSIONS = Object.freeze({
  select: `${PIPELINE_VERSION}.select-v2-family-priority`,
  records: `${PIPELINE_VERSION}.records-${RECORD_REVISION}`,
  // One dual-vendor contrastive generation call plus one name/image-blind
  // recovery call. Never mix the former six-vote evidence into this contract.
  blind_ground: `${LEGACY_VERSION}.blind-ground-v5-adaptive-two-call`,
  enrich: `${LEGACY_VERSION}.enrich-v6-fresh-context`,
  contrast: `${LEGACY_VERSION}.contrast-v1-top5`,
  verify: `${LEGACY_VERSION}.verify-v5-fresh-context`,
  rewrite: `${LEGACY_VERSION}.rewrite-v3-gap-only`,
  reverify: `${LEGACY_VERSION}.reverify-v4-fresh-context`,
  recover: `${LEGACY_VERSION}.recover-v1-name-image-blind`,
  synth: `${LEGACY_VERSION}.synth-v5-per-claim`,
  adjudicate: `${LEGACY_VERSION}.adjudicate-v2-batched`,
  roundtrip: `${LEGACY_VERSION}.roundtrip-v1`,
  publish: `${LEGACY_VERSION}.publish-v1`,
});

export const config = {
  root: ROOT,
  asciifyRoot: ASCIIFY,
  refDb: resolve(process.env.GEN_REF_DB ?? resolve(ASCIIFY, "gen", "out", "ref.db")),
  model: MODEL,
  modelVariant: process.env.GEN_MODEL_VARIANT ?? "medium",
  llmAgent: process.env.GEN_LLM_AGENT ?? "factory-json",
  // null when nothing is installed; the spawn sites turn that into one
  // actionable error instead of a bare ENOENT on a guessed path.
  opencodeBin: resolveOpencodeBin(),
  threads: intEnv("GEN_THREADS", 2, { min: 1, max: 4 }),
  maxThreads: 4,
  targetEntities: intEnv("GEN_TARGET_ENTITIES", 1_114_112, { min: 1, max: 1_114_112 }),
  explorationShare: 0.1,
  runsDir: resolve(process.env.GEN_RUNS_DIR ?? resolve(ROOT, "runs")),
  renderDir: resolve(process.env.GEN_RENDER_DIR ?? resolve(process.env.GEN_RUNS_DIR ?? resolve(ROOT, "runs"), "render")),
  outDir: resolve(process.env.GEN_OUT_DIR ?? resolve(ROOT, "out")),
  dbPath: resolve(process.env.GEN_DB ?? resolve(ROOT, "state.sqlite")),
  failureFile: process.env.GEN_FAILURES ? resolve(process.env.GEN_FAILURES) : null,
  notoColorEmojiFont: existingOrNull([
    process.env.GEN_NOTO_COLOR_EMOJI_FONT ? resolve(process.env.GEN_NOTO_COLOR_EMOJI_FONT) : null,
    resolve(ROOT, "assets", "Noto-COLRv1.ttf"),
    resolve(ASCIIFY, "gen", "fonts", "Noto-COLRv1.ttf"),
    resolve(ASCIIFY, "public", "fonts", "unicode", "Noto-COLRv1.ttf"),
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
  ]),
  chromeBin: resolveChromeBin(),
  // Retained only for compatibility render utilities and adjudication UI.
  // Alias-generation stages always render exactly one glyph per image.
  gridCols: 3,
  gridRows: 2,
  // The clean blind-ground path is two calls. Either phase may make one bounded
  // repair call after a malformed response; semantic rejection is never retried.
  blindCallsPerEntity: 2,
  blindClearQuorum: 1,
  renderVendors: ["noto", "platform"],
  contractRetries: 2,
  // Live smoke tests set this to zero so malformed output cannot spend extra
  // model calls. Production generation keeps one bounded structural repair.
  recordContractRepairs: intEnv("GEN_RECORD_CONTRACT_REPAIRS", 1, { min: 0, max: 1 }),
  // Enrichment proposes; the separate unanimous verifier decides. Multiple
  // long proposal votes waste scarce API capacity without adding a gate.
  enrichVotes: 1,
  contrastVotes: 2,
  // Two independent votes with deterministic unanimity: any contradiction
  // becomes contested. Each entity receives a fresh context.
  verifyVotes: 2,
  // Retained for adjudication-era compatibility; verification no longer batches.
  verifyBatch: 4,
  rewriteVotes: 2,
  synthVotes: 2,
  adjudicateVotes: 2,
  adjudicateBatch: 4,
  synthBatch: 6,
  contrastNeighbors: 5,
  recoverVotes: 1,
  evalHoldoutSize: intEnv("GEN_EVAL_HOLDOUT_SIZE", 500, { min: 1, max: 5_000 }),
  autopilotWaveEntities: intEnv("GEN_AUTOPILOT_WAVE_ENTITIES", 100, { min: 1, max: 10_000 }),
  maxAttempts: intEnv("GEN_MAX_STAGE_ATTEMPTS", 2, { min: 1, max: 20 }),
  // Provider/transport outages are not model-quality attempts. Keep a
  // separate bounded budget so a burst of 503s cannot poison an entity.
  maxOperationalAttempts: intEnv("GEN_MAX_OPERATIONAL_ATTEMPTS", 6, { min: 1, max: 50 }),
  // OpenCode can internally retry an unavailable provider without emitting an
  // NDJSON event. Recycle that silent slot well before the full request bound.
  llmStartTimeoutMs: intEnv("GEN_LLM_START_TIMEOUT_MS", 90 * 1000, { min: 1_000, max: 10 * 60 * 1000 }),
  requestTimeoutMs: intEnv("GEN_REQUEST_TIMEOUT_MS", 10 * 60 * 1000),
  maxResponseBytes: intEnv("GEN_MAX_RESPONSE_BYTES", 4 * 1024 * 1024, { min: 64 * 1024, max: 64 * 1024 * 1024 }),
  renderCaptureTimeoutMs: intEnv("GEN_RENDER_CAPTURE_TIMEOUT_MS", 10_000, { min: 3_000, max: 60_000 }),
  renderAttempts: intEnv("GEN_RENDER_ATTEMPTS", 2, { min: 1, max: 3 }),
  renderConcurrency: intEnv("GEN_RENDER_CONCURRENCY", 3, { min: 1, max: 4 }),
  renderMinInkPixels: intEnv("GEN_RENDER_MIN_INK_PIXELS", 18, { min: 1, max: 10_000 }),
  roundTripTopN: 10,
  roundTripPassRank: 5,
  minimumVerifiedAliases: 3,
  source: `ai:approved:generator:${PIPELINE_VERSION}`,
};
