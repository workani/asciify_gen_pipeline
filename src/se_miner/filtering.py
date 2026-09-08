"""Discovery v6: structure → typed mentions → bound evidence → decision.

KEEP and REVIEW are retained separately; neither resolves a Unicode target.
No model calls, source-ID allowlists, or reference labels are used at runtime.
"""
import ast
import hashlib
from pathlib import Path
import re

from .references import explicit_references
from .structure import scan, prose, sentences
from .targets import inventory, WRITING, NAME, MARK, ACCENT
from .textviews import make_view, views

VERSION = "target-evidence-6"
RULE_FILES = ("filtering.py", "structure.py", "targets.py", "textviews.py", "references.py")


def _semantic_source(path):
    """Structure only. Comments, docstrings and formatting cannot change how a
    document is classified, but hashing raw bytes over them invalidates the
    work-directory contract and strands a run mid-scan. Every real change to a
    pattern, threshold or branch still moves the hash."""
    def is_prose(statement):
        # A bare string statement is a docstring or a stray note. Either way it
        # is evaluated and discarded, so it cannot affect classification.
        return (isinstance(statement, ast.Expr) and isinstance(getattr(statement, "value", None), ast.Constant)
                and isinstance(statement.value.value, str))

    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        for field in ("body", "orelse", "finalbody"):
            block = getattr(node, field, None)
            if isinstance(block, list):
                setattr(node, field, [s for s in block if not is_prose(s)])
    return ast.dump(tree, annotate_fields=True, include_attributes=False)


RULE_HASH = hashlib.sha256("\x00".join(
    _semantic_source(Path(__file__).parent / name) for name in RULE_FILES).encode()).hexdigest()

# Frames expose an object start. Acceptance checks its typed prefix, never
# an arbitrary topic elsewhere in the sentence.
FRAMES = [
    ("name", re.compile(r"(?i)\b(?:(?:name|names|command|code)\s+(?:of|for)|term\s+for)\s+")),
    ("identify", re.compile(r"(?i)\b(?:identify|identifying|recogni[sz]e|recogni[sz]ing|call)\s+(?!it\s+as\b)")),
    ("identify", re.compile(r"(?i)\b(?:what(?:\s+(?:is|are|was)|['’]?s)\s+|what\s+(?=(?:symbols?|glyphs?|characters?|fonts?|letters?)\b))")),
    ("meaning", re.compile(r"(?i)\bwhat\s+(?:exactly\s+)?(?:does|do)\s+")),
    ("origin", re.compile(r"(?i)\bwhere\s+(?:does|did|do)\s+")),
    ("meaning", re.compile(r"(?i)\bmeaning\s+of\s+")),
    ("identify", re.compile(r"(?i)\bwhat\s+(?=(?:this|that|these|those)\s+(?:symbol|glyph|letter|character))")),
    ("keyboard", re.compile(r"(?i)^\s*which\s+(?=(?:character|symbol|key)\b)")),
    ("usage", re.compile(r"(?i)\bwhy\s+(?:is|are)\s+")),
    ("type", re.compile(r"(?i)\b(?:how\s+(?:(?:do|can|could|would|should)\s+(?:I|you|we|one)\s+|to\s+))?(?:type|typeset|insert|enter|render|produce|reproduce|print|write|draw|make|get)\s+")),
    ("find", re.compile(r"(?i)\b(?:looking\s+for|searching\s+for|find|need|want)\s+")),
]
PREFIX = re.compile(r"(?i)^(?:(?:a|an|the|this|that|these|those|such|some|certain|particular|weird|strange|unknown|unusual|special|mathematical|math|latex|tex|unicode|proper|technical|old|archaic|written|printed|large|small|big|capital|lowercase|uppercase|double|vertical|horizontal|rotated|filled|black|white|open|closed|in|of|for|with|on|right|left|upside|down|readymade|version|kind|sort|number|digit|name)\b|[0-9]+|[\s\"'`“”‘’:\-(),/]|\ufffc)*$")
REQUEST_WORDS = re.compile(r"(?i)\b(?:what|which|how|identify|recogni[sz]e|name|called|looking for|find|need|want|request|anyone|somebody|someone)\b")
UNCERTAINTY = re.compile(r"(?i)\b(?:can(?:not|'t|’t|t)|could(?:n't|n’t)|could not|don't|do not|doesn't|didn't|not sure|not found|no idea|unfamiliar|unknown|unusual|weird|strange|mysterious|never (?:encountered|seen)|unable)\b")
SEARCH_FAILURE = re.compile(r"(?i)\b(?:Detexify|Shapecatcher|symbol(?:s)? list|list of (?:TeX |LaTeX )?symbols|comprehensive.*?symbols)\b")
MEANING = re.compile(r"(?i)\b(?:mean(?:ing)?|stand(?:s)? for|represent(?:s)?|denote(?:s)?|signif\w*|pronounc\w*|history|origin)\b")
TRANSFORM = re.compile(r"(?i)\b(?:upside[- ]down|rotat\w*|mirror\w*|flipp\w*|backwards?|sideways?|square version|squiggly|curly|cursive|calligraphic|fraktur|gothic|double[- ](?:lined|struck)|blackboard[- ]bold)\b")
RELATION = re.compile(r"(?i)^\s*(?:(?:is|are|was|were|often|also|usually|commonly)\s+)*(?:called|named)\s+")
NON_TARGET_NAME = re.compile(r"(?i)\b(?:function|map|derivation|point|root|eigenvalue|variable|parameter|sequence|space|module|group|set|matrix|angle|partition|value|number)\b")
ABSTRACT_OBJECT = re.compile(r"(?i)\b(?:function|proof|argument|matrix|module|space|point|map|derivation|equation|proposition|theorem|sentence|word|phrase|app|program|variable|set|value|number|meaning|history|origin)\b")


