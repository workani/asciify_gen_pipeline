import argparse
import json
import shlex
import signal
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import quote

from . import dashboard, uistate
from .common import Budget, MinerError, SpaceLimit, allowed_site, load_manifest
from .events import (CHECKPOINT, LOG, METRICS, NETWORK, PROGRESS, REPLAY, RUN_FINISHED,
                     RUN_STARTED, WORKING, event)
from .filtering import RULE_HASH, VERSION
from .inspection import export_rows, report, search
from .pipeline import Pipeline, inventory
from .storage import Store, encode, read_db, thread, writer_lock
from .transport import Sources, request
from . import searchindex


def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


# Shared so the parser and the resume command can never drift apart.
DEFAULTS = {"work_dir": ".miner-work", "budget_gb": 10.0, "threshold": 3,
            "rejected_sample": 100, "batch": 10000}


def parser():
    p = argparse.ArgumentParser(description="Stream Stack Exchange dumps; preserve and search symbol-identification candidates. No LLM/API post calls.")
    sub = p.add_subparsers(dest="command", required=True)
    for command in ("run", "preflight"):
        s = sub.add_parser(command)
        s.add_argument("manifest")
        s.add_argument("--work-dir", default=DEFAULTS["work_dir"])
        s.add_argument("--budget-gb", type=float, default=DEFAULTS["budget_gb"], help="Decimal GB for archive/cache + candidates/database/journals only")
        s.add_argument("--threshold", type=int, default=DEFAULTS["threshold"])
        s.add_argument("--rejected-sample", type=int, default=DEFAULTS["rejected_sample"], help="Bottom-k sample per site and source kind")
        s.add_argument("--batch", type=int, default=DEFAULTS["batch"], help="Rows per transaction; each commit costs a journal write and fsync regardless of size")
        # Scoping a run is not the same as editing the manifest. Store pins the
        # whole manifest as the directory's contract, so handing it a filtered
        # manifest instead would strand every checkpoint already committed here.
        s.add_argument("--only-site", metavar="HOST", action="append",
                       help="Restrict this run to these manifest sites; repeatable. The manifest and the pinned contract stay untouched, so another machine can mine the remaining sites into its own work directory")
        if command == "run":
            s.add_argument("--max-rows", type=int, help="Bound new rows for an ingestion smoke run; resumable, no model calls")
            s.add_argument("--no-ui", action="store_true", help="Never draw the live dashboard; stream JSON progress events to stderr")
            s.add_argument("--events", metavar="PATH", help="Where to journal progress events for scripts/miner-web.py; defaults to <work-dir>-events.jsonl, outside the storage budget")
            s.add_argument("--no-events", action="store_true", help="Do not journal progress events at all")
    for command in ("status", "search", "thread", "export", "audit"):
        s = sub.add_parser(command)
        s.add_argument("--work-dir", default=".miner-work")
        if command == "search":
            s.add_argument("query")
            s.add_argument("--site")
            s.add_argument("--kind", choices=("post", "comment", "history"))
            s.add_argument("--mode", choices=("auto", "words", "fts", "literal", "codepoint", "sequence"), default="auto")
            s.add_argument("--scope", choices=("relevant", "requests", "review", "all"), default="relevant")
            s.add_argument("--mention", choices=("any", "explicit", "literal"), default="any")
            s.add_argument("--legacy", action="store_true", help="Explicitly use the old per-document search")
            s.add_argument("--limit", type=int, default=30)
            s.add_argument("--offset", type=int, default=0)
            s.add_argument("--min-score", type=int, default=0)
        if command == "thread":
            s.add_argument("site")
            s.add_argument("question_id", type=int)
        if command in ("export", "audit"):
            s.add_argument("--output", required=True, help="JSONL output outside the work directory")
            s.add_argument("--kind", choices=("threads", "rejected"), default="threads")
            if command == "audit": s.add_argument("--sample", type=int, default=200)
            s.add_argument("--allow-partial", action="store_true")
    s = sub.add_parser("reindex", help="Build/resume a local evidence/search projection; no downloads or model calls")
    s.add_argument("--work-dir", default=".miner-work")
    s.add_argument("--budget-gb", type=float, default=10)
    s.add_argument("--batch", type=int, default=10000)
    s.add_argument("--max-documents", type=int)
    s = sub.add_parser("purge", help="Remove one site's mined rows from an existing work directory; reclaims space, downloads nothing")
    s.add_argument("--work-dir", default=".miner-work")
    s.add_argument("--site", required=True, action="append", help="Host to remove; repeatable")
    s.add_argument("--drop-index", action="store_true", help="Also delete the derived search index, which the removal invalidates")
    s.add_argument("--yes", action="store_true", help="Actually delete; without it the command only reports the plan")
    s = sub.add_parser("adopt", help="Re-pin an existing work directory to the current rules, only if the stored samples prove no source changes verdict")
    s.add_argument("--work-dir", default=DEFAULTS["work_dir"])
    s.add_argument("--yes", action="store_true", help="Apply; without it the command only reports the check")
    s = sub.add_parser("catalog", help="Build a manifest from one Internet Archive metadata response; downloads no dumps")
    s.add_argument("--item", default="stackexchange")
    s.add_argument("--release", required=True, help="Explicit snapshot label; inspect catalog dates before running")
    s.add_argument("--sites", help="Comma-separated explicit hosts; defaults to all strict .stackexchange.com hosts")
    s.add_argument("--output", required=True)
    return p


