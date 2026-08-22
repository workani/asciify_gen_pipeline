# Asciify Dataset Factory

A checkpointed vision-LLM pipeline that builds a versioned Unicode search-evidence dataset for Asciify. It is designed for a 20–30k entity run, real failure cases first, followed by high-value Unicode coverage and bounded exploration.

The factory does not treat model output as truth. Aliases pass through dual-vendor blind grounding, identity enrichment, top-five contrastive generation, adversarial verification, name/image-blind claim recovery, query synthesis, Asciify round-trip measurement, and confusable-cluster adjudication before the strict publish gate opens.

## Requirements

- Node.js 22.18 or newer. `node:sqlite` is unflagged from 22.13, and the round-trip harness imports Asciify's `.ts` sources directly, which needs built-in type stripping (22.18+). Node 24 LTS is the safe choice.
- OpenCode on `PATH`, at `$HOME/.opencode/bin/opencode`, or at `OPENCODE_BIN`
- Google Chrome or Chromium for deterministic glyph renders
- An adjacent Asciify checkout, or `GEN_ASCIIFY_ROOT`
- Asciify's `gen/out/ref.db`
- A full Noto Color Emoji TTF/OTF (the adjacent Asciify checkout's `gen/fonts/Noto-COLRv1.ttf` is auto-detected)

macOS and Linux are both supported. `CHROME_BIN` and `OPENCODE_BIN` are resolved through `PATH` as well as the usual install locations, so they normally need no configuration; set them when a binary lives somewhere unusual.

Install and verify:

```bash
npm install
npm test
```

All tests are offline. The OpenCode integration tests use a deterministic local fake; they never call a model. The Chrome-dependent tests skip themselves when no browser is installed — check the runner's skip count before treating a green suite as renderer coverage.

### Linux notes

Fonts decide what the vision model sees, and a stock server image has almost none:

```bash
sudo apt install -y chromium fonts-noto-core fonts-noto-extra fonts-noto-color-emoji fonts-dejavu-core
```

(`google-chrome-stable` works equally well but comes from Google's own apt repository, not Debian's.)

The `noto` vendor requires a full local Noto Color Emoji font. The resolver checks `GEN_NOTO_COLOR_EMOJI_FONT`, `assets/Noto-COLRv1.ttf`, the adjacent Asciify checkout's `gen/fonts/Noto-COLRv1.ttf`, and the usual Linux system path. It validates the sfnt name table and rejects small coverage subsets or unrelated fonts. The `platform` vendor prefers Apple Color Emoji/Apple Symbols or Segoe UI Emoji/Symbol. If the two normalized pixel fingerprints are identical, the entity is deterministically quarantined instead of claiming false vendor independence.

Headless Chrome needs an unprivileged user namespace for its sandbox. As a normal desktop or SSH user this works; as root or inside a container it does not, so the factory adds `--no-sandbox` automatically when running as uid 0 and honours `GEN_CHROME_NO_SANDBOX=1` for other confined environments. `--disable-dev-shm-usage` is always applied on Linux.

Moving an in-progress `state.sqlite` between machines: checkpoint the WAL first (`PRAGMA wal_checkpoint(TRUNCATE)`), then copy the single file — copying the database without its `-wal` sidecar silently loses the most recent stage work.

## Pipeline

```text
failure intake + ref.db
        ↓
25k deterministic selection + confusion graph
        ↓
blind visual grounding (identities withheld)
        ↓
identity / colloquial / usage enrichment
        ↓
top-5 confusion-neighbor contrastive claims
        ↓
independent adversarial claim verification
        ↓
rejected-alias rewrite
        ↓
independent rewrite revalidation
        ↓
name/image-blind claim recovery (retry contrast on failure)
        ↓
2–5 query phrasings per verified claim
        ↓
round-trip measurement through Asciify's lexical harness
        ↓
shuffled confusable-cluster adjudication
        ↓
strict quality gate + versioned artifacts
```

Checkpoints are per entity, stage, and prompt version. A crash leaves `running` checkpoints, which are recovered as `stale` on the next process start. Passed work is not regenerated unless its stage version changes.

### Blank-glyph and long-run hardening

Before any screenshot reaches a vision model, the renderer rasterizes exactly one glyph, counts its non-background pixels, and hash-compares its normalized ink crop with that vendor stack's `.notdef` render. Empty, tofu, missing-font, and identical-vendor renders are deterministically rejected. Blind grounding is fixed at two calls per normal entity: one multimodal call sees the target in both vendors alongside its top-five confusion neighbors and emits shared fixed-slot claims plus query phrasings; one fresh text-only call receives no images, names, or target marker and must recover the target while reviewing every claim. A malformed response is not silently retried, so a stage attempt can never expand into a 7–21 call loop. Bare counts, fill-only descriptions, and other low-information phrases never become standalone claims, and an entity cannot pass without a useful overall form or distinctive feature.

Each Chrome capture uses an isolated temporary profile. Complete screenshots are detected from the stable PNG itself, so a Chrome process that writes its result but fails to exit cannot stall the factory. Captures, model calls, and response sizes all have hard bounds. Blind grounding normally uses one generation and one recovery call; either phase gets at most one repair call after malformed output. Stage work is lease-fenced, unfinished leases are released on stage exit, and dead-process checkpoints are recovered on restart.

The adaptive blind-ground version intentionally does not migrate contact-sheet, six-vote, or semantic-majority evidence. Existing rows and raw OpenCode logs remain available for audit, but they cannot contaminate v7 artifacts.

## Commands

Create or refresh the 25k work plan:

```bash
npm run plan
# or
node bin/generator.mjs plan --target=25000 --failures=failures.jsonl
```

Run stages headlessly:

```bash
node bin/generator.mjs run --stage=ground --limit=500 --threads=4 --verbose
node bin/generator.mjs run --stage=enrich --limit=500 --threads=4
node bin/generator.mjs run --stage=contrast --limit=500 --threads=4
node bin/generator.mjs run --stage=verify --limit=500 --threads=4
node bin/generator.mjs run --stage=rewrite --limit=500 --threads=4
node bin/generator.mjs run --stage=reverify --limit=500 --threads=4
node bin/generator.mjs run --stage=recover --limit=500 --threads=4
node bin/generator.mjs run --stage=synth --limit=500 --threads=4
node bin/generator.mjs run --stage=roundtrip --limit=15000
node bin/generator.mjs run --stage=adjudicate --limit=500 --threads=4
```

Run breadth-first unattended coverage until blind grounding and enrichment have
no eligible work left:

```bash
node bin/generator.mjs run --stage=all --wave-size=100 --threads=4 --verbose
```

Autopilot intentionally runs only blind ground → enrich across the corpus. Blind grounding persists independently recovered verified visual claims and initial query phrasings; enrichment adds identity, colloquial, and usage proposals. Contrast, verification, rewrite, reverify, recovery, synthesis, round-trip, and adjudication remain available as explicit manual stages, but unattended mode never spends API capacity on them.

AI stages use a rolling, work-conserving entity queue. A free worker is refilled immediately without combining glyphs into a contact sheet. OpenCode runs through the project-local `factory-json` agent with all tools disabled, `--pure`, and the low-reasoning model variant to avoid loading an unnecessary coding-agent tool context.

Open the dashboard:

```bash
npm start
# immediately start unattended processing with the dashboard visible
npm start -- --autopilot --threads=4 --wave-size=100
```

The dashboard is a responsive control room: checkpoint progress stays on the left, the focused OpenCode response streams in the center, and the wide layout adds four stable worker slots plus live dataset-quality counters. Thread buttons and pipeline stages are clickable; the same controls have keyboard shortcuts.

The header token/call counter is scoped to the current pipeline versions. Historical usage remains available in `status.tokens`, while `status.pipelineTokens` prevents an old multi-million-token run from looking like the cost of the current characters.

Dashboard keys:

```text
g blind ground   e enrich      c contrast     v verify       w rewrite      z reverify
d recover        s synth
r roundtrip      a adjudicate  p publish      x autopilot
1-4 threads
←/→ worker       f follow      space pause    ? help    q quit
```

Inspect status or emit artifacts:

```bash
npm run status
node bin/generator.mjs emit                 # strict production gate
node bin/generator.mjs emit --allow-partial # inspection artifact
```

## Failure input

JSON or JSONL records can augment the built-in failure report:

```json
{"query":"right triangle arrow","target_kind":"character","target_key":"9654","thief_keys":["10148"],"candidate_keys":["11246"],"count":31,"severity":5,"source":"production-events"}
```

`target_key` is a decimal code point for `character` targets and the exact lowercase sequence key for `emoji_sequence` targets. Failure targets and competitors override ordinary corpus exclusions and enter tier 0.

Selection order is determined by failure frequency/severity, built-in seeds, popularity, Unicode general category, visual/search value, alias gaps, and a category-balanced exploration reserve. Private use, surrogate, unassigned, and massive ideograph/syllable ranges do not consume the generation budget unless a real failure explicitly selects them.

## Artifacts

Every `out/<timestamp>-<pipeline-version>/` directory contains:

- `entities.jsonl` — selected corpus and selection provenance
- `claims.jsonl` — verified atomic evidence with verifier provenance
- `aliases.jsonl` — aliases grouped by target and family
- `alias_docs.jsonl` — entity-deduplicated vector documents
- `search_terms.jsonl` / `unicode_search_terms.sql` — approved exact terms for Asciify
- `synonyms_backfill.sql` — idempotent FTS synonym snapshot
- `goldens.jsonl` — graded queries, hard negatives, and baseline ranks
- `confusion_edges.jsonl` — deterministic, failure, and visual confusions
- `preference_pairs.jsonl` — adjudicated winner/loser training pairs
- `guards.jsonl` — victim/thief demotion rules
- `quality_report.json` — coverage and validation metrics
- `manifest.json` — model, prompt versions, counts, and SHA-256 checksums

Broad phrases shared by many targets remain available to vector retrieval but are down-weighted or withheld from exact-term insertion. Model-generated queries do not become search terms unless confusable-cluster adjudication supports their winner.

## Production publish gate

Normal `emit` refuses to publish unless all of these hold:

- 20,000–30,000 selected entities
- at least 95% of entities have verified aliases
- median of at least three verified aliases per entity
- at least 90% claim-recovery coverage and Top-1 accuracy
- at least 90% entity coverage by generated queries
- every generated query has a measured baseline rank
- verified aliases recover at least 90% of generated queries into Asciify's top five
- at least 90% of contrastive queries have cluster adjudication
- no checkpoint is still running

Use `--allow-partial` only to inspect progress. Its manifest records the failed gates.

## Configuration

```text
GEN_MODEL                OpenCode model (default: opencode/x-preview-f-free)
GEN_MODEL_VARIANT        reasoning variant (default: low)
GEN_LLM_AGENT            tool-free OpenCode agent (default: factory-json)
OPENCODE_BIN             OpenCode executable
GEN_ASCIIFY_ROOT         Asciify checkout
GEN_REF_DB               source ref.db
GEN_DB                   checkpoint database
GEN_THREADS              1..4
GEN_TARGET_ENTITIES      default selection size
GEN_EVAL_HOLDOUT_SIZE    immutable stratified entity holdout (default 500)
GEN_FAILURES             JSON/JSONL failure input
GEN_NOTO_COLOR_EMOJI_FONT full Noto Color Emoji TTF/OTF for the `noto` vendor
GEN_RUNS_DIR             immutable OpenCode NDJSON logs
GEN_RENDER_DIR           validated single-glyph rasters
GEN_OUT_DIR              artifact output
CHROME_BIN               Chrome/Chromium executable
GEN_CHROME_NO_SANDBOX    set to 1 to pass --no-sandbox (containers)
NODE_BIN                 node used by bin/autopilot.sh
GEN_LLM_START_TIMEOUT_MS maximum wait for the first OpenCode NDJSON event (default 90s)
GEN_REQUEST_TIMEOUT_MS   per-call timeout
GEN_MAX_RESPONSE_BYTES   maximum NDJSON line/response bytes
GEN_MAX_STAGE_ATTEMPTS   resumable attempts per failed stage (default 5)
GEN_RENDER_CAPTURE_TIMEOUT_MS  per-Chrome capture timeout
GEN_RENDER_ATTEMPTS      bounded recaptures (default 4)
GEN_RENDER_MIN_INK_PIXELS single-glyph ink threshold
```

Raw OpenCode event streams and session IDs are retained under `runs/`. The dataset can therefore be re-parsed or re-verified after contracts and prompts evolve without losing provenance.
