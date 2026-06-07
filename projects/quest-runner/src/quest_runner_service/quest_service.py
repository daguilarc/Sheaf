"""Quest-level operations (create, run, …)."""

from __future__ import annotations

import re
import shutil
import subprocess
import threading
import uuid
import logging
from pathlib import Path

from . import quest_fs
from .dashboard_runs import ActiveRunTracker
from .deferred_tasks import DeferredTaskScheduler
from .quest_lock import LockInfo, QuestLock
from .quest_types import QuestMeta, QuestState, QuestStateInfo, utc_now_iso
from .worktrees import (
    SourceCheckoutDetached,
    SourceCheckoutNotClean,
    WorktreeCreationError,
    assert_source_checkout_clean,
    create_quest_scaffold_commit,
    create_quest_worktree,
    quest_worktree_branch,
    quest_worktree_name,
    quest_worktree_path,
    remove_partial_worktree,
    validate_project_name,
)


log = logging.getLogger("conductor")
_DEFAULT_SCHEDULER = DeferredTaskScheduler()


class QuestCreationError(Exception):
    """Base class for quest creation failures."""


class RepoNotFound(QuestCreationError):
    """Target repository path is missing or not a directory."""

    def __init__(self, repo_path: str) -> None:
        self.repo_path = repo_path
        super().__init__(
            f"Repository path does not exist or is not a directory: {repo_path}"
        )


class NotAGitRepo(QuestCreationError):
    """Path exists but is not a git working tree."""

    def __init__(self, repo_path: str) -> None:
        self.repo_path = repo_path
        super().__init__(f"Not a git repository: {repo_path}")