def catalog(args):
    if not all(c.isalnum() or c in "-_" for c in args.item): raise MinerError("Invalid archive item")
    with request("https://archive.org/metadata/" + args.item) as response:
        body = response.read(16 * 1024 * 1024 + 1)
        if len(body) > 16 * 1024 * 1024: raise MinerError("Catalog exceeds bounded metadata size")
    metadata = json.loads(body)
    wanted = set(args.sites.split(",")) if args.sites else None
    if wanted and not all(allowed_site(s) for s in wanted): raise MinerError("Requested site outside strict scope")
    sites = []
    for file in metadata.get("files", []):
        name = file.get("name", "")
        if not name.endswith(".7z"): continue
        host = name[:-3]
        if not allowed_site(host) or (wanted and host not in wanted): continue
        sites.append({"site": host, "archive": {"url": "https://archive.org/download/" + args.item + "/" + quote(name),
                      "catalog_size": int(file.get("size", 0)), "catalog_mtime": file.get("mtime")}})
    if not sites: raise MinerError("No matching site archives found")
    if wanted and wanted != {s["site"] for s in sites}: raise MinerError("Some requested sites are missing from the catalog")
    manifest = {"version": 1, "release": args.release, "catalog": "https://archive.org/metadata/" + args.item, "sites": sorted(sites, key=lambda s: s["site"])}
    path = Path(args.output)
    with path.open("x") as out: out.write(json.dumps(manifest, indent=2) + "\n")
    emit({"manifest": str(path.resolve()), "sites": len(sites), "catalog_bytes": sum(s["archive"]["catalog_size"] for s in sites),
          "note": "Inspect release/source metadata. Catalog presence is not proof of completeness or currentness."})


def select_sites(manifest, wanted):
    """This run's plan, never the pinned contract. Manifest order is preserved."""
    if not wanted:
        return manifest["sites"]
    wanted = list(dict.fromkeys(wanted))
    missing = [host for host in wanted if host not in {site["site"] for site in manifest["sites"]}]
    if missing:
        raise MinerError("--only-site names sites the manifest does not list: " + ", ".join(missing))
    return [site for site in manifest["sites"] if site["site"] in set(wanted)]


def resume_command(args):
    """The exact command that continues this work directory, minus any row bound."""
    parts = ["python3", "scripts/mine.py", "run", args.manifest]
    for flag in ("work_dir", "budget_gb", "threshold", "rejected_sample", "batch"):
        value, default = getattr(args, flag), DEFAULTS[flag]
        flag = "--" + flag.replace("_", "-")
        if value != default:
            parts += [flag, ("%g" % value) if isinstance(value, float) else str(value)]
    if getattr(args, "no_ui", False):
        parts.append("--no-ui")
    if getattr(args, "events", None):
        parts += ["--events", str(args.events)]
    if getattr(args, "no_events", False):
        parts.append("--no-events")
    # Without this, resuming after Ctrl-C would drop the scope and start mining
    # a site this machine was deliberately never meant to touch.
    for host in getattr(args, "only_site", None) or []:
        parts += ["--only-site", host]
    return " ".join(shlex.quote(part) for part in parts)


def journal_path(work_dir):
    """Beside the work directory, never inside it: the budget counts only the
    archive cache and the database, and a log there would corrupt that account."""
    root = Path(work_dir).resolve()
    return root.parent / (root.name + "-events.jsonl")


