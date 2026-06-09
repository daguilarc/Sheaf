"""Upgrade writable project-local quests from legacy execution config to workflow/."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from . import quest_fs
from .harness_config import (
    merge_service_harness_configs,
    read_service_harness_configs,
    service_harness_config_path,
)
from .quest_types import QuestMeta
from .state_machine.workflow_state_io import WorkflowStateIo, _NORMALIZED_STATE_HEADING
from .workflow_config import WorkflowDefinition, load_workflow
from .workflow_scaffold import copy_packaged_default_workflow, list_workflow_tree_paths

_PLACEHOLDER_RENAMES = (
    ("$currentQuest", "$quest"),
    ("$currentSlice", "$active_child"),
    ("$currentProject", "$project"),
)


class QuestUpgradeError(Exception):
    """Base class for quest workflow upgrade failures."""


class QuestNotUpgradeable(QuestUpgradeError):
    """Quest cannot be upgraded (legacy read-only or missing legacy config)."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def quest_needs_workflow_upgrade(quest_dir: Path) -> bool:
    """Return whether a writable quest still uses legacy execution config only."""
    if not quest_fs.is_project_local_quest_dir(quest_dir):
        return False
    legacy = quest_dir / "state_execution_config.yaml"
    workflow_yaml = quest_dir / "workflow" / "workflow.yaml"
    return legacy.is_file() and not workflow_yaml.is_file()


def _rename_placeholders(pattern: str) -> str:
    out = pattern
    for old, new in _PLACEHOLDER_RENAMES:
        out = out.replace(old, new)
    return out


def _rename_pattern_list(patterns: Any) -> list[str]:
    if not isinstance(patterns, list):
        return []
    return [_rename_placeholders(str(item)) for item in patterns]


def _port_profile_overrides(
    workflow_dir: Path,
    legacy_profiles: dict[str, Any],
) -> list[str]:
    """Port legacy profile customizations into ``workflow/profiles/*.yaml``."""
    ported: list[str] = []
    profiles_dir = workflow_dir / "profiles"
    for role, prof in legacy_profiles.items():
        if not isinstance(role, str) or not isinstance(prof, dict):
            continue
        profile_path = profiles_dir / f"{role}.yaml"
        if not profile_path.is_file():
            continue
        raw_any = yaml.safe_load(profile_path.read_text(encoding="utf-8"))
        if not isinstance(raw_any, dict):
            continue
        raw: dict[str, Any] = raw_any
        changed = False
        for field in ("harness", "model", "reasoning_effort", "idle_timeout_seconds"):
            if field in prof and prof[field] != raw.get(field):
                raw[field] = prof[field]
                changed = True
        modify = raw.get("modify")
        if not isinstance(modify, dict):
            modify = {}
            raw["modify"] = modify
        if "modify_allow" in prof:
            modify["allow"] = _rename_pattern_list(prof["modify_allow"])
            changed = True
        if "modify_block" in prof:
            modify["block"] = _rename_pattern_list(prof["modify_block"])
            changed = True
        if changed:
            profile_path.write_text(
                yaml.safe_dump(raw, sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )
            ported.append(f"workflow/profiles/{role}.yaml")
    return ported


def _merge_legacy_harnesses(
    repo_path: Path,
    harnesses: Any,
) -> tuple[list[str], list[str]]:
    if not isinstance(harnesses, dict) or not harnesses:
        return [], []
    existing = read_service_harness_configs(repo_path)
    to_merge: dict[str, dict[str, object]] = {}
    skipped: list[str] = []
    for harness_name, config in harnesses.items():
        if not isinstance(harness_name, str) or not isinstance(config, dict):
            continue
        if harness_name in existing:
            skipped.append(harness_name)
            continue
        to_merge[harness_name] = dict(config)
    merged_keys = merge_service_harness_configs(repo_path, to_merge)
    return merged_keys, skipped


def _normalize_legacy_quest_state_if_needed(
    *,
    repo_path: Path,
    quest_dir: Path,
    meta: QuestMeta,
    workflow: WorkflowDefinition,
) -> bool:
    path = quest_dir / "state.md"
    text = path.read_text(encoding="utf-8")
    first: str | None = None
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        first = s
        break
    if first == _NORMALIZED_STATE_HEADING:
        return False
    workflow_io = WorkflowStateIo(repo_path, quest_dir, meta, workflow)
    sm = workflow_io.ReadStateMachineState(quest_dir)
    workflow_io.WriteStateMachineState(quest_dir, sm)
    return True


def upgrade_quest_workflow(
    repo_path: Path,
    quest_dir: Path,
    *,
    meta: QuestMeta | None = None,
) -> dict[str, Any]:
    """Upgrade a writable project-local quest from legacy config to workflow/."""
    quest_dir = quest_dir.resolve()
    repo_path = repo_path.resolve()
    if not quest_fs.is_project_local_quest_dir(quest_dir):
        raise QuestNotUpgradeable(
            "upgrade applies only to writable project-local quests under "
            "projects/<project>/quests/"
        )
    legacy_path = quest_dir / "state_execution_config.yaml"
    workflow_yaml = quest_dir / "workflow" / "workflow.yaml"
    if workflow_yaml.is_file():
        return {
            "status": "already_upgraded",
            "quest_dir": str(quest_dir),
            "workflow_dir": str(quest_dir / "workflow"),
        }
    if not legacy_path.is_file():
        raise QuestNotUpgradeable(
            "quest has no state_execution_config.yaml to upgrade from"
        )

    meta = meta or quest_fs.read_quest_meta(quest_dir)
    raw_any = yaml.safe_load(legacy_path.read_text(encoding="utf-8"))
    if not isinstance(raw_any, dict):
        raise QuestUpgradeError(
            f"Legacy execution config must be a mapping: {legacy_path}"
        )
    legacy: dict[str, Any] = raw_any
    legacy_profiles = legacy.get("profiles", {})
    if not isinstance(legacy_profiles, dict):
        legacy_profiles = {}

    workflow_dest = quest_dir / "workflow"
    copy_packaged_default_workflow(workflow_dest)
    copied_workflow = list_workflow_tree_paths(quest_dir, workflow_dest)

    ported_profiles = _port_profile_overrides(workflow_dest, legacy_profiles)
    merged_harnesses, skipped_harnesses = _merge_legacy_harnesses(
        repo_path,
        legacy.get("harnesses", {}),
    )

    legacy_path.unlink()
    workflow = load_workflow(workflow_dest)
    normalized_state = _normalize_legacy_quest_state_if_needed(
        repo_path=repo_path,
        quest_dir=quest_dir,
        meta=meta,
        workflow=workflow,
    )

    return {
        "status": "upgraded",
        "quest_dir": str(quest_dir),
        "workflow_dir": str(workflow_dest),
        "copied_workflow_files": copied_workflow,
        "deleted_config": "state_execution_config.yaml",
        "ported_profiles": ported_profiles,
        "merged_harnesses": merged_harnesses,
        "skipped_harnesses": skipped_harnesses,
        "service_harness_config": str(service_harness_config_path(repo_path)),
        "normalized_state_rewrite": normalized_state,
    }


def upgrade_quest_if_needed(repo_path: Path, quest_dir: Path) -> dict[str, Any] | None:
    """Upgrade a quest when legacy config is present and workflow/ is missing."""
    if not quest_needs_workflow_upgrade(quest_dir):
        return None
    return upgrade_quest_workflow(repo_path, quest_dir)
