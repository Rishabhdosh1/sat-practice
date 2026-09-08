"""
Parser for `latin-roots-sat-question-bank.md`.

Format is regular Markdown in two halves — a question half and an answer-key
half, joined on question number:

    **1.** Researchers studying turnout found that a large share of registered
    voters chose to ______ from the referendum entirely...

    A) abstain  B) abdicate  C) accede  D) contravene

    ...

    # Answer Key
    ## Set A
    **1. A — abstain.** *ab-* (away) + *ten* (hold): hold yourself away...

Every question is Words in Context by construction, so domain and skill are
assigned rather than parsed. Difficulty is not present in the source and is
deliberately left null instead of being invented.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

SET_RE = re.compile(r"^##\s+Set\s+([A-Z])\s*(?:—\s*(.*?))?\s*(?:\(Q[\d–\-]+\))?\s*$")
QUESTION_RE = re.compile(r"^\*\*(\d+)\.\*\*\s+(.*)$")
CHOICES_RE = re.compile(r"^([A-D]\)\s+.*)$")
CHOICE_SPLIT_RE = re.compile(r"([A-D])\)\s+")
ANSWER_RE = re.compile(r"^\*\*(\d+)\.\s+([A-D])\s+—\s+(.*?)\.\*\*\s*(.*)$")
ANSWER_KEY_RE = re.compile(r"^#\s+Answer Key\s*$")

DOMAIN = "Craft and Structure"
SKILL = "Words in Context"


@dataclass
class RawLatinQuestion:
    number: int
    set_letter: str | None = None
    set_title: str | None = None
    stem: str | None = None
    choices: list[tuple[str, str]] = field(default_factory=list)
    correct_raw: str | None = None
    correct_word: str | None = None
    rationale: str | None = None
    problems: list[str] = field(default_factory=list)


def _split_choices(line: str) -> list[tuple[str, str]]:
    """`A) abstain  B) abdicate  ...` -> [(A, abstain), (B, abdicate), ...]"""
    parts = CHOICE_SPLIT_RE.split(line.strip())
    out: list[tuple[str, str]] = []
    # split() yields ['', 'A', 'abstain  ', 'B', 'abdicate  ', ...]
    for i in range(1, len(parts) - 1, 2):
        label, text = parts[i], parts[i + 1].strip()
        if text:
            out.append((label, text))
    return out


def parse(md: Path) -> list[RawLatinQuestion]:
    lines = md.read_text(encoding="utf-8").split("\n")

    key_start = next((i for i, l in enumerate(lines) if ANSWER_KEY_RE.match(l)), None)
    if key_start is None:
        raise ValueError(f"{md.name}: no '# Answer Key' section found")

    questions: dict[int, RawLatinQuestion] = {}
    order: list[int] = []

    # --- question half ---------------------------------------------------
    cur_set: tuple[str, str] | None = None
    pending: RawLatinQuestion | None = None
    for raw in lines[:key_start]:
        line = raw.strip()
        m = SET_RE.match(line)
        if m:
            cur_set = (m.group(1), (m.group(2) or "").strip())
            continue
        m = QUESTION_RE.match(line)
        if m:
            n = int(m.group(1))
            q = RawLatinQuestion(
                number=n,
                set_letter=cur_set[0] if cur_set else None,
                set_title=cur_set[1] if cur_set else None,
                stem=m.group(2).strip(),
            )
            questions[n] = q
            order.append(n)
            pending = q
            continue
        if pending is not None and CHOICES_RE.match(line) and not pending.choices:
            pending.choices = _split_choices(line)
            pending = None

    # --- answer key half --------------------------------------------------
    for raw in lines[key_start:]:
        m = ANSWER_RE.match(raw.strip())
        if not m:
            continue
        n = int(m.group(1))
        q = questions.get(n)
        if q is None:
            continue
        q.correct_raw = m.group(2)
        q.correct_word = m.group(3).strip()
        q.rationale = m.group(4).strip() or None

    # --- integrity --------------------------------------------------------
    out = [questions[n] for n in order]
    for q in out:
        if not q.stem:
            q.problems.append("empty stem")
        if len(q.choices) != 4:
            q.problems.append(f"expected 4 choices, found {len(q.choices)}")
        if not q.correct_raw:
            q.problems.append("no answer-key entry")
        elif q.correct_raw not in {c for c, _ in q.choices}:
            q.problems.append(f"answer {q.correct_raw!r} is not one of the choices")
        elif q.correct_word:
            # the key names the word too; make sure it agrees with the letter
            chosen = dict(q.choices)[q.correct_raw]
            if chosen.lower().strip(".,") != q.correct_word.lower().strip(".,"):
                q.problems.append(
                    f"answer letter {q.correct_raw} is {chosen!r} but key says {q.correct_word!r}"
                )
    return out
