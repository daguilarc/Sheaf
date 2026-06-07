"""Tests for quest worktree naming and path helpers."""

from __future__ import annotations

import unittest
from pathlib import Path

from quest_runner_service.quest_types import QuestMeta
from quest_runner_service.worktrees import (
    quest_worktree_branch,
    quest_worktree_name,
    quest_worktree_path,
    validate_project_name,
)


class WorktreeNamingTests(unittest.TestCase):
    def test_quest_worktree_name(self) -> None:
        self.assertEqual(
            quest_worktree_name("example", "main", 4, "ship_it"),
            "example_main_0004_ship_it",
        )

    def test_quest_worktree_branch(self) -> None:
        self.assertEqual(
            quest_worktree_branch("example_main_0004_ship_it"),
            "quest/example_main_0004_ship_it",
        )

    def test_quest_worktree_path(self) -> None:
        source = Path("/data/sheaf")
        meta = QuestMeta(
            project="example",
            quest_type="main",
            quest_number=4,
            quest_slug="ship_it",
            quest_name="Ship It",
            created_at="2026-03-29T00:00:00Z",
        )
        self.assertEqual(
            quest_worktree_path(source, meta),
            Path("/data/.quest-worktrees/example_main_0004_ship_it"),
        )


class ProjectNameValidationTests(unittest.TestCase):
    def test_accepts_valid_names(self) -> None:
        validate_project_name("quest-runner")
        validate_project_name("Web2")

    def test_rejects_invalid_names(self) -> None:
        with self.assertRaises(ValueError):
            validate_project_name("")
        with self.assertRaises(ValueError):
            validate_project_name("-bad")
        with self.assertRaises(ValueError):
            validate_project_name("has space")


if __name__ == "__main__":
    unittest.main()