def object_prefix(prefix, target):
    if len(prefix) > 100 or "\ufffc" in prefix: return False
    if PREFIX.fullmatch(prefix): return True
    # A compound glyph description is bounded vocabulary, not an arbitrary
    # five-word gap (which admitted "find an expansion of the symbol").
    return target.kind == "subject" and re.fullmatch(
        r"(?i)(?:(?:the|a|an|logical|equivalence|multiplication|division|percent|transpose|Greek)\s+)+", prefix) is not None


def appearance_link(text, target, start, end):
    """Appearance must modify this target, not another object in its sentence."""
    before, after = text[start:target.start], text[target.end:end]
    right = re.match(r"(?i)\s*[,;]?\s*(?:(?:that|which|it|is|was|are|has)\s+)*(looks? like|similar to|resembles?|shaped|with (?:an? |the )?(?:tail|curl|hook|stroke|bar|dot))\b", after)
    if right:
        # "looks like it looks" is an analogy, not a description.
        if right[1].lower().startswith("look") and re.match(r"(?i)\s+(?:it|this|that)\b", after[right.end():]): return None
        return target.end + right.start(), target.end + right.end()
    for match in TRANSFORM.finditer(before):
        modifier = before[match.end():]
        if PREFIX.fullmatch(modifier) or target.kind == "subject" and re.fullmatch(r"(?i)\s+real numbers?\s+", modifier):
            return start + match.start(), start + match.end()
    return None


