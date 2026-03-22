"""Helpers for applying unified diffs and OpenAI/Codex patch envelopes."""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Hunk:
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: list[str]


@dataclass(frozen=True)
class PatchEnvelopeOperation:
    kind: Literal["update", "add", "delete"]
    path: str
    hunk_lines: list[str] | None = None
    content: str | None = None


def _parse_range(text: str) -> tuple[int, int]:
    if "," in text:
        start_text, count_text = text.split(",", 1)
        return int(start_text), int(count_text)
    return int(text), 1


def parse_unified_diff(patch: str) -> list[Hunk]:
    lines = patch.splitlines()
    hunks: list[Hunk] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("--- ") or line.startswith("+++ "):
            index += 1
            continue
        if not line.startswith("@@ "):
            raise ValueError("Patch error: expected unified diff hunk header")
        try:
            header, _ = line[3:].split(" @@", 1)
            old_range, new_range = header.strip().split(" ")
            old_start, old_count = _parse_range(old_range[1:])
            new_start, new_count = _parse_range(new_range[1:])
        except Exception as exc:  # noqa: BLE001
            raise ValueError("Patch error: invalid unified diff hunk header") from exc
        index += 1
        hunk_lines: list[str] = []
        while index < len(lines):
            item = lines[index]
            if item.startswith("@@ "):
                break
            if not item or item[0] not in {" ", "+", "-"}:
                raise ValueError("Patch error: invalid hunk line prefix")
            hunk_lines.append(item)
            index += 1
        hunks.append(
            Hunk(
                old_start=old_start,
                old_count=old_count,
                new_start=new_start,
                new_count=new_count,
                lines=hunk_lines,
            )
        )
    if not hunks:
        raise ValueError("Patch error: no hunks found")
    return hunks


def apply_unified_diff(original: str, patch: str) -> str:
    original_lines = original.splitlines(keepends=True)
    hunks = parse_unified_diff(patch)
    output: list[str] = []
    cursor = 0
    for hunk in hunks:
        start_index = max(0, hunk.old_start - 1)
        if start_index < cursor:
            raise ValueError("Patch error: overlapping hunks")
        output.extend(original_lines[cursor:start_index])
        cursor = start_index
        for raw_line in hunk.lines:
            prefix = raw_line[0]
            payload = raw_line[1:]
            candidate = payload + "\n"
            if prefix == " ":
                if cursor >= len(original_lines) or original_lines[cursor] != candidate:
                    raise ValueError("Patch error: context mismatch")
                output.append(original_lines[cursor])
                cursor += 1
                continue
            if prefix == "-":
                if cursor >= len(original_lines) or original_lines[cursor] != candidate:
                    raise ValueError("Patch error: deletion mismatch")
                cursor += 1
                continue
            if prefix == "+":
                output.append(candidate)
                continue
        consumed = cursor - start_index
        if consumed != hunk.old_count:
            raise ValueError("Patch error: old hunk line count mismatch")
    output.extend(original_lines[cursor:])
    return "".join(output)


def _normalize_path(path: str) -> str:
    normalized = path.strip()
    if not normalized:
        raise ValueError("Patch error: file path is required")
    return normalized


def _build_added_file_content(lines: list[str]) -> str:
    return "".join(f"{line[1:]}\n" for line in lines)


def _render_text(lines: list[str]) -> str:
    if not lines:
        return ""
    return "".join(f"{line}\n" for line in lines)


def _find_sequence(lines: list[str], needle: list[str], start: int) -> int:
    if not needle:
        return start
    max_start = len(lines) - len(needle)
    for index in range(max(start, 0), max_start + 1):
        if lines[index:index + len(needle)] == needle:
            return index
    raise ValueError("Patch error: context mismatch")


def apply_patch_envelope_update(original: str, path: str, hunk_lines: list[str]) -> str:
    if not hunk_lines:
        raise ValueError(f"Patch error: update for {path} is missing hunk content")

    original_lines = original.splitlines()
    updated_lines = list(original_lines)
    cursor = 0
    index = 0
    while index < len(hunk_lines):
        if not hunk_lines[index].startswith("@@"):
            raise ValueError("Patch error: expected update hunk header")
        index += 1
        chunk_lines: list[str] = []
        while index < len(hunk_lines) and not hunk_lines[index].startswith("@@"):
            chunk_lines.append(hunk_lines[index])
            index += 1
        old_lines = [line[1:] for line in chunk_lines if line and line[0] in {" ", "-"}]
        new_lines = [line[1:] for line in chunk_lines if line and line[0] in {" ", "+"}]
        start = _find_sequence(updated_lines, old_lines, cursor)
        updated_lines[start:start + len(old_lines)] = new_lines
        cursor = start + len(new_lines)

    updated = _render_text(updated_lines)
    return "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            updated.splitlines(keepends=True),
            fromfile=path,
            tofile=path,
        )
    )


def parse_patch_envelope(patch: str) -> list[PatchEnvelopeOperation]:
    lines = patch.splitlines()
    if not lines or lines[0] != "*** Begin Patch":
        raise ValueError("Patch error: expected '*** Begin Patch' at the start of the patch envelope")

    operations: list[PatchEnvelopeOperation] = []
    index = 1
    while index < len(lines):
        line = lines[index]
        if line == "*** End Patch":
            if index != len(lines) - 1:
                raise ValueError("Patch error: unexpected trailing content after '*** End Patch'")
            break

        if line.startswith("*** Update File: "):
            path = _normalize_path(line.removeprefix("*** Update File: "))
            index += 1
            hunk_lines: list[str] = []
            while index < len(lines):
                item = lines[index]
                if item == "*** End Patch" or item.startswith("*** Update File: ") or item.startswith("*** Add File: ") or item.startswith("*** Delete File: "):
                    break
                if item.startswith("*** Move to: "):
                    raise ValueError("Patch error: file moves are not supported by this apply_patch implementation")
                if item == "*** End of File":
                    index += 1
                    continue
                if not item.startswith("@@") and (not item or item[0] not in {" ", "+", "-"}):
                    raise ValueError(f"Patch error: invalid update line '{item}'")
                hunk_lines.append(item)
                index += 1
            operations.append(PatchEnvelopeOperation(kind="update", path=path, hunk_lines=hunk_lines))
            continue

        if line.startswith("*** Add File: "):
            path = _normalize_path(line.removeprefix("*** Add File: "))
            index += 1
            add_lines: list[str] = []
            while index < len(lines):
                item = lines[index]
                if item == "*** End Patch" or item.startswith("*** Update File: ") or item.startswith("*** Add File: ") or item.startswith("*** Delete File: "):
                    break
                if not item.startswith("+"):
                    raise ValueError(f"Patch error: invalid add-file line '{item}'")
                add_lines.append(item)
                index += 1
            operations.append(PatchEnvelopeOperation(kind="add", path=path, content=_build_added_file_content(add_lines)))
            continue

        if line.startswith("*** Delete File: "):
            path = _normalize_path(line.removeprefix("*** Delete File: "))
            operations.append(PatchEnvelopeOperation(kind="delete", path=path))
            index += 1
            continue

        raise ValueError(f"Patch error: unexpected line '{line}'")

    if not operations:
        raise ValueError("Patch error: no file operations found in patch envelope")
    if not lines or lines[-1] != "*** End Patch":
        raise ValueError("Patch error: expected '*** End Patch' at the end of the patch envelope")
    return operations
