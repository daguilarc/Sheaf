"""Filesystem read/write helpers for quest and slice layout."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from .quest_types import (
    ExecutionProfile,
    HarnessKind,
    IssueEntry,
    IssueResponseEntry,
    ProjectQuestRoot,
    QuestMeta,
    QuestState,
    QuestStateInfo,
    SliceState,
    SliceStateInfo,
    StateMachineState,
    TransitionRecord,
    slice_index_from_dirname,
)

_HISTORY_HEADING_RE = re.compile(r"^## (\d{4}-\d{2}-\d{2}T\S+)\s*$", re.MULTILINE)
_ISSUE_HEADING_RE = re.compile(r"^## Issue\s+(\S+)\s*$", re.MULTILINE)
_RESPONSE_SECTION_RE = re.compile(
    r"^## Response\s+(\S+)\s+(.+)\s*$",
    re.MULTILINE,
)
_DOLLAR_TOKEN_RE = re.compile(r"\$[a-zA-Z_][a-zA-Z0-9_]*")
_ALLOWED_MODIFY_PATH_PLACEHOLDERS: frozenset[str] = frozenset(
    {"$currentQuest", "$currentSlice", "$currentProject"}
)


class QuestStateParseError(ValueError):
    """Raised when a quest or slice state markdown file is malformed."""

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)


def project_quest_root(repo_root: Path, project: str) -> Path:
    return repo_root / "projects" / project / "quests"


def iter_project_quest_roots(repo_root: Path) -> list[ProjectQuestRoot]:
    projects_dir = repo_root / "projects"
    if not projects_dir.is_dir():
        return []
    found: list[ProjectQuestRoot] = []
    for entry in sorted(projects_dir.iterdir(), key=lambda p: p.name):
        if not entry.is_dir():
            continue
        quests = entry / "quests"
        if quests.is_dir():
            found.append(ProjectQuestRoot(project=entry.name, path=quests))
    return found


def _project_from_quest_dir_path(quest_dir: Path) -> str | None:
    parts = quest_dir.resolve().parts
    for i, part in enumerate(parts):
        if (
            part == "projects"
            and i + 3 < len(parts)
            and parts[i + 2] == "quests"
        ):
            return parts[i + 1]
    return None


def _is_project_local_quest_dir(quest_dir: Path) -> bool:
    return _project_from_quest_dir_path(quest_dir) is not None


def find_quest_dir(
    repo_root: Path,
    project: str,
    quest_type: str,
    quest_number: int,
) -> Path | None:
    base = project_quest_root(repo_root, project) / quest_type
    if not base.is_dir():
        return None
    for p in sorted(base.iterdir(), key=lambda x: x.name):
        if not p.is_dir():
            continue
        idx = slice_index_from_dirname(p.name)
        if idx == quest_number:
            return p
    return None


def list_quest_dirs(
    repo_root: Path,
    project: str,
    quest_type: str,
) -> list[Path]:
    base = project_quest_root(repo_root, project) / quest_type
    if not base.is_dir():
        return []
    found: list[tuple[int, Path]] = []
    for p in base.iterdir():
        if not p.is_dir():
            continue
        idx = slice_index_from_dirname(p.name)
        if idx is not None:
            found.append((idx, p))
    return [p for _, p in sorted(found, key=lambda t: t[0])]


def list_slice_dirs(quest_dir: Path) -> list[Path]:
    slices = quest_dir / "slices"
    if not slices.is_dir():
        return []
    found: list[tuple[int, Path]] = []
    for p in slices.iterdir():
        if not p.is_dir():
            continue
        idx = slice_index_from_dirname(p.name)
        if idx is not None:
            found.append((idx, p))
    return [p for _, p in sorted(found, key=lambda t: t[0])]


def _parse_kv_lines(
    body: str,
    required_keys: set[str],
    label: str,
) -> dict[str, str]:
    found: dict[str, str] = {}
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise QuestStateParseError(f"{label}: expected 'key: value' line, got {raw!r}")
        key, _, rest = line.partition(":")
        key = key.strip()
        value = rest.strip()
        if key in found:
            raise QuestStateParseError(f"{label}: duplicate key {key!r}")
        found[key] = value
    missing = required_keys - found.keys()
    if missing:
        raise QuestStateParseError(
            f"{label}: missing required key(s): {', '.join(sorted(missing))}"
        )
    return found


def _parse_bullet_kv_lines(
    body: str,
    required_keys: set[str],
    label: str,
) -> dict[str, str]:
    found: dict[str, str] = {}
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("- "):
            line = line[2:].strip()
        if ":" not in line:
            raise QuestStateParseError(
                f"{label}: expected '- key: value' line, got {raw!r}"
            )
        key, _, rest = line.partition(":")
        key = key.strip()
        value = rest.strip()
        if key in found:
            raise QuestStateParseError(f"{label}: duplicate key {key!r}")
        found[key] = value
    missing = required_keys - found.keys()
    if missing:
        raise QuestStateParseError(
            f"{label}: missing required key(s): {', '.join(sorted(missing))}"
        )
    return found


_NORMALIZED_STATE_HEADING = "# State"
_TAGS_HEADING = "## Tags"
_ALLOWED_STATE_BODY_KEYS = frozenset(
    {"state", "machine_name", "machine_path", "updated_at", "global_step"}
)


def _posix_machine_path(raw: str) -> str:
    p = raw.replace("\\", "/").strip()
    while p.startswith("./"):
        p = p[2:]
    while p.startswith("/"):
        p = p[1:]
    while "//" in p:
        p = p.replace("//", "/")
    return p


def parse_normalized_state_md_text(
    text: str,
    *,
    require_global_step: bool,
    label: str,
) -> StateMachineState:
    """Parse spec-normalized ``# State`` / ``## Tags`` markdown into ``StateMachineState``."""
    lines = text.splitlines()
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines) or lines[i].strip() != _NORMALIZED_STATE_HEADING:
        raise QuestStateParseError(
            f"{label}: expected first non-empty line to be {_NORMALIZED_STATE_HEADING!r}"
        )
    i += 1
    body_lines: list[str] = []
    tags_lines: list[str] = []
    mode = "state"
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if stripped == _TAGS_HEADING:
            mode = "tags"
            i += 1
            continue
        if stripped.startswith("#") and mode == "state":
            raise QuestStateParseError(
                f"{label}: unexpected heading {stripped!r} before {_TAGS_HEADING}"
            )
        if mode == "state":
            body_lines.append(raw)
        else:
            tags_lines.append(raw)
        i += 1
    if mode != "tags":
        raise QuestStateParseError(f"{label}: missing required {_TAGS_HEADING} section")
    state_body = "\n".join(body_lines)
    tags_body = "\n".join(tags_lines)
    kv = _parse_bullet_kv_lines(
        state_body,
        {"state", "machine_name", "machine_path", "updated_at"},
        label,
    )
    unknown = set(kv.keys()) - _ALLOWED_STATE_BODY_KEYS
    if unknown:
        raise QuestStateParseError(f"{label}: unknown key(s) in state block: {sorted(unknown)}")
    global_step: int | None
    gs_raw = kv.get("global_step")
    if gs_raw is None:
        global_step = None
    else:
        try:
            global_step = int(gs_raw)
        except ValueError as e:
            raise QuestStateParseError(
                f"{label}: global_step must be an integer, got {gs_raw!r}"
            ) from e
    if require_global_step and global_step is None:
        raise QuestStateParseError(f"{label}: missing required global_step for top-level machine")
    tags: dict[str, str] = {}
    if tags_body.strip():
        tags = _parse_bullet_kv_lines(tags_body, set(), f"{label} tags")
    return StateMachineState(
        machine_name=kv["machine_name"],
        machine_path=_posix_machine_path(kv["machine_path"]),
        state=kv["state"],
        global_step=global_step,
        tags=tags,
        updated_at=kv["updated_at"],
    )


