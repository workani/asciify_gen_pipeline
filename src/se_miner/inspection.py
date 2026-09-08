import json
import re
import time

from .common import MinerError, allowed_site
from .storage import thread


def search(db, query, site=None, kind=None, limit=30, mode="words", offset=0, min_score=0):
    if not query: raise MinerError("Search query cannot be empty")
    if not 1 <= limit <= 500: raise MinerError("Search limit must be 1..500")
    if not 0 <= offset <= 100000: raise MinerError("Search offset must be 0..100000")
    if site and not allowed_site(site): raise MinerError("Site outside allowlist scope")
    original_query = query
    clauses, args = ["c.score>=?"], [min_score]
    if site: clauses.append("d.site=?"); args.append(site)
    if kind: clauses.append("d.kind=?"); args.append(kind)
    if mode == "codepoint":
        label = query.upper().removeprefix("U+")
        if not re.fullmatch(r"[0-9A-F]{1,6}", label): raise MinerError("Invalid codepoint")
        cp = int(label, 16)
        if cp > 0x10ffff or 0xd800 <= cp <= 0xdfff: raise MinerError("Invalid Unicode scalar")
        query = chr(cp)
        # Exact literals and explicit U+ labels. Matches are evidence mentions,
        # never a declaration that the thread's answer is this character.
        pattern = re.compile(r"(?i)(?<!\w)U\+0*%s(?![0-9a-f])" % format(cp, "X"))
        db.create_function("has_codepoint_label", 1, lambda value: bool(pattern.search(value or "")), deterministic=True)
        clauses.append("(instr(d.text,?)>0 OR has_codepoint_label(d.text))")
        args.append(query)
        mode = "literal"
    elif mode == "literal":
        clauses.append("instr(d.text,?)>0")
        args.append(query)
    elif mode in ("words", "fts"):
        if mode == "words":
            tokens = re.findall(r"[^\W_]+", query, re.UNICODE)
            if not tokens:
                return search(db, query, site, kind, limit, "literal", offset, min_score)
            query = " AND ".join('"' + token.replace('"', '""') + '"' for token in tokens)
        clauses.append("search MATCH ?")
        args.append(query)
    else: raise MinerError("Unknown search mode")
    use_fts = mode in ("words", "fts")
    join = "JOIN search ON search.rowid=d.docid" if use_fts else ""
    score = "bm25(search)" if use_fts else "0.0"
    order = "rank,d.site,d.qid,d.id" if use_fts else "c.score DESC,d.site,d.qid,d.id"
    sql = """SELECT d.site,d.qid,d.kind,d.id,d.text,c.score AS candidate_score,%s AS rank
       FROM documents d JOIN candidates c ON c.site=d.site AND c.qid=d.qid %s
       WHERE %s ORDER BY %s LIMIT ? OFFSET ?""" % (score, join, " AND ".join(clauses), order)
    args.extend([limit, offset])
    deadline = time.monotonic() + 20
    db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
    try:
        rows = [dict(r) for r in db.execute(sql, args)]
    except Exception as error:
        raise MinerError("Search failed (invalid FTS syntax or 20-second query budget): " + str(error)) from None
    finally:
        db.set_progress_handler(None, 0)
    for row in rows:
        row["url"] = "https://%s/questions/%d" % (row["site"], row["qid"])
        text = row.pop("text")
        needles = [query] if mode == "literal" else re.findall(r"[^\W_]+", original_query, re.UNICODE)
        positions = [match.start() for needle in needles if needle for match in [re.search(re.escape(needle), text, re.I)] if match]
        start = max(0, min(positions, default=0) - 120)
        row["excerpt"] = text[start:start + 800]
        row["excerpt_start"] = start
        row["text_length"] = len(text)
        row["resolution"] = "unresolved"
    return rows


