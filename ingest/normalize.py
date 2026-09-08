"""
Map parsed source questions onto the normalized schema, then validate.

Design notes:

* Output is deterministic. Questions are sorted by id and no wall-clock
  timestamp is written into `questions.json`, so re-running over unchanged
  inputs produces a byte-identical file and `git diff` stays meaningful.
  Provenance is pinned by SHA-256 of each input instead.

* `trust` distinguishes authoritative College Board content from material whose
  answers were reconstructed rather than published. Nothing is dropped for being
  low-trust; it is labelled so the app can filter or badge it.

* Validation never silently repairs. Anything suspect is reported so it can be
  eyeballed, which is the whole point of the report file.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA_VERSION = 1

SECTION_BY_TEST = {
    "Reading and Writing": "reading_writing",
    "Math": "math",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def export_tag(filename: str) -> str:
    """A stable, human-meaningful set name derived from the source file."""
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", filename)
    if m:
        y, mo, d = m.groups()
        return f"export-{y}-{int(mo):02d}-{int(d):02d}"
    return _slug(Path(filename).stem)


@dataclass
class Question:
    id: str
    source: dict
    section: str | None
    domain: str | None
    skill: str | None
    difficulty: str | None
    stimulus: dict | None
    stem: dict
    response_type: str
    choices: list[dict]
    correct: dict
    explanation: dict | None
    figures: list[dict] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    source_ids: list[str] = field(default_factory=list)
    needs_review: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source_ids": self.source_ids or [self.id],
            "source": self.source,
            "section": self.section,
            "domain": self.domain,
            "skill": self.skill,
            "difficulty": self.difficulty,
            "stimulus": self.stimulus,
            "stem": self.stem,
            "response_type": self.response_type,
            "choices": self.choices,
            "correct": self.correct,
            "explanation": self.explanation,
            "figures": self.figures,
            "tags": self.tags,
            "flags": self.flags,
            "needs_review": self.needs_review,
        }


def _text(value: str | None, fmt: str = "text") -> dict | None:
    if value is None or not value.strip():
        return None
    return {"text": value.strip(), "format": fmt}


def from_cb(raw, figure_path: str | None = None) -> Question:
    """Normalize a College Board question-bank question."""
    labels = [c[0] for c in raw.choices]
    correct_labels: list[str] = []
    correct_values: list[str] = []
    if raw.correct_raw:
        token = raw.correct_raw.strip()
        if token in labels:
            correct_labels = [token]
        else:
            # Math grid-ins report a value rather than a letter.
            correct_values = [t.strip() for t in re.split(r"[,;]| or ", token) if t.strip()]

    figures = []
    if figure_path:
        figures.append(
            {
                "kind": "figure",
                "path": figure_path,
                "alt": None,
                "origin": "vector_render",
            }
        )

    flags = list(raw.problems)
    if figure_path:
        flags.append("figure_rendered_from_vector")

    return Question(
        id=f"cb:{raw.qid}",
        source={
            "file": raw.source_file,
            "page": raw.page_start,
            "tier": "A",
            "trust": "official",
        },
        section=SECTION_BY_TEST.get(raw.test or "", None),
        domain=raw.domain,
        skill=raw.skill,
        difficulty=(raw.difficulty or "").lower() or None,
        stimulus=_text(raw.stimulus),
        stem=_text(raw.stem) or {"text": "", "format": "text"},
        response_type="mcq" if raw.choices else "grid_in",
        choices=[{"label": l, "text": t, "format": "text"} for l, t in raw.choices],
        correct={"labels": correct_labels, "values": correct_values},
        explanation=_text(raw.rationale),
        figures=figures,
        tags=[export_tag(raw.source_file)],
        flags=flags,
        needs_review=bool(raw.problems),
    )


def from_latin(raw, source_file: str) -> Question:
    """Normalize a Latin-roots vocabulary question."""
    tags = ["latin-roots"]
    if raw.set_letter:
        tags.append(f"latin-set-{raw.set_letter.lower()}")

    return Question(
        id=f"latin:{raw.number:03d}",
        source={
            "file": source_file,
            "page": None,
            "tier": "B",
            "trust": "unverified_answer",
        },
        section="reading_writing",
        domain="Craft and Structure",
        skill="Words in Context",
        difficulty=None,
        stimulus=None,
        stem=_text(raw.stem) or {"text": "", "format": "text"},
        response_type="mcq",
        choices=[{"label": l, "text": t, "format": "text"} for l, t in raw.choices],
        correct={"labels": [raw.correct_raw] if raw.correct_raw else [], "values": []},
        explanation=_text(raw.rationale, fmt="markdown"),
        figures=[],
        tags=tags,
        flags=list(raw.problems),
        needs_review=bool(raw.problems),
    )


# ---------------------------------------------------------------- validation


def validate(questions: list[Question], root: Path) -> list[dict]:
    """Return a list of validation failures. Empty means the output is sound."""
    issues: list[dict] = []

    def fail(q_id, kind, detail):
        issues.append({"id": q_id, "kind": kind, "detail": detail})

    seen: dict[str, int] = {}
    for q in questions:
        seen[q.id] = seen.get(q.id, 0) + 1

    for qid, n in sorted(seen.items()):
        if n > 1:
            fail(qid, "duplicate_id", f"id appears {n} times in output")

    for q in questions:
        if not q.stem.get("text", "").strip():
            fail(q.id, "empty_stem", "stem is empty")

        labels = [c["label"] for c in q.choices]

        if q.response_type == "mcq":
            if len(q.choices) not in (2, 3, 4, 5):
                fail(q.id, "choice_count", f"{len(q.choices)} choices")
            if len(set(labels)) != len(labels):
                fail(q.id, "duplicate_choice_labels", ", ".join(labels))
            if any(not c["text"].strip() for c in q.choices):
                fail(q.id, "empty_choice", "a choice has no text")
            if not q.correct["labels"]:
                fail(q.id, "missing_correct_answer", "no correct label")
            else:
                for lab in q.correct["labels"]:
                    if lab not in labels:
                        fail(q.id, "correct_not_in_choices", f"{lab} not in {labels}")
        else:
            if not q.correct["values"]:
                fail(q.id, "missing_correct_answer", "grid-in with no accepted value")

        if q.section not in ("reading_writing", "math", None):
            fail(q.id, "bad_section", str(q.section))
        if q.difficulty not in ("easy", "medium", "hard", None):
            fail(q.id, "bad_difficulty", str(q.difficulty))

        for fig in q.figures:
            if not (root / fig["path"]).exists():
                fail(q.id, "missing_figure_file", fig["path"])

    return issues
