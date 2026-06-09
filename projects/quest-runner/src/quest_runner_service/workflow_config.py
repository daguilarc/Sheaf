"""Load and validate quest-local workflow configuration directories."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import yaml

from .quest_types import HarnessKind

_PACKAGED_DEFAULT_WORKFLOW_DIR = (
    Path(__file__).resolve().parent / "default_workflow"
)

_THREAD_SCOPES = frozenset({"quest", "child", "machine", "node"})
_CHILD_RUN_MODES = frozenset({"one_step"})
_COLLECTION_ORDERS = frozenset({"lexical"})
_COLLECTION_ID_FROM = frozenset({"directory_name"})


class WorkflowValidationError(Exception):
    """Raised when workflow YAML fails structural or cross-reference validation."""

    def __init__(
        self,
        message: str,
        *,
        file: str | None = None,
        field_path: str | None = None,
    ) -> None:
        parts: list[str] = []
        if file:
            parts.append(f"file {file}")
        if field_path:
            parts.append(f"field {field_path}")
        prefix = f"({' '.join(parts)}) " if parts else ""
        super().__init__(f"{prefix}{message}")
        self.file = file
        self.field_path = field_path


@dataclass(frozen=True)
class WorkflowSpecial:
    completed_state: str
    human_intervention_file: str


@dataclass(frozen=True)
class WorkflowIssueDeclaration:
    alias: str
    path: str
    owner: str
    id_prefix: str | None = None


@dataclass(frozen=True)
class WorkflowCollection:
    name: str
    path: str
    machine: str
    order: str
    id_from: str
    active_var: str
    scaffold: list[Any]


@dataclass(frozen=True)
class WorkflowProfile:
    name: str
    source_path: Path
    harness: str
    model: str
    reasoning_effort: str | None
    idle_timeout_seconds: int
    prompt: str
    runtime_context: dict[str, bool]
    modify_allow: list[str]
    modify_block: list[str]
    thread_scope: str
    thread_name_template: str
    thread_registry_key_template: str


@dataclass(frozen=True)
class WorkflowState:
    name: str
    node_name: str | None
    persisted_as: str | None
    actions: list[Any]
    run: dict[str, Any] | None
    child: dict[str, Any] | None
    transitions: list[Any]
    terminal: bool


@dataclass(frozen=True)
class WorkflowMachine:
    key: str
    source_path: Path
    machine: str
    initial: str
    terminal: list[str]
    states: dict[str, WorkflowState]


@dataclass
class WorkflowDefinition:
    workflow_dir: Path
    version: int
    name: str
    entry_machine: str
    special: WorkflowSpecial
    preamble: str | None
    variables: dict[str, str]
    scaffold: list[Any]
    collections: dict[str, WorkflowCollection]
    issues: dict[str, WorkflowIssueDeclaration]
    machines: dict[str, WorkflowMachine]
    profiles: dict[str, WorkflowProfile]

    def get_machine(self, key: str) -> WorkflowMachine:
        try:
            return self.machines[key]
        except KeyError as e:
            raise KeyError(f"Unknown machine {key!r}") from e

    def get_profile(self, key: str) -> WorkflowProfile:
        try:
            return self.profiles[key]
        except KeyError as e:
            raise KeyError(f"Unknown profile {key!r}") from e

    def resolve_profile_prompt_path(self, profile_key: str) -> Path:
        profile = self.get_profile(profile_key)
        return (profile.source_path.parent / profile.prompt).resolve()

    def issue_declarations(self) -> list[WorkflowIssueDeclaration]:
        return list(self.issues.values())

    def collection_by_active_var(self, active_var: str) -> WorkflowCollection | None:
        for collection in self.collections.values():
            if collection.active_var == active_var:
                return collection
        return None

    def collection_by_path_pattern(self, path_pattern: str) -> WorkflowCollection | None:
        for collection in self.collections.values():
            if collection.path == path_pattern:
                return collection
        return None


def load_packaged_default_workflow() -> WorkflowDefinition:
    """Load the packaged default workflow directory shipped with quest-runner."""
    return load_workflow(_PACKAGED_DEFAULT_WORKFLOW_DIR)


def load_workflow(workflow_dir: Path) -> WorkflowDefinition:
    """Load and validate a workflow directory."""
    workflow_dir = workflow_dir.resolve()
    workflow_path = workflow_dir / "workflow.yaml"
    if not workflow_path.is_file():
        raise WorkflowValidationError(
            "missing workflow.yaml",
            file=str(workflow_path),
        )
    raw_any = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    if not isinstance(raw_any, dict):
        raise WorkflowValidationError(
            "workflow.yaml must be a mapping",
            file=str(workflow_path),
        )
    raw: dict[str, Any] = raw_any
    return _parse_workflow(workflow_dir, workflow_path, raw)


def _validation_error(
    message: str,
    *,
    file: str | Path | None = None,
    field_path: str | None = None,
) -> WorkflowValidationError:
    file_str = str(file) if file is not None else None
    return WorkflowValidationError(message, file=file_str, field_path=field_path)


def _require_mapping(
    value: Any,
    *,
    file: Path,
    field_path: str,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _validation_error(
            f"{field_path} must be a mapping, got {type(value).__name__}",
            file=file,
            field_path=field_path,
        )
    return value


def _require_str(
    value: Any,
    *,
    file: Path,
    field_path: str,
) -> str:
    if not isinstance(value, str) or not value:
        raise _validation_error(
            f"{field_path} must be a non-empty string",
            file=file,
            field_path=field_path,
        )
    return value


def _require_int(
    value: Any,
    *,
    file: Path,
    field_path: str,
) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise _validation_error(
            f"{field_path} must be an integer",
            file=file,
            field_path=field_path,
        )
    return value


def _require_list(
    value: Any,
    *,
    file: Path,
    field_path: str,
) -> list[Any]:
    if not isinstance(value, list):
        raise _validation_error(
            f"{field_path} must be a list",
            file=file,
            field_path=field_path,
        )
    return value


def _resolve_workflow_relative(workflow_dir: Path, rel_path: str) -> Path:
    return (workflow_dir / rel_path).resolve()


def _assert_quest_relative_path(
    path_value: str,
    *,
    file: Path,
    field_path: str,
) -> None:
    if not path_value:
        raise _validation_error(
            f"{field_path} must be a non-empty path",
            file=file,
            field_path=field_path,
        )
    candidate = Path(path_value)
    if candidate.is_absolute():
        raise _validation_error(
            f"{field_path} must be quest-relative, not absolute: {path_value!r}",
            file=file,
            field_path=field_path,
        )


def _collect_path_strings_from_action(action: Any) -> Iterator[str]:
    if isinstance(action, str):
        yield action
        return
    if not isinstance(action, dict):
        return
    if "ensure_file" in action:
        block = action["ensure_file"]
        if isinstance(block, dict) and isinstance(block.get("path"), str):
            yield block["path"]
        return
    if "ensure_dir" in action and isinstance(action["ensure_dir"], str):
        yield action["ensure_dir"]
        return
    if "remove_file" in action and isinstance(action["remove_file"], str):
        yield action["remove_file"]
        return
    if "set_var" in action:
        return
    if "clear_var" in action:
        return
    if "select_child" in action:
        return


def _collect_path_strings_from_condition(condition: Any) -> Iterator[str]:
    if not isinstance(condition, dict):
        return
    for key in ("exists", "file_exists", "dir_exists", "not_exists"):
        value = condition.get(key)
        if isinstance(value, str):
            yield value
    file_count = condition.get("file_count_at_least")
    if isinstance(file_count, dict):
        glob_value = file_count.get("glob")
        if isinstance(glob_value, str):
            yield glob_value
    for issue_key in ("has_open_issues", "no_open_issues"):
        issue_block = condition.get(issue_key)
        if isinstance(issue_block, dict):
            file_value = issue_block.get("file")
            if isinstance(file_value, str):
                yield file_value
    for composite_key in ("all", "any"):
        items = condition.get(composite_key)
        if isinstance(items, list):
            for item in items:
                yield from _collect_path_strings_from_condition(item)
    not_block = condition.get("not")
    if not_block is not None:
        yield from _collect_path_strings_from_condition(not_block)
    all_children = condition.get("all_children")
    if isinstance(all_children, dict):
        require = all_children.get("require")
        if isinstance(require, list):
            for item in require:
                yield from _collect_path_strings_from_condition(item)


def _condition_uses_child_result(condition: Any) -> bool:
    if not isinstance(condition, dict):
        return False
    if "child_result" in condition:
        return True
    for composite_key in ("all", "any"):
        items = condition.get(composite_key)
        if isinstance(items, list):
            for item in items:
                if _condition_uses_child_result(item):
                    return True
    not_block = condition.get("not")
    if not_block is not None and _condition_uses_child_result(not_block):
        return True
    return False


def _parse_profile(
    workflow_dir: Path,
    profile_key: str,
    rel_path: str,
) -> WorkflowProfile:
    source_path = _resolve_workflow_relative(workflow_dir, rel_path)
    if not source_path.is_file():
        raise _validation_error(
            f"profile file not found for {profile_key!r}",
            file=source_path,
            field_path=f"profiles.{profile_key}",
        )
    raw_any = yaml.safe_load(source_path.read_text(encoding="utf-8"))
    if not isinstance(raw_any, dict):
        raise _validation_error(
            "profile must be a mapping",
            file=source_path,
            field_path=f"profiles.{profile_key}",
        )
    raw: dict[str, Any] = raw_any
    harness = _require_str(
        raw.get("harness"),
        file=source_path,
        field_path="harness",
    )
    try:
        HarnessKind(harness)
    except ValueError as e:
        raise _validation_error(
            f"unknown harness {harness!r}",
            file=source_path,
            field_path="harness",
        ) from e
    model = _require_str(raw.get("model"), file=source_path, field_path="model")
    reasoning_effort = raw.get("reasoning_effort")
    if reasoning_effort is not None and not isinstance(reasoning_effort, str):
        raise _validation_error(
            "reasoning_effort must be a string or null",
            file=source_path,
            field_path="reasoning_effort",
        )
    idle_timeout_seconds = _require_int(
        raw.get("idle_timeout_seconds"),
        file=source_path,
        field_path="idle_timeout_seconds",
    )
    prompt = _require_str(raw.get("prompt"), file=source_path, field_path="prompt")
    prompt_path = (source_path.parent / prompt).resolve()
    if not prompt_path.is_file():
        raise _validation_error(
            f"missing prompt file: {prompt}",
            file=source_path,
            field_path="prompt",
        )
    runtime_context_raw = raw.get("runtime_context", {})
    if runtime_context_raw is None:
        runtime_context_raw = {}
    if not isinstance(runtime_context_raw, dict):
        raise _validation_error(
            "runtime_context must be a mapping",
            file=source_path,
            field_path="runtime_context",
        )
    runtime_context: dict[str, bool] = {}
    for key, value in runtime_context_raw.items():
        if not isinstance(key, str) or not isinstance(value, bool):
            raise _validation_error(
                "runtime_context values must be booleans",
                file=source_path,
                field_path=f"runtime_context.{key}",
            )
        runtime_context[key] = value
    modify = _require_mapping(
        raw.get("modify", {}),
        file=source_path,
        field_path="modify",
    )
    modify_allow_raw = modify.get("allow", [])
    modify_block_raw = modify.get("block", [])
    modify_allow = _require_list(
        modify_allow_raw,
        file=source_path,
        field_path="modify.allow",
    )
    modify_block = _require_list(
        modify_block_raw,
        file=source_path,
        field_path="modify.block",
    )
    for index, pattern in enumerate(modify_allow):
        if not isinstance(pattern, str):
            raise _validation_error(
                f"modify.allow[{index}] must be a string",
                file=source_path,
                field_path=f"modify.allow[{index}]",
            )
        if Path(pattern).is_absolute():
            raise _validation_error(
                f"modify.allow[{index}] must not be absolute",
                file=source_path,
                field_path=f"modify.allow[{index}]",
            )
    for index, pattern in enumerate(modify_block):
        if not isinstance(pattern, str):
            raise _validation_error(
                f"modify.block[{index}] must be a string",
                file=source_path,
                field_path=f"modify.block[{index}]",
            )
        if Path(pattern).is_absolute():
            raise _validation_error(
                f"modify.block[{index}] must not be absolute",
                file=source_path,
                field_path=f"modify.block[{index}]",
            )
    thread = _require_mapping(raw.get("thread"), file=source_path, field_path="thread")
    thread_scope = _require_str(
        thread.get("scope"),
        file=source_path,
        field_path="thread.scope",
    )
    if thread_scope not in _THREAD_SCOPES:
        raise _validation_error(
            f"unknown thread.scope {thread_scope!r}",
            file=source_path,
            field_path="thread.scope",
        )
    thread_name_template = _require_str(
        thread.get("name_template"),
        file=source_path,
        field_path="thread.name_template",
    )
    thread_registry_key_template = _require_str(
        thread.get("registry_key_template"),
        file=source_path,
        field_path="thread.registry_key_template",
    )
    return WorkflowProfile(
        name=profile_key,
        source_path=source_path,
        harness=harness,
        model=model,
        reasoning_effort=reasoning_effort,
        idle_timeout_seconds=idle_timeout_seconds,
        prompt=prompt,
        runtime_context=runtime_context,
        modify_allow=[str(p) for p in modify_allow],
        modify_block=[str(p) for p in modify_block],
        thread_scope=thread_scope,
        thread_name_template=thread_name_template,
        thread_registry_key_template=thread_registry_key_template,
    )


def _parse_state(
    state_name: str,
    raw: dict[str, Any],
    *,
    file: Path,
) -> WorkflowState:
    node_name = raw.get("node_name")
    if node_name is not None and not isinstance(node_name, str):
        raise _validation_error(
            "node_name must be a string or null",
            file=file,
            field_path=f"states.{state_name}.node_name",
        )
    persisted_as = raw.get("persisted_as")
    if persisted_as is not None and not isinstance(persisted_as, str):
        raise _validation_error(
            "persisted_as must be a string or null",
            file=file,
            field_path=f"states.{state_name}.persisted_as",
        )
    actions = _require_list(
        raw.get("actions", []),
        file=file,
        field_path=f"states.{state_name}.actions",
    )
    run = raw.get("run")
    if run is not None and not isinstance(run, dict):
        raise _validation_error(
            "run must be a mapping or null",
            file=file,
            field_path=f"states.{state_name}.run",
        )
    child = raw.get("child")
    if child is not None and not isinstance(child, dict):
        raise _validation_error(
            "child must be a mapping or null",
            file=file,
            field_path=f"states.{state_name}.child",
        )
    transitions = _require_list(
        raw.get("transitions", []),
        file=file,
        field_path=f"states.{state_name}.transitions",
    )
    terminal = raw.get("terminal", False)
    if not isinstance(terminal, bool):
        raise _validation_error(
            "terminal must be a boolean",
            file=file,
            field_path=f"states.{state_name}.terminal",
        )
    for action in actions:
        for path_value in _collect_path_strings_from_action(action):
            _assert_quest_relative_path(
                path_value,
                file=file,
                field_path=f"states.{state_name}.actions",
            )
    return WorkflowState(
        name=state_name,
        node_name=node_name,
        persisted_as=persisted_as,
        actions=actions,
        run=run,
        child=child,
        transitions=transitions,
        terminal=terminal,
    )


def _parse_machine(
    workflow_dir: Path,
    machine_key: str,
    rel_path: str,
) -> WorkflowMachine:
    source_path = _resolve_workflow_relative(workflow_dir, rel_path)
    if not source_path.is_file():
        raise _validation_error(
            f"machine file not found for {machine_key!r}",
            file=source_path,
            field_path=f"machines.{machine_key}",
        )
    raw_any = yaml.safe_load(source_path.read_text(encoding="utf-8"))
    if not isinstance(raw_any, dict):
        raise _validation_error(
            "machine must be a mapping",
            file=source_path,
        )
    raw: dict[str, Any] = raw_any
    machine_name = _require_str(raw.get("machine"), file=source_path, field_path="machine")
    if machine_name != machine_key:
        raise _validation_error(
            f"machine field {machine_name!r} does not match key {machine_key!r}",
            file=source_path,
            field_path="machine",
        )
    initial = _require_str(raw.get("initial"), file=source_path, field_path="initial")
    terminal_raw = raw.get("terminal", [])
    terminal = _require_list(terminal_raw, file=source_path, field_path="terminal")
    terminal_names = [str(item) for item in terminal]
    states_raw = _require_mapping(raw.get("states"), file=source_path, field_path="states")
    states: dict[str, WorkflowState] = {}
    for state_name, state_def in states_raw.items():
        if not isinstance(state_name, str):
            raise _validation_error(
                "state names must be strings",
                file=source_path,
                field_path="states",
            )
        state_mapping = _require_mapping(
            state_def,
            file=source_path,
            field_path=f"states.{state_name}",
        )
        states[state_name] = _parse_state(state_name, state_mapping, file=source_path)
    if initial not in states:
        raise _validation_error(
            f"initial state {initial!r} is not declared",
            file=source_path,
            field_path="initial",
        )
    for terminal_name in terminal_names:
        if terminal_name not in states:
            raise _validation_error(
                f"terminal state {terminal_name!r} is not declared",
                file=source_path,
                field_path="terminal",
            )
    return WorkflowMachine(
        key=machine_key,
        source_path=source_path,
        machine=machine_name,
        initial=initial,
        terminal=terminal_names,
        states=states,
    )


def _parse_collection(
    name: str,
    raw: dict[str, Any],
    *,
    file: Path,
) -> WorkflowCollection:
    path = _require_str(raw.get("path"), file=file, field_path=f"collections.{name}.path")
    _assert_quest_relative_path(
        path,
        file=file,
        field_path=f"collections.{name}.path",
    )
    machine = _require_str(
        raw.get("machine"),
        file=file,
        field_path=f"collections.{name}.machine",
    )
    order = _require_str(raw.get("order"), file=file, field_path=f"collections.{name}.order")
    if order not in _COLLECTION_ORDERS:
        raise _validation_error(
            f"unknown collection order {order!r}",
            file=file,
            field_path=f"collections.{name}.order",
        )
    id_from = _require_str(
        raw.get("id_from"),
        file=file,
        field_path=f"collections.{name}.id_from",
    )
    if id_from not in _COLLECTION_ID_FROM:
        raise _validation_error(
            f"unknown collection id_from {id_from!r}",
            file=file,
            field_path=f"collections.{name}.id_from",
        )
    active_var = _require_str(
        raw.get("active_var"),
        file=file,
        field_path=f"collections.{name}.active_var",
    )
    scaffold = _require_list(
        raw.get("scaffold", []),
        file=file,
        field_path=f"collections.{name}.scaffold",
    )
    for action in scaffold:
        for path_value in _collect_path_strings_from_action(action):
            _assert_quest_relative_path(
                path_value,
                file=file,
                field_path=f"collections.{name}.scaffold",
            )
    return WorkflowCollection(
        name=name,
        path=path,
        machine=machine,
        order=order,
        id_from=id_from,
        active_var=active_var,
        scaffold=scaffold,
    )


def _parse_workflow(
    workflow_dir: Path,
    workflow_path: Path,
    raw: dict[str, Any],
) -> WorkflowDefinition:
    version = _require_int(raw.get("version"), file=workflow_path, field_path="version")
    name = _require_str(raw.get("name"), file=workflow_path, field_path="name")
    entry_machine = raw.get("entry_machine")
    if not isinstance(entry_machine, str) or not entry_machine:
        raise _validation_error(
            "entry_machine is required",
            file=workflow_path,
            field_path="entry_machine",
        )
    special_raw = _require_mapping(
        raw.get("special", {}),
        file=workflow_path,
        field_path="special",
    )
    completed_state = _require_str(
        special_raw.get("completed_state", "Completed"),
        file=workflow_path,
        field_path="special.completed_state",
    )
    human_intervention_file = _require_str(
        special_raw.get("human_intervention_file", "human_intervention_request.md"),
        file=workflow_path,
        field_path="special.human_intervention_file",
    )
    _assert_quest_relative_path(
        human_intervention_file,
        file=workflow_path,
        field_path="special.human_intervention_file",
    )
    preamble = raw.get("preamble")
    if preamble is not None:
        preamble = _require_str(preamble, file=workflow_path, field_path="preamble")
        preamble_path = _resolve_workflow_relative(workflow_dir, preamble)
        if not preamble_path.is_file():
            raise _validation_error(
                f"missing preamble file: {preamble}",
                file=workflow_path,
                field_path="preamble",
            )
    variables_raw = raw.get("variables", {})
    if variables_raw is None:
        variables_raw = {}
    variables_map = _require_mapping(
        variables_raw,
        file=workflow_path,
        field_path="variables",
    )
    variables: dict[str, str] = {}
    for key, value in variables_map.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise _validation_error(
                "variables entries must be string keys and string values",
                file=workflow_path,
                field_path=f"variables.{key}",
            )
        variables[key] = value
    scaffold = _require_list(raw.get("scaffold", []), file=workflow_path, field_path="scaffold")
    for action in scaffold:
        for path_value in _collect_path_strings_from_action(action):
            _assert_quest_relative_path(
                path_value,
                file=workflow_path,
                field_path="scaffold",
            )
    collections_raw = _require_mapping(
        raw.get("collections", {}),
        file=workflow_path,
        field_path="collections",
    )
    collections: dict[str, WorkflowCollection] = {}
    for collection_name, collection_def in collections_raw.items():
        collection_mapping = _require_mapping(
            collection_def,
            file=workflow_path,
            field_path=f"collections.{collection_name}",
        )
        collections[str(collection_name)] = _parse_collection(
            str(collection_name),
            collection_mapping,
            file=workflow_path,
        )
    issues_raw = _require_mapping(raw.get("issues", {}), file=workflow_path, field_path="issues")
    issues: dict[str, WorkflowIssueDeclaration] = {}
    for issue_alias, issue_def in issues_raw.items():
        issue_mapping = _require_mapping(
            issue_def,
            file=workflow_path,
            field_path=f"issues.{issue_alias}",
        )
        issue_path = _require_str(
            issue_mapping.get("path"),
            file=workflow_path,
            field_path=f"issues.{issue_alias}.path",
        )
        if Path(issue_path).is_absolute():
            raise _validation_error(
                f"issues.{issue_alias}.path must be quest-relative",
                file=workflow_path,
                field_path=f"issues.{issue_alias}.path",
            )
        owner = _require_str(
            issue_mapping.get("owner"),
            file=workflow_path,
            field_path=f"issues.{issue_alias}.owner",
        )
        id_prefix = issue_mapping.get("id_prefix")
        if id_prefix is not None and not isinstance(id_prefix, str):
            raise _validation_error(
                "id_prefix must be a string",
                file=workflow_path,
                field_path=f"issues.{issue_alias}.id_prefix",
            )
        issues[str(issue_alias)] = WorkflowIssueDeclaration(
            alias=str(issue_alias),
            path=issue_path,
            owner=owner,
            id_prefix=id_prefix,
        )
    machines_raw = _require_mapping(
        raw.get("machines", {}),
        file=workflow_path,
        field_path="machines",
    )
    machines: dict[str, WorkflowMachine] = {}
    for machine_key, machine_path in machines_raw.items():
        if not isinstance(machine_key, str) or not isinstance(machine_path, str):
            raise _validation_error(
                "machines entries must be string keys and string paths",
                file=workflow_path,
                field_path="machines",
            )
        _assert_quest_relative_path(
            machine_path,
            file=workflow_path,
            field_path=f"machines.{machine_key}",
        )
        machines[machine_key] = _parse_machine(workflow_dir, machine_key, machine_path)
    profiles_raw = _require_mapping(
        raw.get("profiles", {}),
        file=workflow_path,
        field_path="profiles",
    )
    profiles: dict[str, WorkflowProfile] = {}
    for profile_key, profile_path in profiles_raw.items():
        if not isinstance(profile_key, str) or not isinstance(profile_path, str):
            raise _validation_error(
                "profiles entries must be string keys and string paths",
                file=workflow_path,
                field_path="profiles",
            )
        _assert_quest_relative_path(
            profile_path,
            file=workflow_path,
            field_path=f"profiles.{profile_key}",
        )
        profiles[profile_key] = _parse_profile(workflow_dir, profile_key, profile_path)
    definition = WorkflowDefinition(
        workflow_dir=workflow_dir,
        version=version,
        name=name,
        entry_machine=entry_machine,
        special=WorkflowSpecial(
            completed_state=completed_state,
            human_intervention_file=human_intervention_file,
        ),
        preamble=preamble,
        variables=variables,
        scaffold=scaffold,
        collections=collections,
        issues=issues,
        machines=machines,
        profiles=profiles,
    )
    _validate_cross_references(definition, workflow_path)
    return definition


def _validate_cross_references(definition: WorkflowDefinition, workflow_path: Path) -> None:
    if definition.entry_machine not in definition.machines:
        raise _validation_error(
            f"entry_machine {definition.entry_machine!r} is not declared in machines",
            file=workflow_path,
            field_path="entry_machine",
        )
    profile_names = set(definition.profiles.keys())
    collection_names = set(definition.collections.keys())
    for collection in definition.collections.values():
        if collection.machine not in definition.machines:
            raise _validation_error(
                f"collection {collection.name!r} references unknown machine "
                f"{collection.machine!r}",
                file=workflow_path,
                field_path=f"collections.{collection.name}.machine",
            )
    for machine in definition.machines.values():
        _validate_machine_cross_references(
            machine,
            profile_names=profile_names,
            collection_names=collection_names,
        )


def _validate_machine_cross_references(
    machine: WorkflowMachine,
    *,
    profile_names: set[str],
    collection_names: set[str],
) -> None:
    state_names = set(machine.states.keys())
    persisted_values: dict[str, str] = {}
    for state in machine.states.values():
        if state.persisted_as is not None:
            if state.persisted_as in persisted_values:
                raise _validation_error(
                    f"duplicate persisted_as value {state.persisted_as!r}",
                    file=machine.source_path,
                    field_path=f"states.{state.name}.persisted_as",
                )
            if state.persisted_as in state_names and state.persisted_as != state.name:
                raise _validation_error(
                    f"persisted_as {state.persisted_as!r} collides with logical state id",
                    file=machine.source_path,
                    field_path=f"states.{state.name}.persisted_as",
                )
            persisted_values[state.persisted_as] = state.name
        if state.run is not None:
            profile_name = state.run.get("profile")
            if not isinstance(profile_name, str) or profile_name not in profile_names:
                raise _validation_error(
                    f"unknown run.profile {profile_name!r}",
                    file=machine.source_path,
                    field_path=f"states.{state.name}.run.profile",
                )
        if state.child is not None:
            collection_name = state.child.get("collection")
            if (
                not isinstance(collection_name, str)
                or collection_name not in collection_names
            ):
                raise _validation_error(
                    f"unknown child.collection {collection_name!r}",
                    file=machine.source_path,
                    field_path=f"states.{state.name}.child.collection",
                )
            run_mode = state.child.get("run")
            if run_mode is not None and run_mode not in _CHILD_RUN_MODES:
                raise _validation_error(
                    f"unknown child.run mode {run_mode!r}",
                    file=machine.source_path,
                    field_path=f"states.{state.name}.child.run",
                )
        for action_index, action in enumerate(state.actions):
            if isinstance(action, dict) and "select_child" in action:
                select_block = action["select_child"]
                if isinstance(select_block, dict):
                    collection_name = select_block.get("collection")
                    if (
                        not isinstance(collection_name, str)
                        or collection_name not in collection_names
                    ):
                        raise _validation_error(
                            f"unknown select_child.collection {collection_name!r}",
                            file=machine.source_path,
                            field_path=(
                                f"states.{state.name}.actions[{action_index}]"
                                ".select_child.collection"
                            ),
                        )
        has_child_block = state.child is not None
        for index, transition in enumerate(state.transitions):
            if not isinstance(transition, dict):
                raise _validation_error(
                    f"transition[{index}] must be a mapping",
                    file=machine.source_path,
                    field_path=f"states.{state.name}.transitions[{index}]",
                )
            condition = transition.get("if")
            if condition is not None and _condition_uses_child_result(condition):
                if not has_child_block:
                    raise _validation_error(
                        "child_result condition requires a child block on the same state",
                        file=machine.source_path,
                        field_path=f"states.{state.name}.transitions[{index}].if",
                    )
            if condition is not None:
                _validate_condition_references(
                    condition,
                    machine=machine,
                    collection_names=collection_names,
                    file=machine.source_path,
                    field_path=f"states.{state.name}.transitions[{index}].if",
                )
            target = transition.get("to")
            if target is not None:
                if not isinstance(target, str) or target not in state_names:
                    raise _validation_error(
                        f"transition target {target!r} is not a declared state",
                        file=machine.source_path,
                        field_path=f"states.{state.name}.transitions[{index}].to",
                    )
                for path_value in _collect_path_strings_from_condition(condition):
                    _assert_quest_relative_path(
                        path_value,
                        file=machine.source_path,
                        field_path=f"states.{state.name}.transitions[{index}].if",
                    )
                for action in transition.get("actions", []):
                    for path_value in _collect_path_strings_from_action(action):
                        _assert_quest_relative_path(
                            path_value,
                            file=machine.source_path,
                            field_path=f"states.{state.name}.transitions[{index}].actions",
                        )


def _validate_condition_references(
    condition: Any,
    *,
    machine: WorkflowMachine,
    collection_names: set[str],
    file: Path,
    field_path: str,
) -> None:
    if not isinstance(condition, dict):
        return
    for collection_key in ("child_dirs_exist", "all_children"):
        block = condition.get(collection_key)
        if isinstance(block, dict):
            collection_name = block.get("collection")
            if (
                not isinstance(collection_name, str)
                or collection_name not in collection_names
            ):
                raise _validation_error(
                    f"unknown collection {collection_name!r}",
                    file=file,
                    field_path=f"{field_path}.{collection_key}.collection",
                )
    select_child = condition.get("select_child")
    if isinstance(select_child, dict):
        collection_name = select_child.get("collection")
        if (
            not isinstance(collection_name, str)
            or collection_name not in collection_names
        ):
            raise _validation_error(
                f"unknown collection {collection_name!r}",
                file=file,
                field_path=f"{field_path}.select_child.collection",
            )
    for composite_key in ("all", "any"):
        items = condition.get(composite_key)
        if isinstance(items, list):
            for sub_index, item in enumerate(items):
                _validate_condition_references(
                    item,
                    machine=machine,
                    collection_names=collection_names,
                    file=file,
                    field_path=f"{field_path}.{composite_key}[{sub_index}]",
                )
    not_block = condition.get("not")
    if not_block is not None:
        _validate_condition_references(
            not_block,
            machine=machine,
            collection_names=collection_names,
            file=file,
            field_path=f"{field_path}.not",
        )
    for path_value in _collect_path_strings_from_condition(condition):
        if Path(path_value).is_absolute():
            raise _validation_error(
                f"path must be quest-relative, not absolute: {path_value!r}",
                file=file,
                field_path=field_path,
            )
