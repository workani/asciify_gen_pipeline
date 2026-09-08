"""Versioned, rebuildable search projection. The source database is read-only."""
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time
import unicodedata

from .common import Budget, MinerError, allowed_site, digest
from .filtering import RULE_HASH, VERSION, classify, fields_for, search_text
from .references import explicit_references, index_tokens, scalar, token
from .storage import encode, read_db, writer_lock

INDEX_NAME = "search-v2.sqlite"
INDEX_VERSION = 2
AGGREGATION_VERSION = 4


def fingerprint(root):
    path = Path(root).resolve() / "candidates.sqlite"
    stat = path.stat()
    for suffix in ("-journal", "-wal"):
        sibling = Path(str(path) + suffix)
        if sibling.exists() and sibling.stat().st_size:
            raise MinerError("Source has an active journal; stop ingestion before reindexing/search")
    return {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns, "inode": stat.st_ino}


def connect(path, readonly=False):
    db = sqlite3.connect(path.as_uri() + ("?mode=ro" if readonly else "?mode=rwc"), uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA temp_store=MEMORY")
    db.execute("PRAGMA cache_size=-32768")
    db.execute("PRAGMA busy_timeout=5000")
    if readonly: db.execute("PRAGMA query_only=ON")
    else:
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("PRAGMA synchronous=FULL")
    return db


def metadata(db):
    return {r[0]: json.loads(r[1]) for r in db.execute("SELECT * FROM meta")}


def set_meta(db, key, value):
    db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (key, encode(value)))


