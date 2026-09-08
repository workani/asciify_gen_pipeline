"""Searchable text with reversible source-span mapping; no Unicode normalization."""
import bisect
import html
from html.parser import HTMLParser
import re

URL = re.compile(r"(?:https?://|www\.)[^\s<>\"\]]+", re.I)


class View:
    def __init__(self, source, field):
        self.source, self.field = source, field
        self.parts, self.spans, self.ends = [], [], []
        self.length, self.images = 0, []
        self.regions = []

    def append(self, text, start, end):
        if not text: return
        self.parts.append(text)
        self.spans.append((self.length, self.length + len(text), start, end))
        self.length += len(text)
        self.ends.append(self.length)

    def finish(self):
        self.text = "".join(self.parts)
        self.text = URL.sub(lambda m: " " * len(m[0]), self.text)
        return self

    def evidence(self, rule, start, end, **extra):
        first = self.spans[bisect.bisect_right(self.ends, start)]
        last = self.spans[bisect.bisect_left(self.ends, end)]
        raw_start = first[2] + start - first[0] if first[1] - first[0] == first[3] - first[2] else first[2]
        raw_end = last[2] + end - last[0] if last[1] - last[0] == last[3] - last[2] else last[3]
        return {"rule": rule, "field": self.field, "start": raw_start, "end": raw_end,
                "text": self.source[raw_start:raw_end], "display_text": self.text[start:end],
                "view_start": start, "view_end": end, **extra}


class HTMLView(HTMLParser):
    BLOCK = {"p", "div", "br", "li", "pre", "blockquote", "h1", "h2", "h3", "hr", "tr"}
    def __init__(self, source, field):
        super().__init__(convert_charrefs=False)
        self.view = View(source, field)
        self.lines = [0] + [m.end() for m in re.finditer("\n", source)]
        self.hidden = 0
        self.region_stack = []
        self.feed(source)
        self.close()
        for tag, start in self.region_stack:
            self.view.regions.append((start, self.view.length, tag))
        self.view.finish()

    def source_offset(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        pos = self.source_offset()
        if tag in ("script", "style"): self.hidden += 1
        if self.hidden: return
        if tag in self.BLOCK: self.view.append("\n", pos, pos)
        if tag in ("pre", "code", "blockquote"):
            self.region_stack.append((tag, self.view.length))
        if tag == "img":
            raw = self.get_starttag_text()
            self.view.images.append({"rule": "image", "field": self.view.field, "start": pos, "end": pos + len(raw), "text": raw})
            alt = re.search(r"\balt\s*=\s*([\"'])(.*?)\1", raw, re.I | re.S)
            if alt:
                self.view.append(html.unescape(alt[2]), pos + alt.start(2), pos + alt.end(2))

    def handle_startendtag(self, tag, attrs): self.handle_starttag(tag, attrs)
    def handle_endtag(self, tag):
        for index in range(len(self.region_stack) - 1, -1, -1):
            name, start = self.region_stack[index]
            if name == tag:
                self.view.regions.append((start, self.view.length, name))
                del self.region_stack[index:]
                break
        if tag in ("script", "style"): self.hidden = max(0, self.hidden - 1)
        if tag in self.BLOCK and not self.hidden:
            pos = self.source_offset(); self.view.append("\n", pos, pos)
    def handle_data(self, text):
        if not self.hidden:
            pos = self.source_offset(); self.view.append(text, pos, pos + len(text))
    def handle_entityref(self, name): self.entity("&" + name + ";")
    def handle_charref(self, name): self.entity("&#" + name + ";")
    def entity(self, token):
        if not self.hidden:
            pos = self.source_offset()
            actual = token if self.view.source[pos:pos + len(token)] == token else token[:-1]
            self.view.append(html.unescape(actual), pos, pos + len(actual))


def make_view(source, field="Text", is_html=False):
    if is_html:
        return HTMLView(source, field).view
    view = View(source, field)
    for match in re.finditer(r"!\[[^\]]*\]\([^\n]*?\)", source):
        view.images.append({"rule": "image", "field": field, "start": match.start(), "end": match.end(), "text": match[0]})
    cursor = 0
    for match in re.finditer(r"&(?:#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);", source):
        view.append(source[cursor:match.start()], cursor, match.start())
        view.append(html.unescape(match[0]), match.start(), match.end())
        cursor = match.end()
    view.append(source[cursor:], cursor, len(source))
    return view.finish()


def views(fields):
    return [make_view(text, field, field == "Body") for field, text in fields.items() if text and field != "Tags"]
