import styles from "./dashboard.module.css";
import type { StageStatus } from "@/lib/state";

const SEG: Partial<Record<StageStatus, string>> = {
  complete: styles.segDone,
  active: styles.segActive,
  skipped: styles.segSkip,
  failed: styles.segFail,
};

/** One segment per planned stage. Discrete marks, so the eye reads counted
    work rather than an estimated fraction of the whole job. */
export function StageStrip({
  phases,
  className,
}: {
  phases: { phase: string; label: string; status: StageStatus }[];
  className?: string;
}) {
  return (
    <div className={className ?? styles.group}>
      {phases.map((p) => (
        <span
          key={p.phase}
          className={`${styles.seg} ${SEG[p.status] ?? ""}`}
          title={`${p.label} — ${p.status}`}
        />
      ))}
    </div>
  );
}
