# Source survey — `~/Downloads`

A full sweep of 322 entries. There is no JSON, CSV or database anywhere; every
question source is a PDF plus one Markdown file. Sources are graded by whether
their answers can be trusted and whether the text is machine-readable.

## Ingested

| File | Questions | Tier | Trust |
|---|---:|---|---|
| `questionbank-export-2026-7-13.pdf` | 379 | A | official |
| `English 150 questions.pdf` | 150 | A | official |
| `questionbank-export-2026-9-8.pdf` | 10 | A | official |
| `latin-roots-sat-question-bank.md` | 153 | B | unverified_answer |
| **Total after dedup** | **691** | | |

### Tier A — College Board Question Bank exports

Three files share one export format, despite the misleading name on the middle
one. Each question carries a stable 8-hex-character College Board question ID,
Assessment / Test / Domain / Skill / Difficulty, stem, four labelled choices,
`Correct Answer:` and a full rationale explaining every distractor.

All 539 are Reading and Writing. **There is no Math in any of them.**

`cb:2903668a` appears in both the 9-8 export and English 150. The two copies are
byte-identical; one is kept and the duplication is recorded in the report.

### Tier B — `latin-roots-sat-question-bank.md`

153 Words-in-Context questions in clean Markdown, in ten sets by root family,
with an answer key giving the answer letter, the word, the root that explains
it, and the trap distractor. The parser cross-checks the key's letter against
its word and all 153 agree.

Two caveats, both surfaced in the app rather than silently accepted:

* **No difficulty labels.** Left `null` rather than invented.
* **The answer key is badly skewed: A×94, B×56, C×3, D×0.** Verified against the
  raw file — this is a property of the source, not a parse artifact. Nothing is
  ever the D choice. Shuffle should stay on for this set, or the position
  becomes a giveaway.

## Deliberately excluded

| File(s) | Why |
|---|---|
| `All_Official_Test_Problems_NUMBERED (1).pdf` | 535 math problems, **no answer key anywhere in the file**. Unusable for self-grading. Math notation also double-encoded by Word's math font (`26𝜋𝜋`, `𝑓𝑓(𝑥𝑥)`) and fractions broken across lines. |
| `FULL US GEM.pdf`, `SATMATHGEM.pdf`, `GEMONLY.pdf`, `randommodd.pdf` | ~167 items, AI-reconstructed from session logs. Their own front matter states answers "are **not** from an official answer key" and figures were "redrawn from the accessibility descriptions". They also contain numeric variants of each other (`t = 12s + 13` vs `t = 12s + 18`), so exact-match dedup will not catch the overlap. |
| `AUGUST MATH INT version 2.pdf`, `shadeacademyleak.pdf` | Pure image scans, ~1 character of text layer per page. Need OCR. |
| `RW_MOD2_AUGUST.pdf`, `MATH_MOD2_AUGUST.pdf` | Scans whose only text layer is a repeated `@crackdsatchat` watermark. |
| `RW_Practice_Collection_Reformatted.pdf`, `RWdsatleakspekin22_compressed.pdf`, `SAT_RW_Enhanced_Clear_compressed (1).pdf` | Three resolutions of the same 59-page scan. No text layer. |
| `RDOSHI_SAT_PRACTICE_*.pdf`, `digital_sat_k12_*.pdf` | Score reports, not question data. |

## Adding Math later

The highest-value addition is a **Math export from the same College Board
Question Bank** that produced the three Tier A files. It would use the identical
format, so `ingest/parse_cb.py` handles it with no code changes:

1. Export Math questions to PDF from the SAT Suite Question Bank.
2. Drop the file in `~/Downloads`.
3. Add its filename to `CB_EXPORTS` in `ingest/run.py`.
4. Re-run `python3 -m ingest.run`.

Grid-in (student-produced response) answers are already handled — a
`Correct Answer:` that is not a choice letter becomes `correct.values`, and the
math domain taxonomy is already in `parse_cb.TAXONOMY`. Overlapping exports are
harmless; questions dedupe on College Board ID.

## Extraction notes

Three properties of these PDFs break a naive `pdftotext` parse. All are handled
in `ingest/extract.py` and `ingest/parse_cb.py`:

1. **Orphaned apostrophes.** Curly apostrophes render in a much taller font box
   (~18pt vs ~5.8pt), so `pdftotext` sorts them onto their own line *above* the
   text: `colleagues 2010` instead of `colleagues’ 2010`. Words are re-clustered
   into lines by centre-y, which restores them. This affected ~96 places.

2. **Wrapped table cells.** Domain and Skill wrap inside their column
   ("Standard English" / "Conventions"), so a flat read yields
   `Standard English Boundaries Easy Conventions`. Words are assigned to columns
   by x-position against the header row instead. Without this, 417 of 538
   questions lose their domain.

3. **Vector figures.** Charts and tables are vector graphics, not embedded
   rasters — `pdfimages` reports **zero** images for files that visibly contain
   graphs. Seven questions have one. They are detected by horizontal inset
   (chart furniture sits at x≥150 while body prose starts at x=18) and
   crop-rendered to PNG at 150 dpi. Their rotated axis labels, which extract as
   fragments like `e ry e` / `ns ui tiv`, are stripped from the passage text.

### Known residue

Three places across 691 questions where an apostrophe still sits apart, all
archaic or proper-noun forms the contraction rule intentionally does not cover:
`But’ tis` and `them’ tis` (Shakespeare, where the apostrophe belongs to the
*following* word) and `Yup’ ik`. Left as-is rather than special-cased.
