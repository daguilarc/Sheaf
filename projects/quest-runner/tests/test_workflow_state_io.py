"""Tests for workflow-aware state I/O and snapshot building."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from quest_runner_service import quest_fs
from quest_runner_service.quest_service import FatalInvariantError
from quest_runner_service.quest_types import (
    QuestMeta,
    QuestState,
    QuestStateInfo,
    RecursiveSnapshot,
    StateMachineState,
    StepCommitMetadata,
)
from quest_runner_service.state_machine.commit_metadata import (
    parse_step_commit_message,
    render_step_commit_message,
    validate_parsed_step_commit,
)
from quest_runner_service.state_machine.workflow_state_io import (
    WorkflowStateIo,
    build_workflow_step_snapshot,
)
from quest_runner_service.workflow_config import load_packaged_default_workflow


def _sample_meta() -> QuestMeta:
    return QuestMeta(
        project="quest-runner",
        quest_type="main",
        quest_number=1,
        quest_slug="demo",
        quest_name="Demo",
        created_at="2026-01-01T00:00:00Z",
    )


def _write_normalized_quest(
    quest_dir: Path,
    *,
    state: str,
    tags: dict[str, str] | None = None,
    global_step: int = 1,
    updated_at: str = "2026-06-09T12:00:00Z",
) -> None:
    rel = quest_dir.name
    sm = StateMachineState(
        machine_name="quest",
        machine_path=rel,
        state=state,
        global_step=global_step,
        tags=tags or {},
        updated_at=updated_at,
    )
    quest_fs.write_normalized_machine_state(quest_dir, sm)


class WorkflowStateIoMappingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workflow = load_packaged_default_workflow()
        self.io_helper = WorkflowStateIo(
            Path("/repo"),
            Path("/repo/quest"),
            _sample_meta(),
            self.workflow,
        )

    def test_logical_and_persisted_round_trip_slice_states(self) -> None:
        cases = [
            ("SliceSetup", "NotStarted"),
            ("Implementing", "Implementing"),
            ("PolishingReview", "PolishingReview"),
            ("PolishingFix", "PolishingFix"),
            ("Completed", "Done"),
        ]
        for logical, persisted in cases:
            self.assertEqual(
                self.io_helper.persisted_state_for_logical("slice", logical),
                persisted,
            )
            self.assertEqual(
                self.io_helper.logical_state_for_persisted("slice", persisted),
                logical,
            )

    def test_experiment_complete_reserved_top_level(self) -> None:
        self.assertEqual(
            self.io_helper.logical_state_for_persisted("quest", "ExperimentComplete"),
            "ExperimentComplete",
        )
        self.assertEqual(
            self.io_helper.persisted_state_for_logical("quest", "ExperimentComplete"),
            "ExperimentComplete",
        )

    def test_unknown_persisted_state_rejected(self) -> None:
        with self.assertRaises(FatalInvariantError):
            self.io_helper.logical_state_for_persisted("slice", "UnknownState")


class WorkflowStateIoReadWriteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.quest_dir = self.repo / "projects" / "quest-runner" / "quests" / "main" / "0001_demo"
        self.quest_dir.mkdir(parents=True)
        self.slice_dir = self.quest_dir / "slices" / "0001_foundation"
        self.slice_dir.mkdir(parents=True)
        self.meta = QuestMeta(
            project="quest-runner",
            quest_type="main",
            quest_number=1,
            quest_slug="demo",
            quest_name="Demo",
            created_at="2026-01-01T00:00:00Z",
        )
        self.workflow = load_packaged_default_workflow()
        self.io = WorkflowStateIo(self.repo, self.quest_dir, self.meta, self.workflow)

    def test_read_normalized_quest_arbitrary_workflow_state(self) -> None:
        _write_normalized_quest(
            self.quest_dir,
            state="PhysicalPlanning",
            tags={
                "quest_type": "main",
                "quest_number": "1",
                "quest_slug": "demo",
            },
        )
        sm = self.io.ReadStateMachineState(self.quest_dir)
        self.assertEqual(sm.state, "PhysicalPlanning")
        self.assertEqual(sm.machine_name, "quest")

    def test_read_experiment_complete(self) -> None:
        _write_normalized_quest(
            self.quest_dir,
            state="ExperimentComplete",
            tags={
                "quest_type": "main",
                "quest_number": "1",
                "quest_slug": "demo",
            },
        )
        sm = self.io.ReadStateMachineState(self.quest_dir)
        self.assertEqual(sm.state, "ExperimentComplete")

    def test_read_write_slice_persisted_states(self) -> None:
        cases = [
            ("SliceSetup", "NotStarted"),
            ("Implementing", "Implementing"),
            ("PolishingReview", "PolishingReview"),
            ("PolishingFix", "PolishingFix"),
            ("Completed", "Done"),
        ]
        for logical, persisted in cases:
            with self.subTest(logical=logical, persisted=persisted):
                quest_fs.write_slice_persisted_state(
                    self.slice_dir,
                    persisted_state=persisted,
                    updated_at="2026-06-09T12:00:00Z",
                )
                sm = self.io.ReadStateMachineState(self.slice_dir)
                self.assertEqual(sm.state, logical)
                self.assertIsNone(sm.global_step)
                self.io.WriteStateMachineState(
                    self.slice_dir,
                    StateMachineState(
                        machine_name=sm.machine_name,
                        machine_path=sm.machine_path,
                        state=logical,
                        global_step=None,
                        tags={},
                        updated_at="2026-06-09T13:00:00Z",
                    ),
                )
                reread, _ = quest_fs.read_slice_persisted_state(self.slice_dir)
                self.assertEqual(reread, persisted)

    def test_write_preserves_quest_identity_tags(self) -> None:
        self.io.WriteStateMachineState(
            self.quest_dir,
            StateMachineState(
                machine_name="quest",
                machine_path=self.quest_dir.relative_to(self.repo).as_posix(),
                state="PrepareNextSlice",
                global_step=3,
                tags={"active_slice": "0001_foundation"},
                updated_at="2026-06-09T12:00:00Z",
            ),
        )
        text = (self.quest_dir / "state.md").read_text(encoding="utf-8")
        self.assertIn("- quest_type: main", text)
        self.assertIn("- quest_number: 1", text)
        self.assertIn("- quest_slug: demo", text)
        self.assertIn("- active_slice: 0001_foundation", text)

    def test_write_clears_active_slice_tag(self) -> None:
        self.io.WriteStateMachineState(
            self.quest_dir,
            StateMachineState(
                machine_name="quest",
                machine_path=self.quest_dir.relative_to(self.repo).as_posix(),
                state="QuestDocumenting",
                global_step=4,
                tags={},
                updated_at="2026-06-09T12:00:00Z",
            ),
        )
        sm = quest_fs.parse_normalized_state_md_text(
            (self.quest_dir / "state.md").read_text(encoding="utf-8"),
            require_global_step=False,
            label="t",
        )
        self.assertNotIn("active_slice", sm.tags)

    def test_machine_name_and_path_for_child(self) -> None:
        quest_fs.write_slice_persisted_state(
            self.slice_dir,
            persisted_state="NotStarted",
            updated_at="2026-06-09T12:00:00Z",
        )
        sm = self.io.ReadStateMachineState(self.slice_dir)
        self.assertEqual(sm.machine_name, "slice_0001_foundation")
        self.assertEqual(
            sm.machine_path,
            "projects/quest-runner/quests/main/0001_demo/slices/0001_foundation",
        )


class WorkflowSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.quest_dir = self.repo / "quests" / "main" / "0000_experiments"
        self.quest_dir.mkdir(parents=True)
        self.slice_dir = self.quest_dir / "slices" / "0001_experiment_foundation"
        self.slice_dir.mkdir(parents=True)
        self.meta = QuestMeta(
            project="quest-runner",
            quest_type="main",
            quest_number=0,
            quest_slug="experiments",
            quest_name="Experiments",
            created_at="2026-01-01T00:00:00Z",
        )
        self.workflow = load_packaged_default_workflow()
        self.io = WorkflowStateIo(self.repo, self.quest_dir, self.meta, self.workflow)

    def test_top_level_snapshot_child_null(self) -> None:
        quest_state = self.workflow.get_machine("quest").states["PhysicalPlanning"]
        snap = build_workflow_step_snapshot(
            workflow_io=self.io,
            machine_key="quest",
            machine_dir=self.quest_dir,
            workflow_state=quest_state,
            state_before="PhysicalPlanning",
            state_after="ReviewPhysicalPlan",
            tags={
                "quest_type": "main",
                "quest_number": "0",
                "quest_slug": "experiments",
            },
            child=None,
        )
        self.assertEqual(snap.machine_name, "quest")
        self.assertEqual(snap.machine_path, "quests/main/0000_experiments")
        self.assertEqual(snap.node_name, "PhysicalPlanningNode")
        self.assertEqual(snap.state_before, "PhysicalPlanning")
        self.assertEqual(snap.state_after, "ReviewPhysicalPlan")
        self.assertIsNone(snap.child)

    def test_execute_slice_snapshot_with_child(self) -> None:
        child_state = self.workflow.get_machine("slice").states["SliceSetup"]
        child_snap = build_workflow_step_snapshot(
            workflow_io=self.io,
            machine_key="slice",
            machine_dir=self.slice_dir,
            workflow_state=child_state,
            state_before="SliceSetup",
            state_after="Implementing",
            tags={},
            child=None,
        )
        quest_state = self.workflow.get_machine("quest").states["ExecuteSlice"]
        snap = build_workflow_step_snapshot(
            workflow_io=self.io,
            machine_key="quest",
            machine_dir=self.quest_dir,
            workflow_state=quest_state,
            state_before="ExecuteSlice",
            state_after="ExecuteSlice",
            tags={"active_slice": "0001_experiment_foundation"},
            child=child_snap,
        )
        self.assertEqual(snap.node_name, "ExecuteActiveSliceNode")
        self.assertIsNotNone(snap.child)
        assert snap.child is not None
        self.assertEqual(snap.child.machine_name, "slice_0001_experiment_foundation")
        self.assertEqual(
            snap.child.machine_path,
            "quests/main/0000_experiments/slices/0001_experiment_foundation",
        )
        self.assertEqual(snap.child.node_name, "SliceSetupNode")
        self.assertEqual(snap.child.state_before, "SliceSetup")
        self.assertEqual(snap.child.state_after, "Implementing")
        self.assertIsNone(snap.child.child)

    def test_default_workflow_snapshot_matches_history_shape(self) -> None:
        expected = {
            "machine_name": "quest",
            "machine_path": "projects/quest-runner/quests/main/0000_experiments",
            "node_name": "ExecuteActiveSliceNode",
            "state_before": "ExecuteSlice",
            "state_after": "ExecuteSlice",
            "tags": {"active_slice": "0001_experiment_foundation"},
            "child": {
                "machine_name": "slice_0001_experiment_foundation",
                "machine_path": (
                    "projects/quest-runner/quests/main/0000_experiments/"
                    "slices/0001_experiment_foundation"
                ),
                "node_name": "SliceSetupNode",
                "state_before": "SliceSetup",
                "state_after": "Implementing",
                "tags": {},
                "child": None,
            },
        }
        repo = Path("/repo")
        quest_dir = repo / "projects/quest-runner/quests/main/0000_experiments"
        slice_dir = quest_dir / "slices/0001_experiment_foundation"
        io = WorkflowStateIo(repo, quest_dir, _sample_meta(), self.workflow)
        child_state = self.workflow.get_machine("slice").states["SliceSetup"]
        child_snap = build_workflow_step_snapshot(
            workflow_io=io,
            machine_key="slice",
            machine_dir=slice_dir,
            workflow_state=child_state,
            state_before="SliceSetup",
            state_after="Implementing",
            tags={},
        )
        quest_state = self.workflow.get_machine("quest").states["ExecuteSlice"]
        snap = build_workflow_step_snapshot(
            workflow_io=io,
            machine_key="quest",
            machine_dir=quest_dir,
            workflow_state=quest_state,
            state_before="ExecuteSlice",
            state_after="ExecuteSlice",
            tags={"active_slice": "0001_experiment_foundation"},
            child=child_snap,
        )

        def to_dict(s: RecursiveSnapshot) -> dict:
            out: dict = {
                "machine_name": s.machine_name,
                "machine_path": s.machine_path,
                "node_name": s.node_name,
                "state_before": s.state_before,
                "state_after": s.state_after,
                "tags": dict(s.tags),
                "child": None if s.child is None else to_dict(s.child),
            }
            return out

        self.assertEqual(to_dict(snap), expected)

    def test_commit_metadata_round_trip_with_workflow_snapshot(self) -> None:
        quest_state = self.workflow.get_machine("quest").states["ExecuteSlice"]
        child_state = self.workflow.get_machine("slice").states["SliceSetup"]
        child_snap = build_workflow_step_snapshot(
            workflow_io=self.io,
            machine_key="slice",
            machine_dir=self.slice_dir,
            workflow_state=child_state,
            state_before="SliceSetup",
            state_after="Implementing",
            tags={},
        )
        snap = build_workflow_step_snapshot(
            workflow_io=self.io,
            machine_key="quest",
            machine_dir=self.quest_dir,
            workflow_state=quest_state,
            state_before="ExecuteSlice",
            state_after="ExecuteSlice",
            tags={"active_slice": "0001_experiment_foundation"},
            child=child_snap,
        )
        meta = StepCommitMetadata(global_step=5, snapshot=snap)
        msg = render_step_commit_message(meta)
        parsed = parse_step_commit_message(msg)
        self.assertIsNotNone(parsed)
        assert parsed is not None
        validate_parsed_step_commit(parsed, repo_root=self.repo)
        payload = json.loads(msg.split("recursive-snapshot-json:\n", 1)[1])
        self.assertEqual(payload["global_step"], 5)
        self.assertEqual(payload["snapshot"]["child"]["node_name"], "SliceSetupNode")


class QuestFsGeneralizedReadTests(unittest.TestCase):
    def test_current_slice_from_active_slice_outside_execute_slice(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            quest_fs.write_normalized_machine_state(
                q,
                StateMachineState(
                    machine_name="quest",
                    machine_path="quest",
                    state="PrepareNextSlice",
                    global_step=2,
                    tags={
                        "active_slice": "0002_other_slice",
                        "quest_type": "main",
                        "quest_number": "1",
                        "quest_slug": "demo",
                    },
                    updated_at="2026-06-09T12:00:00Z",
                ),
            )
            info = quest_fs.read_quest_state(q)
            self.assertEqual(info.state, QuestState.PrepareNextSlice)
            self.assertEqual(info.current_slice, 2)
            self.assertEqual(info.active_slice, "0002_other_slice")

    def test_experiment_complete_normalized_read(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            meta = _sample_meta()
            quest_fs.write_quest_normalized_machine_state(
                q,
                QuestStateInfo(
                    state=QuestState.ExperimentComplete,
                    current_slice=None,
                    updated_at="2026-06-08T00:00:00Z",
                    global_step=7,
                ),
                meta,
                Path(tmp),
            )
            loaded = quest_fs.read_quest_state(q)
            self.assertEqual(loaded.state, QuestState.ExperimentComplete)
            self.assertEqual(loaded.global_step, 7)
