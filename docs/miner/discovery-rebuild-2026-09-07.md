# Discovery rebuild — 2026-09-07 (filter contract `target-evidence-4`)

The v3 rebuild fixed what counts as retained evidence. It left three upstream
defects untouched: the site set, the LaTeX discovery rule, and the size of the
bookkeeping those rules produce. Measured on the mined database before purge:

| Finding | Measurement |
|---|---|
| Discovery hits are 97% Math LaTeX | 3,015,653 of 3,099,942, and Math collected no documents |
| Those hits rest on `latex_symbol` alone | 96.4% of a 177,391-row sample |
| Bookkeeping per hit | 801 bytes, against 0.74 GB of actual text |
| English questions that are character requests | 592 of 27,693 (2.1%) |

## English is removed

`english.stackexchange.com` is out of `pilot.manifest.json`. It is a usage and
grammar site: 71.5% of its discovery hits came from `punctuation_context`
matching the words "comma", "hyphen" and "apostrophe", which is ordinary
vocabulary there and nearly orthogonal to identifying a glyph. Its retained
threads are preserved or purged by an explicit `purge` command, never as a side
effect of a run.

## A LaTeX command is evidence only as a subject

`\in` inside `$x \in A$` is notation about set membership. It says nothing about
the glyph, and it produced roughly 2.9 million discovery hits and zero
documents. `latex_subject` now requires the command itself to be the thing named,
typed or suggested:

- A command alone in its fragment (`Use \nabla.`) is a suggested symbol.
- A command inside a math span qualifies only when the span holds nothing else:
  `$\infty$` can be a subject, `$x \in A$` cannot.
- Outside a math span, three or more commands in one fragment is math prose.
- A binding verb before the command (`let`, `define`, `set`, `suppose`) marks a
  variable introduction, not a glyph: `Let $\alpha$ denote the angle` is excluded.
- The command must then sit next to a naming, typing or meaning relation.

Vocabulary no longer decides. Any `\command` qualifies through an explicit
subject frame (`\succ is called ...`, `what does \lhd mean`, `how do I type
\aleph`); the curated symbol list only widens which commands may also qualify
through nearby relations. That keeps `\usepackage` and `\newcommand` questions
out of a TeX run while admitting commands no list anticipated.

## Requests are recognized by structure

The old route needed a topic word from a fixed vocabulary near a question. A
request is instead recognized by its frame and a filled target slot:

    what is <slot> called | what does <slot> mean | what is the name of <slot>
    how do I type <slot>  | how to insert <slot>  | identify <slot>

The slot is what makes the sentence about a glyph. It is filled by a literal
glyph, a LaTeX command, or a deictic (`this`, `the following`). A deictic is
only accepted when the frame is a typing frame, which implies a written
character by construction, or when the document has both an image and writing
context. `What is this called?` over a photo of food stays rejected; the same
question about an old printed book in a serif font does not.

No character vocabulary is required, so `What does ⸮ mean?` now qualifies on its
own structure.

## Bookkeeping is a pointer, not a copy

A discovery hit stored up to 60 evidence dicts carrying `text` and
`display_text` — a second copy of matched source, averaging 801 bytes per hit.
Hits now store a `rules` column and compact `code:field:start:end` spans, capped
at six and ordered so one span per distinct rule survives the cap. Matched text
is recovered by slicing the stored source row, which is also what makes the
round trip verifiable. Measured over 106,894 real rows: **59.5 bytes per hit,
7.4% of the previous size.** The pre-cap signal count is retained, so truncation
is visible rather than silent. Rows written before this change still decode.

## Validation and limits

`python3 -m unittest discover -s test/miner` runs 120 offline tests, 12 of them
new: formula-versus-subject contrast pairs drawn from real Math and TeX prose,
request frames with and without filled slots, the food-image counterexample, and
a pack/unpack round trip asserting recovered spans still slice the exact source
text.

On the 100 previously rated English posts, v4 admits the same 4 of 5 rated
potentially useful and rejects all 95 rated adjacent or unrelated — unchanged
from v3. That sample was used to tune v3 and is calibration, not a held-out
evaluation. No precision or recall figure is claimed for the new rules; the
Math and TeX prose used to build them was written from observed failure modes
and inspected samples, and the corpus they target has not been mined yet.

The filter hash is part of the work-directory contract, so the existing
`.miner-work` cannot resume under v4 and its Math checkpoints cannot be reused.
A new run needs a new work directory sharing the same 10 GB allowance.
