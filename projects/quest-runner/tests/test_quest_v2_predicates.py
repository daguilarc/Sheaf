"""Tests for shared v2 transition predicates."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from quest_runner_service import quest_fs
from quest_runner_service.quest_runner import build_task_instruction
from quest_runner_service.quest_types import QuestState, QuestStateInfo, SliceState, SliceStateInfo
from quest_runner_service.state_machine.quest_v2_predicates import (
    AdvanceValidationError,
    physical_planning_next_state,
    prepare_next_slice_transition,
    review_physical_plan_next_state,
    slice_implementing_next_state,
    slice_polishing_review_next_state,
)


class QuestV2PredicateTests(unittest.TestCase):
    def test_physical_planning_requires_slice_scaffolding(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            quest_dir = Path(tmp) / "quests" / "main" / "0000_x"
            quest_dir.mkdir(parents=True)
            with self.assertRaises(AdvanceValidationError):
                physical_planning_next_state(quest_dir)

    def test_physical_planning_task_uses_slice_init_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            quest_dir = Path(tmp) / "quests" / "main" / "0000_x"
            quest_dir.mkdir(parents=True)
            instruction = build_task_instruction(
                QuestState.PhysicalPlanning,
                None,
                quest_dir,
                None,
            )
            self.assertIn("scripts/quest-runner slices init", instruction)
            self.assertIn("--slug <slug>", instruction)

    def test_physical_planning_advances_when_slices_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            quest_dir = Path(tmp) / "quests" / "main" / "0000_x"
            sl = quest_dir / "slices" / "0000_a"
            pp = sl / "physicalplan"
            pp.mkdir(parents=True)
            (pp / "plan.md").write_text("# plan\n", encoding="utf-8")
            (sl / "state.md").write_text(
                "# Slice State\n\nstate: NotStarted\nupdated_at: t\n",
                encoding="utf-8",
            )
            (sl / "state_history.md").write_text(
                "# State Transition History\n", encoding="utf-8"
            )
            (sl / "polishing_issues.md").write_text("# Issues\n", encoding="utf-8")
            self.assertEqual(
                physical_planning_next_state(quest_dir), "ReviewPhysicalPlan"
            )

    def test_review_physical_plan_requires_acceptance_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            quest_dir = Path(tmp) / "quests" / "main" / "0000_x"
            quest_dir.mkdir(parents=True)
            (quest_dir / "physicalplan_issues.md").write_text("# Issues\n", encoding="utf-8")
            with self.assertRaises(AdvanceValidationError):
                review_physical_plan_next_state(quest_dir)

    def test_review_physical_plan_returns_to_planning_with_open_issues(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            quest_dir = Path(tmp) / "quests" / "main" / "0000_x"
            quest_dir.mkdir(parents=True)
            (quest_dir / "physicalplan_issues.md").write_text(
                "# Issues\n\n## Issue QP-0001\n\n"
                "- status: open\n- owner_role: physical_plan_reviewer\n"
                "- created_at: t\n- updated_at: t\n- title: x\n"
                "- details: y\n- resolution_notes: none\n",
                encoding="utf-8",
            )
            self.assertEqual(
                review_physical_plan_next_state(quest_dir), "PhysicalPlanning"
            )

    def test_prepare_next_slice_picks_first_unfinished(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            quest_dir = Path(tmp) / "quests" / "main" / "0000_x"
            sl = quest_dir / "slices" / "0001_a"
            sl.mkdir(parents=True)
            quest_fs.write_slice_state(
                sl,
                SliceStateInfo(state=SliceState.NotStarted, updated_at="t"),
            )
            quest_fs.write_quest_state(
                quest_dir,
                QuestStateInfo(
                    state=QuestState.PrepareNextSlice,
                    current_slice=None,
                    updated_at="t",
                ),
            )
            nxt, tags = prepare_next_slice_transition(quest_dir)
            self.assertEqual(nxt, "ExecuteSlice")
            self.assertEqual(tags["active_slice"], "0001_a")

    def test_slice_implementing_requires_done_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sl = Path(tmp) / "slice"
            sl.mkdir()
            with self.assertRaises(AdvanceValidationError):
                slice_implementing_next_state(sl)

    def test_slice_polishing_review_moves_to_fix_with_open_issues(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sl = Path(tmp) / "slice"
            sl.mkdir()
            (sl / "polishing_issues.md").write_text(
                "# Issues\n\n## Issue PL-0001\n\n"
                "- status: open\n- owner_role: polisher_reviewer\n"
                "- created_at: t\n- updated_at: t\n- title: x\n"
                "- details: y\n- resolution_notes: none\n",
                encoding="utf-8",
            )
            self.assertEqual(slice_polishing_review_next_state(sl), "PolishingFix")


if __name__ == "__main__":
    unittest.main()
