#!/usr/bin/env python3
"""Serve the React dashboard and stream a miner run into it.

Give the run a journal with --events; it keeps its terminal dashboard as well.

    python3 scripts/mine.py run docs/miner/pilot.manifest.json --events out/events.jsonl
    python3 scripts/miner-web.py --events out/events.jsonl      # in another shell

Then open http://127.0.0.1:8787. The journal is tailed, so starting the bridge
before, during, or after a run all work: every client is sent the backlog first
and rebuilds the whole run state from it. A run that replaces the journal
retires the previous one rather than appending to it.

Without a journal, --no-ui puts the same events on stderr, and a pipe works too:

    python3 scripts/mine.py run m.json --no-ui 2>&1 >/dev/null | python3 scripts/miner-web.py --events -
"""
import argparse
import json
import mimetypes
import os
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "web" / "out"
MAX_BUFFER = 200_000


class Feed:
    """A bounded, replayable buffer of the producer's JSONL lines."""

    def __init__(self, limit=MAX_BUFFER):
        self.lines = deque(maxlen=limit)
        self.dropped = 0
        self.closed = False
        self.condition = threading.Condition()

    def add(self, line):
        with self.condition:
            if len(self.lines) == self.lines.maxlen:
                self.dropped += 1
            self.lines.append(line)
            self.condition.notify_all()

    def restart(self):
        """A new run replaced the journal: retire the old lines, keep cursors
        monotonic so connected clients simply see the stream continue."""
        with self.condition:
            self.dropped += len(self.lines)
            self.lines.clear()
            self.closed = False
            self.condition.notify_all()

    def close(self):
        with self.condition:
            self.closed = True
            self.condition.notify_all()

    def since(self, cursor, timeout=25):
        """Lines after `cursor` (an absolute index), waiting briefly if none."""
        with self.condition:
            start = self.dropped
            if cursor < start:
                cursor = start
            if cursor >= start + len(self.lines) and not self.closed:
                self.condition.wait(timeout)
                start = self.dropped
                cursor = max(cursor, start)
            offset = cursor - start
            return list(self.lines)[offset:], start + len(self.lines), self.closed


def tail_file(path, feed, poll=0.25):
    """Follow a growing file, including one that does not exist yet."""
    handle = None
    inode = None
    remainder = b""
    while True:
        try:
            stat = os.stat(path)
            if handle is None or stat.st_ino != inode:
                if handle is not None:
                    handle.close()
                    feed.restart()
                handle = open(path, "rb")
                inode = stat.st_ino
                remainder = b""
            elif stat.st_size < handle.tell():
                # Truncated in place: a new run reusing the same journal.
                handle.seek(0)
                remainder = b""
                feed.restart()
        except FileNotFoundError:
            time.sleep(poll)
            continue
        chunk = handle.read(1024 * 1024)
        if not chunk:
            time.sleep(poll)
            continue
        remainder += chunk
        *complete, remainder = remainder.split(b"\n")
        for line in complete:
            text = line.decode("utf-8", "replace").strip()
            if text:
                feed.add(text)


def read_stream(stream, feed):
    for line in stream:
        text = line.decode("utf-8", "replace").strip() if isinstance(line, bytes) else line.strip()
        if text:
            feed.add(text)
    feed.close()


def handler_for(feed, allow_origin):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "miner-web/1"

        def log_message(self, *_args):
            pass

        def _cors(self):
            if allow_origin:
                self.send_header("Access-Control-Allow-Origin", allow_origin)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/events":
                return self._events()
            if path == "/health":
                return self._json({"lines": len(feed.lines), "closed": feed.closed})
            return self._static(path)

        def _json(self, value):
            body = json.dumps(value).encode()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _events(self):
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            cursor = 0
            try:
                while True:
                    lines, cursor, closed = feed.since(cursor)
                    if lines:
                        # One frame carries a batch; the client splits on newlines.
                        payload = "".join("data: %s\n" % line for line in lines)
                        self.wfile.write((payload + "\n").encode("utf-8"))
                    elif closed:
                        self.wfile.write(b"event: done\ndata: {}\n\n")
                        self.wfile.flush()
                        return
                    else:
                        self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return

        def _static(self, path):
            if path.endswith("/"):
                path += "index.html"
            target = (SITE / path.lstrip("/")).resolve()
            if not str(target).startswith(str(SITE.resolve())):
                return self.send_error(403)
            if target.is_dir():
                target = target / "index.html"
            if not target.is_file():
                # Static export writes /demo.html for the /demo route.
                sibling = target.with_suffix(".html")
                target = sibling if sibling.is_file() else SITE / "index.html"
            if not target.is_file():
                return self.send_error(
                    404, "Build the site first: npm --prefix web run build"
                )
            body = target.read_bytes()
            kind = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--work-dir", default=".miner-work",
                        help="Miner work directory; its journal is tailed by default")
    parser.add_argument("--events",
                        help="Journal to tail, or - for standard input; defaults to <work-dir>-events.jsonl")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--allow-origin", default="http://localhost:3210",
                        help="CORS origin for `next dev`; empty string disables the header")
    args = parser.parse_args(argv)

    feed = Feed()
    if args.events is None:
        # The same path `mine.py run` writes by default, derived from the work
        # directory alone, so the two sides need no flags to agree.
        root = Path(args.work_dir).resolve()
        args.events = str(root.parent / (root.name + "-events.jsonl"))
    if args.events == "-":
        threading.Thread(target=read_stream, args=(sys.stdin.buffer, feed), daemon=True).start()
        source = "standard input"
    else:
        path = Path(args.events).resolve()
        threading.Thread(target=tail_file, args=(str(path), feed), daemon=True).start()
        source = str(path)

    server = ThreadingHTTPServer((args.host, args.port), handler_for(feed, args.allow_origin))
    server.daemon_threads = True
    print("miner-web  http://%s:%d" % (args.host, args.port), file=sys.stderr)
    print("  events   %s" % source, file=sys.stderr)
    if not SITE.is_dir():
        print("  site     not built yet — run: npm --prefix web run build", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
