# Unicode dataset generator

All generation, checkpoints, calibration and exports live in this project. No search application integration, vector creation, service upload or retrieval benchmark is performed.

## Current pipeline: schema v8

1. **Factual draft:** identity, distinctive appearance, meaning, established names, semantic family and evidenced properties; collections are deferred. Existing aliases are not supplied.
2. **Independent factual review:** checks identity, actual render evidence and independently established conventions. A draft's own description is not proof. Wrong, unsupported or uncertain facts quarantine the record.
3. **Blind discovery:** proposes natural search situations from reviewed facts without seeing the existing aliases. Intent (`name`, `appearance`, `meaning`, `use`) and register (`technical`, `descriptive`, `casual`, `conversational`, `slang`, `typo`, `non-native`) are separate. Aim for 10–30 grounded wordings, with a 40-candidate ceiling. This is not a quota for new meanings: shorter output is valid and its shortfall is reported. Plausible spelling and grammar variants remain grouped with their underlying intent.
4. **Vocabulary assessment:** sees the candidates and preserved baseline. Separately judges relevance, overlap and underlying intent groups. Exact baseline matches cannot earn novelty credit. Different words for the same intent form one group. All distinct grounded lexical variants survive export; only one direct representative per meaning/use group is eligible for an intent embedding candidate. Unsupported or uncertain candidates are withheld. A record with meaning cannot export until at least one grounded use-intent phrase citing that meaning survives assessment. Every reviewed name must also survive as its full direct name-intent phrase with its own citation.

Baseline names, codepoint labels and aliases are assembled by code with provenance. Historical aliases remain explicitly source-unverified; preserving them is not independent verification. Raw source text is preserved, and semicolon/newline/pipe boundaries produce phrase entries without guessing word boundaries. Lexical token-span overlap is reported separately from semantic equivalence.

Four model calls for a normal record, three for empty discovery (only permitted when meaning is null and names is empty). Each phase allows at most `GEN_RECORD_CONTRACT_REPAIRS` bounded structural repairs (default one). There is no sampling loop after factual rejection. Each completed phase is saved durably. A transport failure resumes the missing phase; changed baseline vocabulary invalidates only vocabulary assessment when facts/render context remain compatible. Schema/prompt/model changes select a new checkpoint version.

## Scope and model

OpenCode defaults to **Muse Spark 1.3 Free** (`opencode/muse-spark-1.3-contributor-free`), variant `medium`. `GEN_MODEL` and `GEN_MODEL_VARIANT` are explicit overrides. Model generation has not been run to validate schema v8.

The existing corpus and vocabulary adapters read source material from the adjacent checkout or configured input paths; they do not write back. `GEN_REF_DB`, `GEN_ASCIIFY_ROOT`, `GEN_DB`, `GEN_OUT_DIR` and `GEN_RUNS_DIR` configure input/output locations. There is no new Asciify integration requirement.

Generation priority remains **arrows → formatting → punctuation → special symbols → emoji → everything else**. Priority groups are not truncated by the soft target for the remaining corpus. Default selection covers eligible source entities; private/unassigned entries remain excluded except explicit failure evidence.

## Commands

Requires Node 22.18+, OpenCode and the existing Chrome/font render dependencies for live generation.

```sh
node bin/generator.mjs plan
node bin/generator.mjs run --stage=records --limit=10 --threads=2
node bin/generator.mjs emit --allow-partial
npm start
```

`plan` updates selection ordering while retaining historical checkpoints. `run --stage=all` can make many model calls. The dashboard's B builds records; X runs the record autopilot. Legacy research stages remain explicit alternatives, not the default pipeline.

`./test.sh` is a **live, paid/quota-consuming provider pass** over 16 characters. It disables contract repairs, making at most four calls per character (64 total). It prints errors as they happen, records progress in both the run-local report and `out/test-results.json`, and exits nonzero on failures. It has not been run for the current contract. `npm test` runs local unit tests, including injected provider fixtures; it is separate from the live harness.

`./test.sh --hand` (also `—hand`) runs only 🪬 (U+1FAAC), prints its result, and writes `out/test-results.json` in addition to a separate `-hand` run directory.

`./test.sh --old` runs the 9 historical comparison characters and writes `out/test-results-old.json`. `./test.sh --100` combines all 16 normal characters and all 9 historical characters with 75 additional arrows, typography/spacing characters, math symbols, shapes, currency/UI symbols, and emoji: exactly 100 distinct code points, up to 400 model calls. It prints all 100 results by default and writes `out/test-results.json`, with a separate `-100` run directory. Presentation options such as `--print=5` can override the output size; `--cps`, `--family`, and `--old` cannot override the 100-character cohort. The typographic spelling `—100` is also accepted. Live runs remain user-run only.