class Journal:
    """A bounded event log for a live viewer.

    Structural events go through verbatim; the high-frequency ones are sampled,
    because a viewer refreshing ten times a second gains nothing from a line per
    committed batch. Network counters are deltas, so they are summed across a
    gap rather than dropped."""

    SAMPLED = (PROGRESS, REPLAY, CHECKPOINT, WORKING)
    INTERVAL = 0.4

    def __init__(self, path):
        self.handle = open(path, "w", buffering=1)
        self.last = {}
        self.pending = None

    def _emit(self, value):
        try:
            self.handle.write(encode(value) + "\n")
        except (OSError, ValueError):
            pass

    def _flush_network(self):
        if self.pending is not None:
            self._emit(self.pending)
            self.pending = None

    def write(self, value):
        kind, now = value.get("event"), time.monotonic()
        if kind == NETWORK:
            if self.pending is None:
                self.pending = {"event": NETWORK, "requests": 0, "bytes": 0, "at": value.get("at")}
            self.pending["requests"] += value.get("requests") or 0
            self.pending["bytes"] += value.get("bytes") or 0
            self.pending["at"] = value.get("at", self.pending["at"])
            if "note" in value:
                self.pending["note"] = value["note"]
            if now - self.last.get(NETWORK, 0) >= self.INTERVAL:
                self.last[NETWORK] = now
                self._flush_network()
            return
        if kind in self.SAMPLED:
            key = (kind, value.get("site"), value.get("phase"))
            if now - self.last.get(key, 0) < self.INTERVAL:
                return
            self.last[key] = now
        self._flush_network()
        self._emit(value)

    def close(self):
        self._flush_network()
        try:
            self.handle.close()
        except OSError:
            pass


def display_path(value):
    """Prefer the short path the operator actually typed over an absolute one."""
    path = Path(value)
    try:
        relative = str(path.resolve().relative_to(Path.cwd()))
    except (ValueError, OSError):
        return str(path)
    return relative if len(relative) < len(str(path)) else str(path)


def is_pause(error):
    """A bounded stop that saved its work, as opposed to a genuine failure."""
    return isinstance(error, SpaceLimit) or "row limit reached" in str(error)


