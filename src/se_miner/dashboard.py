"""Terminal dashboard for `run`. Standard library only; no curses, no packages.

The renderer owns a daemon thread that repaints a bounded frame from RunState
snapshots. It touches no SQLite handle, no store and no pipeline object, so the
mining thread keeps exclusive database ownership and full transaction semantics.
"""
import atexit
import os
import shutil
import signal
import sys
import threading
import time

ENTER = "\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J"
LEAVE = "\x1b[?25h\x1b[?1049l"
STYLES = {"bold": "1", "dim": "2", "ok": "32", "warn": "33", "err": "31",
          "accent": "36", "bar": "34", "head": "1;36", "track": "90"}
STATE_TEXT = {"starting": "STARTING", "running": "RUNNING", "paused": "PAUSED",
              "complete": "COMPLETED", "complete_with_warnings": "COMPLETED · WARNINGS",
              "incomplete": "INCOMPLETE", "failed": "FAILED"}
STATE_STYLE = {"starting": "accent", "running": "accent", "paused": "warn", "complete": "ok",
               "complete_with_warnings": "warn", "incomplete": "warn", "failed": "err"}
LOG_STYLE = {"info": "dim", "warn": "warn", "error": "err"}


class Glyphs:
    ASCII_MAP = {"·": "-", "…": "...", "–": "-", "—": "-", "×": "x"}

    def __init__(self, unicode_ok=True):
        self.unicode = bool(unicode_ok)
        if unicode_ok:
            self.full, self.empty, self.rule = "█", "░", "─"
            self.done, self.active, self.pending = "✔", "▸", "·"
            self.skipped, self.failed, self.dot = "–", "✖", "●"
            self.spinner = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
            self.ellipsis = "…"
        else:
            self.full, self.empty, self.rule = "#", "-", "-"
            self.done, self.active, self.pending = "+", ">", "."
            self.skipped, self.failed, self.dot = "-", "x", "*"
            self.spinner = "|/-\\"
            self.ellipsis = "..."

    def plain(self, text):
        """Terminals that cannot encode the glyph set still get readable output."""
        if self.unicode:
            return text
        for source, target in self.ASCII_MAP.items():
            text = text.replace(source, target)
        return text.encode("ascii", "replace").decode("ascii")


class Palette:
    def __init__(self, enabled=True):
        self.enabled = bool(enabled)

    def __call__(self, text, style):
        code = STYLES.get(style or "")
        if not self.enabled or not code or not text:
            return text
        return "\x1b[%sm%s\x1b[0m" % (code, text)


def human_bytes(value):
    if value is None:
        return "n/a"
    value = float(value)
    for unit in ("B", "kB", "MB", "GB", "TB"):
        if abs(value) < 1000 or unit == "TB":
            return ("%d %s" % (value, unit)) if unit == "B" else ("%.1f %s" % (value, unit))
        value /= 1000.0


def human_count(value):
    return "n/a" if value is None else "{:,}".format(int(value))


def human_duration(seconds):
    if seconds is None:
        return "n/a"
    seconds = int(max(0, seconds))
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes, secs = divmod(rest, 60)
    stamp = "%02d:%02d:%02d" % (hours, minutes, secs)
    return ("%dd %s" % (days, stamp)) if days else stamp


def human_rate(rate, unit="rows"):
    if not rate:
        return "measuring %s/s" % unit
    if rate >= 1000:
        return "%s %s/s" % (human_count(round(rate)), unit)
    return "%.1f %s/s" % (rate, unit)


def fit(text, width, glyphs=None):
    """Shorten from the left so a path keeps the filename that identifies it."""
    text = str(text or "")
    if width <= 0:
        return ""
    if len(text) <= width:
        return text
    mark = (glyphs or Glyphs()).ellipsis
    return (mark + text[-(width - len(mark)):]) if width > len(mark) else text[-width:]


def bar(fraction, width, glyphs):
    width = max(1, int(width))
    filled = max(0, min(width, int(round((fraction or 0.0) * width))))
    return glyphs.full * filled + glyphs.empty * (width - filled)


