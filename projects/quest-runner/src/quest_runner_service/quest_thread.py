"""Quest thread naming, registry resolution, and role prompt assembly."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .harness import Harness
from .quest_fs import read_thread_registry, write_thread_registry
from .quest_types import HarnessKind, QuestMeta, utc_now_iso


@dataclass
class QuestThread:
    repo_path: Path
    quest_path: Path
    role_name: str
    harness_kind: HarnessKind
    thread_name: str
    provider_thread_id: str
    round_count: int = 0
    last_used_at: datetime | None = None
    metadata: dict[str, str] = field(default_factory=dict)


def build_thread_name(
    repo_path: Path, quest_slug: str, role_name: str, pass_id: int = 0
) -> str:
    repo_name = repo_path.name
    return f"{repo_name}_quest_{quest_slug}_{role_name}_{pass_id}"


def build_spec_thread_name(
    repo_path: Path,
    quest_number: int,
    role_name: str,
    slice_number: int | None,
) -> str:
    """Deterministic thread id from ``node_catalog_and_transition_tables`` (v2 runner)."""
    repo = repo_path.name
    if slice_number is not None and role_name in (
        "implementer",
        "polisher_reviewer",
        "polisher",
    ):
        return (
            f"{repo}_quest_{quest_number:04d}_slice_{slice_number:04d}_{role_name}"
        )
    suffix = {
        "physical_planner": "physical_planner",
        "physical_plan_reviewer": "physical_plan_reviewer",
        "documenter": "documenter",
    }.get(role_name, role_name)
    return f"{repo}_quest_{quest_number:04d}_{suffix}"


def create_thread_with_provider_name(
    quest_dir: Path,
    repo_path: Path,
    role_name: str,
    harness: Harness,
    thread_name: str,
    model: str,
    reasoning_effort: str | None,
    idle_timeout_seconds: int,
    registry_key: str | None = None,
) -> QuestThread:
    registry = read_thread_registry(quest_dir)
    now = utc_now_iso()
    key = registry_key or role_name
    provider_thread_id = harness.create_thread(
        thread_name=thread_name,
        repo_path=repo_path,
        quest_dir=quest_dir,
        model=model,
        reasoning_effort=reasoning_effort,
        idle_timeout_seconds=idle_timeout_seconds,
    )
    registry[key] = {
        "thread_name": thread_name,
        "harness_kind": harness.kind.value,
        "provider_thread_id": provider_thread_id,
        "pass_id": 0,
        "round_count": 0,
        "created_at": now,
        "last_used_at": now,
    }
    write_thread_registry(quest_dir, registry)
    return QuestThread(
        repo_path=repo_path,
        quest_path=quest_dir,
        role_name=role_name,
        harness_kind=harness.kind,
        thread_name=thread_name,
        provider_thread_id=provider_thread_id,
    )


def resolve_or_create_thread_spec(
    quest_dir: Path,
    repo_path: Path,
    role_name: str,
    harness: Harness,
    quest_number: int,
    model: str,
    reasoning_effort: str | None,
    idle_timeout_seconds: int,
    slice_number: int | None,
    registry_key: str | None = None,
) -> QuestThread:
    key = registry_key or role_name
    thread = load_thread(quest_dir, repo_path, role_name, registry_key=key)
    if thread is not None:
        persist_thread_last_used(quest_dir, key)
        return thread
    name = build_spec_thread_name(repo_path, quest_number, role_name, slice_number)
    return create_thread_with_provider_name(
        quest_dir,
        repo_path,
        role_name,
        harness,
        name,
        model,
        reasoning_effort,
        idle_timeout_seconds,
        registry_key=key,
    )


def _thread_from_registry_entry(
    *,
    quest_dir: Path,
    repo_path: Path,
    role_name: str,
    entry: dict,
) -> QuestThread:
    thread_name = str(entry["thread_name"])
    harness_kind = HarnessKind(str(entry["harness_kind"]))
    provider_thread_id = str(entry["provider_thread_id"])
    try:
        round_count = int(entry.get("round_count", 0))
    except (TypeError, ValueError):
        round_count = 0
    return QuestThread(
        repo_path=repo_path,
        quest_path=quest_dir,
        role_name=role_name,
        harness_kind=harness_kind,
        thread_name=thread_name,
        provider_thread_id=provider_thread_id,
        round_count=round_count,
    )


def load_thread(
    quest_dir: Path,
    repo_path: Path,
    role_name: str,
    registry_key: str | None = None,
) -> QuestThread | None:
    registry = read_thread_registry(quest_dir)
    key = registry_key or role_name
    entry = registry.get(key)
    if entry is None:
        return None
    if not isinstance(entry, dict):
        raise ValueError(f"thread_registry.json: entry for {key!r} must be an object")
    return _thread_from_registry_entry(
        quest_dir=quest_dir,
        repo_path=repo_path,
        role_name=role_name,
        entry=entry,
    )


def create_thread(
    quest_dir: Path,
    repo_path: Path,
    role_name: str,
    harness: Harness,
    quest_slug: str,
    model: str,
    reasoning_effort: str | None,
    idle_timeout_seconds: int,
    registry_key: str | None = None,
) -> QuestThread:
    registry = read_thread_registry(quest_dir)
    now = utc_now_iso()
    key = registry_key or role_name
    thread_name = build_thread_name(repo_path, quest_slug, role_name, 0)
    provider_thread_id = harness.create_thread(
        thread_name=thread_name,
        repo_path=repo_path,
        quest_dir=quest_dir,
        model=model,
        reasoning_effort=reasoning_effort,
        idle_timeout_seconds=idle_timeout_seconds,
    )
    registry[key] = {
        "thread_name": thread_name,
        "harness_kind": harness.kind.value,
        "provider_thread_id": provider_thread_id,
        "pass_id": 0,
        "round_count": 0,
        "created_at": now,
        "last_used_at": now,
    }
    write_thread_registry(quest_dir, registry)
    return QuestThread(
        repo_path=repo_path,
        quest_path=quest_dir,
        role_name=role_name,
        harness_kind=harness.kind,
        thread_name=thread_name,
        provider_thread_id=provider_thread_id,
    )


def resolve_or_create_thread(
    quest_dir: Path,
    repo_path: Path,
    role_name: str,
    harness: Harness,
    quest_slug: str,
    model: str,
    reasoning_effort: str | None,
    idle_timeout_seconds: int,
    registry_key: str | None = None,
) -> QuestThread:
    key = registry_key or role_name
    thread = load_thread(quest_dir, repo_path, role_name, registry_key=key)
    if thread is not None:
        persist_thread_last_used(quest_dir, key)
        return thread
    return create_thread(
        quest_dir,
        repo_path,
        role_name,
        harness,
        quest_slug,
        model,
        reasoning_effort,
        idle_timeout_seconds,
        registry_key=key,
    )


def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def build_role_prompt(
    role_name: str, task_instruction: str, conductor_repo_path: Path
) -> str:
    del conductor_repo_path
    role_path = _package_dir() / "roles" / f"{role_name}.md"
    role_text = role_path.read_text(encoding="utf-8")
    return f"{role_text}\n\n---\n\n{task_instruction}"


def _issue_workflow_cli_summary() -> str:
    return (
        "## Issue workflow (CLI)\n\n"
        "Use `scripts/quest-runner issues ...` for issue operations. "
        "Run `scripts/quest-runner issues --help` for command details.\n\n"
        "- List/read: `issues list`, `issues read <id>`\n"
        "- Create/edit: `issues create`, `issues edit` "
        "(reviewers close with `--status completed`)\n"
        "- Respond: `issues respond` with `--outcome Fixed|NotFixed` and "
        "`--explanation` (responders only; do not close issues)\n"
        "- Response history: `issues responses <id>`\n"
        "- Use `--scope physicalplan` for quest-level issues; use "
        "`--scope polishing --slice <n>` for slice issues\n\n"
        "If you see something that looks like a bug in the quest harness, open "
        "a human intervention request. Do not work around bugs in the quest "
        "harness.\n\n"
        "Do not edit `physicalplan_issues.md`, `physicalplan_issue_responses.md`, "
        "`polishing_issues.md`, or `polishing_issue_responses.md` directly unless "
        "a human instructs you or the CLI/API is unavailable.\n"
    )


def build_runtime_context(
    *,
    role_name: str,
    meta: QuestMeta,
    quest_dir: Path,
    slice_dir: Path | None,
    quest_docs_dir: Path,
    repo_path: Path | None = None,
    experiment_id: str | None = None,
) -> str:
    slice_label = slice_dir.name if slice_dir is not None else "none (quest-scoped pass)"
    if repo_path is not None:
        quest_path_label = quest_dir.resolve().relative_to(
            repo_path.resolve()
        ).as_posix()
        project_path_label = f"projects/{meta.project}" if meta.project else ""
        marker = "/quests/"
        if marker in quest_path_label:
            project_path_label = quest_path_label.split(marker, 1)[0]
        if slice_dir is not None:
            slice_path_label = slice_dir.resolve().relative_to(
                repo_path.resolve()
            ).as_posix()
        else:
            slice_path_label = "none"
    else:
        quest_path_label = str(quest_dir)
        project_path_label = (
            str(quest_dir.parents[2])
            if len(quest_dir.parents) >= 3
            else (f"projects/{meta.project}" if meta.project else "")
        )
        slice_path_label = str(slice_dir) if slice_dir is not None else "none"
    project_docs_label = (
        f"{project_path_label}/docs" if project_path_label else "docs"
    )
    issue_summary = _issue_workflow_cli_summary()
    experiment_block = ""
    if experiment_id is not None:
        experiment_block = (
            f"Experiment: {experiment_id}\n"
            f"When using scripts/quest-runner, pass --experiment-id {experiment_id}.\n"
            "Do not omit the experiment id; the original quest worktree may not exist.\n\n"
        )
    return (
        "Quest Runtime Context\n"
        f"- Quest: {meta.quest_type}/{meta.quest_number:04d}_{meta.quest_slug} ({meta.quest_name})\n"
        f"- Quest directory: {quest_path_label}\n"
        f"- Role: {role_name}\n"
        f"- Current slice: {slice_label}\n"
        f"- Current slice directory: {slice_path_label}\n"
        f"- Current project docs directory: {project_docs_label}\n"
        f"- Quest runner reference directory: {quest_docs_dir}\n\n"
        f"{experiment_block}"
        "Use the quest's `specs/` directory as the implementation specification for this quest. "
        "Use the quest runner reference directory above for internal storage schemas and "
        "maintainer workflow rules.\n\n"
        f"{issue_summary}"
    )


def persist_thread_round_count(quest_dir: Path, role_name: str, round_count: int) -> None:
    registry = read_thread_registry(quest_dir)
    entry = registry.get(role_name)
    if not isinstance(entry, dict):
        return
    entry["round_count"] = int(round_count)
    write_thread_registry(quest_dir, registry)


def persist_thread_provider_id(
    quest_dir: Path, role_name: str, provider_thread_id: str
) -> None:
    registry = read_thread_registry(quest_dir)
    entry = registry.get(role_name)
    if not isinstance(entry, dict):
        return
    entry["provider_thread_id"] = provider_thread_id
    write_thread_registry(quest_dir, registry)


def persist_thread_last_used(quest_dir: Path, role_name: str) -> None:
    registry = read_thread_registry(quest_dir)
    entry = registry.get(role_name)
    if not isinstance(entry, dict):
        return
    entry["last_used_at"] = utc_now_iso()
    write_thread_registry(quest_dir, registry)