def ingest(args):
    if args.threshold < 1 or args.batch < 1 or args.rejected_sample < 0:
        raise MinerError("threshold/batch must be positive; rejected sample must be nonnegative")
    live = args.command == "run" and dashboard.ui_available(sys.stderr, getattr(args, "no_ui", False))
    # On by default: a viewer that needs a flag to see the run is a viewer that
    # silently shows a stale one. Truncated per run, so it replays this run only.
    journal = None
    if args.command == "run" and not getattr(args, "no_events", False):
        events_path = getattr(args, "events", None) or journal_path(args.work_dir)
        try:
            journal = Journal(events_path)
        except OSError:
            journal = None
    state = uistate.RunState()
    ui = dashboard.Dashboard(state).start() if live else None
    resume = resume_command(args) if args.command == "run" else None

    def observe(value):
        """Single seam between mining and presentation: state model, or JSON lines."""
        # Stamped at the source so a saved stream replays with real times later.
        value.setdefault("at", time.time())
        state.apply(value)
        if not live:
            print(encode(value), file=sys.stderr, flush=True)
        if journal is not None:
            journal.write(value)

    # Preflight keeps its historic silence on stderr; only `run` is instrumented.
    observer = observe if args.command == "run" else None
    try:
        quiet_report = bool(ui) and sys.stdout.isatty()
    except Exception:
        quiet_report = False
    try:
        try:
            if observer: observer(event(LOG, message="Loading manifest " + str(args.manifest)))
            manifest = load_manifest(args.manifest)
            selected = select_sites(manifest, getattr(args, "only_site", None))
            budget = Budget(args.work_dir, int(args.budget_gb * 1_000_000_000))
            if observer: observer(event(LOG, message="Acquiring the exclusive writer lock"))
            with writer_lock(budget.root):
                store = Store(budget, manifest, {"filter": VERSION, "rule_hash": RULE_HASH, "threshold": args.threshold, "rejected_sample": args.rejected_sample})
                sources = Sources(budget, store.pin, observer=observer)
                try:
                    if args.command == "preflight":
                        result = [{"site": site["site"], "tables": inventory(site, sources)} for site in selected]
                        emit({"sites": result, "work_bytes": budget.used(), "budget_bytes": budget.limit, "transport": sources.stats})
                    else:
                        checkpoints = [dict(r) for r in store.db.execute("SELECT site,phase,ordinal,complete FROM checkpoints")]
                        observe(event(RUN_STARTED, release=manifest["release"],
                                      manifest=display_path(args.manifest),
                                      work_dir=display_path(budget.root),
                                      sites=[s["site"] for s in selected],
                                      budget_bytes=budget.limit, work_bytes=budget.used(),
                                      checkpoints=checkpoints))
                        pipe = Pipeline(store, sources, args.threshold, args.rejected_sample,
                                        args.batch, observe, args.max_rows)
                        # Retained work from earlier runs counts from the first frame.
                        pipe.emit_metrics()
                        for site in selected: pipe.run_site(site)
                        result = report(store.db, budget)
                        result["scope"] = [s["site"] for s in selected]
                        result["transport"] = {k: result["transport"].get(k, 0) + v for k, v in sources.stats.items()}
                        observe(event(RUN_FINISHED, status=result["status"], warnings=result["warnings"],
                                      message="Ingestion finished: " + result["status"],
                                      reason=None if result["status"] == "complete" else
                                      "Coverage is not clean; see warnings." if result["status"] == "complete_with_warnings"
                                      else "Some sites have unfinished phases." if len(selected) == len(manifest["sites"])
                                      else "This run covered only " + ", ".join(result["scope"]) +
                                           "; the directory still lacks the manifest's other sites."))
                        if not quiet_report: emit(result)
                finally:
                    store.rollback()
                    try:
                        previous = store.db.execute("SELECT value FROM meta WHERE key='transport'").fetchone()
                        totals = json.loads(previous[0]) if previous else {}
                        store.begin()
                        store.set_meta("transport", {k: totals.get(k, 0) + v for k, v in sources.stats.items()})
                        store.set_meta("budget_bytes", budget.limit)
                        store.commit()
                    except (MinerError, sqlite3.Error):
                        store.rollback()
                    store.close()
            return 0
        except KeyboardInterrupt:
            if observer:
                observe(event(RUN_FINISHED, status="paused", message="Paused by Ctrl-C",
                              reason="Uncommitted rows were rolled back; the last checkpoint is intact."))
            raise
        except (MinerError, OSError, ValueError, sqlite3.Error) as error:
            if observer:
                observe(event(RUN_FINISHED, status="paused" if is_pause(error) else "failed",
                              message=str(error), reason=str(error)))
            raise
    finally:
        if journal is not None:
            journal.close()
        if ui:
            ui.stop()
            snapshot = state.snapshot()
            tail = resume if snapshot["status"] in ("paused", "incomplete") else None
            print(dashboard.final_summary(snapshot, ui.palette, resume=tail, glyphs=ui.glyphs), file=sys.stderr)
            if quiet_report and snapshot["status"].startswith("complete"):
                print("  full JSON report: rerun with --no-ui, or redirect stdout to a file\n", file=sys.stderr)
            # The summary already carried the reason and the resume command.
            args.reported = True


# Removing a site is deliberate and irreversible, so it reports the plan first
# and only deletes with --yes. Rows are removed per table rather than by
# rebuilding, so the remaining sites' checkpoints and pins stay valid.
PURGE_TABLES = (("hits", "site"), ("candidates", "site"), ("documents", "site"), ("routing", "site"),
                ("duplicates", "site"), ("rejected", "site"), ("accepted", "site"),
                ("checkpoints", "site"))


