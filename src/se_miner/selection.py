"""Rebuildable selection after discovery; no source deletion or model calls.

Lanes order context review. They are not final A/B/C labels or confidence.
Changing this module deliberately does not change the ingestion rule hash.
"""
import hashlib
from pathlib import Path
import re

from .filtering import classify, fields_for, RULE_HASH
from .textviews import make_view

VERSION = "thread-selection-1"
HASH = hashlib.sha256(Path(__file__).read_bytes() + RULE_HASH.encode()).hexdigest()
GLYPH = re.compile(r"(?i)\b(?:symbol|glyph|character|letter|font|typeface)s?\b")
IDENTIFY = re.compile(r"(?i)\b(?:called|named|name|typeset|type|typing|unicode|detexify|shapecatcher|recognize|recognise)\b")
PHYSICAL = re.compile(r"(?i)\b(?:upside[- ]down|backwards?|sideways?|tail|curl|hook|stroke|fraktur|calligraphic|squiggly|letterform)\b")
TECHNICAL = re.compile(r"(?i)^\s*(?:[- ]?algebra|field|category|table|selections?|coordinate|notation|sequence|axis|sections?)\b|^\s+of\s+(?:\$|\\|a group|the group|a representation)")
SIGN = re.compile(r"(?i)^signs?$")


def plain(text):
    return make_view(text, "Body", True).text


