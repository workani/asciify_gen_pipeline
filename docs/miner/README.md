# Stack Exchange symbol miner

Phase 1 infrastructure: bounded archive ingestion, source discovery, thread reconstruction, exact-text preservation, local post search, and audit exports. No LLM calls, synthetic descriptions, embeddings, or claimed ground-truth mappings. This pipeline is independent of the current generator and never imports or modifies its database.

## Start

Requires Python 3.9+ with SQLite FTS5 and libarchive. macOS provides libarchive; Linux usually needs the system `libarchive` package. No pip packages, Stack Exchange API key, or OpenCode installation are needed.

```sh
# Inspect/pin sources and required tables. Does not scan post content.
python3 scripts/mine.py preflight docs/miner/pilot.manifest.json

# Run/resume the three-site pilot. Draws a live dashboard in an interactive
# terminal; streams JSON progress events to stderr when redirected or --no-ui.
python3 scripts/mine.py run docs/miner/pilot.manifest.json

# Split one manifest across machines: mine a single site here and leave the
# rest to another host's own work directory.
python3 scripts/mine.py run docs/miner/pilot.manifest.json \
  --only-site tex.stackexchange.com --work-dir .miner-tex

# Classify rows across processes. Defaults to one worker per core; `1` keeps
# classification in-process. See "Throughput and --workers" below.
python3 scripts/mine.py run docs/miner/pilot.manifest.json --workers 4

# Inspect coverage and storage, including incomplete phases.
python3 scripts/mine.py status

# Build/resume the derived index after stopping ingestion. Entirely local.
python3 scripts/mine.py reindex

# Search matching threads' questions, answers, comments, and original revisions.
python3 scripts/mine.py search 'looks like n' --kind comment
python3 scripts/mine.py search '↯' --mode literal
python3 scripts/mine.py search 'U+200B' --mode codepoint
python3 scripts/mine.py search 'U+200B' --mention explicit
python3 scripts/mine.py search 'U+0065 U+0301' --mode sequence
python3 scripts/mine.py search 'n tail' --scope requests
python3 scripts/mine.py search 'arrow OR harpoon' --mode fts --limit 20
python3 scripts/mine.py search 'symbol' --site tex.stackexchange.com --min-score 7 --offset 20

# Inspect a full candidate (replace 123 with an ID from search).
python3 scripts/mine.py thread tex.stackexchange.com 123

# Stable randomized audit sample; source IDs, raw fields and reasons included.
python3 scripts/mine.py audit --sample 200 --output out/miner-audit.jsonl
python3 scripts/mine.py audit --kind rejected --output out/miner-rejected.jsonl
python3 scripts/mine.py export --output out/miner-candidates.jsonl
```

Exports fail on incomplete ingestion or structural coverage warnings unless explicitly passed `--allow-partial`. Every row carries coverage status and release. Exported candidates remain `unresolved`, including high-scoring ones. Output files are created exclusively and published atomically; existing artifacts are not overwritten.

`--max-rows 100` stops after 100 **new rows across scan phases**, commits progress, and exits with code 2 and an explicit pause message. Resume without the flag. This is a bounded ingestion check, not a model test. `--batch` controls checkpoint frequency (default 500 rows). Ctrl-C rolls back only the uncommitted batch. A second writer on the same directory is rejected; read-only inspection uses a separate connection.

## The live dashboard

`run` starts mining immediately and, when stderr is an interactive terminal, draws a dashboard in the same terminal. There is no separate server, browser, or start action, and a second `status` terminal is no longer needed. Everything is Python standard library: no curses, no pip packages, no new dependency to install.

The dashboard shows the release, manifest, work directory, elapsed time and run state; an overall bar counting **completed stages and sites**; every site as pending, active, completed, skipped or failed; the active site with a plain-language stage name (`Discovering posts`, `Scanning comments`, `Resolving candidate threads`, `Collecting full discussions`); current-stage rows, throughput and the last committed checkpoint; candidate, retained-document and discovery-hit counts; storage against the configured budget with its own capacity bar; network requests and bytes; and a scrolling area of timestamped log lines.

Progress is reported honestly:

