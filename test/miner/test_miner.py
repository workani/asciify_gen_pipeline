"""Offline tests only. Local HTTP fixture servers; no provider or production calls."""
import ctypes as C
import ctypes.util
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout, redirect_stderr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.etree.ElementTree import Element, SubElement, tostring

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from se_miner.archive import Archive
from se_miner.cli import main, parser, resume_command, select_sites
from se_miner.common import Budget, MinerError, SpaceLimit, allowed_site, load_manifest
from se_miner.filtering import classify, fields_for, RULE_HASH, VERSION
from se_miner.inspection import search, report, export_rows
from se_miner.pipeline import Pipeline, inventory
from se_miner.storage import Store, thread, writer_lock
from se_miner.transport import RangeReader, Sources
from se_miner.xmlrows import parse_rows


def xml(table, rows):
    root = Element(table.lower())
    for row in rows:
        SubElement(root, "row", {k: str(v) for k, v in row.items()})
    return tostring(root, encoding="utf-8", xml_declaration=True)


def fixture():
    return {
      "Posts": xml("Posts", [
        {"Id": 1, "PostTypeId": 1, "Title": "Help with this", "Body": "<p>Please see the attachment</p>", "AcceptedAnswerId": 11, "AnswerCount": 1, "CommentCount": 1, "ContentLicense": "CC BY-SA 4.0"},
        {"Id": 11, "PostTypeId": 2, "ParentId": 1, "Body": "<p>Here is the answer</p>", "CommentCount": 2},
        {"Id": 2, "PostTypeId": 1, "Title": "Question two", "Body": "Can anyone help?", "AnswerCount": 1, "CommentCount": 0},
        {"Id": 21, "PostTypeId": 2, "ParentId": 2, "Body": "<p>Use U+03B7: η</p>", "CommentCount": 0},
        {"Id": 3, "PostTypeId": 1, "Title": "Character development", "Body": "The bird symbolizes freedom in this poem.", "AnswerCount": 0, "CommentCount": 0},
        {"Id": 4, "PostTypeId": 1, "Title": "What is this arrow called?", "Body": "<p>I mean ↯ and not →</p>", "AnswerCount": 0, "CommentCount": 0},
        {"Id": 5, "PostTypeId": 1, "Title": "Duplicate discussion", "Body": "See the linked question.", "AnswerCount": 0, "CommentCount": 0},
        {"Id": 6, "PostTypeId": 1, "Title": "Revised title", "Body": "The answer was added later.", "AnswerCount": 0, "CommentCount": 0},
        {"Id": 1000000001, "PostTypeId": 1, "Title": "Unicode sample", "Body": "Synthetic dump row"},
        {"Id": 100, "PostTypeId": 4, "Body": "Unicode tag wiki"},
      ]),
      "Comments": xml("Comments", [
        {"Id": 101, "PostId": 11, "Text": "weird symbol looks like n with a tail, cant find it\tη\u200b", "UserId": 42, "ContentLicense": "CC BY-SA 4.0"},
        {"Id": 102, "PostId": 11, "Text": "thank you; keep this nonmatching comment too"},
        {"Id": 103, "PostId": 1, "Text": "Original question comment"},
        {"Id": 104, "PostId": 3, "Text": "A completely unrelated comment"},
      ]),
      "PostHistory": xml("PostHistory", [
        {"Id": 201, "PostId": 6, "PostHistoryTypeId": 1, "Text": "What is this weird character called?", "RevisionGUID": "rev-6", "ContentLicense": "CC BY-SA 3.0"},
        {"Id": 202, "PostId": 1, "PostHistoryTypeId": 2, "Text": "raw original\nwith ugly   spacing"},
      ]),
      "PostLinks": xml("PostLinks", [
        {"Id": 301, "PostId": 4, "RelatedPostId": 5, "LinkTypeId": 3},
        {"Id": 302, "PostId": 5, "RelatedPostId": 4, "LinkTypeId": 3},
      ]),
    }


