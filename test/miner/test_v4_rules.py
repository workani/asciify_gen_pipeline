"""Regressions for the v4 changes: LaTeX-as-subject, request structure, and
compact discovery bookkeeping. Positives and negatives here were written from
the observed math/TeX failure modes; they are calibration, not a benchmark."""
import json
from pathlib import Path
import sys
import sqlite3
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src'))
from se_miner.filtering import classify, fields_for
from se_miner.storage import SIGNAL_LIMIT, encode, pack_signals, unpack_signals

IMAGE = '<p><img src="https://i.stack.imgur.com/x.png" alt=""></p>'


def status(text, title='', tags=''):
    return classify({'Title': title, 'Body': '<p>' + text + '</p>', 'Tags': tags})


class LatexSubjectTests(unittest.TestCase):
    """A command inside a formula is notation about something else. \\in in
    "x \\in A" produced 3.0M discovery hits and zero collected documents."""

    NOTATION = [
        r'Since $x \in A$ and $A \subset B$, we get $x \in B$.',
        r'I have to prove that $x \sec x - \ln|\sec x + \tan x| + C$ is the integral.',
        r'The arrows $f\rightarrow g$ and $h \rightarrow k$ commute, so the brackets mean the commutator.',
        r'The limit as $n \rightarrow \infty$ of the partial sums represents the total.',
        r'Let $\alpha$ denote the angle between the two vectors.',
        r'Define $\phi$ to be the map that represents this action.',
        r'We need to find the value of $\theta$ and $\lambda$ in the diagram.',
        # TeX SE asks about structural commands constantly; those are not glyphs.
        r'How do I use \newcommand to define a shortcut in my preamble?',
        r'You should write \usepackage{amsmath} before \begin{document} to render it.',
    ]
    SUBJECT = [
        r'Use \nabla.',
        r'\succ is called the succeeds sign.',
        r'What does \lhd mean?',
        r'How do I type \aleph in my document?',
        r'What is \varnothing called?',
        r'How to insert \dagger in Word?',
    ]
    # Defining what a command stands for in one proof is ordinary maths prose.
    # It was 77.4% of the first live run's discovery hits and says nothing
    # about the glyph's name, shape or how to type it.
    NOTATION_DEFINITION = [
        r"Here $\phi$ denotes Euler's totient function.",
        r'$\sigma$ represents the standard deviation of the sample.',
        r'In this context $\partial$ denotes the boundary operator.',
        r'$\lambda$ stands for the eigenvalue of the matrix.',
        r'Recall that $\subset$ means proper inclusion in this book.',
        r'The command \dagger denotes the adjoint.',
    ]
    # "use"/"write"/"try" mean "employ this variable" in maths prose. Left in
    # the loose relation they were 61.5% of a live run's discovery hits.
    ORDINARY_USAGE = [
        r'Use $\alpha$ to parametrise the curve.',
        r'You can use $\infty$ as the upper limit here.',
        r'I will use $\phi$ throughout the proof.',
        r'Consider $\theta$; use the identity to simplify.',
        r'We write $A \subset B$ when every element of A lies in B.',
        r'Write $\partial u$ for the derivative.',
        r'Try $\lambda = 2$ and see what happens.',
    ]

    def test_formula_notation_is_not_evidence(self):
        for text in self.NOTATION:
            with self.subTest(text=text):
                result = status(text)
                self.assertNotIn('latex_symbol', {s['rule'] for s in result['signals']})

    def test_named_typed_or_suggested_commands_are_evidence(self):
        for text in self.SUBJECT:
            with self.subTest(text=text):
                self.assertTrue(status(text)['candidate'])

    def test_employing_a_symbol_is_not_evidence_about_it(self):
        for text in self.ORDINARY_USAGE:
            with self.subTest(text=text):
                self.assertFalse(status(text)['candidate'])

    def test_a_bare_suggestion_is_still_evidence(self):
        # The standalone route is what "use" was there for; it needs the command
        # to be the whole utterance, which maths prose never is.
        self.assertTrue(status(r'Use \nabla.')['candidate'])

    def test_defining_notation_is_not_naming_a_glyph(self):
        for text in self.NOTATION_DEFINITION:
            with self.subTest(text=text):
                self.assertFalse(status(text)['candidate'])

    def test_a_question_about_a_command_is_still_a_request(self):
        # "what does X mean" asks which character X is; "X denotes Y" answers a
        # different question entirely. Same verb, opposite value.
        self.assertTrue(status(r'What does \lhd mean?')['candidate'])
        self.assertFalse(status(r'$\lhd$ means the normal subgroup relation.')['candidate'])

    def test_binding_and_naming_are_distinguished(self):
        self.assertFalse(status(r'Let $\alpha$ denote the first root.')['candidate'])
        self.assertTrue(status(r'$\alpha$ is called alpha.')['candidate'])


