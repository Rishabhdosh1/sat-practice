# SAT practice

A local SAT drill app. No auth, no backend, no deploy — a Vite dev server and a
JSON file. Built because the official interface shows you the answer before you
have committed to one.

**691 questions**, ingested from raw PDFs in `~/Downloads`.

## Run it

**As a Mac app** — already installed; launch **SAT Practice** from Spotlight or
`/Applications`. To rebuild after changing anything:

```bash
./desktop/build.sh --install
```

That re-runs ingest, rebuilds the web app, compiles the native shell, self-tests
the bundle, and installs it. It's a real `.app` — 5.5 MB, no Electron, no server,
no terminal window. A WKWebView with a custom URL scheme handler serves the
build straight out of the bundle; your history lives in the app's own
persistent store and survives rebuilds.

**In a browser** — useful for working on it, and the only way to use it from
your phone:

```bash
python3 -m ingest.run        # only needed when the sources change
cd app && npm install && npm run dev
```

http://localhost:5173. The dev server binds all interfaces, so the `Network:`
URL it prints works from a phone on the same Wi-Fi.

## What's in the dataset

| | |
|---|---:|
| Total questions | 691 |
| Reading and Writing | 691 |
| Math | 0 — see below |
| With figures | 7 |
| Official College Board answers | 538 |
| Unverified answers (Latin roots) | 153 |

By skill: Boundaries 210 · Form, Structure, and Sense 207 · Words in Context 171 ·
Transitions 21 · Command of Evidence 19 · Inferences 19 · Central Ideas and
Details 18 · Rhetorical Synthesis 12 · Text Structure and Purpose 11 ·
Cross-Text Connections 3.

### There is no Math yet, on purpose

None of the Math in `~/Downloads` is trustworthy: the 535-problem worksheet file
has **no answer key at all**, and the "GEM" reconstructions state in their own
front matter that their answers are not from an official key. Shipping those
would mean drilling against answers that might be wrong.

The fix is one export: pull **Math** from the same College Board SAT Suite
Question Bank that produced the three files already ingested, drop it in
`~/Downloads`, add the filename to `CB_EXPORTS` in `ingest/run.py`, and re-run.
It uses the identical format, so no parser changes are needed — grid-in answers,
the math domain taxonomy, KaTeX rendering and the Desmos panel are already
wired up and waiting. See [docs/SOURCES.md](docs/SOURCES.md).

## Using it

**Keyboard:** `1`–`4` pick a choice · `Enter` submit, then `Enter`/`N` for next ·
`←`/`→` to move between questions. Full screen is the green button or `⌃⌘F`.

**Layout:** filters live in a persistent sidebar on a wide window and slide in
as a sheet on a narrow one. The question column holds a fixed reading measure
and stays centred in whatever space is left, so full screen widens the margins
rather than stretching the lines. The action bar is part of the layout, not
floating over it, so it never covers the last choice.

**Filters** are faceted, like a good search UI:

- **Counts are contextual.** Every option shows how many questions you'd get if
  you picked it *given everything else already selected*, so you can't assemble
  a combination that yields nothing. Options that would yield zero are dimmed
  and disabled rather than hidden.
- **Skills are grouped under their domain**, and pick a domain and the skill list
  narrows to just that domain's. There's a search box for jumping straight to one.
- **Active filters show as removable pills** at the top, with a live
  "185 of 691 questions" count and one-tap Reset.
- **Presets**: Unseen · My mistakes · Hard only · Official only, plus
  **Drill \<skill\>** for your weakest skill once you've answered enough to have
  a weakest one.
- **Shuffle** is in the header. Worth leaving on for the Latin-roots set, whose
  answer key is badly skewed (A×94, B×56, C×3, D×0 — never D).
- **Save these N** names the current selection as a set you can filter back to
  later ("August 2026 additions").

**Dashboard** shows per-skill, per-domain and per-difficulty accuracy, weakest
first, counting only your most recent attempt per question so re-drilling
something you now know doesn't inflate the number.

**History** — every attempt, your filters, the shuffle order and the question
you were last on — lives in `localStorage` and is restored on the next launch,
so closing the app picks up where you left off rather than back at 1 / 691. The
resume is stored as a question *id*, not an index: if the filters no longer
match that question the app falls back to the start of the set rather than
landing on an unrelated question that happens to sit at the same number.

History can be exported and re-imported as JSON from the Filters panel. Import
merges rather than overwrites, de-duplicating on question id plus timestamp.

## Layout

```
ingest/          Python, stdlib + poppler only. Reads ~/Downloads read-only.
  extract.py       PDF -> geometry-corrected lines
  parse_cb.py      College Board question-bank exports
  parse_latin.py   Latin-roots markdown
  figures.py       vector-figure detection and crop-rendering
  normalize.py     schema mapping + validation
  run.py           entry point
  check.py         `python3 -m ingest.check` - 19 assertions, no deps
app/             Vite + React + Tailwind
  src/lib/filter.ts  faceted filtering + contextual counts
  public/data/     questions.json + ingest-report.json  <- ingest writes here
  public/figures/  rendered figure PNGs
desktop/         the native macOS shell
  SATPractice.swift  WKWebView + a scheme handler serving the bundled build
  makeicon.swift     draws the app icon at build time
  build.sh           ingest -> web build -> compile -> bundle -> self-test
docs/SOURCES.md  what was ingested, what was rejected, and why
```

## Ingest guarantees

- **Read-only on `~/Downloads`.** Nothing is written, moved or modified there.
- **Deterministic.** Unchanged inputs produce a byte-identical `questions.json`,
  so `git diff` is meaningful. Provenance is pinned by SHA-256 of each input;
  no wall-clock timestamp is written into the data.
- **Nothing disappears quietly.** Anything that fails to parse cleanly lands in
  `app/public/data/ingest-report.json` with its file and page.
- **Validated.** Duplicate ids, empty stems, missing or non-existent correct
  answers, odd choice counts and missing figure files all fail the run.

Currently: 691 written, 0 validation failures, 1 note (one question appears in
two exports; the copies are identical, one is kept).

## Schema

```jsonc
{
  "id": "cb:f1bfbed3",              // stable College Board id where available
  "source": { "file": "...", "page": 1, "tier": "A", "trust": "official" },
  "section": "reading_writing",
  "domain": "Information and Ideas",
  "skill": "Inferences",
  "difficulty": "hard",             // or null when the source doesn't say
  "stimulus": { "text": "...", "format": "text" },   // passage, may be null
  "stem":     { "text": "...", "format": "text" },   // the prompt
  "response_type": "mcq",           // or "grid_in"
  "choices": [{ "label": "A", "text": "...", "format": "text" }],
  "correct":  { "labels": ["B"], "values": [] },     // values[] for grid-ins
  "explanation": { "text": "...", "format": "text" },
  "figures": [{ "kind": "figure", "path": "figures/cb_x.png", "origin": "vector_render" }],
  "tags": ["export-2026-09-08"],
  "flags": [],
  "needs_review": false
}
```

`trust` is the field that keeps low-confidence content honest: `official` for
College Board answers, `unverified_answer` for the Latin-roots key. The app
badges anything non-official and can filter it out entirely.

`format` is per field, so a math stem can be `latex` while its choices stay
plain text — KaTeX only runs where it should.