def build(root, limit=10_000_000_000, batch=1000, max_documents=None, progress=None):
    if batch < 1 or (max_documents is not None and max_documents < 1):
        raise MinerError("batch/max-documents must be positive")
    budget = Budget(root, limit)
    progress = progress or (lambda _: None)
    with writer_lock(budget.root):
        source = read_db(root)
        db = None
        try:
            before = fingerprint(root)
            source_contract = json.loads(source.execute("SELECT value FROM meta WHERE key='contract'").fetchone()[0])
            contract = {"source": before, "source_contract": digest(source_contract), "filter": RULE_HASH,
                        "schema": INDEX_VERSION, "unicode": unicodedata.unidata_version}
            db = connect(budget.root / INDEX_NAME)
            budget.constrain_db(db)
            db.executescript("""
              CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS assessments(aid INTEGER PRIMARY KEY,hash TEXT UNIQUE,status TEXT,score INTEGER,value TEXT);
              CREATE TABLE IF NOT EXISTS contents(cid INTEGER PRIMARY KEY,hash TEXT UNIQUE,text TEXT,glyphs TEXT,refs TEXT);
              CREATE VIRTUAL TABLE IF NOT EXISTS terms USING fts5(text,glyphs,refs,content='contents',content_rowid='cid',tokenize='unicode61 remove_diacritics 0');
              CREATE VIRTUAL TABLE IF NOT EXISTS substrings USING fts5(text,content='contents',content_rowid='cid',tokenize='trigram case_sensitive 1');
              CREATE TABLE IF NOT EXISTS records(docid INTEGER PRIMARY KEY,site TEXT,qid INTEGER,kind TEXT,id INTEGER,post_id INTEGER,role TEXT,cid INTEGER,aid INTEGER);
              CREATE INDEX IF NOT EXISTS records_content ON records(cid,site,qid);
              CREATE INDEX IF NOT EXISTS records_thread ON records(site,qid);
              CREATE TABLE IF NOT EXISTS threads(site TEXT,qid INTEGER,request INTEGER,image INTEGER,evidence INTEGER,discussion INTEGER,historical_request INTEGER,score INTEGER,status TEXT,PRIMARY KEY(site,qid));
            """)
            prior = metadata(db)
            if prior.get("contract", contract) != contract:
                raise MinerError("Search source/filter changed; move or delete only search-v2.sqlite, then reindex")
            if prior.get("state") == "ready" and prior.get("aggregation_version") == AGGREGATION_VERSION: return prior
            total = source.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
            checkpoints = [dict(r) for r in source.execute("SELECT * FROM checkpoints ORDER BY site,phase")]
            set_meta(db, "contract", contract)
            set_meta(db, "filter_version", VERSION)
            set_meta(db, "release", source_contract["manifest"]["release"])
            set_meta(db, "source_checkpoints", checkpoints)
            set_meta(db, "total", total)
            set_meta(db, "state", "building")
            db.commit()
            last = prior.get("last_docid", 0)
            processed = prior.get("processed", 0)
            newly = 0
            started = time.monotonic()
            while True:
                size = min(batch, max_documents - newly) if max_documents else batch
                rows = source.execute("SELECT docid,site,qid,kind,id,post_id,raw FROM documents WHERE docid>? ORDER BY docid LIMIT ?", (last, size)).fetchall()
                if not rows: break
                budget.constrain_db(db)
                db.execute("BEGIN IMMEDIATE")
                for row in rows:
                    raw = json.loads(row["raw"])
                    fields = fields_for(row["kind"], raw)
                    role = ("question" if row["id"] == row["qid"] else "answer") if row["kind"] == "post" else row["kind"]
                    key = digest({"fields": fields, "role": role})
                    known = db.execute("SELECT aid FROM assessments WHERE hash=?", (key,)).fetchone()
                    if known:
                        aid = known[0]
                    else:
                        assessment = classify(fields, source_role=role)
                        # Exact source spans are a build invariant, including HTML entities.
                        for signal in assessment["signals"]:
                            if fields[signal["field"]][signal["start"]:signal["end"]] != signal["text"]:
                                raise MinerError("Evidence span mismatch at source document %d" % row["docid"])
                        aid = db.execute("INSERT INTO assessments(hash,status,score,value) VALUES(?,?,?,?)", (key, assessment["status"], assessment["score"], encode(assessment))).lastrowid
                    text = search_text(row["kind"], raw)
                    content_hash = hashlib.sha256(text.encode()).hexdigest()
                    known = db.execute("SELECT cid FROM contents WHERE hash=?", (content_hash,)).fetchone()
                    if known: cid = known[0]
                    else:
                        glyphs, refs = index_tokens(text)
                        cid = db.execute("INSERT INTO contents(hash,text,glyphs,refs) VALUES(?,?,?,?)", (content_hash, text, glyphs, refs)).lastrowid
                        db.execute("INSERT INTO terms(rowid,text,glyphs,refs) VALUES(?,?,?,?)", (cid, text, glyphs, refs))
                        db.execute("INSERT INTO substrings(rowid,text) VALUES(?,?)", (cid, text))
                    role = ("question" if row["id"] == row["qid"] else "answer") if row["kind"] == "post" else row["kind"]
                    db.execute("INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?)", (row["docid"], row["site"], row["qid"], row["kind"], row["id"], row["post_id"], role, cid, aid))
                    last = row["docid"]
                newly += len(rows); processed += len(rows)
                if fingerprint(root) != before: raise MinerError("Source changed during reindex; projection cannot be published")
                set_meta(db, "last_docid", last); set_meta(db, "processed", processed)
                budget.check(); db.commit(); budget.check()
                progress({"phase": "reindex", "processed": processed, "total": total, "new_docs_per_second": round(newly / max(.001, time.monotonic() - started)), "work_bytes": budget.used()})
                if max_documents and newly >= max_documents: return metadata(db)
            budget.constrain_db(db)
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM threads")
            # Linked duplicates and answers quoting a request do not turn a question
            # into a human request. Comments independently qualify. History is separate.
            db.execute("""INSERT INTO threads
              SELECT r.site,r.qid,
                MAX(a.status='character_request' AND r.role IN ('question','comment')),
                MAX(EXISTS(SELECT 1 FROM json_each(a.value,'$.routes') WHERE value='needs_image') AND r.role IN ('question','comment')),
                MAX(EXISTS(SELECT 1 FROM json_each(a.value,'$.routes') WHERE value='identity_evidence') AND r.role!='history'),
                MAX(a.status IN ('character_request','character_discussion') AND r.role!='history'),
                MAX(a.status='character_request' AND r.role='history' AND r.post_id=r.qid),MAX(a.score),'unrelated'
              FROM records r JOIN assessments a USING(aid) GROUP BY r.site,r.qid""")
            db.execute("""UPDATE threads SET status=CASE
              WHEN request AND evidence THEN 'request_with_evidence' WHEN request THEN 'request_only'
              WHEN image THEN 'needs_image' WHEN evidence THEN 'evidence_only'
              WHEN discussion THEN 'discussion' WHEN historical_request THEN 'historical_request'
              WHEN score=3 THEN 'review' WHEN score>0 THEN 'context_only' ELSE 'unrelated' END""")
            if fingerprint(root) != before: raise MinerError("Source changed during reindex")
            set_meta(db, "state", "ready")
            set_meta(db, "aggregation_version", AGGREGATION_VERSION)
            set_meta(db, "counts", {table: db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] for table in ("records", "contents", "assessments", "threads")})
            set_meta(db, "thread_statuses", {r[0]: r[1] for r in db.execute("SELECT status,COUNT(*) FROM threads GROUP BY status")})
            set_meta(db, "resolution", "unresolved; evidence is a mention, not a target mapping")
            budget.check(); db.commit(); budget.check()
            return metadata(db)
        finally:
            if db: db.close()
            source.close()


