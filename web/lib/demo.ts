/* A synthetic run so the dashboard is meaningful with no miner attached.
   Mirrors scripts/miner-ui-demo.py: resume, replay, unknown totals, retries,
   a slow resolution step, and a finish with coverage warnings. */

import { MinerEvent, SITE_PHASES } from "./events";

export interface Step {
  wait: number;
  event: MinerEvent;
}

const SITES = [
  "english.stackexchange.com",
  "math.stackexchange.com",
  "tex.stackexchange.com",
];
const TOTALS: Record<string, number> = {
  "english.stackexchange.com": 1_180_000,
  "math.stackexchange.com": 4_240_000,
  "tex.stackexchange.com": 1_460_000,
};

export function demoTimeline(): Step[] {
  const steps: Step[] = [];
  const at = (wait: number, event: MinerEvent) => steps.push({ wait, event });

  const checkpoints = SITE_PHASES.map((phase) => ({
    site: SITES[0],
    phase,
    ordinal: TOTALS[SITES[0]],
    complete: 1,
  }));
  checkpoints.push({ site: SITES[0], phase: "complete", ordinal: 0, complete: 1 } as never);
  // The second site resumes mid-collection, so replay has something to show.
  checkpoints.push({
    site: SITES[1],
    phase: "discover_posts",
    ordinal: TOTALS[SITES[1]],
    complete: 1,
  } as never);
  checkpoints.push({
    site: SITES[1],
    phase: "discover_comments",
    ordinal: 9_100_000,
    complete: 1,
  } as never);

  at(0, {
    event: "run_started",
    release: "synthetic-demo-release",
    manifest: "docs/miner/pilot.manifest.json",
    work_dir: ".miner-work",
    sites: SITES,
    budget_bytes: 10_000_000_000,
    work_bytes: 1_900_000_000,
    checkpoints,
  });
  at(200, {
    event: "metrics",
    candidates: 48_100,
    documents: 612_400,
    discovery_hits: 131_900,
  });

  const host = SITES[1];
  let newRows = 0;
  let used = 1_900_000_000;

  at(900, { event: "site_started", site: host });
  at(500, {
    event: "inventory",
    site: host,
    tables: ["Posts", "Comments", "PostHistory", "PostLinks"],
    missing_optional: [],
  });

  const stream = (
    phase: string,
    start: number,
    total: number | null,
    ticks: number,
    per: number,
    unit = "rows",
    retryAt?: number,
  ) => {
    at(400, { event: "stage_started", site: host, phase, resumed_from: start, total, unit });
    if (start) {
      const step = Math.max(1, Math.floor(start / 14));
      for (let replayed = 0; replayed <= start; replayed += step) {
        at(110, { event: "replay", site: host, phase, rows: Math.min(replayed, start), target: start });
        at(0, { event: "network", requests: 2, bytes: 8_400_000 });
      }
    }
    let rows = start;
    for (let i = 0; i < ticks; i += 1) {
      rows += per;
      newRows += per;
      used += per * 190;
      at(130, {
        event: "progress",
        site: host,
        phase,
        rows,
        committed: rows - 380,
        new_rows: newRows,
      });
      if (i % 3 === 0) {
        at(0, {
          event: "checkpoint",
          site: host,
          phase,
          rows,
          committed: rows,
          new_rows: newRows,
          work_bytes: used,
        });
        at(0, {
          event: "metrics",
          candidates: 48_100 + Math.floor(newRows / 90),
          documents: 612_400 + Math.floor(newRows / 7),
          discovery_hits: 131_900 + Math.floor(newRows / 30),
        });
      }
      if (retryAt !== undefined && i === retryAt) {
        at(0, {
          event: "retry",
          url: "https://archive.org/download/stackexchange/math.stackexchange.com.7z",
          attempt: 2,
          attempts: 4,
          delay: 4,
          status: 503,
        });
        at(1100, { event: "working", site: host, phase });
      }
      at(0, { event: "network", requests: 1, bytes: 4_100_000 });
    }
    at(300, {
      event: "stage_complete",
      site: host,
      phase,
      rows,
      total: rows,
      unit,
      new_rows: newRows,
    });
  };

  // No denominator yet: an indeterminate bar with real rows and throughput.
  stream("discover_history", 0, null, 20, 41_000, "rows", 8);
  stream("discover_duplicates", 0, null, 8, 12_500);

  at(400, { event: "stage_started", site: host, phase: "resolve_threads", total: null, unit: "threads" });
  for (let i = 0; i < 12; i += 1) {
    at(180, {
      event: "working",
      site: host,
      phase: "resolve_threads",
      note: "expanding duplicate groups",
    });
  }
  at(200, {
    event: "stage_complete",
    site: host,
    phase: "resolve_threads",
    rows: 62_880,
    total: 62_880,
    unit: "threads",
  });

  // Resuming collection: replay first, then a total inherited from discovery.
  stream("collect_posts", 1_610_000, TOTALS[host], 18, 96_000);
  at(400, { event: "site_complete", site: host });
  at(700, {
    event: "run_finished",
    status: "complete_with_warnings",
    warnings: { comment_count_mismatches: 214, orphan_discovery_hits: 0 },
    message: "Ingestion finished",
    reason: "Coverage is not clean; see warnings.",
  });
  return steps;
}
