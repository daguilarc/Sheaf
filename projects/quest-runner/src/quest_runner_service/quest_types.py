"""Shared quest runner type definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
import re
from typing import Dict, Optional


_SLICE_DIR_PREFIX_RE = re.compile(r"^(\d{4})_")


EXPERIMENT_COMPLETE_STATE = "ExperimentComplete"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slice_index_from_dirname(name: str) -> int | None:
    match = _SLICE_DIR_PREFIX_RE.match(name)
    return int(match.group(1)) if match else None


class HarnessKind(Enum):
    Codex = "codex"
    Cursor = "cursor"
    ClaudeCode = "claude_code"


@dataclass
class QuestFileState:
    state: str
    current_slice: int | None
    updated_at: str
    active_slice: str | None = None
    global_step: int | None = None


@dataclass
class SliceFileState:
    state: str
    updated_at: str


@dataclass
class QuestMeta:
    project: str
    quest_type: str
    quest_number: int
    quest_slug: str
    quest_name: str
    created_at: str
    created_by: str | None = None


@dataclass(frozen=True)
class ProjectQuestRoot:
    project: str
    path: Path


@dataclass
class ExecutionProfile:
    harness: HarnessKind
    model: str
    reasoning_effort: str | None
    idle_timeout_seconds: int
    modify_allow: list[str]
    modify_block: list[str]
    config_version: int


@dataclass
class IssueEntry:
    issue_id: str
    status: str
    owner_role: str
    created_at: str
    updated_at: str
    title: str
    details: str
    resolution_notes: str | None = None


@dataclass
class IssueResponseEntry:
    issue_id: str
    response_timestamp: str
    outcome: str
    explanation: str


@dataclass
class TransitionRecord:
    timestamp: str
    previous_state: str
    next_state: str
    commit: str
    thread_name: str
    notes: str


@dataclass(frozen=True)
class StateMachineId:
    root_machine_id: str
    machine_path: str
    machine_name: str


@dataclass
class StateMachineState:
    machine_name: str
    machine_path: str
    state: str
    global_step: Optional[int]
    tags: Dict[str, str]
    updated_at: str


@dataclass
class NodeResult:
    state_before: str
    state_after: str
    notes: str = ""


@dataclass
class RecursiveSnapshot:
    machine_path: str
    machine_name: str
    node_name: str
    state_before: str
    state_after: str
    tags: Dict[str, str] = field(default_factory=dict)
    child: Optional["RecursiveSnapshot"] = None
    role: Optional[str] = None
    thread_name: Optional[str] = None


@dataclass
class StepCommitMetadata:
    global_step: int
    snapshot: RecursiveSnapshot


@dataclass(frozen=True)
class RoleProfile:
    harness: str
    model: str
    reasoning_effort: str | None
    idle_timeout_seconds: int
    modify_allow: tuple[str, ...]
    modify_block: tuple[str, ...]
