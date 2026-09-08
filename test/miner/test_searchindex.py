"""Offline adversarial contracts and real-pilot-derived regression cases."""
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from se_miner.common import Budget, MinerError, SpaceLimit
from se_miner.filtering import classify, fields_for, search_text, RULE_HASH, VERSION
from se_miner.references import explicit_references
from se_miner.searchindex import build, search, open_index, fingerprint
from se_miner.storage import Store
from se_miner.textviews import make_view


class EvidenceTests(unittest.TestCase):
    def test_real_pilot_regressions(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/pilot-v2.json').read_text())
        for case in fixture['cases']:
            with self.subTest(site=case['site'], kind=case['kind'], id=case['id']):
                result = classify(case['fields'])
                self.assertEqual(result['status'], case['expected_status'])
                for signal in result['signals']:
                    self.assertEqual(case['fields'][signal['field']][signal['start']:signal['end']], signal['text'])

    def test_adversarial_non_character_language(self):
        cases = ["I'm looking for a word", "I’m looking for the right phrase", "He's looking for work",
                 "I can't looking", "It looks like a disaster", "It looks like a good idea",
                 "It looks like I should go", "What do you call a fictional character?",
                 "How should I write a business letter?", "What is a British accent?",
                 "What is the symbol of freedom?", "What does `the word` mean?",
                 "What does [this word](https://example.com/?ie=UTF-8) mean?",
                 "What does *word* mean?", "What is the word? My keyboard has a strange layout.",
                 "See https://example.com/?ie=UTF-8&code=U+200B", "https://example.com/Unicode",
                 "The novel has four characters", "Which word do I use in this cover letter?"]
        for value in cases:
            with self.subTest(value=value): self.assertFalse(classify({"Text": value})["candidate"])

    def test_high_recall_request_paraphrases(self):
        cases = ["What do you call this symbol?", "What's this symbol called?", "whats this symbol?",
                 "What is this weird character called?", "n with a tail", "n-looking Greek symbol",
                 "It looks like an n with a tail", "It looks like 'a'", "It looks like the letter n",
                 "two triangles touching", "horizontal hourglass", "zigzag lightning",
                 "What does * mean in this expression?", "What does ↯ mean?",
                 "How can I type this character?", "Which character is on the keyboard?",
                 "What is this punctuation mark?", "Can anyone identify this glyph?"]
        for value in cases:
            with self.subTest(value=value): self.assertEqual(classify({"Text": value})["status"], "character_request")

    def test_identity_mentions_are_not_resolved_requests(self):
        for value in ["Use U+03B7", r"Try \u03B7", r"\bowtie", "GREEK SMALL LETTER ETA"]:
            with self.subTest(value=value):
                result = classify({"Text": value})
                self.assertEqual(result["status"], "identity_evidence")
                self.assertEqual(result["resolution"], "unresolved")
        self.assertEqual(classify({"Text": "ASCII is an encoding"})["status"], "context_only")
        self.assertEqual(classify({"Text": "That is a long S"})["status"], "character_discussion")

    def test_html_urls_entities_images_and_exact_offsets(self):
        raw = '<p>What do you call <em>this symbol</em>: &#x2192;?</p><a href="https://example.com/Unicode/U+200B">source</a><script>U+03B7</script>'
        view = make_view(raw, "Body", True)
        self.assertNotIn("200B", view.text)
        self.assertNotIn("03B7", view.text)
        point = view.text.index("→")
        self.assertEqual(view.evidence("glyph", point, point + 1)["text"], "&#x2192;")
        result = classify({"Body": raw})
        self.assertEqual(result["status"], "character_request")
        for signal in result["signals"]:
            self.assertEqual(raw[signal["start"]:signal["end"]], signal["text"])
        self.assertFalse(classify({"Body": '<p>What is this?</p><img src="x.png" alt="scan">'})["candidate"])
        self.assertIn("needs_image", classify({"Title": "What is this symbol?", "Body": '<img src="x.png" alt="scan">'})["routes"])
        self.assertEqual(classify({"Body": '<a href="https://x/Unicode">plain text</a>'})["status"], "unrelated")

    def test_unicode_validation(self):
        self.assertEqual([r[2] for r in explicit_references(r'U+03B7 U+03B70 U+D800 U+110000 \uD83D\uDE00 \uD800 \u{2192}')], [0x3b7, 0x3b70, 0x1f600, 0x2192])
        self.assertEqual(list(explicit_references('U+03B7abcde wordU+03B7')), [])
        self.assertEqual([r[2] for r in explicit_references('GREEK SMALL LETTER ETA')], [0x3b7])
        self.assertEqual(list(explicit_references('GREEK SMALL LETTER NONEXISTENT')), [])
        self.assertEqual(classify({'Text': 'GREEK SMALL LETTER NONEXISTENT'})['status'], 'unrelated')

    def test_punctuation_recall(self):
        for text in ('Sincerely [comma?] name', 'Use a semicolon here', 'The old text has quotation marks'):
            self.assertEqual(classify({'Text': text})['status'], 'context_only')
            self.assertFalse(classify({'Text': text}, threshold=1)['candidate'])


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.budget = Budget(self.root)
        self.store = Store(self.budget, {"release": "offline", "sites": [{"site": "english.stackexchange.com"}]}, {"filter": VERSION, "rule_hash": RULE_HASH})
        self.site = "english.stackexchange.com"
        self.add(1, 1, "post", "What is this symbol?", "A zigzag arrow ↯ and decomposed e\u0301. An emoji 👩‍💻.")
        self.add(1, 11, "post", "", "Use U+21AF. A lightning arrow.")
        self.add(1, 101, "history", "", "What is this symbol? A zigzag arrow ↯ and decomposed e\u0301.")
        self.add(1, 102, "history", "", "What is this symbol? A zigzag arrow ↯ and decomposed e\u0301.")
        self.add(2, 2, "post", "Ordinary words", "A dictionary quote with an incidental \u200b mark and arrow →.")
        self.add(3, 3, "post", "What is this invisible character?", "Please help.")
        self.add(3, 31, "comment", "", "It is U+200B, zero width space.")
        self.add(4, 4, "post", "What do you call this symbol?", "Only precomposed é here. Separate emoji 👩 💻.")
        self.add(4, 41, "comment", "", "The sequence U+0065 and separately U+0301 is mentioned.")
        self.add(5, 5, "post", "Unrelated question", "A question about words.")
        self.add(5, 51, "post", "", "A quoted question: What is this arrow called?")
        self.store.close()

    def tearDown(self): self.temp.cleanup()

    def add(self, qid, ident, kind, title, body):
        row = {"Id": str(ident)}
        if kind == "post": row.update(Title=title, Body="<p>" + body + "</p>", PostTypeId="1" if qid == ident else "2", ParentId=str(qid))
        else: row.update(Text=body, PostId=str(qid))
        self.store.db.execute("INSERT OR IGNORE INTO candidates VALUES(?,?,8,'signal')", (self.site, qid))
        self.store.add_document(self.site, qid, kind, row, search_text(kind, row))

    def test_resume_idempotence_and_source_untouched(self):
        before = fingerprint(self.root)
        partial = build(self.root, batch=2, max_documents=3)
        self.assertEqual(partial["processed"], 3)
        with self.assertRaisesRegex(MinerError, "incomplete"): search(self.root, "arrow")
        done = build(self.root, batch=2)
        self.assertEqual(done["state"], "ready")
        self.assertEqual(done["counts"]["records"], 11)
        self.assertLess(done["counts"]["contents"], 11)
        self.assertEqual(build(self.root), done)
        self.assertEqual(before, fingerprint(self.root))

    def test_thread_dedupe_and_current_provenance(self):
        build(self.root)
        results = search(self.root, "zigzag")
        self.assertEqual([r["qid"] for r in results], [1])
        self.assertEqual(results[0]["role"], "question")
        self.assertEqual(results[0]["thread_status"], "request_with_evidence")
        self.assertEqual(results[0]["resolution"], "unresolved")
        self.assertEqual(search(self.root, "zigzag", kind="history")[0]["role"], "history")

    def test_codepoints_explicit_incidental_and_comments(self):
        build(self.root)
        self.assertEqual(search(self.root, "U+200B")[0]["id"], 31)
        self.assertEqual([r["qid"] for r in search(self.root, "U+200B", scope="all")], [3, 2])
        self.assertEqual([r["qid"] for r in search(self.root, "U+200B", scope="all", mention="literal")], [2])
        self.assertEqual([r["qid"] for r in search(self.root, "U+200B", scope="all", mention="explicit")], [3])
        self.assertEqual(search(self.root, "U+200B", kind="comment")[0]["role"], "comment")
        for value in ("D800", "110000"):
            with self.assertRaises(MinerError): search(self.root, value, mode="codepoint")

    def test_exact_sequences_and_mixed_glyph_word_queries(self):
        build(self.root)
        self.assertEqual([r["qid"] for r in search(self.root, "U+0065 U+0301")], [1])
        self.assertEqual([r["qid"] for r in search(self.root, "é", mode="literal")], [4])
        self.assertEqual([r["qid"] for r in search(self.root, "e\u0301")], [1])
        self.assertEqual([r["qid"] for r in search(self.root, "👩‍💻")], [1])
        self.assertEqual([r["qid"] for r in search(self.root, "emoji 👩‍💻")], [1])
        self.assertEqual([r["qid"] for r in search(self.root, "arrow ↯")], [1])
        self.assertEqual(search(self.root, "arrow →"), [])
        self.assertEqual([r["qid"] for r in search(self.root, "arrow →", scope="all")], [2])
        self.assertEqual([r["qid"] for r in search(self.root, "zigzag arrow", mode="literal")], [1])
        self.assertEqual(search(self.root, "zigzag", site="math.stackexchange.com"), [])

    def test_quotes_in_answers_do_not_become_question_requests(self):
        build(self.root)
        self.assertNotIn(5, [r["qid"] for r in search(self.root, "arrow", scope="requests")])
        self.assertIn(5, [r["qid"] for r in search(self.root, "arrow", scope="relevant")])

    def test_stale_source_is_rejected(self):
        build(self.root)
        path = self.root / "candidates.sqlite"
        os.utime(path, ns=(path.stat().st_atime_ns, path.stat().st_mtime_ns + 1))
        with self.assertRaisesRegex(MinerError, "stale"): search(self.root, "arrow")
        with self.assertRaisesRegex(MinerError, "changed"): build(self.root)

    def test_budget_counts_sibling_databases(self):
        budget = Budget(self.root, 12 * 1024 * 1024)
        (self.root / "sibling.sqlite").write_bytes(b'x' * (10 * 1024 * 1024))
        db = sqlite3.connect(self.root / "test.sqlite")
        try:
            with self.assertRaises(SpaceLimit): budget.constrain_db(db)
        finally: db.close()


if __name__ == '__main__': unittest.main()
