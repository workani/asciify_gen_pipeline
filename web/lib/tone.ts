import type { CSSProperties } from "react";
import type { RunStatus } from "./events";
import type { SiteStatus, StageStatus } from "./state";

export type Tone = "ok" | "info" | "warn" | "err" | "mute";

const CLASS: Record<Exclude<Tone, "mute">, string> = {
  ok: "2",
  info: "3",
  warn: "4",
  err: "5",
};

/** Maps a tone onto the three signal tokens the components read, the same way
    ../httpcodes hands a status class to its own components. */
export function toneVars(tone: Tone): CSSProperties {
  if (tone === "mute") {
    return { "--k": "var(--ink-3)", "--k-soft": "var(--surface)", "--k-line": "var(--line-2)" } as CSSProperties;
  }
  const n = CLASS[tone];
  return {
    "--k": `var(--c${n})`,
    "--k-soft": `var(--c${n}-soft)`,
    "--k-line": `var(--c${n}-line)`,
  } as CSSProperties;
}

export function runTone(status: RunStatus): Tone {
  switch (status) {
    case "complete":
      return "ok";
    case "complete_with_warnings":
    case "paused":
    case "incomplete":
      return "warn";
    case "failed":
      return "err";
    default:
      return "info";
  }
}

export function siteTone(status: SiteStatus | StageStatus): Tone {
  switch (status) {
    case "complete":
      return "ok";
    case "active":
      return "info";
    case "failed":
      return "err";
    default:
      return "mute";
  }
}

export const RUN_LABEL: Record<RunStatus, string> = {
  starting: "starting",
  running: "running",
  paused: "paused",
  complete: "complete",
  complete_with_warnings: "warnings",
  incomplete: "incomplete",
  failed: "failed",
};