def bound_frame(operation, frame, fragment, prefix, target, tail, writing):
    """Separate operations on glyphs from computation using variables."""
    atomic = target.kind in ("letter", "command", "styled_glyph", "literal")
    if atomic and re.search(r"\d", prefix): return False
    if operation == "keyboard": return bool(re.search(r"(?i)\bkeyboard\b", tail))
    if operation == "usage": return target.kind == "subject" and writing and bool(re.match(r"(?i)\s+used\b", tail))
    if operation == "origin":
        return bool(re.search(r"(?i)\b(?:originat\w*|come from)\b", tail))
    if operation == "meaning":
        return target.kind != "letter" and bool(MEANING.search(tail))
    if operation in ("name", "identify"):
        if atomic:
            if target.kind == "literal":
                value = fragment[frame.end()+len(prefix):].lstrip()
                if re.match(r"[\"'`“”‘’:/()\-]+\s", value): return False
            # A variable/styled variable's mathematical identity is not a name
            # request. An explicit glyph head after it disambiguates.
            if target.kind in ("letter", "styled_glyph"):
                return bool(re.search(r"(?i)^\s*[\"'`]?\s*(?:symbol|glyph|letter)\b", tail))
            if target.kind == "command" and operation == "identify":
                return bool(re.search(r"(?i)^\s*[\"'`]?\s*(?:called|named|symbol|glyph|letter)\b", tail))
            if target.kind == "command" and (ABSTRACT_OBJECT.search(tail) or re.match(r"\s+formula\b", tail)): return False
        if target.kind == "mark_name" and re.match(r"(?i)^\s*[?!.,]?\s*$", tail) and not re.search(r"(?i)\b(?:a|an)\b", prefix):
            # "What is sigma?" asks about a known named quantity. "What is
            # this arrow?" retains a deictic request for an unidentified mark.
            return bool(re.search(r"(?i)\b(?:this|that|these|those)\b", prefix)) or operation == "name"
        return True
    if operation == "find":
        # Finding p, an open U, or a suitable character of a group is computation.
        # Discovery needs a described glyph or a tightly bound glyph noun.
        if atomic or target.kind == "mark_name": return False
        return (target.kind in ("shape", "invisible") or
                target.kind == "subject" and PREFIX.fullmatch(prefix) is not None)
    if operation == "type":
        strong = re.search(r"(?i)\b(?:type|typeset|insert|enter)\b", frame[0])
        interrogative = re.search(r"(?i)\b(?:how\s+(?:(?:do|can|could|would|should)\s+(?:I|you|we|one)\s+|to\s+)?|can\s+(?:I|you|we|one|anyone)\s+)$", fragment[:frame.start()]) or frame[0].lower().startswith("how")
        if not (interrogative or writing): return False
        if not strong and not writing:
            if atomic or target.kind == "mark_name": return False
            if not re.search(r"(?i)\b(?:this|that|these|those)\b", prefix): return False
        if strong and frame[0].lower().strip() == "type" and not interrogative: return False
        if target.kind == "letter" and not strong: return False
        return True
    return True
TAGS = {"unicode", "symbols", "symbol-identification", "identify-this-symbol", "special-characters", "punctuation", "diacritics", "typography"}


