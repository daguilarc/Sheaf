"""Service-level harness provider configuration."""

from __future__ import annotations

import json
from pathlib import Path

from .quest_types import HarnessKind


def service_harness_config_path(repo_path: Path) -> Path:
    return (repo_path.resolve() / "config" / "quest-runner.json").resolve()


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