def write7z(files):
    lib = C.CDLL(ctypes.util.find_library("archive"))
    signatures = {
      "archive_write_new": (C.c_void_p, []),
      "archive_write_set_format_7zip": (C.c_int, [C.c_void_p]),
      "archive_write_open_memory": (C.c_int, [C.c_void_p, C.c_void_p, C.c_size_t, C.POINTER(C.c_size_t)]),
      "archive_entry_new": (C.c_void_p, []),
      "archive_entry_set_pathname": (None, [C.c_void_p, C.c_char_p]),
      "archive_entry_set_filetype": (None, [C.c_void_p, C.c_uint]),
      "archive_entry_set_perm": (None, [C.c_void_p, C.c_int]),
      "archive_entry_set_size": (None, [C.c_void_p, C.c_int64]),
      "archive_write_header": (C.c_int, [C.c_void_p, C.c_void_p]),
      "archive_write_data": (C.c_ssize_t, [C.c_void_p, C.c_void_p, C.c_size_t]),
      "archive_entry_free": (None, [C.c_void_p]),
      "archive_write_close": (C.c_int, [C.c_void_p]),
      "archive_write_free": (C.c_int, [C.c_void_p]),
    }
    for name, (restype, argtypes) in signatures.items():
        fn = getattr(lib, name)
        fn.restype, fn.argtypes = restype, argtypes
    handle = lib.archive_write_new()
    buffer = C.create_string_buffer(4 * 1024 * 1024)
    used = C.c_size_t()
    assert lib.archive_write_set_format_7zip(handle) == 0
    assert lib.archive_write_open_memory(handle, buffer, len(buffer), C.byref(used)) == 0
    for name, data in files.items():
        entry = lib.archive_entry_new()
        lib.archive_entry_set_pathname(entry, name.encode())
        lib.archive_entry_set_filetype(entry, 0o100000)
        lib.archive_entry_set_perm(entry, 0o644)
        lib.archive_entry_set_size(entry, len(data))
        assert lib.archive_write_header(handle, entry) == 0
        assert lib.archive_write_data(handle, data, len(data)) == len(data)
        lib.archive_entry_free(entry)
    assert lib.archive_write_close(handle) == 0
    lib.archive_write_free(handle)
    return buffer.raw[:used.value]


class HTTPFixture:
    def __init__(self, body, ranges=True):
        self.body, self.ranges, self.etag, self.requests = body, ranges, '"fixture-v1"', []
        self.bad_range = False
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.requests.append(dict(self.headers))
                if self.headers.get("If-Match") and self.headers["If-Match"] != owner.etag:
                    self.send_response(412); self.end_headers(); return
                value = self.headers.get("Range") if owner.ranges else None
                if value:
                    start, end = map(int, value.removeprefix("bytes=").split("-"))
                    end = min(end, len(owner.body) - 1)
                    payload = owner.body[start:end + 1]
                    self.send_response(206)
                    self.send_header("Content-Range", "bytes %d-%d/%d" % (start + int(owner.bad_range), end, len(owner.body)))
                else:
                    payload = owner.body
                    self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("ETag", owner.etag)
                self.end_headers()
                try: self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError): pass
            def log_message(self, *_args): pass
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.url = "http://127.0.0.1:%d/dump.7z" % self.server.server_port
    def __enter__(self): return self
    def __exit__(self, *_args):
        self.server.shutdown(); self.server.server_close(); self.worker.join()


class MiningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.files = fixture()
        self.manifest = {"version": 1, "release": "fixture-1", "sites": [{"site": "tex.stackexchange.com", "files": {}}]}
        for table, data in self.files.items():
            path = self.root / (table + ".xml")
            path.write_bytes(data)
            self.manifest["sites"][0]["files"][table] = {"url": str(path)}
        self.settings = {"filter": VERSION, "rule_hash": RULE_HASH, "threshold": 3, "rejected_sample": 100}
        self.stores = []
    def tearDown(self):
        for store in self.stores:
            try: store.close()
            except sqlite3.ProgrammingError: pass
        self.tmp.cleanup()
    def store(self, name="work", manifest=None, limit=10_000_000_000):
        store = Store(Budget(self.root / name, limit), manifest or self.manifest, self.settings)
        self.stores.append(store)
        return store
    def run_miner(self, store, manifest=None, **kwargs):
        sources = Sources(store.budget, store.pin)
        pipe = Pipeline(store, sources, **kwargs)
        for site in (manifest or self.manifest)["sites"]: pipe.run_site(site)
        return sources

    def two_site_manifest(self):
        """Two hosts over the same local fixture; every table is site-keyed."""
        value = json.loads(json.dumps(self.manifest))
        other = json.loads(json.dumps(value["sites"][0]))
        other["site"] = "math.stackexchange.com"
        value["sites"] = [other, value["sites"][0]]
        path = self.root / "two.manifest.json"
        path.write_text(json.dumps(value))
        return value, path

    def test_only_site_mines_one_host_and_leaves_the_contract_alone(self):
        manifest, path = self.two_site_manifest()
        work = self.root / "scoped"
        out = io.StringIO()
        with redirect_stdout(out), redirect_stderr(io.StringIO()):
            code = main(["run", str(path), "--work-dir", str(work), "--no-ui", "--no-events",
                         "--only-site", "tex.stackexchange.com"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["scope"], ["tex.stackexchange.com"])
        db = sqlite3.connect(str(work / "candidates.sqlite"))
        try:
            for table in ("checkpoints", "documents", "candidates", "hits"):
                self.assertEqual({r[0] for r in db.execute("SELECT DISTINCT site FROM " + table)},
                                 {"tex.stackexchange.com"}, table)
            # The unselected site is still pinned, so the other machine's
            # directory keeps the same contract and the two stay mergeable.
            contract = json.loads(db.execute("SELECT value FROM meta WHERE key='contract'").fetchone()[0])
            self.assertEqual([site["site"] for site in contract["manifest"]["sites"]],
                             ["math.stackexchange.com", "tex.stackexchange.com"])
        finally:
            db.close()
        # The unfiltered manifest still opens the same directory afterwards.
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main(["run", str(path), "--work-dir", str(work), "--no-ui", "--no-events"]), 0)

    def test_only_site_rejects_hosts_the_manifest_does_not_list(self):
        _, path = self.two_site_manifest()
        with self.assertRaises(MinerError):
            select_sites(json.loads(path.read_text()), ["english.stackexchange.com"])
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = main(["run", str(path), "--work-dir", str(self.root / "absent"), "--no-ui",
                         "--no-events", "--only-site", "english.stackexchange.com"])
        self.assertEqual(code, 2)
        self.assertFalse((self.root / "absent" / "candidates.sqlite").exists())

    def test_resume_command_keeps_the_scope(self):
        args = parser().parse_args(["run", "m.json", "--only-site", "tex.stackexchange.com",
                                    "--work-dir", ".miner-tex"])
        self.assertIn("--only-site tex.stackexchange.com", resume_command(args))

    def test_scope_rejects_overflow_and_lookalikes(self):
        for host in ("stackoverflow.com", "ru.stackoverflow.com", "meta.stackoverflow.com", "mathoverflow.net", "tex.stackexchange.com.evil.test", "evilstackexchange.com", "tex.stackexchange.com/path", "tex.stackexchange.com:443"):
            self.assertFalse(allowed_site(host), host)
        for host in ("tex.stackexchange.com", "math.stackexchange.com", "tex.meta.stackexchange.com", "meta.stackexchange.com"):
            self.assertTrue(allowed_site(host))

    def test_comments_promote_and_collect_entire_thread(self):
        store = self.store(); self.run_miner(store)
        value = thread(store.db, "tex.stackexchange.com", 1)
        self.assertEqual({(d["kind"], d["id"]) for d in value["documents"]}, {("post", 1), ("post", 11), ("comment", 101), ("comment", 102), ("comment", 103), ("history", 202)})
        self.assertEqual([(h["kind"], h["id"]) for h in value["hits"]], [("comment", 101)])
        comment = next(d for d in value["documents"] if d["id"] == 101)
        self.assertEqual(comment["raw"]["Text"], "weird symbol looks like n with a tail, cant find it\tη\u200b")
        for signal in value["hits"][0]["signals"]:
            raw = comment["raw"][signal["field"]]
            self.assertEqual(raw[signal["start"]:signal["end"]], signal["text"])
        self.assertEqual(report(store.db)["comment_only_threads"], 1)

    def test_answers_history_duplicates_and_irrelevant(self):
        store = self.store(); self.run_miner(store)
        self.assertEqual([r[0] for r in store.db.execute("SELECT qid FROM candidates ORDER BY qid")], [1, 2, 4, 6])
        self.assertEqual(store.db.execute("SELECT COUNT(*) FROM duplicates").fetchone()[0], 2)
        self.assertEqual(store.db.execute("SELECT COUNT(*) FROM documents WHERE qid=5").fetchone()[0], 0)
        self.assertEqual(thread(store.db, "tex.stackexchange.com", 6)["hits"][0]["kind"], "history")
        result = report(store.db)
        self.assertEqual(result["status"], "complete")
        self.assertFalse(any(result["warnings"].values()))

    def test_search_words_glyph_invisible_comments_history(self):
        store = self.store(); self.run_miner(store)
        self.assertEqual(search(store.db, "n tail", kind="comment")[0]["qid"], 1)
        self.assertEqual(search(store.db, "↯")[0]["qid"], 4)
        self.assertEqual(search(store.db, "\u200b", mode="literal")[0]["id"], 101)
        self.assertIn(2, [r["qid"] for r in search(store.db, "U+03B7", mode="codepoint")])
        self.assertEqual(search(store.db, "weird character", kind="history")[0]["qid"], 6)
        self.assertEqual(search(store.db, "thank you", kind="comment")[0]["id"], 102)
        self.assertEqual(search(store.db, "n tail", site="math.stackexchange.com"), [])

    def test_resume_is_equivalent_and_idempotent(self):
        expected = self.store("full"); self.run_miner(expected)
        actual = self.store("resume")
        with self.assertRaisesRegex(MinerError, "row limit"):
            self.run_miner(actual, stop_after=12, batch=3)
        self.assertEqual(actual.checkpoint("tex.stackexchange.com", "discover_comments")["ordinal"], 2)
        self.run_miner(actual, batch=3)
        self.run_miner(actual, batch=3)
        self.assertEqual(list(export_rows(expected.db)), list(export_rows(actual.db)))
        self.assertEqual(list(export_rows(expected.db, "rejected")), list(export_rows(actual.db, "rejected")))

    def test_changed_local_source_rejects_resume(self):
        store = self.store(); self.run_miner(store)
        path = self.root / "Comments.xml"
        path.write_bytes(path.read_bytes().replace(b"unrelated", b"different"))
        with self.assertRaisesRegex(MinerError, "Source changed"):
            self.run_miner(store)

    def test_contract_changes_reject_resume(self):
        store = self.store(); store.close()
        with self.assertRaisesRegex(MinerError, "settings changed"):
            Store(store.budget, self.manifest, {**self.settings, "threshold": 10})

    def test_truncated_xml_never_marks_complete(self):
        path = self.root / "Comments.xml"
        path.write_bytes(path.read_bytes()[:-15])
        store = self.store()
        with self.assertRaisesRegex(MinerError, "Malformed XML"):
            self.run_miner(store, batch=1)
        self.assertFalse(store.checkpoint("tex.stackexchange.com", "discover_comments")["complete"])
        self.assertFalse(store.db.in_transaction)

    def test_xml_chunks_entities_and_forbidden_dtd(self):
        values = []
        body = xml("Comments", [{"Id": 1, "PostId": 2, "Text": "<>& \"' η\u200b\n\t"}])
        parse_rows((body[i:i+1] for i in range(len(body))), lambda v,n: values.append(v), "Comments")
        self.assertEqual(values[0]["Text"], "<>& \"' η\u200b\n\t")
        with self.assertRaisesRegex(MinerError, "DTD"):
            parse_rows([b'<!DOCTYPE posts [<!ENTITY e "boom">]><posts/>'], lambda *_: None, "Posts")
        with self.assertRaises(MinerError):
            parse_rows([b'<posts><row Id="1" Text="' + b'a'*1000 + b'"/></posts>'], lambda *_: None, "Posts", max_row_bytes=100)

    def test_filter_does_not_treat_any_unicode_or_character_as_candidate(self):
        for text in ("Η ελληνική γλώσσα", "Character development in the novel", "The bird is a symbol of freedom", "x = a * b;"):
            self.assertFalse(classify({"Body": text})["candidate"], text)
        for text in ("What does * mean in this expression? This operator confuses me", "How can I type this symbol?", "Use U+202F", "an invisible character", "looks like an n with a tail"):
            self.assertTrue(classify({"Body": text})["candidate"], text)

    def test_7z_stream_and_remote_range_pipeline(self):
        payload = write7z({key + ".xml": data for key, data in self.files.items()})
        with HTTPFixture(payload) as http:
            manifest = {"version": 1, "release": "fixture-7z", "sites": [{"site": "tex.stackexchange.com", "archive": {"url": http.url}}]}
            store = self.store(manifest=manifest)
            sources = self.run_miner(store, manifest)
            self.assertEqual(report(store.db)["candidates"], 4)
            self.assertEqual(list(store.budget.cache.iterdir()), [])
            self.assertTrue(all("Range" in headers for headers in http.requests))
            self.assertGreater(sources.stats["http_bytes"], 0)

    def test_nonrange_fallback_reclaims_cache(self):
        payload = write7z({key + ".xml": data for key, data in self.files.items()})
        with HTTPFixture(payload, ranges=False) as http:
            manifest = {"version": 1, "release": "fixture-7z", "sites": [{"site": "tex.stackexchange.com", "archive": {"url": http.url}}]}
            store = self.store(manifest=manifest)
            self.run_miner(store, manifest)
            self.assertEqual(report(store.db)["candidates"], 4)
            self.assertEqual(list(store.budget.cache.iterdir()), [])
            self.assertEqual(sum("Range" not in h for h in http.requests), 1)

    def test_range_cache_seek_change_and_malformed(self):
        with HTTPFixture(bytes(range(256))*100) as http:
            stream = RangeReader(http.url, block_size=1024, cache_blocks=2)
            self.assertEqual(stream.read(16), bytes(range(16)))
            stream.seek(-5, 2)
            self.assertEqual(stream.read(20), bytes(range(251, 256)))
            stream.seek(5000); stream.read(4)
            self.assertLessEqual(len(stream.cache), 2)
            http.etag = '"changed"'
            stream.seek(9000)
            with self.assertRaises(MinerError): stream.read(3)
            stream.close()
            http.bad_range = True
            with self.assertRaises(MinerError): RangeReader(http.url)

    def test_sha256_remote_without_disk_cache(self):
        body = b"content to verify"
        with HTTPFixture(body) as http:
            store = self.store()
            sources = Sources(store.budget, store.pin)
            spec = {"url": http.url, "sha256": hashlib.sha256(body).hexdigest()}
            with sources.open(spec) as stream:
                self.assertEqual(stream.read(100), body)
            self.assertEqual(list(store.budget.cache.iterdir()), [])
            with sources.open(spec) as stream: self.assertEqual(stream.read(100), body)
            with self.assertRaisesRegex(MinerError, "checksum"):
                sources.open({"url": http.url, "sha256": "0"*64})

    def test_budget_checks_and_sqlite_full_rollback(self):
        store = self.store(limit=8 * 1024 * 1024)
        with self.assertRaises(SpaceLimit): store.budget.check(8 * 1024 * 1024)
        store.begin()
        try:
            with self.assertRaises(sqlite3.OperationalError):
                for i in range(10): store.db.execute("INSERT INTO meta VALUES(?,?)", ("large" + str(i), os.urandom(600000).hex()))
        finally:
            store.rollback()
        self.assertLessEqual(store.budget.used(), store.budget.limit)
        self.assertEqual(store.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(store.db.execute("SELECT COUNT(*) FROM meta WHERE key LIKE 'large%'").fetchone()[0], 0)

    def test_exclusive_writer_lock(self):
        budget = Budget(self.root / "lock")
        with writer_lock(budget.root):
            with self.assertRaisesRegex(MinerError, "Another miner"):
                with writer_lock(budget.root): pass

    def test_plain_gzip_inputs(self):
        for table in self.files:
            path = self.root / (table + ".xml.gz")
            path.write_bytes(gzip.compress(self.files[table]))
            self.manifest["sites"][0]["files"][table]["url"] = str(path)
        store = self.store(); self.run_miner(store)
        self.assertEqual(report(store.db)["candidates"], 4)

    def test_missing_comments_manifest_fails(self):
        del self.manifest["sites"][0]["files"]["Comments"]
        path = self.root / "manifest.json"; path.write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(MinerError, "Comments"):
            load_manifest(path)

    def test_cross_site_ids_do_not_collide(self):
        second = json.loads(json.dumps(self.manifest["sites"][0]))
        second["site"] = "math.stackexchange.com"
        self.manifest["sites"].append(second)
        store = self.store(); self.run_miner(store)
        self.assertEqual(report(store.db)["candidates"], 8)
        self.assertEqual(len(search(store.db, "n tail")), 2)

    def test_optional_missing_tables_reported(self):
        del self.manifest["sites"][0]["files"]["PostHistory"]
        del self.manifest["sites"][0]["files"]["PostLinks"]
        store = self.store(); self.run_miner(store)
        self.assertEqual(report(store.db)["tables"]["tex.stackexchange.com"]["missing_optional"], ["PostHistory", "PostLinks"])

    def test_oversized_cache_download_stops_without_partial(self):
        with HTTPFixture(b"x" * (9 * 1024 * 1024), ranges=False) as http:
            store = self.store(limit=8 * 1024 * 1024)
            sources = Sources(store.budget, store.pin)
            with self.assertRaises(SpaceLimit): sources.open({"url": http.url})
            self.assertEqual(list(store.budget.cache.iterdir()), [])
            self.assertLess(store.budget.used(), store.budget.limit)

    def test_archive_path_traversal_and_missing_table(self):
        with Archive(io.BytesIO(write7z({"../Posts.xml": b"<posts/>"}))) as archive:
            with self.assertRaisesRegex(MinerError, "Unsafe"):
                list(archive.members())
        path = self.root / "missing.7z"
        path.write_bytes(write7z({"Posts.xml": b"<posts/>"}))
        site = {"site": "tex.stackexchange.com", "archive": {"url": str(path)}}
        store = self.store()
        with self.assertRaisesRegex(MinerError, "Comments"):
            inventory(site, Sources(store.budget, store.pin))

    def test_missing_comment_coverage_warning_and_export_gate(self):
        self.files["Comments"] = self.files["Comments"].replace(b'<row Id="102" PostId="11" Text="thank you; keep this nonmatching comment too" />', b"")
        (self.root / "Comments.xml").write_bytes(self.files["Comments"])
        store = self.store(); self.run_miner(store)
        self.assertEqual(report(store.db)["warnings"]["comment_count_mismatches"], 1)
        self.assertEqual(report(store.db)["status"], "complete_with_warnings")
        output = self.root / "export.jsonl"
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = main(["export", "--work-dir", str(store.budget.root), "--output", str(output)])
        self.assertEqual(code, 2)
        self.assertFalse(output.exists())

    def test_export_no_overwrite_and_partial_file_preservation(self):
        store = self.store(); self.run_miner(store)
        output = self.root / "export.jsonl"
        partial = output.with_name(output.name + ".partial")
        partial.write_text("existing partial evidence")
        args = ["export", "--work-dir", str(store.budget.root), "--output", str(output)]
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main(args), 2)
        self.assertEqual(partial.read_text(), "existing partial evidence")
        partial.unlink()
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main(args), 0)
            original = output.read_text()
            self.assertEqual(main(args), 2)
        self.assertEqual(output.read_text(), original)
        self.assertEqual(len(original.splitlines()), 4)
        self.assertFalse(partial.exists())

    def test_codepoint_search_does_not_match_longer_label(self):
        store = self.store(); self.run_miner(store)
        row = {"Id": "999", "PostTypeId": "2", "ParentId": "1", "Body": "U+03B70"}
        store.add_document("tex.stackexchange.com", 1, "post", row, "U+03B70")
        self.assertNotIn(999, [r["id"] for r in search(store.db, "03B7", mode="codepoint")])
        with self.assertRaises(MinerError): search(store.db, "D800", mode="codepoint")

    def test_search_pagination_priority_and_match_excerpt(self):
        store = self.store(); self.run_miner(store)
        all_rows = search(store.db, "symbol", limit=100)
        first = search(store.db, "symbol", limit=1)
        rest = search(store.db, "symbol", offset=1, limit=100)
        self.assertEqual(first + rest, all_rows)
        self.assertEqual(search(store.db, "symbol", min_score=100), [])
        text = "uninteresting " * 100 + "↯ at the end"
        row = {"Id": "999", "PostTypeId": "2", "ParentId": "1", "Body": text}
        store.add_document("tex.stackexchange.com", 1, "post", row, text)
        found = next(r for r in search(store.db, "↯", mode="literal") if r["id"] == 999)
        self.assertGreater(found["excerpt_start"], 0)
        self.assertIn("↯", found["excerpt"])


if __name__ == "__main__": unittest.main()