- A **percentage and ETA appear only when a real denominator exists.** A first discovery pass over a table has no row total, so it shows an animated indeterminate bar with the actual row count and rows/sec instead of an invented percentage.
- A **completed discovery pass supplies the total for the matching collection pass** over the same table (`discover_posts` → `collect_posts`, and likewise for comments and history). Transport rejects a changed source, so a complete checkpoint cannot outlive the count it describes. An unfinished discovery pass is never used as a denominator.
- **Archive bytes are never treated as mining completion.** Solid 7z blocks are read repeatedly across passes; downloaded bytes are reported as network traffic only.
- On resume, **replaying decompression to reach a committed row is labelled as replay**, with its own bar against the known replay target, and is kept separate from newly processed rows.
- **Observed rows and safely committed rows are shown separately**, alongside the time of the last checkpoint.
- Startup, inventory, source validation and hashing, network waits and retries, replay, and thread resolution all report activity, so a long blocking step never looks like a hang. No extra archive scan is performed to compute any of this.

Rendering repaints at a bounded rate from a snapshot of a UI state model; expensive counts are collected less often and only between transactions. The display runs on its own thread, reads no SQLite handle, and leaves database ownership, writer locking, storage limits, source validation and checkpoint semantics untouched. The miner never invokes its own CLI or launches a second miner to obtain status.

Terminal behaviour: the dashboard uses the alternate screen buffer, adapts its layout to smaller terminals, drops to ASCII glyphs when the terminal encoding cannot represent the Unicode set, honours `NO_COLOR`, and restores the terminal on every exit path including errors, `SIGTERM` and `SIGHUP`. After the live display closes, a readable summary remains on screen with the final state, counts, coverage warnings, and any pause or error reason.

`Ctrl-C` keeps the existing behaviour — only the uncommitted batch is rolled back — and prints the exact command that resumes the work directory. Exit codes are unchanged: `0` for a completed run, `2` for a stop or failure, `130` for an interrupt. A run that finishes with coverage warnings still exits `0` but is labelled `COMPLETED · WARNINGS` with the warning counts.

Pass `--no-ui` to never draw the dashboard, or set `MINER_NO_UI=1`. The dashboard is also skipped automatically when stderr is redirected or `TERM` is unset or `dumb`. In every non-dashboard case, `run` streams one JSON progress event per line to stderr (`run_started`, `stage_started`, `replay`, `progress`, `checkpoint`, `stage_complete`, `stage_skipped`, `metrics`, `network`, `retry`, `run_finished`, …) exactly as before. The full JSON report always goes to stdout, so `run > report.json` keeps working; it is suppressed only when the dashboard drew and stdout is itself a terminal, where a JSON dump would bury the summary. `preflight` and `status` are unchanged.

## The web dashboard

`run` also journals its progress events to `<work-dir>-events.jsonl` — beside the work directory, never inside it, so the storage budget still accounts only for the archive cache and the database. The journal is truncated at the start of each run, and the high-frequency events (progress, checkpoints, replay, network) are sampled to about two per second, so a multi-hour run leaves a file measured in megabytes rather than gigabytes. Structural events — stage transitions, retries, warnings, completion — are never sampled away. Pass `--no-events` to disable the journal, or `--events PATH` to put it elsewhere.

A React dashboard in [`web/`](../../web) renders the same run in a browser, on a phone as well as a desktop:

```sh
npm --prefix web install       # once
npm --prefix web run build

python3 scripts/mine.py run docs/miner/pilot.manifest.json    # terminal UI as usual
python3 scripts/miner-web.py --work-dir .miner-work           # another shell
```

Open <http://127.0.0.1:8787>. The two sides need no flags to agree: the bridge derives the journal path from `--work-dir`. It tails the journal, so starting it before, during, or after a run all work — every browser is sent the backlog first and rebuilds the whole run state from it, and a new run retires the previous one rather than appending to it. `http://127.0.0.1:8787/demo` plays a synthetic run with no miner attached.

The web view keeps the same refusals as the terminal one: percentages and ETAs only with a real denominator, an unmistakably indeterminate track otherwise, replay measured separately from new rows, and archive bytes reported as traffic rather than completion. It additionally reports `stale` with the age of the last event when a run stops emitting, and `no run` when the journal is empty, so a frozen frame never passes for a live one. `scripts/miner-web.py` binds to `127.0.0.1`, serves only the built site, and writes nothing.

See the dashboard without downloading any pilot archive:

```sh
python3 scripts/miner-ui-demo.py            # scripted timeline in the live UI
python3 scripts/miner-ui-demo.py --live     # real pipeline over generated local XML
python3 scripts/miner-ui-demo.py --frames   # static frames; needs no terminal
```

## Scope and source manifest

