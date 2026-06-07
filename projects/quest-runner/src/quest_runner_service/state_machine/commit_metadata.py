"""Commit message serialization and parsing for recursive step metadata."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..quest_types import RecursiveSnapshot, StepCommitMetadata

_MARKER = "recursive-snapshot-json:"
_HEADER_KEYS = (
    "quest-step",
    "state-machine-path",
    "node",
    "state-before",
    "state-after",
)


class CommitMetadataValidationError(ValueError):
    """Raised when parsed or constructed commit metadata is internally inconsistent."""


@dataclass(frozen=True)
class ParsedCommitMessage:
    header_quest_step: int
    header_state_machine_path: str
    header_node: str
    header_state_before: str
    header_state_after: str
    metadata: StepCommitMetadata


def _snapshot_to_dict(snap: RecursiveSnapshot) -> dict[str, Any]:
    out: dict[str, Any] = {
        "machine_path": snap.machine_path,
        "machine_name": snap.machine_name,
        "node_name": snap.node_name,
        "state_before": snap.state_before,
        "state_after": snap.state_after,
        "tags": {k: snap.tags[k] for k in sorted(snap.tags.keys())},
    }
    if snap.child is None:
        out["child"] = None
    else:
        out["child"] = _snapshot_to_dict(snap.child)
    if snap.role is not None:
        out["role"] = snap.role
    if snap.thread_name is not None:
        out["thread_name"] = snap.thread_name
    return {k: out[k] for k in sorted(out.keys())}


def _parse_int_header(raw: str, label: str) -> int:
    try:
        return int(raw.strip())
    except ValueError as e:
        raise CommitMetadataValidationError(
            f"{label} must be an integer, got {raw!r}"
        ) from e


def _dict_to_snapshot(data: Any, label: str) -> RecursiveSnapshot:
    if not isinstance(data, dict):
        raise CommitMetadataValidationError(f"{label} must be a JSON object")
    required = (
        "machine_path",
        "machine_name",
        "node_name",
        "state_before",
        "state_after",
        "tags",
        "child",
    )
    missing = [k for k in required if k not in data]
    if missing:
        raise CommitMetadataValidationError(
            f"{label} missing required key(s): {', '.join(missing)}"
        )
    tags_raw = data["tags"]
    if not isinstance(tags_raw, dict):
        raise CommitMetadataValidationError(f"{label}.tags must be an object")
    tags: dict[str, str] = {}
    for tk, tv in tags_raw.items():
        if not isinstance(tk, str) or not isinstance(tv, str):
            raise CommitMetadataValidationError(
                f"{label}.tags must map string to string"
            )
        tags[tk] = tv
    child_val = data["child"]
    child: RecursiveSnapshot | None
    if child_val is None:
        child = None
    elif isinstance(child_val, dict):
        child = _parse_snapshot_node(child_val, f"{label}.child")
    else:
        raise CommitMetadataValidationError(f"{label}.child must be object or null")
    role = data.get("role")
    if role is not None and not isinstance(role, str):
        raise CommitMetadataValidationError(f"{label}.role must be a string")
    thread_name = data.get("thread_name")
    if thread_name is not None and not isinstance(thread_name, str):
        raise CommitMetadataValidationError(f"{label}.thread_name must be a string")
    return RecursiveSnapshot(
        machine_path=str(data["machine_path"]),
        machine_name=str(data["machine_name"]),
        node_name=str(data["node_name"]),
        state_before=str(data["state_before"]),
        state_after=str(data["state_after"]),
        tags=tags,
        child=child,
        role=role,
        thread_name=thread_name,
    )


def _parse_snapshot_node(data: dict[str, Any], label: str) -> RecursiveSnapshot:
    return _dict_to_snapshot(data, label)


def render_step_commit_message(meta: StepCommitMetadata) -> str:
    root = meta.snapshot
    payload = {
        "global_step": meta.global_step,
        "snapshot": _snapshot_to_dict(root),
    }
    json_body = json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False)
    lines = [
        f"quest-step: {meta.global_step}",
        f"state-machine-path: {root.machine_path}",
        f"node: {root.node_name}",
        f"state-before: {root.state_before}",
        f"state-after: {root.state_after}",
        "",
        _MARKER,
        json_body,
    ]
    return "\n".join(lines) + "\n"


def parse_step_commit_message(message: str) -> ParsedCommitMessage | None:
    """Return structured metadata, or ``None`` if the message is not parseable."""
    text = message.strip()
    if not text:
        return None
    lines = text.splitlines()
    headers: dict[str, str] = {}
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            break
        if ":" not in line:
            return None
        key, _, rest = line.partition(":")
        key = key.strip()
        val = rest.strip()
        if key in headers:
            return None
        headers[key] = val
        i += 1
    missing_h = [k for k in _HEADER_KEYS if k not in headers]
    if missing_h:
        return None
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines) or lines[i].strip() != _MARKER:
        return None
    i += 1
    json_blob = "\n".join(lines[i:]).strip()
    if not json_blob:
        return None
    stripped_blob = json_blob.strip()
    if stripped_blob.startswith("{") and "\n" not in stripped_blob:
        return None
    try:
        root_any = json.loads(json_blob)
    except json.JSONDecodeError:
        return None
    if not isinstance(root_any, dict):
        return None
    gs_raw = root_any.get("global_step")
    snap_raw = root_any.get("snapshot")
    if not isinstance(gs_raw, int) or isinstance(gs_raw, bool):
        return None
    if not isinstance(snap_raw, dict):
        return None
    try:
        snap = _dict_to_snapshot(snap_raw, "snapshot")
    except CommitMetadataValidationError:
        return None
    meta = StepCommitMetadata(global_step=gs_raw, snapshot=snap)
    try:
        hq = _parse_int_header(headers["quest-step"], "quest-step header")
    except CommitMetadataValidationError:
        return None
    return ParsedCommitMessage(
        header_quest_step=hq,
        header_state_machine_path=headers["state-machine-path"],
        header_node=headers["node"],
        header_state_before=headers["state-before"],
        header_state_after=headers["state-after"],
        metadata=meta,
    )


def validate_parsed_step_commit(
    parsed: ParsedCommitMessage,
    *,
    repo_root: Path | None = None,
    expected_state_after: str | None = None,
) -> None:
    """Validate header/JSON consistency and required recursive fields."""
    meta = parsed.metadata
    root = meta.snapshot
    if meta.global_step != parsed.header_quest_step:
        raise CommitMetadataValidationError(
            "global_step in JSON does not match quest-step header"
        )
    if root.machine_path != parsed.header_state_machine_path:
        raise CommitMetadataValidationError(
            "snapshot.machine_path does not match state-machine-path header"
        )
    if root.node_name != parsed.header_node:
        raise CommitMetadataValidationError(
            "snapshot.node_name does not match node header"
        )
    if root.state_before != parsed.header_state_before:
        raise CommitMetadataValidationError(
            "snapshot.state_before does not match state-before header"
        )
    if root.state_after != parsed.header_state_after:
        raise CommitMetadataValidationError(
            "snapshot.state_after does not match state-after header"
        )
    if expected_state_after is not None and root.state_after != expected_state_after:
        raise CommitMetadataValidationError(
            "state-after header does not match expected post-step state"
        )

    def check_paths(s: RecursiveSnapshot) -> None:
        if repo_root is not None:
            p = repo_root / s.machine_path.replace("\\", "/")
            if not p.is_dir():
                raise CommitMetadataValidationError(
                    f"machine_path does not exist as directory: {s.machine_path!r}"
                )
        if s.child is not None:
            check_paths(s.child)

    check_paths(root)