class InvalidQuestInput(QuestCreationError):
    """Invalid quest_type, name, slug, or similar."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class MissingDefaultExecutionConfig(QuestCreationError):
    """Bundled default `state_execution_config.yaml` is missing."""

    def __init__(self, path: Path) -> None:
        self.path = path
        super().__init__(f"Missing default execution config: {path}")


class QuestLockContention(Exception):
    """Another quest run already holds the lock for this repository."""

    def __init__(self, message: str, repo_path: str, lock_info: LockInfo) -> None:
        self.repo_path = repo_path
        self.lock_info = lock_info
        super().__init__(message)


class QuestNotFound(Exception):
    """No quest directory matches the given project, type, and number."""

    def __init__(self, project: str, quest_type: str, quest_number: int) -> None:
        self.project = project
        self.quest_type = quest_type
        self.quest_number = quest_number
        super().__init__(
            f"No quest found for project={project!r} type={quest_type!r} "
            f"number={quest_number}"
        )


class InvalidProject(QuestCreationError):
    """Project name is invalid or missing under projects/."""

    def __init__(self, project: str, reason: str) -> None:
        self.project = project
        self.reason = reason
        super().__init__(reason)


class FatalInvariantError(Exception):
    """Unrecoverable quest runner invariant violation."""

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)


_non_slug_re = re.compile(r"[^a-z0-9_]+")
_underscore_run_re = re.compile(r"_+")


def normalize_slug(raw: str) -> str:
    s = raw.lower()
    s = re.sub(r"[\s\-]+", "_", s)
    s = _non_slug_re.sub("", s)
    s = _underscore_run_re.sub("_", s)
    return s.strip("_")
def _resolve_repo(repo_path: str) -> Path:
    p = Path(repo_path).expanduser().resolve()
    if not p.is_dir():
        raise RepoNotFound(repo_path)
    return p


def _is_git_repo(path: Path) -> bool:
    try:
        r = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"],
            check=False,
            capture_output=True,
            text=True,
        )
        return r.returncode == 0 and r.stdout.strip().lower() == "true"
    except FileNotFoundError:
        return False


def _next_quest_number(repo_path: Path, project: str, quest_type: str) -> int:
    dirs = quest_fs.list_quest_dirs(repo_path, project, quest_type)
    if not dirs:
        return 0
    return max(int(p.name[:4]) for p in dirs) + 1


def _validate_project(repo_root: Path, project: str) -> None:
    try:
        validate_project_name(project)
    except ValueError as e:
        raise InvalidProject(project, str(e)) from e
    project_dir = repo_root / "projects" / project
    if not project_dir.is_dir():
        raise InvalidProject(
            project,
            f"Project directory does not exist: {project_dir}",
        )


class QuestService:
    """Holds quest-related dependencies. One instance per conductor process."""

    def __init__(
        self,
        lock: QuestLock,
        conductor_repo_path: Path,
        scheduler: DeferredTaskScheduler | None = None,
        run_tracker: ActiveRunTracker | None = None,
    ) -> None:
        self.lock = lock
        self.conductor_repo_path = conductor_repo_path.resolve()
        self.scheduler = scheduler or _DEFAULT_SCHEDULER
        self.run_tracker = run_tracker or ActiveRunTracker()

    def _schedule_deferred_quest_run(
        self,
        *,
        repo_path: Path,
        project: str,
        quest_type: str,
        quest_number: int,
        max_steps: int,
        reason: str,
        delay_seconds: int,
    ) -> dict:
        repo_path_str = str(repo_path)

        def _callback() -> None:
            try:
                self.run_quest(
                    repo_path=repo_path_str,
                    project=project,
                    quest_type=quest_type,
                    quest_number=quest_number,
                    max_steps=max_steps,
                )
            except Exception:
                log.exception(
                    "Deferred quest run failed for %s/%s #%s",
                    repo_path_str,
                    quest_type,
                    quest_number,
                )

        scheduled = self.scheduler.schedule(
            delay_seconds=delay_seconds,
            callback=_callback,
            description={
                "kind": "quest_run",
                "repo_path": repo_path_str,
                "project": project,
                "quest_type": quest_type,
                "quest_number": quest_number,
                "max_steps": max_steps,
                "reason": reason,
            },
        )
        return {
            "status": "deferred",
            "reason": reason,
            "delay_seconds": delay_seconds,
            "scheduled_for": scheduled["scheduled_for"],
            "deferred_task_id": scheduled["task_id"],
        }

    def create_quest(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        name: str,
        slug: str | None = None,
        requested_by: str | None = None,
    ) -> dict:
        root = _resolve_repo(repo_path)
        if not _is_git_repo(root):
            raise NotAGitRepo(repo_path)
        _validate_project(root, project)
        try:
            assert_source_checkout_clean(root)
        except SourceCheckoutDetached as e:
            raise InvalidQuestInput(str(e)) from e
        except SourceCheckoutNotClean as e:
            raise InvalidQuestInput(str(e)) from e
        if quest_type not in ("main", "side"):
            raise InvalidQuestInput(
                f"quest_type must be 'main' or 'side', got {quest_type!r}"
            )
        if not name.strip():
            raise InvalidQuestInput("name must be non-empty")

        raw_slug = name if slug is None else slug
        norm_slug = normalize_slug(raw_slug)
        if not norm_slug:
            raise InvalidQuestInput("slug is empty after normalization")

        number = _next_quest_number(root, project, quest_type)
        prefix = f"{number:04d}"
        quest_type_dir = quest_fs.project_quest_root(root, project) / quest_type
        quest_type_dir.mkdir(parents=True, exist_ok=True)
        quest_dir = quest_type_dir / f"{prefix}_{norm_slug}"

        default_cfg = (
            Path(__file__).resolve().parent / "default_state_execution_config.yaml"
        )
        if not default_cfg.is_file():
            raise MissingDefaultExecutionConfig(default_cfg)

        created: list[str] = []
        created_root = False
        meta: QuestMeta | None = None
        try:
            quest_dir.mkdir(parents=True, exist_ok=False)
            created_root = True

            now = utc_now_iso()
            quest_fs.write_quest_state(
                quest_dir,
                QuestStateInfo(
                    state=QuestState.PrePlanning,
                    current_slice=None,
                    updated_at=now,
                ),
            )
            created.append("state.md")

            history_path = quest_dir / "state_history.md"
            history_path.write_text("# State Transition History\n\n", encoding="utf-8")
            created.append("state_history.md")

            meta = QuestMeta(
                project=project,
                quest_type=quest_type,
                quest_number=number,
                quest_slug=norm_slug,
                quest_name=name.strip(),
                created_at=now,
                created_by=requested_by,
            )
            quest_fs.write_quest_meta(quest_dir, meta)
            created.append("meta.json")

            quest_fs.write_thread_registry(quest_dir, {})
            created.append("thread_registry.json")

            issues_path = quest_dir / "physicalplan_issues.md"
            issues_path.write_text("# Issues\n", encoding="utf-8")
            created.append("physicalplan_issues.md")

            dest_cfg = quest_dir / "state_execution_config.yaml"
            shutil.copy2(default_cfg, dest_cfg)
            created.append("state_execution_config.yaml")

            specs = quest_dir / "specs"
            specs.mkdir()
            (specs / ".gitkeep").write_text("", encoding="utf-8")
            created.append("specs")
            created.append("specs/.gitkeep")

            slices = quest_dir / "slices"
            slices.mkdir()
            (slices / ".gitkeep").write_text("", encoding="utf-8")
            created.append("slices")
            created.append("slices/.gitkeep")
        except Exception:
            if created_root and quest_dir.exists():
                shutil.rmtree(quest_dir, ignore_errors=True)
            raise

        assert meta is not None
        worktree_name = quest_worktree_name(
            project, quest_type, number, norm_slug
        )
        worktree_branch = quest_worktree_branch(worktree_name)
        worktree_path = quest_worktree_path(root, meta)
        quest_create_commit: str | None = None
        try:
            quest_create_commit = create_quest_scaffold_commit(
                root,
                quest_dir,
                project=project,
                quest_type=quest_type,
                quest_number=number,
                quest_slug=norm_slug,
            )
            create_quest_worktree(root, meta)
        except Exception as exc:
            if quest_create_commit is not None:
                remove_partial_worktree(root, meta)
                rel = quest_dir.resolve().relative_to(root.resolve()).as_posix()
                raise WorktreeCreationError(
                    "Quest record was committed on the source branch but worktree "
                    f"creation failed; manual cleanup may be required for "
                    f"{rel} (commit {quest_create_commit}).",
                    quest_dir=quest_dir,
                    quest_create_commit=quest_create_commit,
                ) from exc
            if created_root and quest_dir.exists():
                shutil.rmtree(quest_dir, ignore_errors=True)
            remove_partial_worktree(root, meta)
            raise

        return {
            "project": project,
            "quest_type": quest_type,
            "quest_number": number,
            "quest_slug": norm_slug,
            "quest_dir": str(quest_dir),
            "state": QuestState.PrePlanning.value,
            "created_files": created,
            "worktree_name": worktree_name,
            "worktree_branch": worktree_branch,
            "worktree_path": str(worktree_path),
            "quest_create_commit": quest_create_commit,
        }

    def _prepare_run(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
    ) -> tuple[Path, Path, str]:
        root = _resolve_repo(repo_path)
        if not _is_git_repo(root):
            raise NotAGitRepo(repo_path)
        if quest_type not in ("main", "side"):
            raise InvalidQuestInput(
                f"quest_type must be 'main' or 'side', got {quest_type!r}"
            )
        if quest_number < 0:
            raise InvalidQuestInput("quest_number must be non-negative")

        qdir = quest_fs.find_quest_dir(root, project, quest_type, quest_number)
        if qdir is None:
            raise QuestNotFound(project, quest_type, quest_number)

        key = str(root.resolve())
        return root, qdir, key

    def _run_quest_locked(
        self,
        root: Path,
        qdir: Path,
        project: str,
        quest_type: str,
        quest_number: int,
        max_steps: int,
    ) -> dict:
        from .quest_runner import (
            QuestHarnessError,
            _write_human_intervention,
            run_quest as runner_run_quest,
        )

        try:
            return runner_run_quest(
                repo_path=root,
                quest_dir=qdir,
                conductor_repo_path=self.conductor_repo_path,
                max_steps=max_steps,
            )
        except QuestHarnessError as exc:
            if exc.detail.strip() in {"billing_error", "rate_limit"}:
                result = self._schedule_deferred_quest_run(
                    repo_path=root,
                    project=project,
                    quest_type=quest_type,
                    quest_number=quest_number,
                    max_steps=max_steps,
                    reason=exc.detail.strip(),
                    delay_seconds=3600,
                )
                result["steps_executed"] = exc.steps_executed
                result["last_commit"] = exc.last_commit
                result["captured_outputs"] = exc.captured_outputs
                return result

            detail = (
                "Structured harness error while sending a message.\n\n"
                f"Error detail:\n\n```text\n{exc.detail}\n```\n\n"
                "Raw harness output:\n\n```text\n"
                f"{exc.raw_output.rstrip()}\n```"
            )
            _write_human_intervention(
                qdir,
                "harness returned error event",
                detail,
            )
            return {
                "status": "human_intervention",
                "steps_executed": exc.steps_executed,
                "last_commit": exc.last_commit,
                "captured_outputs": exc.captured_outputs,
            }

    def run_quest(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
        max_steps: int = 500,
    ) -> dict:
        root, qdir, key = self._prepare_run(
            repo_path, project, quest_type, quest_number
        )
        req_id = str(uuid.uuid4())
        if not self.lock.acquire(key, quest_type, quest_number, req_id):
            info = self.lock.get_lock_info(key)
            assert info is not None
            raise QuestLockContention(
                "Repository is locked by another quest run",
                repo_path=key,
                lock_info=info,
            )
        try:
            return self._run_quest_locked(
                root, qdir, project, quest_type, quest_number, max_steps
            )
        finally:
            self.lock.release(key)

    def schedule_run_quest(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
        max_steps: int = 500,
        *,
        public_base_url: str,
    ) -> dict:
        """Start the runner on a background thread and return immediately (HTTP)."""
        from . import dashboard_data

        root, qdir, key = self._prepare_run(
            repo_path, project, quest_type, quest_number
        )
        req_id = str(uuid.uuid4())
        if not self.lock.acquire(key, quest_type, quest_number, req_id):
            info = self.lock.get_lock_info(key)
            assert info is not None
            raise QuestLockContention(
                "Repository is locked by another quest run",
                repo_path=key,
                lock_info=info,
            )

        try:
            quest_fs.read_quest_state(qdir)
        except quest_fs.QuestStateParseError:
            self.lock.release(key)
            raise

        run_id = str(uuid.uuid4())
        base = public_base_url.rstrip("/")
        quest_url = dashboard_data.canonical_quest_dashboard_url(
            base_url=base,
            repo_path=key,
            quest_type=quest_type,
            quest_number=quest_number,
        )
        status_url = (
            f"{base}/api/dashboard/run_status"
            f"?repo_path={dashboard_data.quote_query_param(key)}"
            f"&quest_type={dashboard_data.quote_query_param(quest_type)}"
            f"&quest_number={quest_number}"
        )

        pause = dashboard_data.read_paused_until_state(qdir)
        initial_status = "paused" if pause.kind == "active" else "running"

        svc = self

        def worker() -> None:
            stop_hb = threading.Event()

            def heartbeat_loop() -> None:
                while not stop_hb.wait(1.0):
                    svc.run_tracker.heartbeat(run_id)

            svc.run_tracker.register(run_id, key, quest_type, quest_number)
            hb_thread = threading.Thread(target=heartbeat_loop, daemon=True)
            hb_thread.start()
            try:
                svc._run_quest_locked(
                    root, qdir, project, quest_type, quest_number, max_steps
                )
            except Exception:
                log.exception(
                    "Background quest run crashed for %s %s/%s",
                    key,
                    quest_type,
                    quest_number,
                )
            finally:
                stop_hb.set()
                hb_thread.join(timeout=0.5)
                svc.run_tracker.unregister(run_id)
                svc.lock.release(key)

        threading.Thread(target=worker, daemon=True).start()
        return {
            "run_id": run_id,
            "status": initial_status,
            "quest_url": quest_url,
            "status_url": status_url,
        }