def assess_source(fields, role="unknown", discovery=None):
    discovery = discovery or classify(fields, source_role=role)
    lanes, reasons, accepted, suppressed = set(), set(), [], []
    texts = {k: plain(v) for k, v in fields.items() if k != "Tags"}
    signals = discovery.get("signals", [])
    if discovery["candidate"] and re.search(r"(?i)\b\w+-like (?:letter|glyph|symbol|character)\b", texts.get("Title", "")):
        lanes.add("identity")
        reasons.add("explicit_letter_similarity_in_title")
    for signal in signals:
        if signal["rule"] in ("codepoint", "unicode_escape", "unicode_name", "lookup_failure", "image_request"):
            lanes.add("identity")
            reasons.add("explicit_identity_or_lookup_evidence")
    for binding in discovery.get("bindings", []):
        t, e = binding["target"], binding["evidence"]
        raw = fields[t["field"]]
        target = plain(raw[t["start"]:t["end"]]).strip()
        after = plain(raw[t["end"]:t["end"]+180])
        before = plain(raw[max(0, t["start"]-140):t["start"]])
        local = before + target + after
        op, kind = binding["operation"], binding["target_kind"]
        reason, lane = None, "context"
        if kind in ("subject", "mark_name") and TECHNICAL.match(after):
            reason = "mathematical_object_complement"
        elif SIGN.fullmatch(target) and op in ("find", "appearance", "origin"):
            # Arithmetic sign changes are not descriptions of a drawn sign.
            reason = "arithmetic_sign"
        elif op == "origin":
            if kind in ("letter", "styled_glyph") or re.fullmatch(r"[\s$'\"`0-9]+", target) or re.fullmatch(r"[\"'`]?[a-zA-Z][\"'`]?", target):
                reason = "derivation_of_quantity"
            else: lane = "semantics"
        elif op == "find":
            # Keep lexical uncertainty available for the thread, but don't
            # prioritize a vocabulary hit as an identified glyph request.
            if re.match(r"(?i)\s*(?:table|of\s+\$|to have|such that|generating)\b", after) or re.match(r"\s*\$[^$]+\$\s+generating\b", after):
                reason = "selection_or_computation"
            else: lane = "context"
        elif op == "meaning" or op == "usage":
            lane = "identity" if PHYSICAL.search(local) or re.search(r"(?i)\b(?:what|how)\s+is\s+it\s+called\b|\b(?:what is (?:its|the) name|how (?:do|can) I type)\b", after) else "semantics"
            if re.match(r"[- ](?:measurable|value|function)\b", after): reason = "mathematical_compound"
        elif op == "appearance":
            # Bare "look like e.g.", function names, list digits and article
            # 'a' are parser ambiguities, not useful shape descriptions.
            if kind == "styled_glyph" and re.search(r"(?i)\b(?:graph|function|curve)\b", before):
                reason = "appearance_of_mathematical_object"
            elif kind == "subject" and re.search(r"(?i)rotation of\s+\$", before):
                reason = "permutation_of_characters"
            elif re.match(r"(?i)^\s*(?:\.g\.|\([^)]*,|,[0-9]|\([a-z]+\)|[- ]axis\b)", after):
                reason = "formula_or_abbreviation_shape"
            elif re.fullmatch(r"(?i)looks? like (?:a|an)", target) and after.strip():
                reason = "article_not_letter"
            elif GLYPH.search(target) or IDENTIFY.search(before) or t["field"] == "Title" and len(texts.get("Title", "")) < 75:
                lane = "identity"
            elif re.match(r"(?i)\s*[\"',:;]?\s*(?:is|as is|\$)", after) and re.search(r"(?i)\b(?:it's|it is|it was|it|thought)\b", before):
                lane = "identity"
            else: lane = "context"
        elif op in ("name", "identify", "keyboard", "type", "suggestion", "depiction"):
            if op == "name" and re.match(r"(?i)^\s*(?:[- ]?sequence|formula|is called (?:rectifiable|a .?stable letter|a word)|called .?monic|may change)\b", after):
                reason = "naming_mathematical_object"
            elif op == "name" and re.search(r"(?i)\bcode\s+(?:for|of)\s*$", before) and not re.search(r"(?i)\b(?:latex|unicode|tex)\b", before):
                lane = "context"
            elif op == "name" and kind == "subject" and re.search(r"(?i)\b(?:counting|permutation|combination)\b", local):
                lane = "context"
            elif op == "name" and target.lower() in ("letter", "letters") and not re.search(r"(?i)\b(?:unicode|latex|keyboard|font|greek|latin)\b", local):
                lane = "context"
            elif kind == "literal" and (not re.search(r"[^\s.,:'\"`-]", target) or re.match(r"\s*(?:[a-z]\s*(?:and|,)|coordinate\b)", after)):
                reason = "punctuation_or_variable_in_prose"
            elif op == "identify" and kind == "subject" and re.match(r"(?i)\s*(?:[\"']0[\"']\s+)?(?:is currently|you use|I give|might have)\b", after):
                reason = "vocabulary_in_mathematical_prose"
            elif op == "identify" and kind == "mark_name" and re.match(r"\s+\$", after):
                lane = "context"
            elif op == "identify" and kind in ("literal", "letter", "styled_glyph") and not IDENTIFY.search(local):
                lane = "context"
            else: lane = "identity"
        else: lane = "context"
        if reason:
            suppressed.append({"reason": reason, "binding": binding})
        else:
            lanes.add(lane)
            accepted.append({"lane": lane, "binding": binding})
    if not lanes and not suppressed and discovery["candidate"]:
        lanes.add("context")
        reasons.add("unbound_evidence_requires_context")
    lane = next((x for x in ("identity", "context", "semantics") if x in lanes), "noise")
    if lane == "semantics": reasons.add("meaning_is_not_character_identification")
    if lane == "context": reasons.add("insufficient_identity_evidence")
    if lane == "noise": reasons.add("no_eligible_identity_or_semantics_binding")
    # A supporting answer is evidence, never a new question-author description.
    return {"lane": lane, "priority": {"identity": 3, "context": 2, "semantics": 1, "noise": 0}[lane],
            "role": role, "reasons": sorted(reasons), "accepted": accepted, "suppressed": suppressed,
            "discovery_score": discovery["score"], "decision": "pending_context_review",
            "resolution": "unresolved", "version": VERSION}


def assess_thread(thread):
    results = []
    for doc in thread["documents"]:
        role = ("question" if doc["id"] == thread["qid"] else "answer") if doc["kind"] == "post" else doc["kind"]
        result = assess_source(fields_for(doc["kind"], doc["raw"]), role)
        results.append({"kind": doc["kind"], "id": doc["id"], "post_id": doc["post_id"], **result})
    current = [r for r in results if r["role"] in ("question", "comment")]
    identity = any(r["lane"] == "identity" for r in current)
    semantics = any(r["lane"] == "semantics" for r in current)
    support = any(r["lane"] == "identity" for r in results if r["role"] == "answer")
    historical = any(r["lane"] == "identity" and r["post_id"] == thread["qid"] for r in results if r["role"] == "history")
    if identity: lane = "identity"
    elif semantics and support: lane = "mixed"
    elif historical: lane = "historical"
    elif support: lane = "evidence_only"
    elif any(r["lane"] == "context" for r in results): lane = "context"
    elif semantics: lane = "semantics"
    else: lane = "noise"
    return {"version": VERSION, "hash": HASH, "lane": lane, "sources": results,
            "eligible_training_pair": False, "final_class": None, "resolution": "unresolved",
            "requires_context_judgment": lane != "noise"}
