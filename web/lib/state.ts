/* Presentation model for one pipeline run, mirroring src/se_miner/uistate.py.

   Mutable accumulator plus an immutable snapshot: events can arrive thousands
   per second, so React re-renders are driven by a bounded tick that reads
   `snapshot()`, never by the event stream itself. */

import {
  COLLECT_SOURCE,
  Checkpoint,
  LogLevel,
  MinerEvent,
  OPTIONAL_PHASES,
  RunStatus,
  SITE_PHASES,
  phaseLabel,
} from "./events";

const DONE = new Set(["complete", "skipped"]);
const MAX_LOG = 400;
const RATE_WINDOW = 6;
const CHECKPOINT_LOG_INTERVAL = 15;

export type StageStatus = "pending" | "active" | "complete" | "skipped" | "failed";
export type SiteStatus = "pending" | "active" | "complete" | "skipped" | "failed";

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  text: string;
}

export interface StageView {
  phase: string;
  label: string;
  status: StageStatus;
  observed: number;
  committed: number;
  total: number | null;
  unit: string;
  resumedFrom: number;
  replayed: number;
  replayTarget: number;
  replaying: boolean;
  note: string | null;
  committedAt: number | null;
  elapsed: number;
  newRows: number;
  rate: number | null;
  replayRate: number | null;
  percent: number | null;
  eta: number | null;
}

export interface SiteView {
  site: string;
  status: SiteStatus;
  done: number;
  planned: number;
  phases: { phase: string; label: string; status: StageStatus }[];
  missingOptional: string[];
  note: string | null;
  stage: string | null;
}

export interface RunSnapshot {
  release: string | null;
  manifest: string | null;
  workDir: string | null;
  status: RunStatus;
  elapsed: number;
  reason: string | null;
  warnings: Record<string, number>;
  resumed: boolean;
  rowsThisRun: number;
  sites: SiteView[];
  active: (StageView & { site: string }) | null;
  overall: { stages: number; stagesTotal: number; sites: number; sitesTotal: number };
  metrics: { candidates: number; documents: number; discoveryHits: number };
  storage: { used: number | null; limit: number | null };
  network: { requests: number; bytes: number; last: number | null; note: string | null };
  idle: number;
  log: LogEntry[];
}

interface Sample {
  t: number;
  v: number;
}

interface Stage {
  phase: string;
  label: string;
  status: StageStatus;
  observed: number;
  committed: number;
  total: number | null;
  unit: string;
  resumedFrom: number;
  replayed: number;
  replayTarget: number;
  replaying: boolean;
  note: string | null;
  started: number | null;
  committedAt: number | null;
  loggedAt: number;
  samples: Sample[];
  replaySamples: Sample[];
}

interface Site {
  site: string;
  status: SiteStatus;
  tables: string[] | null;
  missingOptional: string[];
  planned: string[];
  stages: Map<string, Stage>;
  started: number | null;
  note: string | null;
}

function push(samples: Sample[], t: number, v: number) {
  samples.push({ t, v });
  if (samples.length > 64) samples.shift();
}

function rateOf(samples: Sample[], now: number): number | null {
  const points = samples.filter((s) => now - s.t <= RATE_WINDOW);
  if (points.length < 2) return null;
  const span = points[points.length - 1].t - points[0].t;
  const delta = points[points.length - 1].v - points[0].v;
  if (span < 0.25 || delta < 0) return null;
  return delta / span;
}

export class RunModel {
  /** Bumped on every applied event so a view can skip identical frames. */
  version = 0;

  private started = this.now();
  private finished: number | null = null;
  private lastEvent = this.now();
  private logSeq = 0;
  /** Producer clock, when the stream carries one: a backlog replayed in a
      second still reports the hours the run really took. */
  private stamp: number | null = null;
  private startedWall: number | null = null;
  private finishedWall: number | null = null;

  private release: string | null = null;
  private manifest: string | null = null;
  private workDir: string | null = null;
  private status: RunStatus = "starting";
  private reason: string | null = null;
  private warnings: Record<string, number> = {};
  private resumed = false;
  private rowsThisRun = 0;
  private activeKey: [string, string] | null = null;