class RequestStructureTests(unittest.TestCase):
    """The frame supplies the question and the slot supplies the target, so a
    request is recognizable without any character vocabulary."""

    def test_frames_fire_without_topic_words(self):
        for text in ['What is ‽ called?', 'What does ⌥ mean?',
                     'What does ⸮ mean at the end of a line?',
                     'How do I type this on a UK keyboard?',
                     'How to insert ¶ in a document?']:
            with self.subTest(text=text):
                result = status(text)
                self.assertTrue(result['candidate'])
                self.assertNotIn('topic_context', {s['rule'] for s in result['signals']})

    def test_slot_must_be_filled_by_a_target(self):
        for text in ['What does the word ineffable mean?', 'What is the meaning of life?',
                     'What is this rule called?', 'What does his silence mean?']:
            with self.subTest(text=text):
                self.assertFalse(status(text)['candidate'])

    def test_deictic_slot_needs_a_picture_and_writing_context(self):
        # The food/bat images that a bare "question plus image" rule admitted.
        self.assertFalse(classify({'Title': 'What is this called?',
            'Body': '<p>I saw these at a restaurant last night. What is this called?</p>' + IMAGE,
            'Tags': ''})['candidate'])
        self.assertTrue(classify({'Title': 'What is this called?',
            'Body': '<p>Seen in an old printed book, in a serif font. What is this called?</p>' + IMAGE,
            'Tags': ''})['candidate'])

    def test_typing_frame_implies_a_character_without_an_image(self):
        self.assertTrue(status('How do I type this on a Mac?')['candidate'])
        self.assertFalse(status('What is this called?')['candidate'])


class CompactSignalTests(unittest.TestCase):
    def signals(self):
        fields = {'Title': 'What is ‽ called?',
                  'Body': '<p>I found ‽ in an old font. U+203D maybe? How do I type it?</p>',
                  'Tags': '<punctuation>'}
        return fields, classify(fields)['signals']

    def test_offsets_survive_the_round_trip(self):
        fields, signals = self.signals()
        self.assertTrue(signals)
        _, packed = pack_signals(signals, limit=len(signals))
        restored, total = unpack_signals(packed, fields)
        self.assertEqual(total, len(signals))
        self.assertEqual(len(restored), len(signals))
        # Packing puts one span per distinct rule first, so compare by identity.
        def key(signal): return (signal['rule'], signal['field'], signal['start'], signal['end'])
        original = {key(s): s['text'] for s in signals}
        self.assertEqual({key(s) for s in restored}, set(original))
        for after in restored:
            # Text is not stored; it must come back exactly by slicing the source.
            self.assertEqual(after['text'], original[key(after)])
            self.assertEqual(fields[after['field']][after['start']:after['end']], after['text'])

    def test_every_distinct_rule_survives_the_cap(self):
        fields, signals = self.signals()
        rules, packed = pack_signals(signals)
        restored, total = unpack_signals(packed, fields)
        self.assertEqual(total, len(signals))
        self.assertLessEqual(len(restored), SIGNAL_LIMIT)
        self.assertEqual(set(rules.split(',')), {s['rule'] for s in signals})
        if len(signals) <= SIGNAL_LIMIT:
            self.assertEqual({s['rule'] for s in restored}, {s['rule'] for s in signals})

    def test_packed_rows_are_a_fraction_of_the_json_they_replace(self):
        fields, signals = self.signals()
        rules, packed = pack_signals(signals)
        self.assertLess(len(rules) + len(packed), len(encode(signals[:60])) * 0.5)

    def test_legacy_rows_still_decode(self):
        legacy = encode([{'rule': 'latex_symbol', 'field': 'Body', 'start': 3, 'end': 8,
                          'text': 'hello', 'display_text': 'hello'}])
        restored, total = unpack_signals(legacy)
        self.assertEqual(total, 1)
        self.assertEqual(restored[0]['text'], 'hello')

    def test_code_points_are_preserved(self):
        signal = [{'rule': 'codepoint', 'field': 'Body', 'start': 0, 'end': 6, 'code_point': 8253}]
        restored, _ = unpack_signals(pack_signals(signal)[1])
        self.assertEqual(restored[0]['code_point'], 8253)


