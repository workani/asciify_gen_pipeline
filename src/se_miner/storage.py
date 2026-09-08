import contextlib
import fcntl
import json
import sqlite3
import time
from pathlib import Path

from .common import MinerError, SpaceLimit, digest


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# Discovery bookkeeping is a pointer back into the source, not a copy of it.
# Rule and field names become codes and the matched text is dropped: it is
# recoverable by slicing the stored row, and storing it again cost ~10x.
RULE_CODES = {"target_glyph": "tg", "character_request": "cr", "request_subject": "rs",
              "request_frame": "rf", "request_slot": "rl", "character_shape": "cs",
              "character_name": "cn", "character_names": "cN", "character_description": "cd",
              "description_subject": "ds", "latex_symbol": "lx", "invisible_character": "iv",
              "topic_context": "tc", "topic_tag": "tt", "encoding_context": "ec", "image": "im",
              "codepoint": "cp", "unicode_escape": "ue", "unicode_name": "un"}
RULE_NAMES = {code: name for name, code in RULE_CODES.items()}
FIELD_CODES = {"Body": "B", "Title": "T", "Text": "X", "Tags": "G"}
FIELD_NAMES = {code: name for name, code in FIELD_CODES.items()}
SIGNAL_FORMAT = 1
SIGNAL_LIMIT = 6


def pack_signals(signals, limit=SIGNAL_LIMIT):
    """Keep one span per distinct rule first, so the rule set survives the cap."""
    ordered, seen = [], set()
    for signal in signals:
        if signal["rule"] not in seen:
            seen.add(signal["rule"]); ordered.append(signal)
    ordered += [s for s in signals if s not in ordered]
    kept = ordered[:limit]
    records = []
    for signal in kept:
        parts = [RULE_CODES.get(signal["rule"], signal["rule"]),
                 FIELD_CODES.get(signal["field"], signal["field"]),
                 str(signal["start"]), str(signal["end"])]
        if signal.get("code_point") is not None: parts.append(str(signal["code_point"]))
        records.append(":".join(parts))
    rules = ",".join(sorted(seen))
    return rules, "%d;%d;%s" % (SIGNAL_FORMAT, len(signals), ";".join(records))


def unpack_signals(packed, fields=None):
    """Rebuild signal dicts and the pre-cap count; matched text is sliced back
    out of the source row, so spans stay verifiable against the original."""
    if packed.startswith("["):  # pre-compaction rows
        legacy = json.loads(packed)
        return legacy, len(legacy)
    version, total, *records = packed.split(";")
    signals = []
    for record in records:
        if not record: continue
        code, field, start, end, *extra = record.split(":")
        rule = RULE_NAMES.get(code, code)
        name = FIELD_NAMES.get(field, field)
        start, end = int(start), int(end)
        signal = {"rule": rule, "field": name, "start": start, "end": end}
        if fields is not None: signal["text"] = (fields.get(name) or "")[start:end]
        if extra: signal["code_point"] = int(extra[0])
        signals.append(signal)
    return signals, int(total)


