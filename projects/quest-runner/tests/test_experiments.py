"""Tests for experiment metadata helpers and scoped checkout resolution."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from quest_runner_service import quest_fs
from quest_runner_service.dashboard_data import (
    DashboardBadRequest,
    DashboardNotFound,
    resolve_dashboard_checkout,
)
from quest_runner_service.experiments import (
    ExperimentMeta,
    ExperimentNotFound,
    ExperimentStartStep,
    ExperimentStopCondition,
    ExperimentValidationError,
    experiment_branch_name,
    experiment_dir_name,
    experiment_id,
    experiment_worktree_path,
    experiments_root,
    find_experiment_by_id,
    list_experiment_dirs,
    next_experiment_number,
    read_experiment_meta,
    resolve_quest_scope_checkout,
    update_experiment_status,
    validate_experiment_belongs_to_quest,
    write_experiment_meta,
)
from quest_runner_service.quest_types import QuestMeta, utc_now_iso
from quest_runner_service.worktrees import run_git

from .test_helpers import TempRepo, ensure_project, make_app_client


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
            node_name="slice_completed",
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
        self.assertEqual(loaded.stop_condition.node_name, "slice_completed")

    def test_write_read_optional_landed_fields(self) -> None:
        meta = _sample_meta(status="landed")
        meta.landed_at = "2026-06-08T12:00:00Z"
        meta.remote_branch = "experiment/quest-runner/main/0000/0000"
        meta.source_commit = "deadbeef"
        write_experiment_meta(self.exp_dir, meta)
        loaded = read_experiment_meta(self.exp_dir)
        self.assertEqual(loaded.landed_at, "2026-06-08T12:00:00Z")
        self.assertEqual(
            loaded.remote_branch, "experiment/quest-runner/main/0000/0000"
        )
        self.assertEqual(loaded.source_commit, "deadbeef")

    def test_read_permissive_without_landed_fields(self) -> None:
        meta = _sample_meta()
        write_experiment_meta(self.exp_dir, meta)
        raw = json.loads((self.exp_dir / "experiment.json").read_text())
        raw.pop("landed_at", None)
        raw.pop("remote_branch", None)
        raw.pop("source_commit", None)
        (self.exp_dir / "experiment.json").write_text(
            json.dumps(raw, indent=2) + "\n", encoding="utf-8"
        )
        loaded = read_experiment_meta(self.exp_dir)
        self.assertIsNone(loaded.landed_at)
        self.assertIsNone(loaded.remote_branch)
        self.assertIsNone(loaded.source_commit)

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
