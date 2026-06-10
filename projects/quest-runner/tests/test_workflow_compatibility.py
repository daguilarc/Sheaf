"""Compatibility tests for default workflow durable artifact formats."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

from quest_runner_service import quest_fs
from quest_runner_service.quest_types import (
    QuestFileState,
    SliceFileState,
)
from quest_runner_service.state_machine.adapters import SubprocessGitOps
from quest_runner_service.state_machine.commit_metadata import parse_step_commit_message
from quest_runner_service.state_machine.v2_step_executor import (
    advance_v2_top_level_step_without_harness,
)
from quest_runner_service.worktrees import quest_worktree_path

from .test_helpers import TempRepo, ensure_project


def _git_head_message(repo: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "log", "-1", "--format=%B"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def _commit_all(repo: Path, message: str) -> None:
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", message],
        check=True,
        capture_output=True,
    )


class DefaultWorkflowCompatibilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)
        ensure_project(self.temp.root, "example")
        from quest_runner_service.quest_service import QuestService
        from quest_runner_service.quest_lock import QuestLock

        self.svc = QuestService(QuestLock(), self.repo_root)
        self.created = self.svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Compatibility",
        )
        meta = quest_fs.read_quest_meta(Path(self.created["quest_dir"]))
        self.worktree = quest_worktree_path(self.temp.root, meta)
        self.wt_qdir = (
            self.worktree
            / "projects"
            / self.created["project"]
            / "quests"
            / self.created["quest_type"]
            / f"{self.created['quest_number']:04d}_{self.created['quest_slug']}"
        )

    def test_slice_scaffold_state_history_bytes(self) -> None:
        out = self.svc.initialize_slices(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            quest_number=self.created["quest_number"],
            count=1,
            slugs=["compat"],
        )
        slice_dir = Path(out["created_slices"][0]["slice_dir"])
        history = (slice_dir / "state_history.md").read_text(encoding="utf-8")
        self.assertEqual(history, "# State Transition History\n\n")

    def test_child_slice_setup_snapshot_matches_history_shape(self) -> None:
        sl = self.wt_qdir / "slices" / "0001_child"
        sl.mkdir(parents=True)
        quest_fs.write_slice_file_state(
            sl,
            SliceFileState(
                state="NotStarted",
                updated_at="2026-01-01T00:00:00Z",
            ),
        )
        quest_fs.write_quest_file_state(
            self.wt_qdir,
            QuestFileState(
                state="ExecuteSlice",
                current_slice=1,
                updated_at="2026-01-01T00:00:00Z",
                active_slice="0001_child",
                global_step=5,
            ),
        )
        _commit_all(self.worktree, "execute slice setup")
        from quest_runner_service.quest_runner import _quest_key

        meta = quest_fs.read_quest_meta(self.wt_qdir)
        result = advance_v2_top_level_step_without_harness(
            repo_path=self.worktree,
            quest_dir=self.wt_qdir,
            quest_key=_quest_key(meta),
            meta=meta,
            git_ops=SubprocessGitOps(),
        )
        self.assertEqual(result.kind, "advanced")
        parsed = parse_step_commit_message(_git_head_message(self.worktree))
        self.assertIsNotNone(parsed)
        assert parsed is not None
        child = parsed.metadata.snapshot.child
        self.assertIsNotNone(child)
        assert child is not None
        self.assertEqual(child.node_name, "SliceSetupNode")
        self.assertEqual(child.state_before, "SliceSetup")
        self.assertEqual(child.state_after, "Implementing")

    def test_public_docs_describe_workflow_and_issue_file(self) -> None:
        docs_root = self.repo_root / "docs"
        cli_text = (docs_root / "operations.md").read_text(encoding="utf-8")
        self.assertIn("workflow", cli_text)
        self.assertIn("--file", cli_text)
        self.assertNotIn("--scope physicalplan", cli_text)
        api_text = (docs_root / "capabilities" / "experiments.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("workflow_path", api_text)
        issues_text = (docs_root / "capabilities" / "issues.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("issue_file", issues_text)


if __name__ == "__main__":
    unittest.main()
