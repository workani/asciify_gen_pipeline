#!/usr/bin/env node
import { resolve } from "node:path";
import { config, STAGE_VERSIONS } from "../src/config.mjs";
import { AUTOPILOT_STAGES, runAutopilotWave } from "../src/autopilot.mjs";
import { estimateCapacity } from "../src/capacity.mjs";
import { planCorpus, readReferenceCorpus } from "../src/corpus.mjs";
import { emitArtifacts } from "../src/emit.mjs";
import { emitRecordArtifacts } from "../src/emit-records.mjs";
import { HUNDRED_COHORT_CPS } from "../src/fixed-cohorts.mjs";
import { selectRecordCohort } from "../src/record-cohort.mjs";
import { buildRecordReport, isCompleted, recordResults, writeRecordReport } from "../src/record-report.mjs";
import { createRecordConsole } from "../src/record-console.mjs";
import { runRecords } from "../src/stages/records.mjs";
import { emit, onEvent } from "../src/log.mjs";
import { pool } from "../src/pool.mjs";
import { factoryStats, freezeEvaluationHoldout, releaseOwnedCheckpoints, replaceSelection, selectedEntities } from "../src/state.mjs";
import { runAdjudicate } from "../src/stages/adjudicate.mjs";
import { runEnrich } from "../src/stages/enrich.mjs";
import { runContrast } from "../src/stages/contrast.mjs";
import { runBlindGround } from "../src/stages/ground.mjs";
import { runRecover } from "../src/stages/recover.mjs";
import { runRoundtrip, runSynth } from "../src/stages/synth.mjs";
import { runReverify, runVerify } from "../src/stages/verify.mjs";
import { runRewrite } from "../src/stages/rewrite.mjs";
import { buildTui } from "../src/tui.mjs";

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      options[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index++;
    } else options[key] = true;
  }
  return options;
}

