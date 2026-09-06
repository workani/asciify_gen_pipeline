# Generator handoff — schema v3 rebuild and next taxonomy task

## Workspace, scope, authorization

Work ONLY in `/Users/workani/Documents/code/generator`. The preceding chat began in sibling `asciify`; explicitly set the working directory for tools. Do not modify the Asciify application, integrate its search, create vectors, upload data or run retrieval benchmarks. Existing generator adapters read the adjacent reference DB/vocabulary/fonts; this is source ingestion, not authorization to edit the application. No new task/thread or subagents were requested.

The user previously stopped testing/model generation to conserve usage. This rebuild has had syntax/static checks only, with no model calls, live harness or unit-suite execution. Preserve that restriction unless the user authorizes execution. `./test.sh` IS LIVE GENERATION, not an offline unit suite. Do not run it casually.

Default model remains `opencode/muse-spark-1.3-contributor-free`, variant `medium`, displayed as Muse Spark 1.3 Free. Config and project `opencode.json` preserve it. No model comparison was performed.

The working tree is heavily modified/untracked from several turns plus user edits. No commit was made. Do not reset, clean or overwrite unrelated files. In particular preserve `.generator/`, historical `out/`/`runs/`, the user's live-harness report options and `test.sh` stable-report cleanup. No applicable AGENTS.md was found in prior inspection; recheck if environment changed.

## Product intent and lessons

Search should support descriptive appearance, colloquial expression, broad families and overlapping use cases like bullet-list markers. Ordinary Unicode names and aliases are baseline coverage, not model discoveries. A true phrase can add zero new intent. New wording is not necessarily new meaning. More phrases is not success. A description, corrected facet or recovered use may still help even if no new alias exists.

Failed earlier approaches:
- Seed-visible writing copied `_synonyms.mjs`, despite renaming it vocabulary_seeds.
- Minimum 10–30 phrases produced paraphrase padding; minimum and apology/coverage fields are now removed.
- One supported verdict conflated correctness, novelty and diversity. Adding objections just produced articulate approval.
- Writer claims referenced by later claims were mistaken for independent evidence.
- Whole records were thrown away for weak phrase candidates.
- Duplicate render fingerprints were counted as independent observations; code now deduplicates them.
- Repeating Family/Features/Uses headers diluted character descriptions.
- A parser accepted only numbered evidence references while the prompt allowed named references. Both now resolve; absent/null evidence remains invalid.
- A review timeout lost completed work. Each new phase is now durable/resumable.

## What was implemented, not yet runtime-validated

`RECORD_SCHEMA_VERSION = 3`; `PIPELINE_VERSION` remains `2026-09-05.factory-v8-embedding-records`, with a content-derived `STAGE_VERSIONS.records` revision. v1/v2 artifacts are historical, not compatible live inputs.

Four normal model calls, each a fresh context:
1. `draft`: factual record only, no baseline vocabulary.
2. `fact_review`: independent evidence, not novelty/diversity. Wrong/unsupported/uncertain facts quarantine terminally.
3. `discovery`: verified facts, no baseline. Zero to 24 candidate phrases; no minimum. Separate intent and register.
4. `vocabulary_review`: relevance, baseline relationship and grouping are distinct outputs. One representative per underlying intent. Unsupported/uncertain candidates are withheld without throwing away good facts.
Empty discovery skips the fourth model call. `GEN_RECORD_CONTRACT_REPAIRS` defaults to one per phase; the live harness sets zero. No semantic retry-until-approval loop.

The checkpoint output contains `draft`, `fact_review`, `discovery`, `vocabulary_review`, `baseline`, `baseline_sources`, `vocabulary`, `embedding_record`, `source_key`, `vocabulary_fingerprint`, `attempt_audit` and `resumed_phases`. There is no current `new_aliases`, combined `review` or `retrieval_coverage` field.

Checkpoint reuse re-parses stored outputs. Matching factual context/model/prompt/render permits reuse of facts and discovery. A changed baseline invalidates only vocabulary assessment. Source/render/prompt/model changes invalidate relevant current-version output. Completed model results are saved before the next call. Checkpoint writes remain owner/lease fenced.

## Main files

