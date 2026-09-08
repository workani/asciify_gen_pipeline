# Generator dashboard

A React view of a pipeline run. Built for the Stack Exchange miner first, but
nothing in it knows about Stack Exchange: it renders whatever emits the event
vocabulary in [`lib/events.ts`](lib/events.ts), so another part of the generator
can drive it by emitting the same lines.

Design tokens are carried over from `../../httpcodes` — one world, black; 2px
corners; hairlines rather than boxes; Martian Mono for machine readouts and
Instrument Sans for prose.

## Watch a run

```sh
npm --prefix web install          # once
npm --prefix web run build        # produces web/out

python3 scripts/mine.py run docs/miner/pilot.manifest.json   # terminal UI as usual
python3 scripts/miner-web.py --work-dir .miner-work          # another shell
```

Open <http://127.0.0.1:8787>. No flags have to agree: `run` journals its events
to `<work-dir>-events.jsonl` by default and the bridge derives the same path
from `--work-dir`.

`http://127.0.0.1:8787/demo` plays a synthetic run and needs no miner at all.

## Develop

```sh
npm --prefix web run dev -- --port 3210
```

The dev server detects it is not the bridge and connects to
`http://localhost:8787/events`. Override with `?events=<url>` or
`NEXT_PUBLIC_MINER_EVENTS`.

## Shape

| Path | Role |
| --- | --- |
| `lib/events.ts` | The wire vocabulary, mirroring `src/se_miner/events.py` |
| `lib/state.ts` | `RunModel`: events in, immutable `RunSnapshot` out. No I/O |
| `lib/source.ts` | `useRunFeed`: SSE or demo, publishing at a bounded 10 Hz |
| `lib/format.ts` | Byte, count, duration and rate readouts |
| `lib/tone.ts` | Status → the `--k` signal tokens the components read |
| `components/Meter.tsx` | A bar that sweeps instead of filling when no total exists |
| `components/StageStrip.tsx` | One segment per planned stage |
| `components/Dashboard.tsx` | The composition |

`RunModel` is a mutable accumulator with a `snapshot()` reader, mirroring
`uistate.py`, because a busy run emits thousands of events per second and a
re-render per event would be useless. `source.ts` publishes on a 100 ms tick.

## What it will not claim

- A percentage or an ETA appears only with a denominator that is actually true.
  A first discovery pass over a table has no row total, so it shows a hatched
  track with a travelling pulse — a shape that cannot be misread as a fill —
  plus the real row count and throughput.
- A completed discovery pass supplies the total for the matching collection pass
  over the same table. An unfinished one never does.
- Downloaded bytes are network traffic, never completion: archives get read
  repeatedly across passes.
- Replay on resume is labelled, and measured against the committed ordinal it is
  replaying to, separately from newly processed rows.
- Observed rows and safely committed rows are shown separately.
- A run that stops emitting reads `stale`, with the age of the last event, and a
  feed with no run at all reads `no run`. A frozen frame never passes for a live
  one.
