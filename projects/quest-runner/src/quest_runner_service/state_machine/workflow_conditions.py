"""Workflow condition evaluation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .. import quest_fs
from ..quest_service import FatalInvariantError
from .workflow_paths import (
    WorkflowPathContext,
    list_collection_children,
    resolve_path,
)


@dataclass(frozen=True)
class ChildStepResult:
    state_after: str


def evaluate_condition(
    condition: Any,
    ctx: WorkflowPathContext,
    *,
    child_result: ChildStepResult | None = None,
) -> bool:
    if not isinstance(condition, dict):
        raise FatalInvariantError(f"Condition must be a mapping, got {type(condition).__name__}")
    if "all" in condition:
        items = condition["all"]
        if not isinstance(items, list):
            raise FatalInvariantError("Condition 'all' must be a list")
        return all(evaluate_condition(item, ctx, child_result=child_result) for item in items)
    if "any" in condition:
        items = condition["any"]
        if not isinstance(items, list):
            raise FatalInvariantError("Condition 'any' must be a list")
        return any(evaluate_condition(item, ctx, child_result=child_result) for item in items)
    if "not" in condition:
        return not evaluate_condition(
            condition["not"], ctx, child_result=child_result
        )
    for key in ("exists", "file_exists", "dir_exists", "not_exists"):
        if key in condition:
            path_value = condition[key]
            if not isinstance(path_value, str):
                raise FatalInvariantError(f"Condition {key!r} requires a string path")
            target = resolve_path(path_value, ctx)
            exists = target.exists()
            if key == "exists":
                return exists
            if key == "not_exists":
                return not exists
            if key == "file_exists":
                return target.is_file()
            if key == "dir_exists":
                return target.is_dir()
    if "file_count_at_least" in condition:
        block = condition["file_count_at_least"]
        if not isinstance(block, dict):
            raise FatalInvariantError("file_count_at_least must be a mapping")
        glob_value = block.get("glob")
        count_value = block.get("count")
        if not isinstance(glob_value, str):
            raise FatalInvariantError("file_count_at_least.glob must be a string")
        if not isinstance(count_value, int) or isinstance(count_value, bool):
            raise FatalInvariantError("file_count_at_least.count must be an integer")
        base = ctx.machine_dir
        matches = list(base.glob(glob_value))
        return len(matches) >= count_value
    for issue_key in ("has_open_issues", "no_open_issues"):
        if issue_key in condition:
            block = condition[issue_key]
            if not isinstance(block, dict):
                raise FatalInvariantError(f"{issue_key} must be a mapping")
            file_value = block.get("file")
            if not isinstance(file_value, str):
                raise FatalInvariantError(f"{issue_key}.file must be a string")
            issue_path = resolve_path(file_value, ctx)
            open_issues = _has_open_issues(issue_path)
            if issue_key == "has_open_issues":
                return open_issues
            return not open_issues
    if "var_exists" in condition:
        name = condition["var_exists"]
        if not isinstance(name, str):
            raise FatalInvariantError("var_exists must be a string")
        return ctx.var_value(name) is not None
    if "var_equals" in condition:
        block = condition["var_equals"]
        if not isinstance(block, dict):
            raise FatalInvariantError("var_equals must be a mapping")
        name = block.get("name")
        value = block.get("value")
        if not isinstance(name, str) or not isinstance(value, str):
            raise FatalInvariantError("var_equals requires string name and value")
        current = ctx.var_value(name)
        return current == value
    if "child_dirs_exist" in condition:
        block = condition["child_dirs_exist"]
        if not isinstance(block, dict):
            raise FatalInvariantError("child_dirs_exist must be a mapping")
        collection_name = block.get("collection")
        collection = _get_collection(ctx, collection_name)
        return bool(list_collection_children(collection, ctx.quest_dir))
    if "all_children" in condition:
        block = condition["all_children"]
        if not isinstance(block, dict):
            raise FatalInvariantError("all_children must be a mapping")
        collection_name = block.get("collection")
        require = block.get("require", [])
        if not isinstance(require, list):
            raise FatalInvariantError("all_children.require must be a list")
        collection = _get_collection(ctx, collection_name)
        children = list_collection_children(collection, ctx.quest_dir)
        if not children:
            return False
        for _, child_dir in children:
            child_ctx = _child_path_context(ctx, child_dir)
            for requirement in require:
                if not _evaluate_child_requirement(requirement, child_ctx):
                    return False
        return True
    if "child_result" in condition:
        if child_result is None:
            raise FatalInvariantError(
                "child_result condition requires a child step result from the current state"
            )
        block = condition["child_result"]
        if not isinstance(block, dict):
            raise FatalInvariantError("child_result must be a mapping")
        expected = block.get("state_after")
        if not isinstance(expected, str):
            raise FatalInvariantError("child_result.state_after must be a string")
        return child_result.state_after == expected
    raise FatalInvariantError(f"Unknown condition: {condition!r}")


def _has_open_issues(issue_path: Path) -> bool:
    issues = quest_fs.read_issues(issue_path)
    return any(issue.status.strip().lower() == "open" for issue in issues)


def _get_collection(ctx: WorkflowPathContext, collection_name: Any):
    if not isinstance(collection_name, str):
        raise FatalInvariantError("collection name must be a string")
    try:
        return ctx.workflow.collections[collection_name]
    except KeyError as e:
        raise FatalInvariantError(
            f"Unknown workflow collection {collection_name!r}"
        ) from e


def _child_path_context(ctx: WorkflowPathContext, child_dir: Path) -> WorkflowPathContext:
    return WorkflowPathContext(
        repo_path=ctx.repo_path,
        quest_dir=ctx.quest_dir,
        machine_dir=child_dir,
        machine_key=ctx.machine_key,
        workflow=ctx.workflow,
        workflow_io=ctx.workflow_io,
        meta=ctx.meta,
        persisted_tags=dict(ctx.persisted_tags),
        step_vars=dict(ctx.step_vars),
    )


def _evaluate_child_requirement(requirement: Any, child_ctx: WorkflowPathContext) -> bool:
    if not isinstance(requirement, dict):
        raise FatalInvariantError("all_children requirement must be a mapping")
    if "file_count_at_least" in requirement:
        block = requirement["file_count_at_least"]
        if not isinstance(block, dict):
            raise FatalInvariantError("file_count_at_least must be a mapping")
        glob_value = block.get("glob")
        count_value = block.get("count")
        if not isinstance(glob_value, str):
            raise FatalInvariantError("file_count_at_least.glob must be a string")
        if not isinstance(count_value, int) or isinstance(count_value, bool):
            raise FatalInvariantError("file_count_at_least.count must be an integer")
        matches = list(child_ctx.machine_dir.glob(glob_value))
        return len(matches) >= count_value
    for key in ("exists", "file_exists", "dir_exists", "not_exists"):
        if key in requirement:
            path_value = requirement[key]
            if not isinstance(path_value, str):
                raise FatalInvariantError(f"Requirement {key!r} requires a string path")
            target = resolve_path(path_value, child_ctx)
            exists = target.exists()
            if key == "exists":
                return exists
            if key == "not_exists":
                return not exists
            if key == "file_exists":
                return target.is_file()
            if key == "dir_exists":
                return target.is_dir()
    return evaluate_condition(requirement, child_ctx)
