"""Service-level harness provider configuration."""

from __future__ import annotations

import json
from pathlib import Path

from .quest_types import HarnessKind


def service_harness_config_path(repo_path: Path) -> Path:
    return (repo_path.resolve() / "config" / "quest-runner.json").resolve()


def merge_service_harness_configs(
    repo_path: Path,
    harnesses: dict[str, dict[str, object]],
) -> list[str]:
    """Merge new harness provider entries into ``config/quest-runner.json``."""
    if not harnesses:
        return []
    path = service_harness_config_path(repo_path)
    raw_any: dict[str, object] = {}
    if path.is_file():
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise ValueError(f"{path} must be a JSON object")
        raw_any = loaded
    service_harnesses_raw = raw_any.get("harnesses", {})
    if service_harnesses_raw is None:
        service_harnesses: dict[str, object] = {}
    elif isinstance(service_harnesses_raw, dict):
        service_harnesses = dict(service_harnesses_raw)
    else:
        raise ValueError(f"{path}: 'harnesses' must be a mapping")
    merged: list[str] = []
    for harness_name, config in harnesses.items():
        if harness_name in service_harnesses:
            continue
        service_harnesses[harness_name] = config
        merged.append(harness_name)
    if not merged:
        return []
    raw_any["harnesses"] = service_harnesses
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(raw_any, indent=2) + "\n", encoding="utf-8")
    return merged


def read_service_harness_configs(repo_path: Path) -> dict[str, dict[str, object]]:
    """Load harness provider config from repository-root ``config/quest-runner.json``."""
    path = service_harness_config_path(repo_path)
    if not path.is_file():
        return {}
    raw_any = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw_any, dict):
        raise ValueError(f"{path} must be a JSON object")
    harnesses = raw_any.get("harnesses", {})
    if harnesses is None:
        return {}
    if not isinstance(harnesses, dict):
        raise ValueError(f"{path}: 'harnesses' must be a mapping")
    out: dict[str, dict[str, object]] = {}
    for harness_name, config in harnesses.items():
        if not isinstance(harness_name, str):
            raise ValueError(f"{path}: harness config keys must be strings")
        try:
            HarnessKind(harness_name)
        except ValueError as e:
            raise ValueError(f"{path}: unknown harness {harness_name!r}") from e
        if not isinstance(config, dict):
            raise ValueError(f"{path}: harness config {harness_name!r} must be a mapping")
        out[harness_name] = dict(config)
    return out
