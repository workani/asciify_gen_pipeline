/* Decimal units throughout: the miner's budget is expressed in decimal GB. */

export function humanBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  let n = value;
  const units = ["B", "kB", "MB", "GB", "TB"];
  for (let i = 0; i < units.length; i += 1) {
    if (Math.abs(n) < 1000 || i === units.length - 1) {
      return i === 0 ? `${Math.round(n)} B` : `${n.toFixed(1)} ${units[i]}`;
    }
    n /= 1000;
  }
  return `${n} B`;
}

export function humanCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Math.round(value).toLocaleString("en-US");
}

/** Compact form for figures that sit beside a label rather than in a readout. */
export function shortCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Math.round(value);
  if (Math.abs(n) < 10_000) return n.toLocaleString("en-US");
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  if (Math.abs(n) < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function humanDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  const stamp = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return days ? `${days}d ${stamp}` : stamp;
}

export function humanRate(rate: number | null | undefined, unit = "rows"): string {
  if (!rate) return `— ${unit}/s`;
  if (rate >= 1000) return `${shortCount(rate)} ${unit}/s`;
  return `${rate.toFixed(1)} ${unit}/s`;
}

/** A remaining-time reading. "00:00:00" for a third of a second reads as a
    fault, so short spans say so plainly and long ones stay compact. */
export function compactDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 1) return "<1s";
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const restSeconds = total % 60;
  if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function clockTime(wallSeconds: number): string {
  const d = new Date(wallSeconds * 1000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Keep the tail of a path — the filename is what identifies it. */
export function tailPath(value: string | null | undefined, max = 40): string {
  if (!value) return "";
  if (value.length <= max) return value;
  const base = value.split("/").pop() ?? value;
  return base.length <= max ? base : `…${base.slice(-(max - 1))}`;
}
