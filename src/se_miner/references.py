"""Validate character notation; never infer the question's intended target."""
import re
import unicodedata

LABEL = re.compile(r"(?<!\w)[Uu]\+([0-9a-fA-F]{4,8})(?![0-9a-fA-F])")
ESCAPE = re.compile(r"\\(?:u\{[0-9a-fA-F]{1,8}\}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})")
NAME = re.compile(r"\b(?:LATIN|GREEK|CYRILLIC|ARABIC|HEBREW) (?:CAPITAL |SMALL )?LETTER [A-Z][A-Z -]{0,90}\b")


def scalar(cp): return 0 <= cp <= 0x10FFFF and not 0xD800 <= cp <= 0xDFFF
def token(cp): return "cp%06x" % cp


def explicit_references(text):
    for match in LABEL.finditer(text):
        cp = int(match[1], 16)
        if scalar(cp): yield match.start(), match.end(), cp, "codepoint"
    # Bare hexadecimal numbers are common in code. Require a Unicode label
    # in the same short clause before treating hexadecimal as a reference.
    for match in re.finditer(r"(?i)\bunicode\b[^.?!\n]{0,80}?\b(0x[0-9a-f]{2,8})\b", text):
        cp = int(match[1], 16)
        if scalar(cp): yield match.start(1), match.end(1), cp, "codepoint"
    # Validate names against the runtime UCD; uppercase resemblance alone is not
    # evidence. Runtime Unicode version is pinned in the projection contract.
    for match in NAME.finditer(text):
        name = match[0].rstrip()
        while name:
            try:
                glyph = unicodedata.lookup(name)
                if len(glyph) == 1:
                    yield match.start(), match.start() + len(name), ord(glyph), "unicode_name"
                    break
            except KeyError: pass
            name = name.rsplit(" ", 1)[0] if " " in name else ""
    escapes = list(ESCAPE.finditer(text))
    i = 0
    while i < len(escapes):
        match = escapes[i]
        cp = int(match[0][2:].strip("{}"), 16)
        end = match.end()
        if 0xD800 <= cp <= 0xDBFF and i + 1 < len(escapes) and escapes[i + 1].start() == end:
            next_match = escapes[i + 1]
            low = int(next_match[0][2:].strip("{}"), 16)
            if 0xDC00 <= low <= 0xDFFF:
                cp = 0x10000 + ((cp - 0xD800) << 10) + low - 0xDC00
                end = next_match.end(); i += 1
        if scalar(cp): yield match.start(), end, cp, "unicode_escape"
        i += 1


def index_tokens(text):
    glyphs = " ".join(token(cp) for cp in sorted(set(map(ord, text))) if scalar(cp))
    refs = " ".join(token(cp) for cp in sorted({r[2] for r in explicit_references(text)}))
    return glyphs, refs