def format_normalized_state_md(state: StateMachineState) -> str:
    """Render normalized ``state.md`` with deterministic key ordering."""
    mp = _posix_machine_path(state.machine_path)
    main_keys: list[tuple[str, str]] = []
    if state.global_step is not None:
        main_keys.append(("global_step", str(state.global_step)))
    main_keys.append(("machine_name", state.machine_name))
    main_keys.append(("machine_path", mp))
    main_keys.append(("state", state.state))
    main_keys.append(("updated_at", state.updated_at))
    main_lines = [f"- {k}: {v}" for k, v in main_keys]
    tag_lines = [f"- {k}: {state.tags[k]}" for k in sorted(state.tags)]
    parts = [
        _NORMALIZED_STATE_HEADING,
        "",
        *main_lines,
        "",
        _TAGS_HEADING,
        "",
    ]
    parts.extend(tag_lines)
    if tag_lines:
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def read_normalized_machine_state(
    state_machine_dir: Path, *, require_global_step: bool
) -> StateMachineState:
    path = state_machine_dir / "state.md"
    if not path.is_file():
        raise FileNotFoundError(f"Missing state machine state file: {path}")
    text = path.read_text(encoding="utf-8")
    return parse_normalized_state_md_text(
        text,
        require_global_step=require_global_step,
        label=f"normalized state file {path}",
    )


