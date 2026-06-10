"""Tests for the generic workflow interpreter."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from quest_runner_service import quest_fs
from quest_runner_service.quest_types import QuestMeta, StateMachineState, utc_now_iso
from quest_runner_service.errors import AdvanceValidationError
from quest_runner_service.state_machine.workflow_interpreter import (
    ExecutionMode,
    WorkflowMachineLoader,
)
from quest_runner_service.state_machine.workflow_state_io import WorkflowStateIo
from quest_runner_service.workflow_config import (
    WorkflowCollection,
    WorkflowDefinition,
    WorkflowIssueDeclaration,
    WorkflowMachine,
    WorkflowProfile,
    WorkflowSpecial,
    WorkflowState,
    load_packaged_default_workflow,
)


def _sample_meta() -> QuestMeta:
    return QuestMeta(
        project="quest-runner",
        quest_type="main",
        quest_number=1,
        quest_slug="demo",
        quest_name="Demo",
        created_at="2026-01-01T00:00:00Z",
    )


def _write_quest_file_state(
    repo: Path,
    quest_dir: Path,
    *,
    state: str,
    tags: dict[str, str] | None = None,
) -> None:
    rel = quest_dir.resolve().relative_to(repo.resolve()).as_posix()
    sm = StateMachineState(
        machine_name="quest",
        machine_path=rel,
        state=state,
        global_step=1,
        tags=tags or {},
        updated_at=utc_now_iso(),
    )
    quest_fs.write_normalized_machine_state(quest_dir, sm)


def _scaffold_slice(slice_dir: Path, *, with_plan: bool = True) -> None:
    slice_dir.mkdir(parents=True, exist_ok=True)
    if with_plan:
        pp = slice_dir / "physicalplan"
        pp.mkdir(parents=True, exist_ok=True)
        (pp / "plan.md").write_text("# plan\n", encoding="utf-8")
    quest_fs.write_slice_persisted_state(
        slice_dir,
        persisted_state="NotStarted",
        updated_at=utc_now_iso(),
    )
    (slice_dir / "state_history.md").write_text(
        "# State Transition History\n\n",
        encoding="utf-8",
    )
    (slice_dir / "polishing_issues.md").write_text("# Issues\n", encoding="utf-8")


def _synthetic_workflow(workflow_dir: Path) -> WorkflowDefinition:
    mission_states = {
        "Chooser": WorkflowState(
            name="Chooser",
            node_name="ChooserNode",
            persisted_as=None,
            actions=[
                {
                    "select_child": {
                        "collection": "chapters",
                        "where": {"state_not": "Closed"},
                        "set": "current_chapter",
                        "result": "selected_chapter",
                    }
                }
            ],
            run=None,
            child=None,
            transitions=[
                {
                    "to": "Runner",
                    "if": {"var_exists": "selected_chapter"},
                    "actions": [
                        {
                            "ensure_file": {
                                "path": "$quest/mission.marker",
                                "content": "selected {selected_chapter}\n",
                            }
                        }
                    ],
                }
            ],
            terminal=False,
        ),
        "Runner": WorkflowState(
            name="Runner",
            node_name="RunnerNode",
            persisted_as=None,
            actions=[],
            run=None,
            child={"collection": "chapters", "active": "current_chapter"},
            transitions=[
                {
                    "to": "Wrapped",
                    "if": {"child_result": {"state_after": "Closed"}},
                },
                {"stay": {"reason": "chapter_pending"}},
            ],
            terminal=False,
        ),
        "Wrapped": WorkflowState(
            name="Wrapped",
            node_name="WrappedNode",
            persisted_as="Archived",
            actions=[],
            run=None,
            child=None,
            transitions=[],
            terminal=True,
        ),
    }
    chapter_states = {
        "Drafting": WorkflowState(
            name="Drafting",
            node_name="DraftingNode",
            persisted_as="Fresh",
            actions=[],
            run={"profile": "inventor", "task": "draft with odd names"},
            child=None,
            transitions=[
                {
                    "to": "Closed",
                    "if": {
                        "all": [
                            {"file_exists": "$machine/green.flag"},
                            {"no_open_issues": {"file": "$machine/bespoke_reviews.md"}},
                        ]
                    },
                    "actions": [
                        {
                            "ensure_file": {
                                "path": "$machine/launch.marker",
                                "content": "closed\n",
                            }
                        }
                    ],
                },
                {"stay": {"reason": "awaiting_custom_marker"}},
            ],
            terminal=False,
        ),
        "Closed": WorkflowState(
            name="Closed",
            node_name="ClosedNode",
            persisted_as="Sealed",
            actions=[],
            run=None,
            child=None,
            transitions=[],
            terminal=True,
        ),
    }
    return WorkflowDefinition(
        workflow_dir=workflow_dir,
        version=1,
        name="synthetic-renamed-workflow",
        entry_machine="mission",
        special=WorkflowSpecial(
            completed_state="Wrapped",
            human_intervention_file="ask_human_here.md",
        ),
        preamble=None,
        variables={},
        scaffold=[],
        collections={
            "chapters": WorkflowCollection(
                name="chapters",
                path="chapters/*",
                machine="chapter",
                order="lexical",
                id_from="directory_name",
                active_var="current_chapter",
                scaffold=[],
            )
        },
        issues={
            "reviews": WorkflowIssueDeclaration(
                alias="reviews",
                path="$machine/bespoke_reviews.md",
                owner="custom_reviewer",
                id_prefix="RV",
            )
        },
        machines={
            "mission": WorkflowMachine(
                key="mission",
                source_path=workflow_dir / "mission.yaml",
                machine="mission_machine",
                initial="Chooser",
                terminal=["Wrapped"],
                states=mission_states,
            ),
            "chapter": WorkflowMachine(
                key="chapter",
                source_path=workflow_dir / "chapter.yaml",
                machine="chapter_machine",
                initial="Drafting",
                terminal=["Closed"],
                states=chapter_states,
            ),
        },
        profiles={
            "inventor": WorkflowProfile(
                name="inventor",
                source_path=workflow_dir / "profiles" / "inventor.yaml",
                harness="cursor",
                model="composer-2.5",
                reasoning_effort=None,
                idle_timeout_seconds=60,
                prompt="../prompts/inventor.md",
                runtime_context={},
                modify_allow=[],
                modify_block=[],
                thread_scope="machine",
                thread_name_template="{repo}_{profile}",
                thread_registry_key_template="{profile}",
            )
        },
    )


class WorkflowInterpreterFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.quest_dir = self.repo / "projects" / "quest-runner" / "quests" / "main" / "0001_demo"
        self.quest_dir.mkdir(parents=True)
        (self.quest_dir / "physicalplan_issues.md").write_text("# Issues\n", encoding="utf-8")
        self.meta = _sample_meta()
        self.workflow = load_packaged_default_workflow()
        self.io = WorkflowStateIo(self.repo, self.quest_dir, self.meta, self.workflow)
        self.loader = WorkflowMachineLoader(
            self.repo,
            self.quest_dir,
            self.meta,
            self.workflow,
            self.io,
        )
        (self.quest_dir / "integration_test_issues.md").write_text(
            "# Issues\n",
            encoding="utf-8",
        )

    def _quest_machine(self):
        return self.loader.LoadTopStateMachine(self.quest_dir)

    def _slice_machine(self, slice_name: str):
        return self.loader.LoadStateMachine(self.quest_dir / "slices" / slice_name)


class SyntheticWorkflowGenericityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.quest_dir = (
            self.repo
            / "projects"
            / "synthetic-project"
            / "quests"
            / "side"
            / "0042_renamed"
        )
        self.quest_dir.mkdir(parents=True)
        self.meta = QuestMeta(
            project="synthetic-project",
            quest_type="side",
            quest_number=42,
            quest_slug="renamed",
            quest_name="Renamed",
            created_at="2026-01-01T00:00:00Z",
        )
        self.workflow = _synthetic_workflow(self.repo / "workflow")
        self.io = WorkflowStateIo(self.repo, self.quest_dir, self.meta, self.workflow)
        self.loader = WorkflowMachineLoader(
            self.repo,
            self.quest_dir,
            self.meta,
            self.workflow,
            self.io,
        )

    def _write_mission_state(self, state: str, tags: dict[str, str] | None = None) -> None:
        rel = self.quest_dir.resolve().relative_to(self.repo.resolve()).as_posix()
        quest_fs.write_normalized_machine_state(
            self.quest_dir,
            StateMachineState(
                machine_name="mission_machine",
                machine_path=rel,
                state=state,
                global_step=1,
                tags=tags or {},
                updated_at=utc_now_iso(),
            ),
        )

    def test_interpreter_uses_loaded_workflow_names_for_parent_and_child(self) -> None:
        chapter_dir = self.quest_dir / "chapters" / "chapter-alpha"
        chapter_dir.mkdir(parents=True)
        quest_fs.write_slice_persisted_state(
            chapter_dir,
            persisted_state="Fresh",
            updated_at=utc_now_iso(),
        )
        (chapter_dir / "bespoke_reviews.md").write_text("# Issues\n", encoding="utf-8")
        (chapter_dir / "green.flag").write_text("go\n", encoding="utf-8")
        self._write_mission_state("Chooser")

        top = self.loader.LoadTopStateMachine(self.quest_dir)
        selected = top.RunWorkflowStep(mode=ExecutionMode.Automated)

        self.assertEqual(selected.snapshot.state_before, "Chooser")
        self.assertEqual(selected.snapshot.state_after, "Runner")
        self.assertEqual(selected.snapshot.tags.get("current_chapter"), "chapter-alpha")
        self.assertEqual(
            (self.quest_dir / "mission.marker").read_text(encoding="utf-8"),
            "selected chapter-alpha\n",
        )

        invoked: list[tuple[str, str]] = []

        def callback(profile: str, task: str) -> None:
            invoked.append((profile, task))

        completed = top.RunWorkflowStep(
            mode=ExecutionMode.Automated,
            run_callback=callback,
        )

        self.assertEqual(invoked, [("inventor", "draft with odd names")])
        self.assertEqual(completed.snapshot.state_before, "Runner")
        self.assertEqual(completed.snapshot.state_after, "Wrapped")
        self.assertIsNotNone(completed.snapshot.child)
        assert completed.snapshot.child is not None
        self.assertEqual(completed.snapshot.child.state_before, "Drafting")
        self.assertEqual(completed.snapshot.child.state_after, "Closed")
        self.assertTrue((chapter_dir / "launch.marker").is_file())
        self.assertEqual(self.io.ReadStateMachineState(self.quest_dir).state, "Wrapped")
        self.assertEqual(self.io.ReadStateMachineState(chapter_dir).state, "Closed")
        self.assertIn(
            "state: Archived",
            (self.quest_dir / "state.md").read_text(encoding="utf-8"),
        )


class DefaultQuestTransitionTests(WorkflowInterpreterFixture):
    def test_physical_planning_advances_when_slices_ready(self) -> None:
        _scaffold_slice(self.quest_dir / "slices" / "0001_a")
        _write_quest_file_state(self.repo, self.quest_dir, state="PhysicalPlanning")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_before, "PhysicalPlanning")
        self.assertEqual(result.snapshot.state_after, "ReviewPhysicalPlan")
        self.assertEqual(result.snapshot.node_name, "PhysicalPlanningNode")
        self.assertEqual(result.transition_kind, "to")

    def test_physical_planning_stays_when_slice_plan_incomplete(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        sl.mkdir(parents=True)
        _write_quest_file_state(self.repo, self.quest_dir, state="PhysicalPlanning")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "PhysicalPlanning")
        self.assertEqual(result.transition_kind, "stay")
        self.assertEqual(result.stay_reason, "incomplete_physical_plan")

    def test_review_physical_plan_returns_to_planning_with_open_issues(self) -> None:
        (self.quest_dir / "physicalplan_issues.md").write_text(
            "# Issues\n\n## Issue QP-0001\n\n"
            "- status: open\n- owner_role: physical_plan_reviewer\n"
            "- created_at: t\n- updated_at: t\n- title: x\n"
            "- details: y\n- resolution_notes: none\n",
            encoding="utf-8",
        )
        (self.quest_dir / "physicalplan_accepted.md").write_text("accepted\n", encoding="utf-8")
        _write_quest_file_state(self.repo, self.quest_dir, state="ReviewPhysicalPlan")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "PhysicalPlanning")
        self.assertEqual(result.snapshot.node_name, "ReviewPhysicalPlanNode")
        self.assertFalse((self.quest_dir / "physicalplan_accepted.md").exists())

    def test_review_physical_plan_advances_with_acceptance_and_no_issues(self) -> None:
        (self.quest_dir / "physicalplan_accepted.md").write_text("accepted\n", encoding="utf-8")
        _write_quest_file_state(self.repo, self.quest_dir, state="ReviewPhysicalPlan")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "PrepareNextSlice")
        self.assertEqual(result.snapshot.node_name, "ReviewPhysicalPlanNode")

    def test_prepare_next_slice_selects_first_unfinished_child(self) -> None:
        _scaffold_slice(self.quest_dir / "slices" / "0001_a")
        _write_quest_file_state(self.repo, self.quest_dir, state="PrepareNextSlice")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "ExecuteSlice")
        self.assertEqual(result.snapshot.tags.get("active_slice"), "0001_a")
        self.assertEqual(result.snapshot.node_name, "PrepareNextSliceNode")

    def test_prepare_next_slice_selects_next_after_current_active_child(self) -> None:
        done = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(done)
        quest_fs.write_slice_persisted_state(
            done,
            persisted_state="Done",
            updated_at=utc_now_iso(),
        )
        _scaffold_slice(self.quest_dir / "slices" / "0002_b")
        _write_quest_file_state(
            self.repo,
            self.quest_dir,
            state="PrepareNextSlice",
            tags={"active_slice": "0001_a"},
        )
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "ExecuteSlice")
        self.assertEqual(result.snapshot.tags.get("active_slice"), "0002_b")

    def test_prepare_next_slice_goes_to_integration_testing_when_no_unfinished_children(self) -> None:
        done = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(done)
        quest_fs.write_slice_persisted_state(
            done,
            persisted_state="Done",
            updated_at=utc_now_iso(),
        )
        _write_quest_file_state(
            self.repo,
            self.quest_dir,
            state="PrepareNextSlice",
            tags={"active_slice": "0001_a"},
        )
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "IntegrationTesting")
        self.assertNotIn("active_slice", result.snapshot.tags)

    def test_execute_slice_stays_while_child_not_complete(self) -> None:
        _scaffold_slice(self.quest_dir / "slices" / "0001_a")
        _write_quest_file_state(
            self.repo,
            self.quest_dir,
            state="ExecuteSlice",
            tags={"active_slice": "0001_a"},
        )
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "ExecuteSlice")
        self.assertEqual(result.snapshot.node_name, "ExecuteActiveSliceNode")
        self.assertIsNotNone(result.snapshot.child)
        assert result.snapshot.child is not None
        self.assertEqual(result.snapshot.child.state_before, "SliceSetup")
        self.assertEqual(result.snapshot.child.state_after, "Implementing")

    def test_execute_slice_returns_to_prepare_when_child_completed(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(sl)
        quest_fs.write_slice_persisted_state(
            sl,
            persisted_state="Done",
            updated_at=utc_now_iso(),
        )
        _write_quest_file_state(
            self.repo,
            self.quest_dir,
            state="ExecuteSlice",
            tags={"active_slice": "0001_a"},
        )
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "PrepareNextSlice")
        self.assertIsNotNone(result.snapshot.child)
        assert result.snapshot.child is not None
        self.assertEqual(result.snapshot.child.state_after, "Completed")

    def test_quest_documenting_advances_unconditionally(self) -> None:
        _write_quest_file_state(self.repo, self.quest_dir, state="QuestDocumenting")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "Completed")
        self.assertEqual(result.snapshot.node_name, "QuestDocumentingNode")

    def test_integration_testing_moves_to_polisher_with_open_issues(self) -> None:
        (self.quest_dir / "integration_test_issues.md").write_text(
            "# Issues\n\n## Issue IT-0001\n\n"
            "- status: open\n- owner_role: integration_tester\n"
            "- created_at: t\n- updated_at: t\n- title: x\n"
            "- details: y\n- resolution_notes: none\n",
            encoding="utf-8",
        )
        _write_quest_file_state(self.repo, self.quest_dir, state="IntegrationTesting")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "IntegrationTestPolishing")
        self.assertEqual(result.snapshot.node_name, "IntegrationTestingNode")

    def test_integration_testing_moves_to_documenting_with_no_open_issues(self) -> None:
        _write_quest_file_state(self.repo, self.quest_dir, state="IntegrationTesting")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "QuestDocumenting")
        self.assertEqual(result.snapshot.node_name, "IntegrationTestingNode")

    def test_integration_test_polishing_returns_to_integration_testing(self) -> None:
        _write_quest_file_state(self.repo, self.quest_dir, state="IntegrationTestPolishing")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "IntegrationTesting")
        self.assertEqual(result.snapshot.node_name, "IntegrationTestPolishingNode")


class DefaultSliceTransitionTests(WorkflowInterpreterFixture):
    def test_slice_setup_scaffold_and_advances(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        sl.mkdir(parents=True)
        quest_fs.write_slice_persisted_state(
            sl,
            persisted_state="NotStarted",
            updated_at=utc_now_iso(),
        )
        result = self._slice_machine("0001_a").RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "Implementing")
        self.assertEqual(result.snapshot.node_name, "SliceSetupNode")
        self.assertTrue((sl / "physicalplan").is_dir())
        self.assertTrue((sl / "state.md").is_file())
        self.assertTrue((sl / "state_history.md").is_file())
        self.assertTrue((sl / "polishing_issues.md").is_file())
        self.assertTrue((sl / "notes").is_dir())

    def test_implementing_stays_without_done_marker(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(sl)
        quest_fs.write_slice_persisted_state(
            sl,
            persisted_state="Implementing",
            updated_at=utc_now_iso(),
        )
        result = self._slice_machine("0001_a").RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "Implementing")
        self.assertEqual(result.transition_kind, "stay")
        self.assertEqual(result.stay_reason, "missing_implementation_done")

    def test_implementing_advances_with_done_marker(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(sl)
        quest_fs.write_slice_persisted_state(
            sl,
            persisted_state="Implementing",
            updated_at=utc_now_iso(),
        )
        (sl / "implementation_done.md").write_text("done\n", encoding="utf-8")
        result = self._slice_machine("0001_a").RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "PolishingReview")
        self.assertEqual(result.snapshot.node_name, "SliceImplementingNode")

    def test_polishing_review_moves_to_fix_with_open_issues(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(sl)
        quest_fs.write_slice_persisted_state(
            sl,
            persisted_state="PolishingReview",
            updated_at=utc_now_iso(),
        )
        (sl / "polishing_issues.md").write_text(
            "# Issues\n\n## Issue PL-0001\n\n"
            "- status: open\n- owner_role: polisher_reviewer\n"
            "- created_at: t\n- updated_at: t\n- title: x\n"
            "- details: y\n- resolution_notes: none\n",
            encoding="utf-8",
        )
        (sl / "implementation_accepted.md").write_text("accepted\n", encoding="utf-8")
        result = self._slice_machine("0001_a").RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "PolishingFix")
        self.assertFalse((sl / "implementation_accepted.md").exists())

    def test_polishing_review_completes_with_acceptance_and_no_issues(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(sl)
        quest_fs.write_slice_persisted_state(
            sl,
            persisted_state="PolishingReview",
            updated_at=utc_now_iso(),
        )
        (sl / "implementation_accepted.md").write_text("accepted\n", encoding="utf-8")
        result = self._slice_machine("0001_a").RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "Completed")
        self.assertEqual(result.snapshot.node_name, "SlicePolishingReviewNode")

    def test_polishing_fix_returns_to_review(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(sl)
        quest_fs.write_slice_persisted_state(
            sl,
            persisted_state="PolishingFix",
            updated_at=utc_now_iso(),
        )
        result = self._slice_machine("0001_a").RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "PolishingReview")
        self.assertEqual(result.snapshot.node_name, "SlicePolishingFixNode")


class WorkflowInterpreterModeTests(WorkflowInterpreterFixture):
    def test_manual_implementing_requires_done_marker(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(sl)
        quest_fs.write_slice_persisted_state(
            sl,
            persisted_state="Implementing",
            updated_at=utc_now_iso(),
        )
        with self.assertRaises(AdvanceValidationError) as ctx:
            self._slice_machine("0001_a").RunWorkflowStep(mode=ExecutionMode.Manual)
        self.assertEqual(ctx.exception.reason, "missing_implementation_done")

    def test_manual_pre_planning_advances_to_physical_planning(self) -> None:
        _write_quest_file_state(self.repo, self.quest_dir, state="PrePlanning")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Manual)
        self.assertEqual(result.snapshot.state_after, "PhysicalPlanning")

    def test_automated_pre_planning_stops_with_pre_planning_status(self) -> None:
        _write_quest_file_state(self.repo, self.quest_dir, state="PrePlanning")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.transition_kind, "stop")
        self.assertEqual(result.stop_status, "pre_planning")
        self.assertEqual(result.snapshot.state_after, "PrePlanning")

    def test_run_callback_invoked_in_automated_mode(self) -> None:
        _write_quest_file_state(self.repo, self.quest_dir, state="QuestDocumenting")
        invoked: list[tuple[str, str]] = []

        def callback(profile: str, task: str) -> None:
            invoked.append((profile, task))

        result = self._quest_machine().RunWorkflowStep(
            mode=ExecutionMode.Automated,
            run_callback=callback,
        )
        self.assertTrue(result.run_profile_invoked)
        self.assertEqual(invoked[0][0], "documenter")
        self.assertIn("documentation", invoked[0][1].lower())

    def test_run_callback_skipped_in_manual_mode(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(sl)
        quest_fs.write_slice_persisted_state(
            sl,
            persisted_state="Implementing",
            updated_at=utc_now_iso(),
        )
        (sl / "implementation_done.md").write_text("done\n", encoding="utf-8")
        invoked: list[tuple[str, str]] = []

        def callback(profile: str, task: str) -> None:
            invoked.append((profile, task))

        self._slice_machine("0001_a").RunWorkflowStep(
            mode=ExecutionMode.Manual,
            run_callback=callback,
        )
        self.assertEqual(invoked, [])


class MigratedPredicateCoverageTests(WorkflowInterpreterFixture):
    def test_physical_planning_requires_slice_scaffolding(self) -> None:
        _write_quest_file_state(self.repo, self.quest_dir, state="PhysicalPlanning")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "PhysicalPlanning")

    def test_review_physical_plan_requires_acceptance_marker(self) -> None:
        _write_quest_file_state(self.repo, self.quest_dir, state="ReviewPhysicalPlan")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.state_after, "ReviewPhysicalPlan")
        self.assertEqual(result.stay_reason, "physical_plan_review_incomplete")

    def test_prepare_next_slice_picks_first_unfinished(self) -> None:
        sl = self.quest_dir / "slices" / "0001_a"
        _scaffold_slice(sl)
        _write_quest_file_state(self.repo, self.quest_dir, state="PrepareNextSlice")
        result = self._quest_machine().RunWorkflowStep(mode=ExecutionMode.Automated)
        self.assertEqual(result.snapshot.tags.get("active_slice"), "0001_a")


if __name__ == "__main__":
    unittest.main()