For a full family, run `./test.sh --family=bullet` (all 7 canonical bullet characters), or another exact family enum. This includes every reference-corpus member of that family, folds scalar/presentation-only sequence duplicates, and reports omitted duplicate counts. It does not silently skip taxonomy gaps: quarantined/missing records prevent complete coverage. A full arrow family can be much larger and requires up to four provider calls per entity. The report includes family/subfamily counts, per-family register coverage, low-yield members, fixed-taxonomy errors and copied descriptions across differing facts. These deterministic flags support human comparison of the saved records; they do not certify model semantics. Local tests cover the complete seven-member bullet fixture, missing/contaminated records and left/right contrasts. The full-family live run remains user-run only.

Descriptions use natural prose. Unicode names/codepoints remain metadata; uppercase name dumps, repeated long names and generic hedge tails are rejected for bounded repair. Specific qualifications and negation remain intact. Embedding text uses appearance (or natural identity for invisible symbols), the reviewed full names, and established meaning. It does not append generated query variants or source/evidence prose.

## Output contract

- `embedding_records.jsonl`: one factual record and compact description document per entity, plus canonical facets, baseline and retained lexical variants. No vectors are created.
- `baseline_sources.jsonl`: verbatim source text and fingerprint.
- `baseline_vocabulary.jsonl`: preserved names/codepoint labels/alias entries with source and verification status. No discovery credit.
- `retrieval_vocabulary.jsonl`: every distinct grounded wording, with register, relevance, group ID and its own baseline relation. These are suggestions, never exact-query winner rules.
- `intent_embedding_candidates.jsonl`: optional text-only candidates for direct meaning/use groups. One representative per group, never all paraphrases. Related/ambiguous candidates are withheld from this file. Documents carry the entity ID as a merge key. Selection does not prove benefit.
- Collection curation is deferred. Records reserve empty `collections`/`collection_memberships` arrays; generation exports no collection or palette files.
- `family_catalog.json`: current closed family list.
- `record_evidence.jsonl`: all draft, review, discovery, assessment and provenance data; never embedding content.
- `record_attempts.jsonl`: parsed, rejected and failed attempts across all four phases.
- `quality_report.json`: factual verdicts and candidate relevance separately; baseline echoes, retained phrases, new wordings, phrase shortfalls, register coverage and known/proposed/uncertain intent groups separately. Includes cohort completeness and cross-character repeated-description flags. Measured search improvement stays null.
- `manifest.json`: schema/stage versions, model, file checksums and explicit zero-vector/no-integration contract.

`emit` requires current, revalidated phase outputs. `--allow-partial` marks incomplete inspection artifacts. v1/v2 records cannot silently enter v5 exports. Existing generated files are preserved as historical evidence.

Identical ink hashes become one attachment before model calls. Property scope is computed: observed, cross_render or established. These are evidence scopes, not universal font guarantees. Review of visual properties must cover all claimed attachments. Unique property keys contain value arrays. Direction, terminal head direction and traveled directions retain separate roles.

Explicit attachment IDs and distinct image hashes determine visual coverage. Evidence prose such as "both renders" cannot add support. A wording/citation mismatch creates a nonfatal `render_wording_mismatch` audit warning, preserved in checkpoints, attempts, evidence and the quality report. Invalid IDs, incompatible basis/attachments, and missing visual-property coverage still fail validation.

## Reviewer calibration, offline preparation and scoring

```sh
node scripts/reviewer-calibration.mjs prepare --split=calibration --out=out/calibration/tasks.jsonl
node scripts/reviewer-calibration.mjs score --split=calibration --responses=out/calibration/responses.jsonl --out=out/calibration/score.json
# Use --split=holdout for the separate held-out cases.
```

Neither command invokes a model or the search application. Preparation emits the actual reviewer prompt and blinded tasks with opaque case IDs, no expected answers. Responses are JSONL rows `{ "case_id": "case:...", "response": { ...model response... } }`. Scoring reports false accepts, false rejects, missed cases and grouping failures. Missing/invalid responses cannot look like success.

Controls include reversed directions, harpoon travel versus barb side, invented components, mathematical negation, truthful synonym bundles, separate semantic intents and multiple simultaneously relevant symbols. `src/record-relevance.mjs` provides the target-free multi-candidate annotation contract: all plausible matches can pass, with no designated winner. These annotations are reviewer controls, not search benchmarks.

**Fixture labels are provisional and require human review.** They are not presented as a human-validated benchmark or an automatic production approval gate. No calibration model run has been performed.

## Unicode taxonomy and colors dataset

`src/taxonomy.mjs` assigns families in code using checked Unicode 17.0.0 data. The ordered predicates in `src/taxonomy-family.mjs` classify identities, with guards against matching words inside unrelated names. Schema v6 fixes the family and code-assigned subfamily in prompts, parser, cache keys and exports. Known enum gaps are quarantined; other null assignments allow a reviewed model fallback from the family's closed enum.

Punctuation includes `annotation` for reference marks, daggers, asterisks and section/paragraph markers. The eight black/white card-suit symbols use `emoji/card-suit`, including text and emoji presentation variants; other heart identities retain `heart`. Known punctuation gaps such as ampersands and solidi are reported before rendering or model calls. Taxonomy and prompt changes automatically select new checkpoint versions.

