"""Tests for project-local quest creation and worktree bootstrap."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

from quest_runner_service import quest_fs
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_service import (
    InvalidProject,
    InvalidQuestInput,
    NotAGitRepo,
    QuestService,
    RepoNotFound,
    normalize_slug,
)
from quest_runner_service.quest_types import QuestMeta, QuestState
from quest_runner_service.worktrees import WorktreeCreationError, is_worktree_clean


def _git_init(path: Path) -> None:
    subprocess.run(["git", "init"], cwd=str(path), check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=str(path),
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=str(path),
        check=True,
        capture_output=True,
    )


def _ensure_project(root: Path, project: str) -> None:
    (root / "projects" / project).mkdir(parents=True)


def _cleanup_worktrees(source_root: Path) -> None:
    base = source_root.resolve().parent / ".quest-worktrees"
    if base.is_dir():
        shutil.rmtree(base, ignore_errors=True)


class NormalizeSlugTests(unittest.TestCase):
    def test_hello_world(self) -> None:
        self.assertEqual(normalize_slug("Hello World"), "hello_world")

    def test_bang_only_is_empty(self) -> None:
        self.assertEqual(normalize_slug("!!!"), "")


class CreateQuestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self._active_roots: list[Path] = []

    def tearDown(self) -> None:
        for root in self._active_roots:
            _cleanup_worktrees(root)

    def _service(self) -> QuestService:
        return QuestService(QuestLock(), self.repo_root)

    def _track_root(self, root: Path) -> Path:
        self._active_roots.append(root)
        return root

    def test_creates_project_local_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            svc = self._service()
            out = svc.create_quest(
                repo_path=str(root),
                project="example",
                quest_type="main",
                name="My Quest",
            )
            qdir = Path(out["quest_dir"]).resolve()
            self.assertEqual(
                qdir,
                (root / "projects" / "example" / "quests" / "main" / "0000_my_quest").resolve(),
            )
            self.assertTrue((qdir / "meta.json").is_file())
            self.assertTrue((qdir / "state_execution_config.yaml").is_file())
            exec_cfg = yaml.safe_load(
                (qdir / "state_execution_config.yaml").read_text(encoding="utf-8")
            )
            self.assertEqual(
                exec_cfg["profiles"]["implementer"]["modify_block"],
                ["projects/**"],
            )
            meta = quest_fs.read_quest_meta(qdir)
            self.assertEqual(meta.project, "example")
            st = quest_fs.read_quest_state(qdir)
            self.assertEqual(st.state, QuestState.PrePlanning)
            self.assertEqual(out["project"], "example")
            self.assertEqual(out["worktree_name"], "example_main_0000_my_quest")
            self.assertEqual(
                out["worktree_branch"], "quest/example_main_0000_my_quest"
            )
            worktree_path = Path(out["worktree_path"])
            self.assertTrue(worktree_path.is_dir())
            self.assertTrue(
                (worktree_path / "projects" / "example" / "quests" / "main" / "0000_my_quest").is_dir()
            )
            self.assertTrue(is_worktree_clean(worktree_path))

    def test_numbering_scoped_by_project_and_type(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "alpha")
            _ensure_project(root, "beta")
            svc = self._service()
            a = svc.create_quest(str(root), "alpha", "side", "One")
            b = svc.create_quest(str(root), "beta", "side", "One")
            c = svc.create_quest(str(root), "alpha", "side", "Two")
            self.assertEqual(a["quest_number"], 0)
            self.assertEqual(b["quest_number"], 0)
            self.assertEqual(c["quest_number"], 1)

    def test_quest_create_commit_contains_only_quest_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            svc = self._service()
            out = svc.create_quest(str(root), "example", "main", "Scoped Commit")
            show = subprocess.run(
                ["git", "-C", str(root), "show", "--name-only", "--pretty=format:", out["quest_create_commit"]],
                check=True,
                capture_output=True,
                text=True,
            )
            paths = [line.strip() for line in show.stdout.splitlines() if line.strip()]
            rel = Path(out["quest_dir"]).resolve().relative_to(root.resolve()).as_posix()
            self.assertTrue(paths)
            self.assertTrue(all(p == rel or p.startswith(rel + "/") for p in paths))
            self.assertFalse(any(p.startswith("quests/") for p in paths))
            status = subprocess.run(
                ["git", "-C", str(root), "status", "--porcelain"],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(status.stdout.strip(), "")

    def test_refuses_dirty_source_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            (root / "dirty.txt").write_text("x", encoding="utf-8")
            svc = self._service()
            with self.assertRaises(InvalidQuestInput) as ctx:
                svc.create_quest(str(root), "example", "main", "X")
            self.assertIn("uncommitted", str(ctx.exception).lower())

    def test_refuses_detached_source_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            readme = root / "README.md"
            readme.write_text("init", encoding="utf-8")
            subprocess.run(["git", "add", "README.md"], cwd=str(root), check=True)
            subprocess.run(
                ["git", "commit", "-m", "init"],
                cwd=str(root),
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["git", "checkout", "--detach"],
                cwd=str(root),
                check=True,
                capture_output=True,
            )
            svc = self._service()
            with self.assertRaises(InvalidQuestInput) as ctx:
                svc.create_quest(str(root), "example", "main", "X")
            self.assertIn("detached", str(ctx.exception).lower())

    def test_rollback_before_commit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            svc = self._service()
            quest_dir = root / "projects" / "example" / "quests" / "main" / "0000_my_quest"

            def boom(*_a, **_k):
                raise OSError("simulated write failure")

            with patch.object(quest_fs, "write_quest_meta", side_effect=boom):
                with self.assertRaises(OSError):
                    svc.create_quest(str(root), "example", "main", "My Quest")
            self.assertFalse(quest_dir.exists())

    def test_rollback_after_commit_when_worktree_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            svc = self._service()

            with patch(
                "quest_runner_service.quest_service.create_quest_worktree",
                side_effect=RuntimeError("worktree boom"),
            ):
                with self.assertRaises(WorktreeCreationError) as ctx:
                    svc.create_quest(str(root), "example", "main", "My Quest")
            qdir = root / "projects" / "example" / "quests" / "main" / "0000_my_quest"
            self.assertTrue(qdir.is_dir())
            self.assertIn("manual cleanup", str(ctx.exception).lower())
            worktree = root.parent / ".quest-worktrees" / "example_main_0000_my_quest"
            self.assertFalse(worktree.exists())

    def test_invalid_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git_init(root)
            svc = self._service()
            with self.assertRaises(InvalidProject):
                svc.create_quest(str(root), "missing", "main", "X")

    def test_repo_not_found(self) -> None:
        svc = self._service()
        with self.assertRaises(RepoNotFound):
            svc.create_quest("/no/such/repo", "example", "main", "x")

    def test_not_git_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _ensure_project(Path(tmp), "example")
            svc = self._service()
            with self.assertRaises(NotAGitRepo):
                svc.create_quest(tmp, "example", "main", "x")

    def test_meta_matches_expected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            svc = self._service()
            out = svc.create_quest(
                str(root),
                "example",
                "main",
                "Meta Quest",
                requested_by="tester",
            )
            qdir = Path(out["quest_dir"])
            st = quest_fs.read_quest_state(qdir)
            meta = quest_fs.read_quest_meta(qdir)
            self.assertEqual(
                meta,
                QuestMeta(
                    project="example",
                    quest_type="main",
                    quest_number=0,
                    quest_slug="meta_quest",
                    quest_name="Meta Quest",
                    created_at=st.updated_at,
                    created_by="tester",
                ),
            )

    def test_deferred_retry_preserves_project(self) -> None:
        from quest_runner_service.quest_runner import QuestHarnessError

        class CapturingScheduler:
            def __init__(self) -> None:
                self.callback = None
                self.description = None

            def schedule(self, *, delay_seconds, callback, description):
                self.callback = callback
                self.description = dict(description)
                return {
                    "task_id": "task-1",
                    "scheduled_for": "2026-06-07T03:00:00Z",
                    "delay_seconds": delay_seconds,
                    "description": dict(description),
                }

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            qdir = root / "projects" / "example" / "quests" / "main" / "0007_retry"
            qdir.mkdir(parents=True)
            scheduler = CapturingScheduler()
            svc = QuestService(QuestLock(), self.repo_root, scheduler=scheduler)

            with patch(
                "quest_runner_service.quest_runner.run_quest",
                side_effect=QuestHarnessError(
                    detail="rate_limit",
                    raw_output="rate limited",
                    steps_executed=3,
                    last_commit="abc123",
                    captured_outputs=[{"role": "polisher", "text": "blocked"}],
                ),
            ):
                result = svc._run_quest_locked(
                    root,
                    qdir,
                    "example",
                    "main",
                    7,
                    12,
                )

            self.assertEqual(result["status"], "deferred")
            self.assertEqual(result["steps_executed"], 3)
            self.assertEqual(scheduler.description["project"], "example")
            self.assertIsNotNone(scheduler.callback)

            with patch.object(svc, "run_quest") as run_quest:
                scheduler.callback()

            run_quest.assert_called_once_with(
                repo_path=str(root),
                project="example",
                quest_type="main",
                quest_number=7,
                max_steps=12,
            )


if __name__ == "__main__":
    unittest.main()
