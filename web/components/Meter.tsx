import styles from "./dashboard.module.css";
import { Tone, toneVars } from "@/lib/tone";

interface MeterProps {
  /** 0..1, or null when no trustworthy denominator exists. */
  percent: number | null;
  tone?: Tone;
  small?: boolean;
  label?: string;
}

/** A bar that refuses to invent a position. With no denominator it sweeps
    instead of filling, so "running" never reads as "this far along". */
export function Meter({ percent, tone = "ok", small, label }: MeterProps) {
  const known = percent !== null && percent !== undefined;
  const classes = [styles.meter];
  if (small) classes.push(styles.meterSm);
  if (!known) classes.push(styles.sweep);
  return (
    <div
      className={classes.join(" ")}
      style={toneVars(tone)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(percent * 100) : undefined}
      aria-valuetext={known ? undefined : "in progress, total unknown"}
    >
      {known ? (
        <div className={styles.fill} style={{ width: `${Math.min(100, percent * 100)}%` }} />
      ) : null}
    </div>
  );
}
