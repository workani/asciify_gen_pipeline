"""Offline tests for the run dashboard: event model, honest progress, terminal
behaviour, and the non-interactive contract. No network, no model, no archives."""
import io
import json
import os
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest import mock
from xml.etree.ElementTree import Element, SubElement, tostring

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from se_miner import dashboard, pipeline as pipeline_module
from se_miner.cli import main, resume_command
from se_miner.common import Budget
from se_miner.dashboard import (Glyphs, Palette, bar, final_summary, fit, frame, human_bytes,
                                human_count, human_duration, indeterminate, ui_available)
from se_miner.events import (CHECKPOINT, INVENTORY, METRICS, NETWORK, PROGRESS, REPLAY, RETRY,
                             RUN_FINISHED, RUN_STARTED, SITE_COMPLETE, SITE_PHASES, SITE_STARTED,
                             STAGE_COMPLETE, STAGE_SKIPPED, STAGE_STARTED, WORKING, event,
                             phase_label, redact)
from se_miner.filtering import RULE_HASH, VERSION
from se_miner.pipeline import Pipeline
from se_miner.storage import Store
from se_miner.transport import Sources
from se_miner.uistate import RunState

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
SITE = "tex.stackexchange.com"


class Clock:
    def __init__(self, start=1_700_000_000.0):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds
        return self.now


class FakeTTY(io.StringIO):
    encoding = "utf-8"

    def isatty(self):
        return True


def xml_table(table, rows):
    root = Element(table.lower())
    for row in rows:
        SubElement(root, "row", {k: str(v) for k, v in row.items()})
    return tostring(root, encoding="utf-8", xml_declaration=True)


def local_fixture(root, posts=40, tables=("Posts", "Comments")):
    """A `files` manifest over generated XML: exercises the real pipeline offline."""
    rows = {
        "Posts": [{"Id": i, "PostTypeId": 1, "Title": "Q%d" % i,
                   "Body": "What is this symbol? I mean U+03B%d" % (i % 10),
                   "AnswerCount": 0, "CommentCount": 1} for i in range(1, posts + 1)],
        "Comments": [{"Id": i, "PostId": i, "Text": "looks like an n with a tail, cant find it"}
                     for i in range(1, posts + 1)],
        "PostHistory": [{"Id": i, "PostId": i, "PostHistoryTypeId": 1,
                         "Text": "what is this weird character"} for i in range(1, posts + 1)],
        "PostLinks": [{"Id": 1, "PostId": 1, "RelatedPostId": 2, "LinkTypeId": 3}],
    }
    files = {}
    for table in tables:
        path = root / (table + ".xml")
        path.write_bytes(xml_table(table, rows[table]))
        files[table] = {"url": str(path)}
    manifest = {"version": 1, "release": "ui-fixture",
                "sites": [{"site": SITE, "files": files}]}
    path = root / "manifest.json"
    path.write_text(json.dumps(manifest))
    return path, manifest


def started(state, **extra):
    state.apply(event(RUN_STARTED, release="ui-fixture", manifest="/tmp/m.json",
                      work_dir=".miner-work", sites=[SITE], budget_bytes=10_000_000_000,
                      work_bytes=1_000_000, **extra))
    return state


class StateTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.state = RunState(clock=self.clock, wall=self.clock)

    def test_lifecycle_events_drive_sites_stages_and_overall_counts(self):
        started(self.state)
        self.state.apply(event(SITE_STARTED, site=SITE))
        self.state.apply(event(INVENTORY, site=SITE, tables=["Posts", "Comments", "PostHistory", "PostLinks"],
                               missing_optional=[]))
        shot = self.state.snapshot()
        self.assertEqual(shot["status"], "running")
        self.assertEqual(shot["overall"], {"stages": 0, "stages_total": 8, "sites": 0, "sites_total": 1})
        self.assertEqual(shot["sites"][0]["status"], "active")
        for phase in SITE_PHASES:
            self.state.apply(event(STAGE_COMPLETE, site=SITE, phase=phase, rows=7))
        self.state.apply(event(SITE_COMPLETE, site=SITE))
        shot = self.state.snapshot()
        self.assertEqual(shot["overall"], {"stages": 8, "stages_total": 8, "sites": 1, "sites_total": 1})
        self.assertEqual(shot["sites"][0]["status"], "complete")

    def test_human_readable_stage_labels(self):
        for phase, label in (("discover_posts", "Discovering posts"),
                             ("discover_comments", "Scanning comments"),
                             ("resolve_threads", "Resolving candidate threads"),
                             ("collect_posts", "Collecting full discussions")):
            self.assertEqual(phase_label(phase), label)
        self.assertEqual(phase_label("something_new"), "Something new")

    def test_unknown_total_gives_no_percent_and_no_eta(self):
        started(self.state)
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="discover_posts", resumed_from=0, total=None))
        for rows in (1000, 2000, 3000):
            self.clock.advance(1.0)
            self.state.apply(event(PROGRESS, site=SITE, phase="discover_posts", rows=rows,
                                   committed=rows - 10, new_rows=rows))
        active = self.state.snapshot()["active"]
        self.assertIsNone(active["total"])
        self.assertIsNone(active["percent"])
        self.assertIsNone(active["eta"])
        # Throughput and the real row count still have to be there.
        self.assertEqual(active["observed"], 3000)
        self.assertAlmostEqual(active["rate"], 1000.0, delta=1.0)

    def test_reliable_total_yields_percent_and_eta(self):
        started(self.state)
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="collect_posts", resumed_from=0, total=10_000))
        for rows in (1000, 2000):
            self.clock.advance(1.0)
            self.state.apply(event(PROGRESS, site=SITE, phase="collect_posts", rows=rows,
                                   committed=rows, new_rows=rows))
        active = self.state.snapshot()["active"]
        self.assertAlmostEqual(active["percent"], 0.2)
        self.assertAlmostEqual(active["eta"], 8.0, delta=0.5)

    def test_completed_discovery_total_feeds_matching_collection_pass(self):
        started(self.state)
        self.state.apply(event(STAGE_COMPLETE, site=SITE, phase="discover_comments", rows=4242))
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="collect_comments", resumed_from=0))
        self.assertEqual(self.state.snapshot()["active"]["total"], 4242)

    def test_incomplete_discovery_pass_is_not_used_as_a_denominator(self):
        started(self.state)
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="discover_comments", resumed_from=0))
        self.state.apply(event(PROGRESS, site=SITE, phase="discover_comments", rows=900, committed=900))
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="collect_comments", resumed_from=0))
        self.assertIsNone(self.state.snapshot()["active"]["total"])

    def test_resume_seeds_committed_progress_from_checkpoints(self):
        started(self.state, checkpoints=[
            {"site": SITE, "phase": "discover_posts", "ordinal": 8000, "complete": 1},
            {"site": SITE, "phase": "discover_comments", "ordinal": 3200, "complete": 0}])
        shot = self.state.snapshot()
        self.assertTrue(shot["resumed"])
        self.assertEqual(shot["overall"]["stages"], 1)
        # A finished pass from an earlier run still supplies the collection total.
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="collect_posts", resumed_from=0))
        self.assertEqual(self.state.snapshot()["active"]["total"], 8000)

    def test_replay_is_distinguished_from_new_row_processing(self):
        started(self.state)
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="discover_comments", resumed_from=3200))
        self.state.apply(event(REPLAY, site=SITE, phase="discover_comments", rows=1600, target=3200))
        active = self.state.snapshot()["active"]
        self.assertTrue(active["replaying"])
        self.assertEqual((active["replayed"], active["replay_target"]), (1600, 3200))
        self.assertAlmostEqual(active["percent"], 0.5)     # replay has a real denominator
        self.assertEqual(active["new_rows"], 0)            # nothing new processed yet
        self.state.apply(event(PROGRESS, site=SITE, phase="discover_comments", rows=3400,
                               committed=3300, new_rows=200))
        active = self.state.snapshot()["active"]
        self.assertFalse(active["replaying"])
        self.assertEqual(active["new_rows"], 200)

    def test_observed_rows_are_distinct_from_committed_progress(self):
        started(self.state)
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="discover_posts", resumed_from=0))
        self.state.apply(event(PROGRESS, site=SITE, phase="discover_posts", rows=980, committed=500))
        active = self.state.snapshot()["active"]
        self.assertEqual((active["observed"], active["committed"]), (980, 500))
        self.state.apply(event(CHECKPOINT, site=SITE, phase="discover_posts", rows=1000, committed=1000))
        active = self.state.snapshot()["active"]
        self.assertEqual((active["observed"], active["committed"]), (1000, 1000))
        self.assertIsNotNone(active["committed_at"])

    def test_missing_optional_tables_drop_their_stages(self):
        started(self.state)
        self.state.apply(event(INVENTORY, site=SITE, tables=["Posts", "Comments"],
                               missing_optional=["PostHistory", "PostLinks"]))
        shot = self.state.snapshot()
        self.assertEqual(shot["overall"]["stages_total"], 5)
        self.assertEqual(shot["sites"][0]["missing_optional"], ["PostHistory", "PostLinks"])
        self.assertTrue(any("has no PostHistory" in e["text"] for e in shot["log"]))
        self.state.apply(event(STAGE_SKIPPED, site=SITE, phase="collect_history", reason="no PostHistory table"))
        self.assertEqual(self.state.snapshot()["overall"]["stages_total"], 5)

    def test_already_complete_stage_reads_as_complete_not_skipped(self):
        started(self.state)
        self.state.apply(event(STAGE_SKIPPED, site=SITE, phase="discover_posts",
                               reason="already complete", rows=8000))
        shot = self.state.snapshot()
        self.assertEqual(shot["overall"]["stages"], 1)
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="collect_posts", resumed_from=0))
        self.assertEqual(shot and self.state.snapshot()["active"]["total"], 8000)

    def test_archive_bytes_never_count_as_mining_completion(self):
        started(self.state)
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="discover_posts", resumed_from=0))
        before = self.state.snapshot()
        for _ in range(20):
            self.state.apply(event(NETWORK, requests=1, bytes=400_000_000))
        after = self.state.snapshot()
        self.assertEqual(before["overall"], after["overall"])
        self.assertIsNone(after["active"]["percent"])
        self.assertEqual(after["network"]["bytes"], 8_000_000_000)

    def test_log_is_bounded_and_checkpoints_do_not_flood_it(self):
        started(self.state)
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="discover_posts", resumed_from=0))
        for index in range(400):
            self.clock.advance(0.01)
            self.state.apply(event(CHECKPOINT, site=SITE, phase="discover_posts",
                                   rows=index * 500, committed=index * 500))
        log = self.state.snapshot()["log"]
        self.assertLessEqual(len(log), RunState.MAX_LOG)
        self.assertEqual(sum("Checkpoint" in e["text"] for e in log), 1)
        self.clock.advance(RunState.CHECKPOINT_LOG_INTERVAL + 1)
        self.state.apply(event(CHECKPOINT, site=SITE, phase="discover_posts", rows=999, committed=999))
        self.assertEqual(sum("Checkpoint" in e["text"] for e in self.state.snapshot()["log"]), 2)

    def test_retries_and_warnings_are_logged_in_plain_language(self):
        started(self.state)
        self.state.apply(event(RETRY, url="https://example.test/a.7z", attempt=2, attempts=4,
                               delay=4, status=503))
        entry = self.state.snapshot()["log"][-1]
        self.assertEqual(entry["level"], "warn")
        self.assertIn("Source retry 2/4 after HTTP 503; waiting 4s", entry["text"])

    def test_untagged_legacy_progress_dicts_still_drive_the_model(self):
        started(self.state)
        self.state.apply({"site": SITE, "phase": "discover_posts", "rows": 120})
        self.assertEqual(self.state.snapshot()["active"]["observed"], 120)
        self.state.apply({"site": SITE, "phase": "discover_posts", "rows": 300, "complete": True})
        self.assertEqual(self.state.snapshot()["overall"]["stages"], 1)

    def test_metrics_and_storage_are_carried_into_the_snapshot(self):
        started(self.state)
        self.state.apply(event(METRICS, candidates=12, documents=34, discovery_hits=56,
                               work_bytes=2_500_000_000))
        shot = self.state.snapshot()
        self.assertEqual(shot["metrics"], {"candidates": 12, "documents": 34, "discovery_hits": 56})
        self.assertEqual(shot["storage"], {"used": 2_500_000_000, "limit": 10_000_000_000})

    def test_redact_drops_signed_url_query_strings(self):
        self.assertEqual(redact("https://host.test/a.7z?X-Signature=secret"), "https://host.test/a.7z")
        self.assertEqual(redact("/var/tmp/work/Posts.xml"), "Posts.xml")


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.state = RunState(clock=self.clock, wall=self.clock)
        started(self.state)
        self.state.apply(event(SITE_STARTED, site=SITE))
        self.state.apply(event(INVENTORY, site=SITE, tables=["Posts", "Comments"],
                               missing_optional=["PostHistory", "PostLinks"]))
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="discover_posts", resumed_from=0))
        self.clock.advance(1.0)
        self.state.apply(event(PROGRESS, site=SITE, phase="discover_posts", rows=5000,
                               committed=4500, new_rows=5000))

    def plain(self, width=100, height=26, tick=0, glyphs=None):
        return frame(self.state.snapshot(), width, height, tick, glyphs or Glyphs(True), Palette(False))

    def test_frame_respects_width_and_height(self):
        for width, height in ((100, 26), (60, 18), (46, 12), (30, 8), (24, 4)):
            lines = self.plain(width, height)
            self.assertLessEqual(len(lines), height, (width, height))
            for line in lines:
                self.assertLessEqual(len(ANSI.sub("", line)), width - 1, (width, height, line))

    def test_frame_keeps_header_and_log_on_a_small_terminal(self):
        text = "\n".join(self.plain(40, 8))
        self.assertIn("Stack Exchange symbol miner", text)
        self.assertIn("Discovering posts", text)

    def test_frame_shows_stage_counts_not_a_processing_percentage(self):
        text = "\n".join(self.plain())
        self.assertIn("0/5 stages · 0/1 sites complete", text)
        self.assertIn("Discovering posts", text)
        self.assertIn("5,000 rows", text)
        self.assertIn("committed 4,500", text)

    def test_frame_shows_percent_and_eta_only_with_a_real_total(self):
        self.state.apply(event(STAGE_COMPLETE, site=SITE, phase="discover_posts", rows=8000))
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="collect_posts", resumed_from=0))
        self.clock.advance(1.0)
        self.state.apply(event(PROGRESS, site=SITE, phase="collect_posts", rows=2000, committed=2000))
        self.clock.advance(1.0)
        self.state.apply(event(PROGRESS, site=SITE, phase="collect_posts", rows=4000, committed=4000))
        text = "\n".join(self.plain())
        self.assertIn("50.0% · 4,000 / 8,000", text)
        self.assertIn("ETA 00:00:02", text)

    def test_replay_is_labelled_on_screen(self):
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="collect_posts", resumed_from=4000))
        self.state.apply(event(REPLAY, site=SITE, phase="collect_posts", rows=1000, target=4000))
        text = "\n".join(self.plain())
        self.assertIn("replaying committed rows", text)
        self.assertIn("1,000 / 4,000 replayed", text)

    def test_storage_and_network_are_shown_against_the_budget(self):
        self.state.apply(event(METRICS, candidates=7, documents=9, discovery_hits=11,
                               work_bytes=2_500_000_000))
        self.state.apply(event(NETWORK, requests=12, bytes=4_800_000_000))
        text = "\n".join(self.plain())
        self.assertIn("2.5 GB / 10.0 GB", text)
        self.assertIn("12 requests · 4.8 GB", text)
        self.assertIn("candidates 7", text)

    def test_colour_is_opt_in_and_ansi_free_by_default(self):
        self.assertFalse(any("\x1b[" in line for line in self.plain()))
        coloured = frame(self.state.snapshot(), 100, 26, 0, Glyphs(True), Palette(True))
        self.assertTrue(any("\x1b[" in line for line in coloured))

    def test_ascii_fallback_avoids_non_encodable_glyphs(self):
        lines = self.plain(glyphs=Glyphs(False))
        text = "\n".join(lines)
        self.assertNotIn("█", text)
        text.encode("ascii")  # must not raise

    def test_bar_track_is_painted_separately_from_the_filled_run(self):
        # A single-colour bar makes an empty track read as a full one.
        from se_miner.dashboard import bar_chunks, indeterminate_chunks
        filled, track = bar_chunks(0.25, 8, Glyphs(False), "ok")
        self.assertEqual((filled[0], filled[1]), ("##", "ok"))
        self.assertEqual((track[0], track[1]), ("------", "track"))
        styles = {style for _text, style in indeterminate_chunks(18, 3, Glyphs(False))}
        self.assertEqual(styles, {"accent", "track"})
        coloured = frame(self.state.snapshot(), 100, 26, 0, Glyphs(True), Palette(True))
        self.assertTrue(any("\x1b[90m" in line for line in coloured))

    def test_stage_without_a_count_shows_what_it_is_waiting_on(self):
        self.state.apply(event(STAGE_STARTED, site=SITE, phase="inventory", total=None, unit="tables"))
        self.state.apply(event(RETRY, url="https://host.test/a.7z", attempt=1, attempts=4,
                               delay=1, status=500))
        text = "\n".join(self.plain())
        self.assertIn("retrying in 1s", text)
        self.assertNotIn("measuring tables/s", text)
        self.assertNotIn("new rows this run", text)

    def test_long_source_urls_do_not_swallow_the_log_line(self):
        self.state.apply(event("source", action="opening", note="Opening remote source",
                               url="https://archive.org/download/stackexchange/english.stackexchange.com.7z"))
        entry = self.state.snapshot()["log"][-1]
        self.assertEqual(entry["text"], "Opening remote source english.stackexchange.com.7z")

    def test_header_drops_a_path_rather_than_leaving_a_fragment(self):
        line = self.plain(64, 26)[1]
        self.assertIn("ui-fixture", line)
        self.assertFalse(line.rstrip().endswith("/tmp/m"))

    def test_indeterminate_bar_animates_and_stays_in_width(self):
        shapes = {indeterminate(20, tick, Glyphs(True)) for tick in range(12)}
        self.assertGreater(len(shapes), 3)
        for shape in shapes:
            self.assertEqual(len(shape), 20)

    def test_bar_and_formatting_helpers(self):
        self.assertEqual(bar(0.5, 10, Glyphs(False)), "#####-----")
        self.assertEqual(bar(2.0, 4, Glyphs(False)), "####")
        self.assertEqual(human_bytes(2_500_000_000), "2.5 GB")
        self.assertEqual(human_bytes(None), "n/a")
        self.assertEqual(human_count(1234567), "1,234,567")
        self.assertEqual(human_duration(3661), "01:01:01")
        self.assertEqual(human_duration(90061), "1d 01:01:01")
        self.assertEqual(fit("/a/very/long/path/manifest.json", 14, Glyphs(True)), "…manifest.json")
        self.assertEqual(fit("short", 14, Glyphs(True)), "short")

    def test_final_summary_reports_state_counts_and_resume(self):
        self.state.apply(event(RUN_FINISHED, status="paused", message="Paused by Ctrl-C",
                               reason="Uncommitted rows were rolled back; the last checkpoint is intact."))
        text = final_summary(self.state.snapshot(), Palette(False), resume="python3 scripts/mine.py run m.json")
        self.assertIn("Miner PAUSED", text)
        self.assertIn("the last checkpoint is intact", text)
        self.assertIn("resume with: python3 scripts/mine.py run m.json", text)

    def test_final_summary_distinguishes_clean_completion_from_warnings(self):
        self.state.apply(event(RUN_FINISHED, status="complete", warnings={"orphan_discovery_hits": 0}))
        clean = final_summary(self.state.snapshot(), Palette(False))
        self.assertIn("Miner COMPLETED", clean)
        self.assertNotIn("coverage warnings", clean)
        self.state.apply(event(RUN_FINISHED, status="complete_with_warnings",
                               warnings={"comment_count_mismatches": 3, "orphan_discovery_hits": 0}))
        flagged = final_summary(self.state.snapshot(), Palette(False))
        self.assertIn("COMPLETED · WARNINGS", flagged)
        self.assertIn("comment_count_mismatches=3", flagged)