if __name__ == '__main__':
    unittest.main()


class DurabilityTests(unittest.TestCase):
    """WAL is an in-run optimization only. Everything downstream -- read-only
    search, reindex fingerprinting, export -- assumes one plain file at rest."""

    def setUp(self):
        import shutil, tempfile
        from se_miner.common import Budget
        from se_miner.storage import Store
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.manifest = {"version": 1, "release": "test", "sites": [{"site": "tex.stackexchange.com"}]}
        self.store = Store(Budget(self.root / "work"), self.manifest, {"filter": "test"})

    def journal_mode(self, db):
        return db.execute("PRAGMA journal_mode").fetchone()[0].lower()

    def test_a_run_writes_through_a_wal(self):
        self.assertEqual(self.journal_mode(self.store.db), "wal")
        self.assertEqual(self.store.db.execute("PRAGMA synchronous").fetchone()[0], 1)  # NORMAL

    def test_close_leaves_one_plain_file_behind(self):
        from se_miner.searchindex import fingerprint
        from se_miner.storage import read_db
        self.store.begin()
        self.store.save_checkpoint("tex.stackexchange.com", "discover_posts", 10)
        self.store.commit()
        path = self.store.budget.root / "candidates.sqlite"
        self.store.close()
        for suffix in ("-wal", "-shm", "-journal"):
            sibling = Path(str(path) + suffix)
            self.assertFalse(sibling.exists() and sibling.stat().st_size,
                             "%s survived close(); reindex refuses to fingerprint it" % suffix)
        db = read_db(self.store.budget.root)
        try:
            self.assertEqual(self.journal_mode(db), "delete")
            self.assertEqual(db.execute("SELECT ordinal FROM checkpoints").fetchone()[0], 10)
        finally:
            db.close()
        fingerprint(self.store.budget.root)  # must not raise


class DefaultsTests(unittest.TestCase):
    def test_resume_command_agrees_with_the_parser(self):
        from se_miner.cli import DEFAULTS, parser, resume_command
        args = parser().parse_args(["run", "m.json"])
        for name, value in DEFAULTS.items():
            self.assertEqual(getattr(args, name), value, "parser default for %s drifted" % name)
        # Nothing at its default belongs on the resume line.
        self.assertEqual(resume_command(args), "python3 scripts/mine.py run m.json")
        louder = parser().parse_args(["run", "m.json", "--batch", "77"])
        self.assertIn("--batch 77", resume_command(louder))


