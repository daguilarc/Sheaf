"""Tests for experiment-scoped quest operations."""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quest_runner_service import quest_fs
from quest_runner_service.experiments import (
    ExperimentMeta,
    experiment_dir_name,
    experiment_id,
    experiment_worktree_path,
    experiments_root,
    write_experiment_meta,
)
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_service import (
    InvalidQuestInput,
    MissingQuestWorktree,
    QuestService,
)
from quest_runner_service.quest_thread import build_runtime_context
from quest_runner_service.quest_types import QuestMeta
from quest_runner_service.worktrees import remove_partial_worktree, run_git

from .test_experiments import _sample_meta
from .test_helpers import TempRepo, ensure_project, make_app_client


def _write_experiment(
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
    exp_dir = experiments_root(source_qdir) / experiment_dir_name(experiment_number)
    write_experiment_meta(exp_dir, exp_meta)
    return exp_meta


def _add_experiment_worktree(source_root: Path, exp_meta: ExperimentMeta) -> Path:
    wt_path = experiment_worktree_path(source_root, exp_meta)
    wt_path.parent.mkdir(parents=True, exist_ok=True)
    run_git(
        source_root,
        "worktree",
        "add",
        "-b",
        exp_meta.branch_name,
        str(wt_path),
        "HEAD",
    )
    return wt_path


class ExperimentScopedPrepareRunTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _service(self) -> QuestService:
        return QuestService(QuestLock(), self.repo_root)

    def _create_quest(self, svc: QuestService) -> tuple[dict, QuestMeta, Path]:
        ensure_project(self.temp.root, "example")
        out = svc.create_quest(
            str(self.temp.root), "example", "main", "Exp Scoped"
        )
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        meta = quest_fs.read_quest_meta(source_qdir)
        return out, meta, source_qdir

    def test_prepare_run_with_experiment_returns_experiment_worktree(self) -> None:
        svc = self._service()
        _out, meta, source_qdir = self._create_quest(svc)
        exp_meta = _write_experiment(source_qdir, meta)
        _add_experiment_worktree(self.temp.root, exp_meta)
        remove_partial_worktree(self.temp.root, meta)

        root, qdir, key, loaded = svc._prepare_run(
            str(self.temp.root),
            "example",
            "main",
            meta.quest_number,
            experiment_id=exp_meta.experiment_id,
        )
        self.assertEqual(
            root.resolve(),
            experiment_worktree_path(self.temp.root, exp_meta).resolve(),
        )
        self.assertTrue(qdir.is_dir())
        self.assertIn(exp_meta.experiment_id, key)
        self.assertEqual(loaded.experiment_id, exp_meta.experiment_id)

    def test_prepare_run_without_experiment_requires_quest_worktree(self) -> None:
        svc = self._service()
        _out, meta, source_qdir = self._create_quest(svc)
        exp_meta = _write_experiment(source_qdir, meta)
        _add_experiment_worktree(self.temp.root, exp_meta)
        remove_partial_worktree(self.temp.root, meta)

        with self.assertRaises(MissingQuestWorktree) as ctx:
            svc._prepare_run(
                str(self.temp.root),
                "example",
                "main",
                meta.quest_number,
            )
        self.assertIn("--experiment-id", str(ctx.exception))

    def test_prepare_run_rejects_experiment_quest_mismatch(self) -> None:
        svc = self._service()
        _out, meta, source_qdir = self._create_quest(svc)
        exp_meta = _write_experiment(source_qdir, meta)
        exp_meta.project = "wrong-project"
        exp_dir = experiments_root(source_qdir) / experiment_dir_name(0)
        write_experiment_meta(exp_dir, exp_meta)

        with self.assertRaises(InvalidQuestInput):
            svc._prepare_run(
                str(self.temp.root),
                "example",
                "main",
                meta.quest_number,
                experiment_id=exp_meta.experiment_id,
            )


class ExperimentScopedApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _setup_experiment(self) -> tuple[object, QuestService, ExperimentMeta, dict]:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            str(self.temp.root), "example", "main", "API Exp"
        )
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        meta = quest_fs.read_quest_meta(source_qdir)
        exp_meta = _write_experiment(source_qdir, meta)
        _add_experiment_worktree(self.temp.root, exp_meta)
        remove_partial_worktree(self.temp.root, meta)
        return client, svc, exp_meta, out

    def test_run_quest_api_passes_experiment_id(self) -> None:
        client, svc, exp_meta, out = self._setup_experiment()
        with patch.object(svc, "schedule_run_quest", return_value={"run_id": "r1"}) as mock:
            resp = client.post(
                "/run_quest",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": out["quest_number"],
                    "experiment_id": exp_meta.experiment_id,
                },
            )
        self.assertEqual(resp.status_code, 202)
        mock.assert_called_once()
        self.assertEqual(
            mock.call_args.kwargs["experiment_id"],
            exp_meta.experiment_id,
        )

    def test_advance_quest_api_passes_experiment_id(self) -> None:
        client, svc, exp_meta, out = self._setup_experiment()
        with patch.object(
            svc,
            "advance_quest",
            return_value={"status": "completed", "advanced": False},
        ) as mock:
            resp = client.post(
                "/advance_quest",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": out["quest_number"],
                    "experiment_id": exp_meta.experiment_id,
                },
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            mock.call_args.kwargs["experiment_id"],
            exp_meta.experiment_id,
        )

    def test_slices_init_in_experiment_worktree(self) -> None:
        client, _svc, exp_meta, out = self._setup_experiment()
        resp = client.post(
            "/api/slices/init",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "count": 1,
                "slugs": ["exp_slice"],
                "experiment_id": exp_meta.experiment_id,
            },
        )
        self.assertEqual(resp.status_code, 201)
        body = resp.get_json()
        self.assertEqual(body["checkout_kind"], "experiment")
        self.assertEqual(body["experiment_id"], exp_meta.experiment_id)
        slice_dir = Path(body["created_slices"][0]["slice_dir"])
        self.assertIn(
            experiment_worktree_path(self.temp.root, exp_meta).name,
            str(slice_dir),
        )

    def test_issue_create_in_experiment_worktree(self) -> None:
        client, _svc, exp_meta, out = self._setup_experiment()
        resp = client.post(
            "/api/issues",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "scope": "physicalplan",
                "title": "Experiment issue",
                "body": "details",
                "experiment_id": exp_meta.experiment_id,
            },
        )
        self.assertEqual(resp.status_code, 201)
        exp_qdir = (
            experiment_worktree_path(self.temp.root, exp_meta)
            / "projects"
            / "example"
            / "quests"
            / "main"
            / f"{out['quest_number']:04d}_{out['quest_slug']}"
        )
        issues = quest_fs.read_issues(exp_qdir / "physicalplan_issues.md")
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].title, "Experiment issue")

    def test_dashboard_overview_reads_experiment_worktree(self) -> None:
        client, _svc, exp_meta, out = self._setup_experiment()
        resp = client.get(
            "/api/dashboard/quest_overview",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "experiment_id": exp_meta.experiment_id,
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["checkout_kind"], "experiment")
        self.assertEqual(body["experiment_id"], exp_meta.experiment_id)


