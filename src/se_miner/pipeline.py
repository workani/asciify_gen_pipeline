import gzip
import json
from pathlib import PurePosixPath
import time

from .archive import Archive
from .common import MinerError
from .events import (CHECKPOINT, COLLECT_SOURCE, INVENTORY, METRICS, PROGRESS, REPLAY,
                     SITE_COMPLETE, SITE_STARTED, STAGE_COMPLETE, STAGE_SKIPPED,
                     STAGE_STARTED, WORKING, event)
from .filtering import fields_for, search_text
from .storage import encode
from .workers import Classifier
from .xmlrows import parse_rows

TABLES = ("Posts", "Comments", "PostHistory", "PostLinks")
HISTORY_TEXT = {1, 2, 4, 5, 7, 8}
SYNTHETIC_IDS = {1000000001, 1000000010}


def member_table(name):
    base = PurePosixPath(name).name
    return next((table for table in TABLES if base.lower() == (table + ".xml").lower()), None)


def inventory(site, sources, progress=None):
    note = progress or (lambda _event: None)
    host = site.get("site")
    note(event(STAGE_STARTED, site=host, phase="inventory", total=None, unit="tables"))
    if site.get("files"):
        # Open each source to pin identity before any phase is skipped on resume.
        for table, spec in site["files"].items():
            note(event(WORKING, site=host, phase="inventory", note="validating " + table))
            with sources.open(spec): pass
        found = sorted(site["files"])
    else:
        found = []
        with sources.open(site["archive"]) as stream, Archive(stream) as archive:
            for name, regular in archive.members():
                table = member_table(name)
                if regular and table:
                    if table in found: raise MinerError("Duplicate table member in archive: " + table)
                    found.append(table)
                    note(event(WORKING, site=host, phase="inventory", note="found " + table))
        if not {"Posts", "Comments"}.issubset(found):
            raise MinerError("Archive must include Posts.xml and Comments.xml")
    note(event(STAGE_COMPLETE, site=host, phase="inventory", rows=len(found), unit="tables"))
    return found


def scan_table(site, sources, table, callback):
    if site.get("files"):
        spec = site["files"][table]
        with sources.open(spec) as stream:
            if spec.get("compression") == "gzip" or spec["url"].split("?")[0].endswith(".gz"):
                with gzip.GzipFile(fileobj=stream) as decoded:
                    return parse_rows(iter(lambda: decoded.read(65536), b""), callback, table)
            return parse_rows(iter(lambda: stream.read(65536), b""), callback, table)
    with sources.open(site["archive"]) as stream, Archive(stream) as archive:
        for name, regular in archive.members():
            if regular and member_table(name) == table:
                return parse_rows(archive.chunks(), callback, table)
    raise MinerError("Missing table: " + table)


