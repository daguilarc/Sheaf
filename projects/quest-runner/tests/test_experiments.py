"""Tests for experiment metadata helpers and scoped checkout resolution."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from quest_runner_service import quest_fs
from quest_runner_service.dashboard_data import (
    DashboardBadRequest,
    DashboardNotFound,
    resolve_dashboard_checkout,
)
from quest_runner_service.experiments import (
    ArtifactCopySummary,
    ExperimentLandError,
    ExperimentMeta,
    ExperimentNotFound,
    ExperimentStartStep,
    ExperimentStopCondition,
    ExperimentValidationError,
    ExperimentWorktreeCreationError,
    archive_experiment_artifacts,
    experiment_branch_name,
    experiment_dir_name,
    experiment_id,
    experiment_worktree_path,
    experiments_root,
    find_experiment_by_id,
    list_experiment_dirs,
    next_experiment_number,
    push_experiment_branch,
    read_experiment_meta,
    resolve_quest_scope_checkout,
    resolve_start_step,
    update_experiment_status,
    validate_experiment_belongs_to_quest,
    validate_stop_condition,
    write_experiment_meta,
)
from quest_runner_service.quest_service import (
    ExperimentLandConflict,
    InvalidQuestInput,
    QuestService,
)
from quest_runner_service.quest_types import (
    QuestMeta,
    QuestFileState,
    RecursiveSnapshot,
    StepCommitMetadata,
    TransitionRecord,
    utc_now_iso,
)
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.state_machine.commit_metadata import render_step_commit_message
from quest_runner_service.worktrees import branch_exists, run_git

from quest_runner_service.workflow_config import load_packaged_default_workflow

from .test_helpers import TempRepo, ensure_project, make_app_client


def _default_workflow_dir(repo_root: Path) -> Path:
    return repo_root / "src" / "quest_runner_service" / "default_workflow"


def _default_workflow():
    return load_packaged_default_workflow()


def _git_commit(repo: Path, message: str, *, allow_empty: bool = False) -> str:
    run_git(repo, "add", "-A")
    args = ["commit", "-m", message]
    if allow_empty:
        args.insert(1, "--allow-empty")
    run_git(repo, *args)
    rev = run_git(repo, "rev-parse", "HEAD")
    return rev.stdout.strip()


def _step_commit_message(quest_rel: str, global_step: int, *, role: str | None = None) -> str:
    child = None
    if role is not None:
        child = RecursiveSnapshot(
            machine_path=f"{quest_rel}/slices/0000_test",
            machine_name="slice",
            node_name="SliceImplementingNode",
            state_before="Implementing",
            state_after="Implementing",
            tags={},
            child=None,
            role=role,
            thread_name=f"thread_{role}",
        )
    snap = RecursiveSnapshot(
        machine_path=quest_rel,
        machine_name="quest",
        node_name="ExecuteActiveSliceNode",
        state_before="ExecuteSlice",
        state_after="ExecuteSlice",
        tags={},
        child=child,
    )
    return render_step_commit_message(
        StepCommitMetadata(global_step=global_step, snapshot=snap)
    )


def _sample_meta(
    *,
    project: str = "quest-runner",
    quest_type: str = "main",
    quest_number: int = 0,
    experiment_number: int = 0,
    quest_slug: str = "experiments",
    status: str = "created",
) -> ExperimentMeta:
    exp_id = experiment_id(project, quest_type, quest_number, experiment_number)
    return ExperimentMeta(
        experiment_id=exp_id,
        experiment_number=experiment_number,
        project=project,
        quest_type=quest_type,
        quest_number=quest_number,
        quest_slug=quest_slug,
        description="Test experiment",
        start_step=ExperimentStartStep(
            global_step=5,
            role="implementer",
            step_log="logs/step_0005_implementer.jsonl",
            step_commit="abc123",
            base_commit="def456",
        ),
        stop_condition=ExperimentStopCondition(
            machine_path="root/slice",
            node_name="Completed",
        ),
        worktree_name=exp_id,
        branch_name=experiment_branch_name(
            project, quest_type, quest_number, experiment_number
        ),
        status=status,
        created_at=utc_now_iso(),
        created_by="operator",
    )


class ExperimentNamingTests(unittest.TestCase):
    def test_experiment_dir_name(self) -> None:
        self.assertEqual(experiment_dir_name(0), "0000")
        self.assertEqual(experiment_dir_name(12), "0012")

    def test_experiment_id(self) -> None:
        self.assertEqual(
            experiment_id("quest-runner", "main", 0, 0),
            "experiment_quest-runner_main_0_0",
        )

    def test_experiment_branch_name(self) -> None:
        self.assertEqual(
            experiment_branch_name("quest-runner", "main", 0, 0),
            "experiment/quest-runner/main/0000/0000",
        )

    def test_experiment_worktree_path(self) -> None:
        source = Path("/data/sheaf")
        meta = _sample_meta()
        self.assertEqual(
            experiment_worktree_path(source, meta),
            Path(
                "/data/.quest-worktrees/experiment_quest-runner_main_0_0"
            ),
        )
        self.assertEqual(
            experiment_worktree_path(source, meta.experiment_id),
            experiment_worktree_path(source, meta),
        )


class ExperimentDirectoryTests(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile

        self._tmpdir = tempfile.TemporaryDirectory()
        self.quest_dir = Path(self._tmpdir.name) / "quest"
        self.quest_dir.mkdir()

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_next_experiment_number_empty(self) -> None:
        self.assertEqual(next_experiment_number(self.quest_dir), 0)

    def test_next_experiment_number_ignores_non_numeric(self) -> None:
        root = experiments_root(self.quest_dir)
        root.mkdir()
        (root / "notes").mkdir()
        (root / "0000").mkdir()
        (root / "0002").mkdir()
        self.assertEqual(next_experiment_number(self.quest_dir), 3)

    def test_list_experiment_dirs_sorted(self) -> None:
        root = experiments_root(self.quest_dir)
        root.mkdir()
        (root / "0002").mkdir()
        (root / "0000").mkdir()
        (root / "bad").mkdir()
        dirs = list_experiment_dirs(self.quest_dir)
        self.assertEqual([p.name for p in dirs], ["0000", "0002"])


class ExperimentMetaIoTests(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile

        self._tmpdir = tempfile.TemporaryDirectory()
        self.exp_dir = Path(self._tmpdir.name) / "0000"

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_write_read_round_trip_required_fields(self) -> None:
        meta = _sample_meta()
        path = write_experiment_meta(self.exp_dir, meta)
        loaded = read_experiment_meta(path)
        self.assertEqual(loaded.experiment_id, meta.experiment_id)
        self.assertEqual(loaded.start_step.global_step, 5)
        self.assertEqual(loaded.start_step.role, "implementer")
        self.assertEqual(
            loaded.start_step.step_log, "logs/step_0005_implementer.jsonl"
        )
        self.assertEqual(loaded.stop_condition.node_name, "Completed")

    def test_write_read_optional_landed_fields(self) -> None:
        meta = _sample_meta(status="landed")
        meta.landed_at = "2026-06-08T12:00:00Z"
        meta.remote_branch = "experiment/quest-runner/main/0000/0000"
        write_experiment_meta(self.exp_dir, meta)
        loaded = read_experiment_meta(self.exp_dir)
        self.assertEqual(loaded.landed_at, "2026-06-08T12:00:00Z")
        self.assertEqual(
            loaded.remote_branch, "experiment/quest-runner/main/0000/0000"
        )

    def test_read_permissive_without_landed_fields(self) -> None:
        meta = _sample_meta()
        write_experiment_meta(self.exp_dir, meta)
        raw = json.loads((self.exp_dir / "experiment.json").read_text())
        raw.pop("landed_at", None)
        raw.pop("remote_branch", None)
        (self.exp_dir / "experiment.json").write_text(
            json.dumps(raw, indent=2) + "\n", encoding="utf-8"
        )
        loaded = read_experiment_meta(self.exp_dir)
        self.assertIsNone(loaded.landed_at)
        self.assertIsNone(loaded.remote_branch)

    def test_read_ignores_legacy_source_commit_field(self) -> None:
        meta = _sample_meta(status="landed")
        write_experiment_meta(self.exp_dir, meta)
        raw = json.loads((self.exp_dir / "experiment.json").read_text())
        raw["source_commit"] = "deadbeef"
        (self.exp_dir / "experiment.json").write_text(
            json.dumps(raw, indent=2) + "\n", encoding="utf-8"
        )
        loaded = read_experiment_meta(self.exp_dir)
        self.assertFalse(hasattr(loaded, "source_commit"))

    def test_json_has_trailing_newline(self) -> None:
        write_experiment_meta(self.exp_dir, _sample_meta())
        text = (self.exp_dir / "experiment.json").read_text(encoding="utf-8")
        self.assertTrue(text.endswith("\n"))
        self.assertIn("\n  ", text)

    def test_update_experiment_status(self) -> None:
        write_experiment_meta(self.exp_dir, _sample_meta())
        updated = update_experiment_status(
            self.exp_dir,
            "open",
            landed_at="2026-06-08T12:00:00Z",
        )
        self.assertEqual(updated.status, "open")
        self.assertEqual(updated.landed_at, "2026-06-08T12:00:00Z")
        reloaded = read_experiment_meta(self.exp_dir)
        self.assertEqual(reloaded.status, "open")


class ExperimentValidationTests(unittest.TestCase):
    def test_validate_belongs_to_quest(self) -> None:
        meta = _sample_meta()
        validate_experiment_belongs_to_quest(meta, "quest-runner", "main", 0)

    def test_validate_rejects_mismatch(self) -> None:
        meta = _sample_meta()
        with self.assertRaises(ExperimentValidationError):
            validate_experiment_belongs_to_quest(meta, "other", "main", 0)


class ExperimentResolverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _create_quest(self) -> tuple[dict, QuestMeta, Path]:
        ensure_project(self.temp.root, "example")
        _client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Exp")
        qdir_source = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert qdir_source is not None
        meta = quest_fs.read_quest_meta(qdir_source)
        return out, meta, qdir_source

    def _write_experiment(
        self,
        source_qdir: Path,
        meta: QuestMeta,
        *,
        experiment_number: int = 0,
    ) -> ExperimentMeta:
        exp_meta = _sample_meta(
            project=meta.project,
            quest_type=meta.quest_type,
            quest_number=meta.quest_number,
            quest_slug=meta.quest_slug,
            experiment_number=experiment_number,
        )
        exp_dir = experiments_root(source_qdir) / experiment_dir_name(
            experiment_number
        )
        write_experiment_meta(exp_dir, exp_meta)
        return exp_meta

    def _add_experiment_worktree(self, exp_meta: ExperimentMeta) -> Path:
        wt_path = experiment_worktree_path(self.temp.root, exp_meta)
        wt_path.parent.mkdir(parents=True, exist_ok=True)
        branch = exp_meta.branch_name
        run_git(self.temp.root, "worktree", "add", "-b", branch, str(wt_path), "HEAD")
        return wt_path

    def test_resolve_without_experiment_id_unchanged(self) -> None:
        _out, meta, _qdir = self._create_quest()
        direct = resolve_quest_scope_checkout(self.temp.root, meta)
        wrapped = resolve_dashboard_checkout(self.temp.root, meta)
        self.assertEqual(direct.checkout_kind, wrapped.checkout_kind)
        self.assertEqual(direct.checkout_path, wrapped.checkout_path)
        self.assertEqual(direct.worktree_missing, wrapped.worktree_missing)
        self.assertEqual(direct.quest_dir_rel, wrapped.quest_dir_rel)
        self.assertIsNone(direct.experiment_id)
        self.assertIsNone(wrapped.experiment_id)

    def test_resolve_with_matching_experiment_id(self) -> None:
        _out, meta, source_qdir = self._create_quest()
        exp_meta = self._write_experiment(source_qdir, meta)
        self._add_experiment_worktree(exp_meta)
        checkout = resolve_quest_scope_checkout(
            self.temp.root,
            meta,
            experiment_id=exp_meta.experiment_id,
        )
        self.assertEqual(checkout.checkout_kind, "experiment")
        self.assertFalse(checkout.worktree_missing)
        self.assertEqual(checkout.experiment_id, exp_meta.experiment_id)
        self.assertEqual(checkout.experiment_number, 0)
        self.assertEqual(
            checkout.checkout_root,
            experiment_worktree_path(self.temp.root, exp_meta).resolve(),
        )
        self.assertEqual(checkout.parent_quest_dir, source_qdir.resolve())

    def test_resolve_rejects_wrong_quest_identity(self) -> None:
        _out, meta, source_qdir = self._create_quest()
        exp_meta = self._write_experiment(source_qdir, meta)
        wrong_meta = QuestMeta(
            project="other",
            quest_type=meta.quest_type,
            quest_number=meta.quest_number,
            quest_slug=meta.quest_slug,
            quest_name=meta.quest_name,
            created_at=meta.created_at,
        )
        with self.assertRaises(DashboardNotFound):
            resolve_quest_scope_checkout(
                self.temp.root,
                wrong_meta,
                experiment_id=exp_meta.experiment_id,
            )

    def test_resolve_rejects_experiment_meta_identity_mismatch(self) -> None:
        _out, meta, source_qdir = self._create_quest()
        exp_meta = self._write_experiment(source_qdir, meta)
        exp_meta.project = "wrong-project"
        exp_dir = experiments_root(source_qdir) / experiment_dir_name(0)
        write_experiment_meta(exp_dir, exp_meta)
        with self.assertRaises(DashboardBadRequest):
            resolve_quest_scope_checkout(
                self.temp.root,
                meta,
                experiment_id=exp_meta.experiment_id,
            )

    def test_resolve_missing_open_worktree_when_required(self) -> None:
        _out, meta, source_qdir = self._create_quest()
        exp_meta = self._write_experiment(source_qdir, meta)
        with self.assertRaises(DashboardNotFound):
            resolve_quest_scope_checkout(
                self.temp.root,
                meta,
                experiment_id=exp_meta.experiment_id,
                require_open_experiment=True,
            )

    def test_resolve_experiment_does_not_fallback_to_source(self) -> None:
        _out, meta, source_qdir = self._create_quest()
        exp_meta = self._write_experiment(source_qdir, meta)
        from quest_runner_service.worktrees import remove_partial_worktree

        remove_partial_worktree(self.temp.root, meta)
        with self.assertRaises(DashboardNotFound):
            resolve_quest_scope_checkout(
                self.temp.root,
                meta,
                experiment_id=exp_meta.experiment_id,
            )

    def test_find_experiment_by_id(self) -> None:
        _out, meta, source_qdir = self._create_quest()
        exp_meta = self._write_experiment(source_qdir, meta)
        found = find_experiment_by_id(
            self.temp.root,
            meta.project,
            meta.quest_type,
            meta.quest_number,
            exp_meta.experiment_id,
        )
        self.assertEqual(found.experiment_id, exp_meta.experiment_id)

    def test_find_experiment_by_id_missing(self) -> None:
        _out, meta, _source_qdir = self._create_quest()
        with self.assertRaises(ExperimentNotFound):
            find_experiment_by_id(
                self.temp.root,
                meta.project,
                meta.quest_type,
                meta.quest_number,
                "experiment_example_main_0_99",
            )


class ExperimentStartStepResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _quest_rel(self, source_qdir: Path) -> str:
        return source_qdir.resolve().relative_to(self.temp.root.resolve()).as_posix()

    def _create_quest_on_source(self) -> tuple[dict, Path]:
        ensure_project(self.temp.root, "example")
        svc = QuestService(QuestLock(), self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Exp")
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        return out, source_qdir

    def test_resolve_start_step_from_metadata(self) -> None:
        _out, source_qdir = self._create_quest_on_source()
        qrel = self._quest_rel(source_qdir)
        msg = _step_commit_message(qrel, 5, role="implementer")
        step_sha = _git_commit(self.temp.root, msg, allow_empty=True)
        parent = run_git(self.temp.root, "rev-parse", f"{step_sha}^").stdout.strip()
        (source_qdir / "logs").mkdir(exist_ok=True)
        (source_qdir / "logs" / "step_0005_implementer.jsonl").write_text(
            "{}\n", encoding="utf-8"
        )
        resolved = resolve_start_step(self.temp.root, source_qdir, 5)
        self.assertEqual(resolved.global_step, 5)
        self.assertEqual(resolved.step_commit, step_sha)
        self.assertEqual(resolved.base_commit, parent)
        self.assertEqual(resolved.role, "implementer")
        self.assertEqual(resolved.step_log, "logs/step_0005_implementer.jsonl")

    def test_resolve_start_step_from_state_history(self) -> None:
        _out, source_qdir = self._create_quest_on_source()
        base_sha = run_git(self.temp.root, "rev-parse", "HEAD").stdout.strip()
        quest_fs.append_history(
            source_qdir / "state_history.md",
            TransitionRecord(
                timestamp="2026-01-01T00:00:00Z",
                previous_state="PrePlanning",
                next_state="PhysicalPlanning",
                commit=base_sha,
                thread_name="runner",
                notes="global_step: 1 role: implementer",
            ),
        )
        parent = run_git(self.temp.root, "rev-parse", f"{base_sha}^").stdout.strip()
        resolved = resolve_start_step(self.temp.root, source_qdir, 1)
        self.assertEqual(resolved.step_commit, base_sha)
        self.assertEqual(resolved.base_commit, parent)
        self.assertEqual(resolved.role, "implementer")

    def test_resolve_rejects_unknown_start_step(self) -> None:
        _out, source_qdir = self._create_quest_on_source()
        with self.assertRaises(ExperimentValidationError):
            resolve_start_step(self.temp.root, source_qdir, 99)

    def test_resolve_rejects_parentless_commit(self) -> None:
        _out, source_qdir = self._create_quest_on_source()
        root_sha = run_git(self.temp.root, "rev-parse", "HEAD").stdout.strip()
        while True:
            parents = run_git(
                self.temp.root,
                "rev-list",
                "--parents",
                "-n",
                "1",
                root_sha,
                check=False,
            ).stdout.strip().split()
            if len(parents) <= 1:
                break
            root_sha = parents[-1]
        quest_fs.append_history(
            source_qdir / "state_history.md",
            TransitionRecord(
                timestamp="2026-01-01T00:00:00Z",
                previous_state="PrePlanning",
                next_state="PhysicalPlanning",
                commit=root_sha,
                thread_name="runner",
                notes="global_step: 1",
            ),
        )
        with self.assertRaises(ExperimentValidationError):
            resolve_start_step(self.temp.root, source_qdir, 1)


class ExperimentStopConditionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workflow = _default_workflow()

    def test_validate_slice_completed_alias(self) -> None:
        cond = validate_stop_condition(None, "slice_completed", self.workflow)
        self.assertEqual(cond.machine_path, "root/slice")
        self.assertEqual(cond.node_name, "Completed")

    def test_validate_slice_completed_inputs_resolve_to_same_node(self) -> None:
        resolved = [
            validate_stop_condition(None, stop_node, self.workflow).node_name
            for stop_node in ("slice_completed", "Completed", "SliceCompletedNode")
        ]
        self.assertEqual(
            resolved,
            ["Completed", "Completed", "Completed"],
        )

    def test_validate_rejects_unknown_stop_node(self) -> None:
        with self.assertRaises(ExperimentValidationError):
            validate_stop_condition("root/slice", "not_a_real_node", self.workflow)


class ExperimentCreationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _prepare_quest_with_step(self) -> tuple[QuestService, dict, Path, str]:
        ensure_project(self.temp.root, "example")
        svc = QuestService(QuestLock(), self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Exp Create")
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        qrel = source_qdir.resolve().relative_to(self.temp.root.resolve()).as_posix()
        msg = _step_commit_message(qrel, 5, role="implementer")
        step_sha = _git_commit(self.temp.root, msg, allow_empty=True)
        parent_sha = run_git(self.temp.root, "rev-parse", f"{step_sha}^").stdout.strip()
        return svc, out, source_qdir, parent_sha

    def test_next_experiment_number_after_create(self) -> None:
        svc, out, source_qdir, _parent = self._prepare_quest_with_step()
        svc.create_experiment(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            quest_number=out["quest_number"],
            start_step=5,
            stop_node="slice_completed",
            notes="first experiment",
            workflow_path=str(_default_workflow_dir(self.repo_root)),
        )
        self.assertEqual(next_experiment_number(source_qdir), 1)

    def test_create_writes_metadata_files_and_commits(self) -> None:
        svc, out, source_qdir, parent_sha = self._prepare_quest_with_step()
        result = svc.create_experiment(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            quest_number=out["quest_number"],
            start_step=5,
            stop_node="slice_completed",
            notes="experiment notes body",
            workflow_path=str(_default_workflow_dir(self.repo_root)),
            public_base_url="http://test.local/",
        )
        exp_dir = experiments_root(source_qdir) / "0000"
        self.assertTrue((exp_dir / "experiment.json").is_file())
        self.assertTrue((exp_dir / "notes.md").is_file())
        self.assertTrue((exp_dir / "workflow" / "workflow.yaml").is_file())
        meta = read_experiment_meta(exp_dir)
        self.assertEqual(meta.status, "open")
        self.assertEqual(meta.start_step.base_commit, parent_sha)
        self.assertEqual(meta.stop_condition.node_name, "Completed")
        self.assertEqual(result["experiment_number"], 0)
        self.assertEqual(
            result["experiment_id"],
            experiment_id("example", "main", out["quest_number"], 0),
        )
        log = subprocess.run(
            ["git", "-C", str(self.temp.root), "log", "-1", "--format=%s"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(
            log.stdout.strip(),
            f"experiment-create: example/main/{out['quest_number']:04d}/0000",
        )
        self.assertFalse((source_qdir / "state_execution_config.yaml").is_file())
        self.assertTrue((source_qdir / "workflow" / "workflow.yaml").is_file())

    def test_create_worktree_and_replaces_experiment_workflow(self) -> None:
        svc, out, source_qdir, parent_sha = self._prepare_quest_with_step()
        result = svc.create_experiment(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            quest_number=out["quest_number"],
            start_step=5,
            stop_node="slice_completed",
            notes="config swap test",
            workflow_path=str(_default_workflow_dir(self.repo_root)),
        )
        wt_path = Path(result["worktree_path"])
        self.assertTrue(wt_path.is_dir())
        exp_meta = read_experiment_meta(experiments_root(source_qdir) / "0000")
        self.assertEqual(
            wt_path.resolve(),
            experiment_worktree_path(self.temp.root, exp_meta).resolve(),
        )
        wt_qdir = quest_fs.find_quest_dir(
            wt_path, "example", "main", out["quest_number"]
        )
        assert wt_qdir is not None
        self.assertTrue((wt_qdir / "workflow" / "workflow.yaml").is_file())
        self.assertFalse((wt_qdir / "state_execution_config.yaml").is_file())
        head = run_git(wt_path, "rev-parse", "HEAD").stdout.strip()
        self.assertEqual(head, parent_sha)

    def test_create_rejects_unknown_stop_node_before_worktree(self) -> None:
        svc, out, source_qdir, _parent = self._prepare_quest_with_step()
        with self.assertRaises(InvalidQuestInput):
            svc.create_experiment(
                repo_path=str(self.temp.root),
                project="example",
                quest_type="main",
                quest_number=out["quest_number"],
                start_step=5,
                stop_node="definitely_unknown",
                notes="should fail",
                workflow_path=str(_default_workflow_dir(self.repo_root)),
            )
        self.assertFalse(experiments_root(source_qdir).exists())

    def test_partial_cleanup_when_metadata_commit_fails(self) -> None:
        svc, out, source_qdir, _parent = self._prepare_quest_with_step()
        branch = experiment_branch_name(
            "example", "main", out["quest_number"], 0
        )
        wt_path = experiment_worktree_path(
            self.temp.root,
            experiment_id("example", "main", out["quest_number"], 0),
        )
        with patch(
            "quest_runner_service.experiments.commit_experiment_metadata",
            side_effect=RuntimeError("commit boom"),
        ):
            with self.assertRaises(RuntimeError):
                svc.create_experiment(
                    repo_path=str(self.temp.root),
                    project="example",
                    quest_type="main",
                    quest_number=out["quest_number"],
                    start_step=5,
                    stop_node="slice_completed",
                    notes="cleanup test",
                    workflow_path=str(_default_workflow_dir(self.repo_root)),
                )
        exp_dir = experiments_root(source_qdir) / experiment_dir_name(0)
        self.assertFalse(exp_dir.exists())
        self.assertFalse(branch_exists(self.temp.root, branch))
        self.assertFalse(wt_path.exists())

    def test_committed_metadata_failure_includes_retry_details(self) -> None:
        svc, out, source_qdir, _parent = self._prepare_quest_with_step()
        with patch(
            "quest_runner_service.experiments.create_experiment_branch_and_worktree",
            side_effect=RuntimeError("worktree boom"),
        ):
            with self.assertRaises(ExperimentWorktreeCreationError) as ctx:
                svc.create_experiment(
                    repo_path=str(self.temp.root),
                    project="example",
                    quest_type="main",
                    quest_number=out["quest_number"],
                    start_step=5,
                    stop_node="slice_completed",
                    notes="retry details",
                    workflow_path=str(_default_workflow_dir(self.repo_root)),
                )
        err = ctx.exception
        self.assertTrue((experiments_root(source_qdir) / "0000").is_dir())
        self.assertTrue(err.metadata_commit)
        self.assertEqual(
            err.branch_name,
            experiment_branch_name("example", "main", out["quest_number"], 0),
        )
        self.assertTrue(str(err.worktree_path).endswith(
            experiment_id("example", "main", out["quest_number"], 0)
        ))


def _git_commit_all(repo: Path, message: str) -> str:
    run_git(repo, "add", "-A")
    run_git(repo, "commit", "-m", message)
    return run_git(repo, "rev-parse", "HEAD").stdout.strip()


def _add_bare_remote(repo: Path) -> Path:
    bare = repo.parent / f"{repo.name}_remote.git"
    subprocess.run(
        ["git", "init", "--bare", str(bare)],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "remote", "add", "origin", str(bare)],
        check=True,
        capture_output=True,
    )
    branch = subprocess.run(
        ["git", "-C", str(repo), "branch", "--show-current"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if branch != "main":
        subprocess.run(
            ["git", "-C", str(repo), "branch", "-M", "main"],
            check=True,
            capture_output=True,
        )
        branch = "main"
    subprocess.run(
        ["git", "-C", str(repo), "push", "-u", "origin", branch],
        check=True,
        capture_output=True,
    )
    return bare


def _write_experiment_on_quest(
    source_qdir: Path,
    meta: QuestMeta,
    *,
    experiment_number: int = 0,
    status: str = "experiment_complete",
) -> ExperimentMeta:
    exp_meta = _sample_meta(
        project=meta.project,
        quest_type=meta.quest_type,
        quest_number=meta.quest_number,
        quest_slug=meta.quest_slug,
        experiment_number=experiment_number,
        status=status,
    )
    exp_dir = experiments_root(source_qdir) / experiment_dir_name(experiment_number)
    write_experiment_meta(exp_dir, exp_meta)
    return exp_meta


def _add_experiment_worktree(source_root: Path, exp_meta: ExperimentMeta) -> Path:
    from .test_experiment_scoped_operations import _add_experiment_worktree as add_wt

    return add_wt(source_root, exp_meta)


class ArchiveExperimentArtifactsTests(unittest.TestCase):
    def test_copies_logs_issues_and_responses(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            quest = root / "quest"
            archive = root / "archive"
            quest.mkdir()
            archive.mkdir()
            (quest / "logs").mkdir()
            (quest / "logs" / "step_0001_run.jsonl").write_text("{}\n", encoding="utf-8")
            (quest / "physicalplan_issues.md").write_text("# Issues\n", encoding="utf-8")
            (quest / "physicalplan_issue_responses.md").write_text(
                "# Responses\n", encoding="utf-8"
            )
            (quest / "integration_test_issues.md").write_text(
                "# Integration\n", encoding="utf-8"
            )
            (quest / "integration_test_issue_responses.md").write_text(
                "# Integration responses\n", encoding="utf-8"
            )
            sl = quest / "slices" / "0000_a"
            sl.mkdir(parents=True)
            (sl / "polishing_issues.md").write_text("# Slice issues\n", encoding="utf-8")
            (sl / "polishing_issue_responses.md").write_text(
                "# Slice responses\n", encoding="utf-8"
            )

            summary = archive_experiment_artifacts(
                archive,
                quest,
                workflow=_default_workflow(),
            )
            self.assertIsInstance(summary, ArtifactCopySummary)
            self.assertEqual(summary.logs_copied, 1)
            self.assertEqual(summary.issues_copied, 3)
            self.assertEqual(summary.issue_responses_copied, 3)
            self.assertEqual(summary.skipped_missing, 0)
            self.assertTrue(
                (archive / "logs" / "step_0001_run.jsonl").is_file()
            )
            self.assertTrue(
                (archive / "issues" / "quest" / "physicalplan_issues.md").is_file()
            )
            self.assertTrue(
                (
                    archive
                    / "issues"
                    / "slices"
                    / "0000_a"
                    / "polishing_issues.md"
                ).is_file()
            )
            self.assertTrue(
                (
                    archive
                    / "issue_responses"
                    / "quest"
                    / "physicalplan_issue_responses.md"
                ).is_file()
            )
            self.assertTrue(
                (
                    archive
                    / "issue_responses"
                    / "quest"
                    / "integration_test_issue_responses.md"
                ).is_file()
            )
            self.assertTrue(
                (
                    archive
                    / "issue_responses"
                    / "slices"
                    / "0000_a"
                    / "polishing_issue_responses.md"
                ).is_file()
            )

    def test_skips_missing_optional_response_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            quest = root / "quest"
            archive = root / "archive"
            quest.mkdir()
            archive.mkdir()
            sl = quest / "slices" / "0000_a"
            sl.mkdir(parents=True)
            (sl / "polishing_issues.md").write_text("# Slice issues\n", encoding="utf-8")

            summary = archive_experiment_artifacts(
                archive,
                quest,
                workflow=_default_workflow(),
            )
            self.assertEqual(summary.issues_copied, 1)
            self.assertEqual(summary.issue_responses_copied, 0)
            self.assertEqual(summary.skipped_missing, 3)


class ExperimentLandServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)
        bare = _add_bare_remote(self.temp.root)
        self.addCleanup(lambda: shutil.rmtree(bare, ignore_errors=True))

    def _service(self) -> QuestService:
        return QuestService(QuestLock(), self.repo_root)

    def _setup_completed_experiment(
        self,
    ) -> tuple[QuestService, dict, ExperimentMeta, Path, Path]:
        ensure_project(self.temp.root, "example")
        svc = self._service()
        out = svc.create_quest(
            str(self.temp.root), "example", "main", "Land Test"
        )
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        quest_meta = quest_fs.read_quest_meta(source_qdir)
        exp_meta = _write_experiment_on_quest(source_qdir, quest_meta)
        _git_commit_all(self.temp.root, "experiment metadata")
        _add_experiment_worktree(self.temp.root, exp_meta)
        remove_partial_worktree = __import__(
            "quest_runner_service.worktrees", fromlist=["remove_partial_worktree"]
        ).remove_partial_worktree
        remove_partial_worktree(self.temp.root, quest_meta)

        wt_path = experiment_worktree_path(self.temp.root, exp_meta)
        wt_qdir = quest_fs.find_quest_dir(
            wt_path, "example", "main", out["quest_number"]
        )
        assert wt_qdir is not None
        (wt_qdir / "logs").mkdir(exist_ok=True)
        (wt_qdir / "logs" / "step_0005_run.jsonl").write_text("{}\n", encoding="utf-8")
        (wt_qdir / "physicalplan_issues.md").write_text("# Issues\n", encoding="utf-8")
        sl = wt_qdir / "slices" / "0000_done"
        sl.mkdir(parents=True)
        (sl / "polishing_issues.md").write_text("# Slice\n", encoding="utf-8")
        quest_fs.write_quest_file_state(
            wt_qdir,
            QuestFileState(
                state="ExperimentComplete",
                current_slice=None,
                updated_at="2026-06-08T00:00:00Z",
                global_step=6,
            ),
        )
        _git_commit_all(wt_path, "experiment complete artifacts")
        return svc, out, exp_meta, source_qdir, wt_path

    def test_land_success_archives_and_cleans_up(self) -> None:
        svc, out, exp_meta, source_qdir, wt_path = self._setup_completed_experiment()
        result = svc.land_experiment(
            str(self.temp.root),
            "example",
            "main",
            out["quest_number"],
            exp_meta.experiment_id,
            public_base_url="http://localhost:5000/",
        )
        self.assertEqual(result["status"], "landed")
        self.assertEqual(result["logs_copied"], 1)
        self.assertEqual(result["issues_copied"], 3)
        self.assertEqual(result["worktree_deleted"], True)
        self.assertEqual(result["branch_deleted"], True)
        self.assertEqual(result["remote_branch"], exp_meta.branch_name)
        self.assertNotIn("source_commit", result)

        exp_dir = experiments_root(source_qdir) / experiment_dir_name(0)
        loaded = read_experiment_meta(exp_dir)
        self.assertEqual(loaded.status, "landed")
        self.assertIsNotNone(loaded.landed_at)
        self.assertEqual(loaded.remote_branch, exp_meta.branch_name)
        self.assertFalse(hasattr(loaded, "source_commit"))
        self.assertTrue((exp_dir / "logs" / "step_0005_run.jsonl").is_file())
        self.assertTrue(
            (exp_dir / "issues" / "quest" / "physicalplan_issues.md").is_file()
        )
        self.assertFalse(wt_path.exists())
        self.assertFalse(branch_exists(self.temp.root, exp_meta.branch_name))
        log = subprocess.run(
            ["git", "-C", str(self.temp.root), "log", "-1", "--format=%s"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(
            log.stdout.strip(),
            f"experiment-land: example/main/{out['quest_number']:04d}/0000",
        )

    def test_land_rejects_unknown_experiment_id(self) -> None:
        svc, out, _exp_meta, _source_qdir, _wt_path = self._setup_completed_experiment()
        with self.assertRaises(InvalidQuestInput):
            svc.land_experiment(
                str(self.temp.root),
                "example",
                "main",
                out["quest_number"],
                "experiment_example_main_0_99",
            )

    def test_land_rejects_mismatched_quest_identity(self) -> None:
        svc, out, exp_meta, source_qdir, _wt_path = self._setup_completed_experiment()
        exp_dir = experiments_root(source_qdir) / experiment_dir_name(0)
        loaded = read_experiment_meta(exp_dir)
        loaded.project = "wrong-project"
        write_experiment_meta(exp_dir, loaded)
        with self.assertRaises(InvalidQuestInput):
            svc.land_experiment(
                str(self.temp.root),
                "example",
                "main",
                out["quest_number"],
                exp_meta.experiment_id,
            )

    def test_land_rejects_missing_worktree(self) -> None:
        svc, out, exp_meta, _source_qdir, wt_path = self._setup_completed_experiment()
        shutil.rmtree(wt_path)
        with self.assertRaises(ExperimentLandConflict) as ctx:
            svc.land_experiment(
                str(self.temp.root),
                "example",
                "main",
                out["quest_number"],
                exp_meta.experiment_id,
            )
        self.assertEqual(ctx.exception.body["status"], "worktree_missing")

    def test_land_rejects_non_complete_state(self) -> None:
        svc, out, exp_meta, _source_qdir, wt_path = self._setup_completed_experiment()
        wt_qdir = quest_fs.find_quest_dir(
            wt_path, "example", "main", out["quest_number"]
        )
        assert wt_qdir is not None
        quest_fs.write_quest_file_state(
            wt_qdir,
            QuestFileState(
                state="ExecuteSlice",
                current_slice=0,
                updated_at="2026-06-08T00:00:00Z",
                active_slice="0000_done",
                global_step=5,
            ),
        )
        with self.assertRaises(ExperimentLandConflict) as ctx:
            svc.land_experiment(
                str(self.temp.root),
                "example",
                "main",
                out["quest_number"],
                exp_meta.experiment_id,
            )
        self.assertEqual(ctx.exception.body["status"], "not_complete")

    def test_land_push_failure_preserves_local_state(self) -> None:
        svc, out, exp_meta, source_qdir, wt_path = self._setup_completed_experiment()
        with patch(
            "quest_runner_service.experiments.push_experiment_branch",
            side_effect=ExperimentLandError("push failed"),
        ):
            with self.assertRaises(ExperimentLandConflict) as ctx:
                svc.land_experiment(
                    str(self.temp.root),
                    "example",
                    "main",
                    out["quest_number"],
                    exp_meta.experiment_id,
                )
        self.assertEqual(ctx.exception.body["status"], "push_failed")
        self.assertTrue(wt_path.is_dir())
        self.assertTrue(branch_exists(self.temp.root, exp_meta.branch_name))
        loaded = read_experiment_meta(experiments_root(source_qdir) / "0000")
        self.assertEqual(loaded.status, "experiment_complete")
        self.assertEqual(
            run_git(self.temp.root, "status", "--porcelain").stdout.strip(),
            "",
        )

        retry = svc.land_experiment(
            str(self.temp.root),
            "example",
            "main",
            out["quest_number"],
            exp_meta.experiment_id,
        )
        self.assertEqual(retry["status"], "landed")

    def test_land_artifact_copy_failure_does_not_mark_landed(self) -> None:
        svc, out, exp_meta, source_qdir, wt_path = self._setup_completed_experiment()

        def fail_after_partial_copy(source_experiment_dir: Path, _quest_dir: Path):
            partial = source_experiment_dir / "logs" / "partial.jsonl"
            partial.parent.mkdir(parents=True, exist_ok=True)
            partial.write_text("{}\n", encoding="utf-8")
            raise OSError("copy failed")

        with patch(
            "quest_runner_service.experiments.archive_experiment_artifacts",
            side_effect=fail_after_partial_copy,
        ):
            with self.assertRaises(ExperimentLandConflict) as ctx:
                svc.land_experiment(
                    str(self.temp.root),
                    "example",
                    "main",
                    out["quest_number"],
                    exp_meta.experiment_id,
                )
        self.assertEqual(ctx.exception.body["status"], "artifact_copy_failed")
        loaded = read_experiment_meta(experiments_root(source_qdir) / "0000")
        self.assertEqual(loaded.status, "experiment_complete")
        self.assertTrue(wt_path.is_dir())
        self.assertFalse(
            (experiments_root(source_qdir) / "0000" / "logs" / "partial.jsonl").exists()
        )
        self.assertEqual(
            run_git(self.temp.root, "status", "--porcelain").stdout.strip(),
            "",
        )

    def test_push_experiment_branch_uses_unique_branch_ref(self) -> None:
        svc, out, exp_meta, _source_qdir, _wt_path = self._setup_completed_experiment()
        push_experiment_branch(self.temp.root, exp_meta.branch_name)
        show = subprocess.run(
            [
                "git",
                "-C",
                str(self.temp.root.parent / f"{self.temp.root.name}_remote.git"),
                "show-ref",
                "--verify",
                f"refs/heads/{exp_meta.branch_name}",
            ],
            capture_output=True,
        )
        self.assertEqual(show.returncode, 0)
