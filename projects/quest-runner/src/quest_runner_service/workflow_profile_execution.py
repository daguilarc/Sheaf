"""Workflow profile message assembly, preamble rendering, and thread identity."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .quest_service import FatalInvariantError
from .quest_types import ExecutionProfile, HarnessKind, QuestMeta, slice_index_from_dirname
from .workflow_config import WorkflowDefinition, WorkflowProfile, load_packaged_default_workflow, load_workflow

_BRACE_FORMAT_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]+))?\}")
_PATH_VAR_RE = re.compile(
    r"\$(quest|project|machine|active_child|log_dir|thread_registry|reference_docs)"
    r"(?=/|\b)"
)
_ALWAYS_BRACE_VARS = frozenset(
    {
        "quest_type",
        "quest_number",
        "quest_slug",
        "quest_name",
        "profile",
        "active_slice",
        "experiment_guidance",
    }
)
_THREAD_BRACE_VARS = frozenset({"repo", "collection", "child_id", "child_number"})
_RUNTIME_CONTEXT_TO_PATH_VAR = {
    "include_current_child_path": "active_child",
    "include_log_directory": "log_dir",
    "include_thread_registry_path": "thread_registry",
    "include_reference_docs_path": "reference_docs",
}


class WorkflowTemplateError(Exception):
    """Raised when a template references a variable that is not exposed."""


@dataclass(frozen=True)
class ProfileExecutionContext:
    repo_path: Path
    quest_dir: Path
    machine_dir: Path
    meta: QuestMeta
    workflow: WorkflowDefinition
    profile: WorkflowProfile
    profile_name: str
    quest_docs_dir: Path
    quest_rel: str
    machine_rel: str
    project_rel: str
    active_child_dir: Path | None
    active_child_rel: str | None
    active_slice: str
    collection_name: str | None
    child_number: int | None
    experiment_id: str | None


def resolve_quest_workflow(quest_dir: Path) -> WorkflowDefinition:
    local = quest_dir / "workflow"
    if local.is_dir() and (local / "workflow.yaml").is_file():
        return load_workflow(local)
    return load_packaged_default_workflow()


def find_run_for_node(
    workflow: WorkflowDefinition,
    machine_key: str,
    node_name: str,
) -> tuple[str, str]:
    machine = workflow.get_machine(machine_key)
    for state in machine.states.values():
        if state.node_name == node_name and state.run is not None:
            profile = state.run.get("profile")
            task = state.run.get("task", "")
            if not isinstance(profile, str) or not profile:
                raise FatalInvariantError(
                    f"State {state.name!r} run.profile must be a non-empty string"
                )
            if not isinstance(task, str):
                raise FatalInvariantError(
                    f"State {state.name!r} run.task must be a string"
                )
            return profile, task
    raise FatalInvariantError(
        f"No run block found for node {node_name!r} in machine {machine_key!r}"
    )


def workflow_profile_to_execution_profile(profile: WorkflowProfile) -> ExecutionProfile:
    return ExecutionProfile(
        harness=HarnessKind(profile.harness),
        model=profile.model,
        reasoning_effort=profile.reasoning_effort,
        idle_timeout_seconds=profile.idle_timeout_seconds,
        modify_allow=list(profile.modify_allow),
        modify_block=list(profile.modify_block),
        config_version=2,
    )


def build_profile_execution_context(
    *,
    repo_path: Path,
    quest_dir: Path,
    machine_dir: Path,
    meta: QuestMeta,
    workflow: WorkflowDefinition,
    profile: WorkflowProfile,
    profile_name: str,
    quest_docs_dir: Path,
    active_child_dir: Path | None = None,
    collection_name: str | None = None,
    experiment_id: str | None = None,
) -> ProfileExecutionContext:
    repo_path = repo_path.resolve()
    quest_dir = quest_dir.resolve()
    machine_dir = machine_dir.resolve()
    quest_rel = quest_dir.relative_to(repo_path).as_posix()
    machine_rel = machine_dir.relative_to(repo_path).as_posix()
    marker = "/quests/"
    if marker in quest_rel:
        project_rel = quest_rel.split(marker, 1)[0]
    elif meta.project:
        project_rel = f"projects/{meta.project}"
    else:
        project_rel = ""
    active_child_rel: str | None = None
    active_slice = ""
    child_number: int | None = None
    if active_child_dir is not None:
        active_child_dir = active_child_dir.resolve()
        active_child_rel = active_child_dir.relative_to(repo_path).as_posix()
        active_slice = active_child_dir.name
        child_number = slice_index_from_dirname(active_child_dir.name)
    return ProfileExecutionContext(
        repo_path=repo_path,
        quest_dir=quest_dir,
        machine_dir=machine_dir,
        meta=meta,
        workflow=workflow,
        profile=profile,
        profile_name=profile_name,
        quest_docs_dir=quest_docs_dir,
        quest_rel=quest_rel,
        machine_rel=machine_rel,
        project_rel=project_rel,
        active_child_dir=active_child_dir,
        active_child_rel=active_child_rel,
        active_slice=active_slice,
        collection_name=collection_name,
        child_number=child_number,
        experiment_id=experiment_id,
    )


def _exposed_path_vars(ctx: ProfileExecutionContext) -> set[str]:
    exposed = {"quest", "project", "machine"}
    toggles = ctx.profile.runtime_context
    if toggles.get("include_current_child_path", False):
        exposed.add("active_child")
    if toggles.get("include_log_directory", False):
        exposed.add("log_dir")
    if toggles.get("include_thread_registry_path", False):
        exposed.add("thread_registry")
    if toggles.get("include_reference_docs_path", False):
        exposed.add("reference_docs")
    return exposed


def _path_var_value(ctx: ProfileExecutionContext, name: str) -> str:
    if name == "quest":
        return ctx.quest_rel
    if name == "project":
        return ctx.project_rel
    if name == "machine":
        return ctx.machine_rel
    if name == "active_child":
        return ctx.active_child_rel or ""
    if name == "log_dir":
        return f"{ctx.quest_rel}/logs"
    if name == "thread_registry":
        return f"{ctx.quest_rel}/thread_registry.json"
    if name == "reference_docs":
        return str(ctx.quest_docs_dir.resolve())
    raise WorkflowTemplateError(f"Unknown path variable ${name}")


def _validate_path_vars(text: str, exposed: set[str]) -> None:
    for match in _PATH_VAR_RE.finditer(text):
        name = match.group(1)
        if name not in exposed:
            raise WorkflowTemplateError(
                f"Template references ${name} but profile runtime_context does not expose it"
            )


def _format_brace_value(ctx: ProfileExecutionContext, key: str, spec: str | None) -> str:
    if key == "quest_type":
        value: object = ctx.meta.quest_type
    elif key == "quest_number":
        value = ctx.meta.quest_number
    elif key == "quest_slug":
        value = ctx.meta.quest_slug
    elif key == "quest_name":
        value = ctx.meta.quest_name
    elif key == "profile":
        value = ctx.profile_name
    elif key == "active_slice":
        value = ctx.active_slice
    elif key == "experiment_guidance":
        return render_experiment_guidance(ctx.experiment_id)
    elif key == "repo":
        value = ctx.repo_path.name
    elif key == "collection":
        value = ctx.collection_name or ""
    elif key == "child_id":
        value = ctx.active_slice
    elif key == "child_number":
        if ctx.child_number is None:
            raise WorkflowTemplateError(
                f"Template references {{{key}}} but no active child is set"
            )
        value = ctx.child_number
    else:
        raise WorkflowTemplateError(f"Unknown template variable {{{key}}}")
    if spec:
        return format(value, spec)
    return str(value)


def render_experiment_guidance(experiment_id: str | None) -> str:
    if experiment_id is None:
        return ""
    return (
        f"Experiment: {experiment_id}\n"
        f"When using scripts/quest-runner, pass --experiment-id {experiment_id}.\n"
        "Do not omit the experiment id; the original quest worktree may not exist.\n\n"
    )


def interpolate_template(
    text: str,
    ctx: ProfileExecutionContext,
    *,
    allow_thread_vars: bool = False,
    validate_path_vars: bool = True,
) -> str:
    exposed = _exposed_path_vars(ctx)
    if validate_path_vars:
        _validate_path_vars(text, exposed)

    def replace_brace(match: re.Match[str]) -> str:
        key = match.group(1)
        spec = match.group(2)
        allowed = set(_ALWAYS_BRACE_VARS)
        if allow_thread_vars:
            allowed |= _THREAD_BRACE_VARS
        if key not in allowed:
            raise WorkflowTemplateError(f"Unknown template variable {{{key}}}")
        return _format_brace_value(ctx, key, spec)

    rendered = _BRACE_FORMAT_RE.sub(replace_brace, text)

    def replace_path(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in exposed:
            raise WorkflowTemplateError(
                f"Template references ${name} but profile runtime_context does not expose it"
            )
        return _path_var_value(ctx, name)

    return _PATH_VAR_RE.sub(replace_path, rendered)


def load_profile_prompt_text(workflow: WorkflowDefinition, profile: WorkflowProfile) -> str:
    prompt_path = workflow.resolve_profile_prompt_path(profile.name)
    return prompt_path.read_text(encoding="utf-8")


def render_preamble(ctx: ProfileExecutionContext) -> str:
    preamble_rel = ctx.workflow.preamble
    if preamble_rel is None:
        return ""
    preamble_path = (ctx.workflow.workflow_dir / preamble_rel).resolve()
    if not preamble_path.is_file():
        raise FatalInvariantError(f"Missing workflow preamble file: {preamble_path}")
    template = preamble_path.read_text(encoding="utf-8")
    return interpolate_template(template, ctx)


def build_workflow_message_body(ctx: ProfileExecutionContext, task_text: str) -> str:
    rendered_task = interpolate_template(task_text, ctx)
    preamble = render_preamble(ctx)
    if preamble:
        return f"{preamble}\n\nTask:\n{rendered_task}"
    return f"Task:\n{rendered_task}"


def build_workflow_first_round_message(
    ctx: ProfileExecutionContext,
    message_body: str,
) -> str:
    prompt_text = load_profile_prompt_text(ctx.workflow, ctx.profile)
    return f"{prompt_text}\n\n---\n\n{message_body}"


def render_thread_name(ctx: ProfileExecutionContext) -> str:
    return interpolate_template(
        ctx.profile.thread_name_template,
        ctx,
        allow_thread_vars=True,
        validate_path_vars=False,
    )


def render_thread_registry_key(ctx: ProfileExecutionContext) -> str:
    return interpolate_template(
        ctx.profile.thread_registry_key_template,
        ctx,
        allow_thread_vars=True,
        validate_path_vars=False,
    )