def write_normalized_machine_state(state_machine_dir: Path, state: StateMachineState) -> None:
    path = state_machine_dir / "state.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(format_normalized_state_md(state), encoding="utf-8")


def _read_quest_state_normalized(path: Path, text: str) -> QuestStateInfo:
    sm = parse_normalized_state_md_text(
        text,
        require_global_step=False,
        label=f"normalized quest state file {path}",
    )
    try:
        state = QuestState(sm.state)
    except ValueError as e:
        raise QuestStateParseError(
            f"Invalid quest state value {sm.state!r} in {path}"
        ) from e
    active_slice = sm.tags.get("active_slice")
    if active_slice is not None:
        active_slice = active_slice.strip()
        if not active_slice:
            active_slice = None
    current_slice: int | None = None
    if state == QuestState.ExecuteSlice:
        if not active_slice:
            raise QuestStateParseError(
                f"Quest state {path}: normalized ExecuteSlice requires tags.active_slice"
            )
        idx = slice_index_from_dirname(active_slice)
        if idx is None:
            raise QuestStateParseError(
                f"Quest state {path}: active_slice {active_slice!r} must start "
                "with a four-digit slice index prefix"
            )
        current_slice = idx
    return QuestStateInfo(
        state=state,
        current_slice=current_slice,
        updated_at=sm.updated_at,
        active_slice=active_slice,
        global_step=sm.global_step,
    )


def read_quest_state(quest_dir: Path) -> QuestStateInfo:
    path = quest_dir / "state.md"
    if not path.is_file():
        raise FileNotFoundError(f"Missing quest state file: {path}")
    text = path.read_text(encoding="utf-8")
    first: str | None = None
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        first = s
        break
    if first is None:
        raise QuestStateParseError(f"Quest state file {path} is empty")
    if first == _NORMALIZED_STATE_HEADING:
        return _read_quest_state_normalized(path, text)
    if first != "# Quest State":
        raise QuestStateParseError(
            f"Quest state file {path} must begin with '# Quest State' or "
            f"{_NORMALIZED_STATE_HEADING!r} as the first non-empty line "
            f"(found {first!r})"
        )
    kv = _parse_kv_lines(
        text,
        {"state", "current_slice", "updated_at"},
        f"quest state file {path}",
    )
    try:
        state = QuestState(kv["state"])
    except ValueError as e:
        raise QuestStateParseError(
            f"Invalid quest state value {kv['state']!r} in {path}"
        ) from e
    cs_raw = kv["current_slice"].strip().lower()
    if cs_raw == "null":
        current_slice: int | None = None
    else:
        try:
            current_slice = int(kv["current_slice"].strip())
        except ValueError as e:
            raise QuestStateParseError(
                f"Invalid current_slice {kv['current_slice']!r} in {path} "
                "(expected integer or null)"
            ) from e
    if state == QuestState.ExecuteSlice and current_slice is None:
        raise QuestStateParseError(
            f"Quest state {path}: ExecuteSlice requires a concrete current_slice "
            "(got null)"
        )
    if state != QuestState.ExecuteSlice and current_slice is not None:
        raise QuestStateParseError(
            f"Quest state {path}: current_slice must be null when state is "
            f"{state.value} (got {current_slice})"
        )
    active_slice = kv.get("active_slice")
    if active_slice is not None:
        active_slice = active_slice.strip()
        if not active_slice:
            active_slice = None
    gs_raw = kv.get("global_step")
    global_step: int | None = None
    if gs_raw is not None:
        try:
            global_step = int(gs_raw.strip())
        except ValueError as e:
            raise QuestStateParseError(
                f"Invalid global_step {gs_raw!r} in {path}"
            ) from e
    return QuestStateInfo(
        state=state,
        current_slice=current_slice,
        updated_at=kv["updated_at"],
        active_slice=active_slice,
        global_step=global_step,
    )