Only strict `.stackexchange.com` community hosts are accepted. Stack Overflow, localized editions, its metas, MathOverflow, Super User, and all other custom domains are excluded. Allowed metas such as `tex.meta.stackexchange.com` can be explicitly included. Every site must be listed in the manifest; content links never widen scope. Site attribution is taken from the trusted manifest, because the XML row schema itself contains no hostname.

The included pilot covers English, Mathematics, and TeX. These are **the April 2024 uploads in the Internet Archive `stackexchange` item**, not current live content. Their archive sizes and ETags were checked on 2026-09-06. All three support byte ranges and contain Posts, Comments, PostHistory, and PostLinks. Newer official authenticated dump URLs may be supplied instead. Do not label an old mirror as a current dump.

```json
{
  "version": 1,
  "release": "my-explicit-snapshot-label",
  "sites": [
    {
      "site": "tex.stackexchange.com",
      "archive": {
        "url": "https://your-dump-host/tex.stackexchange.com.7z",
        "etag": "\"optional-pinned-strong-etag\""
      }
    }
  ]
}
```

`--only-site HOST` (repeatable, also accepted by `preflight`) restricts one run to part of the manifest. It filters the run plan only: the pinned contract still records every manifest site, so two machines sharing a manifest keep identical contracts and an unselected site's checkpoints are never disturbed. A site left out of the run opens no source and issues no request for its archive. The flag is carried into the printed resume command, so a resumed run cannot silently widen back to the whole manifest. Coverage still judges the whole work directory, so a scoped run that finishes its own site reports `incomplete` while naming the sites it covered in `scope`; that is the directory honestly lacking the rest, not a failed run, and the exit code stays `0`.

`archive` accepts a remote URL or local path. Relative paths resolve against the manifest. Alternative `files` manifests map `Posts`, `Comments`, optional `PostHistory`, and optional `PostLinks` to `{ "url": "..." }`. Individual XML and XML.gz files are supported; `compression: "gzip"` handles URLs without a `.gz` suffix. Posts and Comments are mandatory. Optional missing tables are explicitly reported. Sources may specify `sha256`; remote range sources are then hashed incrementally on the first verified read without saving the whole archive. Local files and fallback cache files are hashed, too.

Generate a larger explicit manifest with **one catalog request**:

```sh
python3 scripts/mine.py catalog --item stackexchange \
  --release archive.org-stackexchange-uploaded-2024-04 \
  --output out/network.manifest.json
```

Add `--sites tex.stackexchange.com,math.stackexchange.com` for a subset. The catalog excludes disallowed domains before constructing download URLs. It does not download archives or claim the mirror is current. Inspect the generated metadata before a bulk run.

The first run pins each source identity in SQLite. HTTP reads use strong ETag + length, or Last-Modified + length if necessary; subsequent requests validate both ranges and identity. A changed source or manifest/filter contract stops resumption. Use a new work directory for a different snapshot or filter configuration. Last-Modified is a weaker identity than a digest; supply SHA-256 when available. Signed source URLs are part of the local manifest/database and thread provenance; redact credentials before sharing exported artifacts.

## How streaming and reconstruction work

1. Read archive headers to inventory tables. libarchive receives read/seek callbacks; it never extracts an XML file onto disk.
2. Scan every question/answer. Save a compact post → question routing index and high-recall discovery hits. Ignore tag wikis and the dump's two known artificial post IDs.
3. Scan **every comment**, including comments on answers, independently. A relevant comment can be the only trigger for retaining a thread.
4. Scan initial/edit/rollback titles and bodies in PostHistory. Original language may have disappeared from the current question. Save duplicate-question edges from PostLinks.
5. Resolve all hit post IDs to question IDs. Keep duplicate edges as provenance; a linked thread must independently qualify for collection. This happens before source collection, so comment/history discoveries do not lose earlier questions or answers.
6. Re-read Posts, Comments, and PostHistory, saving complete available discussions and relevant revisions for candidate threads. Accepted-answer references and all original row attributes survive in `raw`.

Each phase saves its row ordinal and data in the same SQLite transaction. Resumption replays decompression from the start of the current table and skips committed rows. **It is not an O(1) random-row resume**: solid 7z blocks generally require decompression replay. Bandwidth and CPU are intentionally traded for low disk use. A partial XML parse never becomes a complete checkpoint. Missing question/accepted-answer relationships, orphan hits, and answer/comment count discrepancies appear in the coverage report.

The remote reader requests 4 MiB blocks and keeps at most four blocks in its in-memory LRU. Retries are bounded, short transfers are rejected/retried, conditional requests detect changes, and Range/Content-Range responses must match exactly. No per-post API or website crawling calls occur. Each reopened archive currently re-probes its metadata; archive block caches are memory-only and not shared across passes.

