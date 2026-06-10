"""Workflow-aware quest and child machine state I/O."""

from __future__ import annotations

from pathlib import Path
from typing import Mapping

from .. import quest_fs
from ..errors import FatalInvariantError
from ..quest_types import (
    QuestMeta,
    RecursiveSnapshot,
    StateMachineState,
    slice_index_from_dirname,
)
from ..workflow_config import WorkflowCollection, WorkflowDefinition, WorkflowState

_IDENTITY_TAGS = frozenset({"quest_type", "quest_number", "quest_slug"})
_RESERVED_TOP_LEVEL_PERSISTED = frozenset({"ExperimentComplete"})
_NORMALIZED_STATE_HEADING = "# State"


def path_matches_collection_pattern(rel_path: str, pattern: str) -> bool:
    pattern_parts = pattern.split("/")
    path_parts = rel_path.split("/")
    if len(pattern_parts) != len(path_parts):
        return False
    for pattern_part, path_part in zip(pattern_parts, path_parts):
        if pattern_part == "*":
            continue
        if pattern_part != path_part:
            return False
    return True


class WorkflowStateIo:
    """``StateIo`` that reads and writes state via workflow machine definitions."""

    def __init__(
        self,
        repo_path: Path,
        quest_dir: Path,
        meta: QuestMeta,
        workflow: WorkflowDefinition,
    ) -> None:
        self.repo_path = repo_path.resolve()
        self.quest_dir = quest_dir.resolve()
        self.meta = meta
        self.workflow = workflow

    def ReadStateMachineState(self, state_machine_dir: Path) -> StateMachineState:
        machine_dir = state_machine_dir.resolve()
        machine_key = self._machine_key_for_dir(machine_dir)
        if machine_key == self.workflow.entry_machine:
            return self._read_quest(machine_key)
        return self._read_child(machine_key, machine_dir)

    def WriteStateMachineState(
        self, state_machine_dir: Path, state: StateMachineState
    ) -> None:
        machine_dir = state_machine_dir.resolve()
        machine_key = self._machine_key_for_dir(machine_dir)
        if machine_key == self.workflow.entry_machine:
            self._write_quest(machine_key, state)
        else:
            self._write_child(machine_key, machine_dir, state)

    def logical_state_for_persisted(
        self, machine_key: str, persisted_state: str
    ) -> str:
        if (
            machine_key == self.workflow.entry_machine
            and persisted_state in _RESERVED_TOP_LEVEL_PERSISTED
        ):
            return persisted_state
        machine = self.workflow.get_machine(machine_key)
        for state_def in machine.states.values():
            if state_def.persisted_as == persisted_state:
                return state_def.name
        if persisted_state in machine.states:
            return persisted_state
        raise FatalInvariantError(
            f"Persisted state {persisted_state!r} is not declared for machine "
            f"{machine_key!r}"
        )

    def persisted_state_for_logical(self, machine_key: str, logical_state: str) -> str:
        if (
            machine_key == self.workflow.entry_machine
            and logical_state in _RESERVED_TOP_LEVEL_PERSISTED
        ):
            return logical_state
        machine = self.workflow.get_machine(machine_key)
        state_def = machine.states.get(logical_state)
        if state_def is None:
            raise FatalInvariantError(
                f"Logical state {logical_state!r} is not declared for machine "
                f"{machine_key!r}"
            )
        if state_def.persisted_as is not None:
            return state_def.persisted_as
        return logical_state

    def machine_name_for_instance(self, machine_key: str, machine_dir: Path) -> str:
        machine = self.workflow.get_machine(machine_key)
        if machine_dir.resolve() == self.quest_dir:
            return machine.machine
        return f"{machine.machine}_{machine_dir.name}"

    def machine_path_for_instance(self, machine_dir: Path) -> str:
        return machine_dir.resolve().relative_to(self.repo_path).as_posix()

    def machine_key_for_dir(self, machine_dir: Path) -> str:
        return self._machine_key_for_dir(machine_dir)

    def _machine_key_for_dir(self, machine_dir: Path) -> str:
        if machine_dir.resolve() == self.quest_dir:
            return self.workflow.entry_machine
        collection = self._collection_for_dir(machine_dir)
        if collection is not None:
            return collection.machine
        raise FatalInvariantError(
            f"Directory {machine_dir} does not match any workflow collection"
        )

    def _collection_for_dir(self, machine_dir: Path) -> WorkflowCollection | None:
        if machine_dir.resolve() == self.quest_dir:
            return None
        rel = machine_dir.resolve().relative_to(self.quest_dir).as_posix()
        for collection in self.workflow.collections.values():
            if path_matches_collection_pattern(rel, collection.path):
                return collection
        return None

    def _read_quest(self, machine_key: str) -> StateMachineState:
        path = self.quest_dir / "state.md"
        text = path.read_text(encoding="utf-8")
        first: str | None = None
        for ln in text.splitlines():
            s = ln.strip()
            if not s:
                continue
            first = s
            break
        if first == _NORMALIZED_STATE_HEADING:
            sm = quest_fs.parse_normalized_state_md_text(
                text,
                require_global_step=False,
                label=f"normalized quest state file {path}",
            )
            logical = self.logical_state_for_persisted(machine_key, sm.state)
            g = sm.global_step if sm.global_step is not None else 0
            return StateMachineState(
                machine_name=sm.machine_name,
                machine_path=sm.machine_path,
                state=logical,
                global_step=g,
                tags=dict(sm.tags),
                updated_at=sm.updated_at,
            )
        info = quest_fs.read_quest_state(self.quest_dir)
        logical = self.logical_state_for_persisted(machine_key, info.state.value)
        rel = self.quest_dir.relative_to(self.repo_path).as_posix()
        tags: dict[str, str] = {}
        if info.active_slice:
            tags["active_slice"] = info.active_slice
        return StateMachineState(
            machine_name=self.workflow.get_machine(machine_key).machine,
            machine_path=rel,
            state=logical,
            global_step=info.global_step if info.global_step is not None else 0,
            tags=tags,
            updated_at=info.updated_at,
        )

    def _read_child(self, machine_key: str, machine_dir: Path) -> StateMachineState:
        persisted, updated_at = quest_fs.read_slice_persisted_state(machine_dir)
        logical = self.logical_state_for_persisted(machine_key, persisted)
        return StateMachineState(
            machine_name=self.machine_name_for_instance(machine_key, machine_dir),
            machine_path=self.machine_path_for_instance(machine_dir),
            state=logical,
            global_step=None,
            tags={},
            updated_at=updated_at,
        )

    def _write_quest(self, machine_key: str, sm: StateMachineState) -> None:
        persisted = self.persisted_state_for_logical(machine_key, sm.state)
        gs = sm.global_step if sm.global_step is not None else 0
        tags: dict[str, str] = {
            "quest_type": self.meta.quest_type,
            "quest_number": str(self.meta.quest_number),
            "quest_slug": self.meta.quest_slug,
        }
        for key, value in sm.tags.items():
            if key not in _IDENTITY_TAGS:
                tags[key] = value
        rel = self.quest_dir.relative_to(self.repo_path).as_posix()
        out = StateMachineState(
            machine_name=self.workflow.get_machine(machine_key).machine,
            machine_path=rel,
            state=persisted,
            global_step=gs,
            tags=tags,
            updated_at=sm.updated_at,
        )
        quest_fs.write_normalized_machine_state(self.quest_dir, out)

    def _write_child(
        self, machine_key: str, machine_dir: Path, sm: StateMachineState
    ) -> None:
        persisted = self.persisted_state_for_logical(machine_key, sm.state)
        quest_fs.write_slice_persisted_state(
            machine_dir,
            persisted_state=persisted,
            updated_at=sm.updated_at,
        )


def build_workflow_step_snapshot(
    *,
    workflow_io: WorkflowStateIo,
    machine_key: str,
    machine_dir: Path,
    workflow_state: WorkflowState,
    state_before: str,
    state_after: str,
    tags: Mapping[str, str],
    child: RecursiveSnapshot | None = None,
) -> RecursiveSnapshot:
    """Build a recursive snapshot from execution-local workflow step data."""
    node_name = (
        workflow_state.node_name
        if workflow_state.node_name is not None
        else workflow_state.name
    )
    return RecursiveSnapshot(
        machine_path=workflow_io.machine_path_for_instance(machine_dir),
        machine_name=workflow_io.machine_name_for_instance(machine_key, machine_dir),
        node_name=node_name,
        state_before=state_before,
        state_after=state_after,
        tags=dict(tags),
        child=child,
    )
