"""Tests for workflow profile execution, preamble rendering, and thread identity."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from quest_runner_service.harness_config import read_service_harness_configs
from quest_runner_service.quest_runner import (
    expand_modify_allow_patterns,
    expand_modify_path_patterns,
    runtime_quest_docs_dir,
)
from quest_runner_service.quest_types import HarnessKind, QuestMeta
from quest_runner_service.workflow_config import load_packaged_default_workflow
from quest_runner_service.workflow_profile_execution import (
    ProfileExecutionContext,
    WorkflowTemplateError,
    build_profile_execution_context,
    build_workflow_first_round_message,
    build_workflow_message_body,
    interpolate_template,
    render_preamble,
    render_thread_name,
    render_thread_registry_key,
    workflow_profile_to_execution_profile,
)


def _sample_meta() -> QuestMeta:
    return QuestMeta(
        project="quest-runner",
        quest_type="main",
        quest_number=1,
        quest_slug="state_machine",
        quest_name="State Machine",
        created_at="2026-01-01T00:00:00Z",
    )


def _exec_ctx(
    *,
    profile_name: str,
    repo: Path,
    quest_dir: Path,
    machine_dir: Path | None = None,
    active_child_dir: Path | None = None,
    experiment_id: str | None = None,
) -> ProfileExecutionContext:
    workflow = load_packaged_default_workflow()
    profile = workflow.get_profile(profile_name)
    return build_profile_execution_context(
        repo_path=repo,
        quest_dir=quest_dir,
        machine_dir=machine_dir or quest_dir,
        meta=_sample_meta(),
        workflow=workflow,
        profile=profile,
        profile_name=profile_name,
        quest_docs_dir=runtime_quest_docs_dir(),
        active_child_dir=active_child_dir,
        collection_name="slices" if active_child_dir is not None else None,
        experiment_id=experiment_id,
    )


class DefaultProfileParsingTests(unittest.TestCase):
    def test_default_profiles_match_legacy_harness_settings(self) -> None:
        workflow = load_packaged_default_workflow()
        implementer = workflow.get_profile("implementer")
        ep = workflow_profile_to_execution_profile(implementer)
        self.assertEqual(ep.harness, HarnessKind.Cursor)
        self.assertEqual(ep.model, "composer-2.5")
        self.assertEqual(ep.idle_timeout_seconds, 3600)
        self.assertEqual(ep.config_version, 2)

        planner = workflow.get_profile("physical_planner")
        pep = workflow_profile_to_execution_profile(planner)
        self.assertEqual(pep.harness, HarnessKind.Codex)
        self.assertEqual(pep.model, "gpt-5.5")


class MessageAssemblyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = Path("/tmp/repo")
        self.quest_dir = self.repo / "projects/quest-runner/quests/main/0001_state_machine"
        self.slice_dir = self.quest_dir / "slices/0004_profile_harness_preamble_threads"

    def test_first_round_includes_profile_prompt_separator_preamble_and_task(self) -> None:
        ctx = _exec_ctx(
            profile_name="implementer",
            repo=self.repo,
            quest_dir=self.quest_dir,
            machine_dir=self.slice_dir,
            active_child_dir=self.slice_dir,
        )
        body = build_workflow_message_body(ctx, "Do the work.")
        message = build_workflow_first_round_message(ctx, body)
        self.assertTrue(message.startswith("# Implementer Role"))
        self.assertIn("\n\n---\n\n", message)
        self.assertIn("Quest Runtime Context", message)
        self.assertIn("\n\nTask:\nDo the work.", message)

    def test_later_round_omits_profile_prompt(self) -> None:
        ctx = _exec_ctx(
            profile_name="implementer",
            repo=self.repo,
            quest_dir=self.quest_dir,
            machine_dir=self.slice_dir,
            active_child_dir=self.slice_dir,
        )
        body = build_workflow_message_body(ctx, "Continue.")
        self.assertNotIn("# Implementer Role", body)
        self.assertIn("Quest Runtime Context", body)
        self.assertIn("\n\nTask:\nContinue.", body)


class PreambleRenderingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = Path("/tmp/repo")
        self.quest_dir = self.repo / "projects/quest-runner/quests/main/0001_state_machine"
        self.slice_dir = self.quest_dir / "slices/0004_profile_harness_preamble_threads"

    def test_default_preamble_uses_file_not_scope(self) -> None:
        ctx = _exec_ctx(
            profile_name="implementer",
            repo=self.repo,
            quest_dir=self.quest_dir,
            active_child_dir=self.slice_dir,
        )
        preamble = render_preamble(ctx)
        self.assertIn("--file physicalplan_issues.md", preamble)
        self.assertIn("polishing_issues.md", preamble)
        self.assertIn("integration_test_issues.md", preamble)
        self.assertIn(str(self.slice_dir.relative_to(self.repo)), preamble)
        self.assertNotIn("--scope physicalplan", preamble)
        self.assertNotIn("--scope polishing", preamble)

    def test_experiment_guidance_renders_from_workflow_preamble(self) -> None:
        ctx = _exec_ctx(
            profile_name="implementer",
            repo=self.repo,
            quest_dir=self.quest_dir,
            active_child_dir=self.slice_dir,
            experiment_id="experiment_quest_runner_main_1_0",
        )
        body = build_workflow_message_body(ctx, "Do the work.")
        self.assertIn("Experiment: experiment_quest_runner_main_1_0", body)
        self.assertIn(
            "--experiment-id experiment_quest_runner_main_1_0",
            body,
        )
        self.assertIn("original quest worktree may not exist", body)

    def test_reference_docs_only_when_enabled(self) -> None:
        ctx = _exec_ctx(
            profile_name="implementer",
            repo=self.repo,
            quest_dir=self.quest_dir,
            active_child_dir=self.slice_dir,
        )
        rendered = interpolate_template("$reference_docs", ctx)
        self.assertEqual(rendered, str(runtime_quest_docs_dir().resolve()))

        workflow = load_packaged_default_workflow()
        profile = workflow.get_profile("implementer")
        bare_profile = type(profile)(
            name=profile.name,
            source_path=profile.source_path,
            harness=profile.harness,
            model=profile.model,
            reasoning_effort=profile.reasoning_effort,
            idle_timeout_seconds=profile.idle_timeout_seconds,
            prompt=profile.prompt,
            runtime_context={},
            modify_allow=profile.modify_allow,
            modify_block=profile.modify_block,
            thread_scope=profile.thread_scope,
            thread_name_template=profile.thread_name_template,
            thread_registry_key_template=profile.thread_registry_key_template,
        )
        bare_ctx = build_profile_execution_context(
            repo_path=self.repo,
            quest_dir=self.quest_dir,
            machine_dir=self.quest_dir,
            meta=_sample_meta(),
            workflow=workflow,
            profile=bare_profile,
            profile_name="implementer",
            quest_docs_dir=runtime_quest_docs_dir(),
        )
        with self.assertRaises(WorkflowTemplateError):
            interpolate_template("$reference_docs", bare_ctx)

    def test_unknown_template_variable_fails(self) -> None:
        ctx = _exec_ctx(
            profile_name="implementer",
            repo=self.repo,
            quest_dir=self.quest_dir,
            active_child_dir=self.slice_dir,
        )
        with self.assertRaises(WorkflowTemplateError):
            interpolate_template("{unknown_var}", ctx)


class ThreadIdentityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = Path("/data/.quest-worktrees/quest-runner_main_0001_state_machine")
        self.quest_dir = (
            self.repo / "projects/quest-runner/quests/main/0001_state_machine"
        )
        self.slice_dir = self.quest_dir / "slices/0004_profile_harness_preamble_threads"

    def test_quest_scoped_thread_name_and_key(self) -> None:
        ctx = _exec_ctx(
            profile_name="physical_planner",
            repo=self.repo,
            quest_dir=self.quest_dir,
        )
        self.assertEqual(
            render_thread_name(ctx),
            "quest-runner_main_0001_state_machine_quest_0001_physical_planner",
        )
        self.assertEqual(render_thread_registry_key(ctx), "physical_planner")

    def test_child_scoped_thread_name_and_key(self) -> None:
        ctx = _exec_ctx(
            profile_name="implementer",
            repo=self.repo,
            quest_dir=self.quest_dir,
            machine_dir=self.slice_dir,
            active_child_dir=self.slice_dir,
        )
        self.assertEqual(
            render_thread_name(ctx),
            "quest-runner_main_0001_state_machine_quest_0001_slice_0004_implementer",
        )
        self.assertEqual(render_thread_registry_key(ctx), "slice_4_implementer")


class ModifyPathInterpolationTests(unittest.TestCase):
    def test_workflow_path_variables_expand(self) -> None:
        qrel = "projects/example/quests/main/0000_x"
        child_rel = f"{qrel}/slices/0001_slice"
        patterns = [
            "$quest/human_intervention_request.md",
            "$active_child/implementation_done.md",
            "$project/quests/**",
        ]
        expanded = expand_modify_path_patterns(
            patterns, qrel, child_rel, "projects/example"
        )
        self.assertEqual(
            expanded,
            [
                f"{qrel}/human_intervention_request.md",
                f"{child_rel}/implementation_done.md",
                "projects/example/quests/**",
            ],
        )
        self.assertEqual(
            expand_modify_allow_patterns(
                patterns, qrel, child_rel, "projects/example"
            ),
            expanded,
        )


class HarnessConfigTests(unittest.TestCase):
    def test_service_harness_config_loads_from_fixture_repo_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cfg = root / "config"
            cfg.mkdir()
            (cfg / "quest-runner.json").write_text(
                json.dumps(
                    {
                        "harnesses": {
                            "claude_code": {"cli_path": "/opt/bin/claude"},
                            "cursor": {"cli_path": "/opt/bin/cursor-agent"},
                            "codex": {},
                        }
                    }
                ),
                encoding="utf-8",
            )
            harnesses = read_service_harness_configs(root)
        self.assertIn("cursor", harnesses)
        self.assertIn("claude_code", harnesses)
        self.assertEqual(
            harnesses["cursor"]["cli_path"],
            "/opt/bin/cursor-agent",
        )

    def test_missing_service_config_returns_empty_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(read_service_harness_configs(Path(tmp)), {})

    def test_invalid_service_config_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            cfg = repo / "config"
            cfg.mkdir()
            (cfg / "quest-runner.json").write_text(
                json.dumps({"harnesses": {"bad_kind": {}}}),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                read_service_harness_configs(repo)