def open_index(root, require_ready=True):
    path = Path(root).resolve() / INDEX_NAME
    if not path.exists(): raise MinerError("Search index missing; run mine.py reindex first (or --legacy for the old search)")
    db = connect(path, True)
    try:
        state = metadata(db)
        if state["contract"]["source"] != fingerprint(root): raise MinerError("Search index is stale: source database changed")
        if state["contract"]["filter"] != RULE_HASH or state["contract"]["schema"] != INDEX_VERSION:
            raise MinerError("Search index is stale: filter/schema changed; rebuild search-v2.sqlite")
        if require_ready and state["state"] != "ready": raise MinerError("Search index is incomplete; resume reindex")
        if require_ready and state.get("aggregation_version") != AGGREGATION_VERSION:
            raise MinerError("Thread summaries need refreshing; resume reindex")
        return db
    except Exception:
        db.close(); raise


def quote_fts(value): return '"' + value.replace('"', '""') + '"'


def codepoints(query):
    parts = query.split()
    if not parts or any(not re.fullmatch(r"(?:[Uu]\+)?[0-9A-Fa-f]{1,6}", p) for p in parts):
        raise MinerError("Use Unicode scalars such as U+200B or U+0065 U+0301")
    cps = [int(re.sub(r"^[Uu]\+", "", p), 16) for p in parts]
    if not all(scalar(cp) for cp in cps): raise MinerError("Invalid Unicode scalar")
    return cps


