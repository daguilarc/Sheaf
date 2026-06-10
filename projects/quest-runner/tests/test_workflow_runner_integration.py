"""End-to-end workflow interpreter integration with run, advance, and commit."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quest_runner_service import quest_fs
from quest_runner_service.quest_runner import run_quest
from quest_runner_service.quest_runner_v2 import run_quest_v2
from quest_runner_service.quest_types import (
    QuestFileState,
    SliceFileState,
)
from quest_runner_service.state_machine.commit_metadata import parse_step_commit_message
from quest_runner_service.state_machine.v2_step_executor import (
    advance_v2_top_level_step_without_harness,
)
from quest_runner_service.state_machine.adapters import SubprocessGitOps
from quest_runner_service.worktrees import quest_worktree_path

from .test_helpers import TempRepo, ensure_project


def _git_head(repo: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


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


def _worktree_quest_dir(source_root: Path, create_out: dict) -> Path:
    meta = quest_fs.read_quest_meta(Path(create_out["quest_dir"]))
    worktree = quest_worktree_path(source_root, meta)
    return (
        worktree
        / "projects"
        / create_out["project"]
        / "quests"
        / create_out["quest_type"]
        / f"{create_out['quest_number']:04d}_{create_out['quest_slug']}"
    )


def _scaffold_slice(slice_dir: Path) -> None:
    pp = slice_dir / "physicalplan"
    pp.mkdir(parents=True, exist_ok=True)
    (pp / "plan.md").write_text("# plan\n", encoding="utf-8")
    quest_fs.write_slice_file_state(
        slice_dir,
        SliceFileState(state="NotStarted", updated_at="2026-01-01T00:00:00Z"),
    )
    (slice_dir / "state_history.md").write_text(
        "# State Transition History\n", encoding="utf-8"
    )
    (slice_dir / "polishing_issues.md").write_text("# Issues\n", encoding="utf-8")


class WorkflowRunnerIntegrationFixture(unittest.TestCase):
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
            name="Workflow Integration",
        )
        self.wt_qdir = _worktree_quest_dir(self.temp.root, self.created)
        self.meta = quest_fs.read_quest_meta(self.wt_qdir)
        self.worktree = quest_worktree_path(self.temp.root, self.meta)


class AutomatedRunTests(WorkflowRunnerIntegrationFixture):
    def test_pre_planning_returns_without_commit(self) -> None:
        before_head = _git_head(self.worktree)
        out = run_quest_v2(
            repo_path=self.worktree,
            quest_dir=self.wt_qdir,
            conductor_repo_path=self.repo_root,
            max_steps=1,
        )
        self.assertEqual(out["status"], "pre_planning")
        self.assertEqual(out["steps_executed"], 0)
        self.assertIsNone(out["last_commit"])
        self.assertEqual(_git_head(self.worktree), before_head)

    def test_completed_returns_without_commit(self) -> None:
        quest_fs.write_quest_file_state(
            self.wt_qdir,
            QuestFileState(
                state="Completed",
                current_slice=None,
                updated_at="2026-01-01T00:00:00Z",
                global_step=3,
            ),
        )
        _commit_all(self.worktree, "completed")
        before_head = _git_head(self.worktree)
        out = run_quest_v2(
            repo_path=self.worktree,
            quest_dir=self.wt_qdir,
            conductor_repo_path=self.repo_root,
            max_steps=1,
        )
        self.assertEqual(out["status"], "completed")
        self.assertEqual(_git_head(self.worktree), before_head)

    def test_human_intervention_stops_before_step(self) -> None:
        (self.wt_qdir / "human_intervention_request.md").write_text(
            "# Human intervention requested\n", encoding="utf-8"
        )
        out = run_quest_v2(
            repo_path=self.worktree,
            quest_dir=self.wt_qdir,
            conductor_repo_path=self.repo_root,
            max_steps=1,
        )
        self.assertEqual(out["status"], "human_intervention")

    @patch("quest_runner_service.state_machine.workflow_harness_callback.create_harness")
    @patch(
        "quest_runner_service.state_machine.workflow_harness_callback.perform_role_harness_sequence"
    )
    def test_implementing_commit_records_automated_step_metadata(
        self, mock_harness_sequence: MagicMock, mock_create: MagicMock
    ) -> None:
        mock_create.return_value = MagicMock()

        sl = self.wt_qdir / "slices" / "0000_impl"
        _scaffold_slice(sl)
        quest_fs.write_slice_file_state(
            sl,
            SliceFileState(
                state="Implementing",
                updated_at="2026-01-01T00:00:00Z",
            ),
        )
        quest_fs.write_quest_file_state(
            self.wt_qdir,
            QuestFileState(
                state="ExecuteSlice",
                current_slice=0,
                updated_at="2026-01-01T00:00:00Z",
                active_slice="0000_impl",
                global_step=5,
            ),
        )
        _commit_all(self.worktree, "implementing setup")

        def complete_implementation(**_: object) -> None:
            (sl / "implementation_done.md").write_text("done\n", encoding="utf-8")

        mock_harness_sequence.side_effect = complete_implementation
        before_head = _git_head(self.worktree)
        before_gs = quest_fs.read_quest_file_state(self.wt_qdir).global_step

        out = run_quest_v2(
            repo_path=self.worktree,
            quest_dir=self.wt_qdir,
            conductor_repo_path=self.repo_root,
            max_steps=1,
        )

        after_head = _git_head(self.worktree)
        self.assertNotEqual(after_head, before_head)
        self.assertEqual(out["status"], "max_steps")
        self.assertEqual(out["steps_executed"], 1)
        self.assertEqual(out["last_commit"], after_head)
        self.assertEqual(
            quest_fs.read_quest_file_state(self.wt_qdir).global_step,
            before_gs + 1,
        )

        parsed = parse_step_commit_message(_git_head_message(self.worktree))
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.metadata.global_step, before_gs + 1)
        snap = parsed.metadata.snapshot
        self.assertEqual(snap.node_name, "ExecuteActiveSliceNode")
        self.assertEqual(snap.state_before, "ExecuteSlice")
        self.assertEqual(snap.state_after, "ExecuteSlice")
        self.assertIsNotNone(snap.child)
        assert snap.child is not None
        self.assertEqual(snap.child.node_name, "SliceImplementingNode")
        self.assertEqual(snap.child.state_before, "Implementing")
        self.assertEqual(snap.child.state_after, "PolishingReview")

    @patch("quest_runner_service.state_machine.workflow_harness_callback.create_harness")
    def test_manual_advance_commits_and_increments_global_step(
        self, mock_create: MagicMock
    ) -> None:
        mock_create.return_value = MagicMock()
        from quest_runner_service.quest_runner import _quest_key

        quest_key = _quest_key(self.meta)
        git_ops = SubprocessGitOps()
        before_gs = quest_fs.read_quest_file_state(self.wt_qdir).global_step or 0
        result = advance_v2_top_level_step_without_harness(
            repo_path=self.worktree,
            quest_dir=self.wt_qdir,
            quest_key=quest_key,
            meta=self.meta,
            git_ops=git_ops,
        )
        self.assertEqual(result.kind, "advanced")
        self.assertEqual(result.previous_workflow_state, "PrePlanning")
        self.assertEqual(result.next_workflow_state, "PhysicalPlanning")
        self.assertIsNotNone(result.commit)
        after_gs = quest_fs.read_quest_file_state(self.wt_qdir).global_step
        self.assertEqual(after_gs, before_gs + 1)
        parsed = parse_step_commit_message(_git_head_message(self.worktree))
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.metadata.snapshot.node_name, "PrePlanningGateNode")

    @patch(
        "quest_runner_service.state_machine.workflow_harness_callback.perform_role_harness_sequence"
    )
    def test_implementing_stay_is_noop_without_file_changes(
        self, mock_harness: MagicMock
    ) -> None:
        from quest_runner_service.harness import HarnessResponse

        mock_harness.return_value = HarnessResponse(
            provider_thread_id="fake-thread-id",
            model="test",
            output_text="ok",
            thinking_tokens="",
            stream_events_count=0,
            idle_timeout=False,
            elapsed_seconds=0.1,
        )
        sl = self.wt_qdir / "slices" / "0000_impl"
        _scaffold_slice(sl)
        quest_fs.write_slice_file_state(
            sl,
            SliceFileState(
                state="Implementing",
                updated_at="2026-01-01T00:00:00Z",
            ),
        )
        quest_fs.write_quest_file_state(
            self.wt_qdir,
            QuestFileState(
                state="ExecuteSlice",
                current_slice=0,
                updated_at="2026-01-01T00:00:00Z",
                active_slice="0000_impl",
                global_step=5,
            ),
        )
        _commit_all(self.worktree, "implementing setup")
        before_head = _git_head(self.worktree)
        before_gs = quest_fs.read_quest_file_state(self.wt_qdir).global_step
        out = run_quest(
            repo_path=self.worktree,
            quest_dir=self.wt_qdir,
            conductor_repo_path=self.repo_root,
            max_steps=1,
        )
        self.assertEqual(out["status"], "max_steps")
        self.assertEqual(_git_head(self.worktree), before_head)
        self.assertEqual(quest_fs.read_quest_file_state(self.wt_qdir).global_step, before_gs)

    def test_execute_slice_child_commit_has_nested_snapshot(self) -> None:
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
                global_step=4,
            ),
        )
        _commit_all(self.worktree, "execute slice setup")
        from quest_runner_service.quest_runner import _quest_key

        result = advance_v2_top_level_step_without_harness(
            repo_path=self.worktree,
            quest_dir=self.wt_qdir,
            quest_key=_quest_key(self.meta),
            meta=self.meta,
            git_ops=SubprocessGitOps(),
        )
        self.assertEqual(result.kind, "advanced")
        parsed = parse_step_commit_message(_git_head_message(self.worktree))
        self.assertIsNotNone(parsed)
        assert parsed is not None
        snap = parsed.metadata.snapshot
        self.assertEqual(snap.node_name, "ExecuteActiveSliceNode")
        self.assertIsNotNone(snap.child)
        assert snap.child is not None
        self.assertEqual(snap.child.state_before, "SliceSetup")
        self.assertEqual(snap.child.state_after, "Implementing")

    def test_quest_documenting_completes_without_docs_changes(self) -> None:
        quest_fs.write_quest_file_state(
            self.wt_qdir,
            QuestFileState(
                state="QuestDocumenting",
                current_slice=None,
                updated_at="2026-01-01T00:00:00Z",
                global_step=6,
            ),
        )
        _commit_all(self.worktree, "documenting ready")
        from quest_runner_service.quest_runner import _quest_key

        result = advance_v2_top_level_step_without_harness(
            repo_path=self.worktree,
            quest_dir=self.wt_qdir,
            quest_key=_quest_key(self.meta),
            meta=self.meta,
            git_ops=SubprocessGitOps(),
        )
        self.assertEqual(result.kind, "advanced")
        self.assertEqual(result.next_workflow_state, "Completed")
        self.assertEqual(quest_fs.read_quest_file_state(self.wt_qdir).state, "Completed")


class ManualAdvanceReasonTests(WorkflowRunnerIntegrationFixture):
    def test_implementing_manual_advance_blocked_without_done_marker(self) -> None:
        from quest_runner_service.quest_service import AdvanceQuestValidationError
        from quest_runner_service.quest_runner import _quest_key

        sl = self.wt_qdir / "slices" / "0000_impl"
        pp = sl / "physicalplan"
        pp.mkdir(parents=True)
        (pp / "plan.md").write_text("# plan\n", encoding="utf-8")
        quest_fs.write_slice_file_state(
            sl,
            SliceFileState(
                state="Implementing",
                updated_at="2026-01-01T00:00:00Z",
            ),
        )
        (sl / "state_history.md").write_text(
            "# State Transition History\n", encoding="utf-8"
        )
        (sl / "polishing_issues.md").write_text("# Issues\n", encoding="utf-8")
        quest_fs.write_quest_file_state(
            self.wt_qdir,
            QuestFileState(
                state="ExecuteSlice",
                current_slice=0,
                updated_at="2026-01-01T00:00:00Z",
                active_slice="0000_impl",
                global_step=5,
            ),
        )
        _commit_all(self.worktree, "implementing setup")
        with self.assertRaises(AdvanceQuestValidationError) as ctx:
            self.svc.advance_quest(
                repo_path=str(self.temp.root),
                project="example",
                quest_type="main",
                quest_number=self.created["quest_number"],
            )
        self.assertEqual(ctx.exception.reason, "missing_implementation_done")


if __name__ == "__main__":
    unittest.main()