def purge(args):
    root = Path(args.work_dir).resolve()
    path = root / "candidates.sqlite"
    if not path.exists(): raise MinerError("No mining database at " + str(path))
    sites = list(dict.fromkeys(args.site))
    db = sqlite3.connect(str(path), isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=5000")
    try:
        known = {r[0] for r in db.execute("SELECT DISTINCT site FROM candidates UNION SELECT DISTINCT site FROM checkpoints")}
        unknown = [s for s in sites if s not in known]
        if unknown: raise MinerError("Not present in this work directory: " + ", ".join(unknown))
        plan = {}
        for table, column in PURGE_TABLES:
            marks = ",".join("?" * len(sites))
            plan[table] = db.execute("SELECT COUNT(*) FROM %s WHERE %s IN (%s)" % (table, column, marks), sites).fetchone()[0]
        before = sum(f.stat().st_size for f in root.rglob("*") if f.is_file())
        index = root / searchindex.INDEX_NAME
        result = {"work_dir": str(root), "sites": sites, "rows": plan,
                  "index": {"path": str(index), "exists": index.exists(),
                            "action": "delete" if args.drop_index else "left stale; rebuild with reindex"},
                  "work_bytes_before": before, "applied": bool(args.yes)}
        if not args.yes:
            result["note"] = "Nothing deleted. Re-run with --yes to apply."
            return result
        with writer_lock(root):
            db.execute("BEGIN IMMEDIATE")
            try:
                marks = ",".join("?" * len(sites))
                for table, column in PURGE_TABLES:
                    db.execute("DELETE FROM %s WHERE %s IN (%s)" % (table, column, marks), sites)
                for site in sites:
                    db.execute("DELETE FROM meta WHERE key=?", ("tables:" + site,))
                    db.execute("DELETE FROM source_pins WHERE key LIKE ?", (site + "%",))
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise
            # The contract pins the manifest, so a purged site must leave it too.
            row = db.execute("SELECT value FROM meta WHERE key='contract'").fetchone()
            if row:
                contract = json.loads(row[0])
                manifest = contract.get("manifest", {})
                kept = [s for s in manifest.get("sites", []) if s.get("site") not in sites]
                if len(kept) != len(manifest.get("sites", [])):
                    manifest["sites"] = kept
                    db.execute("UPDATE meta SET value=? WHERE key='contract'", (encode(contract),))
            db.execute("VACUUM")
            if args.drop_index and index.exists(): index.unlink()
        result["remaining_sites"] = sorted({r[0] for r in db.execute("SELECT DISTINCT site FROM checkpoints")})
        result["work_bytes_after"] = sum(f.stat().st_size for f in root.rglob("*") if f.is_file())
        result["reclaimed_bytes"] = before - result["work_bytes_after"]
        return result
    finally:
        db.close()


# A work directory is pinned to the rules that built it. When rules change in a
# way that provably changes no verdict, re-mining is waste -- but "provably" has
# to mean replaying real stored source, not asserting it. The prior hash is kept
# rather than overwritten, so a mixed-policy scan can never look single-policy.
def adopt(args):
    from .filtering import classify, fields_for
    root = Path(args.work_dir).resolve()
    path = root / "candidates.sqlite"
    if not path.exists(): raise MinerError("No mining database at " + str(path))
    db = sqlite3.connect(str(path), isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=5000")
    try:
        stored = json.loads(db.execute("SELECT value FROM meta WHERE key='contract'").fetchone()[0])
        manifest = stored["manifest"]
        current = {"manifest": manifest,
                   "settings": {"filter": VERSION, "rule_hash": RULE_HASH,
                                "threshold": args_threshold(stored), "rejected_sample": args_sample(stored)},
                   "schema": stored.get("schema")}
        if encode(stored) == encode(current):
            return {"work_dir": str(root), "state": "already current", "rule_hash": RULE_HASH}
        checks = {}
        breaking = []
        for table, expected in (("accepted", True), ("rejected", False)):
            agree = 0
            rows = db.execute("SELECT kind,raw,assessment FROM %s" % table).fetchall()
            for kind, raw, assessment in rows:
                row, old = json.loads(raw), json.loads(assessment)
                verdict = classify(fields_for(kind, row))
                if verdict["candidate"] != expected:
                    breaking.append({"table": table, "kind": kind,
                                     "was": old.get("status"), "now": verdict.get("status")})
                elif verdict.get("status") == old.get("status") and verdict.get("score") == old.get("score"):
                    agree += 1
            checks[table] = {"checked": len(rows), "identical": agree,
                             "verdict_changed": sum(1 for b in breaking if b["table"] == table)}
        result = {"work_dir": str(root), "from_rule_hash": stored["settings"]["rule_hash"],
                  "to_rule_hash": RULE_HASH, "sample_replay": checks,
                  "applied": False,
                  "limit": "Samples are bounded; agreement is evidence that no verdict moved, not proof."}
        if breaking:
            result["state"] = "refused"
            result["breaking"] = breaking[:10]
            raise MinerError("Stored samples change verdict under the current rules (" +
                             str(len(breaking)) + " of them); this work directory must be re-mined. " +
                             "Run with a new --work-dir.")
        if not args.yes:
            result["state"] = "checked"
            result["note"] = "No sampled verdict changed. Re-run with --yes to re-pin."
            return result
        with writer_lock(root):
            db.execute("BEGIN IMMEDIATE")
            try:
                history = db.execute("SELECT value FROM meta WHERE key='adopted'").fetchone()
                trail = json.loads(history[0]) if history else []
                trail.append({"from": stored["settings"]["rule_hash"], "to": RULE_HASH,
                              "at": time.time(), "sample_replay": checks})
                db.execute("INSERT INTO meta VALUES('adopted',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (encode(trail),))
                db.execute("UPDATE meta SET value=? WHERE key='contract'", (encode(current),))
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK"); raise
        result["state"] = "adopted"; result["applied"] = True
        result["provenance"] = "meta.adopted records every prior rule hash; this scan is not single-policy"
        return result
    finally:
        db.close()


def args_threshold(stored): return stored["settings"].get("threshold", 3)
def args_sample(stored): return stored["settings"].get("rejected_sample", 100)


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "catalog":
            catalog(args)
            return 0
        if args.command == "reindex":
            emit(searchindex.build(args.work_dir, int(args.budget_gb * 1_000_000_000), args.batch,
                args.max_documents, lambda event: print(encode(event), file=sys.stderr, flush=True)))
            return 0
        if args.command in ("run", "preflight"):
            return ingest(args)
        if args.command == "adopt":
            emit(adopt(args))
            return 0
        if args.command == "purge":
            emit(purge(args))
            return 0
        db = read_db(args.work_dir)
        try:
            if args.command == "status":
                state = report(db)
                value = db.execute("SELECT value FROM meta WHERE key='budget_bytes'").fetchone()
                state["work_bytes"] = sum(p.stat().st_size for p in Path(args.work_dir).rglob("*") if p.is_file())
                state["budget_bytes"] = json.loads(value[0]) if value else None
                if (Path(args.work_dir) / searchindex.INDEX_NAME).exists():
                    try:
                        index = searchindex.open_index(args.work_dir, require_ready=False)
                        try: state["search_index"] = searchindex.metadata(index)
                        finally: index.close()
                    except MinerError as error: state["search_index"] = {"state": "unavailable", "reason": str(error)}
                emit(state)
            elif args.command == "search":
                if args.legacy:
                    emit(search(db, args.query, args.site, args.kind, args.limit, "words" if args.mode == "auto" else args.mode, args.offset, args.min_score))
                else:
                    emit(searchindex.search(args.work_dir, args.query, args.site, args.kind, args.limit, args.mode,
                        args.offset, args.min_score, args.scope, args.mention))
            elif args.command == "thread": emit(thread(db, args.site, args.question_id))
            elif args.command in ("export", "audit"):
                state = report(db)
                if not args.allow_partial and state["status"] != "complete":
                    raise MinerError("Export requires complete ingestion without coverage warnings; use --allow-partial for inspection")
                path = Path(args.output).resolve()
                work = Path(args.work_dir).resolve()
                if path == work or work in path.parents: raise MinerError("Exports/logs belong outside the budgeted work directory")
                count = 0
                if path.exists(): raise MinerError("Output already exists; choose a new path")
                temp = path.with_name(path.name + ".partial")
                created = False
                try:
                    with temp.open("x") as out:
                        created = True
                        for value in export_rows(db, args.kind, getattr(args, "sample", None)):
                            out.write(encode({"release": state["release"], "coverage_status": state["status"], **value}) + "\n")
                            count += 1
                    # Hard-link gives atomic no-overwrite publication on this filesystem.
                    import os
                    os.link(temp, path)
                finally:
                    if created: temp.unlink(missing_ok=True)
                emit({"output": str(path), "rows": count, "coverage_status": state["status"]})
        finally:
            db.close()
        return 0
    except KeyboardInterrupt:
        if not getattr(args, "reported", False):
            print("Paused; last committed checkpoint is safe. Resume the same command.", file=sys.stderr)
            if args.command == "run":
                print("Resume with: " + resume_command(args), file=sys.stderr)
        return 130
    except (MinerError, OSError, ValueError, sqlite3.Error) as error:
        if not getattr(args, "reported", False):
            print("Miner stopped: " + str(error), file=sys.stderr)
            if args.command == "run" and is_pause(error):
                print("Resume with: " + resume_command(args), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
