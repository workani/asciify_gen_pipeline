# Small pilot review — 2026-09-06

**The ingestion infrastructure is doing useful work, but the candidate filter is not ready for bulk LLM extraction.** Real language exposes severe false-positive bugs and an obvious recall gap that the initial fixture tests missed. This review made no changes to the miner or existing database and ran no generator/model calls.

Reviewed `.miner-work/candidates.sqlite` read-only, not the earlier 25-row smoke artifact. No miner process was running at inspection time. Working disk use was 1,828,556,800 bytes (1.83 decimal GB), with no archive cache, within the 10 GB cap. The snapshot is the pinned April 2024 Internet Archive release.

| Site | Observed coverage |
|---|---|
| English | All discovery/collection phases complete: 425,573 Posts rows, 945,610 Comments rows, 1,233,844 PostHistory rows, 56,070 PostLinks rows |
| Mathematics | Post discovery checkpoint at row 2,449,500; not complete; comments/history/collection not started |
| TeX | No phase checkpoints |

English contains 130,631 eligible questions and 293,544 answers. It produced 18,302 directly matched threads plus 7,336 duplicate-linked threads: **25,638 candidates, 19.6% of its questions**. Retained documents comprise 99,198 posts, 251,069 comments, and 220,861 revisions. These are source records, not extracted query-character pairs.

## Findings

1. **P1 — Contractions are misclassified as character shapes.** `src/se_miner/filtering.py:16` accepts `[a-z][ -]looking` after a word boundary, so the `m looking` in `I'm looking` qualifies by itself. The exact text `m looking` occurs in 16,737 English hit records. Including apostrophe-prefixed `s looking` and `t looking`, 17,317 records contain this defect. Removing only those apostrophe-contraction matches makes 16,926 records fall below threshold and leaves 12,491 of the original 18,302 directly triggered question IDs. Thus **5,811 direct threads (31.8%) depend entirely on this bug**. This counterfactual does not prove every affected thread is irrelevant, and does not recompute duplicate components.

   Real examples include questions 362086 (sweet-and-sour relationship vocabulary), 118923 (word for a prototype-derived object), and 374976 (grammar of “I'd rather”). The first two were discovered through comments saying “I'm looking”. Correct token boundaries and require actual letter-reference context; preserve real `n-looking` and `n with a tail` descriptions.

2. **P1 — The article `a` is interpreted as a letter.** `classify({'Text': 'It looks like a disaster'})` currently returns candidate=true, score=7, priority=high. The `letter_shape` alternative backtracks and matches `looks like a`. There are 2,279 hit records with that exact lowercase match and 896 with `look like a`; these totals include legitimate and illegitimate uses. An article followed by an ordinary noun must not become strong character evidence.

3. **P1 — A common identification question is missed.** `What do you call this symbol?` currently receives score=1 and is rejected, while `What is this symbol called?` passes. This is a deterministic input reproduction, not a measured count of lost threads. Add common direct and contracted request forms while retaining the separate symbol-context requirement. Raising the global threshold would make this problem worse.

4. **P1 — URL encoding parameters create false Unicode evidence.** `https://www.google.com/search?ie=UTF-8&q=populism` passes by itself. Matching raw HTML/Markdown indiscriminately allows incidental URL query parameters to supply Unicode relevance. Example answer 328186 has an actual symbol discussion, but its Unicode score specifically comes from a Google link's `UTF-8` parameter. Separate body/code evidence from URLs and attributes while preserving exact source offsets. Unicode reference URLs can still be useful when their path actually identifies a character.

5. **P2 — Duplicate expansion amplifies noisy seeds.** The current connected-component expansion adds 7,336 threads (28.6% of candidates). In the deterministic 24-question spot-check, 8 questions were duplicate-only and unrelated to the target task. Retain duplicate relations for provenance and later holdout grouping, but give duplicate-only threads a separate relevance decision before model extraction. Do not erase those links.

6. **P2 — There are structural coverage warnings to triage.** English has no missing candidate questions, but one missing accepted-answer reference, 28 post comment-count mismatches, and 7 question answer-count mismatches. The missing accepted answer is ID 70829 for question 70828; it is absent from the completed English routing table too. This suggests a source-level stale/missing reference is possible, but the review did not reread the source XML to establish the cause. These warnings should quarantine affected evidence, not be silently interpreted as verified completeness.

7. **P2 — Literal/codepoint search is materially slower and semantically broad.** On this machine, one `asterism` word query took 0.014 seconds; one `U+200B` query took 11.519 seconds. The latter scans retained text and surfaced incidental zero-width spaces copied into a dictionary quotation. Its first three results were the same thread across current text/history. These are single observations, not a performance benchmark. Add an indexed codepoint-mention representation, distinguish explicit identity discussion from incidental literal presence, and group revisions under a thread for inspection. Keep exact literal matching available.

## Evidence of useful behavior

- **Comments matter:** 4,127 English directly matched threads were triggered by comments alone. This is a coverage count, not a relevance count: many are contaminated by the contraction bug.
- **Exact provenance works:** all retained English hit spans were checked against their stored raw source fields, with zero mismatches.
- **Useful real descriptions exist:** question 5058 asks about “the symbol to the left of 1 on US keyboards”; accepted answer 5059 explicitly names the grave accent and `U+0060`. This is a strong candidate pair for the next phase.
- Question 166544 describes an archaic F-like character used for S; it has no retained answer, but comment 346476 supplies “long S”. The miner preserved this comment evidence, which answer-only mining would miss. Character resolution still belongs in the next phase.
- Question 177459 asks about an “o with a dot over it”, but its answer proposes `/ɔ/`. This is an example of conflicting/insufficient evidence that must remain unresolved rather than being force-mapped.

## Sample and limits

A deterministic SHA-256-ordered sample of 24 candidate questions was screened using each question and its top two trigger records. **21 questions were unrelated to the intended character-query task; 3 were symbol/punctuation-related.** None of those 24 was a clean unknown-character identification question. This is an assistant spot-check, not a human-gold precision estimate or an exhaustive review of each thread. The useful examples above were found separately and are not included in that sample's rate.

Additionally screened 12 rejected comments, 8 rejected posts, and 8 rejected revision records. Some concern punctuation usage, but this small sample does not support a recall estimate. Current saved rejected samples cannot establish how many relevant full threads were lost.

Artifacts: `out/miner-review-sample.json` (sample source records), `out/miner-review-labels.json` (provisional question-level labels), and `out/miner-review-checks.json` (structural QA and contraction counterfactual counts).

## Recommended next step

Fix the contraction/article rules, direct-question forms, and URL-only evidence first. Add regressions from these real examples. Reclassify the already retained English source records into a **separate derived review result**, preserving the original run; that can remove known false positives without redownloading. Fixing false negatives requires another scan because only a sample of rejected text was retained. Audit the revised candidates before paying for extraction. Keep comment/history discovery and duplicate provenance.

The persisted transport counter reports only 11 requests and about 26 MB despite much more scanning than the earlier smoke run. It is not a reliable whole-pilot bandwidth total. Counters are saved on normal Python finalization, whereas row checkpoints are saved continuously; an abruptly terminated process can retain rows and lose traffic accounting. Persist those counters at checkpoints in a future change. The database does not establish why Mathematics stopped.
