"""
Parser for College Board SAT Suite Question Bank PDF exports.

These exports are highly regular: a metadata table, then Question / Answer /
Correct Answer / Rationale sections. Three things make a naive parse wrong, and
all three are handled here:

1. Domain and Skill names wrap onto a second line inside their table cell
   ("Standard English" / "Conventions"). Reading the row as a flat string
   yields "Standard English Boundaries Easy Conventions". Every word is instead
   assigned to a column by x-position against the header row, which reassembles
   the cell correctly regardless of wrapping.

2. Structure is detected on *lines*, not visual paragraphs. The section labels
   ("Question", "Answer", "Rationale") and the "Question ID:" line are reliably
   their own lines, but paragraph grouping frequently merges them with adjacent
   text, which silently swallows whole questions.

3. Questions span page boundaries, so the document is walked as one line stream.

Paragraph grouping is still used, but only *within* a prose section, to tell the
passage apart from the question prompt.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .extract import Line, extract_pages

QID_RE = re.compile(r"^Question ID:\s*([0-9a-zA-Z]{4,})\s*$")
HEADER_RE = re.compile(r"Assessment\s+Test\s+Domain\s+Skill\s+Difficulty")
CHOICE_RE = re.compile(r"^([A-D])[.)]\s+(.*)$", re.S)
CORRECT_RE = re.compile(r"^Correct Answer:\s*(.+?)\s*$", re.S)
SECTION_QUESTION = re.compile(r"^Question\s*$")
SECTION_ANSWER = re.compile(r"^Answer\s*$")
SECTION_RATIONALE = re.compile(r"^Rationale\s*$")

COLUMNS = ["assessment", "test", "domain", "skill", "difficulty"]
HEADER_WORDS = {
    "Assessment": "assessment",
    "Test": "test",
    "Domain": "domain",
    "Skill": "skill",
    "Difficulty": "difficulty",
}

# The official taxonomy. Used to validate what column assignment produced, not
# to guess it — a mismatch is reported rather than silently corrected.
TAXONOMY = {
    "Information and Ideas": [
        "Central Ideas and Details",
        "Inferences",
        "Command of Evidence",
    ],
    "Craft and Structure": [
        "Words in Context",
        "Text Structure and Purpose",
        "Cross-Text Connections",
    ],
    "Expression of Ideas": ["Rhetorical Synthesis", "Transitions"],
    "Standard English Conventions": ["Boundaries", "Form, Structure, and Sense"],
    # Math domains, present if a Math export is added later.
    "Algebra": [
        "Linear equations in one variable",
        "Linear functions",
        "Linear equations in two variables",
        "Systems of two linear equations in two variables",
        "Linear inequalities in one or two variables",
    ],
    "Advanced Math": [
        "Equivalent expressions",
        "Nonlinear equations in one variable and systems of equations in two variables",
        "Nonlinear functions",
    ],
    "Problem-Solving and Data Analysis": [
        "Ratios, rates, proportional relationships, and units",
        "Percentages",
        "One-variable data: distributions and measures of center and spread",
        "Two-variable data: models and scatterplots",
        "Probability and conditional probability",
        "Inference from sample statistics and margin of error",
        "Evaluating statistical claims: observational studies and experiments",
    ],
    "Geometry and Trigonometry": [
        "Area and volume",
        "Lines, angles, and triangles",
        "Right triangles and trigonometry",
        "Circles",
    ],
}


@dataclass
class DocLine:
    page: int
    line: Line

    @property
    def text(self) -> str:
        return self.line.text


@dataclass
class RawQuestion:
    qid: str
    source_file: str
    page_start: int
    page_end: int
    assessment: str | None = None
    test: str | None = None
    domain: str | None = None
    skill: str | None = None
    difficulty: str | None = None
    stimulus: str | None = None
    stem: str | None = None
    choices: list[tuple[str, str]] = field(default_factory=list)
    correct_raw: str | None = None
    rationale: str | None = None
    question_lines: list[DocLine] = field(default_factory=list)
    page_width: float = 612.0
    pitch: float = 0.0
    problems: list[str] = field(default_factory=list)


def _column_bounds(header: Line) -> list[tuple[str, float]]:
    """x-position of each header cell, left to right."""
    found: list[tuple[str, float]] = []
    seen: set[str] = set()
    for w in header.words:
        key = HEADER_WORDS.get(w.text.strip())
        if key and key not in seen:
            seen.add(key)
            found.append((key, w.x0))
    found.sort(key=lambda kv: kv[1])
    return found


def _assign_columns(rows: list[Line], bounds: list[tuple[str, float]]) -> dict[str, str]:
    """Bucket every word of the metadata rows into its table column by x."""
    cells: dict[str, list[tuple[float, float, str]]] = {k: [] for k, _ in bounds}
    for line in rows:
        for w in line.words:
            # A word belongs to the rightmost header cell that starts at or
            # before it, with a small tolerance for kerning.
            key = bounds[0][0]
            for name, x in bounds:
                if w.x0 >= x - 3.0:
                    key = name
                else:
                    break
            cells[key].append((w.y0, w.x0, w.text))
    out: dict[str, str] = {}
    for key, words in cells.items():
        words.sort(key=lambda t: (round(t[0], 1), t[1]))  # reading order within cell
        out[key] = " ".join(t[2] for t in words).strip()
    return out


def document_pitch(lines: list[DocLine]) -> float:
    """The document's single-line leading, as the most common gap between lines.

    Line pitch is a property of the typography, not of any one question, and it
    must be measured document-wide. A short question — two lines of passage plus
    a one-line prompt — has exactly one gap, which is the *paragraph* gap; a
    block-local estimate therefore mistakes it for the line pitch and never
    splits the passage from the prompt. Measuring across the document gives the
    real leading (~14.25pt here), against which 27pt is plainly a break.
    """
    counts: dict[float, int] = {}
    for a, b in zip(lines, lines[1:]):
        if a.page != b.page:
            continue
        gap = b.line.cy - a.line.cy
        if gap <= 0:
            continue
        key = round(gap * 2) / 2  # half-point buckets
        counts[key] = counts.get(key, 0) + 1
    if not counts:
        return 0.0
    return max(counts.items(), key=lambda kv: (kv[1], -kv[0]))[0]


def _paragraphs(
    lines: list[DocLine], pitch: float = 0.0, gap_factor: float = 1.55
) -> list[str]:
    """Join wrapped lines into paragraphs using vertical gaps.

    Gaps are only meaningful within a page; across a page break the text is
    treated as continuing the same paragraph, which is what these exports do.

    `pitch` should come from `document_pitch`. When it is unknown, fall back to
    the tightest gap in this block, which is right whenever the block is long
    enough to contain at least one wrapped line.
    """
    if not lines:
        return []
    if pitch <= 0:
        gaps = sorted(
            b.line.cy - a.line.cy
            for a, b in zip(lines, lines[1:])
            if a.page == b.page and b.line.cy > a.line.cy
        )
        pitch = gaps[len(gaps) // 5] if gaps else 0.0
    threshold = pitch * gap_factor if pitch > 0 else float("inf")

    paras: list[list[str]] = [[lines[0].text]]
    for a, b in zip(lines, lines[1:]):
        same_page = a.page == b.page
        if same_page and (b.line.cy - a.line.cy) > threshold:
            paras.append([b.text])
        else:
            paras[-1].append(b.text)
    return [" ".join(p).strip() for p in paras if " ".join(p).strip()]


def _split_blocks(lines: list[DocLine]) -> list[list[DocLine]]:
    blocks: list[list[DocLine]] = []
    for dl in lines:
        if QID_RE.match(dl.text.strip()):
            blocks.append([dl])
        elif blocks:
            blocks[-1].append(dl)
    return blocks


def _parse_block(block: list[DocLine], source: str, pitch: float = 0.0) -> RawQuestion:
    qid = QID_RE.match(block[0].text.strip()).group(1)
    q = RawQuestion(
        qid=qid,
        source_file=source,
        page_start=block[0].page,
        page_end=block[-1].page,
    )

    def find(pred, start=0):
        return next((i for i in range(start, len(block)) if pred(block[i].text.strip())), None)

    hdr_i = find(lambda t: bool(HEADER_RE.search(t)))
    q_i = find(lambda t: bool(SECTION_QUESTION.match(t)))
    a_i = find(lambda t: bool(SECTION_ANSWER.match(t)), (q_i or 0) + 1)
    c_i = find(lambda t: bool(CORRECT_RE.match(t)), (a_i or q_i or 0) + 1)
    r_i = find(lambda t: bool(SECTION_RATIONALE.match(t)), (c_i or a_i or q_i or 0) + 1)

    # --- metadata table -------------------------------------------------
    if hdr_i is None:
        q.problems.append("no metadata header row found")
    else:
        bounds = _column_bounds(block[hdr_i].line)
        if len(bounds) != len(COLUMNS):
            q.problems.append(f"header has {len(bounds)} columns, expected {len(COLUMNS)}")
        row_end = q_i if q_i is not None else len(block)
        rows = [block[i].line for i in range(hdr_i + 1, row_end)]
        if not rows:
            q.problems.append("metadata header present but no data row")
        elif bounds:
            cells = _assign_columns(rows, bounds)
            q.assessment = cells.get("assessment") or None
            q.test = cells.get("test") or None
            q.domain = cells.get("domain") or None
            q.skill = cells.get("skill") or None
            q.difficulty = (cells.get("difficulty") or "").strip() or None

    if q_i is None:
        q.problems.append("no Question section")
        return q

    # --- stimulus / stem -------------------------------------------------
    end = a_i if a_i is not None else (c_i if c_i is not None else len(block))
    qlines = block[q_i + 1 : end]
    q.question_lines = qlines
    texts = _paragraphs(qlines, pitch)
    if not texts:
        q.problems.append("empty Question section")
    elif len(texts) == 1:
        q.stem = texts[0]
    else:
        # The prompt is the final paragraph; everything before it is passage.
        q.stem = texts[-1]
        q.stimulus = "\n\n".join(texts[:-1])

    # --- choices ---------------------------------------------------------
    if a_i is None:
        q.problems.append("no Answer section")
    else:
        cend = c_i if c_i is not None else len(block)
        for i in range(a_i + 1, cend):
            t = block[i].text.strip()
            m = CHOICE_RE.match(t)
            if m:
                q.choices.append((m.group(1), m.group(2).strip()))
            elif q.choices:
                # continuation of a choice that wrapped onto another line
                label, prev = q.choices[-1]
                q.choices[-1] = (label, f"{prev} {t}".strip())

    # --- correct answer + rationale --------------------------------------
    if c_i is not None:
        q.correct_raw = CORRECT_RE.match(block[c_i].text.strip()).group(1).strip()
    else:
        q.problems.append("no Correct Answer line")

    if r_i is not None:
        q.rationale = "\n\n".join(_paragraphs(block[r_i + 1 :], pitch)) or None
    else:
        q.problems.append("no Rationale section")

    # --- taxonomy sanity --------------------------------------------------
    if q.domain and q.domain not in TAXONOMY:
        q.problems.append(f"unknown domain {q.domain!r}")
    elif q.domain and q.skill and q.skill not in TAXONOMY[q.domain]:
        q.problems.append(f"skill {q.skill!r} not valid for domain {q.domain!r}")
    if q.difficulty and q.difficulty not in ("Easy", "Medium", "Hard"):
        q.problems.append(f"unexpected difficulty {q.difficulty!r}")

    return q


def parse(pdf: Path) -> list[RawQuestion]:
    """Parse one question-bank export into raw questions."""
    lines: list[DocLine] = []
    widths: dict[int, float] = {}
    for page in extract_pages(pdf):
        widths[page.number] = page.width
        lines.extend(DocLine(page.number, l) for l in page.lines)

    pitch = document_pitch(lines)

    out: list[RawQuestion] = []
    for block in _split_blocks(lines):
        q = _parse_block(block, pdf.name, pitch)
        q.page_width = widths.get(q.page_start, 612.0)
        q.pitch = pitch
        out.append(q)
    return out