If byte ranges or stable HTTP validators are unavailable, one compressed archive is cached with streaming size checks and a SHA-256 digest. A source that cannot fit the remaining budget pauses safely. Completed site cache files are reclaimed. The system never assumes it can pipe an arbitrary 7z file through a non-seekable downloader.

## Throughput and `--workers`

Discovery is dominated by `classify()`, which is pure-Python regex work over
every row's prose: roughly **1.7 ms per post**, against ~0.025 ms for everything
the parent does with that row (Expat, the routing insert, moving fields to a
worker and a verdict back). A single-process run is therefore CPU-bound on one
core, and a scan's row rate is very close to one core's classification rate --
on a budget VPS vCPU that is a few hundred rows per second, and the low byte
rate a dashboard reports alongside it is demand, not a transport limit.

`--workers` classifies rows in a pool of processes. `classify()` is a pure
function of one row's fields, so a worker returns a verdict and nothing else:
the parent still owns SQLite on one thread and still applies verdicts in source
order. **Worker count is a throughput setting, never a rule setting.** It is
deliberately absent from the work directory's pinned contract, so a run may be
paused at one setting and resumed at another; the database and every checkpoint
ordinal are identical either way, and `test_ui.py` asserts exactly that.

Measured on one `discover_posts` pass over 12,000 real posts, on an 8-core
Apple Silicon laptop (four performance cores, four efficiency cores):

| `--workers` | rows/s | speedup |
| --- | --- | --- |
| 1 | 427 | 1.00x |
| 2 | 895 | 2.10x |
| 4 | 1,579 | 3.70x |
| 8 | 2,280 | 5.34x |

Two workers exceed 2x because the parent's own per-row work moves off the
classifying core. Eight fall short of 8x because half of this machine's cores
are efficiency cores; expect closer to linear on homogeneous vCPUs.

Scaling stops where the source does. The parent can feed dozens of workers, but
the remote reader fetches one 4 MiB block at a time with no read-ahead, so past
roughly four workers on a remote archive the range request, not classification,
becomes the limit. A local or pre-staged archive has no such ceiling.

Workers are spawned, not forked, on every platform: the live dashboard is
already running its own thread by the time a pool is built, and forking a
multithreaded process inherits locks no thread will release. The cost is one
import of the rule modules per worker, once per run.

## The 10 GB cap

Default working directory: `.miner-work/`. Default cap: **10,000,000,000 bytes**, configurable with `--budget-gb`.

Counted together: compressed archive cache/partial downloads, candidate source text, routing/search indexes, rejected audit samples, database/checkpoints, and SQLite transaction journals. Existing project files, logs, reports, and exports are outside this budget and must remain outside the work directory.

The allocation is dynamic. Remote range reads need no archive disk cache. SQLite uses DELETE journals, FULL synchronization, a bounded page cache, and a maximum database page count that conservatively reserves approximately another database's worth of journal space. Consequently, the retained database cannot consume the full nominal 10 GB on its own; this is deliberate headroom to uphold the cap even during transactions. Evidence is never auto-evicted to make room. An actual full disk also stops the run safely. No process can guarantee remaining physical disk capacity against unrelated concurrent writers.

## Relevance and search contracts

[Independent identity/semantics selection and full-thread review packets](selection-2026-09-08.md) can now be replayed locally without invalidating v6 ingestion. Use `scripts/select-miner.py audit` for source samples and `threads` after collection; neither command calls a model.

The current filter (`target-evidence-6`) parses math/code structure, inventories typed targets, then requires a naming, typing, meaning, origin or appearance relationship to that target. Finding a variable or encountering technical words such as “character” and “symbol” does not qualify a source. Direct glyph-meaning questions receive score 8. Identity evidence receives 5, discussion 4, and genuinely unresolved typing/usage context 3 (`review`). Tags and encoding background alone cannot seed collection, even with `--threshold 1`. Scores are priorities, never confidence or resolved character mappings. See [the v6 rebuild and calibration results](discovery-rebuild-2026-09-08.md).

Each hit records rule, field, exact start/end offsets, and matched text. Offsets are Python Unicode-string indices in the **XML-decoded original field**, not offsets into archive bytes, HTML-rendered text, or UTF-16 code units. Raw fields are never casefolded, normalized, spelling-corrected, or symbol-stripped. The search index is a derived view: post HTML becomes visible text; comments/revisions retain their source wording. HTMLParser renders no scripts and makes no network requests.

