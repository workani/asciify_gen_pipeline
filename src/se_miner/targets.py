"""Typed target mentions. Occurrence is not acceptance or Unicode resolution."""
from dataclasses import dataclass
import re
import unicodedata
from .structure import COMMAND


@dataclass(frozen=True)
class Target:
    start: int
    end: int
    kind: str


# Structural commands cannot be glyph proposals. Unknown commands still need
# an explicit request/suggestion binding; occurrence alone is not acceptance.
LAYOUT = set("begin end hline cline newline linebreak quad qquad enspace hspace vspace left right middle big Big bigg Bigg limits nolimits label ref eqref cite tag text mbox hbox vbox frac dfrac tfrac binom dbinom tbinom stackrel overset underset operatorname mathop mathrel mathbin mathord mathopen mathclose displaystyle textstyle scriptstyle scriptscriptstyle usepackage documentclass newcommand renewcommand def let setlength array stretch choose over atop nonumber notag cr LaTeX TeX document include input includegraphics centering item multicolumn multirow".split())
DECORATION = set("mathbb mathbf mathcal mathscr mathfrak mathrm mathit mathsf mathtt boldsymbol bm hat widehat check widecheck bar overline underline tilde widetilde vec dot ddot acute grave breve ring texttt textbf textit textsc".split())
SUBJECT = re.compile(r"(?i)\b(?:symbols?|glyphs?|signs?|letterforms?|characters?|letters?|fonts?|typefaces?|alphabets?|punctuation marks?|diacritics?|emoji|emoticons?)\b")
MARK = re.compile(r"(?i)\b(?:warning signs?|not equal to signs?|centre dots?|center dots?|quotation marks?|question marks?|exclamation (?:marks?|points?)|degree symbols?|integral signs?|element signs?|equals? signs?|plus signs?|minus signs?|percent signs?|less[- ]than signs?|greater[- ]than signs?|arrows?|braces|brackets?|parenthes[ei]s|asterisks?|ampersands?|pilcrows?|backticks?|grave accents?|interrobangs?|em[- ]dash|en[- ]dash|apostrophes?|commas?|semicolons?|colons?|full stops?|hyphens?|ellips[ie]s|tildes?|carets?|underscores?|backslashes?|slashes?|daggers?|vinculum|nabla|epsilon|sigma|eta|aleph)\b")
INVISIBLE = re.compile(r"(?i)\b(?:(?:zero[- ]width|non[- ]breaking|nonprinting|non[- ]printing|invisible) (?:spaces?|characters?|symbols?|joiners?)|whitespace|(?:strange|weird|hidden|unprintable|unexpected) (?:characters?|symbols?))\b")
NAME = re.compile(r"(?i)\b(?:long s|long \(em\) dash|zero width (?:space|joiner)|nonbreaking space|pilcrow|interrobang|backtick|grave accent)\b")
LETTER = r"(?:[a-z0-9]|alpha|beta|gamma|delta|epsilon|eta|theta|lambda|pi|sigma|omega)"
FEATURE = r"(?:tail|curl|hook|stroke|slash|bar|dot|line|foot)"
STYLE = r"(?:backwards?|upside[- ]down|sideways?|rotated|mirrored|flipped|inverted|unfinished|squiggly|curly|cursive|calligraphic|script|fraktur|gothic|blackboard[- ]bold|double[- ](?:lined|struck))"
SHAPES = [
    re.compile(r"(?i)(?<![\w'’])" + LETTER + r"[- ]with (?:an? |the )?(?:(?:double|vertical|horizontal) )?" + FEATURE + r"\b"),
    re.compile(r"(?i)(?<![\w'’])[a-z]-looking\b"),
    re.compile(r"(?i)\b" + STYLE + r"\s+(?:(?:capital|small|lowercase|uppercase|letter)\s+)*[\"'`]?" + LETTER + r"(?![\w-])"),
    re.compile(r"(?i)\b(?:two|2) triangles (?:touching|meeting)\b|\bhorizontal hourglass\b|\bzigzag (?:arrow|lightning)\b"),
    re.compile(r"(?i)\blooks? like (?:the letter |an? )?([\"'`]?)([a-z0-9])\1(?![\w'’-])")
]
ACCENT = re.compile(r"(?i)\b(?:squiggly|wavy|straight|short|horizontal|vertical) (?:line|bar|stroke|arrow) (?:beneath|under|above|over)\b")
WRITING = re.compile(r"(?i)\b(?:keyboard|typing|font\w*|typeface|typograph\w*|printed|printing|alphabet|Unicode|ASCII|diacritic|punctuation|letterform|word processor|Word|LaTeX|TeX|Detexify|Shapecatcher)\b")
NON_GLYPH = re.compile(r"(?i)\b(?:fictional|novel|movie|story|game|business|cover|love|British|American|spoken|regional|foreign)\s+$")
ABSTRACT = re.compile(r"(?i)^\s*(?:rule|splice|clause|usage|placement|convention|development|trait|of (?:freedom|love|hope|resistance))\b")
MATH_SENSE = re.compile(r"(?i)\b(?:Dirichlet|additive|multiplicative|irreducible|non[- ]terminal|Artin)\s+$")
MATH_COMPLEMENT = re.compile(r"(?i)^\s+(?:of (?:a |an |the |this |that )?(?:group|representation|operator|pseudodifferential|exponentiation)|(?:whose |that )?(?:group of permutations|retracts|frequency|is actually the most probable))\b")