def read_slice_state(slice_dir: Path) -> SliceStateInfo:
    path = slice_dir / "state.md"
    if not path.is_file():
        raise FileNotFoundError(f"Missing slice state file: {path}")
    text = path.read_text(encoding="utf-8")
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        if s != "# Slice State":
            raise QuestStateParseError(
                f"Slice state file {path} must begin with '# Slice State' "
                f"as the first non-empty line (found {s!r})"
            )
        break
    else:
        raise QuestStateParseError(f"Slice state file {path} is empty")
    kv = _parse_kv_lines(
        text,
        {"state", "updated_at"},
        f"slice state file {path}",
    )
    try:
        state = SliceState(kv["state"])
    except ValueError as e:
        raise QuestStateParseError(
            f"Invalid slice state value {kv['state']!r} in {path}"
        ) from e
    return SliceStateInfo(state=state, updated_at=kv["updated_at"])


def write_quest_state(quest_dir: Path, state: QuestStateInfo) -> None:
    path = quest_dir / "state.md"
    if state.current_slice is None:
        cs = "null"
    else:
        cs = str(state.current_slice)
    body = (
        "# Quest State\n\n"
        f"state: {state.state.value}\n"
        f"current_slice: {cs}\n"
        f"updated_at: {state.updated_at}\n"
    )
    if state.active_slice is not None:
        body += f"active_slice: {state.active_slice}\n"
    if state.global_step is not None:
        body += f"global_step: {state.global_step}\n"
    path.write_text(body, encoding="utf-8")


def write_quest_normalized_machine_state(
    quest_dir: Path,
    info: QuestStateInfo,
    meta: QuestMeta,
    repo_root: Path,
) -> None:
    """Write quest root ``state.md`` using the spec ``# State`` / ``## Tags`` shape (v2)."""
    rel = quest_dir.resolve().relative_to(repo_root.resolve()).as_posix()
    gs = info.global_step if info.global_step is not None else 0
    tags: dict[str, str] = {
        "quest_type": meta.quest_type,
        "quest_number": str(meta.quest_number),
        "quest_slug": meta.quest_slug,
    }
    if info.active_slice:
        tags["active_slice"] = info.active_slice
    sm = StateMachineState(
        machine_name="quest",
        machine_path=rel,
        state=info.state.value,
        global_step=gs,
        tags=tags,
        updated_at=info.updated_at,
    )
    write_normalized_machine_state(quest_dir, sm)


def write_slice_state(slice_dir: Path, state: SliceStateInfo) -> None:
    path = slice_dir / "state.md"
    body = (
        "# Slice State\n\n"
        f"state: {state.state.value}\n"
        f"updated_at: {state.updated_at}\n"
    )
    path.write_text(body, encoding="utf-8")


