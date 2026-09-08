"""Presentation-facing model of one mining run, fed only by structured events.

Never reads SQLite, the manifest, or the filesystem, so a display thread may poll
it at any moment while the mining thread is blocked. All mutation happens under
one lock and `snapshot()` hands back plain data, so a renderer never observes a
half-applied event.
"""
import collections
import threading
import time

from .events import COLLECT_SOURCE, OPTIONAL_PHASES, SITE_PHASES, phase_label

DONE = ("complete", "skipped")
RUNNING_STATES = ("starting", "running")


def _rate(samples, now, window):
    points = [(t, v) for t, v in samples if now - t <= window]
    if len(points) < 2:
        return None
    span = points[-1][0] - points[0][0]
    delta = points[-1][1] - points[0][1]
    if span < 0.25 or delta < 0:
        return None
    return delta / span


class RunState:
    MAX_LOG = 400
    RATE_WINDOW = 6.0
    CHECKPOINT_LOG_INTERVAL = 15.0

    def __init__(self, clock=time.monotonic, wall=time.time):
        self.clock, self.wall = clock, wall
        self.lock = threading.RLock()
        self.started = clock()
        self.started_wall = wall()
        self.finished = None
        self.status = "starting"
        self.release = self.manifest = self.work_dir = None
        self.workers = 1
        self.reason = None
        self.warnings = {}
        self.resumed = False
        self.rows_this_run = 0
        self.sites = {}
        self.order = []
        self.active = None
        self.log = collections.deque(maxlen=self.MAX_LOG)
        self.metrics = {"candidates": 0, "documents": 0, "discovery_hits": 0}
        self.storage = {"used": None, "limit": None}
        self.network = {"requests": 0, "bytes": 0, "last": None, "note": None}
        self.last_event = self.started
        self.stamp = None

    # ---- ingest -------------------------------------------------------

    def apply(self, ev):
        if not isinstance(ev, dict):
            return
        kind = ev.get("event")
        with self.lock:
            self.stamp = ev.get("at")
            handler = getattr(self, "_on_" + kind, None) if kind else None
            if handler is not None:
                handler(ev)
            elif "phase" in ev:
                # Tolerate the untagged progress dicts the pipeline emitted before
                # events existed, so an older caller still drives the display.
                (self._on_stage_complete if ev.get("complete") else self._on_progress)(ev)
            self.last_event = self.clock()

    def _log(self, level, text):
        self.log.append({"at": self.stamp or self.wall(), "level": level, "text": text})

    def _site(self, host):
        site = self.sites.get(host)
        if site is None:
            site = self.sites[host] = {"site": host, "status": "pending", "tables": None,
                                       "missing_optional": [], "planned": list(SITE_PHASES),
                                       "stages": {}, "started": None, "note": None}
            self.order.append(host)
        return site

    def _stage(self, host, phase):
        site = self._site(host)
        stage = site["stages"].get(phase)
        if stage is None:
            stage = site["stages"][phase] = {
                "phase": phase, "label": phase_label(phase), "status": "pending",
                "observed": 0, "committed": 0, "total": None, "unit": "rows",
                "resumed_from": 0, "replayed": 0, "replay_target": 0, "replaying": False,
                "started": None, "committed_at": None, "note": None,
                "samples": collections.deque(maxlen=64), "replay_samples": collections.deque(maxlen=64)}
        return stage

    def _refresh_totals(self, site):
        """A finished discovery pass is the denominator for its collection pass."""
        for phase, source in COLLECT_SOURCE.items():
            origin = site["stages"].get(source)
            if not origin or origin["status"] != "complete" or origin["total"] is None:
                continue
            if phase not in site["planned"]:
                continue
            stage = self._stage(site["site"], phase)
            if stage["total"] is None and stage["status"] != "complete":
                stage["total"] = origin["total"]

    def _on_run_started(self, ev):
        self.release, self.manifest = ev.get("release"), ev.get("manifest")
        self.workers = ev.get("workers") or 1
        self.work_dir = ev.get("work_dir")
        self.storage["limit"] = ev.get("budget_bytes")
        if ev.get("work_bytes") is not None:
            self.storage["used"] = ev["work_bytes"]
        for host in ev.get("sites") or []:
            self._site(host)
        for row in ev.get("checkpoints") or []:
            host, phase = row.get("site"), row.get("phase")
            if host is None or host not in self.sites:
                continue
            if phase == "complete":
                if row.get("complete"):
                    self._site(host)["status"] = "complete"
                continue
            if phase not in SITE_PHASES:
                continue
            stage = self._stage(host, phase)
            stage["observed"] = stage["committed"] = stage["resumed_from"] = row.get("ordinal") or 0
            if row.get("complete"):
                stage["status"], stage["total"] = "complete", stage["observed"]
                stage["note"] = "completed in an earlier run"
                self.resumed = True
            elif stage["observed"]:
                self.resumed = True
        for site in self.sites.values():
            self._refresh_totals(site)
        self.status = "running"
        self._log("info", ("Resuming run of %s from saved checkpoints" if self.resumed
                           else "Starting run of %s") % (self.release or "manifest"))

    def _on_site_started(self, ev):
        site = self._site(ev["site"])
        site["started"] = self.clock()
        if site["status"] != "complete":
            site["status"] = "active"
        self._log("info", "Site %s" % site["site"])

    def _on_inventory(self, ev):
        site = self._site(ev["site"])
        site["tables"] = list(ev.get("tables") or [])
        missing = list(ev.get("missing_optional") or [])
        site["missing_optional"] = missing
        site["planned"] = [p for p in SITE_PHASES if OPTIONAL_PHASES.get(p) not in missing]
        self._refresh_totals(site)
        self._log("info", "%s tables: %s" % (site["site"], ", ".join(site["tables"]) or "none"))
        if missing:
            self._log("warn", "%s has no %s; those stages are skipped" % (site["site"], ", ".join(missing)))

    def _on_stage_started(self, ev):
        stage = self._stage(ev["site"], ev["phase"])
        stage["status"] = "active"
        stage["started"] = self.clock()
        stage["resumed_from"] = ev.get("resumed_from") or 0
        stage["observed"] = stage["committed"] = stage["resumed_from"]
        if ev.get("total") is not None:
            stage["total"] = ev["total"]
        stage["unit"] = ev.get("unit", stage["unit"])
        stage["replay_target"] = stage["resumed_from"]
        stage["replaying"] = bool(stage["resumed_from"])
        stage["samples"].clear()
        stage["replay_samples"].clear()
        self.network["note"] = None
        self.active = (ev["site"], ev["phase"])
        if stage["resumed_from"]:
            self._log("info", "%s on %s: resuming after row %s; replaying the source to reach it"
                      % (stage["label"], ev["site"], "{:,}".format(stage["resumed_from"])))
        else:
            self._log("info", "%s on %s" % (stage["label"], ev["site"]))

    def _on_stage_skipped(self, ev):
        stage = self._stage(ev["site"], ev["phase"])
        reason = ev.get("reason") or "skipped"
        if reason == "already complete":
            stage["status"], stage["note"] = "complete", "completed in an earlier run"
            stage["observed"] = stage["committed"] = ev.get("rows") or stage["observed"]
            stage["total"] = stage["observed"]
            self._refresh_totals(self._site(ev["site"]))
            self._log("info", "%s on %s already complete; skipping" % (stage["label"], ev["site"]))
        else:
            stage["status"], stage["note"] = "skipped", reason
            self._log("info", "%s on %s skipped (%s)" % (stage["label"], ev["site"], reason))

    def _on_replay(self, ev):
        stage = self._stage(ev["site"], ev["phase"])
        stage["replaying"] = True
        stage["replayed"] = ev.get("rows") or 0
        if ev.get("target"):
            stage["replay_target"] = ev["target"]
        stage["replay_samples"].append((self.clock(), stage["replayed"]))
        self.active = (ev["site"], ev["phase"])

    def _on_progress(self, ev):
        stage = self._stage(ev["site"], ev["phase"])
        if stage["status"] not in ("active",):
            stage["status"] = "active"
        stage["replaying"] = False
        stage["observed"] = ev.get("rows") or 0
        if ev.get("committed") is not None:
            stage["committed"] = ev["committed"]
        if ev.get("total") is not None:
            stage["total"] = ev["total"]
        if ev.get("new_rows") is not None:
            self.rows_this_run = ev["new_rows"]
        if ev.get("work_bytes") is not None:
            self.storage["used"] = ev["work_bytes"]
        stage["samples"].append((self.clock(), stage["observed"]))
        self.active = (ev["site"], ev["phase"])

    def _on_checkpoint(self, ev):
        self._on_progress(ev)
        stage = self._stage(ev["site"], ev["phase"])
        stage["committed"] = ev.get("committed", ev.get("rows") or 0)
        stage["committed_at"] = self.wall()
        now = self.clock()
        # One line per checkpoint would drown the log; the display already shows
        # the live committed ordinal, so the log only needs a periodic anchor.
        if now - (stage.get("logged_at") or 0) >= self.CHECKPOINT_LOG_INTERVAL:
            stage["logged_at"] = now
            self._log("info", "Checkpoint %s on %s at row %s"
                      % (stage["label"].lower(), ev["site"], "{:,}".format(stage["committed"])))

    def _on_working(self, ev):
        stage = self._stage(ev["site"], ev["phase"])
        stage["status"] = "active"
        if ev.get("note"):
            stage["note"] = ev["note"]
        self.active = (ev["site"], ev["phase"])

    def _on_stage_complete(self, ev):
        stage = self._stage(ev["site"], ev["phase"])
        rows = ev.get("rows") or 0
        stage["status"] = "complete"
        stage["observed"] = stage["committed"] = rows
        stage["total"] = ev.get("total", rows)
        stage["unit"] = ev.get("unit", stage["unit"])
        stage["replaying"] = False
        stage["committed_at"] = self.wall()
        self.network["note"] = None
        if ev.get("new_rows") is not None:
            self.rows_this_run = ev["new_rows"]
        self._refresh_totals(self._site(ev["site"]))
        self._log("info", "%s on %s complete: %s %s"
                  % (stage["label"], ev["site"], "{:,}".format(rows), stage["unit"]))

    def _on_site_complete(self, ev):
        site = self._site(ev["site"])
        site["status"] = "complete"
        self._log("info", "Finished %s" % site["site"])

    def _on_site_failed(self, ev):
        site = self._site(ev["site"])
        site["status"] = "failed"
        site["note"] = ev.get("message")
        self._log("error", "%s failed: %s" % (site["site"], ev.get("message") or "unknown error"))

    def _on_source(self, ev):
        action, url = ev.get("action"), ev.get("url")
        note = ev.get("note") or action
        self.network["note"] = note
        if ev.get("done") is not None:
            self.network["progress"] = (ev.get("done"), ev.get("total"))
        if ev.get("quiet"):
            return
        # A full archive URL eats the whole log line; its filename identifies it.
        short = str(url).rsplit("/", 1)[-1] if url else ""
        self._log("info", ("%s %s" % (note, short)) if short else str(note))

    def _on_network(self, ev):
        self.network["requests"] += ev.get("requests") or 0
        self.network["bytes"] += ev.get("bytes") or 0
        self.network["last"] = self.clock()
        # Successful traffic clears a stale "retrying" note; it is no longer true.
        self.network["note"] = ev.get("note")

    def _on_retry(self, ev):
        delay, attempt, attempts = ev.get("delay"), ev.get("attempt"), ev.get("attempts")
        detail = "HTTP %s" % ev["status"] if ev.get("status") else (ev.get("error") or "no response")
        self.network["note"] = "retrying in %ss" % delay
        self._log("warn", "Source retry %s/%s after %s; waiting %ss"
                  % (attempt, attempts, detail, delay))

    def _on_metrics(self, ev):
        for key in self.metrics:
            if ev.get(key) is not None:
                self.metrics[key] = ev[key]
        if ev.get("work_bytes") is not None:
            self.storage["used"] = ev["work_bytes"]
        if ev.get("budget_bytes") is not None:
            self.storage["limit"] = ev["budget_bytes"]

    def _on_log(self, ev):
        self._log(ev.get("level", "info"), ev.get("message", ""))

    def _on_run_finished(self, ev):
        self.status = ev.get("status") or "complete"
        self.finished = self.clock()
        self.reason = ev.get("reason")
        self.warnings = ev.get("warnings") or {}
        level = "error" if self.status in ("failed",) else "warn" if self.status == "paused" else "info"
        self._log(level, ev.get("message") or self.status)

    # ---- read ---------------------------------------------------------

    def _stage_view(self, stage, now):
        total, observed = stage["total"], stage["observed"]
        view = {k: stage[k] for k in ("phase", "label", "status", "observed", "committed", "total",
                                      "unit", "resumed_from", "replayed", "replay_target",
                                      "replaying", "note", "committed_at")}
        view["elapsed"] = (now - stage["started"]) if stage["started"] else 0.0
        view["new_rows"] = max(0, observed - stage["resumed_from"])
        view["rate"] = _rate(stage["samples"], now, self.RATE_WINDOW)
        view["replay_rate"] = _rate(stage["replay_samples"], now, self.RATE_WINDOW)
        view["percent"] = None
        view["eta"] = None
        if stage["replaying"]:
            target = stage["replay_target"]
            if target:
                view["percent"] = min(1.0, stage["replayed"] / target)
            if view["replay_rate"]:
                view["eta"] = max(0.0, (target - stage["replayed"]) / view["replay_rate"])
        elif total:
            view["percent"] = min(1.0, observed / total)
            if view["rate"] and stage["status"] == "active":
                view["eta"] = max(0.0, (total - observed) / view["rate"])
        return view

    def snapshot(self):
        with self.lock:
            now = self.clock()
            sites, done_stages, total_stages, done_sites = [], 0, 0, 0
            for host in self.order:
                site = self.sites[host]
                planned = site["planned"]
                finished = sum(1 for p in planned
                               if (site["stages"].get(p) or {}).get("status") in DONE)
                done_stages += finished
                total_stages += len(planned)
                if site["status"] == "complete":
                    done_sites += 1
                current = next((site["stages"][p] for p in planned
                                if (site["stages"].get(p) or {}).get("status") == "active"), None)
                sites.append({"site": host, "status": site["status"], "done": finished,
                              "planned": len(planned), "missing_optional": list(site["missing_optional"]),
                              "note": site["note"],
                              "stage": current["label"] if current else None})
            active = None
            if self.active:
                host, phase = self.active
                stage = self.sites.get(host, {}).get("stages", {}).get(phase)
                if stage is not None:
                    active = {"site": host, **self._stage_view(stage, now)}
            elapsed = (self.finished or now) - self.started
            return {"release": self.release, "manifest": self.manifest, "work_dir": self.work_dir,
                    "workers": self.workers,
                    "status": self.status, "elapsed": elapsed, "started_wall": self.started_wall,
                    "reason": self.reason, "warnings": dict(self.warnings), "resumed": self.resumed,
                    "rows_this_run": self.rows_this_run, "sites": sites, "active": active,
                    "overall": {"stages": done_stages, "stages_total": total_stages,
                                "sites": done_sites, "sites_total": len(self.order)},
                    "metrics": dict(self.metrics), "storage": dict(self.storage),
                    "network": dict(self.network), "idle": now - self.last_event,
                    "log": list(self.log)}
