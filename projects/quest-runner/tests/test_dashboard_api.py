"""Tests for dashboard HTTP APIs and dashboard_data helpers."""

from __future__ import annotations

import subprocess
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from quest_runner_service import quest_fs
from quest_runner_service.dashboard_data import (
    DashboardBadRequest,
    DashboardNotFound,
    build_quest_step_history,
    execution_overlay_status,
    issue_status_counts,
    parse_project,
    projects_payload,
    resolve_dashboard_checkout,
)
from quest_runner_service.worktrees import quest_worktree_path, remove_partial_worktree
from quest_runner_service.dashboard_runs import ActiveRunTracker
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_service import QuestService
from quest_runner_service.quest_types import IssueEntry, RecursiveSnapshot, StepCommitMetadata, TransitionRecord
from quest_runner_service.state_machine.commit_metadata import render_step_commit_message

from .test_helpers import TempRepo, ensure_project, make_app_client, quest_dir_on_checkout


class DashboardValidationTests(unittest.TestCase):
    def test_parse_project_requires_value(self) -> None:
        with self.assertRaises(DashboardBadRequest):
            parse_project(None)

    def test_parse_project_not_found(self) -> None:
        temp = TempRepo(Path(__file__).resolve().parents[1])
        self.addCleanup(temp.cleanup)
        with self.assertRaises(DashboardNotFound):
            parse_project("missing", source_repo_root=temp.root)


