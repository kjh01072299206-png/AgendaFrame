from __future__ import annotations

import re
from typing import Any

_OPEN_QUOTES = set("“‘「『《〈")
_CLOSE_QUOTES = set("”’」』》〉")
_TERMINATORS = set(".!?。！？")


def _split_paragraph_sentences(paragraph: str) -> list[str]:
    """Split article text without breaking punctuation inside quoted speech."""

    parts: list[str] = []
    start = 0
    quote_depth = 0
    ascii_quote_open = False
    for index, character in enumerate(paragraph):
        if character in _OPEN_QUOTES:
            quote_depth += 1
        elif character in _CLOSE_QUOTES:
            quote_depth = max(0, quote_depth - 1)
        elif character == '"':
            ascii_quote_open = not ascii_quote_open

        is_line_boundary = character == "\n"
        is_sentence_boundary = (
            character in _TERMINATORS
            and index + 1 < len(paragraph)
            and paragraph[index + 1].isspace()
            and quote_depth == 0
            and not ascii_quote_open
        )
        if is_line_boundary or is_sentence_boundary:
            parts.append(paragraph[start : index + 1])
            start = index + 1
    parts.append(paragraph[start:])
    return [part for part in parts if part.strip()]


def sentence_rows(body: str) -> list[dict[str, Any]]:
    """Return stable paragraph/sentence locators for evidence fingerprints."""

    rows: list[dict[str, Any]] = []
    cursor = 0
    paragraphs = re.split(r"\n\s*\n", body)
    for paragraph_number, paragraph in enumerate(paragraphs, start=1):
        paragraph_start = body.find(paragraph, cursor)
        cursor = paragraph_start + len(paragraph)
        sentence_cursor = paragraph_start
        for sentence_number, part in enumerate(
            _split_paragraph_sentences(paragraph),
            start=1,
        ):
            stripped = part.strip()
            start = body.find(stripped, sentence_cursor)
            if start < 0:
                continue
            end = start + len(stripped)
            sentence_cursor = end
            rows.append(
                {
                    "paragraph": paragraph_number,
                    "sentence": sentence_number,
                    "start": start,
                    "end": end,
                    "text": stripped,
                }
            )
    return rows


def evidence_fits_sentence(body: str, start: int, end: int) -> bool:
    return any(
        row["start"] <= start < row["end"] and end <= row["end"]
        for row in sentence_rows(body)
    )
