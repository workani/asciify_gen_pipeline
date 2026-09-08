/* The wire vocabulary, mirroring src/se_miner/events.py.
   Any producer that emits these events can drive this dashboard; nothing here
   knows about Stack Exchange, SQLite, or the miner in particular. */

export const SITE_PHASES = [
  "discover_posts",
  "discover_comments",
  "discover_history",
  "discover_duplicates",
  "resolve_threads",
  "collect_posts",
  "collect_comments",
  "collect_history",
] as const;

export type Phase = (typeof SITE_PHASES)[number];

/** Phases that vanish from the plan when their optional source table is absent. */
export const OPTIONAL_PHASES: Record<string, string> = {
  discover_history: "PostHistory",
  discover_duplicates: "PostLinks",
  collect_history: "PostHistory",
};

/** A finished discovery pass counted every row of its table under the same
    pinned source, so it is a real denominator for the matching collection pass. */
export const COLLECT_SOURCE: Record<string, string> = {
  collect_posts: "discover_posts",
  collect_comments: "discover_comments",
  collect_history: "discover_history",
};

export const PHASE_LABELS: Record<string, string> = {
  inventory: "Inventorying archive tables",
  discover_posts: "Discovering posts",
  discover_comments: "Scanning comments",
  discover_history: "Scanning post history",
  discover_duplicates: "Mapping duplicate links",
  resolve_threads: "Resolving candidate threads",
  collect_posts: "Collecting full discussions",
  collect_comments: "Collecting thread comments",
  collect_history: "Collecting original revisions",
  complete: "Finalizing site",
};

export function phaseLabel(phase?: string): string {
  if (phase && PHASE_LABELS[phase]) return PHASE_LABELS[phase];
  if (!phase) return "Working";
  const words = phase.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type RunStatus =
  | "starting"
  | "running"
  | "paused"
  | "complete"
  | "complete_with_warnings"
  | "incomplete"
  | "failed";

export type LogLevel = "info" | "warn" | "error";

export interface Checkpoint {
  site: string;
  phase: string;
  ordinal?: number;
  complete?: number | boolean;
}

/** One line of the producer's JSONL stream. Fields are optional because the
    stream is data from another process, not a typed call. */
export interface MinerEvent {
  event?: string;
  /** Producer wall clock, epoch seconds. Present on every miner event, so a
      saved stream replays with the times the run actually had. */
  at?: number;
  site?: string;
  phase?: string;
  table?: string;
  rows?: number;
  committed?: number;
  total?: number | null;
  new_rows?: number;
  resumed_from?: number;
  target?: number;
  unit?: string;
  reason?: string;
  complete?: boolean;
  tables?: string[];
  missing_optional?: string[];
  release?: string;
  manifest?: string;
  work_dir?: string;
  sites?: string[];
  checkpoints?: Checkpoint[];
  budget_bytes?: number;
  work_bytes?: number;
  candidates?: number;
  documents?: number;
  discovery_hits?: number;
  requests?: number;
  bytes?: number;
  note?: string | null;
  action?: string;
  url?: string;
  done?: number;
  quiet?: boolean;
  attempt?: number;
  attempts?: number;
  delay?: number;
  status?: RunStatus | number | string;
  error?: string;
  level?: LogLevel;
  message?: string;
  warnings?: Record<string, number>;
}

export const RUN_STARTED = "run_started";
export const RUN_FINISHED = "run_finished";
export const SITE_STARTED = "site_started";
export const SITE_COMPLETE = "site_complete";
export const SITE_FAILED = "site_failed";
export const INVENTORY = "inventory";
export const SOURCE = "source";
export const NETWORK = "network";
export const RETRY = "retry";
export const STAGE_STARTED = "stage_started";
export const STAGE_SKIPPED = "stage_skipped";
export const STAGE_COMPLETE = "stage_complete";
export const REPLAY = "replay";
export const PROGRESS = "progress";
export const CHECKPOINT = "checkpoint";
export const WORKING = "working";
export const METRICS = "metrics";
export const LOG = "log";