  private order: string[] = [];
  private sites = new Map<string, Site>();
  private log: LogEntry[] = [];
  private metrics = { candidates: 0, documents: 0, discoveryHits: 0 };
  private storage: { used: number | null; limit: number | null } = { used: null, limit: null };
  private network: { requests: number; bytes: number; last: number | null; note: string | null } = {
    requests: 0,
    bytes: 0,
    last: null,
    note: null,
  };

  /** Cheap enough to poll every frame, unlike building a whole snapshot. */
  get runStatus(): RunStatus {
    return this.status;
  }

  private now() {
    return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  }

  private wall() {
    return Date.now() / 1000;
  }

  reset() {
    this.started = this.now();
    this.finished = null;
    this.stamp = null;
    this.startedWall = null;
    this.finishedWall = null;
    this.status = "starting";
    this.release = this.manifest = this.workDir = this.reason = null;
    this.warnings = {};
    this.resumed = false;
    this.rowsThisRun = 0;
    this.activeKey = null;
    this.order = [];
    this.sites = new Map();
    this.log = [];
    this.metrics = { candidates: 0, documents: 0, discoveryHits: 0 };
    this.storage = { used: null, limit: null };
    this.network = { requests: 0, bytes: 0, last: null, note: null };
    this.version += 1;
  }