def read_quest_meta(quest_dir: Path) -> QuestMeta:
    path = quest_dir / "meta.json"
    if not path.is_file():
        raise FileNotFoundError(f"Missing quest meta file: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    created_by = data.get("created_by")
    project_raw = data.get("project")
    project: str | None
    if isinstance(project_raw, str) and project_raw.strip():
        project = project_raw.strip()
    else:
        project = _project_from_quest_dir_path(quest_dir)
    if project is None and _is_project_local_quest_dir(quest_dir):
        raise ValueError(
            f"Quest meta file {path} is missing required 'project' and the quest "
            "path does not identify a project under projects/<project>/quests/"
        )
    if project is None:
        project = ""
    return QuestMeta(
        project=project,
        quest_type=data["quest_type"],
        quest_number=int(data["quest_number"]),
        quest_slug=data["quest_slug"],
        quest_name=data["quest_name"],
        created_at=data["created_at"],
        created_by=created_by if created_by is not None else None,
    )


def write_quest_meta(quest_dir: Path, meta: QuestMeta) -> None:
    path = quest_dir / "meta.json"
    payload = {
        "project": meta.project,
        "quest_type": meta.quest_type,
        "quest_number": meta.quest_number,
        "quest_slug": meta.quest_slug,
        "quest_name": meta.quest_name,
        "created_at": meta.created_at,
    }
    if meta.created_by is not None:
        payload["created_by"] = meta.created_by
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def read_thread_registry(quest_dir: Path) -> dict:
    path = quest_dir / "thread_registry.json"
    if not path.is_file():
        raise FileNotFoundError(f"Missing thread registry file: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"thread_registry.json must contain a JSON object: {path}")
    return data


def write_thread_registry(quest_dir: Path, registry: dict) -> None:
    path = quest_dir / "thread_registry.json"
    path.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")


def _coerce_config_version(version: Any, path: Path) -> int:
    if isinstance(version, bool) or not isinstance(version, int):
        raise ValueError(
            f"Execution config 'version' must be integer 1 or 2 in {path} "
            f"(got {version!r})"
        )
    if version not in (1, 2):
        raise ValueError(
            f"Unsupported execution config version {version} in {path} (expected 1 or 2)"
        )
    return version


def _coerce_string_list(
    value: Any,
    key: str,
    path: Path,
    role: str,
) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(
            f"Profile {role!r} {key} in {path} must be a list or omitted, "
            f"got {type(value).__name__}"
        )
    out: list[str] = []
    for i, item in enumerate(value):
        if not isinstance(item, str):
            raise ValueError(
                f"Profile {role!r} {key}[{i}] in {path} must be a string, "
                f"got {type(item).__name__}"
            )
        out.append(item)
    return out


def _validate_modify_allow_patterns(
    patterns: list[str],
    path: Path,
    role: str,
) -> None:
    for i, p in enumerate(patterns):
        if p.strip() == "**":
            raise ValueError(
                f"Profile {role!r} modify_allow[{i}] in {path} must not be a standalone "
                "'**' (it would match all paths and defeat modify_block)"
            )
        for token in _DOLLAR_TOKEN_RE.findall(p):
            if token not in _ALLOWED_MODIFY_PATH_PLACEHOLDERS:
                raise ValueError(
                    f"Profile {role!r} modify_allow[{i}] in {path} uses unknown placeholder "
                    f"{token!r} (only $currentQuest, $currentSlice, and "
                    "$currentProject are allowed)"
                )


def _validate_modify_block_patterns(
    patterns: list[str],
    path: Path,
    role: str,
) -> None:
    for i, p in enumerate(patterns):
        for token in _DOLLAR_TOKEN_RE.findall(p):
            if token not in _ALLOWED_MODIFY_PATH_PLACEHOLDERS:
                raise ValueError(
                    f"Profile {role!r} modify_block[{i}] in {path} uses unknown placeholder "
                    f"{token!r} (only $currentQuest, $currentSlice, and "
                    "$currentProject are allowed)"
                )


def _parse_profile_maps_to_execution_profile(
    role: str,
    prof: dict[str, Any],
    path: Path,
    config_version: int,
) -> ExecutionProfile:
    if not isinstance(prof, dict):
        raise ValueError(
            f"Profile {role!r} in {path} must be a mapping, got {type(prof).__name__}"
        )
    harness_raw = prof.get("harness")
    model = prof.get("model")
    reasoning_effort = prof.get("reasoning_effort")
    idle = prof.get("idle_timeout_seconds")
    if harness_raw is None or model is None or idle is None:
        raise ValueError(
            f"Profile {role!r} in {path} requires harness, model, "
            "and idle_timeout_seconds"
        )
    try:
        harness = HarnessKind(harness_raw)
    except ValueError as e:
        raise ValueError(
            f"Unknown harness {harness_raw!r} for profile {role!r} in {path}"
        ) from e
    if not isinstance(model, str):
        raise ValueError(f"Profile {role!r} model must be a string in {path}")
    if reasoning_effort is not None and not isinstance(reasoning_effort, str):
        raise ValueError(
            f"Profile {role!r} reasoning_effort must be a string in {path}"
        )
    if not isinstance(idle, int) or isinstance(idle, bool):
        raise ValueError(
            f"Profile {role!r} idle_timeout_seconds must be an int in {path}"
        )
    if config_version == 1:
        modify_allow: list[str] = []
        modify_block: list[str] = []
    else:
        modify_allow = _coerce_string_list(
            prof.get("modify_allow"), "modify_allow", path, role
        )
        modify_block = _coerce_string_list(
            prof.get("modify_block"), "modify_block", path, role
        )
        _validate_modify_allow_patterns(modify_allow, path, role)
        _validate_modify_block_patterns(modify_block, path, role)
    return ExecutionProfile(
        harness=harness,
        model=model,
        reasoning_effort=reasoning_effort,
        idle_timeout_seconds=idle,
        modify_allow=modify_allow,
        modify_block=modify_block,
        config_version=config_version,
    )


def read_state_execution_config_version(config_dir: Path) -> int:
    """Return the integer ``version`` field from ``state_execution_config.yaml``."""
    path = config_dir / "state_execution_config.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"Missing execution config: {path}")
    raw_any = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw_any, dict):
        raise ValueError(f"Execution config must be a mapping: {path}")
    raw: dict[str, Any] = raw_any
    if "version" not in raw:
        raise ValueError(f"Execution config missing required 'version' key: {path}")
    return _coerce_config_version(raw["version"], path)


def validate_state_execution_config_text(config_text: str) -> None:
    """Parse and validate arbitrary state execution config YAML text."""
    raw_any = yaml.safe_load(config_text)
    if not isinstance(raw_any, dict):
        raise ValueError("Execution config must be a mapping")
    raw: dict[str, Any] = raw_any
    virtual_path = Path("<config>")
    if "version" not in raw:
        raise ValueError("Execution config missing required 'version' key")
    config_version = _coerce_config_version(raw["version"], virtual_path)
    profiles = raw.get("profiles")
    if not isinstance(profiles, dict):
        raise ValueError("Execution config missing 'profiles' mapping")
    for role, prof in profiles.items():
        _parse_profile_maps_to_execution_profile(
            str(role), prof, virtual_path, config_version
        )
    harnesses = raw.get("harnesses", {})
    if harnesses is None:
        return
    if not isinstance(harnesses, dict):
        raise ValueError("Execution config 'harnesses' must be a mapping")
    for harness_name, config in harnesses.items():
        if not isinstance(harness_name, str):
            raise ValueError("Harness config keys must be strings")
        try:
            HarnessKind(harness_name)
        except ValueError as e:
            raise ValueError(f"Unknown harness config {harness_name!r}") from e
        if not isinstance(config, dict):
            raise ValueError(f"Harness config {harness_name!r} must be a mapping")


def read_execution_config(quest_dir: Path) -> dict[str, ExecutionProfile]:
    path = quest_dir / "state_execution_config.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"Missing execution config: {path}")
    raw_any = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw_any, dict):
        raise ValueError(f"Execution config must be a mapping: {path}")
    raw: dict[str, Any] = raw_any
    if "version" not in raw:
        raise ValueError(f"Execution config missing required 'version' key: {path}")
    config_version = _coerce_config_version(raw["version"], path)
    profiles = raw.get("profiles")
    if not isinstance(profiles, dict):
        raise ValueError(f"Execution config missing 'profiles' mapping: {path}")
    out: dict[str, ExecutionProfile] = {}
    for role, prof in profiles.items():
        out[str(role)] = _parse_profile_maps_to_execution_profile(
            str(role), prof, path, config_version
        )
    return out