def literal(value, quoted=False):
    if not value or len(value) > 24 or any(c.isspace() for c in value): return False
    if value in ("$", "\\"): return True
    if value.startswith("\\"): return False
    if any(c.isalnum() for c in value):
        if len(value) == 1: return quoted or not value.isascii()
        if any(unicodedata.category(c).startswith("M") for c in value):
            return sum(c.isalnum() for c in value) == 1
        return False
    if "$" in value or "\\" in value: return False
    return any(unicodedata.category(c)[0] in "PS" for c in value)


def atom(content):
    """A single command/base with optional font/accent wrappers, not a formula."""
    text = content.strip()
    if len(text) > 240: return None
    if re.fullmatch(r"\\(?:widehat|widecheck|hat|check|bar|tilde|vec)", text): return "command"
    command = COMMAND.fullmatch(text)
    if command:
        name = text.lstrip("\\").rstrip("*")
        return "command" if name not in LAYOUT and name not in DECORATION else None
    decorated = re.fullmatch(r"\\([A-Za-z]+)\s*\{(.+)\}", text, re.S)
    if decorated and decorated[1] in DECORATION:
        return "styled_glyph" if atom(decorated[2]) else None
    if len(text) == 1 and text.isalnum(): return "letter"
    if literal(text): return "literal"
    return None


def inventory(view, regions, prose):
    targets = []
    for region in regions:
        if region.kind not in ("math", "command", "code") or not region.closed: continue
        kind = atom(region.content)
        if kind: targets.append(Target(region.start, region.end, kind))
    for pattern, kind in ((SUBJECT, "subject"), (MARK, "mark_name"), (NAME, "character_name"), (INVISIBLE, "invisible")):
        for m in pattern.finditer(prose):
            if NON_GLYPH.search(prose[max(0,m.start()-30):m.start()]): continue
            if ABSTRACT.match(prose[m.end():]): continue
            if kind == "subject" and (MATH_SENSE.search(prose[max(0,m.start()-35):m.start()]) or MATH_COMPLEMENT.match(prose[m.end():])): continue
            targets.append(Target(m.start(), m.end(), kind))
    for pattern in SHAPES:
        for m in pattern.finditer(prose):
            after = prose[m.end():]
            if re.match(r"(?i)^script\s+[0-9]", m[0]): continue
            if pattern is SHAPES[-1]: after = re.sub(r"^(\s+)[\"'“‘]", r"\1", after)
            if pattern is SHAPES[-1] and re.match(r"\s+[0-9]", after): continue
            if re.match(r"\s*(?:=|[+*/]|would\b|should\b)", after): continue
            if re.match(r"\s+[A-Za-z]", after) and not re.match(r"(?i)\s+(?:with|but|or|and|before|after|on|in|is|Greek|symbol|character|letter|looking|shape|under|above|below)\b", after): continue
            targets.append(Target(m.start(), m.end(), "shape"))
    for m in re.finditer(r"(?<!\w)([\"'`“‘])([^\s]{1,24})[\"'`”’](?!\w)", prose):
        if literal(m[2], quoted=True): targets.append(Target(m.start(), m.end(), "literal"))
    for m in re.finditer(r"\S+", prose):
        if "\ufffc" not in m[0] and literal(m[0]): targets.append(Target(m.start(), m.end(), "literal"))
    return sorted(set(targets), key=lambda t: (t.start, t.end, t.kind))
