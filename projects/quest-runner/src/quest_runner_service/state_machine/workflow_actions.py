"""Workflow action execution."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import FatalInvariantError
from .workflow_paths import (
    WorkflowPathContext,
    collection_child_dir,
    list_collection_children,
    resolve_path,
)


def execute_actions(actions: list[Any], ctx: WorkflowPathContext) -> None:
    for action in actions:
        execute_action(action, ctx)


def execute_action(action: Any, ctx: WorkflowPathContext) -> None:
    if isinstance(action, str):
        raise FatalInvariantError(f"Unsupported bare action string: {action!r}")
    if not isinstance(action, dict):
        raise FatalInvariantError(f"Action must be a mapping, got {type(action).__name__}")
    if "ensure_dir" in action:
        path_value = action["ensure_dir"]
        if not isinstance(path_value, str):
            raise FatalInvariantError("ensure_dir requires a string path")
        resolve_path(path_value, ctx).mkdir(parents=True, exist_ok=True)
        return
    if "ensure_file" in action:
        block = action["ensure_file"]
        if not isinstance(block, dict):
            raise FatalInvariantError("ensure_file must be a mapping")
        path_value = block.get("path")
        content = block.get("content", "")
        if not isinstance(path_value, str):
            raise FatalInvariantError("ensure_file.path must be a string")
        if not isinstance(content, str):
            raise FatalInvariantError("ensure_file.content must be a string")
        target = resolve_path(path_value, ctx)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(ctx.interpolate_string(content), encoding="utf-8")
        return
    if "remove_file" in action:
        path_value = action["remove_file"]
        if not isinstance(path_value, str):
            raise FatalInvariantError("remove_file requires a string path")
        target = resolve_path(path_value, ctx)
        if target.exists():
            target.unlink()
        return
    if "set_var" in action:
        block = action["set_var"]
        if not isinstance(block, dict):
            raise FatalInvariantError("set_var must be a mapping")
        name = block.get("name")
        value = block.get("value")
        if not isinstance(name, str) or not isinstance(value, str):
            raise FatalInvariantError("set_var requires string name and value")
        ctx.persisted_tags[name] = ctx.interpolate_string(value)
        return
    if "clear_var" in action:
        name = action["clear_var"]
        if not isinstance(name, str):
            raise FatalInvariantError("clear_var requires a string name")
        ctx.persisted_tags.pop(name, None)
        return
    if "select_child" in action:
        _execute_select_child(action["select_child"], ctx)
        return
    raise FatalInvariantError(f"Unknown action: {action!r}")


def _execute_select_child(block: Any, ctx: WorkflowPathContext) -> None:
    if not isinstance(block, dict):
        raise FatalInvariantError("select_child must be a mapping")
    collection_name = block.get("collection")
    where = block.get("where", {})
    after_var = block.get("after")
    set_var = block.get("set")
    result_var = block.get("result")
    if not isinstance(collection_name, str):
        raise FatalInvariantError("select_child.collection must be a string")
    if not isinstance(where, dict):
        raise FatalInvariantError("select_child.where must be a mapping")
    if not isinstance(set_var, str):
        raise FatalInvariantError("select_child.set must be a string")
    if not isinstance(result_var, str):
        raise FatalInvariantError("select_child.result must be a string")
    try:
        collection = ctx.workflow.collections[collection_name]
    except KeyError as e:
        raise FatalInvariantError(
            f"Unknown workflow collection {collection_name!r}"
        ) from e
    children = list_collection_children(collection, ctx.quest_dir)
    matching: list[tuple[str, Path]] = []
    for child_id, child_dir in children:
        logical_state = ctx.workflow_io.ReadStateMachineState(child_dir).state
        if _child_matches_where(logical_state, where):
            matching.append((child_id, child_dir))
    if not matching:
        return
    after_id: str | None = None
    if isinstance(after_var, str):
        after_value = ctx.var_value(after_var)
        if after_value:
            child_ids = {child_id for child_id, _ in children}
            if after_value in child_ids:
                after_id = after_value
    selected: tuple[str, Path] | None = None
    if after_id is None:
        selected = matching[0]
    else:
        child_order = [child_id for child_id, _ in children]
        try:
            after_index = child_order.index(after_id)
        except ValueError:
            selected = matching[0]
        else:
            for child_id, child_dir in matching:
                if child_order.index(child_id) > after_index:
                    selected = (child_id, child_dir)
                    break
    if selected is None:
        return
    child_id, _ = selected
    _ = collection_child_dir(collection, ctx.quest_dir, child_id)
    ctx.persisted_tags[set_var] = child_id
    ctx.step_vars[result_var] = child_id


def _child_matches_where(logical_state: str, where: dict[str, Any]) -> bool:
    state_is = where.get("state_is")
    state_not = where.get("state_not")
    if state_is is not None:
        if not isinstance(state_is, str):
            raise FatalInvariantError("select_child.where.state_is must be a string")
        return logical_state == state_is
    if state_not is not None:
        if not isinstance(state_not, str):
            raise FatalInvariantError("select_child.where.state_not must be a string")
        return logical_state != state_not
    raise FatalInvariantError("select_child.where requires state_is or state_not")