def read_harness_configs(quest_dir: Path) -> dict[str, dict[str, object]]:
    path = quest_dir / "state_execution_config.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"Missing execution config: {path}")
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Execution config must be a mapping: {path}")
    harnesses = raw.get("harnesses", {})
    if harnesses is None:
        return {}
    if not isinstance(harnesses, dict):
        raise ValueError(f"Execution config 'harnesses' must be a mapping: {path}")
    out: dict[str, dict[str, object]] = {}
    for harness_name, config in harnesses.items():
        if not isinstance(harness_name, str):
            raise ValueError(f"Harness config keys must be strings in {path}")
        try:
            HarnessKind(harness_name)
        except ValueError as e:
            raise ValueError(
                f"Unknown harness config {harness_name!r} in {path}"
            ) from e
        if not isinstance(config, dict):
            raise ValueError(
                f"Harness config {harness_name!r} in {path} must be a mapping"
            )
        out[harness_name] = dict(config)
    return out


# Fields that can span multiple lines.  When the parser is inside one of
# these fields, only the *next* field in document order can end the block.
# ``resolution_notes`` is always the last field, so nothing can break out of it.
_MULTILINE_FIELDS = frozenset({"details", "resolution_notes"})
_FIELD_AFTER: dict[str, str] = {"details": "resolution_notes"}