class RoutingIndexTests(unittest.TestCase):
    """routing takes one insert per scanned post, so any index on it is paid for
    by every row in the archive. Both readers use the primary key."""

    def setUp(self):
        import shutil, tempfile
        from se_miner.common import Budget
        from se_miner.storage import Store
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.store = Store(Budget(self.root / "work"),
                           {"version": 1, "release": "t", "sites": [{"site": "tex.stackexchange.com"}]},
                           {"filter": "t"})
        self.addCleanup(self.store.close)

    def test_no_secondary_index_is_maintained_on_routing(self):
        indexes = [r[0] for r in self.store.db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='routing' AND sql IS NOT NULL")]
        self.assertEqual(indexes, [], "a secondary routing index costs a write per scanned post")

    def test_both_readers_still_use_the_primary_key(self):
        for query, params in (
            ("SELECT r.qid FROM routing r JOIN candidates c ON c.site=r.site AND c.qid=r.qid "
             "WHERE r.site=? AND r.id=?", ("s", 1)),
            ("SELECT h.site,r.qid FROM hits h JOIN routing r ON r.site=h.site AND r.id=h.post_id "
             "WHERE h.site=? GROUP BY h.site,r.qid", ("s",)),
        ):
            plan = " ".join(row[-1] for row in self.store.db.execute("EXPLAIN QUERY PLAN " + query, params))
            with self.subTest(query=query[:40]):
                self.assertIn("sqlite_autoindex_routing_1", plan)
                self.assertNotIn("SCAN r", plan)


class AcceptedSampleTests(unittest.TestCase):
    """Hits keep spans, not text. Without a text-bearing sample a rule cannot be
    audited until collection, which is hours after discovery starts."""

    def setUp(self):
        import shutil, tempfile
        from se_miner.common import Budget
        from se_miner.storage import Store
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.store = Store(Budget(self.root / "work"),
                           {"version": 1, "release": "t", "sites": [{"site": "tex.stackexchange.com"}]},
                           {"filter": "t"})
        self.addCleanup(self.store.close)

    def rows(self, count):
        return [{"Id": str(i), "PostTypeId": "1", "Title": "What is ‽ called?",
                 "Body": "<p>Found ‽ in a book.</p>", "Tags": ""} for i in range(1, count + 1)]

    def test_a_bounded_sample_keeps_the_source_text(self):
        self.store.begin()
        for row in self.rows(12):
            self.store.sample_accepted("tex.stackexchange.com", "post", row, {"status": "character_request"}, 5)
        self.store.commit()
        kept = self.store.db.execute("SELECT raw FROM accepted").fetchall()
        self.assertEqual(len(kept), 5, "sample must stay bounded")
        self.assertIn("‽", json.loads(kept[0][0])["Title"])

    def test_the_sample_is_deterministic_not_first_k(self):
        def collect():
            store_ids = set()
            self.store.db.execute("DELETE FROM accepted")
            self.store.begin()
            for row in self.rows(12):
                self.store.sample_accepted("tex.stackexchange.com", "post", row, {}, 5)
            self.store.commit()
            for r in self.store.db.execute("SELECT id FROM accepted"): store_ids.add(r[0])
            return store_ids
        first = collect()
        self.assertEqual(first, collect(), "resuming must not change which rows are sampled")
        self.assertNotEqual(first, {1, 2, 3, 4, 5}, "a first-k sample would only show the archive's start")


class RuleHashTests(unittest.TestCase):
    """The work-directory contract is pinned to the rules. Hashing raw bytes
    meant a comment could strand a run, so the hash covers structure only."""

    def setUp(self):
        self.path = Path(__file__).resolve().parents[2] / 'src/se_miner/targets.py'
        self.original = self.path.read_text()
        self.addCleanup(self.restore)

    def restore(self):
        self.path.write_text(self.original)
        self.rehash()

    def rehash(self):
        import importlib, sys as _sys
        for name in ('se_miner.targets', 'se_miner.structure', 'se_miner.filtering'):
            if name in _sys.modules: importlib.reload(_sys.modules[name])
        return _sys.modules['se_miner.filtering'].RULE_HASH

    def test_comments_and_docstrings_do_not_invalidate_a_work_directory(self):
        base = self.rehash()
        self.path.write_text(self.original + '\n# a clarifying comment\n')
        self.assertEqual(self.rehash(), base, 'a comment must not strand a run')
        self.path.write_text('"""Reworded module docstring."""\n' + self.original)
        self.assertEqual(self.rehash(), base, 'a docstring must not strand a run')

    def test_any_real_rule_change_still_moves_the_hash(self):
        base = self.rehash()
        self.path.write_text(self.original + '\nEXTRA_RULE_CONSTANT = 1\n')
        self.assertNotEqual(self.rehash(), base)

    def test_every_rule_module_is_covered(self):
        from se_miner.filtering import RULE_FILES
        base = self.rehash()
        for name in RULE_FILES:
            path = self.path.parent / name
            source = path.read_text()
            try:
                path.write_text(source + '\n_COVERAGE_PROBE = 1\n')
                self.assertNotEqual(self.rehash(), base, '%s is not covered by RULE_HASH' % name)
            finally:
                path.write_text(source)
        self.assertEqual(self.rehash(), base)


class AdoptTests(unittest.TestCase):
    """Re-pinning a work directory to changed rules is allowed only when the
    stored source samples prove no verdict moved, and never silently."""

    def setUp(self):
        import shutil, tempfile
        from se_miner.common import Budget
        from se_miner.storage import Store
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.manifest = {"version": 1, "release": "t", "sites": [{"site": "tex.stackexchange.com"}]}
        self.store = Store(Budget(self.root / "work"), self.manifest,
                           {"filter": "old", "rule_hash": "0" * 64, "threshold": 3, "rejected_sample": 100})
        self.db = self.store.db

    def sample(self, table, fields, assessment):
        self.store.begin()
        self.store._sample(table, "tex.stackexchange.com", "post",
                           {"Id": "1", **fields}, assessment, 100)
        self.store.commit()

    def args(self, yes=False):
        import argparse
        return argparse.Namespace(work_dir=str(self.root / "work"), yes=yes)

    def test_it_refuses_when_a_stored_sample_changes_verdict(self):
        from se_miner.cli import adopt
        from se_miner.common import MinerError
        # Recorded as rejected, but the current rules clearly accept it.
        self.sample("rejected", {"Title": "What is ‽ called?", "Body": "<p>Found ‽.</p>", "Tags": ""},
                    {"status": "unrelated", "score": 0})
        self.store.close()
        with self.assertRaises(MinerError) as caught:
            adopt(self.args(yes=True))
        self.assertIn("must be re-mined", str(caught.exception))

    def test_it_re_pins_and_keeps_the_prior_hash(self):
        import json as _json
        from se_miner.cli import adopt
        from se_miner.filtering import RULE_HASH
        self.sample("rejected", {"Title": "The weather today", "Body": "<p>It rained.</p>", "Tags": ""},
                    {"status": "unrelated", "score": 0})
        self.store.close()
        checked = adopt(self.args())
        self.assertEqual(checked["state"], "checked")
        self.assertFalse(checked["applied"])
        applied = adopt(self.args(yes=True))
        self.assertEqual(applied["state"], "adopted")
        db = sqlite3.connect(str(self.root / "work" / "candidates.sqlite"))
        try:
            contract = _json.loads(db.execute("SELECT value FROM meta WHERE key='contract'").fetchone()[0])
            trail = _json.loads(db.execute("SELECT value FROM meta WHERE key='adopted'").fetchone()[0])
        finally:
            db.close()
        self.assertEqual(contract["settings"]["rule_hash"], RULE_HASH)
        self.assertEqual(trail[0]["from"], "0" * 64, "the superseded rule hash must survive")
        self.assertEqual(trail[0]["to"], RULE_HASH)