def indeterminate(width, tick, glyphs):
    """A sliding block: honest motion for a pass with no trustworthy denominator."""
    width = max(1, int(width))
    span = max(2, width // 6)
    if span >= width:
        return glyphs.full * width
    travel = (width - span) * 2
    position = tick % travel
    if position > width - span:
        position = travel - position
    return glyphs.empty * position + glyphs.full * span + glyphs.empty * (width - span - position)


def bar_chunks(fraction, width, glyphs, style="ok"):
    width = max(1, int(width))
    filled = max(0, min(width, int(round((fraction or 0.0) * width))))
    return [(glyphs.full * filled, style), (glyphs.empty * (width - filled), "track")]


def indeterminate_chunks(width, tick, glyphs, style="accent"):
    width = max(1, int(width))
    span = max(2, width // 6)
    if span >= width:
        return [(glyphs.full * width, style)]
    travel = (width - span) * 2
    position = tick % travel
    if position > width - span:
        position = travel - position
    return [(glyphs.empty * position, "track"), (glyphs.full * span, style),
            (glyphs.empty * (width - span - position), "track")]


def render_line(chunks, width, palette, glyphs=None):
    out, used, limit = [], 0, max(1, width - 1)
    for text, style in chunks:
        if used >= limit:
            break
        text = glyphs.plain(str(text)) if glyphs is not None else str(text)
        piece = text[:limit - used]
        used += len(piece)
        out.append(palette(piece, style))
    return "".join(out)


def _header(s, w, g, p):
    state = STATE_TEXT.get(s["status"], str(s["status"]).upper())
    elapsed = "elapsed " + human_duration(s["elapsed"])
    left = " Stack Exchange symbol miner"
    gap = max(2, w - len(left) - len(elapsed) - len(state) - 4)
    first = [(left, "head"), (" " * gap, None), (elapsed, "dim"), ("  ", None),
             (state, STATE_STYLE.get(s["status"], "accent"))]
    # Keep the release whole; shorten then drop the paths instead of leaving a
    # meaningless fragment like ".../generator/.m" on screen.
    text, sep, avail = s["release"] or "unpinned", "  ·  ", w - 3
    for value in (s["manifest"], s["work_dir"]):
        if not value:
            continue
        for candidate in (str(value), str(value).rsplit("/", 1)[-1]):
            if len(text) + len(sep) + len(candidate) <= avail:
                text += sep + candidate
                break
    return [first, [(" " + text, "dim")], [(g.rule * max(1, w - 1), "dim")]]


def _overall(s, w, g, p):
    o = s["overall"]
    fraction = (o["stages"] / o["stages_total"]) if o["stages_total"] else 0.0
    label = " Progress  "
    # Deliberately counted work, never an estimate of bytes or processing time.
    text = "  %d/%d stages · %d/%d sites complete" % (
        o["stages"], o["stages_total"], o["sites"], o["sites_total"])
    inner = max(8, min(44, w - len(label) - len(text) - 4))
    return [[(label, "bold"), ("[", "dim")] + bar_chunks(fraction, inner, g, "accent")
            + [("]", "dim"), (text, None)], []]


def _sites(s, w, g, p):
    rows = s["sites"]
    if not rows:
        return []
    glyphs = {"complete": (g.done, "ok"), "active": (g.active, "accent"),
              "pending": (g.pending, "dim"), "skipped": (g.skipped, "dim"),
              "failed": (g.failed, "err")}
    namew = min(32, max(len(r["site"]) for r in rows))
    lines = [[(" Sites", "bold")]]
    for row in rows:
        mark, style = glyphs.get(row["status"], (g.pending, "dim"))
        detail = row["stage"] or row["note"] or ""
        if not detail and row["missing_optional"]:
            detail = "no " + ", ".join(row["missing_optional"])
        lines.append([("  ", None), (mark, style), (" ", None),
                      (fit(row["site"], namew, g).ljust(namew), None),
                      ("  ", None), (row["status"].ljust(8), style),
                      ("  %d/%d  " % (row["done"], row["planned"]), "dim"),
                      (detail, "dim")])
    lines.append([])
    return lines


def _active(s, w, g, p, tick):
    active = s["active"]
    if not active:
        note = "Starting up" if s["status"] == "starting" else "No stage running"
        return [[("  ", None), (note + g.ellipsis, "dim")], []]
    spin = g.spinner[tick % len(g.spinner)] if s["status"] in ("starting", "running") else g.done
    head = [("  ", None), (spin, "accent"), (" ", None), (active["site"], "accent"),
            ("  ·  ", "dim"), (active["label"], "bold")]
    if active["replaying"]:
        head.append(("  ·  replaying committed rows", "warn"))
    unit, moving, style = active["unit"], False, "ok"
    if active["replaying"]:
        text = "  %s / %s replayed · %s" % (
            human_count(active["replayed"]), human_count(active["replay_target"]),
            human_rate(active["replay_rate"], unit))
        style = "warn"
    elif active["total"]:
        text = "  %s · %s / %s · %s" % (
            "%.1f%%" % (100 * (active["percent"] or 0)), human_count(active["observed"]),
            human_count(active["total"]), human_rate(active["rate"], unit))
    elif active["observed"]:
        # The sliding bar is the statement that no denominator exists; saying so
        # in words as well only crowds the line.
        text = "  %s %s · %s" % (human_count(active["observed"]), unit,
                                 human_rate(active["rate"], unit))
        moving = True
    else:
        text = "  " + str(active["note"] or s["network"]["note"] or "working")
        moving = True
    if active["eta"] is not None:
        text += " · ETA " + human_duration(active["eta"])
    inner = max(8, min(44, w - len(text) - 6))
    art = (indeterminate_chunks(inner, tick, g) if moving
           else bar_chunks(active["percent"], inner, g, style))
    bar_line = [("   ", None), ("[", "dim")] + art + [("]", "dim"), (text, None)]
    lines = [head, bar_line]
    # A committed ordinal only means anything for a row scan.
    if unit == "rows":
        detail = "   committed %s · new this run %s" % (
            human_count(active["committed"]), human_count(s["rows_this_run"]))
        if active["committed_at"]:
            detail += " · last checkpoint " + time.strftime("%H:%M:%S", time.localtime(active["committed_at"]))
        if active["note"]:
            detail += " · " + active["note"]
        lines.append([(detail, "dim")])
    lines.append([])
    return lines


def _counters(s, w, g, p):
    m, storage, net = s["metrics"], s["storage"], s["network"]
    lines = [[(" candidates ", "dim"), (human_count(m["candidates"]), None),
              ("   documents ", "dim"), (human_count(m["documents"]), None),
              ("   discovery hits ", "dim"), (human_count(m["discovery_hits"]), None)]]
    used, limit = storage["used"], storage["limit"]
    fraction = (used / limit) if (used is not None and limit) else 0.0
    label = " storage    "
    text = "  %s / %s" % (human_bytes(used), human_bytes(limit))
    if limit:
        text += "  (%.0f%%)" % (100 * fraction)
    inner = max(8, min(24, w - len(label) - len(text) - 4))
    style = "err" if fraction > 0.95 else "warn" if fraction > 0.8 else "ok"
    lines.append([(label, "dim"), ("[", "dim")] + bar_chunks(fraction, inner, g, style)
                 + [("]", "dim"), (text, None)])
    live = net["last"] is not None and (s["idle"] < 2.0)
    activity = [((" " + g.dot + " active") if live else "  idle", "ok" if live else "dim")]
    lines.append([(" network    ", "dim"), (human_count(net["requests"]), None),
                  (" requests · ", "dim"), (human_bytes(net["bytes"]), None),
                  (" transferred", "dim")] + activity +
                 ([("  · " + str(net["note"]), "warn")] if net.get("note") else []))
    lines.append([])
    return lines


def _log(s, w, height, g, p):
    if height < 1:
        return []
    # On a very short terminal one live line beats a heading with nothing under it.
    lines = [[(" Recent activity", "bold")]] if height > 1 else []
    for entry in list(s["log"])[-(height - len(lines)):]:
        stamp = time.strftime("%H:%M:%S", time.localtime(entry["at"]))
        lines.append([("  " + stamp + "  ", "dim"),
                      (entry["text"], LOG_STYLE.get(entry["level"], "dim"))])
    return lines


def frame(snapshot, width, height, tick=0, glyphs=None, palette=None):
    """Build one complete screen. Pure function of the snapshot: trivially testable."""
    g = glyphs if glyphs is not None else Glyphs()
    p = palette if palette is not None else Palette(False)
    width, height = max(24, int(width)), max(4, int(height))
    blocks = [(0, _header(snapshot, width, g, p)),
              (2, _overall(snapshot, width, g, p)),
              (4, _sites(snapshot, width, g, p)),
              (1, _active(snapshot, width, g, p, tick)),
              (3, _counters(snapshot, width, g, p))]
    order = [0, 1, 2, 3, 4]  # header, overall, sites, active, counters
    keep = [i for i in range(len(blocks)) if blocks[i][1]]
    log_min = 1
    while keep:
        used = sum(len(blocks[i][1]) for i in keep)
        if used + log_min <= height:
            break
        worst = max(keep, key=lambda i: blocks[i][0])
        if blocks[worst][0] == 0:
            break
        keep.remove(worst)
    lines = []
    for index in order:
        if index in keep:
            lines.extend(blocks[index][1])
    lines = lines[:height]
    lines.extend(_log(snapshot, width, height - len(lines), g, p))
    return [render_line(chunks, width, p, g) for chunks in lines[:height]]


def final_summary(snapshot, palette=None, resume=None, glyphs=None):
    """Printed to the normal screen once the live display is gone."""
    p = palette if palette is not None else Palette(False)
    s = snapshot
    state = STATE_TEXT.get(s["status"], str(s["status"]).upper())
    o, m, disk = s["overall"], s["metrics"], s["storage"]
    out = ["", p("Miner " + state, STATE_STYLE.get(s["status"], "accent"))]
    if s["reason"]:
        out.append("  " + s["reason"])
    out.append("  elapsed %s · %d/%d sites · %d/%d stages · %s new rows this run"
               % (human_duration(s["elapsed"]), o["sites"], o["sites_total"],
                  o["stages"], o["stages_total"], human_count(s["rows_this_run"])))
    out.append("  candidates %s · documents %s · discovery hits %s"
               % (human_count(m["candidates"]), human_count(m["documents"]),
                  human_count(m["discovery_hits"])))
    out.append("  storage %s of %s · network %s requests, %s"
               % (human_bytes(disk["used"]), human_bytes(disk["limit"]),
                  human_count(s["network"]["requests"]), human_bytes(s["network"]["bytes"])))
    flagged = {k: v for k, v in (s["warnings"] or {}).items() if v}
    if flagged:
        out.append(p("  coverage warnings: " + ", ".join("%s=%s" % kv for kv in sorted(flagged.items())), "warn"))
    for entry in [e for e in s["log"] if e["level"] in ("warn", "error")][-6:]:
        out.append(p("  " + time.strftime("%H:%M:%S", time.localtime(entry["at"])) + "  " + entry["text"],
                     LOG_STYLE.get(entry["level"], "dim")))
    if resume:
        out.append("  resume with: " + resume)
    out.append("")
    text = "\n".join(out)
    return glyphs.plain(text) if glyphs is not None else text


def unicode_ok(stream):
    encoding = getattr(stream, "encoding", None) or ""
    try:
        "█░✔▸⠋".encode(encoding or "ascii")
        return True
    except (LookupError, UnicodeEncodeError, TypeError):
        return False


def color_ok(stream):
    if os.environ.get("NO_COLOR"):
        return False
    try:
        return bool(stream.isatty())
    except Exception:
        return False


def ui_available(stream=None, disabled=False):
    stream = sys.stderr if stream is None else stream
    if disabled or os.environ.get("MINER_NO_UI"):
        return False
    try:
        if not stream.isatty():
            return False
    except Exception:
        return False
    return os.environ.get("TERM", "") not in ("", "dumb")


class Dashboard:
    def __init__(self, state, stream=None, interval=0.1, color=None, unicode_glyphs=None):
        self.state = state
        self.stream = sys.stderr if stream is None else stream
        self.interval = interval
        self.palette = Palette(color_ok(self.stream) if color is None else color)
        self.glyphs = Glyphs(unicode_ok(self.stream) if unicode_glyphs is None else unicode_glyphs)
        self.tick = 0
        self.failures = 0
        self.error = None
        self.running = False
        self._stop = threading.Event()
        self._thread = None
        self._lock = threading.Lock()
        self._previous = {}

    def start(self):
        if self.running:
            return self
        self.running = True
        self._stop.clear()
        atexit.register(self.stop)
        # SIGINT is deliberately untouched: pause/rollback semantics stay as they are.
        for number in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGHUP", None)):
            if number is None:
                continue
            try:
                self._previous[number] = signal.signal(number, self._on_signal)
            except (ValueError, OSError, RuntimeError):
                pass
        self._write(ENTER)
        self._thread = threading.Thread(target=self._loop, name="miner-dashboard", daemon=True)
        self._thread.start()
        return self

    def stop(self):
        if not self.running:
            return
        self.running = False
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=1.5)
        for number, handler in self._previous.items():
            try:
                signal.signal(number, handler)
            except (ValueError, OSError, RuntimeError, TypeError):
                pass
        self._previous.clear()
        self._write(LEAVE)
        try:
            atexit.unregister(self.stop)
        except Exception:
            pass

    def _on_signal(self, number, _frame):
        self.stop()
        try:
            signal.signal(number, self._previous.get(number, signal.SIG_DFL) or signal.SIG_DFL)
        except (ValueError, OSError, RuntimeError, TypeError):
            pass
        os.kill(os.getpid(), number)

    def _write(self, text):
        with self._lock:
            try:
                self.stream.write(text)
                self.stream.flush()
            except (OSError, ValueError):
                self.running = False

    def _loop(self):
        while not self._stop.wait(self.interval):
            try:
                self.paint()
                self.failures = 0
            except Exception as error:  # a display defect must never abort mining
                self.failures += 1
                self.error = error
                if self.failures >= 3:
                    self.stop()
                    return

    def paint(self):
        size = shutil.get_terminal_size((80, 24))
        lines = frame(self.state.snapshot(), size.columns, size.lines, self.tick,
                      self.glyphs, self.palette)
        self.tick += 1
        self._write("\x1b[H" + "\x1b[K\n".join(lines) + "\x1b[K\x1b[J")

    def __enter__(self):
        return self.start()

    def __exit__(self, *_args):
        self.stop()