class OverlayPrecedenceTests(unittest.TestCase):
    def test_human_intervention_over_pause(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            qdir = Path(tmp)
            (qdir / "human_intervention_request.md").write_text(
                "# Human intervention requested\n", encoding="utf-8"
            )
            (qdir / "paused_until.md").write_text(
                "Paused until 2099-01-01T00:00:00Z\n", encoding="utf-8"
            )
            lock = QuestLock()
            key = "/tmp/repo"
            self.assertTrue(lock.acquire(key, "main", 0, "r1"))
            try:
                st = execution_overlay_status(
                    quest_dir=qdir,
                    lock_key=key,
                    quest_type="main",
                    quest_number=0,
                    lock=lock,
                )
                self.assertEqual(st, "human_intervention")
            finally:
                lock.release(key)


class IssueCountTests(unittest.TestCase):
    def test_open_completed_counts(self) -> None:
        issues = [
            IssueEntry(
                issue_id="a",
                status="open",
                owner_role="r",
                created_at="t",
                updated_at="t",
                title="x",
                details="d",
            ),
            IssueEntry(
                issue_id="b",
                status="completed",
                owner_role="r",
                created_at="t",
                updated_at="t",
                title="y",
                details="d",
            ),
        ]
        c = issue_status_counts(issues)
        self.assertEqual(c["open"], 1)
        self.assertEqual(c["completed"], 1)


class ActiveRunTrackerTests(unittest.TestCase):
    def test_register_unregister(self) -> None:
        t = ActiveRunTracker()
        t.register("run-1", "/repo", "main", 1)
        rec = t.get_for_quest("/repo", "main", 1)
        assert rec is not None
        self.assertEqual(rec.run_id, "run-1")
        t.unregister("run-1")
        self.assertIsNone(t.get_for_quest("/repo", "main", 1))


class DashboardHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_projects_lists_project_local_quests(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(
            str(self.temp.root), "example", "main", "A"
        )
        payload = client.get("/api/dashboard/projects").get_json()
        self.assertEqual(len(payload["projects"]), 1)
        self.assertEqual(payload["projects"][0]["project"], "example")
        self.assertEqual(payload["default_project"], "example")

    def test_projects_omits_empty_project_dirs(self) -> None:
        ensure_project(self.temp.root, "empty")
        ensure_project(self.temp.root, "with-quests")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "with-quests", "main", "Q")
        payload = client.get("/api/dashboard/projects").get_json()
        names = {p["project"] for p in payload["projects"]}
        self.assertIn("with-quests", names)
        self.assertNotIn("empty", names)

    def test_legacy_top_level_quests_excluded_from_snapshot(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "example", "main", "Real")
        legacy = self.temp.root / "quests" / "main" / "0000_legacy"
        legacy.mkdir(parents=True)
        (legacy / "state.md").write_text(
            "# Quest State\n\nstate: PrePlanning\ncurrent_slice: 0\n"
            "updated_at: 2026-01-01T00:00:00Z\n",
            encoding="utf-8",
        )
        snap = client.get(
            "/api/dashboard/project_snapshot",
            query_string={"project": "example"},
        ).get_json()
        slugs = {r["slug"] for r in snap["main"]}
        self.assertIn("real", slugs)
        self.assertNotIn("legacy", slugs)

    def test_project_snapshot_groups(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "example", "main", "A")
        svc.create_quest(str(self.temp.root), "example", "side", "B")
        r = client.get(
            "/api/dashboard/project_snapshot",
            query_string={"project": "example"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["project"], "example")
        self.assertEqual(len(body["main"]), 1)
        self.assertEqual(len(body["side"]), 1)
        self.assertEqual(body["main"][0]["slug"], "a")
        self.assertEqual(body["main"][0]["project"], "example")

    def test_quest_overview_and_run_status(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Ov")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        (qdir / "slices" / "0001_shell_test").mkdir(parents=True)
        ov = client.get(
            "/api/dashboard/quest_overview",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(ov.status_code, 200)
        j = ov.get_json()
        self.assertEqual(j["quest_state"], "PrePlanning")
        self.assertEqual(j["quest"]["project"], "example")
        self.assertEqual(j["project"], "example")
        self.assertEqual(j["quest_type"], "main")
        self.assertEqual(j["quest_number"], 0)
        self.assertEqual(j["checkout_kind"], "worktree")
        self.assertFalse(j["worktree_missing"])
        self.assertIn("checkout_path", j)
        self.assertIn("quest_dir_rel", j)
        self.assertIn("quest_dashboard_url", j)
        self.assertIn("project=example", j["quest_dashboard_url"])
        rs = client.get(
            "/api/dashboard/run_status",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(rs.status_code, 200)
        rs_body = rs.get_json()
        self.assertEqual(rs_body["quest_state"], "PrePlanning")
        self.assertEqual(rs_body["project"], "example")
        self.assertEqual(rs_body["checkout_kind"], "worktree")
        self.assertFalse(rs_body["worktree_missing"])

    def test_missing_query_params_400(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        r = client.get("/api/dashboard/project_snapshot")
        self.assertEqual(r.status_code, 400)

    def test_physicalplan_issues_and_human_intervention(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "PI")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        quest_fs.write_issues(
            qdir / "physicalplan_issues.md",
            [
                IssueEntry(
                    issue_id="QP-0001",
                    status="open",
                    owner_role="physical_plan_reviewer",
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-02T00:00:00Z",
                    title="T",
                    details="D",
                ),
            ],
        )
        pi = client.get(
            "/api/dashboard/physicalplan_issues",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(pi.status_code, 200)
        self.assertEqual(pi.get_json()["open_count"], 1)
        hi = client.get(
            "/api/dashboard/human_intervention",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(hi.status_code, 200)
        self.assertFalse(hi.get_json()["present"])

    def test_malformed_quest_state_422_on_snapshot(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "example", "main", "Bad")
        qdirs = quest_fs.list_quest_dirs(self.temp.root, "example", "main")
        (qdirs[0] / "state.md").write_text("broken\n", encoding="utf-8")
        r = client.get(
            "/api/dashboard/project_snapshot",
            query_string={"project": "example"},
        )
        self.assertEqual(r.status_code, 422)

    def test_schedule_run_quest_shows_running_overlay(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "example", "main", "Slow")

        def slow_locked(*_a, **_k):
            time.sleep(0.3)
            return {
                "status": "pre_planning",
                "steps_executed": 0,
                "last_commit": None,
                "captured_outputs": [],
            }

        with patch.object(svc, "_run_quest_locked", side_effect=slow_locked):
            resp = client.post(
                "/run_quest",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": 0,
                },
            )
            self.assertEqual(resp.status_code, 202)
            rs = client.get(
                "/api/dashboard/run_status",
                query_string={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": "0",
                },
            )
            self.assertEqual(rs.status_code, 200)
            self.assertEqual(rs.get_json()["execution_overlay_status"], "running")
            self.assertIsNotNone(rs.get_json()["active_run"])


class DashboardCheckoutResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_resolve_dashboard_checkout_prefers_worktree(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Wt")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        meta = quest_fs.read_quest_meta(qdir)
        checkout = resolve_dashboard_checkout(self.temp.root, meta)
        self.assertEqual(checkout.checkout_kind, "worktree")
        self.assertFalse(checkout.worktree_missing)
        self.assertEqual(
            Path(checkout.checkout_path),
            quest_worktree_path(self.temp.root, meta).resolve(),
        )

    def test_resolve_dashboard_checkout_source_fallback_when_worktree_missing(
        self,
    ) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Missing")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        meta = quest_fs.read_quest_meta(qdir)
        remove_partial_worktree(self.temp.root, meta)
        checkout = resolve_dashboard_checkout(self.temp.root, meta)
        self.assertEqual(checkout.checkout_kind, "source")
        self.assertTrue(checkout.worktree_missing)
        self.assertEqual(Path(checkout.checkout_path), self.temp.root.resolve())

    def test_resolve_dashboard_checkout_source_fallback_when_worktree_quest_missing(
        self,
    ) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "NoQuest")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        meta = quest_fs.read_quest_meta(qdir)

        real_find_quest_dir = quest_fs.find_quest_dir

        def missing_in_worktree(
            root: Path,
            project: str,
            quest_type: str,
            quest_number: int,
        ) -> Path | None:
            if root.resolve() == quest_worktree_path(self.temp.root, meta).resolve():
                return None
            return real_find_quest_dir(root, project, quest_type, quest_number)

        with patch(
            "quest_runner_service.dashboard_data.quest_fs.find_quest_dir",
            side_effect=missing_in_worktree,
        ):
            checkout = resolve_dashboard_checkout(self.temp.root, meta)

        self.assertEqual(checkout.checkout_kind, "source")
        self.assertTrue(checkout.worktree_missing)
        self.assertEqual(checkout.checkout_root, self.temp.root.resolve())
        self.assertEqual(Path(checkout.checkout_path), self.temp.root.resolve())
        expected_rel = checkout.quest_dir.resolve().relative_to(
            self.temp.root.resolve()
        )
        self.assertEqual(checkout.quest_dir_rel, expected_rel.as_posix())

    def test_git_commits_use_worktree_when_present(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Git")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        meta = quest_fs.read_quest_meta(qdir)
        checkout = resolve_dashboard_checkout(self.temp.root, meta)
        marker = checkout.checkout_root / "worktree-marker.txt"
        marker.write_text("wt\n", encoding="utf-8")
        subprocess.run(
            ["git", "add", "worktree-marker.txt"],
            cwd=str(checkout.checkout_root),
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "worktree-only"],
            cwd=str(checkout.checkout_root),
            check=True,
            capture_output=True,
        )
        r = client.get(
            "/api/dashboard/git_commits",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
                "limit": "5",
                "skip": "0",
            },
        )
        self.assertEqual(r.status_code, 200)
        titles = [c.get("title") or "" for c in r.get_json()["commits"]]
        self.assertIn("worktree-only", titles)

    def test_overview_reports_source_fallback_when_worktree_missing(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "NoWt")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        meta = quest_fs.read_quest_meta(qdir)
        remove_partial_worktree(self.temp.root, meta)
        ov = client.get(
            "/api/dashboard/quest_overview",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
            },
        )
        self.assertEqual(ov.status_code, 200)
        body = ov.get_json()
        self.assertEqual(body["checkout_kind"], "source")
        self.assertTrue(body["worktree_missing"])


class DashboardQuestStepHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_build_quest_step_history_dedupes_legacy_row_sharing_metadata_sha(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Hist")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        qrel = (
            Path(out["quest_dir"])
            .resolve()
            .relative_to(self.temp.root.resolve())
            .as_posix()
        )
        snap = RecursiveSnapshot(
            machine_path=qrel,
            machine_name="quest",
            node_name="n",
            state_before="PrePlanning",
            state_after="PhysicalPlanning",
            tags={},
            child=None,
        )
        msg = render_step_commit_message(
            StepCommitMetadata(global_step=1, snapshot=snap)
        )
        subprocess.run(
            ["git", "add", "-A"],
            cwd=str(self.temp.root),
            check=True,
            capture_output=True,
        )
        from quest_runner_service.dashboard_data import resolve_quest_dirs

        checkout, _qdir = resolve_quest_dirs(
            self.temp.root, "example", "main", out["quest_number"]
        )
        subprocess.run(
            ["git", "commit", "--allow-empty", "-m", msg],
            cwd=str(checkout),
            check=True,
            capture_output=True,
        )
        r = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(checkout),
            capture_output=True,
            text=True,
            check=True,
        )
        meta_sha = r.stdout.strip()
        quest_fs.append_history(
            qdir / "state_history.md",
            TransitionRecord(
                timestamp="2020-01-01T00:00:00Z",
                previous_state="PrePlanning",
                next_state="PhysicalPlanning",
                commit=meta_sha,
                thread_name="runner",
                notes="legacy duplicate of metadata commit",
            ),
        )
        hist = build_quest_step_history(checkout, qdir)
        self.assertEqual(len([h for h in hist if h["source"] == "metadata"]), 1)
        ov = client.get(
            "/api/dashboard/quest_overview",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
            },
        )
        self.assertEqual(ov.status_code, 200)
        j = ov.get_json()
        self.assertIn("step_history", j)
        self.assertGreaterEqual(len(j["step_history"]), 1)


class DashboardExperimentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _setup_open_experiment(
        self,
        *,
        complete: bool = False,
    ) -> tuple[object, QuestService, dict, object, str]:
        from quest_runner_service.experiments import experiment_worktree_path
        from quest_runner_service.quest_types import QuestState, QuestStateInfo
        from quest_runner_service.worktrees import remove_partial_worktree

        from .test_experiment_scoped_operations import _add_experiment_worktree
        from .test_experiments import (
            _git_commit_all,
            _sample_meta,
            _write_experiment_on_quest,
        )

        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Exp Dash")
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        quest_meta = quest_fs.read_quest_meta(source_qdir)
        exp_meta = _write_experiment_on_quest(
            source_qdir,
            quest_meta,
            status="open",
        )
        _git_commit_all(self.temp.root, "experiment metadata")
        _add_experiment_worktree(self.temp.root, exp_meta)
        remove_partial_worktree(self.temp.root, quest_meta)

        if complete:
            wt_path = experiment_worktree_path(self.temp.root, exp_meta)
            wt_qdir = quest_fs.find_quest_dir(
                wt_path, "example", "main", out["quest_number"]
            )
            assert wt_qdir is not None
            quest_fs.write_quest_state(
                wt_qdir,
                QuestStateInfo(
                    state=QuestState.ExperimentComplete,
                    current_slice=None,
                    updated_at="2026-06-08T00:00:00Z",
                    global_step=5,
                ),
            )
            _git_commit_all(wt_path, "experiment complete")

        return client, svc, out, exp_meta, quest_meta

    def test_project_snapshot_includes_open_experiments(self) -> None:
        client, _svc, out, exp_meta, _quest_meta = self._setup_open_experiment()
        snap = client.get(
            "/api/dashboard/project_snapshot",
            query_string={"project": "example"},
        ).get_json()
        self.assertIn("experiments", snap)
        self.assertEqual(len(snap["experiments"]), 1)
        row = snap["experiments"][0]
        self.assertEqual(row["kind"], "experiment")
        self.assertEqual(row["experiment_id"], exp_meta.experiment_id)
        self.assertEqual(row["quest_type"], "main")
        self.assertEqual(row["quest_number"], out["quest_number"])
        self.assertIn("state", row)
        self.assertIn("start_step", row)
        self.assertIn("stop_condition", row)
        self.assertIn("can_land", row)
        self.assertIn("worktree_path", row)
        self.assertIn("branch_name", row)

    def test_open_experiment_can_land_when_complete(self) -> None:
        client, _svc, out, exp_meta, _quest_meta = self._setup_open_experiment(
            complete=True
        )
        snap = client.get(
            "/api/dashboard/project_snapshot",
            query_string={"project": "example"},
        ).get_json()
        row = snap["experiments"][0]
        self.assertTrue(row["can_land"])
        self.assertEqual(row["state"], "ExperimentComplete")

        ov = client.get(
            "/api/dashboard/quest_overview",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
                "experiment_id": exp_meta.experiment_id,
            },
        ).get_json()
        self.assertIn("experiment", ov)
        self.assertTrue(ov["experiment"]["can_land"])
        self.assertEqual(ov["checkout_kind"], "experiment")

    def test_quest_overview_includes_archived_experiments(self) -> None:
        from quest_runner_service.experiments import (
            experiment_dir_name,
            experiments_root,
            update_experiment_status,
            write_experiment_meta,
        )

        from .test_experiments import _sample_meta

        client, _svc, out, _exp_meta, quest_meta = self._setup_open_experiment()
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        landed_meta = _sample_meta(
            project=quest_meta.project,
            quest_type=quest_meta.quest_type,
            quest_number=quest_meta.quest_number,
            quest_slug=quest_meta.quest_slug,
            experiment_number=1,
            status="landed",
        )
        landed_meta.landed_at = "2026-06-08T12:00:00Z"
        landed_meta.remote_branch = "origin/experiment/example/main/0000/0001"
        landed_dir = experiments_root(source_qdir) / experiment_dir_name(1)
        write_experiment_meta(landed_dir, landed_meta)
        (landed_dir / "logs").mkdir(parents=True)
        (landed_dir / "logs" / "step_0001_run.jsonl").write_text(
            "{}\n", encoding="utf-8"
        )
        update_experiment_status(landed_dir, "landed", landed_at=landed_meta.landed_at)

        ov = client.get(
            "/api/dashboard/quest_overview",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
            },
        ).get_json()
        self.assertIn("archived_experiments", ov)
        self.assertEqual(len(ov["archived_experiments"]), 1)
        archived = ov["archived_experiments"][0]
        self.assertEqual(archived["experiment_id"], landed_meta.experiment_id)
        self.assertEqual(archived["status"], "landed")
        self.assertEqual(archived["remote_branch"], landed_meta.remote_branch)

    def test_archived_experiment_detail_payload(self) -> None:
        from quest_runner_service.experiments import (
            experiment_dir_name,
            experiments_root,
            write_experiment_meta,
        )

        from .test_experiments import _sample_meta

        client, _svc, out, _exp_meta, quest_meta = self._setup_open_experiment()
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        landed_meta = _sample_meta(
            project=quest_meta.project,
            quest_type=quest_meta.quest_type,
            quest_number=quest_meta.quest_number,
            quest_slug=quest_meta.quest_slug,
            experiment_number=2,
            status="landed",
        )
        landed_meta.landed_at = "2026-06-09T00:00:00Z"
        landed_meta.remote_branch = "origin/experiment/example/main/0000/0002"
        landed_dir = experiments_root(source_qdir) / experiment_dir_name(2)
        write_experiment_meta(landed_dir, landed_meta)
        logs = landed_dir / "logs"
        logs.mkdir(parents=True)
        (logs / "step_0001_run.jsonl").write_text('{"x":1}\n', encoding="utf-8")
        issues = landed_dir / "issues" / "quest"
        issues.mkdir(parents=True)
        quest_fs.write_issues(
            issues / "physicalplan_issues.md",
            [
                IssueEntry(
                    issue_id="E-1",
                    status="open",
                    owner_role="physical_plan_reviewer",
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-01T00:00:00Z",
                    title="Archived",
                    details="D",
                ),
            ],
        )
        responses = landed_dir / "issue_responses" / "quest"
        responses.mkdir(parents=True)
        (responses / "physicalplan_issue_responses.md").write_text(
            "# Responses\n", encoding="utf-8"
        )

        detail = client.get(
            "/api/dashboard/experiments",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
                "experiment_id": landed_meta.experiment_id,
            },
        ).get_json()
        self.assertEqual(detail["experiment_id"], landed_meta.experiment_id)
        self.assertEqual(detail["status"], "landed")
        self.assertEqual(len(detail["logs"]), 1)
        self.assertEqual(detail["logs"][0]["filename"], "step_0001_run.jsonl")
        self.assertEqual(len(detail["issues"]), 1)
        self.assertEqual(detail["issues"][0]["open_count"], 1)
        self.assertEqual(len(detail["issue_responses"]), 1)
        self.assertEqual(detail["remote_branch"], landed_meta.remote_branch)

    def test_experiment_scoped_git_commits_use_worktree(self) -> None:
        from quest_runner_service.experiments import experiment_worktree_path

        client, _svc, out, exp_meta, _quest_meta = self._setup_open_experiment()
        wt_path = experiment_worktree_path(self.temp.root, exp_meta)
        marker = wt_path / "experiment-marker.txt"
        marker.write_text("exp\n", encoding="utf-8")
        subprocess.run(
            ["git", "add", "experiment-marker.txt"],
            cwd=str(wt_path),
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "experiment-only"],
            cwd=str(wt_path),
            check=True,
            capture_output=True,
        )
        r = client.get(
            "/api/dashboard/git_commits",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
                "experiment_id": exp_meta.experiment_id,
                "limit": "5",
                "skip": "0",
            },
        )
        self.assertEqual(r.status_code, 200)
        titles = [c.get("title") or "" for c in r.get_json()["commits"]]
        self.assertIn("experiment-only", titles)


if __name__ == "__main__":
    unittest.main()
