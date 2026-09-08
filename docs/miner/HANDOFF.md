# Remaining manual work: relevance audit

Identity/semantics selection and the source-grounded review contract are now implemented. Read [selection-2026-09-08.md](selection-2026-09-08.md) first. The current v6 ingestion is resumable; selection no longer requires a fresh mining run. Full-thread model/human review and independent mapping validation remain pending.

Core ingestion/search is implemented, including the v6 target-evidence filter and local evidence index. The unperformed large manual task is judging source relevance and tuning recall from real examples. Do not call the current candidate score “confidence” or treat a second model as human validation. The 24 cases in `test/miner/fixtures/pilot-v2.json` were used for calibration and must never be counted as held-out evaluation.

The v6 rebuild, saved 230-source calibration replay, and remaining uncertainties are documented in [discovery-rebuild-2026-09-08.md](discovery-rebuild-2026-09-08.md). Start there; the older prompts below describe follow-up manual validation, not missing filter implementation.

Prompt for a smaller coding model:

> Work in `/Users/workani/Documents/code/generator`. Read `docs/miner/README.md` and the existing `src/se_miner` implementation. Preserve the 10 GB cap for archives/cache and candidate database together; existing files/logs/exports are outside it. Only the explicit `.stackexchange.com` sites are permitted, never Stack Overflow. Never run live generator tests or any model-generation command. Use existing miner audit JSONL artifacts if available; if the pilot has not completed, report that prerequisite rather than inventing an audit.
>
> Review the 200 candidate-thread audit sample and the per-site/per-source-kind rejected samples. Create a separate JSONL annotation artifact: site, question/post/comment/revision IDs, label (`character_query`, `symbol_discussion_without_query`, `unrelated`, `ambiguous`, `needs_image`), exact supporting source spans, proposed Unicode target only where explicit thread evidence resolves it, and a brief explanation. Preserve spelling, punctuation, invisible characters, source attribution, and revisions. A matching answer comment alone must be sufficient to recover its question; descriptions in questioner text must be distinguishable from answer wording.
>
> Report false-positive patterns and potentially missed queries separately by source kind and site. Propose small filter changes with concrete counterexamples, add offline regressions, and run `python3 -m unittest discover -s test/miner -v`. Changes to filters require a new mining work directory because checkpoints are bound to their rule hash. Do not silently rerun the network or start paid extraction. Mark every annotation as provisional model-assisted review requiring human approval. Do not invent precision/recall, benchmark scores, or human validation.

Additional audit requirements after the v3 rebuild:

> Read `docs/miner/search-rebuild-2026-09-07.md`. Sample each new thread category separately, including comment-only requests, image cases, duplicate-only context, and high-frequency glyphs. Use both questions and full thread evidence; an incidental comma discussion can make an unrelated question searchable without making it a valid description→character pair. Preserve ambiguous and conflicting targets as unresolved. Export exact query/evidence offsets and distinguish question-author wording from answer/comment wording. Review fresh rejected-source samples before claiming recall; reindexing retained data cannot reveal all old false negatives. Keep duplicate-connected groups, revision families, and calibration examples outside any future held-out benchmark. Do not spend API calls. Keep all mining work directories' combined archive/database/index allocation within 10 GB; do not grant each directory a separate 10 GB allowance.

The extraction review contract now exists in `extraction.py`. The next phase can add its model adapter and deterministic Unicode/LaTeX evidence resolution, followed by independent QA and a leakage-safe held-out benchmark. Those are beyond this source-mining phase.