- `src/records.mjs`: factual schema/parser; current FAMILIES and canonicalFamily; property/evidence validation; factual review parser; description-document compiler.
- `src/record-vocabulary.mjs`: baseline assembly with provenance; candidate schema; evidence references; exact/token-span overlap; separate relevance/novelty/group validation; representative selection; contribution counts; optional intent document text.
- `src/prompts-records.mjs`: four system prompts and context builders; catalog rules. `blindRecordContext` is a positive field allowlist, used for both writers and factual review. Only vocabulary assessment receives baseline.
- `src/stages/records.mjs`: orchestration and resumption of four phases.
- `src/record-context.mjs`: source vocabulary ingestion and render deduplication. Returns `{context, existing}`. Baseline no longer appears inside context. Reads existing synonym adapters; preserves raw source text.
- `src/config.mjs`: models/settings and record-version hash. Hash includes schema, all four prompts, collection rules, families, intents/registers and vocabulary contract version. New taxonomy tables/data revision must join this hash.
- `src/emit-records.mjs`: strict local export; revalidates every saved phase rather than trusting a passed flag.
- `src/record-relevance.mjs`: target-free multi-candidate reviewer protocol; permits multiple direct matches and uncertainty, hides caller target/expected metadata. Used in calibration controls, not a search engine integration.
- `src/reviewer-calibration.mjs`: provisional fixtures, separate calibration/holdout splits, opaque task IDs, offline scorer.
- `scripts/reviewer-calibration.mjs`: offline prepare/score commands; imports no model pool.
- `scripts/live-records.mjs`, `test.sh`: live provider sample of 16 symbols, at most 64 requests with repairs off; immediate errors and progressive reports.
- `test/record-fixtures.mjs`, `test/records.test.mjs`, `test/record-vocabulary.test.mjs`, `test/records-stage.test.mjs`, `test/reviewer-calibration.test.mjs`: rewritten/new regression coverage, not executed.
- `src/corpus.mjs`, `src/selection.mjs`, `src/normalize.mjs`, `src/state.mjs`: source rows, normalization, priority and persistence. Legacy stages remain explicit alternatives.

## Contracts worth preserving

Factual root: `{entity_id,status,description:{identity,appearance,meaning},family,collections,properties,uncertainties}`. No phrases or aliases in this phase.
Collections: `{id,fit:primary|secondary,prefer_over:other_catalog_id|null,reason}`; at most one primary and three total. Null avoids forcing absurd comparisons; credible overlapping uses remain possible.
Properties: unique `{key,values:[],basis:render|identity|convention,attachments:[],evidence}`. Render evidence needs actual attachment IDs; other bases need empty IDs. Code-derived scope is observed/cross_render/established, not universal font truth. Visual reviewers must verify every claimed attachment. Meaning cannot be supported by pixels alone.
Factual review: each path exactly once as `{path,verdict:supported|wrong|unsupported|uncertain,basis,attachments,evidence}`. No objection field.
Discovery: `{entity_id,candidates:[{id,phrase,intent,register,supports}]}`. IDs stable within the record. Intent: name/appearance/meaning/use. Register: technical/descriptive/casual/conversational/slang. No forced slang and no forced novelty.
Evidence refs: description non-null fields, named or numbered properties/collections, or a nonempty whole group. Canonicalize named members to numbered paths. Missing refs fail with the actual candidate/reference, rather than generic failed.
Vocabulary review: checks cover every candidate and contain relevance direct/related/unsupported/uncertain, independent grounding, baseline_relation existing/rewording/proposed-new-intent/uncertain, referenced baseline IDs, comparison, group_id. Groups contain ID, underlying intent description, intent type and representative candidate ID. Unsupported/uncertain have null group. All retained candidates belong to exactly one group.
Exact baseline echoes override model novelty claims. Token-span matches are reported separately and do not force semantic equivalence (equal inside not equal is not the same intent). One group with a known/reworded member cannot gain novelty via another paraphrase. Identical phrases cannot inflate separate groups. Semantic paraphrase grouping remains model-assessed and needs calibration.

## Export files / no integration

`embedding_records.jsonl`: one compact factual description document per entity; no vector values.
`baseline_sources.jsonl`: verbatim input text and fingerprint.
`baseline_vocabulary.jsonl`: preserved names, codepoint labels and aliases; explicitly not model discoveries. Historical aliases marked source-unverified.
`retrieval_vocabulary.jsonl`: one representative per reviewed intent group; all candidates remain in audit.
`intent_embedding_candidates.jsonl`: text-only representative phrases for direct meaning/use groups; no model-generated group explanation is embedded. Related/ambiguous candidates excluded from this optional file. Stable entity merge key, no automatic promotion.
`collection_docs.jsonl`, `collection_memberships.jsonl`, `family_catalog.json`, full evidence/attempt JSONL, quality report, readable records, version/checksum manifest.
Manifest explicitly says zero vectors, no integration. Measured search improvement remains null. Do not add point 7/retrieval benchmarking back in.

