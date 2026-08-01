"""Parse the flat, JSON-compatible TOML subset used by VENDOR.toml files."""

from __future__ import annotations

import json
import re


_KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]+")


def loads(text: str, *, source: object = "<string>") -> dict[str, object]:
    """Load installer-owned ``key = value`` manifests without third-party deps.

    The vendor sync writer emits bare keys whose values are JSON strings or
    arrays. Keeping the reader to that explicit subset lets the installers run
    under stock Python 3.9 while rejecting unsupported TOML constructs clearly.
    """

    result: dict[str, object] = {}
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key_text, separator, value_text = line.partition("=")
        key = key_text.strip()
        if not separator or not _KEY_PATTERN.fullmatch(key):
            raise ValueError(
                f"{source}:{line_number}: expected a bare key and '='"
            )
        if key in result:
            raise ValueError(f"{source}:{line_number}: duplicate key {key!r}")
        try:
            result[key] = json.loads(value_text.strip())
        except json.JSONDecodeError as error:
            raise ValueError(
                f"{source}:{line_number}: expected a JSON-compatible TOML value"
            ) from error
    return result