def report(db, budget=None):
    count = lambda table: db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
    checkpoints = [dict(r) for r in db.execute("SELECT * FROM checkpoints ORDER BY site,phase")]
    contract = json.loads(db.execute("SELECT value FROM meta WHERE key='contract'").fetchone()[0])
    sites = [s["site"] for s in contract["manifest"]["sites"]]
    tables = {r["key"].split(":", 1)[1]: json.loads(r["value"]) for r in db.execute("SELECT * FROM meta WHERE key LIKE 'tables:%'")}
    missing_questions = db.execute("""SELECT COUNT(*) FROM candidates c WHERE NOT EXISTS(
      SELECT 1 FROM documents d WHERE d.site=c.site AND d.kind='post' AND d.id=c.qid)""").fetchone()[0]
    orphan_hits = db.execute("""SELECT COUNT(*) FROM hits h LEFT JOIN routing r ON r.site=h.site AND r.id=h.post_id WHERE r.id IS NULL""").fetchone()[0]
    comment_only = db.execute("""SELECT COUNT(*) FROM (
      SELECT r.site,r.qid FROM hits h JOIN routing r ON r.site=h.site AND r.id=h.post_id
      JOIN candidates c ON c.site=r.site AND c.qid=r.qid GROUP BY r.site,r.qid
      HAVING MAX(h.kind='comment')=1 AND MAX(h.kind!='comment')=0)""").fetchone()[0]
    # SQL JSON functions keep QA bounded; do not materialize every thread.
    missing_accepted = db.execute("""SELECT COUNT(*) FROM documents q WHERE q.kind='post'
      AND CAST(json_extract(q.raw,'$.PostTypeId') AS INTEGER)=1
      AND json_extract(q.raw,'$.AcceptedAnswerId') IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM documents a WHERE a.site=q.site AND a.kind='post'
        AND a.id=CAST(json_extract(q.raw,'$.AcceptedAnswerId') AS INTEGER))""").fetchone()[0]
    comment_mismatches = db.execute("""SELECT COUNT(*) FROM documents p WHERE p.kind='post'
      AND json_extract(p.raw,'$.CommentCount') IS NOT NULL
      AND CAST(json_extract(p.raw,'$.CommentCount') AS INTEGER) !=
        (SELECT COUNT(*) FROM documents c WHERE c.site=p.site AND c.kind='comment' AND c.post_id=p.id)""").fetchone()[0]
    answer_mismatches = db.execute("""SELECT COUNT(*) FROM documents q WHERE q.kind='post'
      AND CAST(json_extract(q.raw,'$.PostTypeId') AS INTEGER)=1
      AND json_extract(q.raw,'$.AnswerCount') IS NOT NULL
      AND CAST(json_extract(q.raw,'$.AnswerCount') AS INTEGER) !=
        (SELECT COUNT(*) FROM documents a WHERE a.site=q.site AND a.kind='post' AND a.qid=q.id AND a.id!=q.id)""").fetchone()[0]
    done = {r["site"] for r in checkpoints if r["phase"] == "complete" and r["complete"]}
    warnings = {"missing_questions": missing_questions, "orphan_discovery_hits": orphan_hits,
                "missing_accepted_answers": missing_accepted, "comment_count_mismatches": comment_mismatches,
                "answer_count_mismatches": answer_mismatches}
    transport = db.execute("SELECT value FROM meta WHERE key='transport'").fetchone()
    # The rule set is its own column, so this never has to parse 3M span blobs.
    if any(c["name"] == "rules" for c in db.execute("PRAGMA table_info(hits)")):
        reasons = [dict(r) for r in db.execute("""
          WITH split(rest,rule) AS (SELECT rules||',','' FROM hits UNION ALL
            SELECT substr(rest,instr(rest,',')+1),substr(rest,1,instr(rest,',')-1) FROM split WHERE rest!='')
          SELECT rule,COUNT(*) AS items FROM split WHERE rule!='' GROUP BY rule ORDER BY items DESC""")]
    else:
        reasons = [dict(r) for r in db.execute("""SELECT json_extract(j.value,'$.rule') AS rule,COUNT(DISTINCT h.site||':'||h.kind||':'||h.id) AS items
          FROM hits h,json_each(h.signals) j GROUP BY rule ORDER BY items DESC""")]
    histogram = [dict(r) for r in db.execute("SELECT kind,score,COUNT(*) AS items FROM hits GROUP BY kind,score ORDER BY kind,score")]
    decisions = []
    if any(c["name"] == "assessment" for c in db.execute("PRAGMA table_info(hits)")):
        decisions = [dict(r) for r in db.execute("SELECT json_extract(assessment,'$.decision') AS decision,COUNT(*) AS items FROM hits GROUP BY decision ORDER BY decision")]
    identities = [dict(r) for r in db.execute("SELECT key,identity FROM source_pins")]
    for identity in identities: identity["identity"] = json.loads(identity["identity"])
    return {"status": "complete_with_warnings" if done == set(sites) and any(warnings.values()) else "complete" if done == set(sites) else "incomplete",
            "release": contract["manifest"]["release"], "sites": sites, "tables": tables,
            "candidates": count("candidates"), "documents": count("documents"), "discovery_hits": count("hits"),
            "comment_only_threads": comment_only, "rejected_sample": count("rejected"),
            "warnings": warnings, "checkpoints": checkpoints,
            "work_bytes": budget.used() if budget else None,
            "budget_bytes": budget.limit if budget else None,
            "transport": json.loads(transport[0]) if transport else {},
            "filter_reasons": reasons, "score_histogram": histogram, "discovery_decisions": decisions, "source_identities": identities,
            "quality": "unreviewed_candidates_not_resolved_mappings", "recall": None}


def export_rows(db, kind="threads", sample=None):
    if kind == "rejected":
        for row in db.execute("SELECT * FROM rejected ORDER BY site,kind,rank"):
            value = dict(row)
            value["raw"], value["assessment"] = json.loads(value["raw"]), json.loads(value["assessment"])
            yield value
        return
    if sample is not None and sample < 1: raise MinerError("Audit sample must be positive")
    # Hash-based sampling so low IDs and popular sites do not monopolize audit.
    from .common import digest
    db.create_function("sample_hash", 2, lambda s, q: digest([s, q]), deterministic=True)
    order = "sample_hash(site,qid)" if sample else "site,qid"
    sql = "SELECT site,qid FROM candidates ORDER BY " + order + (" LIMIT ?" if sample else "")
    for row in db.execute(sql, (sample,) if sample else ()):
        yield thread(db, row["site"], row["qid"])