Calibration fixture labels say `provisional_requires_human_review`. No human validation or reviewer model performance is claimed. Prepare emits actual reviewer prompts without expected labels or telltale case names. Score accepts JSONL `{case_id,response}`, reports false accepts/rejects and grouping failures, and never grants production approval. Missing/invalid responses fail completeness. These are judge controls, not application search tests.

## Commands and validation status

Syntax checks passed for changed modules and shell harness; `git diff --check` passed. No new schema-v3 generation, reviewer calibration or unit suite was run. This is a material limitation, not proof of output quality.

Offline commands available when authorized:
`npm test`
`node scripts/reviewer-calibration.mjs prepare --split=calibration --out=out/calibration/tasks.jsonl`
`node scripts/reviewer-calibration.mjs score --split=calibration --responses=out/calibration/responses.jsonl --out=out/calibration/score.json`
Repeat with split=holdout for separate fixtures. Preparation/scoring themselves never call a model.

Live commands, do NOT execute without authorization:
`./test.sh`
`node bin/generator.mjs run --stage=records --limit=N --threads=2`

## Current taxonomy implementation (schema v4)

The Unicode taxonomy is implemented in `src/taxonomy.mjs`, with one ordered predicate list in `src/taxonomy-family.mjs`. The former category-first precedence and bare substring rules were superseded by the user's requirement to avoid contamination across the dataset. See `families.txt` for the current rules, measured coverage, nulls, unknowns and samples.

Pinned Unicode 17.0.0 inputs are vendored in `data/unicode/17.0.0` and verified against source hashes on load. Runtime Script-escape version, source code and Unicode data hash participate in taxonomy and record-stage versions. Runtime classification never depends on corpus names or coarse `general_category` fields.

Families and code-assigned subfamilies are immutable inputs in factual, review and discovery contexts. Parsing and export revalidate them. Model fallback is restricted to the supplied family's enum, needs renders and factual review. Known incompatible enums (e.g. Han letters, rectangles, bidirectional arrows) are quarantined before model calls. Unknown is a fixed sentinel with no subfamily axis.

The `colors` collection is assigned by code from official solid color swatch identities. The complete set is 36 glyphs across 12 colors, including pink, grey and light blue hearts where Unicode has no matching circle/square emoji. `colors_collection.json` is exported both by coverage and record export, independently of selected/reviewed record coverage. Model-generated membership cannot add arbitrary colored objects. Color is a property; shapes and hearts retain their families. This is a dataset contract, not an offline search implementation. No search query, ranking, index, live generator or deployment is executed by the coverage command.

Validation: `GEN_TEST_FULL_HARNESS=0 npm test`; focused regression files are `test/taxonomy.test.mjs`, `test/dataset-collections.test.mjs`, `test/records-stage.test.mjs`. Live generator tests are user-run only; inspect `/Users/workani/Documents/code/generator/out/test-results.json` afterward.

## Collection decoupling (schema v5)

Collections are deferred. Writer output requires `collections: []`; no catalog or collection IDs enter prompts, no memberships enter review/discovery evidence, and record export emits no collection/palette files or automatic colors memberships. Color remains a property. Taxonomy and subfamily acceptance rules are unchanged. Earlier collection-export descriptions above describe the previous contract.


## Dominant color fix (schema v6)

`src/records.mjs` now restricts `color` to exactly one dominant whole-symbol color. Optional `accent_color` contains subordinate component colors, with render evidence naming the component. Both use the canonical `COLOR_NAMES` palette; dominant and accent values may not overlap. Non-swatch dominant assignments require render basis and coverage of every distinct supplied attachment. Unicode-fixed swatch colors remain immutable. No stable dominant color means omit `color`.

The four prompts distinguish a yellow face from its blue tear, and prevent an incidental component from supporting an unqualified query such as "blue emoji". Export re-parses the contract and keeps dominant/accent facets separate. Old multi-color bags are rejected, not auto-truncated or heuristically migrated. Semantic dominance still requires factual review; the validator does not infer visual prominence.

Regression coverage added in `test/record-colors.test.mjs`; stage schema expectation updated to 6. Syntax checks passed. Tests and model generation were not run for this fix. No taxonomy-family, collection membership, Asciify application or existing output artifact was modified.