function positiveInteger(value, fallback, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function help() {
  console.log(`Asciify dataset factory

Usage:
  generator plan [--target=25000] [--failures=failures.jsonl]
  generator run --stage=records|all [--limit=100] [--wave-size=100] [--threads=1..4]
  generator run --stage=ground|enrich|contrast|verify|rewrite|reverify|recover|synth|roundtrip|adjudicate  (legacy research stages)
  generator status [--json]
  generator capacity [--chars=10000] [--sample-calls=68] [--sample-minutes=10] [--sample-tokens=200000]
  generator emit [--allow-partial] [--legacy]
  generator tui [--limit=100] [--wave-size=100] [--autopilot]

--100 (run or tui): restrict selection to the fixed smoke-test cohort also
  used by \`test.sh --100\` (src/fixed-cohorts.mjs), instead of the normal
  planned corpus. Uses the main checkpoint database, so progress is resumable
  across runs exactly like any other run/tui invocation.

Compatibility:
  generator --headless --stage=g --limit=100 --verbose

Environment:
  GEN_MODEL, OPENCODE_BIN, GEN_ASCIIFY_ROOT, GEN_REF_DB, GEN_DB, GEN_THREADS,
  GEN_TARGET_ENTITIES, GEN_FAILURES, GEN_AUTOPILOT_WAVE_ENTITIES, CHROME_BIN,
  GEN_CHROME_NO_SANDBOX`);
}

const stageAliases = {
  b: "records", records: "records",
  g: "blind_ground", ground: "blind_ground", blind: "blind_ground", blind_ground: "blind_ground",
  n: "enrich", enrich: "enrich",
  c: "contrast", contrast: "contrast",
  v: "verify", verify: "verify",
  w: "rewrite", rewrite: "rewrite",
  z: "reverify", reverify: "reverify",
  d: "recover", recover: "recover", discriminate: "recover",
  s: "synth", synth: "synth",
  r: "roundtrip", roundtrip: "roundtrip",
  a: "adjudicate", adjudicate: "adjudicate",
  x: "all", all: "all",
};

async function runAutopilot(_limit, waveEntities = config.autopilotWaveEntities) {
  let cycle = 0;
  let completedTotal = 0;
  emit("autopilot", {
    running: true,
    cycle,
    completedTotal,
    waveEntities,
    stages: AUTOPILOT_STAGES,
    policy: "breadth_first",
  });
  try {
    while (true) {
      cycle++;
      const stages = await runAutopilotWave({
        runStage,
        waveEntities,
        onPhase: ({ stage, completed }) => emit("autopilot_phase", {
          cycle,
          phase: stage,
          waveEntities,
          completed,
        }),
      });
      const completedThisCycle = Object.values(stages).reduce((sum, completed) => sum + completed, 0);
      completedTotal += completedThisCycle;
      emit("autopilot", {
        running: true, cycle, completedThisCycle, completedTotal, stages,
        waveEntitiesRequested: waveEntities,
        policy: "breadth_first",
      });
      if (completedThisCycle === 0) break;
    }
    return completedTotal;
  } finally {
    emit("autopilot", {
      running: false,
      cycle,
      completedTotal,
      stages: AUTOPILOT_STAGES,
      policy: "breadth_first",
    });
  }
}

async function runStage(stage, limit) {
  const normalized = stageAliases[String(stage)] ?? null;
  if (!normalized) throw new Error(`Unknown stage: ${stage}`);
  if (normalized === "all") return runAutopilot(limit, waveSize);
  emit("stage", { stage: normalized, running: true });
  try {
    if (normalized === "records") return await runRecords(limit);
    if (normalized === "blind_ground") return await runBlindGround(limit);
    if (normalized === "enrich") return await runEnrich(limit);
    if (normalized === "contrast") return await runContrast(limit);
    if (normalized === "verify") return await runVerify(limit);
    if (normalized === "rewrite") return await runRewrite(limit);
    if (normalized === "reverify") return await runReverify(limit);
    if (normalized === "recover") return await runRecover(limit);
    if (normalized === "synth") return await runSynth(limit);
    if (normalized === "roundtrip") return await runRoundtrip(limit);
    if (normalized === "adjudicate") return await runAdjudicate(limit);
  } finally {
    const released = releaseOwnedCheckpoints({
      stage: normalized === "all" ? null : normalized,
      reason: `${normalized} stage returned with unfinished owned checkpoints`,
    });
    if (released) emit("checkpoint_recovery", { stage: normalized, released });
    emit("stage", { stage: normalized, running: false });
  }
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? (args.headless ? "run" : "tui");
if (args.help || args.h || command === "help") {
  help();
  process.exit(0);
}
const limit = positiveInteger(args.limit, 100, "--limit");
// --batches is accepted as a temporary compatibility alias, but its value is
// now an entity count. The explicit name prevents another 100×6 ambiguity.
const waveSize = positiveInteger(args["wave-size"] ?? args.batches, config.autopilotWaveEntities, "--wave-size");
const threads = positiveInteger(args.threads, config.threads, "--threads");
if (threads > config.maxThreads) throw new Error(`--threads cannot exceed ${config.maxThreads}`);
pool.setThreads(threads);

const cohortConsole = command === "run" && args["100"]
  && ["records", "all"].includes(stageAliases[String(args.stage ?? args._[1] ?? "records")]);
if (args.verbose && command !== "tui" && !cohortConsole) {
  onEvent(({ type, data }) => {
    if (type === "worker_text") process.stdout.write(data.delta);
    else if (!["tokens", "queue"].includes(type)) console.error(`[${type}] ${JSON.stringify(data).slice(0, 1000)}`);
  });
}

// Same fixed charset as `test.sh --100`, but selected against the main
// checkpoint database instead of an isolated one, so records already
// completed for these entities are skipped on the next invocation.
function selectHundredCohort() {
  const cohort = selectRecordCohort(readReferenceCorpus(), { cps: HUNDRED_COHORT_CPS });
  replaceSelection(cohort.entities, STAGE_VERSIONS.select);
  return cohort;
}

let hundredCohort = null;
const HUNDRED_REPORT = resolve(config.outDir, "run100.json");

// Same JSON as the test.sh report, but only for characters that already have a
// result: the file grows toward the full cohort across runs instead of being
// rewritten from scratch, because the checkpoints it reads survive restarts.
function saveHundredReport() {
  if (!hundredCohort) return;
  const entities = selectedEntities();
  const results = recordResults(entities).filter((row) => row.status !== "not_started");
  const status = results.filter(isCompleted).length === entities.length ? "complete" : "running";
  return writeRecordReport([HUNDRED_REPORT], buildRecordReport({ entities, cohort: hundredCohort, status, results,
    runDirectory: config.runsDir }));
}

function ensureSelection() {
  if (args["100"]) {
    hundredCohort = selectHundredCohort();
    onEvent(({ type, data }) => {
      if (type === "stage_progress" && data.stage === "records") saveHundredReport();
    });
    saveHundredReport();
    return;
  }
  if (factoryStats().selection.total === 0) planCorpus();
  else freezeEvaluationHoldout();
}

if (command === "plan") {
  const target = positiveInteger(args.target, config.targetEntities, "--target");
  const result = planCorpus({ target, failureFile: args.failures ?? config.failureFile, persist: true });
  console.log(JSON.stringify({ selected: result.selected.length, candidates: result.candidates, stats: result.stats }, null, 2));
} else if (command === "status") {
  const status = factoryStats();
  console.log(args.json ? JSON.stringify(status) : JSON.stringify(status, null, 2));
} else if (command === "capacity") {
  const estimate = estimateCapacity({
    entities: positiveInteger(args.chars, 10_000, "--chars"),
    observedCalls: positiveInteger(args["sample-calls"], 68, "--sample-calls"),
    observedMinutes: positiveInteger(args["sample-minutes"], 10, "--sample-minutes"),
    observedTokens: positiveInteger(args["sample-tokens"], 200_000, "--sample-tokens"),
  });
  console.log(JSON.stringify(estimate, null, 2));
} else if (command === "emit") {
  const directory = args.legacy ? emitArtifacts({ allowPartial: Boolean(args["allow-partial"]) })
    : await emitRecordArtifacts({ allowPartial: Boolean(args["allow-partial"]) });
  console.log(directory);
} else if (command === "run") {
  ensureSelection();
  const stage = args.stage ?? args._[1] ?? "records";
  const terminal = cohortConsole ? createRecordConsole({ total: hundredCohort.entities.length,
    initialResults: recordResults(hundredCohort.entities) }) : null;
  terminal?.start({ directory: config.runsDir, reportPath: HUNDRED_REPORT,
    model: config.model, version: STAGE_VERSIONS.records });
  const stopProgress = terminal ? onEvent(({ type, data }) => {
    if (type === "stage_progress" && data.stage === "records" && data.entity) {
      terminal.result(recordResults([data.entity])[0]);
    }
  }) : null;
  try {
    const completed = await runStage(stage, limit);
    const summary = saveHundredReport();
    if (terminal) terminal.finish(summary, HUNDRED_REPORT);
    else console.log(`\n${stageAliases[String(stage)] ?? stage}: ${completed} work item(s) completed`);
  } finally {
    stopProgress?.();
  }
} else if (command === "tui") {
  ensureSelection();
  let running = false;
  const guarded = async (label, fn) => {
    if (running) {
      emit("stage_warning", { stage: label, error: "another stage is already running" });
      return;
    }
    running = true;
    try { await fn(); }
    catch (error) { emit("stage_error", { stage: label, error: error.stack ?? error.message }); }
    finally { running = false; saveHundredReport(); }
  };
  const startAutopilot = () => guarded("autopilot", () => runAutopilot(limit, waveSize));
  buildTui({
    onThreads: (value) => pool.setThreads(value),
    onPause: (value) => pool.setPaused(value),
    onStage: (stage) => guarded(stage, () => runStage(stage, limit)),
    onAutopilot: startAutopilot,
    onPlan: () => guarded("plan", async () => {
      if (args["100"]) selectHundredCohort();
      else planCorpus({ target: config.targetEntities });
    }),
    onEmit: () => guarded("emit", async () => { await emitRecordArtifacts({ allowPartial: true }); }),
    onQuit: () => emit("stage", { stage: "tui", running: false }),
  });
  if (args.autopilot) startAutopilot();
} else {
  help();
  throw new Error(`Unknown command: ${command}`);
}