def search(root, query, site=None, kind=None, limit=30, mode="auto", offset=0, min_score=0,
           scope="relevant", mention="any"):
    if not query or len(query) > 1000: raise MinerError("Query must contain 1..1000 characters")
    if not 1 <= limit <= 500 or not 0 <= offset <= 100000: raise MinerError("Invalid limit/offset")
    if site and not allowed_site(site): raise MinerError("Site outside allowlist scope")
    if kind not in (None, "post", "comment", "history"): raise MinerError("Unknown source kind")
    if scope not in ("relevant", "requests", "review", "all"): raise MinerError("Unknown search scope")
    if mention not in ("any", "explicit", "literal"): raise MinerError("Unknown mention mode")
    if mode == "auto":
        mode = "codepoint" if re.fullmatch(r"(?:[Uu]\+[0-9A-Fa-f]{1,8}\s*)+", query.strip()) else "words"
    clauses, args = ["t.score>=?"], [min_score]
    if site: clauses.append("r.site=?"); args.append(site)
    if kind: clauses.append("r.kind=?"); args.append(kind)
    if scope == "requests": clauses.append("(t.request OR t.historical_request)")
    elif scope == "review": clauses.append("a.status='review'")
    elif scope == "relevant":
        clauses.append("t.status NOT IN ('unrelated','context_only')")
        clauses.append("a.status NOT IN ('unrelated','context_only','review')")
    fts_table, expression, literal, cps = "terms", None, None, []
    if mode in ("codepoint", "sequence"):
        cps = codepoints(query)
        if len(cps) > 1 or mode == "sequence":
            literal = "".join(map(chr, cps))
            # A list of unrelated references in a post is not a character sequence.
            expression = "glyphs : (" + " AND ".join(token(cp) for cp in set(cps)) + ")"
            if mention == "explicit": raise MinerError("Sequence search is exact literal order; use --mention literal or any")
        else:
            fields = "{glyphs refs}" if mention == "any" else "refs" if mention == "explicit" else "glyphs"
            expression = fields + " : " + token(cps[0])
    elif mode == "literal": literal = query
    elif mode == "fts": expression = "text : (" + query + ")"
    elif mode == "words":
        # Unicode61 keeps combining marks inside words; Python's \w does not.
        words, word = [], ""
        for c in query + " ":
            if unicodedata.category(c)[0] in "LN" or (word and unicodedata.category(c)[0] == "M"): word += c
            elif word: words.append(word); word = ""
        glyphs = sorted({ord(c) for c in query if not c.isspace() and (unicodedata.category(c)[0] in "SM" or c in "@#&|^~")})
        pieces = ["text : " + quote_fts(w) for w in words] + ["glyphs : " + token(cp) for cp in glyphs]
        if not words: literal = query
        else:
            expression = " AND ".join(pieces)
            for chunk in query.split():
                if not any(c.isalnum() for c in chunk) and any(unicodedata.category(c)[0] == "S" for c in chunk):
                    clauses.append("instr(c.text,?)>0"); args.append(chunk)
    else: raise MinerError("Unknown search mode")
    if literal is not None:
        if len(literal) >= 3:
            fts_table, expression = "substrings", quote_fts(literal)
        else:
            expression = "glyphs : (" + " AND ".join(token(cp) for cp in set(map(ord, literal))) + ")"
        clauses.append("instr(c.text,?)>0"); args.append(literal)
    args.insert(0, expression)
    rank = "bm25(%s)" % fts_table
    explicit = "instr(' '||c.refs||' ',?)>0" if len(cps) == 1 else "0"
    if len(cps) == 1: args.insert(1, " " + token(cps[0]) + " ")
    sql = """WITH matches AS MATERIALIZED (
      SELECT rowid AS cid,%s AS relevance FROM %s WHERE %s MATCH ?),
      ranked AS (
        SELECT r.*,c.text,a.status AS source_status,a.value,t.status AS thread_status,t.score,t.image AS requires_image_review,
          m.relevance,%s AS explicit_reference,
          ROW_NUMBER() OVER(PARTITION BY r.site,r.qid ORDER BY %s DESC,
            (r.role!='history') DESC,(a.status='character_request') DESC,m.relevance,r.docid) AS position
        FROM matches m JOIN records r USING(cid) JOIN contents c USING(cid)
          JOIN assessments a USING(aid) JOIN threads t ON t.site=r.site AND t.qid=r.qid
        WHERE %s)
      SELECT * FROM ranked WHERE position=1 ORDER BY explicit_reference DESC,
        (role!='history') DESC,(thread_status='request_with_evidence') DESC,
        (thread_status='request_only') DESC,relevance,site,qid LIMIT ? OFFSET ?""" % (
            rank, fts_table, fts_table, explicit,
            explicit.replace("?", "' " + token(cps[0]) + " '") if len(cps) == 1 else "0",
            " AND ".join(clauses))
    args.extend((limit, offset))
    db = open_index(root)
    deadline = time.monotonic() + 20
    db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
    try:
        results = [dict(row) for row in db.execute(sql, args)]
        state = metadata(db)
    except sqlite3.Error as error:
        raise MinerError("Search failed (FTS syntax or 20-second query budget): " + str(error)) from None
    finally: db.close()
    for result in results:
        text = result.pop("text")
        assessment = json.loads(result.pop("value"))
        needles = ([literal] if literal is not None else [chr(cps[0]), "U+%04X" % cps[0]] if cps else re.findall(r"[^\W_]+", query))
        if result["explicit_reference"]:
            positions = [r[0] for r in explicit_references(text) if r[2] in cps]
        elif literal is not None:
            positions = [text.find(literal)]
        else:
            positions = [m.start() for n in needles for m in [re.search(re.escape(n), text, re.I)] if m]
        start = max(0, min(positions, default=0) - 100)
        result.update(excerpt=text[start:start + 700], excerpt_start=start,
                      discovery_decision=assessment.get("decision"),
                      discovery_bindings=assessment.get("bindings", []),
                      review_reasons=assessment.get("review_reasons", []),
                      evidence=assessment["signals"], resolution="unresolved", release=state["release"],
                      url="https://%s/questions/%d" % (result["site"], result["qid"]))
        if result["kind"] == "comment": result["url"] += "#comment%d_%d" % (result["id"], result["post_id"])
        elif result["role"] == "answer": result["url"] += "#%d" % result["id"]
        elif result["role"] == "history": result["url"] = "https://%s/posts/%d/revisions" % (result["site"], result["post_id"])
        for key in ("cid", "aid", "position"): result.pop(key, None)
    return results