`reindex` builds `.miner-work/search-v2.sqlite` from the retained documents using a read-only source connection. Both databases and their journals count toward the same 10 GB cap. Text and assessments are deduplicated; every original document ID remains linked. Checkpoints commit with their source records, so interruption is resumable. Search refuses unfinished or stale indexes. Source identity, filter hash, schema, and runtime Unicode version are recorded. The original pilot is preserved. Reindexing cannot recover source records the old filter rejected; that needs a new archive scan.

Search returns **one result per thread**, with the best matching source, exact evidence spans, source role, thread category, and a source URL. Current documents outrank historical copies; comments can independently identify a request or supply evidence. An answer quoting a question does not promote its parent to a request. Duplicate links alone do not confer relevance. An evidence-bearing request is still `unresolved`: a mentioned character may be incidental, disputed, or one of several possibilities.

Words use FTS5; substrings use a case-sensitive trigram index followed by exact verification; codepoints use separate indexed glyph/reference fields. Valid `U+` notation, Unicode escapes (including surrogate pairs), and supported uppercase Unicode letter names count as explicit references. Name lookup uses Python's recorded UCD version; arbitrary names and LaTeX commands are not fully resolved. Glyph sequences preserve order, variation selectors, joiners, and combining marks. No NFC normalization occurs. Mixed word/glyph queries retain glyph constraints. Codepoint search ranks explicit references first; `--mention explicit` excludes incidental literal-only matches, and `--mention literal` searches actual glyphs. Sequence mode matches literal contiguous sequences; separate `U+` mentions do not imply a sequence.

The default `--scope relevant` requires the matching document itself to contain eligible character evidence. An unrelated answer or comment cannot qualify just because another document in the thread is relevant. `--scope requests` restricts to threads with a current/comment/historical question request; all matching context within those threads stays searchable. `--scope review` selects retained sources that need review and are excluded from the default relevant scope. `--scope all` includes unrelated retained context. `--kind` selects source type. `--mode fts` enables advanced syntax; ordinary input is safely quoted. Queries have a 20-second SQLite execution limit. `--legacy` explicitly invokes the original per-document search for comparison. This is lexical source search, not the later semantic character retrieval/Top-1/Top-5 benchmark.

Rejected audit samples use a deterministic hash-based bottom-k sample **per site and content type**, default 100 each. Candidate audits use a deterministic hash-based sample across candidate threads. These support manual error analysis; neither measures recall without reference labels. Duplicate groups, source snapshots, and query-level train/holdout splits must be handled before later embedding work.

## Validation

```sh
python3 -m unittest discover -s test/miner -v
```

These tests use generated XML, generated real 7z containers, temporary SQLite databases, and loopback HTTP fixtures. They never call a model or the live generator. They cover comment-only and history-only discovery, complete thread collection, duplicate-edge preservation without automatic promotion, cross-site ID collisions, raw Unicode/whitespace, FTS and glyph lookup, resume equivalence, changed sources/contracts, bad/truncated XML, forbidden entities, remote ranges, SHA verification, cache fallback, and storage rollback safety.

`test_ui.py` covers the dashboard offline: event and state handling, unknown totals rejecting percentages and ETAs, discovery totals feeding matching collection passes, resumed checkpoints and replay reporting, optional stages disappearing from the plan, archive bytes never advancing completion, a bounded log that checkpoints do not flood, frames fitting every terminal size, the ASCII and no-colour fallbacks, terminal restoration on error, non-TTY JSON output, `--no-ui`, interruption preserving checkpoints while printing the resume command, failures, and completion with coverage warnings.

Real source validation: English ingestion completed; Mathematics is partially discovered; TeX collection has not started in the main pilot. See [pilot-review-2026-09-06.md](pilot-review-2026-09-06.md) for the original findings and [search-rebuild-2026-09-07.md](search-rebuild-2026-09-07.md) for the v3 fix and saved-data rebuild. Offline tests include 24 exact-source pilot regressions plus adversarial language, markup, Unicode, grouping, resume, and budget checks. These calibration cases are not a held-out evaluation. See [HANDOFF.md](HANDOFF.md) for the larger manual audit still required.

The old pilot's discovery checkpoints are bound to its original filter. Do not resume an older database with current filter settings; the filter contract deliberately rejects it. Reindex its retained documents locally instead. A fresh ingestion work directory must share the project storage allowance: subtract retained old sources/indexes from its `--budget-gb` allocation so their combined size stays below 10 GB. Logs and audit exports belong outside these working directories.
