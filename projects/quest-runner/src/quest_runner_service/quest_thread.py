"""Quest thread registry resolution and persistence."""

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
