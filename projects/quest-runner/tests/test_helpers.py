"""Shared helpers for Quest Runner REST and dashboard tests."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from quest_runner_service.api import create_app
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_service import QuestService
from quest_runner_service.worktrees import quest_worktree_base_dir


def git_init(path: Path) -> None:
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
    (path / ".gitignore").write_text("logs/\n", encoding="utf-8")
    (path / ".gitkeep").write_text("", encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=str(path), check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "init"],
        cwd=str(path),
        check=True,
        capture_output=True,
    )


def ensure_project(root: Path, project: str) -> None:
    (root / "projects" / project).mkdir(parents=True)


def cleanup_worktrees(source_root: Path) -> None:
    base = quest_worktree_base_dir(source_root)
    if base.is_dir():
        shutil.rmtree(base, ignore_errors=True)


class TempRepo:
    def __init__(self, conductor_root: Path) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = Path(self._tmpdir.name)
        self.conductor_root = conductor_root
        git_init(self.root)

    def cleanup(self) -> None:
        cleanup_worktrees(self.root)
        self._tmpdir.cleanup()


def make_app_client(
    repo_root: Path,
    source_repo_root: Path,
    *,
    lock: QuestLock | None = None,
    started_at: float = 1000.0,
):
    svc = QuestService(lock or QuestLock(), source_repo_root)
    app = create_app(
        quest_service=svc,
        source_repo_root=repo_root,
        started_at=started_at,
    )
    return app.test_client(), svc


def quest_dir_on_checkout(source_root: Path, create_out: dict) -> Path:
    from quest_runner_service.dashboard_data import resolve_quest_dirs

    _checkout, qdir = resolve_quest_dirs(
        source_root,
        create_out["project"],
        create_out["quest_type"],
        create_out["quest_number"],
    )
    return qdir
