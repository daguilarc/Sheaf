from __future__ import annotations

import unittest
from pathlib import Path

from quest_runner_service.smoke_test import (
    is_smoke_test_mode_active,
    resolve_asset_path,
    resolve_asset_root,
)

REPO_ROOT = Path("/repo/worktree")
ASSET_ROOT = Path("/main/checkout")


class IsSmokeTestModeActiveTests(unittest.TestCase):
    def test_truthy_values(self) -> None:
        for value in ("1", "true", "TRUE", "yes"):
            self.assertTrue(is_smoke_test_mode_active({"SHEAF_SMOKE_TEST_MODE": value}))

    def test_falsy_values(self) -> None:
        self.assertFalse(is_smoke_test_mode_active({}))
        for value in ("", "   ", "0", "false", "False"):
            self.assertFalse(is_smoke_test_mode_active({"SHEAF_SMOKE_TEST_MODE": value}))


class ResolveAssetRootTests(unittest.TestCase):
    def test_returns_repo_root_when_smoke_off(self) -> None:
        resolution = resolve_asset_root(
            REPO_ROOT,
            {"SHEAF_SMOKE_ASSET_ROOT": str(ASSET_ROOT)},
            directory_exists=lambda _path: True,
        )
        self.assertEqual(resolution.asset_root, REPO_ROOT)
        self.assertFalse(resolution.used_smoke_asset_root)
        self.assertIsNone(resolution.warning)

    def test_uses_asset_root_when_valid(self) -> None:
        resolution = resolve_asset_root(
            REPO_ROOT,
            {
                "SHEAF_SMOKE_TEST_MODE": "1",
                "SHEAF_SMOKE_ASSET_ROOT": str(ASSET_ROOT),
            },
            directory_exists=lambda path: path == ASSET_ROOT,
        )
        self.assertEqual(resolution.asset_root, ASSET_ROOT)
        self.assertTrue(resolution.used_smoke_asset_root)
        self.assertIsNone(resolution.warning)

    def test_falls_back_when_asset_root_unset(self) -> None:
        resolution = resolve_asset_root(
            REPO_ROOT,
            {"SHEAF_SMOKE_TEST_MODE": "1"},
            directory_exists=lambda _path: True,
        )
        self.assertEqual(resolution.asset_root, REPO_ROOT)
        self.assertFalse(resolution.used_smoke_asset_root)
        self.assertIsNotNone(resolution.warning)

    def test_falls_back_when_asset_root_missing(self) -> None:
        resolution = resolve_asset_root(
            REPO_ROOT,
            {
                "SHEAF_SMOKE_TEST_MODE": "1",
                "SHEAF_SMOKE_ASSET_ROOT": "/does/not/exist",
            },
            directory_exists=lambda _path: False,
        )
        self.assertEqual(resolution.asset_root, REPO_ROOT)
        self.assertFalse(resolution.used_smoke_asset_root)
        self.assertIsNotNone(resolution.warning)


class ResolveAssetPathTests(unittest.TestCase):
    def test_resolves_against_repo_root_when_smoke_off(self) -> None:
        path = resolve_asset_path("config/api_keys.json", REPO_ROOT, env={})
        self.assertEqual(path, REPO_ROOT / "config/api_keys.json")

    def test_resolves_against_asset_root_when_smoke_on(self) -> None:
        path = resolve_asset_path(
            "config/api_keys.json",
            REPO_ROOT,
            env={
                "SHEAF_SMOKE_TEST_MODE": "1",
                "SHEAF_SMOKE_ASSET_ROOT": str(Path(__file__).resolve().parent),
            },
        )
        self.assertEqual(
            path,
            Path(__file__).resolve().parent / "config/api_keys.json",
        )


if __name__ == "__main__":
    unittest.main()
