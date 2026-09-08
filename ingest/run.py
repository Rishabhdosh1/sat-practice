"""
Ingest entry point.

    python3 -m ingest.run [--source ~/Downloads] [--out data]

Reads the raw SAT sources, normalizes them, renders any vector figures, writes
`data/questions.json` plus `data/ingest-report.json`, and validates the result.

Guarantees:
  * The source directory is only ever read. Nothing is written to or moved
    inside it, and no original file is modified.
  * Re-runnable and deterministic — unchanged inputs produce a byte-identical
    `questions.json`.
  * Nothing is dropped silently. Every question that fails to parse cleanly is
    listed in the report with its source file and page.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import figures as figmod
from . import parse_cb, parse_latin
from .normalize import SCHEMA_VERSION, Question, from_cb, from_latin, sha256, validate

# Sources confirmed to parse cleanly. Files in ~/Downloads that are scans,
# answer-key-less worksheets or AI-reconstructed sets are deliberately excluded;
# see docs/SOURCES.md for the full survey and the reasoning.
CB_EXPORTS = [
    "questionbank-export-2026-7-13.pdf",
    "questionbank-export-2026-9-8.pdf",
    "English 150 questions.pdf",
]
LATIN_MD = "latin-roots-sat-question-bank.md"


def ingest(source: Path, out: Path, figures_dir: Path) -> tuple[list[Question], list[dict]]:
    questions: list[Question] = []
    report: list[dict] = []
    inputs: dict[str, str] = {}

    # ---- College Board question-bank exports ---------------------------
    for name in CB_EXPORTS:
        pdf = source / name
        if not pdf.exists():
            report.append({"file": name, "stage": "open", "problem": "file not found; skipped"})
            continue
        inputs[name] = sha256(pdf)

        for raw in parse_cb.parse(pdf):
            fig_lines, prose, region = figmod.split_figure(raw.question_lines, raw.page_width)

            fig_rel = None
            if region is not None:
                rel = f"figures/cb_{raw.qid}.png"
                try:
                    figmod.render(pdf, region, figures_dir.parent / rel)
                    fig_rel = rel
                except Exception as exc:  # noqa: BLE001 - reported, not raised
                    report.append(
                        {
                            "file": name,
                            "page": region.page,
                            "id": raw.qid,
                            "stage": "figure",
                            "problem": f"render failed: {exc}",
                        }
                    )
                # The figure's own labels (rotated axis text extracts as
                # fragments) must not be spliced into the passage.
                texts = parse_cb._paragraphs(prose, raw.pitch)
                if texts:
                    raw.stem = texts[-1]
                    raw.stimulus = "\n\n".join(texts[:-1]) or None

            q = from_cb(raw, fig_rel)
            questions.append(q)

            if raw.problems:
                report.append(
                    {
                        "file": name,
                        "page": raw.page_start,
                        "id": raw.qid,
                        "stage": "parse",
                        "problem": "; ".join(raw.problems),
                    }
                )

    # ---- Latin roots markdown -------------------------------------------
    md = source / LATIN_MD
    if md.exists():
        inputs[LATIN_MD] = sha256(md)
        for raw in parse_latin.parse(md):
            questions.append(from_latin(raw, LATIN_MD))
            if raw.problems:
                report.append(
                    {
                        "file": LATIN_MD,
                        "id": f"latin:{raw.number:03d}",
                        "stage": "parse",
                        "problem": "; ".join(raw.problems),
                    }
                )
    else:
        report.append({"file": LATIN_MD, "stage": "open", "problem": "file not found; skipped"})

    # ---- de-duplicate ----------------------------------------------------
    by_id: dict[str, Question] = {}
    for q in questions:
        prior = by_id.get(q.id)
        if prior is None:
            by_id[q.id] = q
            continue
        # Same question exported twice. Keep the first, record where else it came
        # from, and only flag it if the two copies actually disagree.
        prior.source_ids = sorted(set(prior.source_ids or [prior.id]))
        same = (
            prior.stem == q.stem
            and prior.choices == q.choices
            and prior.correct == q.correct
        )
        prior.tags = sorted(set(prior.tags) | set(q.tags))
        report.append(
            {
                "file": q.source["file"],
                "page": q.source.get("page"),
                "id": q.id,
                "stage": "dedup",
                "problem": (
                    "duplicate of an earlier export; identical, kept one copy"
                    if same
                    else "DUPLICATE ID WITH DIFFERENT CONTENT - inspect both copies"
                ),
            }
        )
        if not same:
            prior.needs_review = True
            prior.flags = sorted(set(prior.flags) | {"conflicting_duplicate"})

    ordered = sorted(by_id.values(), key=lambda q: q.id)
    return ordered, report, inputs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build questions.json from the raw SAT sources.")
    ap.add_argument("--source", type=Path, default=Path.home() / "Downloads")
    # Output lands under the app's static dir so there is a single source of
    # truth: re-running ingest updates the app with no copy step and no rebuild.
    ap.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "app" / "public" / "data",
    )
    args = ap.parse_args(argv)

    root = args.out.parent
    figures_dir = root / "figures"
    figures_dir.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)

    questions, report, inputs = ingest(args.source, args.out, figures_dir)
    issues = validate(questions, root)

    payload = {
        "schema_version": SCHEMA_VERSION,
        "generator": {"script": "ingest.run", "version": "1.0.0", "inputs": inputs},
        "counts": {
            "total": len(questions),
            "by_section": _tally(q.section for q in questions),
            "by_domain": _tally(q.domain for q in questions),
            "by_skill": _tally(q.skill for q in questions),
            "by_difficulty": _tally(q.difficulty for q in questions),
            "by_trust": _tally(q.source["trust"] for q in questions),
            "with_figures": sum(1 for q in questions if q.figures),
        },
        "questions": [q.to_dict() for q in questions],
    }

    (args.out / "questions.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    (args.out / "ingest-report.json").write_text(
        json.dumps(
            {
                "parse_and_dedup_notes": report,
                "validation_failures": issues,
                "summary": {
                    "questions_written": len(questions),
                    "notes": len(report),
                    "validation_failures": len(issues),
                },
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"questions written : {len(questions)}")
    print(f"figures rendered  : {sum(1 for q in questions if q.figures)}")
    print(f"report notes      : {len(report)}")
    print(f"validation issues : {len(issues)}")
    for i in issues[:20]:
        print(f"   ! {i['id']}: {i['kind']} - {i['detail']}")
    return 1 if issues else 0


def _tally(values) -> dict:
    out: dict[str, int] = {}
    for v in values:
        key = "(none)" if v is None else str(v)
        out[key] = out.get(key, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))


if __name__ == "__main__":
    sys.exit(main())
