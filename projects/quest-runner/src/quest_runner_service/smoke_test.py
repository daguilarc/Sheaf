"""Repo-wide smoke-test mode contract for the quest-runner service.

When ``SHEAF_SMOKE_TEST_MODE`` is active, the service resolves any git-ignored
assets it reads (e.g. ``config/api_keys.json``, ``.secrets.json``) from the
main-repo asset root given by ``SHEAF_SMOKE_ASSET_ROOT`` rather than from its own
repository root, while continuing to read tracked files from the repository
root.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

MODE_ENV_VAR = "SHEAF_SMOKE_TEST_MODE"
ASSET_ROOT_ENV_VAR = "SHEAF_SMOKE_ASSET_ROOT"


def is_smoke_test_mode_active(env: Mapping[str, str]) -> bool:
    """Smoke mode is active for any non-empty value other than ``0``/``false``."""
    raw = env.get(MODE_ENV_VAR)
    if raw is None:
        return False
    normalized = raw.strip().lower()
    return normalized not in ("", "0", "false")


@dataclass(frozen=True)
class ResolvedAssetRoot:
    """Where git-ignored assets should be read from, plus any fallback warning."""

    asset_root: Path
    used_smoke_asset_root: bool
    warning: str | None


def resolve_asset_root(
    repo_root: Path,
    env: Mapping[str, str],
    directory_exists: Callable[[Path], bool] = lambda path: path.is_dir(),
) -> ResolvedAssetRoot:
    """Resolve the directory git-ignored assets should be read from.

    - Smoke mode inactive: returns ``repo_root``.
    - Active with a valid ``SHEAF_SMOKE_ASSET_ROOT`` directory: returns it.
    - Active but the asset root is unset/empty/missing: returns ``repo_root``
      with a warning describing the fallback.
    """
    if not is_smoke_test_mode_active(env):
        return ResolvedAssetRoot(repo_root, False, None)

    raw_asset_root = (env.get(ASSET_ROOT_ENV_VAR) or "").strip()
    if not raw_asset_root:
        return ResolvedAssetRoot(
            repo_root,
            False,
            f"smoke-test mode active but {ASSET_ROOT_ENV_VAR} is unset or empty; "
            "using repo root for assets",
        )

    asset_root = Path(raw_asset_root)
    if not directory_exists(asset_root):
        return ResolvedAssetRoot(
            repo_root,
            False,
            f"smoke-test mode active but {ASSET_ROOT_ENV_VAR} ({raw_asset_root}) "
            "is not an existing directory; using repo root for assets",
        )

    return ResolvedAssetRoot(asset_root, True, None)


def resolve_asset_path(
    relative_path: str,
    repo_root: Path,
    env: Mapping[str, str] | None = None,
) -> Path:
    """Resolve a git-ignored asset's path, honoring smoke-test mode.

    Use this for files such as ``config/api_keys.json`` that live outside git;
    tracked files should continue to resolve against ``repo_root`` directly.
    """
    resolution = resolve_asset_root(repo_root, env if env is not None else os.environ)
    return resolution.asset_root / relative_path
