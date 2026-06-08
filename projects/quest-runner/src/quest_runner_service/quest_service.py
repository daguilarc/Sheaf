"""Quest-level operations (create, run, …)."""

from __future__ import annotations

import re
import shutil
import subprocess
import threading
import uuid
import logging
from pathlib import Path

from . import issue_service
from . import quest_fs
from .dashboard_runs import ActiveRunTracker
from .deferred_tasks import DeferredTaskScheduler
from .quest_lock import LockInfo, QuestLock
from .quest_types import (
    QuestMeta,
    QuestState,
    QuestStateInfo,
    SliceState,
    SliceStateInfo,
    utc_now_iso,
)
from .worktrees import (
    SourceCheckoutDetached,
    SourceCheckoutNotClean,
    WorktreeCreationError,
    assert_source_checkout_clean,
    branch_exists,
    checkout_branch,
    create_quest_scaffold_commit,
    create_quest_worktree,
    current_branch,
    delete_branch,
    is_git_worktree,
    is_worktree_clean,
    merge_ff_only,
    porcelain_status,
    quest_worktree_branch,
    quest_worktree_name,
    quest_worktree_path,
    rebase_onto,
    remove_partial_worktree,
    remove_worktree,
    rev_parse_head,
    validate_project_name,
    worktree_exists,
)


log = logging.getLogger("quest_runner")
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


class AdvanceQuestValidationError(Exception):
    """Manual quest advance blocked by unmet predicates."""

    def __init__(self, message: str, *, reason: str) -> None:
        self.message = message
        self.reason = reason
        super().__init__(message)


