"""
Self-contained checks over the built dataset and the extraction rules.

    python3 -m ingest.check

Stdlib only, so there is nothing to install. Exits non-zero on failure.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from .extract import join_words, Word

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "questions.json"

_failures: list[str] = []
_passes = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global _passes
    if ok:
        _passes += 1
    else:
        _failures.append(f"{name}: {detail}")


def w(text: str, x0: float, y0: float, x1: float, y1: float) -> Word:
    return Word(text, x0, y0, x1, y1)


def test_join_words() -> None:
    # A raised apostrophe re-clustered into the line must close up the possessive.
    line = [w("Morri", 158.7, 158.5, 180.0, 164.3), w("’", 180.0, 149.4, 181.8, 167.7),
            w("s", 181.3, 158.5, 185.9, 164.3), w("2000", 188.2, 158.5, 208.4, 164.3)]
    check("possessive joins", join_words(line) == "Morri’s 2000", join_words(line))

    # A tail carrying punctuation still joins.
    line = [w("can", 0, 0, 10, 5), w("’", 10, 0, 11, 5), w("t.", 11, 0, 15, 5)]
    check("contraction with period", join_words(line) == "can’t.", join_words(line))

    # A tail that trails off into a quoted ellipsis still joins.
    line = [w("it", 0, 0, 5, 5), w("’", 5, 0, 6, 5), w('s...ray"', 6, 0, 20, 5)]
    check("contraction with ellipsis", join_words(line) == 'it’s...ray"', join_words(line))

    # A plural possessive must NOT swallow the following word.
    line = [w("researchers", 0, 0, 40, 5), w("’", 40, 0, 41, 5), w("use", 43, 0, 55, 5)]
    check("plural possessive keeps space", join_words(line) == "researchers’ use", join_words(line))

    # Opening single quote attaches right, closing attaches left.
    line = [w("as", 0, 0, 8, 5), w("‘", 9, 0, 10, 5), w("hark!", 10, 0, 25, 5), w("’", 25, 0, 26, 5)]
    check("quote direction", join_words(line) == "as ‘hark!’", join_words(line))


def test_dataset() -> None:
    if not DATA.exists():
        check("dataset exists", False, f"{DATA} missing - run python3 -m ingest.run")
        return
    d = json.loads(DATA.read_text(encoding="utf-8"))
    qs = d["questions"]

    check("schema version", d["schema_version"] == 1, str(d.get("schema_version")))
    check("question count", len(qs) == 691, f"got {len(qs)}")

    ids = [q["id"] for q in qs]
    check("ids unique", len(set(ids)) == len(ids), f"{len(ids) - len(set(ids))} dupes")
    check("ids sorted", ids == sorted(ids), "output is not deterministic-ordered")

    check("no empty stems", all(q["stem"]["text"].strip() for q in qs), "")

    bad_answer = [
        q["id"] for q in qs
        if q["response_type"] == "mcq"
        and (
            not q["correct"]["labels"]
            or any(l not in {c["label"] for c in q["choices"]} for l in q["correct"]["labels"])
        )
    ]
    check("every mcq has a valid correct answer", not bad_answer, str(bad_answer[:5]))

    bad_counts = [q["id"] for q in qs if q["response_type"] == "mcq" and len(q["choices"]) != 4]
    check("all mcq have 4 choices", not bad_counts, str(bad_counts[:5]))

    check(
        "no empty choice text",
        all(c["text"].strip() for q in qs for c in q["choices"]),
        "",
    )

    diffs = {q["difficulty"] for q in qs}
    check("difficulty vocabulary", diffs <= {"easy", "medium", "hard", None}, str(diffs))

    sections = {q["section"] for q in qs}
    check("section vocabulary", sections <= {"reading_writing", "math"}, str(sections))

    # Every referenced figure must actually be on disk.
    missing = [f["path"] for q in qs for f in q["figures"] if not (ROOT / f["path"]).exists()]
    check("figure files present", not missing, str(missing))
    check("figure count", sum(1 for q in qs if q["figures"]) == 7,
          str(sum(1 for q in qs if q["figures"])))

    # The rotated axis-label garbage must never reach a passage.
    garbage = re.compile(r"\b(ns ui tiv|e ry e|sp in ce)\b")
    dirty = [q["id"] for q in qs if garbage.search((q.get("stimulus") or {}).get("text", ""))]
    check("no chart-label garbage in passages", not dirty, str(dirty))

    # Trust must be explicit on every question.
    check(
        "trust labelled",
        all(q["source"]["trust"] in {"official", "unverified_answer", "reconstructed"} for q in qs),
        "",
    )


def main() -> int:
    test_join_words()
    test_dataset()
    print(f"passed: {_passes}")
    for f in _failures:
        print(f"FAILED  {f}")
    return 1 if _failures else 0


if __name__ == "__main__":
    sys.exit(main())
