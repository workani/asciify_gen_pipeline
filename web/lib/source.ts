"use client";

/* Feeds the model and paces re-renders.

   Events can arrive thousands per second, so nothing here re-renders per event:
   the model accumulates, and a bounded tick publishes a snapshot — the same
   contract the terminal dashboard uses. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MinerEvent } from "./events";
import { demoTimeline } from "./demo";
import { RunModel, RunSnapshot } from "./state";

export type Connection = "connecting" | "open" | "closed" | "error" | "demo";
export type FeedMode = "live" | "demo";

const FRAME_MS = 100;

/** Same-origin when the Python bridge serves the built site; overridable with
    ?events= or NEXT_PUBLIC_MINER_EVENTS for `next dev` against a running bridge. */
export function resolveFeedUrl(): string {
  if (typeof window === "undefined") return "/events";
  const override = new URLSearchParams(window.location.search).get("events");
  if (override) return override;
  const configured = process.env.NEXT_PUBLIC_MINER_EVENTS;
  if (configured) return configured;
  // A dev server on another port cannot serve the stream itself.
  if (window.location.port && window.location.port !== "8787") {
    return `${window.location.protocol}//${window.location.hostname}:8787/events`;
  }
  return "/events";
}

export interface Feed {
  snapshot: RunSnapshot;
  connection: Connection;
  restart: () => void;
}

export function useRunFeed(mode: FeedMode): Feed {
  const model = useMemo(() => new RunModel(), []);
  const [snapshot, setSnapshot] = useState<RunSnapshot>(() => model.snapshot());
  const [connection, setConnection] = useState<Connection>(
    mode === "demo" ? "demo" : "connecting",
  );
  const [epoch, setEpoch] = useState(0);
  const seen = useRef(-1);

  const restart = useCallback(() => {
    model.reset();
    seen.current = -1;
    setEpoch((n) => n + 1);
  }, [model]);

  // Publish at a bounded rate. While a run is live the elapsed clock moves on
  // its own, so a tick with no new events still needs to paint.
  useEffect(() => {
    let frame = 0;
    const id = window.setInterval(() => {
      const live = model.version !== seen.current;
      const running = model.runStatus === "starting" || model.runStatus === "running";
      if (!live && !running && frame > 0) return;
      seen.current = model.version;
      frame += 1;
      setSnapshot(model.snapshot());
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [model]);

  useEffect(() => {
    if (mode !== "demo") return undefined;
    const steps = demoTimeline();
    let index = 0;
    let timer = 0;
    const play = () => {
      if (index >= steps.length) return;
      const step = steps[index];
      index += 1;
      model.apply(step.event);
      const next = steps[index];
      timer = window.setTimeout(play, next ? next.wait : 0);
    };
    timer = window.setTimeout(play, steps[0]?.wait ?? 0);
    return () => window.clearTimeout(timer);
  }, [mode, model, epoch]);

  useEffect(() => {
    if (mode !== "live") return undefined;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return undefined;
    setConnection("connecting");
    const source = new EventSource(resolveFeedUrl());
    source.onopen = () => setConnection("open");
    source.onmessage = (message) => {
      for (const line of String(message.data).split("\n")) {
        if (!line.trim()) continue;
        try {
          model.apply(JSON.parse(line) as MinerEvent);
        } catch {
          /* a partial or non-JSON line is data, not a reason to stop */
        }
      }
    };
    source.addEventListener("done", () => {
      setConnection("closed");
      source.close();
    });
    source.onerror = () => setConnection((c) => (c === "open" ? "error" : "connecting"));
    return () => source.close();
  }, [mode, model, epoch]);

  return { snapshot, connection, restart };
}
