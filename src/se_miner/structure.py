"""Lexical structure before sentence segmentation, with original view offsets.

This is a bounded TeX/Markdown scanner, not a TeX interpreter. Math, code and
commands are opaque to prose rules. An incomplete environment remains opaque
to EOF rather than leaking its commands into English vocabulary.
"""
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class Region:
    start: int
    end: int
    kind: str
    content: str
    closed: bool = True


COMMAND = re.compile(r"\\[A-Za-z]+\*?")
ENVIRONMENT = re.compile(r"\\(begin|end)\s*\{([^{}]+)\}")
TOKEN = re.compile(r"(?m)^\s{0,3}(`{3,}|~{3,})[^\n]*\n|`+|\\begin\s*\{[^{}]+\}|\\\[|\\\(|(?<!\\)\$\$?|\\[A-Za-z]+\*?")


def mask(text, regions, placeholder=False):
    chars = list(text)
    for r in regions:
        for i in range(r.start, r.end):
            chars[i] = " "
        if placeholder and r.end > r.start:
            chars[r.start] = "\ufffc"
    return "".join(chars)


def scan(view):
    text = view.text
    # Outermost HTML code region owns any nested inline code region.
    html_regions = sorted(((a, b, kind) for a, b, kind in view.regions
                           if kind in ("pre", "code") and b > a),
                          key=lambda r: (r[0], -r[1], r[2] != "pre"))
    regions, cursor = [], 0
    for a, b, kind in html_regions:
        if a < cursor: continue
        regions.append(Region(a, b, "code_block" if kind == "pre" else "code", text[a:b]))
        cursor = b
    hidden = mask(text, regions)
    cursor = 0
    while True:
        match = TOKEN.search(hidden, cursor)
        if match is None: break
        a, token = match.start(), match[0]
        end, content, kind, closed = match.end(), token, "command", True
        if match[1]:
            fence = match[1]
            close = re.search(r"(?m)^ {0,3}" + re.escape(fence[0]) + "{" + str(len(fence)) + r",}[ \t]*$", hidden[end:])
            b = end + close.start() if close else len(text)
            content, end, kind, closed = text[end:b], end + close.end() if close else len(text), "code_block", close is not None
        elif token.startswith("`"):
            b = hidden.find(token, end)
            if b == -1:
                cursor = end
                continue  # A literal backtick is allowed in a character question.
            content, end, kind = text[end:b], b + len(token), "code"
        elif (opener := ENVIRONMENT.match(hidden, a)) and opener[1] == "begin":
            env = opener[2]
            depth, b, stop = 1, end, None
            for boundary in ENVIRONMENT.finditer(hidden, end):
                if boundary[2] == env:
                    depth += 1 if boundary[1] == "begin" else -1
                    if depth == 0:
                        b, stop = boundary.start(), boundary.end()
                        break
            content, end, kind, closed = text[match.end():b] if stop else text[match.end():], stop or len(text), "environment", stop is not None
        elif token in ("$", "$$", "\\(", "\\["):
            close = {"$": "$", "$$": "$$", "\\(": "\\)", "\\[": "\\]"}[token]
            b = hidden.find(close, end)
            while b >= 0 and b > 0 and hidden[b - 1] == "\\" and close.startswith("$"):
                b = hidden.find(close, b + len(close))
            if b < 0 and token == "$" and re.match(r"\s+(?:mean|called|stand)\b", hidden[end:], re.I):
                cursor = end
                continue  # "What does $ mean?" asks about a literal dollar.
            content, end, kind, closed = text[end:b] if b >= 0 else text[end:], b + len(close) if b >= 0 else len(text), "math", b >= 0
        elif kind == "command":
            # Balanced arguments keep font/accent applications atomic. The
            # target layer decides whether the resulting expression is a glyph.
            arg = end
            while arg < len(hidden) and hidden[arg] == "{":
                depth, stop = 1, arg + 1
                while stop < len(hidden) and depth:
                    if hidden[stop] == "{" and hidden[stop-1] != "\\": depth += 1
                    if hidden[stop] == "}" and hidden[stop-1] != "\\": depth -= 1
                    stop += 1
                if depth: break
                end = arg = stop
            content = text[a:end]
        regions.append(Region(a, end, kind, content, closed))
        cursor = end
    outer = []
    for region in sorted(regions, key=lambda r: (r.start, -r.end)):
        if not outer or region.start >= outer[-1].end: outer.append(region)
    return outer


def prose(view, regions):
    text = mask(view.text, regions, placeholder=True)
    patterns = (r"(?<!\w)@[\w][\w.\-]*", r"(?m)^[ \t]*(?:>[ \t]*)+",
                r"(?m)^[ \t]*#{1,6}(?=\s)")
    for pattern in patterns:
        text = re.sub(pattern, lambda m: " " * len(m[0]), text)
    # Keep Markdown labels as prose, without treating the brackets as targets.
    text = re.sub(r"!?\[([^\]\n]*)\]\([^\n]*?\)",
                  lambda m: " " * (m.start(1) - m.start()) + m[1] + " " * (m.end() - m.end(1)), text)
    return text


def sentences(text):
    """Sentence boundaries only in prose; punctuation-as-object stays intact."""
    return list(re.finditer(r"[^\n.!?]+(?:[.!?](?!\s+(?!(?:mean|called|stand)\b)|$)[^\n.!?]*)*[.!?]?", text, re.I))