def classify(fields, threshold=3, source_role="unknown"):
    documents = [(v, scan(v)) for v in views(fields)]
    documents = [(v, regions, prose(v, regions)) for v, regions in documents]
    signals, bindings, facets = [], [], set()
    keep_routes, reviews = set(), set()
    all_text = "\n".join(p for _, _, p in documents)
    has_image = any(v.images for v, _, _ in documents)
    has_writing = bool(WRITING.search(all_text))

    def signal(view, rule, start, end, **extra):
        value = view.evidence(rule, start, end, **extra)
        if value not in signals: signals.append(value)
        return {k: value[k] for k in ("field", "start", "end")}

    def bind(view, target, operation, start, end, route="character_request", review=False):
        rule = {"shape": "character_shape", "command": "latex_symbol", "styled_glyph": "target_glyph",
                "letter": "target_glyph", "literal": "target_glyph", "subject": "request_subject",
                "invisible": "invisible_character", "character_name": "character_name"}.get(target.kind, "request_subject")
        target_span = signal(view, rule, target.start, target.end)
        operation_span = signal(view, "review_required" if review else "request_frame", start, end)
        bindings.append({"operation": operation, "target_kind": target.kind,
                         "target": target_span, "evidence": operation_span,
                         "decision": "review" if review else "keep"})
        (reviews if review else keep_routes).add("usage_context" if review else route)
        facets.add(operation)

    for view, regions, text in documents:
        targets = inventory(view, regions, text)
        # References are evidence mentions, never inferred target IDs. Formula
        # and fenced-code contents cannot seed discovery through Unicode escapes.
        reference_view = list(text)
        for region in regions:
            if region.kind == "code" and len(region.content) <= 100:
                reference_view[region.start:region.end] = view.text[region.start:region.end]
            elif region.kind == "command" and re.match(r"\\[uU]", region.content):
                reference_view[region.start:region.end] = view.text[region.start:region.end]
        for a, b, cp, rule in explicit_references("".join(reference_view)):
            signal(view, rule, a, b, code_point=cp)
            keep_routes.add("identity_evidence")
        for unit in sentences(text):
            start, end = unit.span()
            fragment = unit[0]
            local = [t for t in targets if start <= t.start < end]
            subject = any(t.kind == "subject" for t in local)
            request = bool(REQUEST_WORDS.search(fragment))
            for t in local:
                if t.kind == "shape":
                    bind(view, t, "appearance", t.start, t.end)
                elif t.kind == "invisible":
                    bind(view, t, "identify" if request else "description", t.start, t.end,
                         "character_request" if request else "character_discussion")
            for operation, pattern in FRAMES:
                for frame in pattern.finditer(fragment):
                    obj = start + frame.end()
                    for t in local:
                        if t.start < obj: continue
                        prefix = text[obj:t.start]
                        if not object_prefix(prefix, t): break
                        tail = text[t.end:end]
                        if frame[0].lower().strip() == "call" and not re.search(r"(?i)\b(?:what|how)\b", fragment[:frame.start()]): break
                        writing = bool(WRITING.search(fragment)) or operation == "usage" and has_writing or bool(re.search(r"(?i)\bcode\b", fragment) and any(x.kind == "command" for x in local))
                        if not bound_frame(operation, frame, fragment, prefix, t, tail, writing): break
                        route = "character_discussion" if operation == "type" and source_role == "answer" and not re.search(r"(?i)\bhow\b", fragment) else "character_request"
                        bind(view, t, operation, start + frame.start(), obj, route, review=operation == "usage")
                        break
            # A subject linked to appearance remains useful for custom symbols.
            for t in local:
                if t.kind != "subject": continue
                link = appearance_link(text, t, start, end)
                if link: bind(view, t, "appearance", *link)
                if re.fullmatch(r"(?i)emoticons?|emoji", text[t.start:t.end]):
                    depiction = re.match(r"(?i)\s+(?:represents?|depicts?)\s+.*?\b(?:face|expression)\b", text[t.end:end])
                    if depiction: bind(view, t, "depiction", t.end, t.end+depiction.end(), "character_discussion")
            accent = ACCENT.search(fragment)
            if accent and WRITING.search(fragment) and re.search(r"(?i)\b(?:how|denote|type|write|render)\b", fragment):
                signal(view, "accent_description", start+accent.start(), start+accent.end())
                keep_routes.add("character_request"); facets.add("appearance")
            if view.field == "Title":
                for t in local:
                    if t.kind in ("styled_glyph", "command"):
                        link = appearance_link(text, t, start, end)
                        if link: bind(view, t, "appearance", *link)
            if view.field == "Title" and subject and UNCERTAINTY.search(fragment):
                t = next(t for t in local if t.kind == "subject")
                bind(view, t, "identify", start, end)
            failure = SEARCH_FAILURE.search(fragment)
            if failure and (UNCERTAINTY.search(fragment) or re.search(r"(?i)\b(?:tried|fail\w*|no luck|nothing|unsuccessful|no success|no avail)\b", fragment)):
                signal(view, "lookup_failure", start + failure.start(), start + failure.end())
                keep_routes.add("character_request"); facets.add("lookup_failure")
            # Check what is being named, not just the naming verb.
            for t in local:
                relation = RELATION.match(text[t.end:end])
                if relation:
                    rhs = text[t.end+relation.end():end].strip()
                    glyph_name = NAME.search(rhs) or MARK.search(rhs) or re.search(r"(?i)\b(?:sign|symbol|letter|glyph)\b", rhs)
                    if rhs and not NON_TARGET_NAME.search(rhs) and (t.kind in ("subject", "mark_name", "character_name") or glyph_name or t.kind == "command" and re.fullmatch(r"[A-Za-z-]+[.!]?", rhs)):
                        bind(view, t, "name", t.end, t.end+relation.end(), "character_discussion")
                # "Braces, {}, often called curly brackets" keeps a bounded
                # literal apposition, while "comma in a clause called ..." fails.
                if t.kind == "mark_name":
                    apposition = re.match(r"\s*,\s*[{}\[\](),]+\s*,?\s*(?:often |also )?called\s+", text[t.end:end], re.I)
                    if apposition and MARK.search(text[t.end+apposition.end():end]):
                        bind(view, t, "name", t.end, t.end+apposition.end(), "character_discussion")
            named = NAME.search(fragment)
            if named and re.search(r"(?i)\b(?:is|it's|it’s|that’s|called|named|use|type|typing|create|insert)\b", fragment):
                signal(view, "character_name", start+named.start(), start+named.end())
                keep_routes.add("character_discussion")
            names = re.search(r"(?i)^\s*letter names?\s*[.!?]?\s*$|\bnames? of (?:the )?(?:letters?|symbols?)\b", fragment)
            if names:
                signal(view, "character_names", start+names.start(), start+names.end())
                keep_routes.add("character_discussion")
        # A complete short utterance can suggest a command; a formula line,
        # fenced example, layout command or local variable usage cannot.
        for t in targets:
            if t.kind != "command": continue
            before, after = text[:t.start].strip(), text[t.end:].strip()
            if re.fullmatch(r"(?i)(?:use|try)?", before) and after in ("", "."):
                bind(view, t, "suggestion", t.start, t.end, "identity_evidence")
        if not keep_routes and not reviews:
            for t in targets:
                if t.kind == "mark_name":
                    signal(view, "topic_context", t.start, t.end)
                    break

    # A bare pronoun never implies a character by itself.
    if not keep_routes and not reviews:
        for view, _, text in documents:
            frame = re.search(r"(?i)\b(?:what is|what's|what’s|how (?:do|can) I type)\s+(?:this|that|it)\b", text)
            if frame and (has_writing or re.search(r"(?i)\b(?:keyboard|Mac|Windows)\b", text)):
                if has_image:
                    signal(view, "image_request", frame.start(), frame.end())
                    keep_routes.add("character_request")
                elif "type" in frame[0].lower() and re.search(r"(?i)\b(?:keyboard|Mac|Windows)\b", text):
                    signal(view, "review_required", frame.start(), frame.end()); reviews.add("unbound_typing")
    if "character_request" in keep_routes and has_image:
        for view, _, _ in documents: signals.extend(view.images[:4])
        keep_routes.add("needs_image")
    tags = fields.get("Tags", "")
    for m in re.finditer(r"<([^<>]+)>", tags):
        if m[1].lower() in TAGS:
            signals.append({"rule":"topic_tag","field":"Tags","start":m.start(),"end":m.end(),"text":m[0]})
    if not keep_routes and not reviews and not signals:
        for view, _, text in documents:
            m = re.search(r"(?i)\b(?:Unicode|UTF[- ]?(?:8|16|32)|ASCII|mojibake|homoglyph|confusable)\b", text)
            if m: signal(view, "encoding_context", m.start(), m.end())
    status = next((r for r in ("character_request", "identity_evidence", "character_discussion") if r in keep_routes),
                  "review" if reviews else "context_only" if signals else "unrelated")
    decision = "keep" if keep_routes else "review" if reviews else "reject"
    score = {"character_request":8,"identity_evidence":5,"character_discussion":4,"review":3,"context_only":1,"unrelated":0}[status]
    routes = sorted(keep_routes | ({"review_required"} if reviews else set()) | ({"context_only"} if status == "context_only" else set()))
    return {"candidate": decision != "reject" and score >= threshold, "decision":decision,
            "status":status,"score":score,"routes":routes,"signals":signals[:60],
            "signal_count":len(signals),"binding_count":len(bindings),"bindings":bindings[:20],"facets":sorted(facets),
            "review_reasons":sorted(reviews),"source_role":source_role,"priority":"high" if score>=8 else "medium" if score>=4 else "low",
            "resolution":"unresolved","version":VERSION}


def visible(raw): return make_view(raw, "Body", True).text
def search_text(kind, row): return "\n".join(view.text for view in views(fields_for(kind, row)))
def fields_for(kind, row):
    keys = ("Title", "Body", "Tags") if kind == "post" else ("Text",)
    return {key: row.get(key, "") for key in keys}