@contextlib.contextmanager
def writer_lock(root):
    with (root / "writer.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise MinerError("Another miner is writing this work directory") from None
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


class Store:
    def __init__(self, budget, manifest, settings):
        self.budget = budget
        self.db = sqlite3.connect(str(budget.root / "candidates.sqlite"), isolation_level=None)
        self.db.row_factory = sqlite3.Row
        contract = {"manifest": manifest, "settings": settings, "schema": 3}
        # Reject incompatible discovery before changing journal mode or schema.
        if self.db.execute("SELECT 1 FROM sqlite_master WHERE name='meta'").fetchone():
            prior = self.db.execute("SELECT value FROM meta WHERE key='contract'").fetchone()
            if prior and prior[0] != encode(contract):
                self.db.close()
                raise MinerError("Manifest/filter settings changed; use a new work directory for a new run")
        # A rollback journal rewrites and fsyncs pre-images of every dirty page
        # on each commit; at one commit per batch that was ~45 KB of physical
        # write per scanned row, nearly all of it overhead. WAL appends instead.
        # synchronous=NORMAL can lose the last transactions on power loss but
        # cannot corrupt the file, and a lost batch is exactly what checkpoint
        # resume already replays. close() restores DELETE so the database at
        # rest stays a single readable file for search, reindex and export.
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute("PRAGMA wal_autocheckpoint=4000")
        self.db.execute("PRAGMA temp_store=MEMORY")
        # Index writes during a scan are scattered; a 16 MB cache spilled them
        # to disk continuously. Memory here is cheaper than the write it avoids.
        self.db.execute("PRAGMA cache_size=-262144")
        self.db.execute("PRAGMA busy_timeout=5000")
        budget.constrain_db(self.db)
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS source_pins(key TEXT PRIMARY KEY,identity TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS checkpoints(
          site TEXT,phase TEXT,ordinal INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0,
          updated REAL NOT NULL, PRIMARY KEY(site,phase));
        CREATE TABLE IF NOT EXISTS routing(
          site TEXT,id INTEGER,qid INTEGER NOT NULL,kind INTEGER NOT NULL,PRIMARY KEY(site,id));
        -- routing is only ever read by its (site,id) primary key. An index on
        -- (site,qid) cost one scattered page write per scanned post -- the
        -- dominant physical write of a run -- and served no query. Dropped here
        -- so existing work directories shed it on the next open.
        DROP INDEX IF EXISTS routing_q;
        CREATE TABLE IF NOT EXISTS hits(
          site TEXT,kind TEXT,id INTEGER,post_id INTEGER NOT NULL,score INTEGER NOT NULL,
          rules TEXT NOT NULL,signals TEXT NOT NULL,assessment TEXT NOT NULL,
          PRIMARY KEY(site,kind,id));
        CREATE TABLE IF NOT EXISTS candidates(
          site TEXT,qid INTEGER,score INTEGER NOT NULL,origin TEXT NOT NULL,
          PRIMARY KEY(site,qid));
        CREATE TABLE IF NOT EXISTS documents(
          docid INTEGER PRIMARY KEY,site TEXT NOT NULL,qid INTEGER NOT NULL,kind TEXT NOT NULL,
          id INTEGER NOT NULL,post_id INTEGER NOT NULL,raw TEXT NOT NULL,text TEXT NOT NULL,
          source_hash TEXT NOT NULL,UNIQUE(site,kind,id));
        CREATE INDEX IF NOT EXISTS docs_q ON documents(site,qid,kind,id);
        CREATE INDEX IF NOT EXISTS docs_post ON documents(site,post_id,kind);
        CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(text,content='documents',content_rowid='docid',tokenize='unicode61 remove_diacritics 0');
        CREATE TRIGGER IF NOT EXISTS docs_insert AFTER INSERT ON documents BEGIN
          INSERT INTO search(rowid,text) VALUES(new.docid,new.text); END;
        CREATE TRIGGER IF NOT EXISTS docs_delete AFTER DELETE ON documents BEGIN
          INSERT INTO search(search,rowid,text) VALUES('delete',old.docid,old.text); END;
        CREATE TABLE IF NOT EXISTS duplicates(site TEXT,a INTEGER,b INTEGER,raw TEXT NOT NULL,PRIMARY KEY(site,a,b));
        CREATE INDEX IF NOT EXISTS duplicates_b ON duplicates(site,b);
        CREATE TABLE IF NOT EXISTS rejected(site TEXT,kind TEXT,id INTEGER,rank TEXT NOT NULL,
          raw TEXT NOT NULL,assessment TEXT NOT NULL,PRIMARY KEY(site,kind,id));
        CREATE INDEX IF NOT EXISTS rejected_rank ON rejected(site,kind,rank);
        -- Discovery runs for hours before any document is collected, so without
        -- this the only way to audit what a rule actually matched is to guess at
        -- source text. Same bottom-k sampling as rejected, same tiny cost.
        CREATE TABLE IF NOT EXISTS accepted(site TEXT,kind TEXT,id INTEGER,rank TEXT NOT NULL,
          raw TEXT NOT NULL,assessment TEXT NOT NULL,PRIMARY KEY(site,kind,id));
        CREATE INDEX IF NOT EXISTS accepted_rank ON accepted(site,kind,rank);
        """)
        prior = self.db.execute("SELECT value FROM meta WHERE key='contract'").fetchone()
        if prior and prior[0] != encode(contract):
            # Name what moved. A silent "settings changed" left a 1.05M-row scan
            # stranded because the version string had not changed with the rules.
            was, now = json.loads(prior[0]), contract
            detail = []
            for key in sorted(set(was.get("settings", {})) | set(now.get("settings", {}))):
                before, after = was.get("settings", {}).get(key), now.get("settings", {}).get(key)
                if before != after:
                    detail.append("%s: %s -> %s" % (key, str(before)[:16], str(after)[:16]))
            if [s["site"] for s in was.get("manifest", {}).get("sites", [])] != \
               [s["site"] for s in now.get("manifest", {}).get("sites", [])]:
                detail.append("manifest sites changed")
            self.close()
            raise MinerError("This work directory was built with different rules (" +
                             "; ".join(detail) + "). Use a new work directory, or reindex the "
                             "existing one, which reclassifies saved documents without re-mining.")
        self.set_meta("contract", contract)

    def set_meta(self, key, value):
        self.db.execute("INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, encode(value)))

    def pin(self, key, identity):
        prior = self.db.execute("SELECT identity FROM source_pins WHERE key=?", (key,)).fetchone()
        if identity is None:
            return json.loads(prior[0]) if prior else None
        if prior and json.loads(prior[0]) != identity:
            raise MinerError("Source identity changed; existing checkpoints cannot be reused")
        self.budget.constrain_db(self.db)
        self.db.execute("INSERT OR IGNORE INTO source_pins VALUES(?,?)", (key, encode(identity)))

    def checkpoint(self, site, phase):
        row = self.db.execute("SELECT * FROM checkpoints WHERE site=? AND phase=?", (site, phase)).fetchone()
        return dict(row) if row else {"ordinal": 0, "complete": 0}

    def save_checkpoint(self, site, phase, ordinal, complete=False):
        self.db.execute("INSERT INTO checkpoints VALUES(?,?,?,?,?) ON CONFLICT(site,phase) DO UPDATE SET ordinal=excluded.ordinal,complete=excluded.complete,updated=excluded.updated",
                        (site, phase, ordinal, int(complete), time.time()))

    def add_hit(self, site, kind, row, result):
        post_id = int(row["Id"] if kind == "post" else row["PostId"])
        rules, spans = pack_signals(result["signals"])
        assessment = {key: result[key] for key in ("decision", "facets", "review_reasons", "source_role", "signal_count") if key in result}
        assessment["bindings"] = result.get("bindings", [])[:6]
        assessment["binding_count"] = result.get("binding_count", len(result.get("bindings", [])))
        self.db.execute("INSERT OR REPLACE INTO hits VALUES(?,?,?,?,?,?,?,?)", (site, kind, int(row["Id"]), post_id, result["score"], rules, spans, encode(assessment)))

    def sample_rejected(self, site, kind, row, result, limit):
        self._sample("rejected", site, kind, row, result, limit)

    def sample_accepted(self, site, kind, row, result, limit):
        """Keep source text for a bounded sample of hits, so a rule's real
        matches can be read during discovery instead of inferred."""
        self._sample("accepted", site, kind, row, result, limit)

    def _sample(self, table, site, kind, row, result, limit):
        if limit == 0: return
        rank = digest([site, kind, row["Id"]])
        # A deterministic bottom-k sample; not first-k and stable on resume.
        last = self.db.execute("SELECT rank FROM %s WHERE site=? AND kind=? ORDER BY rank LIMIT 1 OFFSET ?" % table, (site, kind, limit - 1)).fetchone()
        if last and rank >= last[0]: return
        self.db.execute("INSERT OR IGNORE INTO %s VALUES(?,?,?,?,?,?)" % table, (site, kind, int(row["Id"]), rank, encode(row), encode(result)))
        self.db.execute("DELETE FROM %s WHERE site=? AND kind=? AND id IN (SELECT id FROM %s WHERE site=? AND kind=? ORDER BY rank LIMIT -1 OFFSET ?)" % (table, table), (site, kind, site, kind, limit))

    def add_document(self, site, qid, kind, row, text):
        self.db.execute("INSERT OR IGNORE INTO documents(site,qid,kind,id,post_id,raw,text,source_hash) VALUES(?,?,?,?,?,?,?,?)",
                        (site, qid, kind, int(row["Id"]), int(row["Id"] if kind == "post" else row["PostId"]), encode(row), text, digest(row)))

    def candidate_for_post(self, site, post_id):
        row = self.db.execute("SELECT r.qid FROM routing r JOIN candidates c ON c.site=r.site AND c.qid=r.qid WHERE r.site=? AND r.id=?", (site, post_id)).fetchone()
        return row[0] if row else None

    def begin(self):
        self.budget.constrain_db(self.db)
        self.db.execute("BEGIN IMMEDIATE")

    def commit(self):
        self.budget.check()
        self.db.execute("COMMIT")
        self.budget.check()

    def rollback(self):
        if self.db.in_transaction: self.db.execute("ROLLBACK")

    def close(self):
        self.rollback()
        # Leave no -wal/-shm behind: readers open read-only and reindex refuses
        # to fingerprint a source with an active journal.
        path, mode = None, None
        try:
            path = next((Path(row[2]) for row in self.db.execute("PRAGMA database_list")
                         if row[1] == "main" and row[2]), None)
            self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            mode = self.db.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
        except sqlite3.Error:
            pass  # A failed checkpoint must not mask the error that got us here.
        self.db.close()
        # Switching mode before closing means SQLite skips its own WAL cleanup,
        # so the shared-memory index outlives it. It carries nothing durable
        # once the write-ahead log is checkpointed away.
        if path is not None and mode == "delete":
            for suffix in ("-wal", "-shm"):
                sibling = Path(str(path) + suffix)
                if sibling.exists() and (suffix == "-shm" or not sibling.stat().st_size):
                    sibling.unlink(missing_ok=True)


def read_db(root):
    from pathlib import Path
    path = (Path(root).resolve() / "candidates.sqlite")
    if not path.exists(): raise MinerError("No mining database at " + str(path))
    db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    db.execute("PRAGMA busy_timeout=5000")
    return db


def thread(db, site, qid):
    candidate = db.execute("SELECT * FROM candidates WHERE site=? AND qid=?", (site, qid)).fetchone()
    if not candidate: raise MinerError("Unknown candidate thread")
    sources = []
    for row in db.execute("SELECT * FROM documents WHERE site=? AND qid=? ORDER BY CASE kind WHEN 'post' THEN 0 WHEN 'comment' THEN 1 ELSE 2 END,id", (site, qid)):
        value = dict(row)
        value["raw"] = json.loads(value["raw"])
        value["url"] = "https://%s/questions/%d" % (site, qid)
        if value["kind"] == "comment": value["url"] += "#comment%d_%d" % (value["id"], value["post_id"])
        elif value["kind"] == "post" and value["id"] != qid: value["url"] += "#%d" % value["id"]
        elif value["kind"] == "history": value["url"] = "https://%s/posts/%d/revisions" % (site, value["post_id"])
        sources.append(value)
    hits = [dict(r) for r in db.execute("SELECT h.* FROM hits h JOIN documents d ON d.site=h.site AND d.kind=h.kind AND d.id=h.id WHERE d.site=? AND d.qid=? ORDER BY h.kind,h.id", (site, qid))]
    by_source = {(d["kind"], d["id"]): d["raw"] for d in sources}
    for hit in hits:
        hit["signals"], hit["signals_total"] = unpack_signals(hit["signals"], by_source.get((hit["kind"], hit["id"])))
        if "assessment" in hit: hit["assessment"] = json.loads(hit["assessment"])
    contract = json.loads(db.execute("SELECT value FROM meta WHERE key='contract'").fetchone()[0])
    site_source = next(s for s in contract["manifest"]["sites"] if s["site"] == site)
    duplicates = [dict(r) for r in db.execute("SELECT a,b,raw FROM duplicates WHERE site=? AND (a=? OR b=?)", (site, qid, qid))]
    for link in duplicates: link["raw"] = json.loads(link["raw"])
    return {**dict(candidate), "release": contract["manifest"]["release"], "source": site_source,
            "filter_version": contract["settings"], "resolution": "unresolved",
            "documents": sources, "hits": hits, "duplicate_links": duplicates}