def _is_field_header(stripped: str, current_key: str | None) -> str | None:
    """Return the field name if *stripped* is a recognised ``- field: …`` header.

    When the parser is inside a multi-line field, only the next expected
    field is allowed to start a new header — any other ``- …`` line is
    treated as markdown content belonging to the current field.
    """
    if not stripped.startswith("- "):
        return None
    rest = stripped[2:].strip()
    if ":" not in rest:
        return None
    candidate = rest.partition(":")[0].strip()
    # Inside a multi-line field, only the specific successor field can break out.
    if current_key in _MULTILINE_FIELDS:
        allowed = _FIELD_AFTER.get(current_key)
        if candidate != allowed:
            return None
    return candidate


def _parse_issue_body(issue_id: str, body: str) -> IssueEntry:
    fields: dict[str, str] = {}
    current_key: str | None = None
    raw_lines = body.split("\n")
    for raw in raw_lines:
        stripped = raw.strip()
        field_name = _is_field_header(stripped, current_key)
        if field_name is not None:
            rest = stripped[2:].strip()
            _, _, val = rest.partition(":")
            current_key = field_name
            fields[current_key] = val.strip()
        elif current_key in _MULTILINE_FIELDS:
            # Preserve the line as-is (including blank lines) for multi-line fields
            fields[current_key] = fields.get(current_key, "") + "\n" + raw.rstrip("\n")
        elif not stripped:
            continue
        else:
            raise ValueError(
                f"Issue {issue_id}: unexpected continuation line {stripped!r}"
            )
    # Strip trailing whitespace from multi-line fields
    for k in _MULTILINE_FIELDS:
        if k in fields:
            fields[k] = fields[k].strip()
    required = ("status", "owner_role", "created_at", "updated_at", "title", "details")
    for k in required:
        if k not in fields:
            raise ValueError(f"Issue {issue_id}: missing required field {k!r}")
    res = fields.get("resolution_notes")
    if res is not None and res.strip().lower() == "none":
        res = None
    return IssueEntry(
        issue_id=issue_id,
        status=fields["status"],
        owner_role=fields["owner_role"],
        created_at=fields["created_at"],
        updated_at=fields["updated_at"],
        title=fields["title"],
        details=fields["details"],
        resolution_notes=res,
    )


def read_issues(filepath: Path) -> list[IssueEntry]:
    if not filepath.is_file():
        return []
    text = filepath.read_text(encoding="utf-8")
    matches = list(_ISSUE_HEADING_RE.finditer(text))
    if not matches:
        return []
    entries: list[IssueEntry] = []
    for i, m in enumerate(matches):
        issue_id = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]
        entries.append(_parse_issue_body(issue_id, body))
    return entries


def atomic_write_text(filepath: Path, text: str) -> None:
    filepath.parent.mkdir(parents=True, exist_ok=True)
    tmp = filepath.with_name(f"{filepath.name}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(filepath)


def _write_issue_field(lines: list[str], key: str, value: str) -> None:
    """Write a field, putting multi-line values on continuation lines."""
    if "\n" not in value:
        lines.append(f"- {key}: {value}")
    else:
        first, rest = value.split("\n", 1)
        lines.append(f"- {key}: {first}")
        for cont in rest.split("\n"):
            lines.append(cont)


def _parse_response_body(
    issue_id_heading: str,
    timestamp: str,
    body: str,
) -> IssueResponseEntry:
    fields: dict[str, str] = {}
    current: str | None = None
    for raw_line in body.split("\n"):
        line = raw_line.strip()
        if line.startswith("- ") and ":" in line:
            rest = line[2:].strip()
            key, _, val = rest.partition(":")
            current = key.strip()
            fields[current] = val.strip()
        elif current == "explanation" and line:
            fields[current] = fields.get(current, "") + "\n" + raw_line.rstrip("\n")
        elif current == "explanation" and not line:
            fields[current] = fields.get(current, "") + "\n"
    return IssueResponseEntry(
        issue_id=fields.get("issue_id", issue_id_heading),
        response_timestamp=timestamp,
        outcome=fields.get("outcome", ""),
        explanation=fields.get("explanation", "").strip(),
    )


def read_issue_responses(filepath: Path) -> list[IssueResponseEntry]:
    if not filepath.is_file():
        return []
    text = filepath.read_text(encoding="utf-8")
    matches = list(_RESPONSE_SECTION_RE.finditer(text))
    if not matches:
        return []
    out: list[IssueResponseEntry] = []
    for i, m in enumerate(matches):
        issue_id_heading = m.group(1)
        ts = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]
        out.append(_parse_response_body(issue_id_heading, ts, body))
    return out


