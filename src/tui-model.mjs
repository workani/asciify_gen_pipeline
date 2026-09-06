export const PIPELINE_STAGES = Object.freeze([
  { id: "records", key: "b", label: "Search records", hint: "description, properties and fresh review" },
  { id: "blind_ground", key: "g", label: "Blind ground", hint: "see the glyph without identity" },
  { id: "enrich", key: "e", label: "Enrich", hint: "add identity, usage, and culture" },
  { id: "contrast", key: "c", label: "Contrast", hint: "distinguish the top five confusions" },
  { id: "verify", key: "v", label: "Verify", hint: "challenge every generated claim" },
  { id: "rewrite", key: "w", label: "Rewrite", hint: "repair rejected aliases" },
  { id: "reverify", key: "z", label: "Reverify", hint: "challenge every repaired alias again" },
  { id: "recover", key: "d", label: "Recover", hint: "identify the target from claims alone" },
  { id: "synth", key: "s", label: "Synthesize", hint: "generate human search language" },
  { id: "roundtrip", key: "r", label: "Round-trip", hint: "measure current retrieval" },
  { id: "adjudicate", key: "a", label: "Adjudicate", hint: "rank confusable candidates" },
]);

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

export function formatCount(value) {
  const count = Number(value) || 0;
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}m`;
  return `${(count / 1_000_000_000).toFixed(1)}b`;
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function latestStageCounts(checkpoints, stageId) {
  const versions = checkpoints?.[stageId]?.versions ?? {};
  const keys = Object.keys(versions);
  return keys.length ? versions[keys.at(-1)] : {};
}

export function stageProgress(checkpoints, stageId, selectedTotal = 0) {
  const counts = latestStageCounts(checkpoints, stageId);
  const passed = Number(counts.passed ?? 0);
  const quarantined = Number(counts.quarantined ?? 0);
  const failed = Number(counts.failed ?? 0);
  const running = Number(counts.running ?? 0);
  const stale = Number(counts.stale ?? 0);
  const touched = passed + quarantined + failed + running + stale;
  const total = Math.max(Number(selectedTotal) || 0, touched);
  const complete = passed + quarantined;
  return {
    counts,
    passed,
    quarantined,
    failed,
    running,
    stale,
    touched,
    // Retrying a failed/quarantined row must not make the dashboard's
    // processed count fall when that row transitions back to `running`.
    processed: touched,
    total,
    complete,
    percent: total ? (complete / total) * 100 : 0,
    processedPercent: total ? (touched / total) * 100 : 0,
  };
}

export function progressBar(percent, width = 18) {
  const safeWidth = Math.max(3, Math.floor(width));
  const filled = Math.round((clamp(percent, 0, 100) / 100) * safeWidth);
  return `${"━".repeat(filled)}${"─".repeat(safeWidth - filled)}`;
}

export function compactScope(scope, max = 58) {
  let value;
  if (typeof scope === "string") value = scope;
  else if (scope?.query) value = `“${scope.query}”`;
  else if (Array.isArray(scope?.entities)) value = `${scope.entities.length} entities · ${scope.entities.slice(0, 2).join(", ")}`;
  else value = scope ? JSON.stringify(scope) : "awaiting work";
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
}

export function sanitizeStream(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\t/g, "  ");
}

export class WorkerRegistry {
  constructor(size = 4, maxChars = 120_000) {
    this.size = clamp(size, 1, 16);
    this.maxChars = maxChars;
    this.byId = new Map();
    this.slots = Array.from({ length: this.size }, (_, index) => ({
      index,
      id: null,
      stage: null,
      scope: null,
      sessionId: null,
      rawFile: null,
      startedAt: null,
      finishedAt: null,
      status: "idle",
      text: "",
      apiRaw: "",
      apiEvents: 0,
      lastEventAt: null,
      firstTokenAt: null,
      tokensIn: 0,
      tokensOut: 0,
      error: null,
    }));
  }

  start(data, now = Date.now()) {
    const existing = this.byId.get(data.id);
    const slot = existing ?? this.slots.find((candidate) => candidate.status !== "running") ?? this.slots[0];
    if (slot.id) this.byId.delete(slot.id);
    Object.assign(slot, {
      id: data.id,
      stage: data.stage,
      scope: data.scope,
      sessionId: data.sessionId ?? null,
      rawFile: data.rawFile ?? null,
      startedAt: now,
      finishedAt: null,
      status: "running",
      text: "",
      apiRaw: "",
      apiEvents: 0,
      lastEventAt: now,
      firstTokenAt: null,
      tokensIn: 0,
      tokensOut: 0,
      error: null,
    });
    this.byId.set(data.id, slot);
    return slot;
  }

  text(data) {
    const slot = this.byId.get(data.id);
    if (!slot) return null;
    slot.text = `${slot.text}${sanitizeStream(data.delta)}`.slice(-this.maxChars);
    slot.apiEvents++;
    slot.lastEventAt = Date.now();
    slot.firstTokenAt ??= slot.lastEventAt;
    return slot;
  }

  api(data) {
    const slot = this.byId.get(data.id);
    if (!slot) return null;
    const raw = sanitizeStream(data.raw);
    if (raw) slot.apiRaw = `${slot.apiRaw}${slot.apiRaw ? "\n" : ""}${raw}`.slice(-24_000);
    slot.apiEvents++;
    slot.lastEventAt = Date.now();
    if (data.sessionId) slot.sessionId = data.sessionId;
    return slot;
  }

  error(data) {
    const slot = this.byId.get(data.id);
    if (!slot) return null;
    slot.error = sanitizeStream(data.err).slice(-2_000);
    return slot;
  }

  done(data, now = Date.now()) {
    const slot = this.byId.get(data.id);
    if (!slot) return null;
    Object.assign(slot, {
      status: data.ok ? "done" : "failed",
      finishedAt: now,
      tokensIn: Number(data.tokensIn ?? 0),
      tokensOut: Number(data.tokensOut ?? 0),
      error: data.ok ? null : sanitizeStream(data.error ?? slot.error ?? "worker failed").slice(-2_000),
    });
    return slot;
  }

  active() {
    return this.slots.filter((slot) => slot.status === "running");
  }
}
