# Discovery reference set — 2026-09-07

Purpose: tune the discovery filter (`target-evidence-4`). This set says **which threads
the miner should retain**, not which Unicode mappings are correct. Extraction is a later
phase and is deliberately out of scope here.

## Method and provenance

- The 100 links in the v1 set were re-fetched through the Stack Exchange API
  (`/questions`, `/answers`, `/comments`, `/posts/{id}/revisions`) rather than trusted
  from their summaries. Every v1 URL carried a `?utm_source=chatgpt.com` parameter, so
  each question ID, title, creation date, answer set and title-revision history was
  checked independently.
- **All 100 question IDs resolve and all titles are broadly consistent with the v1
  claims.** No fabricated links. Eleven v1 summaries are wrong or overstated about
  *whose words* the description is, or about whether the target was resolved; those are
  corrected inline and listed in §2.
- The 30 negatives in §4 come from `.miner-work/candidates.sqlite` opened read-only
  (`file:…?mode=ro`), from the 100-row `accepted` sample. Every one was judged from its
  own source text and matched span, not from the filter's `status` field.
- No mining run was started, no filter code was touched, no generator test was run.

## Labels

| Label | Meaning |
|---|---|
| **KEEP** | Discovery must retain this thread. |
| **REJECT** | Discovery must drop it: nothing in it is a character-identification need. |
| **UNCERTAIN** | Genuinely on the boundary; decide deliberately, do not let a rule decide by accident. |

