"""Path resolution and string interpolation for workflow execution."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from ..quest_service import FatalInvariantError
from ..quest_types import QuestMeta, utc_now_iso
from ..workflow_config import WorkflowCollection, WorkflowDefinition
from .workflow_state_io import WorkflowStateIo, path_matches_collection_pattern

_PATH_VARS = ("quest", "project", "machine", "active_child")
_BRACE_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def list_collection_children(
    collection: WorkflowCollection,
    quest_dir: Path,
) -> list[tuple[str, Path]]:
    prefix = collection.path.split("*")[0].rstrip("/")
    base = quest_dir / prefix if prefix else quest_dir
    if not base.is_dir():
        return []
    children: list[tuple[str, Path]] = []
    for child_dir in base.iterdir():
        if not child_dir.is_dir():
            continue
        rel = child_dir.resolve().relative_to(quest_dir.resolve()).as_posix()
        if path_matches_collection_pattern(rel, collection.path):
            children.append((child_dir.name, child_dir.resolve()))
    if collection.order == "lexical":
        children.sort(key=lambda item: item[0])
    return children


def collection_child_dir(
    collection: WorkflowCollection,
    quest_dir: Path,
    child_id: str,
) -> Path:
    prefix = collection.path.split("*")[0].rstrip("/")
    if prefix:
        return (quest_dir / prefix / child_id).resolve()
    return (quest_dir / child_id).resolve()


@dataclass
class WorkflowPathContext:
    repo_path: Path
    quest_dir: Path
    machine_dir: Path
    machine_key: str
    workflow: WorkflowDefinition
    workflow_io: WorkflowStateIo
    meta: QuestMeta
    persisted_tags: dict[str, str] = field(default_factory=dict)
    step_vars: dict[str, str] = field(default_factory=dict)

    def project_dir(self) -> Path:
        return (self.repo_path / "projects" / self.meta.project).resolve()

    def active_child_dir(self) -> Path | None:
        for collection in self.workflow.collections.values():
            active_id = self.persisted_tags.get(collection.active_var, "").strip()
            if not active_id:
                continue
            child_dir = collection_child_dir(collection, self.quest_dir, active_id)
            if child_dir.is_dir():
                return child_dir
        return None

    def var_value(self, name: str) -> str | None:
        if name in self.step_vars:
            return self.step_vars[name]
        if name in self.persisted_tags:
            return self.persisted_tags[name]
        return None

    def interpolate_string(self, text: str) -> str:
        def replace(match: re.Match[str]) -> str:
            key = match.group(1)
            if key == "now":
                return utc_now_iso()
            value = self.var_value(key)
            if value is None:
                raise FatalInvariantError(
                    f"Unknown workflow variable {key!r} in interpolation"
                )
            return value

        return _BRACE_RE.sub(replace, text)


def _split_path_variable(path_value: str) -> tuple[str | None, str]:
    if not path_value.startswith("$"):
        return None, path_value
    remainder = path_value[1:]
    for var_name in _PATH_VARS:
        if remainder == var_name:
            return var_name, ""
        prefix = f"{var_name}/"
        if remainder.startswith(prefix):
            return var_name, remainder[len(prefix) :]
    raise FatalInvariantError(f"Unknown path variable in {path_value!r}")


def _resolve_path_variable(var_name: str, ctx: WorkflowPathContext) -> Path:
    if var_name == "quest":
        return ctx.quest_dir.resolve()
    if var_name == "project":
        return ctx.project_dir()
    if var_name == "machine":
        return ctx.machine_dir.resolve()
    if var_name == "active_child":
        active = ctx.active_child_dir()
        if active is None:
            raise FatalInvariantError(
                "Cannot resolve $active_child: no active child directory"
            )
        return active
    raise FatalInvariantError(f"Unknown path variable {var_name!r}")


def assert_quest_relative_path(path_value: str, *, label: str) -> None:
    if Path(path_value).is_absolute():
        raise FatalInvariantError(
            f"{label}: absolute paths are not allowed for workflow-owned paths: "
            f"{path_value!r}"
        )


def resolve_path(path_value: str, ctx: WorkflowPathContext) -> Path:
    interpolated = ctx.interpolate_string(path_value)
    assert_quest_relative_path(interpolated, label="path")
    var_name, remainder = _split_path_variable(interpolated)
    if var_name is not None:
        base = _resolve_path_variable(var_name, ctx)
        if not remainder:
            return base
        return (base / remainder).resolve()
    return (ctx.machine_dir / interpolated).resolve()
