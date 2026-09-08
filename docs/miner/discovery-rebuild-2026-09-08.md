# Discovery rebuild: target-evidence-6

The v5 audit exposed an operation-classification failure. Finding a variable,
selecting letters in a permutation, and asking about a glyph all received the
same score. Appearance words anywhere in a sentence promoted mathematical
vocabulary to character evidence. Meanwhile, direct glyph-meaning requests
received the low-priority review score.

The replacement is deterministic and uses no LLM. Reference IDs, URLs and labels
are evaluation inputs only; runtime filtering does not load the datasets.

## Architecture before a model

1. **Parse structure first** (`textviews.py`, `structure.py`). Preserve raw fields
   and reversible source offsets. Separate prose, inline code, code blocks,
   math delimiters, balanced command arguments and TeX environments before
   splitting sentences. Formula punctuation cannot expose hidden commands to
   prose matching. Incomplete math/environments stay opaque to the end.
2. **Inventory typed targets** (`targets.py`). Distinguish glyph literals, atomic
   commands, styled glyphs, letters, shape descriptions, character nouns and
   explicit references. A target occurrence alone is insufficient. Layout
   commands and compound formulas are not atomic character proposals.
3. **Bind an operation to its object** (`filtering.py`). Identification, naming,
   typing, meaning and origin requests must actually address the target.
   `find $p$`, `Type 2 polynomials`, and a group representation's character fail
   here. Appearance must describe that target; `above` or `below` elsewhere
   cannot qualify it. Technical senses are excluded locally, without suppressing
   genuine symbol questions merely because they also discuss mathematics.
4. **Retain evidence and uncertainty separately.** Keep explicit glyph requests
   at score 8, identity evidence at 5, discussion at 4, and unresolved typing or
   usage context at 3 (`review`). Tags/background alone remain rejected. These
   numbers order work; they are not confidence probabilities. Every result stays
   `resolution: unresolved`, including results with a valid Unicode mention.
5. **Reconstruct the thread using the existing pipeline.** Questions, answers,
   comments and history are scanned independently, then hits are joined to
   question IDs before complete available discussions are collected. Answers
   quoting a request do not make the parent question a request. Duplicate links
   alone do not admit a thread. Any later model should receive this context and
   exact source evidence, with discovery relevance separate from correctness of
   a proposed character mapping.

This is still a bounded English heuristic parser, not full natural-language or
TeX understanding. Its benefit is explicit operation/target relationships and
replayable counterexamples, rather than a larger bag of trigger words.

## Evidence and acceptance results

Run the entirely offline checks:

```sh
python3 -m unittest discover -s test/miner
python3 scripts/evaluate-miner.py --output out/miner-filter-evaluation.json
```

The evaluator records dataset hashes, the running filter hash, baseline counts,
current decisions and source-span bindings. It exits nonzero on a mismatch in
an explicitly labeled KEEP or REJECT case. UNCERTAIN cases are reported without
being forced into either label.

| Calibration material | Earlier result | v6 replay |
|---|---|---|
| 94 positive references | v4 retained 56 | Retains 94 |
| 30 original mined negatives | v4 retained 30 | Rejects 30 |
| 6 uncertain references | v4 retained 4 | 5 keep, 1 review |
| 12 clear glyph-related sources in the v5 sample | All retained | All retained |
| 80 clear negatives in the v5 sample | All retained | All rejected |
| 8 borderline v5 sample sources | All retained | All rejected; reported separately |

The saved v5 sample comes from 808 accepted hits after 130,000 Math posts. Its
recorded rule hash is
`e13a653ee2d05e4b39086dbd3d99c0b84a29836b6bb3357c81bf1882fbd0ff26`.
The 100 source rows and their provisional assistant-assisted labels are in
`test/miner/fixtures/discovery-v5-audit.json`. Borderline cases include notation
interpretation, a diagram-arrow editing request, general software advice and
supporting tombstone discussion. Their rejection is a remaining recall tradeoff,
not a proven correct rejection.

The reference snapshots and source provenance are in
`test/miner/fixtures/discovery-reference.json`; their source specification is
`discovery-reference-set-2026-09-07.md`. Current web question snapshots do not
prove that the same content existed in the April 2024 archive. Comment/history
and thread-joining behavior also have offline integration coverage, but the
100-reference fixture is not an archive-availability verification.

Both datasets informed implementation. These numbers are **calibration results,
not production precision or recall**. Twelve retained sources from an old
accepted-hit sample do not establish the percentage of all threads reaching a
later model. That denominator requires a completed fresh scan, reconstructed
threads, and independently judged accepted and rejected samples. No model or
live generator test was run for this rebuild.

## Persistence and running again

Discovery schema 3 stores the decision, facets, source role, review reasons and
bounded operation/target bindings alongside compact signal pointers. Original
source text stays in the deterministic accepted/rejected audit samples and
collected documents. Source offsets are Python string indices into the
XML-decoded original field. Truncated evidence includes total counts.

Search assessments include source role in their cache key. `--scope review`
exposes review sources; default `--scope relevant` excludes them. Search results
return the discovery decision, bindings and review reasons independently of
thread category and unresolved character identity.

The filter hash pins all five classifier source modules. Incompatible work
contracts are refused before changing the database schema or journal mode. The
existing v5 work directory is preserved; it cannot resume under v6. Reindexing
old retained documents cannot recover rejected sources or replace a fresh scan.

For the next user-run mining validation, use a separate work directory and an
explicit row cap, then review both accepted and rejected source samples. Keep
the combined archive/database/index allowance across old and new work
directories within the existing 10 GB limit. Do not delete the saved run merely
to make the new filter resumable.
