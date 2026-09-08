"""
PDF text extraction with geometry-aware line reconstruction.

Why this exists instead of a plain `pdftotext -layout` call:

The College Board question-bank exports render curly apostrophes as a separate
text object in a much taller font box (~18pt tall vs ~5.8pt for body text).
`pdftotext` sorts words by their top edge, so every apostrophe is emitted on
its own line *above* the line it belongs to:

        ’
    Marta Coll and colleagues 2010 Mediterranean Sea biodiversity census

That silently corrupts the stem of a large fraction of questions. The glyph's
vertical *centre*, however, still falls inside the correct line, so clustering
words by centre-y and re-sorting by x puts it back where it belongs:

    Marta Coll and colleagues’ 2010 Mediterranean Sea biodiversity census

Everything downstream depends on this, so it lives on its own.
"""

from __future__ import annotations

import re
import subprocess
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

NS = {"p": "http://www.w3.org/1999/xhtml"}

# Punctuation that should attach to the preceding word with no space.
# Note ‘ and “ are *opening* quotes and belong on the right; putting them here
# produces `a‘ failure’` instead of `a ‘failure’`.
_ATTACH_LEFT = set("’'”,.;:!?)]}%")
# Punctuation that should attach to the following word with no space.
_ATTACH_RIGHT = set("([{$“‘")
# After a re-attached apostrophe the possessive/contraction tail arrives as its
# own word ("Morri" + "’" + "s"). Only these fragments get glued back on, so a
# genuine plural possessive ("researchers’ use") keeps its space.
_CONTRACTION_TAILS = ("s", "t", "ll", "re", "ve", "d", "m", "er")
# The tail may carry trailing punctuation or an ellipsis from a quoted excerpt
# ("it’" + "s...ray\""), so match the tail as a prefix that is not followed by
# more letters rather than as the whole token.
_TAIL_RE = re.compile(rf"^({'|'.join(_CONTRACTION_TAILS)})(?![A-Za-z])")

# Words whose centre-y differ by less than this are treated as one visual line.
# Body text in these exports sits on a ~14.25pt grid, so half of that is a safe
# ceiling: it groups the raised apostrophe (~2.9pt off) without merging
# adjacent lines.
LINE_TOLERANCE_PT = 5.0


@dataclass(frozen=True)
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2.0


@dataclass
class Line:
    words: list[Word]

    @property
    def text(self) -> str:
        return join_words(self.words)

    @property
    def cy(self) -> float:
        return self.words[0].cy

    @property
    def x0(self) -> float:
        return min(w.x0 for w in self.words)


@dataclass
class Para:
    """A visual paragraph: consecutive lines with normal wrap spacing."""

    lines: list[Line]
    page: int

    @property
    def text(self) -> str:
        return " ".join(l.text for l in self.lines)

    @property
    def y0(self) -> float:
        return min(w.y0 for l in self.lines for w in l.words)

    @property
    def y1(self) -> float:
        return max(w.y1 for l in self.lines for w in l.words)

    @property
    def x0(self) -> float:
        return min(l.x0 for l in self.lines)


@dataclass
class Page:
    number: int
    width: float
    height: float
    lines: list[Line]

    @property
    def text(self) -> str:
        return "\n".join(l.text for l in self.lines)

    def paragraphs(self, gap_factor: float = 1.6) -> list[Para]:
        """Group lines into paragraphs on vertical gap.

        Wrapped lines inside a paragraph sit on a regular leading grid; a new
        paragraph opens a visibly larger gap. Using the median line pitch as the
        reference makes this independent of font size.
        """
        if not self.lines:
            return []
        pitches = sorted(
            self.lines[i + 1].cy - self.lines[i].cy for i in range(len(self.lines) - 1)
        )
        pitch = pitches[len(pitches) // 2] if pitches else 0.0
        threshold = pitch * gap_factor if pitch > 0 else float("inf")

        paras: list[Para] = [Para([self.lines[0]], self.number)]
        for prev, cur in zip(self.lines, self.lines[1:]):
            if (cur.cy - prev.cy) > threshold:
                paras.append(Para([cur], self.number))
            else:
                paras[-1].lines.append(cur)
        return paras


def _is_contraction_tail(token: str) -> bool:
    """True for `s`, `t.`, `ll,`, `s...ray"` — a contraction tail, however it trails off."""
    return bool(_TAIL_RE.match(token.lower()))


def join_words(words: list[Word]) -> str:
    """Join a line's words, respecting punctuation that must not take a space."""
    out: list[str] = []
    for w in words:
        t = w.text
        if not t:
            continue
        prev = out[-1] if out else ""
        if out and t[0] in _ATTACH_LEFT:
            out[-1] = prev + t
        elif out and prev and prev[-1] in "’'" and _is_contraction_tail(t):
            out[-1] = prev + t
        elif out and prev and prev[-1] in _ATTACH_RIGHT:
            out[-1] = prev + t
        else:
            out.append(t)
    return " ".join(out)


def _cluster_lines(words: list[Word]) -> list[list[Word]]:
    """Group words into visual lines by centre-y, then order each line by x."""
    if not words:
        return []
    lines: list[list[Word]] = []
    for w in sorted(words, key=lambda w: w.cy):
        if lines and abs(w.cy - lines[-1][0].cy) <= LINE_TOLERANCE_PT:
            lines[-1].append(w)
        else:
            lines.append([w])
    for line in lines:
        line.sort(key=lambda w: w.x0)
    return lines


def extract_pages(pdf: Path, first: int | None = None, last: int | None = None) -> list[Page]:
    """Extract pages as geometry-corrected lines. Never writes near the source."""
    cmd = ["pdftotext", "-bbox-layout"]
    if first is not None:
        cmd += ["-f", str(first)]
    if last is not None:
        cmd += ["-l", str(last)]
    cmd += [str(pdf), "-"]
    xml = subprocess.run(cmd, capture_output=True, check=True).stdout

    root = ET.fromstring(xml)
    pages: list[Page] = []
    for i, pg in enumerate(root.iter(f"{{{NS['p']}}}page"), start=(first or 1)):
        words = [
            Word(
                (w.text or ""),
                float(w.get("xMin", 0)),
                float(w.get("yMin", 0)),
                float(w.get("xMax", 0)),
                float(w.get("yMax", 0)),
            )
            for w in pg.iter(f"{{{NS['p']}}}word")
        ]
        words = [w for w in words if w.text.strip()]
        pages.append(
            Page(
                number=i,
                width=float(pg.get("width", 0)),
                height=float(pg.get("height", 0)),
                lines=[Line(l) for l in _cluster_lines(words)],
            )
        )
    return pages


def clean_text(s: str) -> str:
    """Normalise whitespace and the handful of glyphs that survive extraction oddly."""
    s = s.replace(" ", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


if __name__ == "__main__":  # smoke test on the known-bad apostrophe page
    import sys

    pages = extract_pages(Path(sys.argv[1]), 1, 1)
    print(pages[0].text[:900])
