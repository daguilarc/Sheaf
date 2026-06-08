"""Git worktree helpers for project-local quest creation."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

from .quest_types import QuestMeta

_PROJECT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


class SourceCheckoutError(Exception):
    """Source Sheaf checkout is not ready for quest creation."""


class SourceCheckoutDetached(SourceCheckoutError):
    def __init__(self, repo_path: str) -> None:
        self.repo_path = repo_path
        super().__init__(
            f"Source checkout is detached HEAD; checkout a named branch before "
            f"creating a quest: {repo_path}"
        )


class SourceCheckoutNotClean(SourceCheckoutError):
    def __init__(self, repo_path: str, status_output: str) -> None:
        self.repo_path = repo_path
        self.status_output = status_output
        super().__init__(
            f"Source checkout has uncommitted changes; commit or discard them "
            f"before creating a quest: {repo_path}\n{status_output}"
        )


class WorktreeCreationError(Exception):
    """Quest scaffold commit succeeded but worktree creation failed."""

    def __init__(
        self,
        message: str,
        *,
        quest_dir: Path,
        quest_create_commit: str,
    ) -> None:
        self.quest_dir = quest_dir
        self.quest_create_commit = quest_create_commit
        super().__init__(message)


def validate_project_name(project: str) -> None:
    if not _PROJECT_NAME_RE.match(project):
        raise ValueError(
            f"Invalid project name {project!r}; expected "
            r"^[A-Za-z0-9][A-Za-z0-9_-]*$"
        )


def quest_worktree_name(
    project: str,
    quest_type: str,
    quest_number: int,
    quest_slug: str,
) -> str:
    return f"{project}_{quest_type}_{quest_number:04d}_{quest_slug}"


def quest_worktree_branch(worktree_name: str) -> str:
    return f"quest/{worktree_name}"


def quest_worktree_base_dir(source_repo_root: Path) -> Path:
    return source_repo_root.resolve().parent / ".quest-worktrees"


def quest_worktree_path(source_repo_root: Path, meta: QuestMeta) -> Path:
    name = quest_worktree_name(
        meta.project,
        meta.quest_type,
        meta.quest_number,
        meta.quest_slug,
    )
    return quest_worktree_base_dir(source_repo_root) / name


def _git_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "quest-runner")
    env.setdefault("GIT_AUTHOR_EMAIL", "quest-runner@local")
    env.setdefault("GIT_COMMITTER_NAME", "quest-runner")
    env.setdefault("GIT_COMMITTER_EMAIL", "quest-runner@local")
    return env


def run_git(
    git_dir: Path,
    *args: str,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(git_dir), *args],
        check=check,
        capture_output=True,
        text=True,
        env=_git_env(),
    )


def _git(
    source_repo_root: Path,
    *args: str,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return run_git(source_repo_root, *args, check=check)


def current_branch(source_repo_root: Path) -> str:
    r = _git(source_repo_root, "branch", "--show-current", check=False)
    if r.returncode != 0:
        raise SourceCheckoutError(
            f"Failed to read current branch in {source_repo_root}: {r.stderr.strip()}"
        )
    branch = r.stdout.strip()
    if not branch:
        raise SourceCheckoutDetached(str(source_repo_root))
    return branch


def assert_source_checkout_clean(source_repo_root: Path) -> str:
    branch = current_branch(source_repo_root)
    status = _git(source_repo_root, "status", "--porcelain", check=False)
    if status.returncode != 0:
        raise SourceCheckoutError(
            f"Failed to read git status in {source_repo_root}: {status.stderr.strip()}"
        )
    dirty = status.stdout.strip()
    if dirty:
        raise SourceCheckoutNotClean(str(source_repo_root), dirty)
    return branch


def is_git_worktree(path: Path) -> bool:
    r = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"],
        check=False,
        capture_output=True,
        text=True,
    )
    return r.returncode == 0 and r.stdout.strip().lower() == "true"


def worktree_exists(source_repo_root: Path, meta: QuestMeta) -> bool:
    path = quest_worktree_path(source_repo_root, meta)
    if not path.is_dir():
        return False
    return is_git_worktree(path)


def create_quest_scaffold_commit(
    source_repo_root: Path,
    quest_dir: Path,
    *,
    project: str,
    quest_type: str,
    quest_number: int,
    quest_slug: str,
) -> str:
    rel = quest_dir.resolve().relative_to(source_repo_root.resolve()).as_posix()
    _git(source_repo_root, "add", "--", rel)
    message = f"quest-create: {project}/{quest_type}/{quest_number:04d}_{quest_slug}"
    _git(source_repo_root, "commit", "-m", message)
    rev = _git(source_repo_root, "rev-parse", "HEAD")
    return rev.stdout.strip()


def create_quest_worktree(source_repo_root: Path, meta: QuestMeta) -> Path:
    worktree_path = quest_worktree_path(source_repo_root, meta)
    branch = quest_worktree_branch(
        quest_worktree_name(
            meta.project,
            meta.quest_type,
            meta.quest_number,
            meta.quest_slug,
        )
    )
    worktree_path.parent.mkdir(parents=True, exist_ok=True)
    _git(
        source_repo_root,
        "worktree",
        "add",
        "-b",
        branch,
        str(worktree_path),
        "HEAD",
    )
    return worktree_path


def remove_partial_worktree(
    source_repo_root: Path,
    meta: QuestMeta,
    *,
    remove_branch: bool = True,
) -> None:
    worktree_path = quest_worktree_path(source_repo_root, meta)
    branch = quest_worktree_branch(
        quest_worktree_name(
            meta.project,
            meta.quest_type,
            meta.quest_number,
            meta.quest_slug,
        )
    )
    if worktree_path.is_dir():
        _git(
            source_repo_root,
            "worktree",
            "remove",
            "--force",
            str(worktree_path),
            check=False,
        )
        if worktree_path.exists():
            shutil.rmtree(worktree_path, ignore_errors=True)
    if remove_branch:
        _git(source_repo_root, "branch", "-D", branch, check=False)


def is_worktree_clean(worktree_path: Path) -> bool:
    clean, _dirty = porcelain_status(worktree_path)
    return clean


def porcelain_status(git_dir: Path) -> tuple[bool, str]:
    status = run_git(git_dir, "status", "--porcelain", check=False)
    if status.returncode != 0:
        raise SourceCheckoutError(
            f"Failed to read git status in {git_dir}: {status.stderr.strip()}"
        )
    output = status.stdout.strip()
    return (not output, output)


def branch_exists(git_dir: Path, branch: str) -> bool:
    result = run_git(
        git_dir,
        "show-ref",
        "--verify",
        f"refs/heads/{branch}",
        check=False,
    )
    return result.returncode == 0


def checkout_branch(git_dir: Path, branch: str) -> None:
    run_git(git_dir, "checkout", branch)


def rebase_onto(worktree_path: Path, onto_branch: str) -> subprocess.CompletedProcess[str]:
    return run_git(worktree_path, "rebase", onto_branch, check=False)


def merge_ff_only(git_dir: Path, branch: str) -> subprocess.CompletedProcess[str]:
    return run_git(git_dir, "merge", "--ff-only", branch, check=False)


def remove_worktree(source_repo_root: Path, worktree_path: Path) -> subprocess.CompletedProcess[str]:
    return run_git(
        source_repo_root,
        "worktree",
        "remove",
        str(worktree_path),
        check=False,
    )


def delete_branch(git_dir: Path, branch: str) -> subprocess.CompletedProcess[str]:
    return run_git(git_dir, "branch", "-d", branch, check=False)


def rev_parse_head(git_dir: Path) -> str:
    result = run_git(git_dir, "rev-parse", "HEAD")
    return result.stdout.strip()