class ExperimentScopedCliTests(unittest.TestCase):
    def test_run_cli_includes_experiment_id_in_body(self) -> None:
        import io

        from quest_runner_service.cli import RecordedRequest, main

        requests: list[RecordedRequest] = []

        def _fn(method: str, url: str, body: dict | None) -> tuple[int, dict]:
            requests.append(RecordedRequest(method=method, url=url, body=body))
            return 202, {"run_id": "r1", "status": "running"}

        code = main(
            [
                "--base-url",
                "http://test.local",
                "run",
                "--project",
                "example",
                "--type",
                "main",
                "--number",
                "0",
                "--experiment-id",
                "experiment_example_main_0_0",
            ],
            request_fn=_fn,
            stdout=io.StringIO(),
            stderr=io.StringIO(),
        )
        self.assertEqual(code, 0)
        self.assertEqual(len(requests), 1)
        assert requests[0].body is not None
        self.assertEqual(
            requests[0].body["experiment_id"],
            "experiment_example_main_0_0",
        )

    def test_land_cli_rejects_experiment_id(self) -> None:
        from quest_runner_service.cli import main

        err = __import__("io").StringIO()
        code = main(
            [
                "land",
                "--project",
                "example",
                "--type",
                "main",
                "--number",
                "0",
                "--experiment-id",
                "experiment_example_main_0_0",
            ],
            request_fn=MagicMock(),
            stdout=__import__("io").StringIO(),
            stderr=err,
        )
        self.assertEqual(code, 2)
        self.assertIn("experiments land", err.getvalue())


class ExperimentRuntimeContextTests(unittest.TestCase):
    def test_build_runtime_context_includes_experiment_instructions(self) -> None:
        meta = QuestMeta(
            project="example",
            quest_type="main",
            quest_number=0,
            quest_slug="x",
            quest_name="X",
            created_at="2026-01-01T00:00:00Z",
        )
        exp = experiment_id("example", "main", 0, 0)
        text = build_runtime_context(
            role_name="implementer",
            meta=meta,
            quest_dir=Path("/tmp/q"),
            slice_dir=None,
            quest_docs_dir=Path("/tmp/docs"),
            experiment_id=exp,
        )
        self.assertIn(f"Experiment: {exp}", text)
        self.assertIn(f"--experiment-id {exp}", text)
        self.assertIn("original quest worktree may not exist", text)


class DeferredExperimentRunTests(unittest.TestCase):
    def test_deferred_run_preserves_experiment_id(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        svc = QuestService(QuestLock(), repo_root)
        captured: dict = {}
        scheduled: dict = {}

        def _fake_run(**kwargs: object) -> dict:
            captured.update(kwargs)
            return {"status": "completed"}

        def _capture_schedule(**kwargs: object) -> dict:
            scheduled.update(kwargs)
            callback = kwargs["callback"]
            assert callable(callback)
            callback()
            return {"task_id": "t1", "scheduled_for": "2026-01-01T00:00:00Z"}

        with patch.object(svc, "run_quest", side_effect=_fake_run):
            with patch.object(svc.scheduler, "schedule", side_effect=_capture_schedule):
                result = svc._schedule_deferred_quest_run(
                    repo_path=Path("/tmp/repo"),
                    project="example",
                    quest_type="main",
                    quest_number=0,
                    max_steps=1,
                    reason="rate_limit",
                    delay_seconds=0,
                    experiment_id="experiment_example_main_0_0",
                )

        self.assertEqual(
            scheduled["description"]["experiment_id"],
            "experiment_example_main_0_0",
        )
        self.assertEqual(
            captured.get("experiment_id"),
            "experiment_example_main_0_0",
        )
        self.assertEqual(result["status"], "deferred")
