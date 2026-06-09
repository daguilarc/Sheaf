"""Unit tests for workflow configuration loading and validation."""

from __future__ import annotations

import shutil
import tempfile
import textwrap
import unittest
from pathlib import Path

import yaml

from quest_runner_service.workflow_config import (
    WorkflowValidationError,
    load_packaged_default_workflow,
    load_workflow,
)


class PackagedDefaultWorkflowTests(unittest.TestCase):
    def test_load_packaged_default_workflow(self) -> None:
        workflow = load_packaged_default_workflow()
        self.assertEqual(workflow.version, 1)
        self.assertEqual(workflow.name, "default-main-quest")
        self.assertEqual(workflow.entry_machine, "quest")
        self.assertEqual(workflow.special.completed_state, "Completed")
        self.assertEqual(
            workflow.special.human_intervention_file,
            "human_intervention_request.md",
        )
        self.assertEqual(workflow.preamble, "preamble.md")
        self.assertEqual(workflow.variables["quest"], ".")
        self.assertEqual(workflow.variables["specs"], "specs")
        self.assertEqual(workflow.variables["project_docs"], "$project/docs")

    def test_quest_machine_states_and_node_names(self) -> None:
        quest = load_packaged_default_workflow().get_machine("quest")
        expected_states = [
            "PrePlanning",
            "PhysicalPlanning",
            "ReviewPhysicalPlan",
            "PrepareNextSlice",
            "ExecuteSlice",
            "QuestDocumenting",
            "Completed",
        ]
        self.assertEqual(list(quest.states.keys()), expected_states)
        self.assertEqual(quest.initial, "PrePlanning")
        self.assertEqual(quest.terminal, ["Completed"])
        node_names = {
            "PrePlanning": "PrePlanningGateNode",
            "PhysicalPlanning": "PhysicalPlanningNode",
            "ReviewPhysicalPlan": "ReviewPhysicalPlanNode",
            "PrepareNextSlice": "PrepareNextSliceNode",
            "ExecuteSlice": "ExecuteActiveSliceNode",
            "QuestDocumenting": "QuestDocumentingNode",
            "Completed": "CompletedGateNode",
        }
        for state_name, node_name in node_names.items():
            self.assertEqual(quest.states[state_name].node_name, node_name)

    def test_slice_machine_states_persisted_as_and_node_names(self) -> None:
        slice_machine = load_packaged_default_workflow().get_machine("slice")
        expected_states = [
            "SliceSetup",
            "Implementing",
            "PolishingReview",
            "PolishingFix",
            "Completed",
        ]
        self.assertEqual(list(slice_machine.states.keys()), expected_states)
        self.assertEqual(slice_machine.initial, "SliceSetup")
        self.assertEqual(slice_machine.terminal, ["Completed"])
        self.assertEqual(slice_machine.states["SliceSetup"].persisted_as, "NotStarted")
        self.assertEqual(slice_machine.states["Completed"].persisted_as, "Done")
        node_names = {
            "SliceSetup": "SliceSetupNode",
            "Implementing": "SliceImplementingNode",
            "PolishingReview": "SlicePolishingReviewNode",
            "PolishingFix": "SlicePolishingFixNode",
            "Completed": "SliceCompletedNode",
        }
        for state_name, node_name in node_names.items():
            self.assertEqual(slice_machine.states[state_name].node_name, node_name)

    def test_profiles_and_prompt_paths(self) -> None:
        workflow = load_packaged_default_workflow()
        expected_profiles = [
            "physical_planner",
            "physical_plan_reviewer",
            "implementer",
            "polisher_reviewer",
            "polisher",
            "documenter",
        ]
        self.assertEqual(list(workflow.profiles.keys()), expected_profiles)
        implementer = workflow.get_profile("implementer")
        self.assertEqual(implementer.harness, "cursor")
        self.assertEqual(implementer.model, "composer-2.5")
        self.assertEqual(implementer.idle_timeout_seconds, 3600)
        self.assertTrue(implementer.runtime_context.get("include_reference_docs_path"))
        prompt_path = workflow.resolve_profile_prompt_path("implementer")
        self.assertTrue(prompt_path.is_file())
        self.assertEqual(
            implementer.modify_allow,
            [
                "$quest/human_intervention_request.md",
                "$active_child/implementation_done.md",
                "$active_child/notes/**",
            ],
        )
        self.assertEqual(implementer.modify_block, ["$project/quests/**"])
        self.assertEqual(implementer.thread_scope, "child")
        self.assertEqual(
            implementer.thread_name_template,
            "{repo}_quest_{quest_number:04d}_slice_{child_number:04d}_{profile}",
        )
        self.assertEqual(
            implementer.thread_registry_key_template,
            "slice_{child_number}_{profile}",
        )
        planner = workflow.get_profile("physical_planner")
        self.assertEqual(planner.harness, "codex")
        self.assertEqual(planner.thread_scope, "quest")
        self.assertEqual(
            planner.thread_name_template,
            "{repo}_quest_{quest_number:04d}_{profile}",
        )
        self.assertEqual(planner.thread_registry_key_template, "{profile}")

    def test_issue_declarations(self) -> None:
        workflow = load_packaged_default_workflow()
        issues = {issue.alias: issue for issue in workflow.issue_declarations()}
        self.assertEqual(issues["physical_plan"].path, "physicalplan_issues.md")
        self.assertEqual(issues["physical_plan"].owner, "physical_plan_reviewer")
        self.assertEqual(issues["physical_plan"].id_prefix, "QP")
        self.assertEqual(
            issues["polishing"].path,
            "$active_child/polishing_issues.md",
        )
        self.assertEqual(issues["polishing"].owner, "polisher_reviewer")
        self.assertEqual(issues["polishing"].id_prefix, "PL")

    def test_collection_scaffold_byte_content(self) -> None:
        workflow = load_packaged_default_workflow()
        collection = workflow.collections["slices"]
        self.assertEqual(collection.path, "slices/*")
        self.assertEqual(collection.machine, "slice")
        self.assertEqual(collection.order, "lexical")
        self.assertEqual(collection.id_from, "directory_name")
        self.assertEqual(collection.active_var, "active_slice")
        scaffold = collection.scaffold
        self.assertEqual(scaffold[0], {"ensure_dir": "physicalplan"})
        self.assertEqual(
            scaffold[1],
            {
                "ensure_file": {
                    "path": "state.md",
                    "content": "# Slice State\n\nstate: NotStarted\nupdated_at: {now}\n",
                }
            },
        )
        self.assertEqual(
            scaffold[2],
            {
                "ensure_file": {
                    "path": "state_history.md",
                    "content": "# State Transition History\n\n",
                }
            },
        )
        self.assertEqual(
            scaffold[3],
            {
                "ensure_file": {
                    "path": "polishing_issues.md",
                    "content": "# Issues\n",
                }
            },
        )
        self.assertEqual(scaffold[4], {"ensure_dir": "notes"})

    def test_collection_lookup_helpers(self) -> None:
        workflow = load_packaged_default_workflow()
        by_var = workflow.collection_by_active_var("active_slice")
        self.assertIsNotNone(by_var)
        assert by_var is not None
        self.assertEqual(by_var.name, "slices")
        by_path = workflow.collection_by_path_pattern("slices/*")
        self.assertIsNotNone(by_path)
        assert by_path is not None
        self.assertEqual(by_path.name, "slices")
        self.assertIsNone(workflow.collection_by_active_var("missing"))


class WorkflowValidationFailureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.workflow_dir = Path(self.tmp) / "workflow"
        shutil.copytree(
            Path(__file__).resolve().parents[1]
            / "src"
            / "quest_runner_service"
            / "default_workflow",
            self.workflow_dir,
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_workflow(self, updates: dict) -> None:
        path = self.workflow_dir / "workflow.yaml"
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        assert isinstance(raw, dict)
        raw.update(updates)
        path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")

    def test_missing_entry_machine(self) -> None:
        self._write_workflow({"entry_machine": ""})
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("entry_machine", str(ctx.exception))

    def test_machine_name_mismatch(self) -> None:
        quest_path = self.workflow_dir / "machines" / "quest.yaml"
        raw = yaml.safe_load(quest_path.read_text(encoding="utf-8"))
        assert isinstance(raw, dict)
        raw["machine"] = "wrong"
        quest_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("does not match key", str(ctx.exception))

    def test_unknown_transition_target(self) -> None:
        quest_path = self.workflow_dir / "machines" / "quest.yaml"
        raw = yaml.safe_load(quest_path.read_text(encoding="utf-8"))
        assert isinstance(raw, dict)
        raw["states"]["PrePlanning"]["transitions"][0]["to"] = "MissingState"
        quest_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("not a declared state", str(ctx.exception))

    def test_unknown_run_profile(self) -> None:
        quest_path = self.workflow_dir / "machines" / "quest.yaml"
        raw = yaml.safe_load(quest_path.read_text(encoding="utf-8"))
        assert isinstance(raw, dict)
        raw["states"]["PhysicalPlanning"]["run"]["profile"] = "missing_profile"
        quest_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("unknown run.profile", str(ctx.exception))

    def test_unknown_child_collection(self) -> None:
        quest_path = self.workflow_dir / "machines" / "quest.yaml"
        raw = yaml.safe_load(quest_path.read_text(encoding="utf-8"))
        assert isinstance(raw, dict)
        raw["states"]["ExecuteSlice"]["child"]["collection"] = "missing"
        quest_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("unknown child.collection", str(ctx.exception))

    def test_child_result_outside_child_state(self) -> None:
        quest_path = self.workflow_dir / "machines" / "quest.yaml"
        raw = yaml.safe_load(quest_path.read_text(encoding="utf-8"))
        assert isinstance(raw, dict)
        raw["states"]["PhysicalPlanning"]["transitions"].insert(
            0,
            {"if": {"child_result": {"state_after": "Completed"}}, "to": "Completed"},
        )
        quest_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("child_result", str(ctx.exception))

    def test_duplicate_persisted_as(self) -> None:
        slice_path = self.workflow_dir / "machines" / "slice.yaml"
        raw = yaml.safe_load(slice_path.read_text(encoding="utf-8"))
        assert isinstance(raw, dict)
        raw["states"]["Implementing"]["persisted_as"] = "NotStarted"
        slice_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("duplicate persisted_as", str(ctx.exception))

    def test_missing_prompt_file(self) -> None:
        prompt_path = self.workflow_dir / "prompts" / "implementer.md"
        prompt_path.unlink()
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("missing prompt file", str(ctx.exception))

    def test_absolute_path_in_scaffold(self) -> None:
        self._write_workflow(
            {
                "scaffold": [
                    {
                        "ensure_file": {
                            "path": "/tmp/bad.md",
                            "content": "x",
                        }
                    }
                ]
            }
        )
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("quest-relative", str(ctx.exception))

    def test_unknown_collection_machine(self) -> None:
        self._write_workflow(
            {
                "collections": {
                    "slices": {
                        "path": "slices/*",
                        "machine": "missing_machine",
                        "order": "lexical",
                        "id_from": "directory_name",
                        "active_var": "active_slice",
                        "scaffold": [],
                    }
                }
            }
        )
        with self.assertRaises(WorkflowValidationError) as ctx:
            load_workflow(self.workflow_dir)
        self.assertIn("unknown machine", str(ctx.exception))


class MinimalWorkflowFixtureTests(unittest.TestCase):
    def test_load_minimal_valid_workflow_from_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workflow_dir = Path(tmp) / "workflow"
            workflow_dir.mkdir()
            (workflow_dir / "preamble.md").write_text("preamble\n", encoding="utf-8")
            (workflow_dir / "prompts").mkdir()
            (workflow_dir / "prompts" / "worker.md").write_text("prompt\n", encoding="utf-8")
            (workflow_dir / "profiles").mkdir()
            (workflow_dir / "profiles" / "worker.yaml").write_text(
                textwrap.dedent(
                    """\
                    harness: cursor
                    model: composer-2.5
                    reasoning_effort: null
                    idle_timeout_seconds: 60
                    prompt: ../prompts/worker.md
                    runtime_context: {}
                    modify:
                      allow: []
                      block: []
                    thread:
                      scope: quest
                      name_template: "{repo}_{profile}"
                      registry_key_template: "{profile}"
                    """
                ),
                encoding="utf-8",
            )
            (workflow_dir / "machines").mkdir()
            (workflow_dir / "machines" / "main.yaml").write_text(
                textwrap.dedent(
                    """\
                    machine: main
                    initial: Start
                    terminal: [Done]
                    states:
                      Start:
                        run:
                          profile: worker
                          task: do work
                        transitions:
                          - to: Done
                      Done:
                        terminal: true
                    """
                ),
                encoding="utf-8",
            )
            (workflow_dir / "workflow.yaml").write_text(
                textwrap.dedent(
                    """\
                    version: 1
                    name: minimal
                    entry_machine: main
                    special:
                      completed_state: Done
                      human_intervention_file: human_intervention_request.md
                    preamble: preamble.md
                    variables: {}
                    scaffold: []
                    collections: {}
                    issues: {}
                    machines:
                      main: machines/main.yaml
                    profiles:
                      worker: profiles/worker.yaml
                    """
                ),
                encoding="utf-8",
            )
            workflow = load_workflow(workflow_dir)
            self.assertEqual(workflow.entry_machine, "main")
            self.assertEqual(workflow.get_machine("main").initial, "Start")
