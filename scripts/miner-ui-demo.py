#!/usr/bin/env python3
"""Demonstrate the miner dashboard with synthetic data. Downloads nothing.

  python3 scripts/miner-ui-demo.py            # scripted timeline in the live UI
  python3 scripts/miner-ui-demo.py --live     # real pipeline over generated XML
  python3 scripts/miner-ui-demo.py --frames   # static frames; works without a TTY
"""
import argparse
import io
import json
import sys
import tempfile
import time
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from se_miner import dashboard, uistate
from se_miner.events import *  # noqa: F403  - event kind constants

SITES = ["english.stackexchange.com", "math.stackexchange.com", "tex.stackexchange.com"]
TOTALS = {"english.stackexchange.com": 1_180_000, "math.stackexchange.com": 4_240_000,
          "tex.stackexchange.com": 1_460_000}


def timeline(state, speed=1.0, sleep=time.sleep):
    """A believable run: resume, replay, unknown totals, retries, warnings."""
    def emit(kind, **fields):
        state.apply(event(kind, **fields))

    done = [{"site": SITES[0], "phase": p, "ordinal": TOTALS[SITES[0]], "complete": 1} for p in SITE_PHASES]
    done.append({"site": SITES[0], "phase": "complete", "ordinal": 0, "complete": 1})
    # The second site resumes mid-collection, so replay has something to show.
    done.append({"site": SITES[1], "phase": "discover_posts", "ordinal": TOTALS[SITES[1]], "complete": 1})
    done.append({"site": SITES[1], "phase": "discover_comments", "ordinal": 9_100_000, "complete": 1})
    emit(RUN_STARTED, release="synthetic-demo-release", manifest="docs/miner/pilot.manifest.json",
         work_dir=".miner-work", sites=SITES, budget_bytes=10_000_000_000,
         work_bytes=1_900_000_000, checkpoints=done)
    emit(METRICS, candidates=48_100, documents=612_400, discovery_hits=131_900)
    sleep(1.2 * speed)

    host, bytes_seen, requests = SITES[1], 1_900_000_000, 402
    emit(SITE_STARTED, site=host)
    emit(INVENTORY, site=host, tables=["Posts", "Comments", "PostHistory", "PostLinks"], missing_optional=[])
    sleep(0.8 * speed)

    def stream(phase, start, total, steps, per_step, unit="rows", retry_at=None):
        nonlocal bytes_seen, requests
        emit(STAGE_STARTED, site=host, phase=phase, resumed_from=start, total=total, unit=unit)
        sleep(0.4 * speed)
        if start:
            for replayed in range(0, start + 1, max(1, start // 14)):
                emit(REPLAY, site=host, phase=phase, rows=min(replayed, start), target=start)
                requests += 2
                bytes_seen += 8_400_000
                emit(NETWORK, requests=2, bytes=8_400_000)
                sleep(0.09 * speed)
        rows, new = start, 0
        for step in range(steps):
            rows += per_step
            new += per_step
            emit(PROGRESS, site=host, phase=phase, rows=rows, committed=rows - 380, new_rows=new)
            if step % 3 == 0:
                emit(CHECKPOINT, site=host, phase=phase, rows=rows, committed=rows,
                     new_rows=new, work_bytes=1_900_000_000 + new * 190)
                emit(METRICS, candidates=48_100 + new // 90, documents=612_400 + new // 7,
                     discovery_hits=131_900 + new // 30)
            if retry_at is not None and step == retry_at:
                emit(RETRY, url="https://archive.org/download/stackexchange/math.stackexchange.com.7z",
                     attempt=2, attempts=4, delay=4, status=503)
                sleep(0.9 * speed)
            requests += 1
            bytes_seen += 4_100_000
            emit(NETWORK, requests=1, bytes=4_100_000)
            sleep(0.11 * speed)
        emit(STAGE_COMPLETE, site=host, phase=phase, rows=rows, total=rows, unit=unit, new_rows=new)

    # No denominator yet: an indeterminate bar plus real rows and throughput.
    stream("discover_history", 0, None, 22, 41_000, retry_at=9)
    stream("discover_duplicates", 0, None, 8, 12_500)
    emit(STAGE_STARTED, site=host, phase="resolve_threads", total=None, unit="threads")
    for _ in range(14):
        emit(WORKING, site=host, phase="resolve_threads", note="expanding duplicate groups")
        sleep(0.16 * speed)
    emit(STAGE_COMPLETE, site=host, phase="resolve_threads", rows=62_880, total=62_880, unit="threads")
    # Resuming collection: replay first, then a total inherited from discovery.
    stream("collect_posts", 1_610_000, TOTALS[host], 20, 96_000)
    emit(SITE_COMPLETE, site=host)
    sleep(0.6 * speed)
    emit(RUN_FINISHED, status="complete_with_warnings",
         warnings={"comment_count_mismatches": 214, "orphan_discovery_hits": 0},
         message="Ingestion finished: complete_with_warnings",
         reason="Coverage is not clean; see warnings.")


def replay_demo(speed):
    state = uistate.RunState()
    if not dashboard.ui_available(sys.stderr):
        print("stderr is not an interactive terminal; use --frames instead.", file=sys.stderr)
        return 2
    ui = dashboard.Dashboard(state).start()
    try:
        timeline(state, speed)
        time.sleep(1.0)
    except KeyboardInterrupt:
        state.apply(event(RUN_FINISHED, status="paused", message="Paused by Ctrl-C",
                          reason="Uncommitted rows were rolled back; the last checkpoint is intact."))
    finally:
        ui.stop()
        print(dashboard.final_summary(state.snapshot(), ui.palette), file=sys.stderr)
    return 0


def frames_demo(count, width, height):
    state = uistate.RunState()
    shots = []
    timeline(state, speed=0.0, sleep=lambda _s: shots.append(state.snapshot()))
    step = max(1, len(shots) // max(1, count))
    for index, shot in enumerate(shots[::step][:count]):
        print("=" * width)
        for line in dashboard.frame(shot, width, height, tick=index * 3):
            print(line)
    return 0


def xml_table(table, rows):
    root = Element(table.lower())
    for row in rows:
        SubElement(root, "row", {k: str(v) for k, v in row.items()})
    return tostring(root, encoding="utf-8", xml_declaration=True)


def live_demo(rows, batch):
    """Runs the actual CLI over generated local XML: no archives, no network."""
    from se_miner.cli import main
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        posts, comments = [], []
        for index in range(1, rows + 1):
            posts.append({"Id": index, "PostTypeId": 1, "Title": "Question %d" % index,
                          "Body": "What is this symbol? I mean U+03B%d" % (index % 10),
                          "AnswerCount": 0, "CommentCount": 1})
            comments.append({"Id": index, "PostId": index,
                             "Text": "looks like an n with a tail, cannot find it" if index % 3 else "ordinary reply"})
        files = {}
        for table, data in (("Posts", posts), ("Comments", comments)):
            path = root / (table + ".xml")
            path.write_bytes(xml_table(table, data))
            files[table] = {"url": str(path)}
        manifest = root / "demo.manifest.json"
        manifest.write_text(json.dumps({"version": 1, "release": "ui-demo",
                                        "sites": [{"site": "tex.stackexchange.com", "files": files}]}))
        return main(["run", str(manifest), "--work-dir", str(root / "work"), "--batch", str(batch)])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--live", action="store_true", help="Run the real pipeline over generated XML")
    parser.add_argument("--frames", type=int, nargs="?", const=4, help="Print N static frames as text")
    parser.add_argument("--speed", type=float, default=1.0, help="Timeline pacing multiplier")
    parser.add_argument("--rows", type=int, default=40000, help="--live synthetic row count")
    parser.add_argument("--batch", type=int, default=500)
    parser.add_argument("--width", type=int, default=100)
    parser.add_argument("--height", type=int, default=26)
    options = parser.parse_args()
    if options.frames:
        sys.exit(frames_demo(options.frames, options.width, options.height))
    sys.exit(live_demo(options.rows, options.batch) if options.live else replay_demo(options.speed))