**Result: 94 KEEP, 6 UNCERTAIN, 0 REJECT among the 100 web threads.** That is the single
biggest correction to v1. Threads v1 called "hard negatives" (#19, #32, #37, #38) are
*extraction* negatives — no valid Unicode target exists — but they are *discovery*
positives: each is a person describing a glyph and asking what it is. A filter that drops
them loses precisely the cases that teach the system when **not** to map confidently.
Failure to resolve a character never makes the thread irrelevant.

## Archive boundary

The manifest release is `archive.org-stackexchange-uploaded-2024-04`
(`meta.contract` in `candidates.sqlite`), so the cutoff is taken as **2024-04-01**.

**Post-archive → marked `⟨SUPP⟩` (supplemental; absence is not a mining failure):**

| Item | Post | Created |
|---|---|---|
| #30 | `math:5032101` question | 2025-02-06 |
| #44 | `tex:747576` question | 2025-07-10 |
| #45 | `tex:752071` question | 2025-10-05 |
| #64 | `tex:717303` question | 2024-05-06 |
| #42 | `tex:44235` **answer 747413 as cited by v1** | 2025-07-07 |
| #57 | `tex:57943` answer 747351 (`\similarrightarrow`) | 2025-07-06 |

Per-post dates matter, not just question dates: #42's question is from 2012 and is
in-scope, but the *specific answer v1 linked to* postdates the archive. The evidence v1
actually describes (`\widecheck`, mathabx) is in answer **44251, 2012-02-12**, which is
in scope. Cite 44251, not 747413.

`⟨SUPP⟩` items are still first-class training examples. They are excluded only from
recall accounting.

### Archive-presence verification for the older 96 — INCOMPLETE, do not assume

The local work directory can only confirm presence for **5 of 100**. `routing` covers
`math.stackexchange.com` post IDs 1–168,816 and the `discover_posts` checkpoint is
`ordinal=150000, complete=0`; no TeX archive was ingested at all (`documents` and
`candidates` are both empty).

- **Confirmed present in the ingested archive slice (5):** #4 `136485`, #9 `15455`,
  #11 `68241`, #18 `81921`, #26 `94776`.
- **Not verified (95):** 35 Math threads with post IDs above the ingest ceiling, and all
  60 TeX threads. Their absence from `routing` reflects where the run stopped, **not**
  absence from the April-2024 archive. Verify against the archive itself before any of
  these is counted as a miss.

---

## 1. Corrections to the v1 summaries

Eleven v1 entries describe the thread inaccurately in a way that would mislead filter
design. The threads are all still worth keeping; the *reason* changes.

| # | v1 said | Actually |
|---|---|---|
| 29 | "⊑ described as a square version of an inclusion symbol" | **No such description exists in the thread.** The body is a verbatim quote of lecture notes; the title is the generic frame "Can someone help me identify this math symbol". Resolution is answer 4020361: "Detexify identifies it as `\sqsubseteq`". This is a *no-description* case, not a structural-similarity case. |
| 30 | "resolved as stylized β" | Contested, not resolved. Accepted answer hedges — "it **seems like** it is a stylized version of beta" — and a comment argues ζ. Keep the target unresolved. ⟨SUPP⟩ |
| 47 | "qp ligature interpreted as mirrored P merged with P. Excellent decomposition into visual primitives" | The decomposition is **answer wording** (536057), not the asker's. The asker wrote only "What is the name of this symbol and how I can write it using Latex?" over an image. Useful — but as an *answer-side* description. |
| 53 | "Fraktur N not found by Detexify" | True, but the asker gave **no description at all** ("I have tried to Detexify it to no avail. What is this symbol/font?"). "Some form of 'N' in Fraktur type" is comment wording. |
| 54 | "Clean natural geometry description mapped to a genuinely obscure Unicode character" | The asker **already has the codepoint**: "In Unicode, I can find the symbol U+2314 SECTOR". This is a Unicode→LaTeX request, not an identification. Still a valid description↔codepoint pair, but the direction is reversed. |
| 57 | "reconstructed as arrow + tilde" | Answer wording (57944: "It looks like `A \stackrel{\sim}{\to} B`"). The question is an image and one sentence. |
| 65 | "Fraktur x that looks like r … explicit human perception model" | The **asker's own title was "Name of a symbol: gothic r with a curl"** (rev. 2016-07-21). They believed it was an *r*. "Fraktur x that looks like r" is a 2018-06-26 edit by someone who already knew the answer. The naïve wording is the valuable half and it is only in the revision history. |
| 92 | "Calligraphic Z mistaken for an L" | Same artifact. **Original title: 'A calligraphic "L", as used in Abramowitz and Stegun'** (2019-01-03). The "Z (that looks like an L)" title is a 2019-01-04 post-answer edit. |
| 94 | "Fine-grained distinction among `⊙`, `⨀`, `☉`, and custom variants" | The thread enumerates none of those. It has one comment suggesting `\fisheye` and three answers building the glyph with `stackengine`/TikZ/`\ooalign`. It is a *constructed-symbol* case. |
| 3 | cites answer 777134 | 777134 is a one-line stub ("It is the indicator function."). The substantive answer is **777133** (accepted), and the explicit Unicode is in **comment 1613592**. |
| 37 | "`\lneqq` encountered where iff was intended" | Correct, but note the asker's **first** title read `\stackrel{\Leftarrow}{\neq}` (rev. 2014-06-09) — they transcribed it as a left-arrow over not-equal. Both `\lneqq` and `\Leftarrow` in the current title are later editorial guesses. Never treat a question title's LaTeX as ground truth. |

**Two further title artifacts worth encoding as tests:** #18's original title was
"Weird E letter?" — the "(sigma)" disambiguator was added by an editor; #27's title
carried `\eth` from the start.

---

## 2. Reference set — 100 web threads by failure mode

Format: `#N` **LABEL** · site:id · date · **where the evidence lives** — verbatim excerpt — reason.

### D1 — Shape analogy in the asker's own words (the core positive class)

- **#1 KEEP** · math:3097654 · 2019-02-02 · **question body** — "its like a n with a tail before it" — bare-frame title ("What is this symbol called?") carried entirely by a body simile; also supplies domain context ("something to do with eigenvectors").
- **#2 KEEP** · math:233922 · 2012-11-10 · **title** — "looks like: sideway u with a line through the middle" — orientation + stroke description; answer offers ∈ / ∋ / ε / ∉ as competing targets, so keep the target ambiguous.
- **#3 KEEP** · math:777127 · 2014-05-01 · **title**; Unicode in **comment 1613592** — title: "looks like a 1 with double vertical line"; comment: "the symbol (𝟙 in Unicode; fonts may lack it) is the blackboard bold / open face / double-struck digit one" — a comment carries the codepoint the question and accepted answer never state.
- **#4 KEEP** · math:136485 · 2012-04-24 · **title** — "looks like a lower-right corner" — shape alias for the interior product; answer 136493 supplies `\lrcorner`. *Archive-confirmed.*
- **#5 KEEP** · math:4634586 · 2023-02-07 · **title** — "It looks like the any function $f(x)$, but with a line drawn over the entire thing" — compositional overline description; resolved to "vinculum" in comment and answer.
- **#6 KEEP** · math:611464 · 2013-12-18 · **question body** — "the symbol that looks like an upside-down triangle, and coming in front of a function $f(x,y)$" — shape + position + domain, no name.
- **#7 KEEP** · math:1510877 · 2015-11-03 · **title** — "this 'L' and upside down 'L' symbol" — orientation pair; the body already contains `\lceil`/`\lfloor`, so the thread self-resolves.
- **#9 KEEP** · math:15455 · 2010-12-24 · **title + body** — "Backwards epsilon"; "a Google search for 'backwards element of' or 'backwards epsilon' turns up contradictory (or unreliable) information" — canonical transformation alias plus an explicit statement that ordinary search fails. *Archive-confirmed.*
- **#12 KEEP** · math:2098369 · 2017-01-15 · **title + body** — "What are the symbols that look like an up arrow and a down arrow?" — a human describing ∧/∨ with the wrong primitive; resolved as min/max in comments.
- **#15 KEEP** · math:1154236 · 2015-02-16 · **title**; Unicode names in **comment 2353572** — title: "the sign that looks like $\geq$ except with the bottom line being sloped"; comment: "≤ (Less-Than or Equal To) and ⩽ (Less-Than or Slanted Equal To)" — fine-grained relation variant (⩾ is U+2A7E); ground truth lives in a comment.
- **#17 KEEP** · math:249508 · 2012-12-02 · **question body** — "Like Pi, Fee and this weird E/sideways M and the triangle" — four naïve aliases in one sentence, including a misspelled letter name.
- **#18 KEEP** · math:81921 · 2011-11-14 · **question body** — "uses the weird letter E character without explaining what it is … I can't find it on Google either because I don't know what it means or its name" — states the search failure explicitly. Title's "(sigma)" is an editor's addition. *Archive-confirmed.*
- **#24 KEEP** · math:942215 · 2014-09-22 · **question body** — "It looks like an unfinished S" — resolved to final-form sigma ς with stigma explicitly ruled out in the accepted answer.
- **#27 KEEP** · math:2030912 · 2016-11-26 · **question body** — "It looks like a partial derivative but with a strike on it" — cross-character confusable (ð, U+00F0, against ∂).
- **#31 KEEP** · math:3523417 · 2020-01-26 · **question body** — "resembles a cross between $s$ and $\sigma$" — hybrid-of-two-characters description; answer: cursive lowercase s.
- **#36 KEEP** · math:2456482 · 2017-10-03 · **question body** — "there is a symbol that looks like a big U" — minimal novice description; ⋃ resolved from context.
- **#40 KEEP** · math:1397038 · 2015-08-14 · **question body** — "Like this squiggly $f$ or $s$ looking thing in this image" — the integral sign named by two wrong letters. (v1 cites answer 1397068; that answer is general advice — the descriptive evidence is entirely in the question.)
- **#41 KEEP** · tex:625119 · 2021-12-06 · **title**; codepoint in **answer 625123** — title: "something that look like a horizontal hourglass"; answer: "That's ⋈ (U+22C8), called `\bowtie` in unicode-math" — cleanest full pair in the set. **Canonical acceptance test.**
- **#56 KEEP** · tex:86076 · 2012-12-08 · **question body**; codepoint in **comment 185446** and **answer 153463** — body: "a symbol that looks like the element sign $\in$ but instead of being curved, looks more like a less than sign $<$?"; comment: "this is a relation, at unicode U+2AAA" — known-symbol-plus-modification, with the codepoint independently in a comment and an answer. **Canonical acceptance test.**
- **#59 KEEP** · tex:385242 · 2017-08-07 · **question body**; codepoint in **answer 686476** — body: "The output looks like a smaller version of the numeral 1, but with the top 'hook' horizontal rather than angled downward"; answer: "Latin Small Letter Dotless i U+0131" — perceived identity (a 1) is not the actual identity (ı).
- **#63 KEEP** · tex:485194 · 2019-04-16 · **title + body** — "Symbol: Curly T"; "I tried Detexify, but nothing." — informal alias; the accepted answer concludes **no exact match is obtainable** ("we have no proof it could ever be an electronic font (simply scanned pixels)"). Keep the target unresolved.
- **#70 KEEP** · tex:38757 · 2011-12-19 · **question body** — "I also tried Detexify, but either my drawing skills suck or such a symbol simply doesn't exist" — object-name query plus explicit negative search; resolved by TikZ construction, no codepoint.
- **#71 KEEP** · tex:215204 · 2014-12-03 · **question body** — "Imagine $\sqrt{200}$ but instead of a square root to the left and above, you have a `<` but to the left and below" — description by analogy to a *different* notation's geometry. Resolved as Steinmetz `\phase`. **Canonical acceptance test.**
- **#75 KEEP** · tex:311092 · 2016-05-23 · **title + body** — "the mathematical contradiction symbol, which is the upside-down T" — semantic name plus shape alias, both present; the shortest complete positive in the set.
- **#76 KEEP** · tex:290757 · 2016-02-02 · **title** — "Ampersand like symbol latex" — cross-character alias; answer: "it's definitely a capital S, but in cursive … it really looks like a flipped ampersand."
- **#83 KEEP** · tex:554360 · 2020-07-20 · **question body**; codepoint in **answer 554367** — body: "that looks like a t with a curl. Tried to use detexify with no luck either. I don't even know it's name"; answer: "Unicode Character 'LATIN SMALL LETTER T WITH CURL' (U+0236)" — shape alias + named tool failure + explicit codepoint. **Canonical acceptance test.**
- **#84 KEEP** · tex:127073 · 2013-08-07 · **title** — "looks like crossed equal" — primitive-overlay alias; no codepoint, built with `\ooalign`.
- **#87 KEEP** · tex:98666 · 2013-02-18 · **question body**; resolution **comment-only** — body: "The symbol look like a integral sign with a short bar in the middle"; comment 212936: "I tried Detexify and think you might mean `\fint`" — **zero answers**: the only resolution is a comment. Exercises the comment-only retention path directly.
- **#88 KEEP** · tex:378398 · 2017-07-05 · **title + body** — "A letter looks like number 3. What is it?"; "Is it a Greek letter?" — digit-shaped letter; wrong-script hypotheses in comments (Cyrillic Ze), resolved as Fraktur Z. **Canonical acceptance test.**
- **#99 KEEP** · tex:169907 · 2014-04-06 · **question body** — "I couldn't find the house symbol neither through Detexify nor by looking through the Comprehensive LaTeX Symbol List" — domain-specific name for a composite; constructed, no codepoint.
- **#100 KEEP** · tex:125012 · 2013-07-22 · **title**; resolution in **answer 125032** and **comment 280583** — title: "an 'open semicolon'"; answer: "According to Shapecatcher, this is a 'Z notation relational composition'" — wrong human name, correct structural intuition, specialist ground truth. **Canonical acceptance test.**

### D2 — Transformation language (upside-down / rotated / mirrored / flipped)

- **#8 KEEP** · math:2055881 · 2016-12-12 · **title + body** — "I want to know that the upside-down T is. (I'm not sure how to research it if I don't know its name)" — the parenthetical is the discovery problem stated in one line.
- **#42 KEEP** · tex:44235 · 2012-02-12 · **title + body** — "Is there a way to do an 'upside down' `\widehat`?"; "I just want it to be (vertically) flipped!" — transformation of a *named* command. Cite answer **44251** (2012), not the post-archive 747413.
- **#48 KEEP** · tex:481134 · 2019-03-23 · **question body** — "this rotated, filled in, black square symbol" — three stacked modifiers over a known primitive; comments list six candidate commands.
- **#68 KEEP** · tex:3495 · 2010-09-26 · **question body** — "a symbol that looks like a slightly smaller version of a 90 degrees rotated `\Bowtie`" — rotation + scale over a named command.
- **#73 KEEP** · tex:479681 · 2019-03-15 · **title + body** — "a square version of the integral sign … Note that this symbol is not found by Detexify" — geometric transformation of a known symbol.
- **#78 KEEP** · tex:303040 · 2016-04-07 · **title + body** — "can not seem to find an upside-down letter $\pi$. Is there a package … or should one create such a symbol manually?" — the asker is unsure the target exists at all; answer constructs it with `\rotatebox`. **No Unicode target — keep anyway.**
- **#79 KEEP** · tex:457547 · 2018-10-30 · **title** — "How can I write upside down real numbers symbol ($\mathbb{R}$)?" — a comment then disputes what "upside down" means ("reflected about a horizontal axis" vs "rotated by 180 degrees"), which is useful ambiguity.
- **#89 KEEP** · tex:583960 · 2021-02-18 · **title + body** — "Blackboard bold like symbols for the number 'one' 1 and its mirror shape"; "My attempt to use detexify to find the symbols were unsuccessful. `\mathbb{1}` does not produce the right symbol." — transformation + font style + a named failed candidate.

### D3 — Compositional description (X inside Y, X with Y attached, base + mark)

- **#10 KEEP** · math:2304605 · 2017-05-31 · **title** — "white circle connected with black bullet; both are linked by a horizontal line" — three components and their spatial relation; resolved to `\multimapdotbothA`.
- **#11 KEEP** · math:68241 · 2011-09-28 · **question body** — "is the symbol a squiggly line over an equals sign? What is the symbol with a squiggly line over just one horizontal line?" — two compositional descriptions distinguishing ≅ from ∼/≃. *Archive-confirmed.*
- **#16 KEEP** · math:2755998 · 2018-04-27 · **title + body** — "It's a square with a cross inside" — clean primitives, but the answer shows the operator is **defined ad hoc in the source paper** ("It signifies whatever you say it signifies"). Discovery target with no Unicode identity.
- **#49 KEEP** · tex:508737 · 2019-09-17 · **question body** — "It's a # inside a circle. Is this symbol available in LaTex? if not, how can I draw it" — containment description; the asker pre-empts non-existence. Constructed, no codepoint.
- **#58 KEEP** · tex:78598 · 2012-10-21 · **title + body** — "a large plus sign with arrowheads on each tip"; "I falsely assumed that I could simply overlap `$\updownarrow$` and `$\leftrightarrow$`" — a failed decomposition attempt stated by the asker.
- **#60 KEEP** · tex:179680 · 2014-05-22 · **question body** — "the symbol looks like of shape 'V' together with a vertical bar aside (at the left or right side of the shape 'V')" — component + placement, with the placement left open.
- **#67 KEEP** · tex:505648 · 2019-08-25 · **title** — "vee with double line left"; body: "Detexify did'nt find it." — three-token structural description.
- **#69 KEEP** · tex:4573 · 2010-10-26 · **question body**; codepoint in **answer 4574** — body: "something that looks like `\rightarrow` with `\sim` under it. … I couldn't find the symbol using Detexify, nor in the comprehensive list of LaTeX symbols"; answer: "Unicode defines ⥴ (U+2974 RIGHTWARDS ARROW ABOVE TILDE OPERATOR)" — note the offered codepoint says *above* where the asker said *under*: a genuine mismatch worth preserving.
- **#72 KEEP** · tex:388103 · 2017-08-25 · **title + body** — "it's common to place a dot inside of the sideways V"; "I tried drawing this in Detexify, but I had no luck." — composition over a named relation (`\preceq`).
- **#74 KEEP** · tex:541064 · 2020-04-28 · **question body** — "how can I write the symbol t̬, a 't' with an upside down '^' under it?" — exact base + combining-mark decomposition (U+0074 + U+032C COMBINING CARON BELOW). **Canonical for combining sequences.**
- **#77 KEEP** · tex:531991 · 2020-03-10 · **title + body** — "denote vectors using a squiggly line beneath them" — positional accent described, not named.
- **#94 KEEP** · tex:587983 · 2021-03-18 · **title + body** — "I am looking for this symbol which I haven't found online (especially with a large dot inside the circle)" — the size qualifier is what makes it not `\odot`; all answers construct it.
- **#96 KEEP** · tex:561957 · 2020-09-09 · **title + body** — "a triangle with a centered dot inside it", "a triangle with a circle inside it", "a downtriangle with a centered dot inside it" — a family of four described by composition; one resolves (`\trianglecdot`), three do not.

### D4 — Explicit confusable candidate list supplied by the asker

- **#23 KEEP** · math:299841 · 2013-02-11 · **question body** — "It looks like a lower-case epsilon, but the Wikipedia page on epsilon states that they are not the same" — asker names the confusable *and* the disconfirming evidence.
- **#28 KEEP** · math:948271 · 2014-09-27 · **question body** — "it reminds me of how you would use the summation symbol ∑, but it also kind of looks like pi (π)" — two named candidates for ∏.
- **#33 KEEP** · math:1698265 · 2016-03-15 · **question body** — "It looks like a squiggly E (`\mathcal{E}`) or perhaps it is the Greek letter xi (ξ). But I am not sure." — candidate list with commands; comment 3465950 states the discovery problem exactly: "the OP already knows the meaning (the universal set), but wants to know which character it is."
- **#50 KEEP** · tex:283122 · 2015-12-15 · **question body** — "Is this `\varrho` or just the @ symbol? How do I pronounce it?" — two wildly different candidates, resolved as calligraphic C.
- **#55 KEEP** · tex:674080 · 2023-02-05 · **question body** — "It looks like a greek epsilon, ε, but it is upper case. To me, it looks like a `\mathcal{E}`, but I'm not sure as it is in text." — cross-domain confusable; the accepted answer moves it to IPA (`\textepsilon`), and a comment disputes the case. Keep contested.
- **#90 KEEP** · tex:516200 · 2019-11-13 · **title + body** — "this symbol that looks like E or L"; body lists `\mathscr{L}`, `\mathcal{L}`, `\mathcal{E}`, `\mathscr{E}` — "none of them renders that symbol." — an explicit four-candidate ruled-out set.
- **#95 KEEP** · tex:529855 · 2020-02-24 · **question body**; codepoints in **answer 529935** — body: "The only things that look close are `\mathscr{L}` and `\mathcal{L}`"; answer: "Laplace transform is in the Letterlike block (at U+2112) and the bold script capital L version is in the Mathematical Alphanumeric Symbols block (at U+1D4DB)" — semantics known, glyph unknown, two codepoints given.

### D5 — Font/alphabet identity obscured (Fraktur, script, blackboard, calligraphic)

- **#13 KEEP** · math:304030 · 2013-02-14 · **title + body** — "this symbol that looks like a capital $\mathbb{E}$ (with double vertical lines), which I am not familiar with, and I have no idea what to search for" — font style described as a stroke feature.
- **#20 KEEP** · math:2056943 · 2016-12-13 · **title + body** — "What is the symbol that looks like a capital f, F, which is used to prove the martingale" — letter identity plus domain; comment: "It's a capital $F$ in a calligraphic font."
- **#43 KEEP** · tex:550505 · 2020-06-22 · **title + body** — "(looks like a T or J)"; "It's not `\mathcal{TJ}` … or `\mathscr{TJ}`. I'm guessing it's a T from context in the textbook." — two-letter ambiguity, ruled-out candidates, and context-based reasoning in the asker's own words.
- **#44 KEEP ⟨SUPP⟩** · tex:747576 · 2025-07-10 · **title** — "I can't find this symbol (looks like a T)"; accepted answer 747582 is a quotable correction: "It doesn't 'look like a T', it is a T in a Fraktur typeface."
- **#45 KEEP ⟨SUPP⟩** · tex:752071 · 2025-10-05 · **title** — "I can't find this symbol looks like $s^\tilde$" — the asker approximates a Fraktur capital I as an s with a tilde; identification is comment-only ("Fraktur capital I", "`\mathfrak{I}` (amsfonts package)").
- **#52 KEEP** · tex:234752 · 2015-03-24 · **question body** — "It is used as font for alphabetic letter S, in my text. I did check almost all fonts and symbols but couldn't succeed in finding a good match." — letter known, variant unknown; the target is a math-alphanumeric codepoint, so the pair is real.
- **#61 KEEP** · tex:369013 · 2017-05-10 · **question body**, sharpened in the **asker's comment 910936** — body: "it looks like a big Delta but different"; comment: "the above image look likes very near to a right triangle (but not exactly)" — the usable description is only in a follow-up comment by the asker.
- **#64 KEEP ⟨SUPP⟩** · tex:717303 · 2024-05-06 · **title + body** — "Perhaps this character is the amalgamation of other two, or something like that. I tried the usual tools to determine LaTeX symbols, with no success."
- **#65 KEEP** · tex:320403 · 2016-07-21 · **original title (revision 2016-07-21)** — "Name of a symbol: gothic r with a curl" — see §1. The asker's belief that it was an *r* is only recoverable from revision history; the current title encodes the answer.
- **#85 KEEP** · tex:402592 · 2017-11-22 · **question body** — "it is something like a $\mathbb{e}$, except that using $\mathbb{e}$ would not produce output at all" — the asker names a command and reports it fails.
- **#86 KEEP** · tex:582320 · 2021-02-07 · **title + body** — "a serif-style real number set symbol … This is not possible using $\mathbb{R}^n$" — semantics fully known, glyph variant unknown.
- **#91 KEEP** · tex:32005 · 2011-10-19 · **question body** — "The lector uses a special E as the sample space and I can't find it in LaTeX"; asker's comment: "detexify does not know it … the lector also said that some symbols he used are very uncommon even in literature (All his slides are hand written)" — handwriting source, semantic name known.
- **#92 KEEP** · tex:468409 · 2019-01-03 · **original title (revision 2019-01-03)** — 'A calligraphic "L", as used in Abramowitz and Stegun' — see §1. Body records an unusually complete negative search: "I have searched using Google, with the search string 'latex fancy L' and also used 'Detexify' on a mobile phone but did not find anything useful."
- **#93 KEEP** · tex:470766 · 2019-01-18 · **title + body**; resolution in **comments** — "Most likely it is the letter 'a' in some font I'm not familiar with"; comment 1186163: "You find it in the MathTime Pro 2 Curly script, commercial." — the accepted answer (470814, 2019-01-19, in-archive) never names the font; the comments do.

### D6 — ASCII / typed approximation of an unknown glyph

- **#22 KEEP** · math:4690108 · 2023-05-01 · **question body** — "a symbol similar to this ' $\Large ᚃ$ ' meaning 'such that'" — the asker typed **U+1683 OGHAM LETTER FEARN** as a visual stand-in. **Zero answers**: retain with an unresolved target. Directly exercises "a literal glyph fills the slot" where the glyph is not the target.
- **#25 KEEP** · math:4653678 · 2023-03-07 · **title + body** — title: "(looks like ><)"; body: "a symbol … that looks like this $^{>}{}_<$" — two different ASCII approximations of the same glyph in one post; the answer confirms the notation is nonstandard.
- **#82 KEEP** · tex:369639 · 2017-05-14 · **title + body** — "How to get a symbol looks like >---<"; "It is like `\leftrightarrow` but `\leftrightarrow` is <--->." — an ASCII rendering contrasted against the ASCII rendering of a known command. **Canonical acceptance test.**

### D7 — No textual description: image + context only (`needs_image`)

Retention here must rest on the request frame plus writing context, never on a description.

- **#26 KEEP** · math:94776 · 2011-12-28 · **question body**; codepoint in **answer 94783** — body: "I encountered this symbol in an old Adobe mathematical character set … it's difficult to describe it for the purposes of a Google search"; answer: "This looks like U+03D0 GREEK BETA SYMBOL" — the asker states the description is impossible; deterministic codepoint in the answer. *Archive-confirmed.*
- **#29 KEEP** · math:4020261 · 2021-02-10 · **title**; resolution in **answer 4020361** — title frame: "Can someone help me identify this math symbol and its meaning?"; answer: "Detexify identifies it as `\sqsubseteq`" — see §1 correction.
- **#30 KEEP ⟨SUPP⟩** · math:5032101 · 2025-02-06 · **question body** — "is next to other Greek letters, but I can't find a Greek letter that matches it. The article was published in 1813 so it could be formatting that changed over time" — historical-typography context; target contested (β vs ζ).
- **#35 KEEP** · math:1392375 · 2015-08-10 · **question body** — "I hate when I come across symbols I can't recognise or describe because it's nigh-on impossible to google for them" — the clearest statement of the product's use case anywhere in the set; resolved as Ξ in Z notation.
- **#46 KEEP** · tex:187625 · 2014-07-02 · **question body**; codepoint in **comment 434491** — body: "This symbol is used just as if it is a casual letter like x or y"; comment: "i'm much more accustomed to the shape shown in the unicode charts at U+1D552" — usage-role context substitutes for shape description; a comment carries the codepoint.
- **#47 KEEP** · tex:536052 · 2020-03-30 · **title only**; description in **answer 536057**, codepoint in **answer 536061** — answer: "this looks exactly like a mirrored P merged with a normal P"; "The Unicode of this symbol (in lowercase form) is U+0239" — see §1.
- **#51 KEEP** · tex:435083 · 2018-06-05 · **question body** (semantics) + **comment 1090877** (shape) — body: "which is used to denote sample space in probability theory, according to one textbook"; comment: "Calligraphic or script captial E" — semantics in the question, shape in a comment.
- **#53 KEEP** · tex:252835 · 2015-06-29 · **title + body**; identification in **comment 603513** — body: "I have tried to Detexify it to no avail. What is this symbol/font?"; comment: "It's some form of 'N' in Fraktur type" — see §1.
- **#57 KEEP** · tex:57943 · 2012-05-31 · **question body**; reconstruction in **answer 57944** — body: "Does anyone know how to typeset the arrow in the photo below? It is in Algebra: Chapter 0 by Paolo Aluffi, but I cannot find it anywhere." — see §1. A second answer (747351) is ⟨SUPP⟩.
- **#62 KEEP** · tex:201000 · 2014-09-13 · **question body**; codepoints in **answer 201004** — body: "I could not find the yellow marked symbols with Detexify, nor in the Comprehensive LaTeX symbols list. Are these symbols even supported by latex?"; answer links `unicode/char/1d535` and `1d536` — resolution depends on a footnote in the source ("Wir verwenden deutsche Buchstaben").
- **#66 KEEP** · tex:406225 · 2017-12-14 · **title + body**; description in the **asker's comment 1012853** — body: "Is it possible to produce this symbol? I tried Detexify, but nothing."; asker's comment: "Represents a topology. I always call it ''T''." — both the semantics and the letter identity arrive only in a comment by the asker.

### D8 — Corrupted rendering / typesetting error: no valid Unicode target

**These are the v1 "hard negatives". They are discovery KEEPs.** The thread is exactly a
person describing a glyph and asking what it is; the answer is that the glyph is an
artifact. Dropping them removes the only training signal for "do not map this."

- **#19 KEEP** · math:1944716 · 2016-09-28 · **title + body**; resolution in **answer 1944737** — body: "I saw this symbol that looks like the Sputnik probe and I have no idea what it is"; answer: "I think it is a typesetting problem with the parentheses." — extreme analogy language, and the target does not exist.
- **#32 KEEP** · math:3500527 · 2020-01-07 · **question body**; resolution in **comment 7199211** and **answer 3500542** — body: "It looks like a capital, standard letter 'H' without serifs"; comment: "My pdf-viewer shows $\bullet \bullet$ instead of $H$. So perhaps $H$ is not intended. In fact, $\%$ is intended. So its a font problem." — a font-substitution failure diagnosed by comparing viewers. The intended character is `%`.
- **#37 KEEP** · math:827841 · 2014-06-09 · **question body**; resolution in **answer 839540** — asker's comment 1709201: "This symbol here is literally a minus than with a not equal to underneath"; answer by the book's author: "author here. It's a typesetting error. It's supposed to be the if-and-only-if symbol, which looks like <=>." — ground truth from the source's author. See §1 on the title's unreliable LaTeX.
- **#38 KEEP** · math:2358917 · 2017-07-14 · **question body**; resolution in **answer 2358926** — answer: "it looks like something went wrong with the font in that paper. I guess many occurrences of $\iff$ should be $-$" — diagnosed by internal inconsistency between a paper's abstract and body.

### D9 — Custom/constructed symbol: no Unicode target exists

Also KEEP. The description is real; only the mapping is absent.

Covered above and cross-listed here: **#16, #22, #49, #58, #60, #63, #67, #70, #72, #78, #84, #94, #96, #99**. Common shape: a well-formed visual description, a stated Detexify/symbol-list failure, and answers that build the glyph with `\ooalign`, `\rotatebox`, `stackengine`, `pict2e` or TikZ.

### D10 — Known Unicode, LaTeX asked (reverse direction)

The asker supplies the codepoint. Still yields a description↔codepoint pair, but must not
be counted as an identification example.

- **#54 KEEP** · tex:310384 · 2016-05-19 · **title + body** — "In Unicode, I can find the symbol U+2314 SECTOR … Is there something similar in LaTeX?" — title supplies the description ("looks like a sector ⌔ of a circle"), body supplies the codepoint.
- **#97 KEEP** · tex:159669 · 2014-02-10 · **title + body** — "including a triangle with an exclamation point (unicode #9888: ⚠)"; "I am also requiring that the answer be an actual character, or at least not done using graphics" — self-labelled pair (U+26A0) plus an explicit character-vs-graphic constraint.
- **#98 KEEP** · tex:565305 · 2020-10-04 · **title + body** — "a symbol which looks like the unicode lower right triangle U+25FF but with the same size and line thickness as the `\qed` symbol" — codepoint given, a *variant* requested.

### D11 — Boundary: glyph already known, semantics or history asked

These are the six UNCERTAINs. All six pass the v4 request-frame rule with a filled slot,
so the filter will admit them by construction — that has to be a decision, not an
accident. None yields a description→character pair.

- **#14 UNCERTAIN** · math:1942419 · 2016-09-26 · **title + body** — "What does the centre dot notation mean? $P(\cdot)$"; "If I were to read what it looks like, I would say: probability as a function of dot." — the asker names the glyph correctly and types it; the question is what the placeholder convention means. Tests: naming-by-appearance where nothing is unidentified.
- **#21 UNCERTAIN** · math:297378 · 2013-02-07 · **question body** — "they pronounce it as x not or x nod, I am not sure what the exact name is because they have thick accents" — a *phonetic* recall query about $x_0$, which the asker can already typeset. Tests: remembered-name queries with no visual component.
- **#34 UNCERTAIN** · math:1463111 · 2015-10-03 · **question body** — "I somehow made it to grad school without coming across this symbol"; the notation is typed out as a LaTeX `array`. Resolved as the Wigner 3j symbol. Tests: composite bracketed *notation* with no single-character target.
- **#39 UNCERTAIN** · math:1562724 · 2015-12-06 · **title** — "What does this ∩ symbol mean in terms of geometry" — the character is pasted; no description; the real content is whether `(AB || CD) ∩ CK` parses at all. Tests: literal-glyph-in-title, semantics-only.
- **#80 UNCERTAIN** · tex:63781 · 2012-07-18 · **title + body** — "How do I write not equal to sign (equivalent of != in C) in Latex pseudocode" — target named semantically and by a programming operator, never described visually. A later answer adds "Unicode also has the symbol ⍯ from APL. It's U+236F." Tests: cross-domain semantic alias with no shape query.
- **#81 UNCERTAIN** · tex:268419 · 2015-09-19 · **title + body**; correction in **answer 268420** — body: "I've very often come across a cross (no pun intended; I mean this: † )"; answer: "It is not a cross, it is a dagger." — the character is typed and the question is typographic history. There *is* a name-correction pair ("a cross" → dagger), which is why this is not a clean REJECT. This is also the exact shape of the `punctuation_context` failure that got `english.stackexchange.com` removed — decide it explicitly.

---

## 3. Thirty irrelevant near misses (all REJECT)

Source: `.miner-work/candidates.sqlite`, `accepted` table (100-row sample), opened
read-only. Every row below was **accepted by `target-evidence-4`**. Each was judged from
its own body text and the exact span the filter matched; the stored `status` was ignored.
`post` is the Stack Exchange post ID (`math.stackexchange.com/q/<id>` for questions,
`/a/<id>` for answers).

### N-A — `latex_symbol` fires on ordinary running mathematics (8)

The command is *used*, never *discussed*. This is the 2.9-million-hit failure mode the
v4 notes describe, still firing on this sample: `latex_symbol` accounts for 68 of the
sample's signals.

| # | post | matched | The text around it |
|---|---|---|---|
| N-A1 | `a/3643` | `\hline` | Umbral-calculus answer; the match is a rule inside the `\begin{array}` preamble of a table of derivative formulas. `status=identity_evidence`, and there is no identity evidence at all. |
| N-A2 | `q/5052` "Legendre functions in number theory" | `\newline` | "…$s$ d\theta \newline =&\frac{1}{\pi}\int_0^1…" — a line break inside `eqnarray*`. |
| N-A3 | `a/8355` | `\lambda` | "for most $\lambda\in{\mathbb C}$ this dimension is $0$, which means $E_\lambda=\{{\bf 0}\}$" — λ as a bound eigenvalue variable. |
| N-A4 | `a/57848` | `\xi` ×2 | "A point $\xi$ is called an *accumulation point of the sequence*" — `called` sits next to ξ, but what is named is the *point*, not the glyph. Nearest miss in this group. |
| N-A5 | `q/98263` "Derivations and separability of field extensions" | `\delta` ×2 | "$\delta$ is called an $F$-derivation" — same trap: `called` names the map. |
| N-A6 | `a/121351` | `\quad`, `\implies` | Spacing and a relation inside a displayed chain of inequalities. |
| N-A7 | `a/163409` | `\le` | "$x_{i-1} \le t_i \le x_i$" — a relation in a partition definition. |
| N-A8 | `a/166432` | `\lambda` | "the simply-typed $\lambda$-calculus" — λ inside a compound term name. |

### N-B — `latex_symbol` fires on table and layout formatting (5)

`\hline` is never a glyph subject. Five of 100 sampled acceptances rest on it alone.

| # | post | The text around it |
|---|---|---|
| N-B1 | `q/48161` "In classical logic, why is $(p\Rightarrow q)$ True if both $p$ and $q$ are False?" | Rules of a truth table. The question is about material implication. |
| N-B2 | `q/61262` "Financial Calculator HP 10bII - Standard Deviation with Probability" | Rule in a two-column probability/score table. |
| N-B3 | `a/62046` | Rule under a long-division layout, `$$\begin{array} & & & 0 & . & 2 …`. |
| N-B4 | `q/83844` "Simplex method : Duality by Bazaraa" | Rules in a primal/dual conversion table. |
| N-B5 | `a/164970` | Rules ×3 around a table of primes of the form $3^n-2^n$. |

### N-C — "space" vocabulary (2)

| # | post | matched | Why it is wrong |
|---|---|---|---|
| N-C1 | `q/26318` "Riemann Sphere and a Strange Vector Space Definition" | `invisible_character` on **Title**: `'Strange Vector Space'` | The rule intended for whitespace/invisible characters matched the word **"Space"** in a linear-algebra title. Pure vocabulary collision. |
| N-C2 | `a/140756` | `character_description`=`'called'` + `description_subject`=`'space'` | "a type of topological space called a quotient space" — `<subject> called <name>` is a perfect structural match and the subject is a *mathematical* space, not a whitespace character. |

### N-D — `\colon` renders as the word "colon" (4)

The same punctuation-vocabulary collision that removed `english.stackexchange.com` is
alive inside TeX source on Math.

| # | post | matched | The text |
|---|---|---|---|
| N-D1 | `q/5084` "Orthogonal Vectors" | `'how can'` + `'colon'` | "$\{y_1,\ldots,y_m\colon m\leq n\}$" — Gram–Schmidt question. |
| N-D2 | `q/34087` "Question on Functional analysis" | `'How can'` + `'colon'` | "an 1-1 isometric map $\phi\colon Y^*\to X^*$". |
| N-D3 | `q/63873` "Name of principal root function modified to return real values if possible" | `'name for'` + `'colon'` | "Is there a concise name for the **function** $f_n(x)\colon\mathbb{C}\to\mathbb{C}$" — a naming request whose subject is a function. Hardest miss in this group: the frame is genuinely a naming frame. |
| N-D4 | `a/165069` | `'colon'` ×3 | "a multilinear map $T\colon V^r \times (V^*)^s \to \mathbb{R}$" — three map-type declarations. |

### N-E — Request frame + deictic slot means "write this argument" (7)

`how to write <deictic>` is overwhelmingly about prose, notation-choice or proof-writing.
The v4 rule admits a deictic under a typing frame "which implies a written character by
construction" — on Math it does not.

| # | post | matched | The text |
|---|---|---|---|
| N-E1 | `q/18694` "Sums and products of bounded functions" | `'how to write '` + `'this'` | "cant figure out how to write this in the proper format/wording" — asking how to *phrase a proof*. |
| N-E2 | `a/42971` | `'how to write '` + `'it.'` | "understood by people in prehistory who didn't even understand how to write it" — about the numeral zero, historically. |
| N-E3 | `q/45583` "Want to understand a set notation" | `'How do you write '` + `'it'` | "Perhaps I could better understand it in symbolic logic. How do you write it in symbolic logic?" — a translation request, not a glyph request. |
| N-E4 | `q/90999` "How can we write this $\mathbb{Q}[x]$-module as a direct sum of cyclic modules?" | frame + slot both in **Title** | Title-level match; the slot is a module. |
| N-E5 | `a/98178` | `'how to write '` + `'it'` | "the useful and clear way how to write it down. I was taught to always make a table like this" — proof presentation, and it also carries `\hline`. |
| N-E6 | `q/131837` "Convex hull of unions" | `'how to write '` + `'it'` | "I have convinced myself (intuitively) that this equality holds, but I do not know how to write it formally down." |
| N-E7 | `q/163544` "Given a subset $S \subset \mathbb{R}$, show that $S'\subset \overline{S}$" | `'How could I write '` + `'it?'` | "I know it, it's quite obvi[ous]…" — asking for proof-writing help. |

### N-F — Shape/description vocabulary about things that are not glyphs (4)

| # | post | matched | The text |
|---|---|---|---|
| N-F1 | `q/9876` | `'denote'` + `'tilde'` | "and denote $\tilde x$ and $\tilde \gamma$ the maximizers" — the binding-verb variable introduction the v4 notes already exclude for `latex_subject`, still admitted through `character_description`. |
| N-F2 | `a/19860` | `'arrow'` + `'represents'` | "Let him explain why every arrow represents the probability $\frac{1}{2}$" — arrows in a coin-flip tree diagram. |
| N-F3 | `a/63460` | `character_shape`=`'looks like a'` | "So phase change looks like a \"triangle wave\"." — `looks like a` describing a *waveform*. The single most direct counterexample to shape-phrase matching. |
| N-F4 | `q/140985` "Finding where the slope of tangent line is = 1" | `character_shape`=`'looks like x'` | "just looking at the function it looks like x=1 would make it zero" — `looks like` followed by an equation. |

### What the negatives imply for the filter

1. `latex_symbol` alone is never sufficient evidence (13 of these 30). The v4 note already
   says a command must be a *subject*; this sample shows the rule still admitting
   `\hline`, `\newline`, `\quad` and bound variables. A layout/spacing denylist
   (`\hline`, `\newline`, `\quad`, `\qquad`, `\left`, `\right`, `\vdots`) is a cheap
   first cut, but N-A4/N-A5 show the real problem: `X is called Y` matches whenever `X` is
   any mathematical object, not just a glyph.
2. Subject typing matters more than vocabulary. `called`, `denote`, `represents`,
   `name for` and `looks like` all fire correctly on the *phrase* and wrongly on the
   *subject* (a space, a map, a maximizer, a waveform, an equation). The slot needs a type
   test — glyph, command, or image reference — not a keyword.
3. Deictic slots (`this`, `it`, `it.`) should not qualify on Math without an image or a
   literal glyph in the same post. Seven of 30.
4. `colon` and `space` reach the vocabulary through LaTeX source and ordinary
   mathematical English respectively. The same class of collision that justified dropping
   `english.stackexchange.com`.

---

## 4. Accepted-sample rows I could **not** call irrelevant

Flagged separately so a tightening pass does not sweep them out as collateral. All are
`what does <glyph> mean` questions where the glyph is standard and typed — the same
boundary as web items #14/#39/#80 in D11. Label them deliberately.

| post | title / text | Why it is not a clean reject |
|---|---|---|
| `q/104792` | "What do [] mean and what does it mean if it is used in an equation?" | Body: "What do the square bracket symbols mean? Are they what I hear are 'sets'?" Frame + glyph + `symbols`, from someone who does not know the character's role. |
| `q/112075` | "How to interpret square brackets and valuations in propositional logic?" | "What do the square brackets mean in logic? I suppose they are not matrices nor intervals." — explicit candidate elimination. |
| `q/129460` | "What does ! mean in sequences?" | "there is an exclamation mark on the denominator … What does the exclamation mark mean" — names the glyph by its typographic name, not its function. |
| `q/141982` | "What does the degree symbol in $K_n \subset K_{n+1}^{\circ}$ mean?" | Asker calls `\circ` "the degree symbol" — a genuine wrong-name-for-a-glyph pair. |
| `q/49079` | "What does the notation $\binom{n}{i}$ mean?" | "What do the parentheses next to the summation … mean?" — describes the glyph by position. |
| `a/117001` | counting measure | "$\#$" discussed as a symbol whose meaning is being pinned down. |
| `a/121904` | "The percent sign $\%$ denotes modulo operation" | An explicit glyph→meaning statement, incidental to the answer. |
| `a/26610` | "you can use the $\LaTeX$ code `\cdot` to produce the multiplication symbol" | A real command→glyph typing instruction, but nobody was trying to identify anything. |

---

## 5. Flags — inaccessible or ambiguous evidence

Stated rather than filled in.

1. **Archive presence is verified for 5 of 100.** See the archive section. The other 95
   are *expected* in the April-2024 archive on date grounds only. The local run stopped at
   Math post 168,816 with `complete=0` and ingested no TeX archive, so its silence is not
   evidence of absence.
2. **No image was inspected.** Every judgement is from thread text. For the D7 group
   (#26, #29, #30, #35, #46, #47, #51, #53, #57, #62, #66) and for #12, #20, #24, #31,
   #32, #33, #34, #41, #43, #44, #45, #48, #49, #52, #55, #61, #63, #64, #65, #67, #70,
   #72, #73, #76, #82, #83, #84, #85, #86, #88, #90, #91, #92, #93, #94, #95, #99, #100
   the glyph itself was never rendered or compared. Any Unicode target quoted here is
   quoted **from the thread**, never inferred from an image.
3. **Targets left unresolved on purpose.** #2 (∈/∋/ε/∉ all offered), #16 (operator defined
   ad hoc in the source paper), #22 (zero answers), #30 (β vs ζ disputed), #34 (composite
   notation), #55 (case disputed in comments), #63 (accepted answer says no exact match
   exists), #69 (offered codepoint says *above tilde*, asker said *under*), #79 ("upside
   down" disputed in comments), #87 (zero answers; comment-only), #96 (three of four
   variants unresolved).
