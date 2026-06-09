"""Workflow scaffold helpers for quest creation and slice initialization."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .quest_types import QuestMeta
from .state_machine.workflow_actions import execute_action
from .state_machine.workflow_paths import WorkflowPathContext
from .state_machine.workflow_state_io import WorkflowStateIo
from .workflow_config import (
    WorkflowCollection,
    WorkflowDefinition,
    load_workflow,
    packaged_default_workflow_dir,
)


class MissingDefaultWorkflow(Exception):
    """Bundled default ``workflow/`` directory is missing."""

    def __init__(self, path: Path) -> None:
        self.path = path
        super().__init__(f"Missing default workflow directory: {path}")


def copy_packaged_default_workflow(dest: Path) -> list[str]:
    """Copy packaged default workflow into ``dest`` and return created relative paths."""
    src = packaged_default_workflow_dir()
    if not src.is_dir():
        raise MissingDefaultWorkflow(src)
    if dest.exists():
        raise FileExistsError(f"Workflow directory already exists: {dest}")
    shutil.copytree(src, dest)
    return list_workflow_tree_paths(dest.parent, dest)


def list_workflow_tree_paths(quest_dir: Path, workflow_dir: Path) -> list[str]:
    """Return quest-relative paths for a copied ``workflow/`` tree."""
    paths: list[str] = []
    root = workflow_dir.resolve()
    quest = quest_dir.resolve()
    for path in sorted(root.rglob("*"), key=lambda p: p.as_posix()):
        rel = path.relative_to(quest).as_posix()
        paths.append(rel)
    return paths


def resolve_workflow_collection(
    workflow: WorkflowDefinition,
    collection_name: str | None,
) -> WorkflowCollection:
    """Resolve a workflow collection, defaulting when exactly one exists."""
    if collection_name is not None:
        try:
            return workflow.collections[collection_name]
        except KeyError as e:
            raise ValueError(
                f"Unknown workflow collection {collection_name!r}"
            ) from e
    names = list(workflow.collections.keys())
    if not names:
        raise ValueError("workflow declares no collections")
    if len(names) == 1:
        return workflow.collections[names[0]]
    raise ValueError(
        "workflow declares multiple collections; pass --collection "
        f"({', '.join(names)})"
    )


def collection_parent_dir(collection: WorkflowCollection, quest_dir: Path) -> Path:
    """Return the directory where new collection children are created."""
    prefix = collection.path.split("*")[0].rstrip("/")
    if prefix:
        return quest_dir / prefix
    return quest_dir


def build_quest_scaffold_context(
    *,
    repo_path: Path,
    quest_dir: Path,
    meta: QuestMeta,
    workflow: WorkflowDefinition,
) -> WorkflowPathContext:
    workflow_io = WorkflowStateIo(repo_path, quest_dir, meta, workflow)
    return WorkflowPathContext(
        repo_path=repo_path.resolve(),
        quest_dir=quest_dir.resolve(),
        machine_dir=quest_dir.resolve(),
        machine_key=workflow.entry_machine,
        workflow=workflow,
        workflow_io=workflow_io,
        meta=meta,
    )


def build_child_scaffold_context(
    *,
    repo_path: Path,
    quest_dir: Path,
    child_dir: Path,
    meta: QuestMeta,
    workflow: WorkflowDefinition,
    collection: WorkflowCollection,
) -> WorkflowPathContext:
    workflow_io = WorkflowStateIo(repo_path, quest_dir, meta, workflow)
    return WorkflowPathContext(
        repo_path=repo_path.resolve(),
        quest_dir=quest_dir.resolve(),
        machine_dir=child_dir.resolve(),
        machine_key=collection.machine,
        workflow=workflow,
        workflow_io=workflow_io,
        meta=meta,
    )


def scaffold_action_report_paths(action: Any) -> list[str]:
    """Map a scaffold action to the ``created_files`` entries it produces."""
    if isinstance(action, dict) and "ensure_dir" in action:
        value = action["ensure_dir"]
        if isinstance(value, str):
            return [value]
    if isinstance(action, dict) and "ensure_file" in action:
        block = action["ensure_file"]
        if isinstance(block, dict):
            path_value = block.get("path")
            if isinstance(path_value, str):
                return [path_value]
    return []


def execute_scaffold_actions(
    actions: list[Any],
    ctx: WorkflowPathContext,
) -> list[str]:
    """Execute scaffold actions and return created path entries in order."""
    created: list[str] = []
    for action in actions:
        execute_action(action, ctx)
        created.extend(scaffold_action_report_paths(action))
    return created


def load_quest_workflow(quest_dir: Path) -> WorkflowDefinition:
    workflow_dir = quest_dir / "workflow"
    return load_workflow(workflow_dir)
