# Selecting identity evidence without another re-mine

Discovery v6 remains the broad retention gate. `selection.py` adds a separate,
versioned pass over saved sources and reconstructed threads. Selection changes
do not change the ingestion hash or invalidate the existing checkpoints. The
latest saved run has 213 hits after 150,000 Math posts and no collected threads.

The original audit correctly separated glyph identity from notation semantics.
It does not establish a universal 60% lexical ceiling, final corpus size, gold
yield, or model cost. An early archive prefix and a sample of its accepted hits
are not a representative sample of the complete Math + TeX corpus.

## Routing contract

| Source lane | Purpose |
|---|---|
| `identity` | Prioritize naming, typing, shape, failed lookup and explicit identity evidence |
| `semantics` | Preserve meaning/usage/origin questions separately; never count these as identity examples |
| `context` | Insufficient or conflicting local evidence; inspect the full discussion |
| `noise` | No eligible evidence remains after the safe sense cuts |

These lanes are scheduling hints, not final A/B/C judgments or confidence.
Source discovery scores remain visible but do not determine selection order.
Nothing is deleted. Even noise sources remain in exports for auditing.

The suggested cuts are applied to senses and evidence relationships rather than
globally banned words. `find the sign`, `flipping signs`, origins of a variable
or constant, sigma-algebra/field terminology, character tables and mathematical
complements lose priority. “What is this character called?”, “Backwards epsilon”
and typing a plus sign remain eligible. Additional structural checks catch
`look like e.g.`, list digits and punctuation misread as a target.

Full-thread routing preserves roles. A semantics question plus an identity
answer goes to `mixed`, not automatically to identity. An unrelated question
with an identity-bearing answer goes to `evidence_only`. Comments can supply
missing intent, and a question revision can supply a `historical` request;
an answer revision cannot become a historical question. Raw user IDs and all
source fields remain available for author attribution during review.

## Saved sample replay

The fixture `test/miner/fixtures/selection-v6-audit.json` preserves all 100
original source rows. Labels are provisional, assistant-assisted calibration.
Broad tool advice, supporting notation explanations, and custom-notation
requests were marked uncertain instead of automatically counted as gold.

| Provisional source label | Identity | Semantics | Context | Noise |
|---|---:|---:|---:|---:|
| A: clear identity evidence | 12 | 0 | 0 | 0 |
| B: notation semantics | 0 | 20 | 0 | 0 |
| C: noise | 0 | 2 | 9 | 47 |
| Uncertain/supporting | 8 | 0 | 2 | 0 |
| Total | 20 | 22 | 11 | 47 |

Thus 47 of 58 provisionally labeled C sources lose priority immediately. Eleven
C sources remain in the lower queues. The 20-source priority queue contains
12 clear identity sources and eight uncertain/supporting cases. It is not a
20-example verified training set. Some identity sources are answers rather
than question-author descriptions. All 94 original positive references remain
available across the eligible lanes; their original labels were discovery
relevance, not A-only labels.

These examples informed the implementation. Do not report the table as held-out
precision, multiply it into a final gold yield, or equate its denominator with
the percentage of all threads reaching a model.

```sh
python3 -m unittest discover -s test/miner
python3 scripts/evaluate-miner.py --output out/miner-selection-evaluation.json
python3 scripts/select-miner.py audit --output out/selection-audit.jsonl
```

The evaluator reports discovery calibration and selection calibration separately,
including source labels, roles, dataset hashes and selection hash. The audit
command reads SQLite in a consistent, read-only transaction and writes a new
JSONL file outside the work directory. The final summary has `export_complete:
true`; a file without that trailer is incomplete.

## Full-context review and extraction contract

After collection, prepare every retained thread locally:

```sh
python3 scripts/select-miner.py threads --output out/glyph-review-packets.jsonl
```

The exporter refuses incomplete collection by default and refuses to pass a
zero-document discovery sample off as a thread packet. `--allow-partial` is only
for explicit diagnostic exports with missing context recorded. Packets contain
the original question, answers, comments, revisions, duplicate links, source
URLs, original row metadata, coverage warnings and selection reasons. No text
is silently truncated, and no images are fetched. Consumers must budget or
chunk large packets and must not pretend that an image URL means the image was
inspected. Group revisions and duplicate-connected examples before benchmark
splitting to avoid leakage.

`extraction.py` supplies the independent `glyph-review-1` contract and
`validate_review(packet, review)`. A later model or human returns A/B/C/uncertain,
query/evidence-only/historical use, rationale, and exact description/identity
citations. Sources are explicitly untrusted data. Showing a glyph does not by
itself establish that its identity is known; a naming answer alone does not
prove the original question asked for identity.

The validator rejects invented/out-of-thread citations, wrong raw offsets,
metadata cited as source text, and answer-only descriptions presented as a
question query. Valid citations still do not establish semantic correctness.
Every result remains `resolution: unresolved`,
`semantic_judgment_verified: false`, and `eligible_training_pair: false`.
Resolving mappings and admitting training pairs require a later independent
verification step. No model adapter, paid pass, or live generator test runs as
part of selection or packet preparation.

## Continue the saved run

The classifier remains `target-evidence-6` with hash
`1ba61f6dc85e678059461751915abb9796a9f989ebf8b008a1b06759f3560a78`.
The current manifest still includes Math and TeX. No new work directory is
needed for this selection change:

```sh
python3 scripts/mine.py run docs/miner/pilot.manifest.json
```

This command resumes the saved ingestion under its existing storage allowance.
It was not run during this change. Finish collection before preparing full
review packets. Selection can subsequently be revised and replayed locally.
