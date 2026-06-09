"""Tests for experiment stop conditions and ExperimentComplete state."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from quest_runner_service import quest_fs
from quest_runner_service.experiments import (
    ExperimentStopCondition,
    complete_experiment_source_metadata,
    experiment_dir_name,
    experiment_worktree_path,
    experiments_root,
    read_experiment_meta,
    snapshot_matches_stop_condition,
    validate_stop_condition,
    write_experiment_meta,
)
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_service import QuestService
from quest_runner_service.quest_types import (
    QuestMeta,
    QuestState,
    QuestStateInfo,
    RecursiveSnapshot,
    SliceState,
    SliceStateInfo,
)
from quest_runner_service.worktrees import remove_partial_worktree, run_git

from .test_experiment_scoped_operations import _add_experiment_worktree
from .test_experiments import _sample_meta
from .test_helpers import TempRepo, ensure_project, make_app_client


def _commit_all(repo: Path, message: str) -> None:
    run_git(repo, "add", "-A")
    run_git(repo, "commit", "-m", message)


class SnapshotStopConditionTests(unittest.TestCase):
    def test_matches_slice_completed_child(self) -> None:
        stop = ExperimentStopCondition(
            machine_path="root/slice",
            node_name="Completed",
        )
        snap = RecursiveSnapshot(
            machine_path="projects/example/quests/main/0000_x",
            machine_name="quest",
            node_name="ExecuteActiveSliceNode",
            state_before="ExecuteSlice",
            state_after="PrepareNextSlice",
            tags={},
            child=RecursiveSnapshot(
                machine_path="projects/example/quests/main/0000_x/slices/0000_a",
                machine_name="slice_0000_a",
                node_name="SliceCompletedNode",
                state_before="PolishingReview",
                state_after="Completed",
                tags={},
                child=None,
            ),
        )
        self.assertTrue(snapshot_matches_stop_condition(snap, stop))

    def test_matches_quest_root_node(self) -> None:
        stop = ExperimentStopCondition(
            machine_path="root/quest",
            node_name="PhysicalPlanning",
        )
        snap = RecursiveSnapshot(
            machine_path="projects/example/quests/main/0000_x",
            machine_name="quest",
            node_name="PhysicalPlanningNode",
            state_before="PrePlanning",
            state_after="PhysicalPlanning",
            tags={},
            child=None,
        )
        self.assertTrue(snapshot_matches_stop_condition(snap, stop))

    def test_matches_concrete_machine_path(self) -> None:
        slice_path = "projects/example/quests/main/0000_x/slices/0001_b"
        stop = ExperimentStopCondition(
            machine_path=slice_path,
            node_name="Completed",
        )
        snap = RecursiveSnapshot(
            machine_path="projects/example/quests/main/0000_x",
            machine_name="quest",
            node_name="ExecuteActiveSliceNode",
            state_before="ExecuteSlice",
            state_after="ExecuteSlice",
            tags={},
            child=RecursiveSnapshot(
                machine_path=slice_path,
                machine_name="slice_0001_b",
                node_name="SliceCompletedNode",
                state_before="PolishingReview",
                state_after="Completed",
                tags={},
                child=None,
            ),
        )
        self.assertTrue(snapshot_matches_stop_condition(snap, stop))

    def test_rejects_wrong_node(self) -> None:
        stop = ExperimentStopCondition(
            machine_path="root/slice",
            node_name="Completed",
        )
        snap = RecursiveSnapshot(
            machine_path="projects/example/quests/main/0000_x",
            machine_name="quest",
            node_name="ExecuteActiveSliceNode",
            state_before="ExecuteSlice",
            state_after="ExecuteSlice",
            tags={},
            child=RecursiveSnapshot(
                machine_path="projects/example/quests/main/0000_x/slices/0000_a",
                machine_name="slice_0000_a",
                node_name="SliceImplementingNode",
                state_before="Implementing",
                state_after="PolishingReview",
                tags={},
                child=None,
            ),
        )
        self.assertFalse(snapshot_matches_stop_condition(snap, stop))


class ExperimentCompleteStateTests(unittest.TestCase):
    def test_legacy_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            original = QuestStateInfo(
                state=QuestState.ExperimentComplete,
                current_slice=None,
                updated_at="2026-06-08T00:00:00Z",
                global_step=12,
            )
            quest_fs.write_quest_state(q, original)
            loaded = quest_fs.read_quest_state(q)
            self.assertEqual(loaded.state, QuestState.ExperimentComplete)
            self.assertEqual(loaded.global_step, 12)

    def test_normalized_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            meta = QuestMeta(
                project="example",
                quest_type="main",
                quest_number=0,
                quest_slug="demo",
                quest_name="Demo",
                created_at="2026-01-01T00:00:00Z",
            )
            repo = Path(tmp)
            quest_fs.write_quest_normalized_machine_state(
                q,
                QuestStateInfo(
                    state=QuestState.ExperimentComplete,
                    current_slice=None,
                    updated_at="2026-06-08T00:00:00Z",
                    global_step=7,
                ),
                meta,
                repo,
            )
            loaded = quest_fs.read_quest_state(q)
            self.assertEqual(loaded.state, QuestState.ExperimentComplete)
            self.assertEqual(loaded.global_step, 7)
            sm = quest_fs.read_normalized_machine_state(q, require_global_step=False)
            self.assertEqual(sm.state, "ExperimentComplete")


class ExperimentAdvanceStopTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _setup_slice_ready_to_complete(
        self,
    ) -> tuple[object, QuestService, dict, Path, Path, str]:
        ensure_project(self.temp.root, "example")
        svc = QuestService(QuestLock(), self.repo_root)
        out = svc.create_quest(
            str(self.temp.root), "example", "main", "Exp Stop"
        )
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        meta = quest_fs.read_quest_meta(source_qdir)
        exp_meta = _sample_meta(
            project="example",
            quest_type="main",
            quest_number=out["quest_number"],
            quest_slug=meta.quest_slug,
            status="open",
        )
        exp_meta.stop_condition = validate_stop_condition(
            None, "slice_completed"
        )
        exp_dir = experiments_root(source_qdir) / experiment_dir_name(0)
        write_experiment_meta(exp_dir, exp_meta)
        _commit_all(self.temp.root, "experiment metadata for stop test")
        _add_experiment_worktree(self.temp.root, exp_meta)
        remove_partial_worktree(self.temp.root, meta)

        wt_path = experiment_worktree_path(self.temp.root, exp_meta)
        wt_qdir = quest_fs.find_quest_dir(
            wt_path, "example", "main", out["quest_number"]
        )
        assert wt_qdir is not None
        sl = wt_qdir / "slices" / "0000_done"
        sl.mkdir(parents=True)
        (sl / "implementation_accepted.md").write_text(
            "# Accepted\n", encoding="utf-8"
        )
        (sl / "polishing_issues.md").write_text("# Issues\n", encoding="utf-8")
        quest_fs.write_slice_state(
            sl,
            SliceStateInfo(
                state=SliceState.PolishingReview,
                updated_at="2026-01-01T00:00:00Z",
            ),
        )
        quest_fs.write_quest_state(
            wt_qdir,
            QuestStateInfo(
                state=QuestState.ExecuteSlice,
                current_slice=0,
                updated_at="2026-01-01T00:00:00Z",
                active_slice="0000_done",
                global_step=5,
            ),
        )
        _commit_all(wt_path, "slice ready to complete")
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        return client, svc, out, wt_qdir, wt_path, exp_meta.experiment_id

    def test_advance_experiment_reaches_stop_condition(self) -> None:
        client, _svc, out, wt_qdir, wt_path, exp_id = (
            self._setup_slice_ready_to_complete()
        )
        resp = client.post(
            "/advance_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "experiment_id": exp_id,
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "experiment_complete")
        self.assertEqual(body["quest_state"], "ExperimentComplete")
        self.assertEqual(
            quest_fs.read_quest_state(wt_qdir).state,
            QuestState.ExperimentComplete,
        )
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        loaded = read_experiment_meta(experiments_root(source_qdir) / "0000")
        self.assertEqual(loaded.status, "experiment_complete")
        self.assertIsNotNone(loaded.completed_at)
        log = subprocess.run(
            ["git", "-C", str(self.temp.root), "log", "-1", "--format=%s"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(
            log.stdout.strip(),
            f"experiment-complete: example/main/{out['quest_number']:04d}/0000",
        )

    def test_run_status_reports_experiment_complete(self) -> None:
        client, _svc, out, wt_qdir, _wt_path, exp_id = (
            self._setup_slice_ready_to_complete()
        )
        client.post(
            "/advance_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "experiment_id": exp_id,
            },
        )
        rs = client.get(
            "/api/dashboard/run_status",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "experiment_id": exp_id,
            },
        )
        self.assertEqual(rs.status_code, 200)
        body = rs.get_json()
        self.assertEqual(body["quest_state"], "ExperimentComplete")
        self.assertEqual(body["experiment_id"], exp_id)


class ExperimentSourceMetadataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_complete_experiment_source_metadata(self) -> None:
        ensure_project(self.temp.root, "example")
        svc = QuestService(QuestLock(), self.repo_root)
        out = svc.create_quest(
            str(self.temp.root), "example", "main", "Meta Complete"
        )
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        meta = quest_fs.read_quest_meta(source_qdir)
        exp_meta = _sample_meta(
            project="example",
            quest_type="main",
            quest_number=out["quest_number"],
            quest_slug=meta.quest_slug,
            status="open",
        )
        exp_dir = experiments_root(source_qdir) / experiment_dir_name(0)
        write_experiment_meta(exp_dir, exp_meta)
        _commit_all(self.temp.root, "seed experiment metadata")
        sha = complete_experiment_source_metadata(
            self.temp.root,
            exp_dir,
            project="example",
            quest_type="main",
            quest_number=out["quest_number"],
            experiment_number=0,
        )
        self.assertTrue(sha)
        loaded = read_experiment_meta(exp_dir)
        self.assertEqual(loaded.status, "experiment_complete")
        self.assertIsNotNone(loaded.completed_at)


if __name__ == "__main__":
    unittest.main()