`node scripts/taxonomy/coverage.mjs --sample-families --write-doc` prints full character/sequence coverage and regenerates [families.txt](families.txt), including subfamily nulls, unknowns and reproducible samples. It also writes `out/taxonomy/colors_collection.json`: all 36 official swatches across 12 colors, independent of generated-record sampling. Color is a property and colors is a collection, spanning shapes and solid hearts. Complete collection membership is the dataset contract; no search engine or query resolver is implemented here.

Run unit/fixture checks with `GEN_TEST_FULL_HARNESS=0 npm test`. Live generator testing is user-run only (`./test.sh`); inspect `out/test-results.json` afterward.

Collection decoupling (schema v5): prompts receive no collection catalog, factual review has no collection claims, and export adds no automatic colors membership. Taxonomy/subfamily acceptance rules are unchanged.

## Dominant color contract (schema v6)

`color` has exactly one canonical dominant whole-symbol color, or is omitted. `accent_color` optionally records smaller component colors, with evidence naming the component. Both use the existing 12-color palette from `taxonomy-colors.mjs`. For a yellow face with a blue tear, the output is `color: ["yellow"]` and optionally `accent_color: ["blue"]`. Component-specific prose can still say "blue tear"; neither reviewers nor discovery should turn it into "blue emoji".

Non-swatch dominant colors require rendered evidence across every supplied distinct view. The writer omits `color` when no stable dominant hue exists, colors are equally prominent, or views disagree. Code-fixed Unicode swatch identities retain their fixed color. Theme/background ink is not intrinsic glyph color. The parser rejects multiple dominant values, unknown palette values, unsupported evidence bases and dominant/accent overlap. It does not infer visual prominence from pixel counts; independent factual review must verify that semantic claim.

Export preserves `facets.color` and `facets.accent_color` separately. It never merges accents into dominant color. Compilation revalidates this contract; old multi-color records fail rather than silently choosing the first hue. The schema/prompt revision invalidates earlier checkpoints for current exports. Historical files are not rewritten, and this change does not modify any search page or application.


## Conventional meanings (schema v7)

Before setting meaning to null, both writer and independent reviewer check keyboard/UI notation, mathematics/logic, typography/editorial marks, cultural/religious symbolism and common informal usage. The reviewer always receives `description.meaning`, including null, and can reject an omitted convention. Uncertainty requires review rather than an unsupported assertion of absence.

Non-null meaning requires `meaning_evidence: { basis: "convention", source: "named practice or known document", evidence: "how the convention uses the character" }`. With null meaning, the evidence field is null too. This is attributed model knowledge assessed independently, not a fabricated external verification. Evidence stays outside embedding prose. Supported meaning review requires convention basis.

Discovery must produce at least one `intent: "use"` candidate citing `description.meaning`; export requires such a grounded phrase to survive vocabulary review and grouping. Shape paraphrases do not satisfy use coverage. For ⊞, keyboard-shortcut notation supplies the Windows-key stand-in meaning and queries such as “windows key”, “win key” and “windows logo key”; the source evidence does not claim that the glyph is the official logo. Old checkpoints are invalidated by the new schema/prompt contract. Live validation remains user-run.


## Established names (schema v8)

`names` is a required array of up to 16 distinct `{ name, basis, source, evidence }` facts. It records what a character or represented object is called, separately from its appearance and use. Identity-backed names require supplied metadata; conventional names require attributed domain knowledge. The factual writer and reviewer remain blind to historical synonym blobs. Neither pixels nor an old alias provide evidence for a cultural name.

The reviewer checks each `names.N` entry and a separate `names` completeness claim, even for an empty list. It must flag omitted common technical, cultural, historical or transliterated names. An empty list is legitimate after checking naming conventions; uncertainty or a missing established name blocks acceptance. This semantic check still depends on the reviewer's knowledge, not a deterministic dictionary of all possible names.

Discovery must include every reviewed full name as `intent: "name"` citing its own `names.N` fact, even when meaning is null. Export requires each exact name to survive vocabulary review with direct relevance and name intent. Related wording, one generic name candidate, baseline entries, use phrases and shortened keywords cannot satisfy this per-name check. Alternate names share a naming intent; new spelling is not a newly discovered use.

Export includes the evidence-backed `names` array, full names in lexical retrieval vocabulary, and a compact “Also known as” line in the character embedding text. Source/evidence text remains outside embeddings; name groups create no additional intent embedding candidates. Existing baselines keep their original provenance and verification status. Schema/prompt fingerprints invalidate old checkpoints, and export revalidates the names contract.

Offline regressions cover hamsa names, irony mark, empty and incomplete lists, unsupported evidence, missing citations, reviewer withholding/reclassification, and persisted artifact export. To validate the provider on both reported failures, run `./test.sh --cps=1faac,2e2e --print=2` yourself, then inspect `out/test-results.json`. No live validation has been performed for this contract.
