# Character-search relevance rebuild — 2026-09-07

The v3 filter addresses a semantic error in the source miner: the presence of a
symbol, a generic question, or an image was being treated as evidence that the
discussion concerned identifying a written character. The derived search also
let unrelated documents qualify through another document in their thread.

## Evidence contract

A document can seed retention through one of these routes:

- An identity, meaning, typing, or representation request with a local character
  subject, including an explicitly unknown character.
- A literal glyph bound to a naming/meaning/typing expression. The glyph can be
  ordinary punctuation, including `@`, `>`, `?`, or `.`; syntax elsewhere in the
  sentence cannot stand in for the target.
- A character-shape description, explicit valid Unicode notation, a standalone
  suggested LaTeX symbol, or a local character-description relation.
- Character-name or invisible-character evidence useful for later inspection.

These are lexical/grammatical heuristics, not a language model or a proof of
relevance. An eligible answer is evidence, not necessarily a human search query.
Mentioned characters are never automatically resolved as the intended target.

Mentions and Markdown delimiters are masked in a same-length evidence view.
Original fields, Unicode, and exact source spans remain available. Literal
subjects are bound before sentence segmentation so punctuation targets survive.
An image requires an independently established character request in the same
document, possibly in its title. Ordinary math formulas do not qualify merely
through their LaTeX commands. Tags, encoding background, and ordinary punctuation
usage are context-only; lowering the score threshold cannot make them seed
retention.

Future ingestion retains duplicate edges but does not collect a linked thread
unless it independently qualifies. Comments, answers, and historical discoveries
can still recover their full discussion. Existing mined sources remain unchanged.

## Search behavior

The SQLite layout and filename remain `search-v2.sqlite`; its filter contract is
`target-evidence-3`, with thread aggregation version 3. The filename identifies
the storage schema, not the relevance policy.

Default `--scope relevant` now requires eligible evidence in the matching source
document. `--scope requests` explicitly searches all retained context in threads
with a question/comment/historical request. `--scope all` exposes all retained
context. `--legacy` bypasses the new policy and is only useful for comparison.

Reindexing reclassifies all saved documents through a read-only source connection.
The original 4.95 GB source database, its discovery hits, and its checkpoints are
preserved. Both the source and projection, including journal headroom, share the
10 GB work-directory allowance. Reindexing cannot recover sources rejected or not
collected during the original run. English is the only site with retained full
discussions in this database; Mathematics discovery is incomplete and TeX has no
saved phase checkpoints.

## Validation and limits

The offline miner suite checks source provenance, comment/history recovery,
duplicate-edge preservation, resume equivalence, storage limits, stale indexes,
and search scopes. Twelve additional exact-source regressions preserve the app
naming mention, food/bat/chart images, quoted etymology, grammar rules, and real
symbol discussions that motivated this change. Contrast pairs ensure that fixing
`@username` does not remove questions about `@` itself.

On the previously assistant-rated 100-post sample, v3 admits 4 of the 5 potentially
useful posts and rejects all 95 rated adjacent or unrelated. The excluded useful
post lists footnote symbols without a direct naming relation in that answer.
This is a known tradeoff in favor of precision; it is not proof of high recall.

A separate 1,000-post diagnostic screen admits 8 posts after the fixes. Its
retained examples include curly-brace names, asterisk names, `<`/`>` identification,
letter names, symbol-to-word representations, an emoticon description, and
letter-shape discussion. An incidental non-breaking-space discussion remains
eligible as character evidence. This sample exposed additional defects and was
used in tuning, so neither sample is a held-out precision/recall evaluation.

Artifacts are `out/miner-v3-relevance-checks.json`,
`out/miner-v3-offline-tests.txt`, `out/miner-reindex-v3.json`, and
`out/miner-reindex-v3.progress.jsonl`. No live generator test, model call, or
archive download is part of this work.

Do not resume the old source database under v3: its filter contract intentionally
rejects mixed-policy checkpoints. Any new archive scan needs a new work directory
and must share the remaining storage allowance with these preserved sources and
their derived index.