class AdvanceQuestConflict(Exception):
    """Manual quest advance blocked by runtime conflict."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class LandQuestConflict(Exception):
    """Quest land blocked by git state requiring operator action."""

    def __init__(self, body: dict) -> None:
        self.body = body
        super().__init__(body.get("error", "land conflict"))


class MissingQuestWorktree(Exception):
    """Expected quest worktree is missing or is not a git working tree."""

    def __init__(
        self,
        project: str,
        quest_type: str,
        quest_number: int,
        worktree_path: Path,
    ) -> None:
        self.project = project
        self.quest_type = quest_type
        self.quest_number = quest_number
        self.worktree_path = worktree_path
        super().__init__(
            f"Quest worktree missing or invalid for project={project!r} "
            f"type={quest_type!r} number={quest_number}: {worktree_path}"
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


class SliceInitializationConflict(Exception):
    """Slice initialization could not proceed because the target already exists."""

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


def _build_run_lock_key(
    worktree_path: Path,
    project: str,
    quest_type: str,
    quest_number: int,
) -> str:
    return (
        f"{worktree_path.resolve()}::"
        f"{project}/{quest_type}/{quest_number:04d}"
    )


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
    """Holds quest-related dependencies. One instance per service process."""

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
        source_root = _resolve_repo(repo_path)
        if not _is_git_repo(source_root):
            raise NotAGitRepo(repo_path)
        if quest_type not in ("main", "side"):
            raise InvalidQuestInput(
                f"quest_type must be 'main' or 'side', got {quest_type!r}"
            )
        if quest_number < 0:
            raise InvalidQuestInput("quest_number must be non-negative")
        _validate_project(source_root, project)

        source_qdir = quest_fs.find_quest_dir(
            source_root, project, quest_type, quest_number
        )
        if source_qdir is None:
            raise QuestNotFound(project, quest_type, quest_number)

        meta = quest_fs.read_quest_meta(source_qdir)
        worktree_path = quest_worktree_path(source_root, meta)
        if not worktree_exists(source_root, meta) or not is_git_worktree(worktree_path):
            raise MissingQuestWorktree(
                project, quest_type, quest_number, worktree_path
            )

        worktree_root = worktree_path.resolve()
        worktree_qdir = quest_fs.find_quest_dir(
            worktree_root, project, quest_type, quest_number
        )
        if worktree_qdir is None:
            raise MissingQuestWorktree(
                project, quest_type, quest_number, worktree_path
            )

        key = _build_run_lock_key(
            worktree_root, project, quest_type, quest_number
        )
        return worktree_root, worktree_qdir, key

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
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
        )
        status_url = (
            f"{base}/api/dashboard/run_status"
            f"?project={dashboard_data.quote_query_param(project)}"
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

    def advance_quest(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
    ) -> dict:
        from .quest_runner import _quest_key
        from .state_machine.v2_quest_state_io import V2QuestStateIo
        from .state_machine.v2_step_executor import (
            AdvanceValidationError,
            HumanInterventionConflict,
            advance_v2_top_level_step_without_harness,
        )
        from .state_machine.adapters import SubprocessGitOps
        from .quest_types import StateMachineId

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
            meta = quest_fs.read_quest_meta(qdir)
            quest_key = _quest_key(meta)
            rel = qdir.resolve().relative_to(root.resolve()).as_posix()
            sm_id = StateMachineId(
                root_machine_id=rel, machine_path=rel, machine_name="quest"
            )
            io_v2 = V2QuestStateIo(root, qdir, meta)
            git_ops = SubprocessGitOps()
            try:
                result = advance_v2_top_level_step_without_harness(
                    repo_path=root,
                    quest_dir=qdir,
                    quest_key=quest_key,
                    meta=meta,
                    state_io=io_v2,
                    git_ops=git_ops,
                    sm_id=sm_id,
                )
            except AdvanceValidationError as exc:
                raise AdvanceQuestValidationError(
                    exc.message, reason=exc.reason
                ) from exc
            except HumanInterventionConflict as exc:
                raise AdvanceQuestConflict(exc.message) from exc

            body: dict = {
                "project": project,
                "quest_type": quest_type,
                "quest_number": quest_number,
            }
            if result.kind == "completed":
                body["status"] = "completed"
                body["advanced"] = False
                return body

            body["status"] = "advanced"
            body["previous_state"] = result.previous_quest_state
            body["next_state"] = result.next_quest_state
            if result.previous_slice_state is not None:
                body["previous_slice_state"] = result.previous_slice_state
            if result.next_slice_state is not None:
                body["next_slice_state"] = result.next_slice_state
            if result.active_slice is not None:
                body["active_slice"] = result.active_slice
            if result.commit is not None:
                body["commit"] = result.commit
            body["message"] = result.message
            return body
        finally:
            self.lock.release(key)

    def _land_quest_body(
        self,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        target_branch: str,
        worktree_branch: str,
    ) -> dict:
        return {
            "project": project,
            "quest_type": quest_type,
            "quest_number": quest_number,
            "target_branch": target_branch,
            "worktree_branch": worktree_branch,
        }

    def _land_quest_locked(
        self,
        source_root: Path,
        meta: QuestMeta,
        worktree_path: Path,
        worktree_branch: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        target_branch: str,
    ) -> dict:
        base = self._land_quest_body(
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            target_branch=target_branch,
            worktree_branch=worktree_branch,
        )

        clean, dirty = porcelain_status(source_root)
        if not clean:
            raise LandQuestConflict({
                "status": "target_dirty",
                "error": (
                    "Source checkout has uncommitted changes; commit or discard "
                    "them before landing"
                ),
                **base,
                "status_output": dirty,
            })

        if not branch_exists(source_root, target_branch):
            raise InvalidQuestInput(
                f"Target branch {target_branch!r} does not exist"
            )

        try:
            on_branch = current_branch(source_root)
        except SourceCheckoutDetached as exc:
            raise InvalidQuestInput(str(exc)) from exc

        if on_branch != target_branch:
            checkout_branch(source_root, target_branch)
            clean, dirty = porcelain_status(source_root)
            if not clean:
                raise LandQuestConflict({
                    "status": "target_dirty",
                    "error": (
                        "Source checkout has uncommitted changes after checking out "
                        f"{target_branch!r}"
                    ),
                    **base,
                    "status_output": dirty,
                })

        if not is_worktree_clean(worktree_path):
            raise LandQuestConflict({
                "status": "worktree_dirty",
                "error": "Quest worktree has uncommitted changes",
                **base,
                "worktree_path": str(worktree_path),
                "next_step": (
                    "Clean the quest worktree, then run land again."
                ),
            })

        rebase_result = rebase_onto(worktree_path, target_branch)
        if rebase_result.returncode != 0 or not is_worktree_clean(worktree_path):
            detail = rebase_result.stderr.strip() or rebase_result.stdout.strip()
            error = "Rebase stopped with conflicts"
            if detail:
                error = f"{error}: {detail}"
            raise LandQuestConflict({
                "status": "rebase_failed",
                "error": error,
                **base,
                "worktree_path": str(worktree_path),
                "next_step": (
                    "Resolve conflicts in the quest worktree, leave it clean, "
                    "then run land again."
                ),
            })

        ff_result = merge_ff_only(source_root, worktree_branch)
        if ff_result.returncode != 0:
            detail = ff_result.stderr.strip() or ff_result.stdout.strip()
            raise LandQuestConflict({
                "status": "fast_forward_failed",
                "error": detail or "Fast-forward merge failed",
                **base,
                "worktree_path": str(worktree_path),
            })

        remove_result = remove_worktree(source_root, worktree_path)
        if remove_result.returncode != 0:
            detail = remove_result.stderr.strip() or remove_result.stdout.strip()
            raise LandQuestConflict({
                "status": "worktree_delete_failed",
                "error": detail or "Failed to remove quest worktree",
                **base,
                "worktree_path": str(worktree_path),
                "rebased": True,
                "fast_forwarded": True,
                "target_head": rev_parse_head(source_root),
            })

        delete_branch_result = delete_branch(source_root, worktree_branch)
        if delete_branch_result.returncode != 0:
            detail = (
                delete_branch_result.stderr.strip()
                or delete_branch_result.stdout.strip()
            )
            raise LandQuestConflict({
                "status": "branch_delete_failed",
                "error": detail or "Failed to delete quest branch",
                **base,
                "rebased": True,
                "fast_forwarded": True,
                "worktree_deleted": True,
                "branch_deleted": False,
                "target_head": rev_parse_head(source_root),
            })

        return {
            "status": "landed",
            **base,
            "rebased": True,
            "fast_forwarded": True,
            "worktree_deleted": True,
            "branch_deleted": True,
            "target_head": rev_parse_head(source_root),
        }

    def land_quest(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
        target_branch: str = "main",
    ) -> dict:
        source_root = _resolve_repo(repo_path)
        if not _is_git_repo(source_root):
            raise NotAGitRepo(repo_path)
        if quest_type not in ("main", "side"):
            raise InvalidQuestInput(
                f"quest_type must be 'main' or 'side', got {quest_type!r}"
            )
        if quest_number < 0:
            raise InvalidQuestInput("quest_number must be non-negative")
        if not target_branch.strip():
            raise InvalidQuestInput("target_branch must be non-empty")
        _validate_project(source_root, project)

        source_qdir = quest_fs.find_quest_dir(
            source_root, project, quest_type, quest_number
        )
        if source_qdir is None:
            raise QuestNotFound(project, quest_type, quest_number)

        meta = quest_fs.read_quest_meta(source_qdir)
        worktree_path = quest_worktree_path(source_root, meta)
        worktree_branch = quest_worktree_branch(
            quest_worktree_name(
                meta.project,
                meta.quest_type,
                meta.quest_number,
                meta.quest_slug,
            )
        )
        if not worktree_exists(source_root, meta) or not is_git_worktree(worktree_path):
            raise MissingQuestWorktree(
                project, quest_type, quest_number, worktree_path
            )

        worktree_root = worktree_path.resolve()
        key = _build_run_lock_key(
            worktree_root, project, quest_type, quest_number
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
            return self._land_quest_locked(
                source_root,
                meta,
                worktree_path,
                worktree_branch,
                project=project,
                quest_type=quest_type,
                quest_number=quest_number,
                target_branch=target_branch.strip(),
            )
        finally:
            self.lock.release(key)

    def initialize_slices(
        self,
        repo_path: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        count: object,
        slugs: object,
    ) -> dict:
        from . import dashboard_data

        source_root = _resolve_repo(repo_path)
        if not _is_git_repo(source_root):
            raise NotAGitRepo(repo_path)
        if quest_type not in ("main", "side"):
            raise InvalidQuestInput(
                f"quest_type must be 'main' or 'side', got {quest_type!r}"
            )
        if not isinstance(quest_number, int) or isinstance(quest_number, bool) or quest_number < 0:
            raise InvalidQuestInput("quest_number must be a non-negative integer")
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise InvalidQuestInput("count must be a positive integer")
        if not isinstance(slugs, list):
            raise InvalidQuestInput("slugs must be an array")
        if len(slugs) != count:
            raise InvalidQuestInput("count must match the number of slugs")

        normalized_slugs: list[str] = []
        seen: set[str] = set()
        for i, raw in enumerate(slugs, start=1):
            if not isinstance(raw, str) or not raw.strip():
                raise InvalidQuestInput(f"slug {i} must be a non-empty string")
            slug = normalize_slug(raw)
            if not slug:
                raise InvalidQuestInput(f"slug {i} is empty after normalization")
            if slug in seen:
                raise InvalidQuestInput(f"duplicate normalized slug: {slug}")
            seen.add(slug)
            normalized_slugs.append(slug)

        _validate_project(source_root, project)
        source_qdir = quest_fs.find_quest_dir(
            source_root, project, quest_type, quest_number
        )
        if source_qdir is None:
            raise QuestNotFound(project, quest_type, quest_number)
        meta = quest_fs.read_quest_meta(source_qdir)
        checkout = dashboard_data.resolve_dashboard_checkout(source_root, meta)
        qdir = checkout.quest_dir

        lock_acquired = False
        lock_key = dashboard_data.lock_key_for_quest(source_root, meta)
        if not checkout.worktree_missing:
            req_id = str(uuid.uuid4())
            if not self.lock.acquire(lock_key, quest_type, quest_number, req_id):
                info = self.lock.get_lock_info(lock_key)
                assert info is not None
                raise QuestLockContention(
                    "Repository is locked by another quest run",
                    repo_path=lock_key,
                    lock_info=info,
                )
            lock_acquired = True

        try:
            existing = quest_fs.list_slice_dirs(qdir)
            existing_numbers = [
                int(p.name[:4])
                for p in existing
                if len(p.name) >= 4 and p.name[:4].isdigit()
            ]
            next_number = (max(existing_numbers) + 1) if existing_numbers else 1
            slice_root = qdir / "slices"
            slice_root.mkdir(parents=True, exist_ok=True)

            targets: list[tuple[int, str, Path]] = []
            for offset, slug in enumerate(normalized_slugs):
                number = next_number + offset
                target = slice_root / f"{number:04d}_{slug}"
                if target.exists():
                    raise SliceInitializationConflict(
                        f"Slice directory already exists: {target.name}"
                    )
                targets.append((number, slug, target))

            created_dirs: list[Path] = []
            created_slices: list[dict] = []
            now = utc_now_iso()
            try:
                for number, slug, target in targets:
                    target.mkdir()
                    created_dirs.append(target)
                    plan_dir = target / "physicalplan"
                    plan_dir.mkdir()
                    quest_fs.write_slice_state(
                        target,
                        SliceStateInfo(
                            state=SliceState.NotStarted,
                            updated_at=now,
                        ),
                    )
                    (target / "state_history.md").write_text(
                        "# State Transition History\n\n",
                        encoding="utf-8",
                    )
                    (target / "polishing_issues.md").write_text(
                        "# Issues\n",
                        encoding="utf-8",
                    )
                    created_slices.append({
                        "slice_number": number,
                        "slice_slug": slug,
                        "directory_name": target.name,
                        "slice_dir": str(target),
                        "created_files": [
                            "physicalplan",
                            "state.md",
                            "state_history.md",
                            "polishing_issues.md",
                        ],
                    })
            except Exception:
                for created in reversed(created_dirs):
                    shutil.rmtree(created, ignore_errors=True)
                raise
        finally:
            if lock_acquired:
                self.lock.release(lock_key)

        return {
            "project": project,
            "quest_type": quest_type,
            "quest_number": quest_number,
            "quest_slug": meta.quest_slug,
            "quest_dir": str(qdir),
            "checkout_kind": checkout.checkout_kind,
            "checkout_path": str(checkout.checkout_root),
            "created_slices": created_slices,
        }

    def _acquire_issue_mutation_lock(
        self,
        ctx: issue_service.IssueContext,
        quest_type: str,
        quest_number: int,
    ) -> bool:
        if ctx.lock_key is None:
            return False
        req_id = str(uuid.uuid4())
        if not self.lock.acquire(ctx.lock_key, quest_type, quest_number, req_id):
            info = self.lock.get_lock_info(ctx.lock_key)
            assert info is not None
            raise QuestLockContention(
                "Repository is locked by another quest run",
                repo_path=ctx.lock_key,
                lock_info=info,
            )
        return True

    def _resolve_issue_context(
        self,
        repo_path: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        scope_raw: object,
        slice_raw: object | None,
    ) -> issue_service.IssueContext:
        source_root = Path(repo_path).resolve()
        _validate_project(source_root, project)
        scope = issue_service.parse_scope(scope_raw)
        slice_number = issue_service.parse_optional_slice(slice_raw)
        return issue_service.resolve_issue_context(
            source_root,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            scope=scope,
            slice_number=slice_number,
        )

    def list_issues(
        self,
        repo_path: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        scope_raw: object,
        slice_raw: object | None = None,
        status_filter: str = "all",
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            scope_raw=scope_raw,
            slice_raw=slice_raw,
        )
        issues = issue_service.list_issues(
            ctx, status_filter=issue_service.parse_status_filter(status_filter)
        )
        return {"issues": issues}

    def get_issue(
        self,
        repo_path: str,
        issue_id: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        scope_raw: object,
        slice_raw: object | None = None,
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            scope_raw=scope_raw,
            slice_raw=slice_raw,
        )
        return issue_service.get_issue(ctx, issue_id)

    def create_issue(
        self,
        repo_path: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        scope_raw: object,
        slice_raw: object | None = None,
        title: str,
        body: str,
        status: str = "open",
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            scope_raw=scope_raw,
            slice_raw=slice_raw,
        )
        acquired = self._acquire_issue_mutation_lock(ctx, quest_type, quest_number)
        try:
            return issue_service.create_issue(
                ctx, title=title, body=body, status=status
            )
        finally:
            if acquired:
                self.lock.release(ctx.lock_key)

    def edit_issue(
        self,
        repo_path: str,
        issue_id: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        scope_raw: object,
        slice_raw: object | None = None,
        status: str | None = None,
        title: str | None = None,
        body: str | None = None,
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            scope_raw=scope_raw,
            slice_raw=slice_raw,
        )
        acquired = self._acquire_issue_mutation_lock(ctx, quest_type, quest_number)
        try:
            return issue_service.edit_issue(
                ctx,
                issue_id,
                status=status,
                title=title,
                body=body,
            )
        finally:
            if acquired:
                self.lock.release(ctx.lock_key)

    def respond_to_issue(
        self,
        repo_path: str,
        issue_id: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        scope_raw: object,
        slice_raw: object | None = None,
        outcome: str,
        explanation: str,
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            scope_raw=scope_raw,
            slice_raw=slice_raw,
        )
        acquired = self._acquire_issue_mutation_lock(ctx, quest_type, quest_number)
        try:
            return issue_service.respond_to_issue(
                ctx,
                issue_id,
                outcome=outcome,
                explanation=explanation,
            )
        finally:
            if acquired:
                self.lock.release(ctx.lock_key)

    def list_issue_responses(
        self,
        repo_path: str,
        issue_id: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        scope_raw: object,
        slice_raw: object | None = None,
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            scope_raw=scope_raw,
            slice_raw=slice_raw,
        )
        responses = issue_service.list_responses(ctx, issue_id)
        return {"responses": responses}
