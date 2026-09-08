"""
Figure detection and rendering for question-bank exports.

The charts in these exports are *vector* graphics, not embedded rasters, which
is why `pdfimages` reports zero images for files that visibly contain graphs.
The only way to recover them is to re-render the page region.

Detection keys off horizontal position. Body prose always starts at the left
margin (x≈18pt) and runs wide; chart furniture — title, axis ticks, rotated
category labels, legend — is inset well to the right. A run of inset lines at
the top of the Question section is a figure.

That inset text must also be *removed* from the stimulus. Rotated axis labels
extract as fragments like "e ry e" / "ns ui tiv" (from "responded to inquiry"),
and would otherwise be spliced into the passage as garbage.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

# A line is figure furniture when it starts this far right of the body margin.
INSET_PT = 20.0
# Require a run of at least this many inset lines before calling it a figure,
# so a single stray indent doesn't trigger a render.
MIN_FIGURE_LINES = 3
# Padding around the detected region so axis labels aren't clipped. The top is
# tighter because the bold "Question" section label sits just above the figure
# and bleeds into the crop otherwise.
PAD_PT = 12.0
PAD_TOP_PT = 5.0
RENDER_DPI = 150


@dataclass
class FigureRegion:
    page: int
    x0: float
    y0: float
    x1: float
    y1: float


def split_figure(question_lines, page_width: float = 612.0) -> tuple[list, list, FigureRegion | None]:
    """Partition a Question section into (figure lines, prose lines, region).

    Returns the original lines unchanged when no figure is present.

    The crop spans the full text column horizontally rather than the extent of
    the figure's own labels: axis rules, gridlines and bars are vector strokes
    with no text of their own, and they reach past the outermost tick label, so
    a text-derived box clips the right edge of the plot.
    """
    if not question_lines:
        return [], [], None

    body_x0 = min(dl.line.x0 for dl in question_lines)
    threshold = body_x0 + INSET_PT

    # Only a *leading* run counts: the figure always precedes the passage.
    run = 0
    while run < len(question_lines) and question_lines[run].line.x0 > threshold:
        run += 1

    if run < MIN_FIGURE_LINES:
        return [], list(question_lines), None

    fig_lines = question_lines[:run]
    prose = question_lines[run:]

    pages = {dl.page for dl in fig_lines}
    page = min(pages)
    on_page = [dl for dl in fig_lines if dl.page == page]
    region = FigureRegion(
        page=page,
        x0=max(body_x0 - PAD_PT, 0.0),
        y0=min(w.y0 for dl in on_page for w in dl.line.words) - PAD_TOP_PT,
        x1=min(page_width - body_x0 + PAD_PT, page_width),
        y1=max(w.y1 for dl in on_page for w in dl.line.words) + PAD_PT,
    )
    return fig_lines, prose, region


def render(pdf: Path, region: FigureRegion, out_png: Path, dpi: int = RENDER_DPI) -> Path:
    """Crop-render a figure region to PNG. Reads the source, never writes near it."""
    scale = dpi / 72.0
    x = max(int(region.x0 * scale), 0)
    y = max(int(region.y0 * scale), 0)
    w = max(int((region.x1 - region.x0) * scale), 1)
    h = max(int((region.y1 - region.y0) * scale), 1)

    out_png.parent.mkdir(parents=True, exist_ok=True)
    stem = out_png.with_suffix("")
    subprocess.run(
        [
            "pdftoppm", "-png", "-r", str(dpi),
            "-f", str(region.page), "-l", str(region.page),
            "-x", str(x), "-y", str(y), "-W", str(w), "-H", str(h),
            "-singlefile", str(pdf), str(stem),
        ],
        check=True,
        capture_output=True,
    )
    return out_png
