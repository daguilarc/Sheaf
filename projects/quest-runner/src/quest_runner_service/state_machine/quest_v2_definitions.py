"""Machine definitions and loader for the canonical recursive quest runner."""

from __future__ import annotations

from pathlib import Path

from .machine import ConcreteStateMachine
from .protocols import StateMachineDefinition
from .quest_v2_nodes import (
    CompletedGateNode,
    ExecuteActiveSliceNode,
    PhysicalPlanningNode,
    PrepareNextSliceNode,
    PrePlanningGateNode,
    QuestDocumentingNode,
    ReviewPhysicalPlanNode,
    SliceCompletedNode,
    SliceImplementingNode,
    SlicePolishingFixNode,
    SlicePolishingReviewNode,
    SliceSetupNode,
)


def build_quest_machine_definition() -> StateMachineDefinition:
    return StateMachineDefinition(
        machine_name="quest",
        node_map={
            "PrePlanning": PrePlanningGateNode,
            "PhysicalPlanning": PhysicalPlanningNode,
            "ReviewPhysicalPlan": ReviewPhysicalPlanNode,
            "PrepareNextSlice": PrepareNextSliceNode,
            "ExecuteSlice": ExecuteActiveSliceNode,
            "QuestDocumenting": QuestDocumentingNode,
            "Completed": CompletedGateNode,
        },
        terminal_states=("Completed",),
    )


def build_slice_machine_definition() -> StateMachineDefinition:
    return StateMachineDefinition(
        machine_name="slice",
        node_map={
            "SliceSetup": SliceSetupNode,
            "Implementing": SliceImplementingNode,
            "PolishingReview": SlicePolishingReviewNode,
            "PolishingFix": SlicePolishingFixNode,
            "Completed": SliceCompletedNode,
        },
        terminal_states=("Completed",),
    )


class QuestV2MachineLoader:
    def __init__(self, io: object) -> None:
        self.io = io
        self._quest_def = build_quest_machine_definition()
        self._slice_def = build_slice_machine_definition()

    def LoadStateMachine(self, state_machine_dir: Path) -> ConcreteStateMachine:
        p = state_machine_dir.resolve()
        qd = self.io.quest_dir.resolve()
        if p == qd:
            return ConcreteStateMachine(p, self._quest_def, self.io)
        return ConcreteStateMachine(p, self._slice_def, self.io)

    def LoadTopStateMachine(self, machine_root_dir: Path) -> ConcreteStateMachine:
        return self.LoadStateMachine(machine_root_dir)
