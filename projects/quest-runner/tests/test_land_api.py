"""REST route tests for quest worktree landing."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from quest_runner_service import quest_fs
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.worktrees import (
    delete_branch,
    quest_worktree_path,
    worktree_exists,
)

from .test_helpers import TempRepo, cleanup_worktrees, ensure_project, make_app_client


def _worktree_path(source_root: Path, create_out: dict) -> Path:
    meta = quest_fs.read_quest_meta(Path(create_out["quest_dir"]))
    return quest_worktree_path(source_root, meta)


def _worktree_branch(create_out: dict) -> str:
    return create_out["worktree_branch"]


def _ensure_main_branch(repo: Path) -> None:
    result = subprocess.run(
        ["git", "-C", str(repo), "branch", "--show-current"],
        check=True,
        capture_output=True,
        text=True,
    )
    current = result.stdout.strip()
    if current != "main":
        subprocess.run(
            ["git", "-C", str(repo), "branch", "-M", "main"],
            check=True,
            capture_output=True,
        )


def _commit_all(repo: Path, message: str) -> str:
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", message],
        check=True,
        capture_output=True,
    )
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _branch_exists(repo: Path, branch: str) -> bool:
    result = subprocess.run(
        ["git", "-C", str(repo), "show-ref", "--verify", f"refs/heads/{branch}"],
        check=False,
        capture_output=True,
    )
    return result.returncode == 0


def _is_merge_commit(repo: Path, commit: str) -> bool:
    parents = subprocess.run(
        ["git", "-C", str(repo), "rev-list", "--parents", "-n", "1", commit],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip().split()
    return len(parents) > 2


class LandApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)
        _ensure_main_branch(self.temp.root)

    def test_land_requires_project(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        resp = client.post(
            "/land",
            json={"quest_type": "main", "quest_number": 0},
        )
        self.assertEqual(resp.status_code, 400)

    def test_land_lock_contention(self) -> None:
        ensure_project(self.temp.root, "example")
        lock = QuestLock()
        client, svc = make_app_client(self.temp.root, self.repo_root, lock=lock)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Lock Land",
        )
        from quest_runner_service import dashboard_data

        meta = quest_fs.read_quest_meta(Path(out["quest_dir"]))
        lock_key = dashboard_data.lock_key_for_quest(self.temp.root, meta)
        self.assertTrue(lock.acquire(lock_key, "main", out["quest_number"], "holding"))
        try:
            resp = client.post(
                "/land",
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

    def test_land_missing_worktree_returns_409(self) -> None:
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
            "/land",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertEqual(body["project"], "example")
        self.assertIn("expected_worktree", body)

    def test_land_dirty_source_fails_before_mutation(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Dirty Source",
        )
        worktree = _worktree_path(self.temp.root, out)
        (self.temp.root / "dirty.txt").write_text("x", encoding="utf-8")
        resp = client.post(
            "/land",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertEqual(body["status"], "target_dirty")
        self.assertIn("status_output", body)
        meta = quest_fs.read_quest_meta(Path(out["quest_dir"]))
        self.assertTrue(worktree_exists(self.temp.root, meta))

    def test_land_dirty_worktree_fails_before_rebase(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Dirty Worktree",
        )
        worktree = _worktree_path(self.temp.root, out)
        (worktree / "dirty.txt").write_text("x", encoding="utf-8")
        resp = client.post(
            "/land",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertEqual(body["status"], "worktree_dirty")
        self.assertEqual(body["worktree_path"], str(worktree))
        self.assertIn("next_step", body)

    def test_land_success(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Land Me",
        )
        worktree = _worktree_path(self.temp.root, out)
        wt_branch = _worktree_branch(out)
        (worktree / "quest-work.txt").write_text("done\n", encoding="utf-8")
        quest_commit = _commit_all(worktree, "quest work")
        resp = client.post(
            "/land",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "landed")
        self.assertTrue(body["rebased"])
        self.assertTrue(body["fast_forwarded"])
        self.assertTrue(body["worktree_deleted"])
        self.assertTrue(body["branch_deleted"])
        self.assertEqual(body["target_head"], quest_commit)
        self.assertFalse(worktree.is_dir())
        self.assertFalse(_branch_exists(self.temp.root, wt_branch))
        self.assertFalse(_is_merge_commit(self.temp.root, body["target_head"]))

    def test_land_rebase_conflict(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Conflict",
        )
        worktree = _worktree_path(self.temp.root, out)
        shared = worktree / "projects" / "example" / "shared.txt"
        shared.parent.mkdir(parents=True, exist_ok=True)
        shared.write_text("worktree\n", encoding="utf-8")
        _commit_all(worktree, "worktree change")

        source_shared = self.temp.root / "projects" / "example" / "shared.txt"
        source_shared.parent.mkdir(parents=True, exist_ok=True)
        source_shared.write_text("main\n", encoding="utf-8")
        _commit_all(self.temp.root, "main change")

        resp = client.post(
            "/land",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertEqual(body["status"], "rebase_failed")
        self.assertEqual(body["worktree_path"], str(worktree))
        self.assertIn("next_step", body)
        self.assertTrue(worktree.is_dir())

    def test_land_fast_forward_failure_keeps_worktree(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="FF Fail",
        )
        worktree = _worktree_path(self.temp.root, out)
        (worktree / "quest-work.txt").write_text("done\n", encoding="utf-8")
        _commit_all(worktree, "quest work")

        with patch(
            "quest_runner_service.quest_service.merge_ff_only",
            return_value=type(
                "R",
                (),
                {"returncode": 1, "stderr": "not possible to fast-forward", "stdout": ""},
            )(),
        ):
            resp = client.post(
                "/land",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": out["quest_number"],
                },
            )
        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertEqual(body["status"], "fast_forward_failed")
        self.assertTrue(worktree.is_dir())

    def test_land_branch_delete_failure_reports_partial_cleanup(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Branch Delete Fail",
        )
        worktree = _worktree_path(self.temp.root, out)
        wt_branch = _worktree_branch(out)
        (worktree / "quest-work.txt").write_text("done\n", encoding="utf-8")
        _commit_all(worktree, "quest work")

        with patch(
            "quest_runner_service.quest_service.delete_branch",
            return_value=type(
                "R",
                (),
                {"returncode": 1, "stderr": "cannot delete branch", "stdout": ""},
            )(),
        ):
            resp = client.post(
                "/land",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": out["quest_number"],
                },
            )

        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertEqual(body["status"], "branch_delete_failed")
        self.assertTrue(body["worktree_deleted"])
        self.assertFalse(body["branch_deleted"])
        self.assertFalse(worktree.is_dir())
        self.assertTrue(_branch_exists(self.temp.root, wt_branch))

        delete_branch(self.temp.root, wt_branch)


class ExperimentLandApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)
        import shutil

        from .test_experiments import _add_bare_remote

        bare = _add_bare_remote(self.temp.root)
        self.addCleanup(lambda: shutil.rmtree(bare, ignore_errors=True))

    def _setup_completed_experiment(self) -> tuple[object, dict, str]:
        from quest_runner_service import quest_fs
        from quest_runner_service.quest_types import QuestState, QuestStateInfo
        from quest_runner_service.worktrees import remove_partial_worktree

        from .test_experiments import (
            _add_experiment_worktree,
            _git_commit_all,
            _write_experiment_on_quest,
        )

        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Experiment Land API",
        )
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        quest_meta = quest_fs.read_quest_meta(source_qdir)
        exp_meta = _write_experiment_on_quest(source_qdir, quest_meta)
        _git_commit_all(self.temp.root, "experiment metadata")
        _add_experiment_worktree(self.temp.root, exp_meta)
        remove_partial_worktree(self.temp.root, quest_meta)

        from quest_runner_service.experiments import experiment_worktree_path

        wt_path = experiment_worktree_path(self.temp.root, exp_meta)
        wt_qdir = quest_fs.find_quest_dir(
            wt_path, "example", "main", out["quest_number"]
        )
        assert wt_qdir is not None
        (wt_qdir / "logs").mkdir(exist_ok=True)
        (wt_qdir / "logs" / "step_0001_run.jsonl").write_text("{}\n", encoding="utf-8")
        quest_fs.write_quest_state(
            wt_qdir,
            QuestStateInfo(
                state=QuestState.ExperimentComplete,
                current_slice=None,
                updated_at="2026-06-08T00:00:00Z",
                global_step=2,
            ),
        )
        _git_commit_all(wt_path, "experiment complete")
        return client, out, exp_meta.experiment_id

    def test_experiment_land_requires_experiment_id(self) -> None:
        client, out, _exp_id = self._setup_completed_experiment()
        resp = client.post(
            "/experiments/land",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 400)

    def test_experiment_land_success(self) -> None:
        client, out, exp_id = self._setup_completed_experiment()
        resp = client.post(
            "/experiments/land",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "experiment_id": exp_id,
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "landed")
        self.assertEqual(body["experiment_id"], exp_id)
        self.assertEqual(body["logs_copied"], 1)
        self.assertTrue(body["worktree_deleted"])
        self.assertTrue(body["branch_deleted"])
        self.assertTrue(body["source_commit"])

    def test_experiment_land_push_failure_returns_409(self) -> None:
        client, out, exp_id = self._setup_completed_experiment()
        with patch(
            "quest_runner_service.experiments.push_experiment_branch",
            side_effect=__import__(
                "quest_runner_service.experiments",
                fromlist=["ExperimentLandError"],
            ).ExperimentLandError("push failed"),
        ):
            resp = client.post(
                "/experiments/land",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": out["quest_number"],
                    "experiment_id": exp_id,
                },
            )
        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertEqual(body["status"], "push_failed")
        self.assertFalse(body["worktree_deleted"])
        self.assertFalse(body["branch_deleted"])


if __name__ == "__main__":
    unittest.main()