class Pipeline:
    REPORT_INTERVAL = 0.5
    METRICS_INTERVAL = 10.0
    RESOLVE_STEPS = 100000
    CHUNK = 256
    MAX_CHUNK = 2048

    def __init__(self, store, sources, threshold=3, sample_size=100, batch=500, progress=None,
                 stop_after=None, metrics_interval=None, classifier=None):
        self.store, self.sources = store, sources
        self.threshold, self.sample_size, self.batch = threshold, sample_size, batch
        self.progress = progress or (lambda event: None)
        self.stop_after, self.processed = stop_after, 0
        self.metrics_interval = self.METRICS_INTERVAL if metrics_interval is None else metrics_interval
        self.last_metrics = 0.0
        self.classifier = classifier if classifier is not None else Classifier(threshold)
        # Enough rows in flight to keep every worker busy for a fraction of a
        # second, few enough that one flush cannot stall the progress line.
        self.chunk = max(self.CHUNK, min(self.MAX_CHUNK, self.CHUNK * self.classifier.workers))

    def _emit(self, kind, **fields):
        self.progress(event(kind, **fields))

    def emit_metrics(self):
        """Publish current totals immediately; a resumed run already has data."""
        self._metrics(force=True)

    def _metrics(self, force=False):
        """Counting rows is not free, so it happens between transactions and rarely."""
        now = time.monotonic()
        if not force and now - self.last_metrics < self.metrics_interval:
            return
        self.last_metrics = now
        db = self.store.db
        self._emit(METRICS,
                   candidates=db.execute("SELECT COUNT(*) FROM candidates").fetchone()[0],
                   documents=db.execute("SELECT COUNT(*) FROM documents").fetchone()[0],
                   discovery_hits=db.execute("SELECT COUNT(*) FROM hits").fetchone()[0])

    def _heartbeat(self, host, phase, note=None):
        """Liveness for one long statement, on the connection's own thread."""
        state = [time.monotonic()]
        def tick():
            now = time.monotonic()
            if now - state[0] >= self.REPORT_INTERVAL:
                state[0] = now
                self._emit(WORKING, site=host, phase=phase, note=note)
            return 0
        return tick

    def _known_total(self, host, phase):
        """A completed discovery pass counted this exact table under the same pinned
        source, so its ordinal is a real denominator rather than a guess."""
        source = COLLECT_SOURCE.get(phase)
        if not source:
            return None
        checkpoint = self.store.checkpoint(host, source)
        return checkpoint["ordinal"] if checkpoint["complete"] else None

    def scan(self, site, table, phase, apply, prepare=None):
        """`prepare` is the pure half of a row -- the fields a classification
        worker needs, or None for a row this phase does not classify. `apply`
        is the half that owns the database, and only ever runs on this thread,
        in source order."""
        host = site["site"]
        checkpoint = self.store.checkpoint(host, phase)
        if checkpoint["complete"]:
            self._emit(STAGE_SKIPPED, site=host, phase=phase, reason="already complete",
                       rows=checkpoint["ordinal"])
            return
        saved = checkpoint["ordinal"]
        last, pending, last_report = saved, 0, time.monotonic()
        committed = saved
        # Rows are only held back when holding them back buys parallel work. A
        # phase that classifies nothing still reports and commits row by row.
        chunk = self.chunk if prepare is not None and self.classifier.parallel else 1
        queued = []
        self._emit(STAGE_STARTED, site=host, phase=phase, table=table, resumed_from=saved,
                   total=self._known_total(host, phase))

        def record(value, ordinal, verdict):
            nonlocal last, pending, last_report, committed
            if not self.store.db.in_transaction: self.store.begin()
            apply(value, verdict)
            last, pending = ordinal, pending + 1
            self.processed += 1
            if pending >= self.batch or (self.stop_after and self.processed >= self.stop_after):
                self.store.save_checkpoint(host, phase, last)
                self.store.commit()
                pending, committed = 0, last
                self._emit(CHECKPOINT, site=host, phase=phase, rows=last, committed=last,
                           new_rows=self.processed, work_bytes=self.store.budget.used())
                self._metrics()
                last_report = time.monotonic()
                if self.stop_after and self.processed >= self.stop_after:
                    raise MinerError("Requested row limit reached; progress saved, resume without --max-rows")
            elif time.monotonic() - last_report > self.REPORT_INTERVAL:
                self._emit(PROGRESS, site=host, phase=phase, rows=last, committed=committed,
                           new_rows=self.processed)
                last_report = time.monotonic()

        def flush():
            """Classify what is held, then apply the verdicts in source order.
            Ordering is the whole contract: it is what keeps the checkpoint a
            resume replays from identical to the one a serial scan would save."""
            if not queued: return
            batch = list(queued)
            del queued[:]
            for (value, ordinal, _), verdict in zip(batch, self.classifier.map([job for _, _, job in batch])):
                record(value, ordinal, verdict)

        def row(value, ordinal):
            nonlocal last_report
            if ordinal <= saved:
                # Solid archive blocks force decompression replay; report it as
                # replay rather than letting it look like a stalled scan.
                now = time.monotonic()
                if now - last_report > self.REPORT_INTERVAL:
                    last_report = now
                    self._emit(REPLAY, site=host, phase=phase, rows=ordinal, target=saved)
                return
            queued.append((value, ordinal, prepare(value) if prepare is not None else None))
            if len(queued) >= chunk: flush()

        try:
            count = scan_table(site, self.sources, table, row)
            flush()
            if count < saved: raise MinerError("Source contains fewer rows than its checkpoint")
            if not self.store.db.in_transaction: self.store.begin()
            self.store.save_checkpoint(host, phase, count, True)
            self.store.commit()
            self._emit(STAGE_COMPLETE, site=host, phase=phase, rows=count, total=count,
                       committed=count, complete=True, new_rows=self.processed)
            self._metrics(force=True)
        except BaseException:
            self.store.rollback()
            raise

    def run_site(self, site):
        host = site["site"]
        self._emit(SITE_STARTED, site=host)
        tables = inventory(site, self.sources, self.progress)
        missing = [t for t in TABLES if t not in tables]
        self.store.set_meta("tables:" + host, {"present": tables, "missing_optional": missing})
        self._emit(INVENTORY, site=host, tables=tables, missing_optional=missing)

        def job(kind, row):
            role = ("question" if row.get("PostTypeId") == "1" else "answer") if kind == "post" else kind
            return fields_for(kind, row), role

        def discovered(kind, row, result):
            if result["candidate"]:
                self.store.add_hit(host, kind, row, result)
                self.store.sample_accepted(host, kind, row, result, self.sample_size)
            else:
                self.store.sample_rejected(host, kind, row, result, self.sample_size)

        def routable(row):
            """A question or an answer, and not one of the archive's synthetic
            rows. One predicate, so what gets classified and what gets routed
            cannot drift apart."""
            kind = int(row["PostTypeId"])
            return kind if kind in (1, 2) and int(row["Id"]) not in SYNTHETIC_IDS else None

        def posts(row, result):
            kind = routable(row)
            if kind is None: return
            id_ = int(row["Id"])
            qid = id_ if kind == 1 else int(row["ParentId"])
            self.store.db.execute("INSERT OR REPLACE INTO routing VALUES(?,?,?,?)", (host, id_, qid, kind))
            discovered("post", row, result)

        def history(row):
            return job("history", row) if int(row["PostHistoryTypeId"]) in HISTORY_TEXT else None

        self.scan(site, "Posts", "discover_posts", posts,
                  lambda row: job("post", row) if routable(row) else None)
        self.scan(site, "Comments", "discover_comments",
                  lambda row, result: discovered("comment", row, result),
                  lambda row: job("comment", row))
        if "PostHistory" in tables:
            self.scan(site, "PostHistory", "discover_history",
                      lambda row, result: discovered("history", row, result) if result is not None else None,
                      history)
        else:
            self._emit(STAGE_SKIPPED, site=host, phase="discover_history", reason="no PostHistory table")
        if "PostLinks" in tables:
            def link(row):
                if int(row.get("LinkTypeId", 0)) == 3:
                    self.store.db.execute("INSERT OR REPLACE INTO duplicates VALUES(?,?,?,?)", (host, int(row["PostId"]), int(row["RelatedPostId"]), encode(row)))
            self.scan(site, "PostLinks", "discover_duplicates", lambda row, _result: link(row))
        else:
            self._emit(STAGE_SKIPPED, site=host, phase="discover_duplicates", reason="no PostLinks table")

        if not self.store.checkpoint(host, "resolve_threads")["complete"]:
            self._emit(STAGE_STARTED, site=host, phase="resolve_threads", total=None, unit="threads")
            self.store.begin()
            tick = self._heartbeat(host, "resolve_threads", "resolving evidence-bearing threads")
            try:
                self.store.db.set_progress_handler(tick, self.RESOLVE_STEPS)
                self.store.db.execute("""INSERT INTO candidates SELECT h.site,r.qid,MAX(h.score),'signal'
                  FROM hits h JOIN routing r ON r.site=h.site AND r.id=h.post_id
                  WHERE h.site=? GROUP BY h.site,r.qid
                  ON CONFLICT(site,qid) DO UPDATE SET score=MAX(score,excluded.score),origin='signal'""", (host,))
                # Keep duplicate edges as provenance. A linked thread must earn
                # its own evidence before collection; graph reachability is not
                # relevance and can otherwise amplify one false seed indefinitely.
                self.store.save_checkpoint(host, "resolve_threads", 0, True)
                self.store.commit()
            except BaseException:
                self.store.rollback()
                raise
            finally:
                self.store.db.set_progress_handler(None, 0)
            resolved = self.store.db.execute("SELECT COUNT(*) FROM candidates WHERE site=?", (host,)).fetchone()[0]
            self._emit(STAGE_COMPLETE, site=host, phase="resolve_threads", rows=resolved,
                       total=resolved, unit="threads", complete=True)
            self._metrics(force=True)
        else:
            self._emit(STAGE_SKIPPED, site=host, phase="resolve_threads", reason="already complete")

        def collect(kind, row):
            if kind == "post" and (int(row["PostTypeId"]) not in (1, 2) or int(row["Id"]) in SYNTHETIC_IDS): return
            if kind == "history" and int(row["PostHistoryTypeId"]) not in HISTORY_TEXT: return
            post_id = int(row["Id"] if kind == "post" else row["PostId"])
            qid = self.store.candidate_for_post(host, post_id)
            if qid is not None:
                self.store.add_document(host, qid, kind, row, search_text(kind, row))

        self.scan(site, "Posts", "collect_posts", lambda row, _result: collect("post", row))
        self.scan(site, "Comments", "collect_comments", lambda row, _result: collect("comment", row))
        if "PostHistory" in tables:
            self.scan(site, "PostHistory", "collect_history", lambda row, _result: collect("history", row))
        else:
            self._emit(STAGE_SKIPPED, site=host, phase="collect_history", reason="no PostHistory table")
        self.store.begin()
        self.store.save_checkpoint(host, "complete", 0, True)
        self.store.commit()
        self.sources.reclaim()
        self._metrics(force=True)
        self._emit(SITE_COMPLETE, site=host)