4. **Post-hoc titles.** #65, #92, #18, #37 have titles that encode the answer rather than
   the asker's perception. Any evaluation that reads titles must read revisions too — the
   naïve wording in #65 and #92 exists *only* in revision history, and #37's title LaTeX
   was guessed twice and changed twice.
5. **v1 answer citations to re-point.** #42 → use answer 44251, not 747413 (post-archive);
   #3 → use answer 777133 and comment 1613592, not the 777134 stub.
6. **Calibration hygiene.** These 100 threads plus the 30 negatives are annotation and
   design material. They must not be reused as a held-out benchmark, and neither may the
   24 cases in `test/miner/fixtures/pilot-v2.json`. Duplicate-connected groups and
   revision families for these IDs need excluding from any future held-out split.
7. **Provisional.** Every label here is model-assisted review and needs human approval
   before it gates anything. No precision or recall figure is claimed or implied.

## 6. Suggested acceptance tests

Highest-value first, all in-archive by date:

| Must retain | Why |
|---|---|
| #41 `tex:625119` | Shape analogy in title + explicit codepoint (U+22C8) in answer. |
| #83 `tex:554360` | Shape alias + named tool failure + U+0236 in answer. |
| #56 `tex:86076` | Known symbol + modification; U+2AAA independently in a comment and an answer. |
| #71 `tex:215204` | Description by analogy to a different notation's geometry; no vocabulary hit. |
| #82 `tex:369639` | Pure ASCII approximation contrasted with a command's ASCII form. |
| #88 `tex:378398` | Letter described as a digit. |
| #100 `tex:125012` | Wrong human name, correct structural intuition, specialist ground truth. |
| #87 `tex:98666` | Zero answers; resolution exists only in a comment. |
| #22 `math:4690108` | Literal glyph (U+1683) used as a *stand-in*, not as the target; zero answers. |
| #37 `math:827841` | Corrupted glyph; ground truth from the source's author. Must be retained, must not be mapped. |
| #32 `math:3500527` | Font-substitution artifact; intended character is `%`. |
| #65 `tex:320403` | Naïve wording recoverable only from revision history. |

| Must reject | Why |
|---|---|
| N-C1 `q/26318` | "Vector **Space**" in a title must not match an invisible-character rule. |
| N-F3 `a/63460` | "looks like a \"triangle wave\"" must not match a shape rule. |
| N-B1 `q/48161` | `\hline` in a truth table is not identity evidence. |
| N-E6 `q/131837` | "I do not know how to write it formally down" is proof-writing. |
| N-D3 `q/63873` | "name for the function $f_n(x)\colon…$" — naming frame, wrong subject type. |
| N-A5 `q/98263` | "$\delta$ is called an $F$-derivation" — `is called` naming a map, not a glyph. |