class TerminalTests(unittest.TestCase):
    def test_ui_is_off_without_a_tty_or_with_no_ui_or_dumb_terminal(self):
        with mock.patch.dict(os.environ, {"TERM": "xterm-256color"}, clear=False):
            os.environ.pop("MINER_NO_UI", None)
            self.assertTrue(ui_available(FakeTTY()))
            self.assertFalse(ui_available(FakeTTY(), disabled=True))
            self.assertFalse(ui_available(io.StringIO()))
        with mock.patch.dict(os.environ, {"TERM": "dumb"}, clear=False):
            os.environ.pop("MINER_NO_UI", None)
            self.assertFalse(ui_available(FakeTTY()))

    def test_dashboard_enters_and_restores_the_terminal(self):
        stream = FakeTTY()
        ui = dashboard.Dashboard(RunState(), stream=stream, interval=0.01)
        ui.start()
        ui.paint()
        ui.stop()
        output = stream.getvalue()
        self.assertIn("\x1b[?1049h", output)
        self.assertIn("\x1b[?25l", output)
        self.assertTrue(output.endswith("\x1b[?25h\x1b[?1049l"))

    def test_terminal_is_restored_when_the_body_raises(self):
        stream = FakeTTY()
        ui = dashboard.Dashboard(RunState(), stream=stream, interval=0.01)
        with self.assertRaises(ValueError):
            with ui:
                raise ValueError("boom")
        self.assertTrue(stream.getvalue().endswith("\x1b[?25h\x1b[?1049l"))

    def test_stop_is_idempotent(self):
        stream = FakeTTY()
        ui = dashboard.Dashboard(RunState(), stream=stream, interval=0.01).start()
        ui.stop()
        ui.stop()
        self.assertEqual(stream.getvalue().count("\x1b[?1049l"), 1)


class PipelineEventTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.manifest_path, self.manifest = local_fixture(self.root, posts=40)
        self.settings = {"filter": VERSION, "rule_hash": RULE_HASH, "threshold": 3, "rejected_sample": 100}
        self.stores = []

    def tearDown(self):
        for store in self.stores:
            try:
                store.close()
            except Exception:
                pass
        self.tmp.cleanup()

    def store(self, name="work"):
        store = Store(Budget(self.root / name, 10_000_000_000), self.manifest, self.settings)
        self.stores.append(store)
        return store

    def run_pipeline(self, store, events, **kwargs):
        sources = Sources(store.budget, store.pin, observer=events.append)
        pipe = Pipeline(store, sources, progress=events.append, metrics_interval=0, **kwargs)
        for site in self.manifest["sites"]:
            pipe.run_site(site)
        return pipe

    def test_pipeline_emits_the_full_lifecycle_offline(self):
        events = []
        self.run_pipeline(self.store(), events, batch=7)
        kinds = [e.get("event") for e in events]
        for kind in (SITE_STARTED, INVENTORY, STAGE_STARTED, CHECKPOINT, STAGE_COMPLETE,
                     METRICS, SITE_COMPLETE):
            self.assertIn(kind, kinds)
        phases = [e["phase"] for e in events if e.get("event") == STAGE_COMPLETE]
        self.assertEqual(phases, ["inventory", "discover_posts", "discover_comments",
                                  "resolve_threads", "collect_posts", "collect_comments"])
        skipped = {e["phase"]: e["reason"] for e in events if e.get("event") == STAGE_SKIPPED}
        self.assertEqual(skipped, {"discover_history": "no PostHistory table",
                                   "discover_duplicates": "no PostLinks table",
                                   "collect_history": "no PostHistory table"})
        resolve = next(e for e in events if e.get("event") == STAGE_COMPLETE and e["phase"] == "resolve_threads")
        self.assertEqual(resolve["unit"], "threads")
        self.assertEqual(resolve["rows"], 40)

    def test_collection_passes_inherit_the_discovery_row_total(self):
        events = []
        self.run_pipeline(self.store(), events, batch=7)
        starts = {e["phase"]: e.get("total") for e in events if e.get("event") == STAGE_STARTED}
        self.assertEqual(starts["discover_posts"], None)
        self.assertEqual(starts["collect_posts"], 40)
        self.assertEqual(starts["collect_comments"], 40)

    def test_resume_reports_replay_then_new_rows(self):
        store = self.store("partial")
        with self.assertRaisesRegex(Exception, "row limit"):
            self.run_pipeline(store, [], batch=5, stop_after=10)
        store.close()
        events = []
        resumed = self.store("partial")
        sources = Sources(resumed.budget, resumed.pin, observer=events.append)
        pipe = Pipeline(resumed, sources, batch=5, progress=events.append, metrics_interval=0)
        pipe.REPORT_INTERVAL = 0  # report every row so replay is observable in a tiny fixture
        for site in self.manifest["sites"]:
            pipe.run_site(site)
        replays = [e for e in events if e.get("event") == REPLAY]
        self.assertTrue(replays)
        self.assertTrue(all(r["rows"] <= r["target"] for r in replays))
        start = next(e for e in events if e.get("event") == STAGE_STARTED and e["phase"] == "discover_posts")
        self.assertEqual(start["resumed_from"], 10)

    def test_source_validation_is_announced_before_scanning(self):
        events = []
        self.run_pipeline(self.store(), events, batch=7)
        sources = [e for e in events if e.get("event") == "source"]
        self.assertTrue(sources)
        self.assertEqual(sources[0]["action"], "verifying")
        self.assertEqual({s["url"] for s in sources}, {"Posts.xml", "Comments.xml"})

    def test_thread_resolution_reports_liveness(self):
        events = []
        store = self.store()
        sources = Sources(store.budget, store.pin, observer=events.append)
        pipe = Pipeline(store, sources, batch=7, progress=events.append, metrics_interval=0)
        pipe.REPORT_INTERVAL, pipe.RESOLVE_STEPS = 0, 1
        for site in self.manifest["sites"]:
            pipe.run_site(site)
        working = [e for e in events if e.get("event") == WORKING and e["phase"] == "resolve_threads"]
        self.assertTrue(working)
        self.assertEqual(working[0]["note"], "resolving evidence-bearing threads")

    def test_events_feed_the_state_model_end_to_end(self):
        state = RunState()
        store = self.store()
        sources = Sources(store.budget, store.pin, observer=state.apply)
        pipe = Pipeline(store, sources, batch=7, progress=state.apply, metrics_interval=0)
        state.apply(event(RUN_STARTED, release="ui-fixture", manifest=str(self.manifest_path),
                          work_dir=str(store.budget.root), sites=[SITE],
                          budget_bytes=store.budget.limit, checkpoints=[]))
        for site in self.manifest["sites"]:
            pipe.run_site(site)
        shot = state.snapshot()
        self.assertEqual(shot["overall"], {"stages": 5, "stages_total": 5, "sites": 1, "sites_total": 1})
        self.assertEqual(shot["metrics"]["candidates"], 40)
        self.assertGreater(shot["rows_this_run"], 0)
        rendered = "\n".join(frame(shot, 100, 26, 0, Glyphs(True), Palette(False)))
        self.assertIn("5/5 stages · 1/1 sites complete", rendered)


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.manifest_path, _ = local_fixture(self.root, posts=30)
        self.work = self.root / "work"

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, argv, stderr_tty=False, stdout_tty=False):
        out = FakeTTY() if stdout_tty else io.StringIO()
        err = FakeTTY() if stderr_tty else io.StringIO()
        with mock.patch.dict(os.environ, {"TERM": "xterm-256color"}, clear=False):
            os.environ.pop("MINER_NO_UI", None)
            with redirect_stdout(out), redirect_stderr(err):
                code = main(argv)
        return code, out.getvalue(), err.getvalue()

    def base(self, *extra):
        return ["run", str(self.manifest_path), "--work-dir", str(self.work), "--batch", "7", *extra]

    def test_non_interactive_run_streams_json_events_and_a_json_report(self):
        code, out, err = self.run_cli(self.base())
        self.assertEqual(code, 0)
        self.assertNotIn("\x1b[", err)
        kinds = [json.loads(line)["event"] for line in err.splitlines() if line.strip()]
        self.assertIn("run_started", kinds)
        self.assertIn("stage_complete", kinds)
        self.assertEqual(kinds[-1], "run_finished")
        report = json.loads(out)
        self.assertEqual(report["status"], "complete")
        self.assertEqual(report["candidates"], 30)

    def test_interactive_run_draws_the_dashboard_and_restores_the_terminal(self):
        code, out, err = self.run_cli(self.base(), stderr_tty=True)
        self.assertEqual(code, 0)
        self.assertIn("\x1b[?1049h", err)
        self.assertTrue(err.rindex("\x1b[?1049l") > err.rindex("\x1b[?1049h"))
        self.assertIn("Miner COMPLETED", ANSI.sub("", err))
        self.assertNotIn('"event":', err)
        # stdout was redirected, so the machine-readable report is still produced.
        self.assertEqual(json.loads(out)["status"], "complete")

    def test_no_ui_forces_json_events_even_on_a_terminal(self):
        code, out, err = self.run_cli(self.base("--no-ui"), stderr_tty=True)
        self.assertEqual(code, 0)
        self.assertNotIn("\x1b[?1049h", err)
        self.assertIn('"event":"run_started"', err)
        self.assertEqual(json.loads(out)["status"], "complete")

    def test_fully_interactive_run_keeps_the_summary_and_points_at_the_json(self):
        code, out, err = self.run_cli(self.base(), stderr_tty=True, stdout_tty=True)
        self.assertEqual(code, 0)
        plain = ANSI.sub("", err)
        self.assertIn("Miner COMPLETED", plain)
        self.assertIn("full JSON report: rerun with --no-ui", plain)
        self.assertEqual(out, "")

    def test_interrupt_preserves_checkpoints_and_shows_the_resume_command(self):
        calls = {"n": 0}
        real = pipeline_module.classify

        def interrupting(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 20:
                raise KeyboardInterrupt
            return real(*args, **kwargs)

        with mock.patch.object(pipeline_module, "classify", interrupting):
            code, out, err = self.run_cli(self.base(), stderr_tty=True)
        self.assertEqual(code, 130)
        plain = ANSI.sub("", err)
        self.assertIn("Miner PAUSED", plain)
        self.assertIn("the last checkpoint is intact", plain)
        self.assertIn("resume with: python3 scripts/mine.py run", plain)
        self.assertTrue(err.rindex("\x1b[?1049l") > err.rindex("\x1b[?1049h"))
        # The saved checkpoint must still be readable and below the interrupt point.
        code, status_out, _ = self.run_cli(["status", "--work-dir", str(self.work)])
        self.assertEqual(code, 0)
        state = json.loads(status_out)
        self.assertEqual(state["status"], "incomplete")
        posts = next(c for c in state["checkpoints"] if c["phase"] == "discover_posts")
        self.assertFalse(posts["complete"])
        self.assertLessEqual(posts["ordinal"], 20)

    def test_max_rows_pause_reports_as_paused_and_keeps_exit_code_two(self):
        code, out, err = self.run_cli(self.base("--max-rows", "10"), stderr_tty=True)
        self.assertEqual(code, 2)
        plain = ANSI.sub("", err)
        self.assertIn("Miner PAUSED", plain)
        self.assertIn("resume with:", plain)
        self.assertNotIn("--max-rows", plain.split("resume with:")[1])

    def test_malformed_source_fails_with_exit_two_and_a_failed_state(self):
        path = self.root / "Comments.xml"
        path.write_bytes(path.read_bytes()[:-15])
        code, out, err = self.run_cli(self.base(), stderr_tty=True)
        self.assertEqual(code, 2)
        plain = ANSI.sub("", err)
        self.assertIn("Miner FAILED", plain)
        self.assertIn("Malformed XML", plain)
        self.assertNotIn("resume with:", plain)
        self.assertTrue(err.rindex("\x1b[?1049l") > err.rindex("\x1b[?1049h"))

    def test_completion_with_coverage_warnings_stays_exit_zero_but_is_flagged(self):
        path = self.root / "Comments.xml"
        path.write_bytes(path.read_bytes().replace(b'<row Id="3" PostId="3" Text="looks like an n with a tail, cant find it" />', b""))
        code, out, err = self.run_cli(self.base(), stderr_tty=True)
        self.assertEqual(code, 0)
        plain = ANSI.sub("", err)
        self.assertIn("COMPLETED · WARNINGS", plain)
        self.assertIn("comment_count_mismatches=1", plain)
        self.assertEqual(json.loads(out)["status"], "complete_with_warnings")

    def test_status_remains_available_as_standalone_json(self):
        self.run_cli(self.base())
        code, out, err = self.run_cli(["status", "--work-dir", str(self.work)], stderr_tty=True)
        self.assertEqual(code, 0)
        self.assertNotIn("\x1b[?1049h", err)
        self.assertEqual(json.loads(out)["status"], "complete")

    def test_events_journal_is_written_while_the_terminal_ui_draws(self):
        journal = self.root / "events.jsonl"
        code, out, err = self.run_cli(self.base("--events", str(journal)), stderr_tty=True)
        self.assertEqual(code, 0)
        self.assertIn("\x1b[?1049h", err)          # the terminal dashboard still drew
        self.assertNotIn('"event"', err)           # and stderr stayed free of JSON
        lines = [json.loads(l) for l in journal.read_text().splitlines() if l.strip()]
        kinds = [e["event"] for e in lines]
        self.assertIn("run_started", kinds)
        self.assertIn("stage_complete", kinds)
        self.assertEqual(kinds[-1], "run_finished")
        # Every event carries the producer's clock so a saved stream replays true.
        self.assertTrue(all(isinstance(e.get("at"), float) for e in lines))
        self.assertGreaterEqual(lines[-1]["at"], lines[0]["at"])

    def test_a_second_run_replaces_the_journal_rather_than_appending(self):
        journal = self.root / "events.jsonl"
        self.run_cli(self.base("--events", str(journal)))
        first = journal.read_text().count('"run_started"')
        self.run_cli(self.base("--events", str(journal)))
        second = journal.read_text().count('"run_started"')
        self.assertEqual((first, second), (1, 1))

    def test_journal_keeps_structure_verbatim_and_samples_the_flood(self):
        journal = self.root / "events.jsonl"
        code, out, err = self.run_cli(self.base("--events", str(journal), "--batch", "1"))
        self.assertEqual(code, 0)
        streamed = [json.loads(l) for l in err.splitlines() if l.strip()]
        written = [json.loads(l) for l in journal.read_text().splitlines() if l.strip()]
        structural = lambda rows: [
            (e["event"], e.get("site"), e.get("phase")) for e in rows
            if e["event"] not in ("progress", "replay", "checkpoint", "working", "network")
        ]
        # Nothing structural is lost, and nothing is invented.
        self.assertEqual(structural(written), structural(streamed))
        # A per-row checkpoint flood is sampled away.
        floods = lambda rows: sum(e["event"] == "checkpoint" for e in rows)
        self.assertGreater(floods(streamed), floods(written))

    def test_journal_preserves_network_totals_across_sampling(self):
        from se_miner.cli import Journal
        path = self.root / "net.jsonl"
        book = Journal(path)
        book.INTERVAL = 999  # force every network event into one merged record
        for _ in range(10):
            book.write({"event": "network", "requests": 2, "bytes": 1000, "at": 1.0})
        book.close()
        rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
        merged = [r for r in rows if r["event"] == "network"]
        self.assertEqual(len(merged), 1)
        self.assertEqual((merged[0]["requests"], merged[0]["bytes"]), (20, 10_000))

    def test_journal_is_written_by_default_beside_the_work_directory(self):
        from se_miner.cli import journal_path
        expected = journal_path(self.work)
        code, out, err = self.run_cli(self.base())
        self.assertEqual(code, 0)
        self.assertTrue(expected.is_file(), expected)
        self.assertNotIn(str(expected.resolve()), [str(p.resolve()) for p in self.work.rglob("*")])
        kinds = [json.loads(l)["event"] for l in expected.read_text().splitlines() if l.strip()]
        self.assertEqual(kinds[-1], "run_finished")

    def test_no_events_disables_the_journal(self):
        from se_miner.cli import journal_path
        code, out, err = self.run_cli(self.base("--no-events"))
        self.assertEqual(code, 0)
        self.assertFalse(journal_path(self.work).exists())

    def test_resumed_run_reports_existing_totals_before_its_first_commit(self):
        self.run_cli(self.base())
        first = json.loads(self.run_cli(["status", "--work-dir", str(self.work)])[1])
        self.assertGreater(first["documents"], 0)
        # Re-running is a no-op resume: metrics must still show the retained work.
        code, out, err = self.run_cli(self.base())
        self.assertEqual(code, 0)
        metrics = [json.loads(l) for l in err.splitlines()
                   if l.strip() and json.loads(l)["event"] == "metrics"]
        self.assertTrue(metrics)
        self.assertEqual(metrics[0]["documents"], first["documents"])
        self.assertEqual(metrics[0]["candidates"], first["candidates"])

    def test_resume_command_reproduces_options_but_drops_max_rows(self):
        from se_miner.cli import parser
        args = parser().parse_args(self.base("--max-rows", "10", "--threshold", "5"))
        command = resume_command(args)
        self.assertIn("run", command)
        self.assertIn("--threshold 5", command)
        self.assertIn("--batch 7", command)
        self.assertNotIn("--max-rows", command)
        self.assertNotIn("--rejected-sample", command)  # default stays implicit
        with_journal = parser().parse_args(self.base("--events", "out/events.jsonl"))
        self.assertIn("--events out/events.jsonl", resume_command(with_journal))

    def test_preflight_stderr_stays_quiet_and_unchanged(self):
        code, out, err = self.run_cli(["preflight", str(self.manifest_path),
                                       "--work-dir", str(self.work)], stderr_tty=True)
        self.assertEqual(code, 0)
        self.assertEqual(err, "")
        self.assertEqual(json.loads(out)["sites"][0]["tables"], ["Comments", "Posts"])

    def test_preflight_failure_stays_quiet_on_stderr_too(self):
        (self.root / "Posts.xml").unlink()
        code, out, err = self.run_cli(["preflight", str(self.manifest_path),
                                       "--work-dir", str(self.work)], stderr_tty=True)
        self.assertEqual(code, 2)
        self.assertNotIn('"event"', err)
        self.assertNotIn("\x1b[?1049h", err)
        self.assertTrue(err.startswith("Miner stopped: "))


if __name__ == "__main__":
    unittest.main()