  private addLog(level: LogLevel, text: string) {
    this.logSeq += 1;
    this.log.push({ id: this.logSeq, at: this.stamp ?? this.wall(), level, text });
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  private site(host: string): Site {
    let site = this.sites.get(host);
    if (!site) {
      site = {
        site: host,
        status: "pending",
        tables: null,
        missingOptional: [],
        planned: [...SITE_PHASES],
        stages: new Map(),
        started: null,
        note: null,
      };
      this.sites.set(host, site);
      this.order.push(host);
    }
    return site;
  }

  private stage(host: string, phase: string): Stage {
    const site = this.site(host);
    let stage = site.stages.get(phase);
    if (!stage) {
      stage = {
        phase,
        label: phaseLabel(phase),
        status: "pending",
        observed: 0,
        committed: 0,
        total: null,
        unit: "rows",
        resumedFrom: 0,
        replayed: 0,
        replayTarget: 0,
        replaying: false,
        note: null,
        started: null,
        committedAt: null,
        loggedAt: 0,
        samples: [],
        replaySamples: [],
      };
      site.stages.set(phase, stage);
    }
    return stage;
  }

  /** A finished discovery pass is the denominator for its collection pass. */
  private refreshTotals(site: Site) {
    for (const [phase, source] of Object.entries(COLLECT_SOURCE)) {
      const origin = site.stages.get(source);
      if (!origin || origin.status !== "complete" || origin.total === null) continue;
      if (!site.planned.includes(phase)) continue;
      const stage = this.stage(site.site, phase);
      if (stage.total === null && stage.status !== "complete") stage.total = origin.total;
    }
  }

  apply(ev: MinerEvent) {
    if (!ev || typeof ev !== "object") return;
    this.stamp = typeof ev.at === "number" ? ev.at : null;
    const kind = ev.event;
    if (kind) this.dispatch(kind, ev);
    else if (ev.phase) this.dispatch(ev.complete ? "stage_complete" : "progress", ev);
    this.lastEvent = this.now();
    this.version += 1;
  }

  private dispatch(kind: string, ev: MinerEvent) {
    switch (kind) {
      case "run_started":
        return this.onRunStarted(ev);
      case "site_started":
        return this.onSiteStarted(ev);
      case "inventory":
        return this.onInventory(ev);
      case "stage_started":
        return this.onStageStarted(ev);
      case "stage_skipped":
        return this.onStageSkipped(ev);
      case "replay":
        return this.onReplay(ev);
      case "progress":
        return this.onProgress(ev);
      case "checkpoint":
        return this.onCheckpoint(ev);
      case "working":
        return this.onWorking(ev);
      case "stage_complete":
        return this.onStageComplete(ev);
      case "site_complete":
        return this.onSiteComplete(ev);
      case "site_failed":
        return this.onSiteFailed(ev);
      case "source":
        return this.onSource(ev);
      case "network":
        return this.onNetwork(ev);
      case "retry":
        return this.onRetry(ev);
      case "metrics":
        return this.onMetrics(ev);
      case "log":
        return this.onLog(ev);
      case "run_finished":
        return this.onRunFinished(ev);
      default:
        return undefined;
    }
  }

  private onRunStarted(ev: MinerEvent) {
    // A feed may carry several runs back to back; each one starts clean.
    const stamp = this.stamp;
    this.reset();
    this.stamp = stamp;
    this.startedWall = stamp;
    this.release = ev.release ?? null;
    this.manifest = ev.manifest ?? null;
    this.workDir = ev.work_dir ?? null;
    this.storage.limit = ev.budget_bytes ?? null;
    if (ev.work_bytes !== undefined) this.storage.used = ev.work_bytes;
    for (const host of ev.sites ?? []) this.site(host);
    for (const row of (ev.checkpoints ?? []) as Checkpoint[]) {
      const host = row.site;
      if (!host || !this.sites.has(host)) continue;
      if (row.phase === "complete") {
        if (row.complete) this.site(host).status = "complete";
        continue;
      }
      if (!(SITE_PHASES as readonly string[]).includes(row.phase)) continue;
      const stage = this.stage(host, row.phase);
      stage.observed = stage.committed = stage.resumedFrom = row.ordinal ?? 0;
      if (row.complete) {
        stage.status = "complete";
        stage.total = stage.observed;
        stage.note = "completed in an earlier run";
        this.resumed = true;
      } else if (stage.observed) {
        this.resumed = true;
      }
    }
    for (const site of this.sites.values()) this.refreshTotals(site);
    this.status = "running";
    this.addLog(
      "info",
      this.resumed
        ? `Resuming ${this.release ?? "run"} from saved checkpoints`
        : `Starting ${this.release ?? "run"}`,
    );
  }

  private onSiteStarted(ev: MinerEvent) {
    const site = this.site(ev.site!);
    site.started = this.now();
    if (site.status !== "complete") site.status = "active";
    this.addLog("info", site.site);
  }

  private onInventory(ev: MinerEvent) {
    const site = this.site(ev.site!);
    site.tables = [...(ev.tables ?? [])];
    site.missingOptional = [...(ev.missing_optional ?? [])];
    site.planned = SITE_PHASES.filter((p) => {
      const table = OPTIONAL_PHASES[p];
      return !table || !site.missingOptional.includes(table);
    });
    this.refreshTotals(site);
    this.addLog("info", `${site.site} tables: ${site.tables.join(", ") || "none"}`);
    if (site.missingOptional.length) {
      this.addLog("warn", `${site.site} has no ${site.missingOptional.join(", ")}`);
    }
  }

  private onStageStarted(ev: MinerEvent) {
    const stage = this.stage(ev.site!, ev.phase!);
    stage.status = "active";
    stage.started = this.now();
    stage.resumedFrom = ev.resumed_from ?? 0;
    stage.observed = stage.committed = stage.resumedFrom;
    if (ev.total !== undefined && ev.total !== null) stage.total = ev.total;
    if (ev.unit) stage.unit = ev.unit;
    stage.replayTarget = stage.resumedFrom;
    stage.replaying = Boolean(stage.resumedFrom);
    stage.samples = [];
    stage.replaySamples = [];
    this.network.note = null;
    this.activeKey = [ev.site!, ev.phase!];
    this.addLog(
      "info",
      stage.resumedFrom
        ? `${stage.label} — resuming after row ${stage.resumedFrom.toLocaleString("en-US")}`
        : stage.label,
    );
  }

  private onStageSkipped(ev: MinerEvent) {
    const stage = this.stage(ev.site!, ev.phase!);
    const reason = ev.reason ?? "skipped";
    if (reason === "already complete") {
      stage.status = "complete";
      stage.note = "completed in an earlier run";
      stage.observed = stage.committed = ev.rows ?? stage.observed;
      stage.total = stage.observed;
      this.refreshTotals(this.site(ev.site!));
      this.addLog("info", `${stage.label} already complete`);
    } else {
      stage.status = "skipped";
      stage.note = reason;
      this.addLog("info", `${stage.label} skipped — ${reason}`);
    }
  }

  private onReplay(ev: MinerEvent) {
    const stage = this.stage(ev.site!, ev.phase!);
    stage.replaying = true;
    stage.replayed = ev.rows ?? 0;
    if (ev.target) stage.replayTarget = ev.target;
    push(stage.replaySamples, this.now(), stage.replayed);
    this.activeKey = [ev.site!, ev.phase!];
  }

  private onProgress(ev: MinerEvent) {
    const stage = this.stage(ev.site!, ev.phase!);
    stage.status = "active";
    stage.replaying = false;
    stage.observed = ev.rows ?? 0;
    if (ev.committed !== undefined) stage.committed = ev.committed;
    if (ev.total !== undefined && ev.total !== null) stage.total = ev.total;
    if (ev.new_rows !== undefined) this.rowsThisRun = ev.new_rows;
    if (ev.work_bytes !== undefined) this.storage.used = ev.work_bytes;
    push(stage.samples, this.now(), stage.observed);
    this.activeKey = [ev.site!, ev.phase!];
  }

  private onCheckpoint(ev: MinerEvent) {
    this.onProgress(ev);
    const stage = this.stage(ev.site!, ev.phase!);
    stage.committed = ev.committed ?? ev.rows ?? 0;
    stage.committedAt = this.stamp ?? this.wall();
    const now = this.now();
    // The live readout already shows the committed ordinal; the log only needs
    // a periodic anchor, not a line per batch.
    if (now - stage.loggedAt >= CHECKPOINT_LOG_INTERVAL) {
      stage.loggedAt = now;
      this.addLog("info", `Checkpoint at row ${stage.committed.toLocaleString("en-US")}`);
    }
  }

  private onWorking(ev: MinerEvent) {
    const stage = this.stage(ev.site!, ev.phase!);
    stage.status = "active";
    if (ev.note) stage.note = ev.note;
    this.activeKey = [ev.site!, ev.phase!];
  }

  private onStageComplete(ev: MinerEvent) {
    const stage = this.stage(ev.site!, ev.phase!);
    const rows = ev.rows ?? 0;
    stage.status = "complete";
    stage.observed = stage.committed = rows;
    stage.total = ev.total ?? rows;
    if (ev.unit) stage.unit = ev.unit;
    stage.replaying = false;
    stage.committedAt = this.stamp ?? this.wall();
    this.network.note = null;
    if (ev.new_rows !== undefined) this.rowsThisRun = ev.new_rows;
    this.refreshTotals(this.site(ev.site!));
    this.addLog("info", `${stage.label} — ${rows.toLocaleString("en-US")} ${stage.unit}`);
  }

  private onSiteComplete(ev: MinerEvent) {
    this.site(ev.site!).status = "complete";
    this.addLog("info", `Finished ${ev.site}`);
  }

  private onSiteFailed(ev: MinerEvent) {
    const site = this.site(ev.site!);
    site.status = "failed";
    site.note = ev.message ?? null;
    this.addLog("error", `${ev.site} failed — ${ev.message ?? "unknown error"}`);
  }

  private onSource(ev: MinerEvent) {
    const note = ev.note ?? ev.action ?? null;
    this.network.note = note;
    if (ev.quiet) return;
    const short = ev.url ? String(ev.url).split("/").pop() : "";
    this.addLog("info", short ? `${note} ${short}` : String(note));
  }

  private onNetwork(ev: MinerEvent) {
    this.network.requests += ev.requests ?? 0;
    this.network.bytes += ev.bytes ?? 0;
    this.network.last = this.now();
    // Traffic moving again means any "retrying" note is stale.
    this.network.note = ev.note ?? null;
  }

  private onRetry(ev: MinerEvent) {
    const detail = ev.status ? `HTTP ${ev.status}` : (ev.error ?? "no response");
    this.network.note = `retrying in ${ev.delay}s`;
    this.addLog("warn", `Retry ${ev.attempt}/${ev.attempts} after ${detail} — waiting ${ev.delay}s`);
  }

  private onMetrics(ev: MinerEvent) {
    if (ev.candidates !== undefined) this.metrics.candidates = ev.candidates;
    if (ev.documents !== undefined) this.metrics.documents = ev.documents;
    if (ev.discovery_hits !== undefined) this.metrics.discoveryHits = ev.discovery_hits;
    if (ev.work_bytes !== undefined) this.storage.used = ev.work_bytes;
    if (ev.budget_bytes !== undefined) this.storage.limit = ev.budget_bytes;
  }

  private onLog(ev: MinerEvent) {
    this.addLog((ev.level as LogLevel) ?? "info", ev.message ?? "");
  }

  private onRunFinished(ev: MinerEvent) {
    this.status = (ev.status as RunStatus) ?? "complete";
    this.finished = this.now();
    this.finishedWall = this.stamp;
    this.reason = ev.reason ?? null;
    this.warnings = ev.warnings ?? {};
    const level: LogLevel =
      this.status === "failed" ? "error" : this.status === "paused" ? "warn" : "info";
    this.addLog(level, ev.message ?? this.status);
  }

  private stageView(stage: Stage, now: number): StageView {
    const view: StageView = {
      phase: stage.phase,
      label: stage.label,
      status: stage.status,
      observed: stage.observed,
      committed: stage.committed,
      total: stage.total,
      unit: stage.unit,
      resumedFrom: stage.resumedFrom,
      replayed: stage.replayed,
      replayTarget: stage.replayTarget,
      replaying: stage.replaying,
      note: stage.note,
      committedAt: stage.committedAt,
      elapsed: stage.started ? now - stage.started : 0,
      newRows: Math.max(0, stage.observed - stage.resumedFrom),
      rate: rateOf(stage.samples, now),
      replayRate: rateOf(stage.replaySamples, now),
      percent: null,
      eta: null,
    };
    if (stage.replaying) {
      // Replay has a real denominator: the committed ordinal being replayed to.
      if (stage.replayTarget) view.percent = Math.min(1, stage.replayed / stage.replayTarget);
      if (view.replayRate) {
        view.eta = Math.max(0, (stage.replayTarget - stage.replayed) / view.replayRate);
      }
    } else if (stage.total) {
      view.percent = Math.min(1, stage.observed / stage.total);
      if (view.rate && stage.status === "active") {
        view.eta = Math.max(0, (stage.total - stage.observed) / view.rate);
      }
    }
    return view;
  }

  /** Prefer the producer's own clock; fall back to how long we have watched. */
  private elapsed(now: number): number {
    if (this.startedWall !== null) {
      return Math.max(0, (this.finishedWall ?? this.wall()) - this.startedWall);
    }
    return (this.finished ?? now) - this.started;
  }

  snapshot(): RunSnapshot {
    const now = this.now();
    const sites: SiteView[] = [];
    let doneStages = 0;
    let totalStages = 0;
    let doneSites = 0;
    for (const host of this.order) {
      const site = this.sites.get(host)!;
      const phases = site.planned.map((phase) => {
        const stage = site.stages.get(phase);
        return {
          phase,
          label: phaseLabel(phase),
          status: (stage?.status ?? "pending") as StageStatus,
        };
      });
      const finished = phases.filter((p) => DONE.has(p.status)).length;
      doneStages += finished;
      totalStages += phases.length;
      if (site.status === "complete") doneSites += 1;
      const current = site.planned
        .map((p) => site.stages.get(p))
        .find((s) => s?.status === "active");
      sites.push({
        site: host,
        status: site.status,
        done: finished,
        planned: phases.length,
        phases,
        missingOptional: [...site.missingOptional],
        note: site.note,
        stage: current?.label ?? null,
      });
    }
    let active: (StageView & { site: string }) | null = null;
    if (this.activeKey) {
      const [host, phase] = this.activeKey;
      const stage = this.sites.get(host)?.stages.get(phase);
      if (stage) active = { site: host, ...this.stageView(stage, now) };
    }
    return {
      release: this.release,
      manifest: this.manifest,
      workDir: this.workDir,
      status: this.status,
      elapsed: this.elapsed(now),
      reason: this.reason,
      warnings: { ...this.warnings },
      resumed: this.resumed,
      rowsThisRun: this.rowsThisRun,
      sites,
      active,
      overall: {
        stages: doneStages,
        stagesTotal: totalStages,
        sites: doneSites,
        sitesTotal: this.order.length,
      },
      metrics: { ...this.metrics },
      storage: { ...this.storage },
      network: { ...this.network },
      idle: now - this.lastEvent,
      log: this.log.slice(),
    };
  }
}
