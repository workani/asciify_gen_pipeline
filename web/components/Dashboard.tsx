"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./dashboard.module.css";
import { Meter } from "./Meter";
import { StageStrip } from "./StageStrip";
import type { Connection } from "@/lib/source";
import type { RunSnapshot } from "@/lib/state";
import { RUN_LABEL, runTone, siteTone, toneVars } from "@/lib/tone";
import {
  clockTime,
  compactDuration,
  humanBytes,
  humanCount,
  humanDuration,
  humanRate,
} from "@/lib/format";

interface Props {
  snapshot: RunSnapshot;
  connection: Connection;
  title?: string;
  onRestart?: () => void;
}

const STALE_AFTER = 10;

export function Dashboard({ snapshot: s, connection, title = "Miner", onRestart }: Props) {
  const running = s.status === "running" || s.status === "starting";
  // A run that has stopped producing events is not a run you are watching.
  // Saying so beats showing a frozen frame that looks live.
  const stale = running && s.idle > STALE_AFTER;
  const empty = s.overall.sitesTotal === 0;
  const tone = stale ? "warn" : runTone(s.status);
  const live = running && !stale;
  const ident = [s.release, s.manifest, s.workDir].filter(Boolean) as string[];
  const storage =
    s.storage.used !== null && s.storage.limit
      ? Math.min(1, s.storage.used / s.storage.limit)
      : null;
  const flagged = Object.entries(s.warnings).filter(([, v]) => v);
  const netLive = s.network.last !== null && s.idle < 2;

  return (
    <div className={styles.shell}>
      <header className={`${styles.top} ${styles.pad}`}>
        <div className={styles.inner}>
          <div className={styles.topRow}>
            <div className={styles.mark} style={toneVars(tone)}>
              <span className={`${styles.blip} ${live ? styles.blipLive : ""}`} />
              <span className={styles.title}>{title}</span>
            </div>
            <div className={styles.readouts}>
              <time className={styles.clock}>{humanDuration(s.elapsed)}</time>
              <span className={styles.state} style={toneVars(tone)}>
                {RUN_LABEL[s.status]}
              </span>
            </div>
            <div className={styles.tools}>
              {onRestart ? (
                <button className={styles.tool} onClick={onRestart} title="Replay">
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="srOnly">Replay the demo run</span>
                </button>
              ) : null}
              <Link
                className={styles.tool}
                href={onRestart ? "/" : "/demo"}
                title={onRestart ? "Live run" : "Demo run"}
              >
                <svg viewBox="0 0 24 24" aria-hidden>
                  {onRestart ? (
                    <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" strokeLinecap="round" />
                  ) : (
                    <path d="M8 5v14l11-7z" strokeLinejoin="round" />
                  )}
                </svg>
                <span className="srOnly">{onRestart ? "Switch to the live run" : "Watch a demo run"}</span>
              </Link>
            </div>
          </div>
          {(ident.length || connection !== "open" || stale || empty) && (
            <div className={styles.ident}>
              {ident.map((value) => (
                <span key={value} className={styles.identItem} title={value}>
                  {value}
                </span>
              ))}
              {stale && (
                <span className={`${styles.identItem} ${styles.identWarn}`}>
                  no events for {compactDuration(s.idle)}
                </span>
              )}
              {empty && connection === "open" && (
                <span className={styles.identItem}>waiting for a run</span>
              )}
              {connection === "connecting" && <span className={styles.identItem}>connecting…</span>}
              {connection === "error" && <span className={styles.identItem}>stream lost</span>}
              {connection === "closed" && <span className={styles.identItem}>stream ended</span>}
            </div>
          )}
        </div>
      </header>

      <section className={`${styles.section} ${styles.pad}`}>
        <div className={styles.inner}>
          <div className={styles.overall}>
            <div
              className={styles.groups}
              title={`${s.overall.stages} of ${s.overall.stagesTotal} stages, ${s.overall.sites} of ${s.overall.sitesTotal} sites complete`}
            >
              {s.sites.length ? (
                s.sites.map((site) => <StageStrip key={site.site} phases={site.phases} />)
              ) : (
                <span className={styles.seg} />
              )}
            </div>
            {/* Counted stages, never an estimate of processing time or bytes. */}
            <div className={styles.tally}>
              {s.overall.stages}
              <span className={styles.tallySub}>/{s.overall.stagesTotal}</span>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.pad}`}>
        <div className={`${styles.inner} ${styles.grid}`}>
          <ActiveStage snapshot={s} />
          <div className={styles.stack}>
            <div className={styles.sites}>
              {s.sites.map((site) => (
                <div key={site.site} className={styles.site} style={toneVars(siteTone(site.status))}>
                  <span className={`${styles.blip} ${site.status === "active" ? styles.blipLive : ""}`} />
                  <span
                    className={`${styles.siteName} ${site.status !== "pending" ? styles.siteOn : ""}`}
                    title={site.site}
                  >
                    {site.site}
                  </span>
                  <StageStrip phases={site.phases} className={styles.siteBar} />
                  {site.status === "active" && site.stage ? (
                    <span className={styles.siteStage}>{site.stage}</span>
                  ) : null}
                  {site.missingOptional.length ? (
                    <span className={styles.siteStage}>no {site.missingOptional.join(", ")}</span>
                  ) : null}
                </div>
              ))}
            </div>

            <div>
              <div className={styles.stats}>
                <Stat value={s.metrics.candidates} label="candidates" />
                <Stat value={s.metrics.documents} label="documents" />
                <Stat value={s.metrics.discoveryHits} label="hits" />
              </div>

              <div className={styles.gauge}>
                <div className={styles.gaugeRow}>
                  <span>{humanBytes(s.storage.used)}</span>
                  <span className={styles.gaugeCap}>{humanBytes(s.storage.limit)}</span>
                </div>
                <Meter
                  percent={storage}
                  small
                  tone={storage === null ? "mute" : storage > 0.95 ? "err" : storage > 0.8 ? "warn" : "ok"}
                  label="Working storage against the configured budget"
                />
              </div>

              {/* Bytes moved, never completion: archives are read repeatedly. */}
              <div className={styles.gauge}>
                <div className={styles.net}>
                  <span className={styles.blip} style={toneVars(netLive ? "ok" : "mute")} />
                  <span>{humanCount(s.network.requests)} req</span>
                  <span className={styles.gaugeCap}>{humanBytes(s.network.bytes)}</span>
                  {s.network.note ? (
                    <span
                      className={
                        /retry|retrying/i.test(s.network.note) ? styles.netWarn : styles.netNote
                      }
                    >
                      {s.network.note}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {s.reason || flagged.length ? (
              <div className={styles.banner} style={toneVars(tone)}>
                <span className={styles.blip} />
                <div className={styles.bannerBody}>
                  {s.reason ? <p>{s.reason}</p> : null}
                  {flagged.length ? (
                    <p className={styles.warnings}>
                      {flagged.map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <LogFeed entries={s.log} />
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{humanCount(value)}</span>
      <span className={`label ${styles.statLabel}`}>{label}</span>
    </div>
  );
}

function ActiveStage({ snapshot: s }: { snapshot: RunSnapshot }) {
  const a = s.active;
  if (!a) {
    return (
      <div>
        <p className={styles.idle}>
          {s.status === "starting" ? "Starting up…" : "No stage running"}
        </p>
      </div>
    );
  }

  const replaying = a.replaying;
  const known = replaying ? a.replayTarget > 0 : Boolean(a.total);
  const counted = replaying ? a.replayed : a.observed;
  const denominator = replaying ? a.replayTarget : a.total;
  const rate = replaying ? a.replayRate : a.rate;
  const waiting = !replaying && !a.observed;

  return (
    <div>
      <div className={styles.stageHead}>
        <span className={styles.stageSite} title={a.site}>
          {a.site}
        </span>
        <h2 className={styles.stageName}>{a.label}</h2>
        {replaying ? <span className={styles.tag}>replay</span> : null}
      </div>

      <Meter
        percent={known ? a.percent : null}
        tone={replaying ? "warn" : "info"}
        label={a.label}
      />

      {waiting ? (
        <p className={styles.foot}>{a.note ?? s.network.note ?? "working"}</p>
      ) : (
        <>
          <div className={styles.readout}>
            {known ? (
              <>
                <span className={styles.big}>{((a.percent ?? 0) * 100).toFixed(1)}%</span>
                <span className={styles.of}>
                  {humanCount(counted)} / {humanCount(denominator)}
                </span>
              </>
            ) : (
              <>
                {/* No denominator exists, so the count is the headline. */}
                <span className={styles.big}>{humanCount(counted)}</span>
                <span className={styles.of}>{a.unit}</span>
              </>
            )}
            {rate ? (
              <span className={`${styles.aside} ${styles.push}`}>
                {humanRate(rate, a.unit)}
                {a.eta !== null ? (
                  <>
                    <span className={styles.sep}>·</span>
                    <span className={styles.etaTag}>eta</span> {compactDuration(a.eta)}
                  </>
                ) : null}
              </span>
            ) : null}
          </div>

          {a.unit === "rows" ? (
            <div className={styles.foot}>
              <span>committed {humanCount(a.committed)}</span>
              {a.committedAt ? <span>{clockTime(a.committedAt)}</span> : null}
              <span>+{humanCount(s.rowsThisRun)} this run</span>
              {a.note ? <span>{a.note}</span> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function LogFeed({ entries }: { entries: RunSnapshot["log"] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const node = box.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [entries]);

  return (
    <div className={`${styles.logWrap} ${styles.pad}`}>
      <div
        className={`${styles.inner} ${styles.log}`}
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        <div className={styles.logList}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`${styles.line} ${entry.level === "warn" ? styles.warn : ""} ${
              entry.level === "error" ? styles.error : ""
            }`}
          >
            <span className={styles.lineAt}>{clockTime(entry.at)}</span>
            <span className={styles.lineText}>{entry.text}</span>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
