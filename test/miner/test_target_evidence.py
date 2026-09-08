"""Offline source regressions and contrast pairs for the v3 relevance contract."""
import sys
import json
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src'))
from se_miner.filtering import classify
import test_searchindex


class TargetEvidenceTests(unittest.TestCase):
    def test_saved_source_regressions(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/pilot-v3.json').read_text())
        for case in fixture['cases']:
            with self.subTest(kind=case['kind'], id=case['id']):
                result = classify(case['fields'])
                self.assertEqual(result['candidate'], case['expected_candidate'])
                for signal in result['signals']:
                    self.assertEqual(case['fields'][signal['field']][signal['start']:signal['end']], signal['text'])

    def test_real_false_triggers_and_syntax_variants(self):
        negatives = [
            "@J.C.Salomon I'm trying to come up with a name for my app.",
            "I'm trying to come up with a name for my app.",
            '> branded this form of writing in the first person with the name of an egotism',
            '> What is the name of this grammatical construction?',
            'What does *word* mean?',
            'What does **word** mean?',
            'What does `the word` mean?',
            '# What is the name of this app?',
            'What is a name for my app? Here is an arrow →.',
            r'We calculate $x = \alpha + \beta$.',
            r'Find the value of $\alpha$.',
            'Should I use a comma here?',
            'The comma rule is called a splice.',
            'What is it called when punctuation changes the meaning of a sentence?',
            'Placing the full stop before the closing quotation is the so-called US convention.',
            'The use of symbols to express or represent ideas in literature.',
            "Since you are replacing letters, 'n' is the most common.",
            'Use a semicolon here.',
            'ASCII is an encoding.',
        ]
        for text in negatives:
            with self.subTest(text=text):
                self.assertFalse(classify({'Text': text})['candidate'])

    def test_images_need_character_subject(self):
        for text in ('What are these tortilla chips called?',
                     'What are the strings outside the baseball bat called?',
                     'How do you explain cubic growth of a function?',
                     'What is this?'):
            with self.subTest(text=text):
                self.assertFalse(classify({'Body': '<p>'+text+'</p><img src="x.png" alt="photo">'})['candidate'])
        result = classify({'Title': 'What is this symbol?', 'Body': '<img src="x.png" alt="scan">'})
        self.assertTrue(result['candidate'])
        self.assertIn('needs_image', result['routes'])

    def test_real_targets_survive_formatting(self):
        for text in ('What does @ mean?', 'What does . mean?', 'What does ? mean?',
                     'What does ! mean?', 'What is a semicolon?', 'What do you call this: ¶?',
                     'Letter names', 'Create a long (em) dash by typing shift-option-minus.',
                     'The symbol is called a dagger.', 'What does > mean?', 'What does # mean?',
                     'What does * mean in this expression?', 'What does `*` mean?',
                     'What is this symbol called?', 'How can I type this character?',
                     '> What does ↯ mean?', '@Someone What does ↯ mean?',
                     'What is the name of the letter with a vertical stroke and a horizontal foot?',
                     r'Use \bowtie', 'Use U+03B7', 'That is a long S',
                     'It looks like an n with a tail'):
            with self.subTest(text=text):
                result = classify({'Text': text})
                self.assertTrue(result['candidate'])
                for signal in result['signals']:
                    self.assertEqual(text[signal['start']:signal['end']], signal['text'])

    def test_context_cannot_be_enabled_by_lower_threshold(self):
        self.assertFalse(classify({'Tags': '<punctuation><typography>'}, threshold=1)['candidate'])
        self.assertFalse(classify({'Text': 'Use a comma here'}, threshold=1)['candidate'])


class SourceScopeTests(unittest.TestCase):
    setUp = test_searchindex.IndexTests.setUp
    tearDown = test_searchindex.IndexTests.tearDown
    add = test_searchindex.IndexTests.add

    def test_default_search_excludes_unrelated_siblings_but_context_is_accessible(self):
        from se_miner.searchindex import build, search
        from se_miner.storage import Store
        from se_miner.filtering import RULE_HASH, VERSION
        self.store = Store(self.budget, {'release': 'offline', 'sites': [{'site': self.site}]},
                           {'filter': VERSION, 'rule_hash': RULE_HASH})
        self.add(1, 12, 'post', '', 'Congratulations on your tortilla recipe.')
        self.store.close()
        build(self.root)
        self.assertEqual(search(self.root, 'tortilla'), [])
        self.assertEqual([r['qid'] for r in search(self.root, 'tortilla', scope='all')], [1])
        self.assertEqual([r['qid'] for r in search(self.root, 'tortilla', scope='requests')], [1])


if __name__ == '__main__': unittest.main()
