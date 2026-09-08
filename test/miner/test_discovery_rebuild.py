"""Offline acceptance contracts: real source calibration and structural invariants."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from se_miner.common import Budget, MinerError
from se_miner.filtering import classify, fields_for, search_text, RULE_HASH, VERSION
from se_miner.searchindex import build, search
from se_miner.storage import Store


class DiscoveryRebuildTests(unittest.TestCase):
    def test_saved_reference_and_live_audit_sources(self):
        for name in ("discovery-reference.json", "discovery-v5-audit.json"):
            data = json.loads((Path(__file__).parent / "fixtures" / name).read_text())
            for case in data["cases"]:
                with self.subTest(dataset=name, reference=case["reference"]):
                    result = classify(case["fields"], source_role=case["role"])
                    if case["label"] != "UNCERTAIN":
                        self.assertEqual(result["candidate"], case["label"] == "KEEP")
                    self.assertEqual(result["resolution"], "unresolved")
                    self.assertNotIn("resolved_target", result)
                    for signal in result["signals"]:
                        raw = case["fields"][signal["field"]]
                        self.assertEqual(raw[signal["start"]:signal["end"]], signal["text"])
                    for binding in result["bindings"]:
                        for key in ("target", "evidence"):
                            span = binding[key]
                            self.assertTrue(any(all(s[k] == span[k] for k in ("field", "start", "end"))
                                                for s in result["signals"]))

    def test_direct_glyph_meaning_has_full_priority(self):
        for text in ("What does * mean in this expression?", "What does ↯ mean?",
                     r"What does $\lhd$ mean?", "What do [] mean?", "What does `*` mean?"):
            with self.subTest(text=text):
                a = classify({"Text": text}, threshold=8)
                self.assertEqual((a["candidate"], a["decision"], a["score"]), (True, "keep", 8))
                self.assertEqual(a["review_reasons"], [])
                self.assertTrue(any(b["operation"] == "meaning" for b in a["bindings"]))

    def test_math_operations_and_jargon_are_not_glyph_operations(self):
        for text in (r"I don't know how to find $p$.", r"We want a $\mathbf{W}$ with these properties.",
                     "Which letters can appear in this permutation?", "What is the character of this representation?",
                     "We cannot find a character of this group.", "What is the symbol of a pseudodifferential operator?",
                     "Rotated ellipses with three focal points", "What's 8 + 6?", "Type 2 polynomials",
                     "The symbol above is part of the proof.", "This is an Action Script 3 program."):
            with self.subTest(text=text):
                self.assertFalse(classify({"Title": text})["candidate"])

    def test_appearance_belongs_to_the_target(self):
        for text in ("The character has dimension two in the representation above.",
                     "The ellipse looks like a stretched circle.", "The letter retracts to a circle, then rotate it.",
                     "This looks like a 2-dimensional cutting-stock problem."):
            with self.subTest(text=text): self.assertFalse(classify({"Text": text})["candidate"])
        for text in ("A symbol that looks like a sector of a circle.", "n with a tail", "backwards epsilon"):
            with self.subTest(text=text): self.assertTrue(classify({"Text": text})["candidate"])

    def test_formulas_and_code_remain_opaque_when_punctuation_changes(self):
        for formula in (r"x \in A", r"x. \in A!", r"x? \in A;", r"\hline \alpha = 3"):
            for left, right in (("$", "$"), ("$$", "$$"), (r"\(", r"\)"), (r"\[", r"\]")):
                with self.subTest(formula=formula, delimiter=left):
                    self.assertFalse(classify({"Text": "We compute " + left + formula + right})["candidate"])
        for text in ("```tex\nWhat does * mean?\nU+2192\n```", r"\begin{array} What does * mean? U+2192",
                     '<pre><code>What does * mean? U+2192</code></pre>'):
            with self.subTest(text=text): self.assertFalse(classify({"Body": text})["candidate"])

    def test_validated_hex_requires_unicode_context(self):
        positive = classify({"Body": '<p>The Unicode for this character is <code>0x3D0</code>.</p>'})
        self.assertEqual(positive["status"], "identity_evidence")
        self.assertEqual([s["code_point"] for s in positive["signals"] if "code_point" in s], [0x3D0])
        for text in ("The address is 0x3D0.", "Unicode 0xD800", "Unicode 0x110000"):
            self.assertFalse(classify({"Text": text})["candidate"])

    def test_review_does_not_compete_with_direct_requests(self):
        review = classify({"Text": "How do I type this on a Mac?"})
        self.assertEqual((review["decision"], review["score"]), ("review", 3))
        self.assertEqual(review["review_reasons"], ["unbound_typing"])
        self.assertFalse(classify({"Text": "How do I type this on a Mac?"}, threshold=4)["candidate"])

    def test_supplemental_evidence_can_be_the_only_source(self):
        for role in ("comment", "history"):
            a = classify({"Text": "What is this symbol called? It looks like an n with a tail."}, source_role=role)
            self.assertTrue(a["candidate"])
            self.assertEqual(a["source_role"], role)


class DiscoveryPersistenceTests(unittest.TestCase):
    def test_identical_question_and_answer_text_keep_distinct_assessments(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            store = Store(Budget(root), {"release": "offline"}, {"filter": VERSION})
            site = "math.stackexchange.com"
            body = r"You can use the LaTeX code \cdot to produce the multiplication symbol."
            for ident, post_type in ((1, "1"), (2, "2")):
                row = {"Id": str(ident), "PostTypeId": post_type, "Body": body, "ParentId": "1"}
                store.add_document(site, 1, "post", row, search_text("post", row))
            store.close()
            build(root)
            question = search(root, "multiplication")[0]
            self.assertEqual(question["role"], "question")
            # Inspect both cached assessments: text deduplication must not reuse
            # a question's request priority for an answer's typing suggestion.
            import sqlite3
            with sqlite3.connect(root / "search-v2.sqlite") as db:
                values = dict(db.execute("SELECT r.role,a.status FROM records r JOIN assessments a USING(aid)"))
            self.assertEqual(values, {"question": "character_request", "answer": "character_discussion"})

    def test_decisions_bindings_and_review_survive_storage_and_search(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            store = Store(Budget(root), {"release": "offline"}, {"filter": VERSION, "rule_hash": RULE_HASH})
            site = "math.stackexchange.com"
            for ident, title in ((1, "What does ↯ mean?"), (2, "How do I type this on a Mac?")):
                row = {"Id": str(ident), "PostTypeId": "1", "Title": title, "Body": ""}
                result = classify(fields_for("post", row), source_role="question")
                store.add_hit(site, "post", row, result)
                store.db.execute("INSERT INTO candidates VALUES(?,?,?,'signal')", (site, ident, result["score"]))
                store.add_document(site, ident, "post", row, search_text("post", row))
            saved = json.loads(store.db.execute("SELECT assessment FROM hits WHERE id=1").fetchone()[0])
            self.assertEqual(saved["decision"], "keep")
            self.assertEqual(saved["bindings"][0]["operation"], "meaning")
            self.assertGreater(saved["binding_count"], 0)
            store.close()
            build(root)
            review = search(root, "type", scope="review")
            self.assertEqual([r["qid"] for r in review], [2])
            self.assertEqual(review[0]["thread_status"], "review")
            self.assertEqual(review[0]["discovery_decision"], "review")
            self.assertEqual(search(root, "type"), [])
            self.assertEqual(search(root, "↯")[0]["discovery_bindings"][0]["operation"], "meaning")

    def test_incompatible_contract_rejected_before_database_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            store = Store(Budget(root), {"release": "offline"}, {"filter": "prior"})
            store.close()
            path = root / "candidates.sqlite"
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(MinerError, "new work directory"):
                Store(Budget(root), {"release": "offline"}, {"filter": VERSION})
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
            self.assertFalse(Path(str(path) + "-wal").exists())


if __name__ == "__main__":
    unittest.main()