def _format_response_section(entry: IssueResponseEntry) -> list[str]:
    lines = [
        f"## Response {entry.issue_id} {entry.response_timestamp}",
        "",
        f"- issue_id: {entry.issue_id}",
        f"- outcome: {entry.outcome}",
    ]
    _write_issue_field(lines, "explanation", entry.explanation)
    lines.append("")
    return lines


def append_issue_response(filepath: Path, entry: IssueResponseEntry) -> None:
    if filepath.is_file():
        text = filepath.read_text(encoding="utf-8")
        if not text.endswith("\n"):
            text += "\n"
        text += "\n" + "\n".join(_format_response_section(entry))
    else:
        text = "# Issue responses\n\n" + "\n".join(_format_response_section(entry))
    atomic_write_text(filepath, text.rstrip() + "\n")


def write_issues(filepath: Path, issues: list[IssueEntry]) -> None:
    lines: list[str] = ["# Issues", ""]
    for issue in issues:
        lines.append(f"## Issue {issue.issue_id}")
        lines.append("")
        lines.append(f"- status: {issue.status}")
        lines.append(f"- owner_role: {issue.owner_role}")
        lines.append(f"- created_at: {issue.created_at}")
        lines.append(f"- updated_at: {issue.updated_at}")
        lines.append(f"- title: {issue.title}")
        _write_issue_field(lines, "details", issue.details)
        if issue.resolution_notes is None:
            lines.append("- resolution_notes: none")
        else:
            _write_issue_field(lines, "resolution_notes", issue.resolution_notes)
        lines.append("")
    atomic_write_text(filepath, "\n".join(lines).rstrip() + "\n")


def _parse_history_block(timestamp: str, body: str) -> TransitionRecord:
    kv = _parse_bullet_kv_lines(
        body,
        {
            "previous_state",
            "next_state",
            "commit",
            "thread_name",
            "notes",
        },
        f"history block at {timestamp}",
    )
    return TransitionRecord(
        timestamp=timestamp,
        previous_state=kv["previous_state"],
        next_state=kv["next_state"],
        commit=kv["commit"],
        thread_name=kv["thread_name"],
        notes=kv["notes"],
    )


def read_history(filepath: Path) -> list[TransitionRecord]:
    if not filepath.is_file():
        return []
    text = filepath.read_text(encoding="utf-8")
    matches = list(_HISTORY_HEADING_RE.finditer(text))
    if not matches:
        return []
    records: list[TransitionRecord] = []
    for i, m in enumerate(matches):
        ts = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        block = text[start:end]
        records.append(_parse_history_block(ts, block))
    return records


def _format_history_block(record: TransitionRecord) -> str:
    return (
        f"## {record.timestamp}\n\n"
        f"- previous_state: {record.previous_state}\n"
        f"- next_state: {record.next_state}\n"
        f"- commit: {record.commit}\n"
        f"- thread_name: {record.thread_name}\n"
        f"- notes: {record.notes}\n"
        "\n"
    )


def append_history(filepath: Path, record: TransitionRecord) -> None:
    block = _format_history_block(record)
    filepath.parent.mkdir(parents=True, exist_ok=True)
    if filepath.is_file():
        existing = filepath.read_text(encoding="utf-8")
        if existing and not existing.endswith("\n"):
            existing += "\n"
        filepath.write_text(existing + block, encoding="utf-8")
    else:
        filepath.write_text("# State Transition History\n\n" + block, encoding="utf-8")


def has_human_intervention_request(quest_dir: Path) -> bool:
    return (quest_dir / "human_intervention_request.md").is_file()
