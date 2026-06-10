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
from .errors import FatalInvariantError
from .chat_event_bus import ChatEventBus
from .dashboard_data import DashboardBadRequest, DashboardCheckout, DashboardNotFound
from .dashboard_runs import ActiveRunTracker
from .deferred_tasks import DeferredTaskScheduler
from .quest_lock import LockInfo, QuestLock
from .quest_types import (
    QuestMeta,
    QuestState,
    QuestStateInfo,
    utc_now_iso,
)
from . import experiments as experiment_ops
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


class MissingDefaultWorkflow(QuestCreationError):
    """Bundled default ``workflow/`` directory is missing."""

    def __init__(self, path: Path) -> None:
        self.path = path
        super().__init__(f"Missing default workflow directory: {path}")


MissingDefaultExecutionConfig = MissingDefaultWorkflow


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


class ExperimentLandConflict(Exception):
    """Experiment land blocked by validation or git state."""

    def __init__(self, body: dict) -> None:
        self.body = body
        super().__init__(body.get("error", "experiment land conflict"))


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
            f"type={quest_type!r} number={quest_number}: {worktree_path}. "
            "If you are working on an experiment, pass "
            "--experiment-id <id> (or experiment_id in the API request)."
        )


class InvalidProject(QuestCreationError):
    """Project name is invalid or missing under projects/."""

    def __init__(self, project: str, reason: str) -> None:
        self.project = project
        self.reason = reason
        super().__init__(reason)


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


def _build_experiment_run_context(
    repo_path: str,
    project: str,
    quest_type: str,
    quest_number: int,
    exp_meta: experiment_ops.ExperimentMeta | None,
) -> experiment_ops.ExperimentRunContext | None:
    if exp_meta is None:
        return None
    source_root = _resolve_repo(repo_path)
    source_qdir = quest_fs.find_quest_dir(
        source_root, project, quest_type, quest_number
    )
    if source_qdir is None:
        return None
    return experiment_ops.build_experiment_run_context(
        source_root, source_qdir, exp_meta
    )


