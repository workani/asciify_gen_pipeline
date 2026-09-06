import blessed from "blessed";
import { config } from "./config.mjs";
import { onEvent } from "./log.mjs";
import { pool } from "./pool.mjs";
import { factoryStats } from "./state.mjs";
import {
  PIPELINE_STAGES,
  WorkerRegistry,
  compactScope,
  formatCount,
  formatDuration,
  progressBar,
  stageProgress,
} from "./tui-model.mjs";

const C = Object.freeze({
  ink: "white",
  muted: "gray",
  faint: "gray",
  base: "black",
  surface: "black",
  raised: "black",
  cyan: "cyan",
  green: "green",
  amber: "yellow",
  red: "red",
  blue: "blue",
});

function escapeTags(value) {
  return String(value ?? "").replace(/\{/g, "(").replace(/\}/g, ")");
}

function oneLine(value, max = 90) {
  const line = String(value ?? "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function sum(object) {
  return Object.values(object ?? {}).reduce((total, value) => total + Number(value || 0), 0);
}

function poolView(value) {
  return {
    ...value,
    active: Array.isArray(value?.active) ? value.active.length : Number(value?.active ?? 0),
    queued: Array.isArray(value?.queue) ? value.queue.length : Number(value?.queued ?? 0),
    threads: Number(value?.threads ?? config.threads),
    paused: Boolean(value?.paused),
  };
}

function frame(options = {}) {
  return blessed.box({
    tags: true,
    style: { bg: C.surface, fg: C.ink, border: { fg: C.faint } },
    border: { type: "line" },
    ...options,
  });
}

export function buildTui({ onThreads, onRun, onStage, onAutopilot, onPause, onEmit, onQuit }) {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: "Dataset Factory · Oracle Control Room",
    dockBorders: true,
    mouse: true,
    sendFocus: true,
    style: { bg: C.base, fg: C.ink },
  });
  screen.program.hideCursor();

  const header = blessed.box({
    top: 0,
    left: 0,
    height: 5,
    width: "100%",
    tags: true,
    padding: { left: 2, right: 2 },
    style: { bg: C.raised, fg: C.ink },
  });
  const pipeline = frame({
    top: 5,
    left: 0,
    bottom: 3,
    label: " PIPELINE · FAILURE FIRST ",
  });
  const live = blessed.log({
    top: 5,
    bottom: 9,
    tags: false,
    keys: true,
    vi: true,
    mouse: true,
    alwaysScroll: true,
    scrollable: true,
    scrollbar: { ch: "▐", track: { bg: C.surface }, style: { fg: C.cyan } },
    padding: { left: 2, right: 2, top: 1, bottom: 1 },
    border: { type: "line" },
    style: { bg: C.base, fg: C.ink, border: { fg: C.faint } },
    label: " LIVE MODEL ",
  });
  const timeline = frame({
    bottom: 3,
    height: 6,
    padding: { left: 1, right: 1 },
    label: " RUN LOG ",
  });
  const workers = frame({
    top: 5,
    right: 0,
    bottom: 3,
    label: " ORACLE WORKERS ",
  });
  const footer = blessed.box({
    bottom: 0,
    left: 0,
    height: 3,
    width: "100%",
    tags: true,
    padding: { left: 2, right: 2 },
    style: { bg: C.raised, fg: C.muted },
  });

  screen.append(header);
  screen.append(pipeline);
  screen.append(live);
  screen.append(timeline);
  screen.append(workers);
  screen.append(footer);

  const threadButtons = Array.from({ length: config.maxThreads }, (_, index) => {
    const value = index + 1;
    const button = blessed.button({
      parent: header,
      top: 1,
      width: 5,
      height: 1,
      content: ` ${value} `,
      mouse: true,
      keys: true,
      align: "center",
      style: {
        bg: C.surface,
        fg: C.muted,
        hover: { bg: C.faint, fg: C.ink },
        focus: { bg: C.cyan, fg: C.base },
      },
    });
    button.on("press", () => onThreads?.(value));
    return button;
  });
  const autoButton = blessed.button({
    parent: header,
    top: 1,
    width: 10,
    height: 1,
    content: " X AUTO ",
    mouse: true,
    keys: true,
    align: "center",
    style: {
      bg: C.surface,
      fg: C.cyan,
      hover: { bg: C.cyan, fg: C.base },
      focus: { bg: C.cyan, fg: C.base },
    },
  });
  autoButton.on("press", () => startAutopilot());

  const stageButtons = PIPELINE_STAGES.map((stage, index) => {
    const button = blessed.box({
      parent: pipeline,
      top: 1 + index * 3,
      left: 1,
      right: 1,
      height: 3,
      tags: true,
      mouse: true,
      clickable: true,
      padding: { left: 1, right: 1 },
      style: { bg: C.surface, fg: C.ink, hover: { bg: C.raised } },
    });
    button.on("click", () => (onRun ?? onStage)?.(stage.id));
    return { stage, button };
  });

  const priority = blessed.box({
    parent: pipeline,
    top: 2 + PIPELINE_STAGES.length * 3,
    left: 2,
    right: 2,
    bottom: 1,
    tags: true,
    valign: "bottom",
    style: { bg: C.surface, fg: C.muted },
  });

  const workerButtons = Array.from({ length: config.maxThreads }, (_, index) => {
    const button = blessed.box({
      parent: workers,
      top: 1 + index * 4,
      left: 1,
      right: 1,
      height: 4,
      tags: true,
      mouse: true,
      clickable: true,
      padding: { left: 1, right: 1 },
      style: { bg: C.surface, fg: C.muted, hover: { bg: C.raised } },
    });
    button.on("click", () => selectWorker(index));
    return button;
  });
  const quality = blessed.box({
    parent: workers,
    top: 18,
    left: 2,
    right: 2,
    bottom: 1,
    tags: true,
    style: { bg: C.surface, fg: C.muted },
  });

  const help = frame({
    top: "center",
    left: "center",
    width: 76,
    height: 26,
    hidden: true,
    label: " COMMAND MAP ",
    padding: { left: 3, right: 3, top: 1 },
    content:
      `{${C.cyan}-fg}{bold}RUN THE FACTORY{/bold}{/}\n\n` +
      ` b  Build reviewed search records (default)\n` +
      ` g  Legacy grounding     e  Legacy enrichment\n` +
      ` v  Verify claims         w  Rewrite rejected aliases\n` +
      ` z  Reverify rewrites     s  Synthesize queries\n` +
      ` r  Round-trip retrieval  a  Adjudicate confusions\n` +
      ` p  Inspect record export  x  Build all records\n\n` +
      `{${C.cyan}-fg}{bold}CONTROL{/bold}{/}\n\n` +
      ` 1–4  Worker threads      Space  Pause / resume queue\n` +
      ` ← →  Focus worker        f      Follow live output\n` +
      ` ↑ ↓  Scroll transcript   q      Quit safely\n\n` +
      `{${C.muted}-fg}Mouse controls work everywhere. Press ? or Esc to close.{/}`,
  });
  screen.append(help);

  const confirm = frame({
    top: "center",
    left: "center",
    width: 58,
    height: 9,
    hidden: true,
    label: " ACTIVE WORK ",
    padding: { left: 3, right: 3, top: 1 },
  });
  screen.append(confirm);

  const registry = new WorkerRegistry(config.maxThreads);
  const events = [];
  const tokenSamples = [];
  let snapshot = factoryStats();
  let queue = poolView(pool.snapshot());
  let threads = queue.threads;
  let focusedWorker = 0;
  let focusPinned = false;
  let currentStage = null;
  const batchProgress = new Map();
  let paused = queue.paused;
  let autoFollow = true;
  let autopilot = false;
  let autopilotCycle = 0;
  let gracefulQuit = false;
  let tick = 0;
  let stageStartedAt = null;
  let destroyed = false;

  function addEvent(level, title, detail = "") {
    events.push({ ts: Date.now(), level, title: oneLine(title, 40), detail: oneLine(detail, 110) });
    if (events.length > 120) events.shift();
  }

  function selectedSlot() {
    return registry.slots[focusedWorker] ?? registry.slots[0];
  }

  function selectWorker(index, { pin = true } = {}) {
    focusedWorker = (index + registry.size) % registry.size;
    focusPinned = pin;
    autoFollow = true;
    renderWorkers();
    renderLive();
    screen.render();
  }

  function runStage(stageId) {
    if (currentStage) {
      addEvent("warn", "Stage already active", currentStage);
      renderTimeline();
      screen.render();
      return;
    }
    (onRun ?? onStage)?.(stageId);
  }

  function startAutopilot() {
    if (autopilot || currentStage) {
      addEvent("warn", "Factory already running", currentStage ?? `autopilot cycle ${autopilotCycle}`);
      renderAll();
      return;
    }
    onAutopilot?.();
  }

  function tokenRate() {
    const now = Date.now();
    const displayedTokens = snapshot.pipelineTokens ?? snapshot.tokens;
    const total = displayedTokens.tokensIn + displayedTokens.tokensOut;
    tokenSamples.push({ ts: now, total });
    while (tokenSamples.length > 1 && tokenSamples[0].ts < now - 60_000) tokenSamples.shift();
    if (tokenSamples.length < 2) return 0;
    const first = tokenSamples[0];
    return Math.round(((total - first.total) * 60_000) / Math.max(1, now - first.ts));
  }

  function renderHeader() {
    const displayedTokens = snapshot.pipelineTokens ?? snapshot.tokens;
    const totalTokens = displayedTokens.tokensIn + displayedTokens.tokensOut;
    const rate = tokenRate();
    const livePulse = tick % 2 ? "●" : "◉";
    const stateColor = paused ? C.amber : queue.active > 0 ? C.green : C.muted;
    const stateLabel = paused ? "PAUSED" : queue.active > 0 ? "LIVE" : "READY";
    const compact = Number(screen.width) < 110;
    const fullyBuilt = progressFor("roundtrip").complete;
    const stage = PIPELINE_STAGES.some((item) => item.id === currentStage) ? currentStage : null;
    const stageCounts = stage ? progressFor(stage) : null;
    const batch = stage ? batchProgress.get(stage) : null;
    const stageLabel = stage ? PIPELINE_STAGES.find((item) => item.id === stage)?.label.toUpperCase() : null;
    const batchCompact = batch
      ? ` · batch ${formatCount(batch.completed)}/${batch.requested ? formatCount(batch.requested) : "?"}`
      : "";
    header.setContent(compact
      ? `{${C.cyan}-fg}{bold}DATASET FACTORY{/bold}{/}  {${stateColor}-fg}${livePulse} ${stateLabel}{/}\n` +
        `{bold}${stageLabel ?? "CORPUS"}{/bold}  ` +
        `${stageCounts ? `${formatCount(stageCounts.processed)}/${formatCount(stageCounts.total)} chars` : `${formatCount(snapshot.selection.total)} selected`}` +
        `${batchCompact}\n` +
        `{${C.green}-fg}{bold}BUILT ${formatCount(fullyBuilt)}/${formatCount(snapshot.selection.total)}{/bold}{/}  ` +
        `${formatCount(totalTokens)} v7 tok  ${displayedTokens.calls} calls  ${queue.active}/${threads} live`
      : `{${C.cyan}-fg}{bold}DATASET FACTORY{/bold}{/}  ` +
        `{${stateColor}-fg}${livePulse} ${stateLabel}{/}\n` +
        `{bold}${stageLabel ?? "CORPUS"}{/bold}  ` +
        `${stageCounts ? `{${C.cyan}-fg}${stageCounts.processed.toLocaleString()} / ${stageCounts.total.toLocaleString()} CHARACTERS PROCESSED{/}` : `${snapshot.selection.total.toLocaleString()} SELECTED CHARACTERS`}` +
        `${batch ? `   {${C.muted}-fg}CURRENT BATCH ${batch.completed.toLocaleString()} / ${batch.requested?.toLocaleString() ?? "?"}{/}` : ""}\n` +
        `{${C.green}-fg}{bold}FULLY BUILT ${fullyBuilt.toLocaleString()} / ${snapshot.selection.total.toLocaleString()} CHARACTERS{/bold}{/}   ` +
        `{${C.muted}-fg}OX ALPHA · CURRENT V7{/}   ${formatCount(totalTokens)} tokens   ${formatCount(rate)}/min   ` +
        `${displayedTokens.calls} calls   ${queue.active}/${threads} live`);
    const start = Math.max(42, Number(screen.width) - 22);
    autoButton.left = start - 11;
    autoButton.top = 0;
    autoButton.style.bg = autopilot ? C.cyan : C.surface;
    autoButton.style.fg = autopilot ? C.base : C.cyan;
    autoButton.setContent(autopilot ? ` AUTO ${autopilotCycle || "·"} ` : " X AUTO ");
    threadButtons.forEach((button, index) => {
      button.left = start + index * 5;
      button.top = 0;
      const selected = index + 1 === threads;
      button.style.bg = selected ? C.cyan : C.surface;
      button.style.fg = selected ? C.base : C.muted;
      button.setContent(selected ? `▸${index + 1}◂` : ` ${index + 1} `);
    });
  }

  function progressFor(stageId) {
    if (stageId === "adjudicate") {
      const counts = snapshot.queryAdjudication ?? {};
      const total = sum(counts);
      const complete = Number(counts.passed ?? 0) + Number(counts.skipped ?? 0);
      return {
        ...stageProgress({}, stageId, total), counts, total, complete, processed: complete,
        percent: total ? complete / total * 100 : 0,
        processedPercent: total ? complete / total * 100 : 0,
      };
    }
    return stageProgress(snapshot.checkpoints, stageId, snapshot.selection.total);
  }

  function renderPipeline() {
    const compact = Number(screen.height) < 40;
    for (const { stage, button } of stageButtons) {
      const progress = progressFor(stage.id);
      const active = currentStage === stage.id;
      const marker = active ? (tick % 4 === 0 ? "◆" : "◇") : progress.percent >= 100 ? "✓" : "·";
      const color = active ? C.cyan : progress.failed ? C.amber : progress.percent >= 100 ? C.green : C.muted;
      const displayPercent = progress.processedPercent;
      button.style.bg = active ? C.raised : C.surface;
      button.setContent(
        `{${color}-fg}${marker}{/} {bold}${stage.label}{/}  ` +
        `{${C.muted}-fg}${progressBar(displayPercent, compact ? 5 : 10)}{/} ` +
        `{${color}-fg}${displayPercent.toFixed(displayPercent < 10 ? 1 : 0)}%{/}\n` +
        `  {${C.muted}-fg}${formatCount(progress.processed)}/${formatCount(progress.total)} ${stage.id === "adjudicate" ? "queries" : "chars"}` +
        `${progress.running ? ` · ${progress.running} running` : ""}` +
        `${progress.failed ? ` · ${progress.failed} retry` : ""}{/}`,
      );
    }
    const stageElapsed = currentStage && stageStartedAt ? formatDuration(Date.now() - stageStartedAt) : "—";
    const completeEntities = progressFor("roundtrip").complete;
    priority.setContent(
      `{${C.muted}-fg}QUEUE ORDER{/}\n` +
      `{${C.ink}-fg}P0 failures → telemetry → popular → sweep{/}\n\n` +
      `{${C.muted}-fg}FULL PIPELINE{/}\n` +
      `${progressBar(snapshot.selection.total ? completeEntities / snapshot.selection.total * 100 : 0, 22)}\n` +
      `${formatCount(completeEntities)} / ${formatCount(snapshot.selection.total)} characters\n\n` +
      `{${C.muted}-fg}${autopilot ? `BREADTH AUTO · CYCLE ${autopilotCycle}` : "ACTIVE BATCH"}{/}\n` +
      `${currentStage ? `{${C.cyan}-fg}${currentStage}{/} · ${stageElapsed}` : autopilot ? "Building and reviewing search records" : "No stage running"}\n` +
      `${queue.queued} queued · ${queue.active} active`,
    );
  }

  function renderWorkers() {
    registry.slots.forEach((slot, index) => {
      const button = workerButtons[index];
      const focused = index === focusedWorker;
      const running = slot.status === "running";
      // Slots describe the last concrete OpenCode job. A completed job is not
      // "refilling" merely because a stage is doing render/DB work elsewhere.
      const statusLabel = slot.status.toUpperCase();
      const color = running ? C.green : slot.status === "failed" ? C.red : slot.status === "done" ? C.blue : C.muted;
      const glyph = running ? ["◜", "◝", "◞", "◟"][tick % 4] : slot.status === "done" ? "↻" : slot.status === "failed" ? "!" : "·";
      button.style.bg = focused ? C.raised : C.surface;
      button.setContent(
        `{${focused ? C.cyan : color}-fg}${focused ? "▸" : " "} W${String(index + 1).padStart(2, "0")} ${glyph} ${statusLabel}{/}\n` +
        `{${C.ink}-fg}${slot.stage ?? "available"}{/}` +
        `${running ? `  {${C.muted}-fg}${formatDuration(Date.now() - slot.startedAt)}{/}` : ""}\n` +
        `{${C.muted}-fg}${escapeTags(compactScope(slot.scope, 22))} · ${slot.apiEvents} events{/}`,
      );
    });

    const claims = snapshot.claims ?? {};
    const queries = snapshot.queries ?? {};
    quality.setContent(
      `{${C.muted}-fg}DATASET SIGNAL{/}\n\n` +
      `{bold}${formatCount(snapshot.selection.total)}{/bold} selected glyphs\n` +
      `{${C.green}-fg}${formatCount(claims.verified)}{/} verified aliases\n` +
      `{${C.amber}-fg}${formatCount(claims.proposed)}{/} awaiting verification\n` +
      `{bold}${formatCount(snapshot.confusionEdges)}{/bold} confusion edges\n\n` +
      `{${C.muted}-fg}ROUND-TRIP{/}\n\n` +
      `{${C.green}-fg}${formatCount(queries.pass)}{/} pass   ` +
      `{${C.amber}-fg}${formatCount(queries.hard)}{/} hard\n` +
      `{${C.red}-fg}${formatCount(queries.miss)}{/} miss   ` +
      `{bold}${formatCount(snapshot.adjudications)}{/bold} judged`,
    );
  }

  function renderLive() {
    const slot = selectedSlot();
    const running = slot.status === "running";
    const follow = focusPinned ? "PINNED" : autoFollow ? "AUTO-FOLLOW" : "SCROLL LOCK";
    live.setLabel(
      ` ${running ? "●" : "○"} LIVE API · W${String(slot.index + 1).padStart(2, "0")} · ${String(slot.stage ?? "WAITING").toUpperCase()} · ${follow} `,
    );
    const sections = [];
    if (slot.apiRaw) {
      sections.push(`OPENCODE API EVENTS · EXACT NDJSON\n${"─".repeat(42)}\n${slot.apiRaw}`);
    }
    if (slot.text) {
      sections.push(`MODEL RESPONSE · part.text\n${"─".repeat(42)}\n${slot.text}`);
    }
    let content = sections.join("\n\n");
    if (!content && running) {
      content =
        `REQUEST ACTIVE · WAITING FOR FIRST OPENCODE EVENT\n${"─".repeat(48)}\n` +
        `stage     ${slot.stage}\n` +
        `scope     ${compactScope(slot.scope, 90)}\n` +
        `raw log   ${slot.rawFile ?? "initializing"}\n` +
        `elapsed   ${formatDuration(Date.now() - slot.startedAt)}\n\n` +
        `The exact API stream will appear here as soon as OpenCode emits NDJSON.`;
    } else if (!content) {
      content =
        `NO ACTIVE API STREAM ON WORKER ${slot.index + 1}\n${"─".repeat(38)}\n` +
        `Start a stage, or press F to follow whichever worker produces API events.`;
    } else if (running && !slot.text) {
      content += `\n\nWAITING FOR MODEL RESPONSE · API CONNECTION ACTIVE`;
    }
    if (slot.error) content += `\n\n[worker error]\n${slot.error}`;
    if (running) content += tick % 2 ? "▌" : " ";
    live.setContent(content);
    if (autoFollow) live.setScrollPerc(100);
  }

  function renderTimeline() {
    const colors = { ok: C.green, warn: C.amber, error: C.red, info: C.blue, live: C.cyan };
    const visible = events.slice(-3).map((event) => {
      const time = new Date(event.ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `{${C.muted}-fg}${time}{/} {${colors[event.level] ?? C.muted}-fg}◆{/} ` +
        `{bold}${escapeTags(event.title)}{/bold}${event.detail ? `  {${C.muted}-fg}${escapeTags(event.detail)}{/}` : ""}`;
    });
    timeline.setContent(visible.join("\n") || `{${C.muted}-fg}No events yet. The factory is checkpointed and ready.{/}`);
  }

  function renderFooter() {
    const stages =
      `{${C.cyan}-fg}{bold}G{/bold}{/} Ground  ` +
      `{${C.cyan}-fg}{bold}E{/bold}{/} Enrich  ` +
      `{${C.cyan}-fg}{bold}V{/bold}{/} Verify  ` +
      `{${C.cyan}-fg}{bold}W{/bold}{/} Rewrite  ` +
      `{${C.cyan}-fg}{bold}Z{/bold}{/} Reverify  ` +
      `{${C.cyan}-fg}{bold}S{/bold}{/} Synth  ` +
      `{${C.cyan}-fg}{bold}R{/bold}{/} Round-trip  ` +
      `{${C.cyan}-fg}{bold}A{/bold}{/} Judge  ` +
      `{${C.cyan}-fg}{bold}P{/bold}{/} Publish  ` +
      `{${C.cyan}-fg}{bold}X{/bold}{/} Auto`;
    const controls = `{${C.ink}-fg}1–4{/} Threads  {${C.ink}-fg}Space{/} ${paused ? "Resume" : "Pause"}  ` +
      `{${C.ink}-fg}← →{/} Worker  {${C.ink}-fg}?{/} Help  {${C.ink}-fg}Q{/} Quit`;
    const compactStages =
      `{${C.cyan}-fg}{bold}G{/bold}{/} Ground  {${C.cyan}-fg}{bold}E{/bold}{/} Enrich  ` +
      `{${C.cyan}-fg}{bold}V{/bold}{/} Verify  {${C.cyan}-fg}{bold}W{/bold}{/} Rewrite  ` +
      `{${C.cyan}-fg}{bold}Z{/bold}{/} Reverify  {${C.cyan}-fg}{bold}S{/bold}{/} Synth  ` +
      `{${C.cyan}-fg}{bold}X{/bold}{/} Autopilot`;
    const compactControls =
      `{${C.cyan}-fg}{bold}R{/bold}{/} Round-trip  {${C.cyan}-fg}{bold}A{/bold}{/} Judge  ` +
      `{${C.cyan}-fg}{bold}P{/bold}{/} Publish   {${C.ink}-fg}1–4{/} Threads  ` +
      `{${C.ink}-fg}Space{/} Pause  {${C.ink}-fg}?{/} Help  {${C.ink}-fg}Q{/} Quit`;
    footer.setContent(Number(screen.width) < 120 ? `${compactStages}\n${compactControls}` : `${stages}     ${controls}`);
  }

  function layout() {
    const width = Number(screen.width);
    const leftWidth = width >= 135 ? 40 : width >= 105 ? 34 : 32;
    const rightWidth = width >= 118 ? 36 : width >= 96 ? 29 : 0;
    pipeline.width = leftWidth;
    live.left = leftWidth;
    live.right = rightWidth;
    timeline.left = leftWidth;
    timeline.right = rightWidth;
    workers.width = rightWidth || 1;
    workers.hidden = rightWidth === 0;
    const compact = Number(screen.height) < 40;
    priority.hidden = compact;
    stageButtons.forEach(({ button }, index) => {
      button.top = 1 + index * (compact ? 2 : 3);
      button.height = compact ? 2 : 3;
    });
    timeline.height = compact ? 4 : 6;
    live.bottom = 3 + timeline.height;
  }

  function renderAll() {
    if (destroyed) return;
    layout();
    renderHeader();
    renderPipeline();
    renderWorkers();
    renderLive();
    renderTimeline();
    renderFooter();
    screen.render();
  }

  function shutdown() {
    if (destroyed) return;
    destroyed = true;
    clearInterval(clock);
    unsubscribe();
    onQuit?.();
    screen.destroy();
  }

  function requestQuit() {
    queue = poolView(pool.snapshot());
    if (!queue.active && !queue.queued) return shutdown();
    confirm.setContent(
      `{${C.amber}-fg}{bold}${queue.active} workers are still active.{/bold}{/}\n\n` +
      `Stop safely after active calls finish? Queued work stays checkpointed.\n` +
      `{${C.amber}-fg}Y  drain & stop{/}     {${C.green}-fg}N  keep running{/}`,
    );
    confirm.show();
    confirm.setFront();
    screen.render();
  }

  function beginGracefulQuit() {
    gracefulQuit = true;
    onPause?.(true);
    confirm.setContent(
      `{${C.amber}-fg}{bold}DRAINING ${queue.active} ACTIVE CALL${queue.active === 1 ? "" : "S"}{/bold}{/}\n\n` +
      `No new work will start. The dashboard closes when the calls checkpoint.\n` +
      `{${C.muted}-fg}Press Ctrl-C only if you need an immediate hard stop.{/}`,
    );
    renderAll();
  }

  const unsubscribe = onEvent(({ type, data, ts }) => {
    if (type === "worker_start") {
      const slot = registry.start(data, ts);
      if (!focusPinned && registry.active().length === 1) focusedWorker = slot.index;
      addEvent("live", `Worker ${slot.index + 1} started`, `${data.stage} · ${compactScope(data.scope)}`);
    } else if (type === "worker_api") {
      const slot = registry.api(data);
      if (slot && !focusPinned) focusedWorker = slot.index;
    } else if (type === "worker_text") {
      const slot = registry.text(data);
      if (slot && !focusPinned) focusedWorker = slot.index;
    } else if (type === "worker_err") {
      registry.error(data);
      addEvent("error", "Worker error", data.err);
    } else if (type === "worker_done") {
      const slot = registry.done(data, ts);
      addEvent(
        data.ok ? "ok" : "error",
        `Worker ${slot?.index + 1 ?? "?"} ${data.ok ? "completed" : "failed"}`,
        data.ok ? `${data.stage} · +${formatCount(data.tokensIn + data.tokensOut)} tokens` : `${data.stage} · ${data.error ?? "unknown worker failure"}`,
      );
    } else if (type === "queue") {
      queue = poolView({ ...queue, ...data });
    } else if (type === "threads") {
      threads = data.threads;
      addEvent("info", "Concurrency changed", `${threads} OpenCode worker${threads === 1 ? "" : "s"}`);
    } else if (type === "pause") {
      paused = data.paused;
      addEvent("warn", paused ? "Queue paused" : "Queue resumed", paused ? "Active calls finish; new calls wait" : "Dispatching queued work");
    } else if (type === "stage") {
      if (data.note === "started" || data.running === true) {
        currentStage = data.stage;
        batchProgress.set(data.stage, { completed: 0, requested: null });
        stageStartedAt = ts;
        addEvent("live", `${data.stage} started`);
      } else if (data.note === "finished" || data.running === false) {
        addEvent("ok", `${data.stage} finished`, stageStartedAt ? formatDuration(ts - stageStartedAt) : "");
        currentStage = null;
        stageStartedAt = null;
      } else addEvent("warn", "Stage note", data.note);
    } else if (type === "stage_progress") {
      currentStage = data.stage;
      const previous = batchProgress.get(data.stage) ?? { completed: 0, requested: null };
      const completed = data.processed ?? data.done ?? (data.entity ? previous.completed + 1 : previous.completed);
      batchProgress.set(data.stage, { completed: Number(completed), requested: data.requested ?? previous.requested });
      addEvent("info", `${data.stage} checkpoint`, data.query ?? `${data.processed ?? data.done ?? "?"}/${data.requested ?? "?"}`);
    } else if (type === "emit") {
      addEvent("ok", "Artifacts published", data.dir);
    } else if (["stage_error", "roundtrip_err", "contract_error"].includes(type)) {
      addEvent("error", type.replaceAll("_", " "), data.error ?? data.err);
    } else if (type === "stage_warning") {
      addEvent("warn", "Stage warning", JSON.stringify(data));
    } else if (type === "autopilot") {
      autopilot = Boolean(data.running);
      autopilotCycle = Number(data.cycle ?? autopilotCycle);
      if (data.running && data.completedThisCycle !== undefined) {
        addEvent("live", `Autopilot cycle ${autopilotCycle}`, `${formatCount(data.completedThisCycle)} work items advanced`);
      } else if (!data.running) {
        addEvent("ok", "Autopilot complete", `${formatCount(data.completedTotal)} work items processed`);
      }
    } else if (type === "autopilot_phase") {
      const detail = data.waveEntities
        ? `${formatCount(data.waveEntities)} character alias wave`
        : data.entities !== undefined
          ? `${formatCount(data.entities)} entities`
          : "checkpoint wave";
      addEvent("live", `Autopilot · ${data.phase}`, detail);
    }
    if (["tokens", "worker_done", "stage_progress", "emit", "selection"].includes(type)) snapshot = factoryStats();
    renderAll();
  });

  for (const stage of PIPELINE_STAGES) screen.key(stage.key, () => runStage(stage.id));
  screen.key("x", startAutopilot);
  for (let n = 1; n <= config.maxThreads; n++) screen.key(String(n), () => onThreads?.(n));
  screen.key("space", () => onPause?.(!paused));
  screen.key("p", () => onEmit?.());
  screen.key(["right", "]", "l"], () => selectWorker(focusedWorker + 1));
  screen.key(["left", "[", "h"], () => selectWorker(focusedWorker - 1));
  screen.key("f", () => { focusPinned = false; autoFollow = true; renderAll(); });
  live.key(["up", "pageup", "k"], () => { focusPinned = true; autoFollow = false; renderAll(); });
  live.key(["end"], () => { focusPinned = false; autoFollow = true; renderAll(); });
  live.on("wheelup", () => { focusPinned = true; autoFollow = false; renderAll(); });
  live.on("wheeldown", () => {
    if (live.getScrollPerc() >= 99) autoFollow = true;
    renderAll();
  });
  screen.key("?", () => { help.hidden = !help.hidden; if (!help.hidden) help.setFront(); renderAll(); });
  screen.key("escape", () => { help.hide(); confirm.hide(); renderAll(); });
  screen.key("q", requestQuit);
  screen.key("C-c", shutdown);
  screen.key("y", () => { if (!confirm.hidden) beginGracefulQuit(); });
  screen.key("n", () => { if (!confirm.hidden) { confirm.hide(); renderAll(); } });
  screen.on("resize", renderAll);

  const clock = setInterval(() => {
    tick++;
    queue = poolView(pool.snapshot());
    if (gracefulQuit && queue.active === 0) return shutdown();
    if (tick % 4 === 0) snapshot = factoryStats();
    renderAll();
  }, 500);
  clock.unref?.();

  addEvent("info", "Factory ready", `${snapshot.selection.total.toLocaleString()} entities · checkpoints restored`);
  renderAll();
  return { screen, live, timeline, destroy: shutdown, registry, render: renderAll };
}
