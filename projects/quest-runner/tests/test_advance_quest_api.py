"""REST route tests for manual quest advancement."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from quest_runner_service import quest_fs
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_types import (
    QuestState,
    QuestStateInfo,
    SliceState,
    SliceStateInfo,
)
from quest_runner_service.worktrees import quest_worktree_path

from .test_helpers import TempRepo, cleanup_worktrees, ensure_project, make_app_client


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


def _commit_all(repo: Path, message: str) -> None:
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", message],
        check=True,
        capture_output=True,
    )


class AdvanceQuestApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_advance_quest_requires_project(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        resp = client.post(
            "/advance_quest",
            json={"quest_type": "main", "quest_number": 0},
        )
        self.assertEqual(resp.status_code, 400)

    def test_advance_quest_missing_worktree_returns_409(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="No Worktree",
        )
        cleanup_worktrees(self.temp.root)
        resp = client.post(
            "/advance_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertEqual(body["project"], "example")
        self.assertEqual(body["quest_type"], "main")
        self.assertIn("expected_worktree", body)

    def test_advance_quest_lock_contention(self) -> None:
        ensure_project(self.temp.root, "example")
        lock = QuestLock()
        client, svc = make_app_client(self.temp.root, self.repo_root, lock=lock)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Lock Quest",
        )
        from quest_runner_service import dashboard_data

        meta = quest_fs.read_quest_meta(Path(out["quest_dir"]))
        lock_key = dashboard_data.lock_key_for_quest(self.temp.root, meta)
        self.assertTrue(lock.acquire(lock_key, "main", out["quest_number"], "holding"))
        try:
            resp = client.post(
                "/advance_quest",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": out["quest_number"],
                },
            )
            self.assertEqual(resp.status_code, 409)
            self.assertIn("lock_owner", resp.get_json())
        finally:
            lock.release(lock_key)

    def test_pre_planning_advances_to_physical_planning(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Advance PrePlan",
        )
        wt_qdir = _worktree_quest_dir(self.temp.root, out)
        meta = quest_fs.read_quest_meta(wt_qdir)
        worktree = quest_worktree_path(self.temp.root, meta)
        before = quest_fs.read_quest_state(wt_qdir)
        self.assertEqual(before.state, QuestState.PrePlanning)

        resp = client.post(
            "/advance_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "advanced")
        self.assertEqual(body["previous_state"], "PrePlanning")
        self.assertEqual(body["next_state"], "PhysicalPlanning")
        self.assertIn("commit", body)

        after = quest_fs.read_quest_state(wt_qdir)
        self.assertEqual(after.state, QuestState.PhysicalPlanning)
        head = subprocess.run(
            ["git", "-C", str(worktree), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(body["commit"], head)

    def test_completed_returns_noop(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Completed Quest",
        )
        wt_qdir = _worktree_quest_dir(self.temp.root, out)
        meta = quest_fs.read_quest_meta(wt_qdir)
        worktree = quest_worktree_path(self.temp.root, meta)
        quest_fs.write_quest_state(
            wt_qdir,
            QuestStateInfo(
                state=QuestState.Completed,
                current_slice=None,
                updated_at="2026-01-01T00:00:00Z",
                global_step=3,
            ),
        )
        _commit_all(worktree, "mark completed")

        resp = client.post(
            "/advance_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "completed")
        self.assertFalse(body["advanced"])
        self.assertNotIn("commit", body)

    def test_missing_implementation_done_returns_422_without_state_change(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Implement Blocked",
        )
        wt_qdir = _worktree_quest_dir(self.temp.root, out)
        meta = quest_fs.read_quest_meta(wt_qdir)
        worktree = quest_worktree_path(self.temp.root, meta)
        sl = wt_qdir / "slices" / "0000_impl"
        pp = sl / "physicalplan"
        pp.mkdir(parents=True)
        (pp / "plan.md").write_text("# plan\n", encoding="utf-8")
        quest_fs.write_slice_state(
            sl,
            SliceStateInfo(
                state=SliceState.Implementing,
                updated_at="2026-01-01T00:00:00Z",
            ),
        )
        (sl / "state_history.md").write_text(
            "# State Transition History\n", encoding="utf-8"
        )
        (sl / "polishing_issues.md").write_text("# Issues\n", encoding="utf-8")
        quest_fs.write_quest_state(
            wt_qdir,
            QuestStateInfo(
                state=QuestState.ExecuteSlice,
                current_slice=0,
                updated_at="2026-01-01T00:00:00Z",
                active_slice="0000_impl",
                global_step=5,
            ),
        )
        _commit_all(worktree, "implementing setup")
        before = quest_fs.read_quest_state(wt_qdir)

        resp = client.post(
            "/advance_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 422)
        self.assertEqual(resp.get_json()["reason"], "missing_implementation_done")
        after = quest_fs.read_quest_state(wt_qdir)
        self.assertEqual(after.state, before.state)
        self.assertEqual(after.active_slice, before.active_slice)

    def test_physical_plan_acceptance_uses_shared_commit_helper(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Plan Accepted",
        )
        wt_qdir = _worktree_quest_dir(self.temp.root, out)
        meta = quest_fs.read_quest_meta(wt_qdir)
        worktree = quest_worktree_path(self.temp.root, meta)
        sl = wt_qdir / "slices" / "0000_a"
        pp = sl / "physicalplan"
        pp.mkdir(parents=True)
        (pp / "plan.md").write_text("# plan\n", encoding="utf-8")
        quest_fs.write_slice_state(
            sl,
            SliceStateInfo(
                state=SliceState.NotStarted,
                updated_at="2026-01-01T00:00:00Z",
            ),
        )
        (sl / "state_history.md").write_text(
            "# State Transition History\n", encoding="utf-8"
        )
        (sl / "polishing_issues.md").write_text("# Issues\n", encoding="utf-8")
        (wt_qdir / "physicalplan_accepted.md").write_text(
            "# Physical Plan Accepted\n", encoding="utf-8"
        )
        (wt_qdir / "physicalplan_issues.md").write_text("# Issues\n", encoding="utf-8")
        quest_fs.write_quest_state(
            wt_qdir,
            QuestStateInfo(
                state=QuestState.ReviewPhysicalPlan,
                current_slice=None,
                updated_at="2026-01-01T00:00:00Z",
                global_step=2,
            ),
        )
        _commit_all(worktree, "review ready")

        with patch(
            "quest_runner_service.state_machine.v2_step_executor.commit_v2_snapshot_step"
        ) as mock_commit:
            from quest_runner_service.state_machine.v2_step_executor import V2StepResult

            mock_commit.return_value = V2StepResult(
                kind="committed", last_commit="abc123"
            )
            resp = client.post(
                "/advance_quest",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": out["quest_number"],
                },
            )
        self.assertEqual(resp.status_code, 200)
        mock_commit.assert_called_once()
        self.assertEqual(resp.get_json()["next_state"], "PrepareNextSlice")


if __name__ == "__main__":
    unittest.main()