def _apply_experiment_source_completion(
    qdir: Path,
    experiment_run: experiment_ops.ExperimentRunContext,
    run_result: dict,
) -> dict:
    if run_result.get("status") != "experiment_complete":
        return run_result
    from .quest_runner import _write_human_intervention

    em = experiment_run.experiment_meta
    try:
        source_metadata_commit = experiment_ops.complete_experiment_source_metadata(
            experiment_run.source_repo_root,
            experiment_run.source_experiment_dir,
            project=em.project,
            quest_type=em.quest_type,
            quest_number=em.quest_number,
            experiment_number=em.experiment_number,
        )
    except experiment_ops.ExperimentSourceCheckoutDirty as exc:
        detail = (
            "Experiment reached its stop condition in the worktree, but updating "
            "source-checkout experiment metadata failed because the source checkout "
            "is dirty.\n\n"
            f"git status --porcelain:\n\n```text\n{exc.status_output}\n```"
        )
        _write_human_intervention(qdir, "experiment metadata update failed", detail)
        return {
            "status": "human_intervention",
            "reason": "experiment_metadata_update_failed",
            "steps_executed": run_result.get("steps_executed", 0),
            "last_commit": run_result.get("last_commit"),
            "captured_outputs": run_result.get("captured_outputs", []),
            "experiment_id": em.experiment_id,
        }
    run_result["source_metadata_commit"] = source_metadata_commit
    return run_result


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
    experiment_id: str | None = None,
) -> str:
    key = (
        f"{worktree_path.resolve()}::"
        f"{project}/{quest_type}/{quest_number:04d}"
    )
    if experiment_id is not None:
        key = f"{key}::{experiment_id}"
    return key


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
        self.chat_event_bus = ChatEventBus()
        self._metadata_mutation_lock = threading.Lock()

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
        experiment_id: str | None = None,
    ) -> dict:
        repo_path_str = str(repo_path)

        def _callback() -> None:
            try:
                run_kwargs: dict = {
                    "repo_path": repo_path_str,
                    "project": project,
                    "quest_type": quest_type,
                    "quest_number": quest_number,
                    "max_steps": max_steps,
                }
                if experiment_id is not None:
                    run_kwargs["experiment_id"] = experiment_id
                self.run_quest(**run_kwargs)
            except Exception:
                log.exception(
                    "Deferred quest run failed for %s/%s #%s",
                    repo_path_str,
                    quest_type,
                    quest_number,
                )

        description: dict = {
            "kind": "quest_run",
            "repo_path": repo_path_str,
            "project": project,
            "quest_type": quest_type,
            "quest_number": quest_number,
            "max_steps": max_steps,
            "reason": reason,
        }
        if experiment_id is not None:
            description["experiment_id"] = experiment_id

        scheduled = self.scheduler.schedule(
            delay_seconds=delay_seconds,
            callback=_callback,
            description=description,
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

        from .workflow_scaffold import (
            MissingDefaultWorkflow,
            build_quest_scaffold_context,
            copy_packaged_default_workflow,
            execute_scaffold_actions,
            load_quest_workflow,
        )
        from .workflow_config import packaged_default_workflow_dir

        default_workflow = packaged_default_workflow_dir()
        if not default_workflow.is_dir():
            raise MissingDefaultWorkflow(default_workflow)

        created: list[str] = []
        created_root = False
        meta: QuestMeta | None = None
        try:
            quest_dir.mkdir(parents=True, exist_ok=False)
            created_root = True

            now = utc_now_iso()
            meta = QuestMeta(
                project=project,
                quest_type=quest_type,
                quest_number=number,
                quest_slug=norm_slug,
                quest_name=name.strip(),
                created_at=now,
                created_by=requested_by,
            )

            workflow_dir = quest_dir / "workflow"
            created.extend(copy_packaged_default_workflow(workflow_dir))
            workflow = load_quest_workflow(quest_dir)

            quest_fs.write_quest_normalized_machine_state(
                quest_dir,
                QuestStateInfo(
                    state=QuestState.PrePlanning,
                    current_slice=None,
                    updated_at=now,
                    global_step=0,
                ),
                meta,
                root,
            )
            created.append("state.md")

            history_path = quest_dir / "state_history.md"
            history_path.write_text("# State Transition History\n\n", encoding="utf-8")
            created.append("state_history.md")

            quest_fs.write_quest_meta(quest_dir, meta)
            created.append("meta.json")

            quest_fs.write_thread_registry(quest_dir, {})
            created.append("thread_registry.json")

            scaffold_ctx = build_quest_scaffold_context(
                repo_path=root,
                quest_dir=quest_dir,
                meta=meta,
                workflow=workflow,
            )
            created.extend(execute_scaffold_actions(workflow.scaffold, scaffold_ctx))

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

    def create_experiment(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
        start_step: int,
        stop_node: str,
        notes: str,
        workflow_path: str,
        *,
        stop_machine_path: str | None = None,
        requested_by: str | None = None,
        public_base_url: str | None = None,
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
        if quest_number < 0:
            raise InvalidQuestInput("quest_number must be non-negative")
        if not notes.strip():
            raise InvalidQuestInput("notes must be non-empty")
        if not workflow_path.strip():
            raise InvalidQuestInput("workflow_path must be non-empty")

        source_qdir = quest_fs.find_quest_dir(root, project, quest_type, quest_number)
        if source_qdir is None:
            raise QuestNotFound(project, quest_type, quest_number)

        quest_meta = quest_fs.read_quest_meta(source_qdir)

        resolved_workflow_path = Path(workflow_path).expanduser()
        if not resolved_workflow_path.is_absolute():
            resolved_workflow_path = (root / resolved_workflow_path).resolve()
        else:
            resolved_workflow_path = resolved_workflow_path.resolve()

        try:
            workflow = experiment_ops.validate_workflow_directory(
                resolved_workflow_path
            )
        except experiment_ops.ExperimentValidationError as e:
            raise InvalidQuestInput(e.message) from e

        try:
            stop_condition = experiment_ops.validate_stop_condition(
                stop_machine_path, stop_node, workflow
            )
        except experiment_ops.ExperimentValidationError as e:
            raise InvalidQuestInput(e.message) from e

        try:
            resolved_start = experiment_ops.resolve_start_step(
                root, source_qdir, start_step
            )
        except experiment_ops.ExperimentValidationError as e:
            raise InvalidQuestInput(e.message) from e

        experiment_number = experiment_ops.next_experiment_number(source_qdir)
        exp_id = experiment_ops.experiment_id(
            project, quest_type, quest_number, experiment_number
        )
        branch_name = experiment_ops.experiment_branch_name(
            project, quest_type, quest_number, experiment_number
        )
        exp_dir = (
            experiment_ops.experiments_root(source_qdir)
            / experiment_ops.experiment_dir_name(experiment_number)
        )
        worktree_path = experiment_ops.experiment_worktree_path(root, exp_id)

        exp_meta = experiment_ops.ExperimentMeta(
            experiment_id=exp_id,
            experiment_number=experiment_number,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            quest_slug=quest_meta.quest_slug,
            description=notes.strip(),
            start_step=resolved_start,
            stop_condition=stop_condition,
            worktree_name=exp_id,
            branch_name=branch_name,
            status="open",
            created_at=utc_now_iso(),
            created_by=requested_by,
        )

        metadata_commit: str | None = None
        try:
            exp_dir.mkdir(parents=True, exist_ok=False)
            experiment_ops.write_experiment_meta(exp_dir, exp_meta)
            notes_path = exp_dir / "notes.md"
            notes_path.write_text(
                experiment_ops.format_experiment_notes(
                    description=notes,
                    start_step=resolved_start,
                    stop_condition=stop_condition,
                ),
                encoding="utf-8",
            )
            experiment_ops.install_experiment_workflow(
                exp_dir,
                resolved_workflow_path,
            )

            metadata_commit = experiment_ops.commit_experiment_metadata(
                root,
                exp_dir,
                project,
                quest_type,
                quest_number,
                experiment_number,
            )
            experiment_ops.create_experiment_branch_and_worktree(
                root,
                branch_name,
                worktree_path,
                resolved_start.base_commit,
            )
        except Exception as exc:
            if metadata_commit is None:
                experiment_ops.remove_partial_experiment_worktree(
                    root, branch_name, worktree_path
                )
                if exp_dir.exists():
                    shutil.rmtree(exp_dir, ignore_errors=True)
                raise
            raise experiment_ops.ExperimentWorktreeCreationError(
                "Experiment metadata was committed on the source branch but "
                f"worktree creation failed; manual cleanup may be required for "
                f"{exp_dir.relative_to(root).as_posix()} "
                f"(commit {metadata_commit}, branch {branch_name!r}, "
                f"worktree {worktree_path}).",
                metadata_commit=metadata_commit,
                branch_name=branch_name,
                worktree_path=worktree_path,
                experiment_dir=exp_dir,
            ) from exc

        exp_quest_dir = quest_fs.find_quest_dir(
            worktree_path, project, quest_type, quest_number
        )
        if exp_quest_dir is None:
            raise experiment_ops.ExperimentWorktreeCreationError(
                "Experiment worktree was created but quest directory was not found",
                metadata_commit=metadata_commit,
                branch_name=branch_name,
                worktree_path=worktree_path,
                experiment_dir=exp_dir,
            )
        experiment_ops.install_experiment_workflow(
            exp_quest_dir,
            exp_dir / "workflow",
        )

        dashboard_url: str | None = None
        if public_base_url is not None:
            from . import dashboard_data

            dashboard_url = dashboard_data.canonical_quest_dashboard_url(
                base_url=public_base_url.rstrip("/"),
                project=project,
                quest_type=quest_type,
                quest_number=quest_number,
            )

        return {
            "experiment_id": exp_id,
            "experiment_number": experiment_number,
            "project": project,
            "quest_type": quest_type,
            "quest_number": quest_number,
            "worktree_path": str(worktree_path.resolve()),
            "branch_name": branch_name,
            "base_commit": resolved_start.base_commit,
            "start_step": {
                "global_step": resolved_start.global_step,
                "role": resolved_start.role,
                "step_log": resolved_start.step_log,
                "step_commit": resolved_start.step_commit,
                "base_commit": resolved_start.base_commit,
            },
            "stop_condition": {
                "machine_path": stop_condition.machine_path,
                "node_name": stop_condition.node_name,
            },
            "metadata_commit": metadata_commit,
            "dashboard_url": dashboard_url,
        }

    def _resolve_mutable_quest_scope(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
        *,
        experiment_id: str | None = None,
        require_open_experiment: bool = False,
    ) -> tuple[Path, Path, DashboardCheckout, experiment_ops.ExperimentMeta | None]:
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
        try:
            checkout = experiment_ops.resolve_quest_scope_checkout(
                source_root,
                meta,
                experiment_id=experiment_id,
                require_open_experiment=require_open_experiment,
            )
        except DashboardNotFound as exc:
            if experiment_id is None:
                worktree_path = quest_worktree_path(source_root, meta)
                raise MissingQuestWorktree(
                    project, quest_type, quest_number, worktree_path
                ) from exc
            raise MissingQuestWorktree(
                project,
                quest_type,
                quest_number,
                experiment_ops.experiment_worktree_path(source_root, experiment_id),
            ) from exc
        except DashboardBadRequest as exc:
            raise InvalidQuestInput(exc.message) from exc

        exp_meta: experiment_ops.ExperimentMeta | None = None
        if experiment_id is not None:
            exp_meta = experiment_ops.find_experiment_by_id(
                source_root,
                project,
                quest_type,
                quest_number,
                experiment_id,
            )

        return (
            checkout.checkout_root,
            checkout.quest_dir,
            checkout,
            exp_meta,
        )

    def _prepare_run(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
        experiment_id: str | None = None,
    ) -> tuple[Path, Path, str, experiment_ops.ExperimentMeta | None]:
        worktree_root, worktree_qdir, checkout, exp_meta = (
            self._resolve_mutable_quest_scope(
                repo_path,
                project,
                quest_type,
                quest_number,
                experiment_id=experiment_id,
                require_open_experiment=experiment_id is not None,
            )
        )

        if checkout.worktree_missing:
            source_root = _resolve_repo(repo_path)
            if experiment_id is None:
                source_qdir = quest_fs.find_quest_dir(
                    source_root, project, quest_type, quest_number
                )
                assert source_qdir is not None
                meta = quest_fs.read_quest_meta(source_qdir)
                expected = quest_worktree_path(source_root, meta)
            else:
                expected = experiment_ops.experiment_worktree_path(
                    source_root, experiment_id
                )
            raise MissingQuestWorktree(
                project, quest_type, quest_number, expected
            )

        key = _build_run_lock_key(
            worktree_root,
            project,
            quest_type,
            quest_number,
            experiment_id,
        )
        self._ensure_quest_workflow_upgraded(worktree_root, worktree_qdir)
        return worktree_root, worktree_qdir, key, exp_meta

    def _ensure_quest_workflow_upgraded(self, repo_root: Path, quest_dir: Path) -> None:
        from .workflow_upgrade import upgrade_quest_if_needed

        upgrade_quest_if_needed(repo_root, quest_dir)

    def upgrade_quest(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
        experiment_id: str | None = None,
    ) -> dict:
        from .workflow_upgrade import QuestNotUpgradeable, upgrade_quest_workflow

        checkout_root, qdir, checkout, _exp_meta = (
            self._resolve_mutable_quest_scope(
                repo_path,
                project,
                quest_type,
                quest_number,
                experiment_id=experiment_id,
                require_open_experiment=experiment_id is not None,
            )
        )
        if checkout.worktree_missing:
            source_root = _resolve_repo(repo_path)
            if experiment_id is None:
                source_qdir = quest_fs.find_quest_dir(
                    source_root, project, quest_type, quest_number
                )
                assert source_qdir is not None
                meta = quest_fs.read_quest_meta(source_qdir)
                expected = quest_worktree_path(source_root, meta)
            else:
                expected = experiment_ops.experiment_worktree_path(
                    source_root, experiment_id
                )
            raise MissingQuestWorktree(
                project, quest_type, quest_number, expected
            )
        try:
            result = upgrade_quest_workflow(checkout_root, qdir)
        except QuestNotUpgradeable as exc:
            raise InvalidQuestInput(exc.reason) from exc
        result["project"] = project
        result["quest_type"] = quest_type
        result["quest_number"] = quest_number
        result["quest_dir"] = str(qdir)
        result["checkout_kind"] = checkout.checkout_kind
        result["checkout_path"] = str(checkout.checkout_root)
        if checkout.experiment_id is not None:
            result["experiment_id"] = checkout.experiment_id
        return result

    def _run_quest_locked(
        self,
        root: Path,
        qdir: Path,
        project: str,
        quest_type: str,
        quest_number: int,
        max_steps: int,
        experiment_id: str | None = None,
        experiment_run: experiment_ops.ExperimentRunContext | None = None,
    ) -> dict:
        from .quest_runner import (
            QuestHarnessError,
            _write_human_intervention,
            run_quest as runner_run_quest,
        )

        try:
            result = runner_run_quest(
                repo_path=root,
                quest_dir=qdir,
                conductor_repo_path=self.conductor_repo_path,
                max_steps=max_steps,
                event_bus=self.chat_event_bus,
                experiment_id=experiment_id,
                experiment_run=experiment_run,
            )
            if experiment_run is not None:
                return _apply_experiment_source_completion(
                    qdir, experiment_run, result
                )
            return result
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
                    experiment_id=experiment_id,
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
        experiment_id: str | None = None,
    ) -> dict:
        root, qdir, key, exp_meta = self._prepare_run(
            repo_path,
            project,
            quest_type,
            quest_number,
            experiment_id=experiment_id,
        )
        experiment_run = _build_experiment_run_context(
            repo_path, project, quest_type, quest_number, exp_meta
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
                root,
                qdir,
                project,
                quest_type,
                quest_number,
                max_steps,
                experiment_id=experiment_id,
                experiment_run=experiment_run,
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
        experiment_id: str | None = None,
    ) -> dict:
        """Start the runner on a background thread and return immediately (HTTP)."""
        from . import dashboard_data

        root, qdir, key, exp_meta = self._prepare_run(
            repo_path,
            project,
            quest_type,
            quest_number,
            experiment_id=experiment_id,
        )
        experiment_run = _build_experiment_run_context(
            repo_path, project, quest_type, quest_number, exp_meta
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
        if experiment_id is not None:
            status_url = (
                f"{status_url}"
                f"&experiment_id={dashboard_data.quote_query_param(experiment_id)}"
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
                    root,
                    qdir,
                    project,
                    quest_type,
                    quest_number,
                    max_steps,
                    experiment_id=experiment_id,
                    experiment_run=experiment_run,
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
        experiment_id: str | None = None,
    ) -> dict:
        from .quest_runner import _quest_key
        from .errors import AdvanceValidationError
        from .state_machine.v2_step_executor import (
            HumanInterventionConflict,
            advance_v2_top_level_step_without_harness,
        )
        from .state_machine.adapters import SubprocessGitOps
        from .workflow_scaffold import load_quest_workflow

        root, qdir, key, exp_meta = self._prepare_run(
            repo_path,
            project,
            quest_type,
            quest_number,
            experiment_id=experiment_id,
        )
        experiment_run = _build_experiment_run_context(
            repo_path, project, quest_type, quest_number, exp_meta
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
            git_ops = SubprocessGitOps()
            try:
                result = advance_v2_top_level_step_without_harness(
                    repo_path=root,
                    quest_dir=qdir,
                    quest_key=quest_key,
                    meta=meta,
                    git_ops=git_ops,
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
            if experiment_id is not None:
                body["experiment_id"] = experiment_id
            if result.kind == "completed":
                if (
                    experiment_run is not None
                    and result.next_quest_state == QuestState.ExperimentComplete.value
                ):
                    body["status"] = "experiment_complete"
                    body["advanced"] = False
                    body["quest_state"] = QuestState.ExperimentComplete.value
                    return _apply_experiment_source_completion(
                        qdir,
                        experiment_run,
                        body,
                    )
                body["status"] = "completed"
                body["advanced"] = False
                return body

            if experiment_run is not None and result.snapshot is not None:
                workflow = load_quest_workflow(qdir)
                if experiment_ops.snapshot_matches_stop_condition(
                    result.snapshot,
                    experiment_run.experiment_meta.stop_condition,
                    workflow,
                ):
                    changed = experiment_ops.mark_quest_experiment_complete(
                        qdir, meta, root
                    )
                    commit_sha = result.commit
                    if changed:
                        extra = experiment_ops.commit_experiment_complete_state(
                            root,
                            qdir,
                            experiment_run.experiment_meta.experiment_id,
                        )
                        if extra is not None:
                            commit_sha = extra
                    body["status"] = "experiment_complete"
                    body["advanced"] = True
                    body["quest_state"] = QuestState.ExperimentComplete.value
                    body["previous_state"] = result.previous_quest_state
                    body["next_state"] = QuestState.ExperimentComplete.value
                    if result.previous_slice_state is not None:
                        body["previous_slice_state"] = result.previous_slice_state
                    if result.next_slice_state is not None:
                        body["next_slice_state"] = result.next_slice_state
                    if result.active_slice is not None:
                        body["active_slice"] = result.active_slice
                    if commit_sha is not None:
                        body["commit"] = commit_sha
                    body["message"] = (
                        f"Experiment {experiment_run.experiment_meta.experiment_id} "
                        "reached its stop condition"
                    )
                    return _apply_experiment_source_completion(
                        qdir, experiment_run, body
                    )

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

    def _land_experiment_body(
        self,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        experiment_id_value: str,
    ) -> dict:
        return {
            "project": project,
            "quest_type": quest_type,
            "quest_number": quest_number,
            "experiment_id": experiment_id_value,
        }

    def _raise_source_checkout_dirty_for_land(
        self,
        source_root: Path,
        *,
        base: dict,
    ) -> None:
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

        self._raise_source_checkout_dirty_for_land(source_root, base=base)

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

    def _restore_source_experiment_dir_for_retry(
        self,
        source_root: Path,
        source_experiment_dir: Path,
    ) -> None:
        rel = source_experiment_dir.resolve().relative_to(
            source_root.resolve()
        ).as_posix()
        experiment_ops.run_git(source_root, "reset", "--quiet", "--", rel)
        for archive_dir in ("logs", "issues", "issue_responses"):
            shutil.rmtree(source_experiment_dir / archive_dir, ignore_errors=True)
        experiment_ops.run_git(source_root, "checkout", "--", rel)
        experiment_ops.run_git(
            source_root,
            "clean",
            "-fd",
            "--",
            f"{rel}/logs",
            f"{rel}/issues",
            f"{rel}/issue_responses",
        )

    def _land_experiment_locked(
        self,
        source_root: Path,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        experiment_id_value: str,
        exp_meta: experiment_ops.ExperimentMeta,
        source_experiment_dir: Path,
        worktree_path: Path,
        remote: str = "origin",
        public_base_url: str | None = None,
    ) -> dict:
        base = self._land_experiment_body(
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            experiment_id_value=experiment_id_value,
        )

        self._raise_source_checkout_dirty_for_land(source_root, base=base)

        exp_quest_dir = quest_fs.find_quest_dir(
            worktree_path,
            project,
            quest_type,
            quest_number,
        )
        if exp_quest_dir is None:
            raise ExperimentLandConflict({
                "status": "quest_dir_missing",
                "error": (
                    f"Quest directory not found in experiment worktree: "
                    f"{worktree_path}"
                ),
                **base,
            })

        quest_state = quest_fs.read_quest_state(exp_quest_dir)
        if quest_state.state != QuestState.ExperimentComplete:
            raise ExperimentLandConflict({
                "status": "not_complete",
                "error": (
                    f"Experiment worktree quest state is {quest_state.state.value!r}, "
                    f"expected {QuestState.ExperimentComplete.value!r}"
                ),
                **base,
                "quest_state": quest_state.state.value,
            })

        if exp_meta.status != "experiment_complete":
            raise ExperimentLandConflict({
                "status": "not_complete",
                "error": (
                    f"Experiment metadata status is {exp_meta.status!r}, "
                    "expected 'experiment_complete'"
                ),
                **base,
                "experiment_status": exp_meta.status,
            })

        try:
            copy_summary = experiment_ops.archive_experiment_artifacts(
                source_experiment_dir,
                exp_quest_dir,
            )
        except OSError as exc:
            self._restore_source_experiment_dir_for_retry(
                source_root,
                source_experiment_dir,
            )
            raise ExperimentLandConflict({
                "status": "artifact_copy_failed",
                "error": f"Failed to copy experiment artifacts: {exc}",
                **base,
            }) from exc

        try:
            experiment_ops.push_experiment_branch(
                source_root,
                exp_meta.branch_name,
                remote=remote,
            )
        except experiment_ops.ExperimentLandError as exc:
            self._restore_source_experiment_dir_for_retry(
                source_root,
                source_experiment_dir,
            )
            raise ExperimentLandConflict({
                "status": "push_failed",
                "error": exc.message,
                **base,
                "worktree_deleted": False,
                "branch_deleted": False,
            }) from exc

        remove_result = remove_worktree(source_root, worktree_path)
        worktree_deleted = remove_result.returncode == 0
        if not worktree_deleted:
            run_git_result = experiment_ops.run_git(
                source_root,
                "worktree",
                "remove",
                "--force",
                str(worktree_path),
                check=False,
            )
            worktree_deleted = run_git_result.returncode == 0
        if not worktree_deleted:
            detail = remove_result.stderr.strip() or remove_result.stdout.strip()
            raise ExperimentLandConflict({
                "status": "worktree_delete_failed",
                "error": detail or "Failed to remove experiment worktree",
                **base,
                "pushed": True,
                "worktree_deleted": False,
                "branch_deleted": False,
            })

        branch_deleted = False
        try:
            experiment_ops.delete_local_experiment_branch(
                source_root,
                exp_meta.branch_name,
            )
            branch_deleted = True
        except experiment_ops.ExperimentLandError as exc:
            raise ExperimentLandConflict({
                "status": "branch_delete_failed",
                "error": exc.message,
                **base,
                "pushed": True,
                "worktree_deleted": True,
                "branch_deleted": False,
            }) from exc

        landed_at = utc_now_iso()
        experiment_ops.update_experiment_status(
            source_experiment_dir,
            "landed",
            landed_at=landed_at,
            remote_branch=exp_meta.branch_name,
        )

        experiment_ops.commit_experiment_land(
            source_root,
            source_experiment_dir,
            project,
            quest_type,
            quest_number,
            exp_meta.experiment_number,
        )

        dashboard_url: str | None = None
        if public_base_url is not None:
            from . import dashboard_data

            dashboard_url = dashboard_data.canonical_quest_dashboard_url(
                base_url=public_base_url.rstrip("/"),
                project=project,
                quest_type=quest_type,
                quest_number=quest_number,
            )

        return {
            "status": "landed",
            **base,
            "experiment_number": exp_meta.experiment_number,
            "logs_copied": copy_summary.logs_copied,
            "issues_copied": copy_summary.issues_copied,
            "issue_responses_copied": copy_summary.issue_responses_copied,
            "skipped_missing": copy_summary.skipped_missing,
            "remote_branch": exp_meta.branch_name,
            "worktree_deleted": worktree_deleted,
            "branch_deleted": branch_deleted,
            "landed_at": landed_at,
            "dashboard_url": dashboard_url,
        }

    def land_experiment(
        self,
        repo_path: str,
        project: str,
        quest_type: str,
        quest_number: int,
        experiment_id_value: str,
        *,
        remote: str = "origin",
        public_base_url: str | None = None,
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
        if not experiment_id_value.strip():
            raise InvalidQuestInput("experiment_id must be non-empty")
        _validate_project(source_root, project)

        source_qdir = quest_fs.find_quest_dir(
            source_root, project, quest_type, quest_number
        )
        if source_qdir is None:
            raise QuestNotFound(project, quest_type, quest_number)

        try:
            exp_meta = experiment_ops.find_experiment_by_id(
                source_root,
                project,
                quest_type,
                quest_number,
                experiment_id_value,
            )
        except experiment_ops.ExperimentNotFound as exc:
            raise InvalidQuestInput(exc.message) from exc

        try:
            experiment_ops.validate_experiment_belongs_to_quest(
                exp_meta,
                project,
                quest_type,
                quest_number,
            )
        except experiment_ops.ExperimentValidationError as exc:
            raise InvalidQuestInput(exc.message) from exc

        worktree_path = experiment_ops.experiment_worktree_path(
            source_root, exp_meta
        )
        if not worktree_path.is_dir() or not is_git_worktree(worktree_path):
            raise ExperimentLandConflict({
                "status": "worktree_missing",
                "error": (
                    f"Experiment worktree is missing or invalid: {worktree_path}"
                ),
                **self._land_experiment_body(
                    project=project,
                    quest_type=quest_type,
                    quest_number=quest_number,
                    experiment_id_value=experiment_id_value,
                ),
                "worktree_path": str(worktree_path),
            })

        source_experiment_dir = (
            experiment_ops.experiments_root(source_qdir)
            / experiment_ops.experiment_dir_name(exp_meta.experiment_number)
        )

        worktree_root = worktree_path.resolve()
        key = _build_run_lock_key(
            worktree_root,
            project,
            quest_type,
            quest_number,
            experiment_id_value,
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
            return self._land_experiment_locked(
                source_root,
                project=project,
                quest_type=quest_type,
                quest_number=quest_number,
                experiment_id_value=experiment_id_value,
                exp_meta=exp_meta,
                source_experiment_dir=source_experiment_dir,
                worktree_path=worktree_path,
                remote=remote,
                public_base_url=public_base_url,
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
        experiment_id: str | None = None,
        collection: str | None = None,
    ) -> dict:
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
        _checkout_root, qdir, checkout, _exp_meta = (
            self._resolve_mutable_quest_scope(
                repo_path,
                project,
                quest_type,
                quest_number,
                experiment_id=experiment_id,
                require_open_experiment=experiment_id is not None,
            )
        )
        if checkout.worktree_missing:
            if experiment_id is None:
                source_qdir = quest_fs.find_quest_dir(
                    source_root, project, quest_type, quest_number
                )
                assert source_qdir is not None
                meta = quest_fs.read_quest_meta(source_qdir)
                expected = quest_worktree_path(source_root, meta)
            else:
                expected = experiment_ops.experiment_worktree_path(
                    source_root, experiment_id
                )
            raise MissingQuestWorktree(
                project, quest_type, quest_number, expected
            )

        self._ensure_quest_workflow_upgraded(checkout.checkout_root, qdir)
        meta = quest_fs.read_quest_meta(qdir)

        from .workflow_profile_execution import resolve_quest_workflow
        from .workflow_scaffold import (
            build_child_scaffold_context,
            collection_parent_dir,
            execute_scaffold_actions,
            resolve_workflow_collection,
        )

        workflow = resolve_quest_workflow(qdir)
        try:
            selected_collection = resolve_workflow_collection(workflow, collection)
        except ValueError as exc:
            raise InvalidQuestInput(str(exc)) from exc

        mutation_lock_acquired = False
        if not checkout.worktree_missing:
            self._metadata_mutation_lock.acquire()
            mutation_lock_acquired = True

        try:
            slice_root = collection_parent_dir(selected_collection, qdir)
            slice_root.mkdir(parents=True, exist_ok=True)
            existing = [
                p
                for p in slice_root.iterdir()
                if p.is_dir()
                and len(p.name) >= 4
                and p.name[:4].isdigit()
            ]
            existing_numbers = [
                int(p.name[:4])
                for p in existing
                if p.name[:4].isdigit()
            ]
            next_number = (max(existing_numbers) + 1) if existing_numbers else 1

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
            try:
                for number, slug, target in targets:
                    target.mkdir()
                    created_dirs.append(target)
                    child_ctx = build_child_scaffold_context(
                        repo_path=checkout.checkout_root,
                        quest_dir=qdir,
                        child_dir=target,
                        meta=meta,
                        workflow=workflow,
                        collection=selected_collection,
                    )
                    created_files = execute_scaffold_actions(
                        selected_collection.scaffold,
                        child_ctx,
                    )
                    created_slices.append({
                        "slice_number": number,
                        "slice_slug": slug,
                        "directory_name": target.name,
                        "slice_dir": str(target),
                        "created_files": created_files,
                    })
            except Exception:
                for created in reversed(created_dirs):
                    shutil.rmtree(created, ignore_errors=True)
                raise
        finally:
            if mutation_lock_acquired:
                self._metadata_mutation_lock.release()

        result: dict = {
            "project": project,
            "quest_type": quest_type,
            "quest_number": quest_number,
            "quest_slug": meta.quest_slug,
            "quest_dir": str(qdir),
            "checkout_kind": checkout.checkout_kind,
            "checkout_path": str(checkout.checkout_root),
            "collection": selected_collection.name,
            "created_slices": created_slices,
        }
        if checkout.experiment_id is not None:
            result["experiment_id"] = checkout.experiment_id
        return result

    def _acquire_issue_mutation_lock(
        self,
        ctx: issue_service.IssueContext,
        quest_type: str,
        quest_number: int,
    ) -> bool:
        _ = quest_type, quest_number
        if ctx.lock_key is None:
            return False
        self._metadata_mutation_lock.acquire()
        return True

    def _resolve_issue_context(
        self,
        repo_path: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        issue_file_raw: object,
        owner_role_raw: object | None = None,
        experiment_id: str | None = None,
    ) -> issue_service.IssueContext:
        source_root = Path(repo_path).resolve()
        _validate_project(source_root, project)
        owner_role = issue_service.parse_optional_owner_role(owner_role_raw)
        return issue_service.resolve_issue_context_by_file(
            source_root,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            issue_file=str(issue_file_raw),
            experiment_id=experiment_id,
            owner_role_override=owner_role,
        )

    def list_issues(
        self,
        repo_path: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        issue_file_raw: object,
        status_filter: str = "all",
        experiment_id: str | None = None,
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            issue_file_raw=issue_file_raw,
            experiment_id=experiment_id,
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
        issue_file_raw: object,
        experiment_id: str | None = None,
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            issue_file_raw=issue_file_raw,
            experiment_id=experiment_id,
        )
        return issue_service.get_issue(ctx, issue_id)

    def create_issue(
        self,
        repo_path: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        issue_file_raw: object,
        title: str,
        body: str,
        status: str = "open",
        owner_role_raw: object | None = None,
        experiment_id: str | None = None,
    ) -> dict:
        owner_role = issue_service.parse_optional_owner_role(owner_role_raw)
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            issue_file_raw=issue_file_raw,
            owner_role_raw=owner_role,
            experiment_id=experiment_id,
        )
        acquired = self._acquire_issue_mutation_lock(ctx, quest_type, quest_number)
        try:
            return issue_service.create_issue(
                ctx,
                title=title,
                body=body,
                status=status,
                owner_role=owner_role,
            )
        finally:
            if acquired:
                self._metadata_mutation_lock.release()

    def edit_issue(
        self,
        repo_path: str,
        issue_id: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        issue_file_raw: object,
        status: str | None = None,
        title: str | None = None,
        body: str | None = None,
        experiment_id: str | None = None,
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            issue_file_raw=issue_file_raw,
            experiment_id=experiment_id,
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
                self._metadata_mutation_lock.release()

    def respond_to_issue(
        self,
        repo_path: str,
        issue_id: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        issue_file_raw: object,
        outcome: str,
        explanation: str,
        experiment_id: str | None = None,
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            issue_file_raw=issue_file_raw,
            experiment_id=experiment_id,
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
                self._metadata_mutation_lock.release()

    def list_issue_responses(
        self,
        repo_path: str,
        issue_id: str,
        *,
        project: str,
        quest_type: str,
        quest_number: int,
        issue_file_raw: object,
        experiment_id: str | None = None,
    ) -> dict:
        ctx = self._resolve_issue_context(
            repo_path,
            project=project,
            quest_type=quest_type,
            quest_number=quest_number,
            issue_file_raw=issue_file_raw,
            experiment_id=experiment_id,
        )
        responses = issue_service.list_responses(ctx, issue_id)
        return {"responses": responses}
