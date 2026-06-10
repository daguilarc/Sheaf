"""Tests for quest workflow upgrade and workflow-based quest creation."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

from quest_runner_service import quest_fs
from quest_runner_service.harness_config import read_service_harness_configs
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_service import (
    InvalidQuestInput,
    MissingQuestWorktree,
    QuestService,
)
from quest_runner_service.quest_types import (
    QuestMeta,
    QuestFileState,
    SliceFileState,
    utc_now_iso,
)
from quest_runner_service.worktrees import create_quest_scaffold_commit, create_quest_worktree
from quest_runner_service.workflow_config import WorkflowDefinition, WorkflowSpecial
from quest_runner_service.workflow_scaffold import resolve_workflow_collection
from quest_runner_service.workflow_upgrade import (
    QuestNotUpgradeable,
    quest_needs_workflow_upgrade,
    upgrade_quest_workflow,
)


def _git_init(path: Path) -> None:
    subprocess.run(["git", "init"], cwd=str(path), check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=str(path),
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=str(path),
        check=True,
        capture_output=True,
    )


def _ensure_project(root: Path, project: str) -> None:
    (root / "projects" / project).mkdir(parents=True)


def _cleanup_worktrees(source_root: Path) -> None:
    base = source_root.resolve().parent / ".quest-worktrees"
    if base.is_dir():
        shutil.rmtree(base, ignore_errors=True)


_LEGACY_CONFIG = """\
version: 2
profiles:
  implementer:
    harness: cursor
    model: custom-model
    reasoning_effort: high
    idle_timeout_seconds: 120
    modify_allow:
      - "$currentQuest/human_intervention_request.md"
      - "$currentSlice/notes/**"
    modify_block:
      - "$currentProject/quests/**"
harnesses:
  cursor:
    cli_path: /custom/cursor
"""


class WorkflowQuestCreationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self._active_roots: list[Path] = []

    def tearDown(self) -> None:
        for root in self._active_roots:
            _cleanup_worktrees(root)

    def _service(self) -> QuestService:
        return QuestService(QuestLock(), self.repo_root)

    def _track_root(self, root: Path) -> Path:
        self._active_roots.append(root)
        return root

    def _checkout_qdir(self, out: dict) -> Path:
        qdir = quest_fs.find_quest_dir(
            Path(out["worktree_path"]),
            out["project"],
            out["quest_type"],
            out["quest_number"],
        )
        assert qdir is not None
        return qdir

    def _replace_workflow_collections(self, qdir: Path, collections: dict) -> None:
        workflow_path = qdir / "workflow" / "workflow.yaml"
        raw = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
        raw["collections"] = collections
        workflow_path.write_text(
            yaml.safe_dump(raw, sort_keys=False),
            encoding="utf-8",
        )

    def _workflow_collections(self, qdir: Path) -> dict:
        workflow_path = qdir / "workflow" / "workflow.yaml"
        raw = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
        return raw["collections"]

    def test_create_quest_scaffolds_workflow_not_legacy_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            out = self._service().create_quest(
                repo_path=str(root),
                project="example",
                quest_type="main",
                name="Workflow Quest",
            )
            qdir = Path(out["quest_dir"])
            self.assertTrue((qdir / "workflow" / "workflow.yaml").is_file())
            self.assertFalse((qdir / "state_execution_config.yaml").is_file())
            self.assertIn("workflow/workflow.yaml", out["created_files"])
            self.assertNotIn("state_execution_config.yaml", out["created_files"])
            self.assertEqual(
                (qdir / "physicalplan_issues.md").read_text(encoding="utf-8"),
                "# Issues\n",
            )
            text = (qdir / "state.md").read_text(encoding="utf-8")
            self.assertTrue(text.startswith("# State\n"))
            self.assertIn("state: PrePlanning\n", text)
            self.assertIn("global_step: 0\n", text)
            self.assertIn("machine_name: quest\n", text)
            st = quest_fs.read_quest_file_state(qdir)
            self.assertEqual(st.state, "PrePlanning")
            self.assertEqual(st.global_step, 0)

    def test_initialize_slices_uses_workflow_scaffold(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            svc = self._service()
            out = svc.create_quest(str(root), "example", "main", "Slice Scaffold")
            result = svc.initialize_slices(
                repo_path=str(root),
                project="example",
                quest_type="main",
                quest_number=out["quest_number"],
                count=1,
                slugs=["alpha"],
            )
            self.assertEqual(result["collection"], "slices")
            created = result["created_slices"][0]
            self.assertEqual(
                created["created_files"],
                [
                    "physicalplan",
                    "state.md",
                    "state_history.md",
                    "polishing_issues.md",
                    "notes",
                ],
            )
            slice_dir = Path(created["slice_dir"])
            self.assertEqual(
                (slice_dir / "state_history.md").read_text(encoding="utf-8"),
                "# State Transition History\n\n",
            )
            self.assertTrue((slice_dir / "notes").is_dir())

    def test_initialize_slices_uses_explicit_collection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            svc = self._service()
            out = svc.create_quest(str(root), "example", "main", "Explicit Collection")
            qdir = self._checkout_qdir(out)
            collections = self._workflow_collections(qdir)
            collections["chapters"] = {
                "path": "chapters/*",
                "machine": "slice",
                "order": "lexical",
                "id_from": "directory_name",
                "active_var": "active_chapter",
                "scaffold": [
                    {"ensure_dir": "drafts"},
                    {"ensure_file": {"path": "summary.md", "content": "# Summary\n"}},
                ],
            }
            self._replace_workflow_collections(qdir, collections)

            result = svc.initialize_slices(
                repo_path=str(root),
                project="example",
                quest_type="main",
                quest_number=out["quest_number"],
                count=1,
                slugs=["chapter one"],
                collection="chapters",
            )

            self.assertEqual(result["collection"], "chapters")
            created = result["created_slices"][0]
            self.assertEqual(created["directory_name"], "0001_chapter_one")
            self.assertEqual(created["created_files"], ["drafts", "summary.md"])
            child_dir = Path(created["slice_dir"])
            self.assertEqual(child_dir.parent.name, "chapters")
            self.assertTrue((child_dir / "drafts").is_dir())
            self.assertEqual(
                (child_dir / "summary.md").read_text(encoding="utf-8"),
                "# Summary\n",
            )

    def test_initialize_slices_rejects_unknown_collection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            svc = self._service()
            out = svc.create_quest(str(root), "example", "main", "Unknown Collection")

            with self.assertRaises(InvalidQuestInput) as ctx:
                svc.initialize_slices(
                    repo_path=str(root),
                    project="example",
                    quest_type="main",
                    quest_number=out["quest_number"],
                    count=1,
                    slugs=["alpha"],
                    collection="missing",
                )

            self.assertIn("Unknown workflow collection 'missing'", str(ctx.exception))

    def test_initialize_slices_requires_collection_when_workflow_has_many(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            svc = self._service()
            out = svc.create_quest(str(root), "example", "main", "Many Collections")
            qdir = self._checkout_qdir(out)
            collections = self._workflow_collections(qdir)
            collections["chapters"] = {
                "path": "chapters/*",
                "machine": "slice",
                "order": "lexical",
                "id_from": "directory_name",
                "active_var": "active_chapter",
                "scaffold": [],
            }
            self._replace_workflow_collections(qdir, collections)

            with self.assertRaises(InvalidQuestInput) as ctx:
                svc.initialize_slices(
                    repo_path=str(root),
                    project="example",
                    quest_type="main",
                    quest_number=out["quest_number"],
                    count=1,
                    slugs=["alpha"],
                )

            message = str(ctx.exception)
            self.assertIn("workflow declares multiple collections", message)
            self.assertIn("pass --collection", message)
            self.assertIn("slices", message)
            self.assertIn("chapters", message)

    def test_resolve_workflow_collection_rejects_empty_collections(self) -> None:
        workflow = WorkflowDefinition(
            workflow_dir=Path("workflow"),
            version=1,
            name="empty",
            entry_machine="quest",
            special=WorkflowSpecial(
                completed_state="Completed",
                human_intervention_file="human_intervention_request.md",
            ),
            preamble=None,
            variables={},
            scaffold=[],
            collections={},
            issues={},
            machines={},
            profiles={},
        )

        with self.assertRaises(ValueError) as ctx:
            resolve_workflow_collection(workflow, None)

        self.assertIn("workflow declares no collections", str(ctx.exception))


class WorkflowUpgradeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self._active_roots: list[Path] = []

    def tearDown(self) -> None:
        for root in self._active_roots:
            _cleanup_worktrees(root)

    def _track_root(self, root: Path) -> Path:
        self._active_roots.append(root)
        return root

    def _legacy_quest(self, root: Path) -> Path:
        qdir = root / "projects" / "example" / "quests" / "main" / "0000_legacy"
        qdir.mkdir(parents=True)
        now = utc_now_iso()
        quest_fs.write_quest_file_state(
            qdir,
            QuestFileState(
                state="ExecuteSlice",
                current_slice=1,
                updated_at=now,
                active_slice="0001_alpha",
                global_step=3,
            ),
        )
        (qdir / "state_history.md").write_text(
            "# State Transition History\n\n",
            encoding="utf-8",
        )
        quest_fs.write_quest_meta(
            qdir,
            QuestMeta(
                project="example",
                quest_type="main",
                quest_number=0,
                quest_slug="legacy",
                quest_name="Legacy",
                created_at=now,
            ),
        )
        quest_fs.write_thread_registry(qdir, {"slice_1_implementer": "thread-1"})
        (qdir / "physicalplan_issues.md").write_text("# Issues\n", encoding="utf-8")
        (qdir / "state_execution_config.yaml").write_text(
            _LEGACY_CONFIG,
            encoding="utf-8",
        )
        (qdir / "slices" / "0001_alpha" / "state.md").parent.mkdir(parents=True)
        quest_fs.write_slice_file_state(
            qdir / "slices" / "0001_alpha",
            SliceFileState(
                state="Implementing",
                updated_at=now,
            ),
        )
        return qdir

    def test_basic_upgrade_replaces_legacy_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            qdir = self._legacy_quest(root)
            self.assertTrue(quest_needs_workflow_upgrade(qdir))
            result = upgrade_quest_workflow(root, qdir)
            self.assertEqual(result["status"], "upgraded")
            self.assertFalse((qdir / "state_execution_config.yaml").exists())
            self.assertTrue((qdir / "workflow" / "workflow.yaml").is_file())
            self.assertEqual(result["deleted_config"], "state_execution_config.yaml")

    def test_profile_customizations_are_ported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            qdir = self._legacy_quest(root)
            upgrade_quest_workflow(root, qdir)
            profile_path = qdir / "workflow" / "profiles" / "implementer.yaml"
            profile = yaml.safe_load(profile_path.read_text(encoding="utf-8"))
            self.assertEqual(profile["model"], "custom-model")
            self.assertEqual(profile["reasoning_effort"], "high")
            self.assertEqual(profile["idle_timeout_seconds"], 120)
            self.assertEqual(
                profile["modify"]["allow"],
                [
                    "$quest/human_intervention_request.md",
                    "$active_child/notes/**",
                ],
            )
            self.assertEqual(profile["modify"]["block"], ["$project/quests/**"])

    def test_harness_config_merges_to_service_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            qdir = self._legacy_quest(root)
            result = upgrade_quest_workflow(root, qdir)
            self.assertIn("cursor", result["merged_harnesses"])
            harnesses = read_service_harness_configs(root)
            self.assertEqual(harnesses["cursor"]["cli_path"], "/custom/cursor")

    def test_harness_merge_skips_existing_service_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            (root / "config").mkdir()
            (root / "config" / "quest-runner.json").write_text(
                json.dumps({"harnesses": {"cursor": {"cli_path": "/existing"}}}),
                encoding="utf-8",
            )
            qdir = self._legacy_quest(root)
            result = upgrade_quest_workflow(root, qdir)
            self.assertEqual(result["skipped_harnesses"], ["cursor"])
            harnesses = read_service_harness_configs(root)
            self.assertEqual(harnesses["cursor"]["cli_path"], "/existing")

    def test_pre_normalized_state_is_rewritten(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            qdir = self._legacy_quest(root)
            result = upgrade_quest_workflow(root, qdir)
            self.assertTrue(result["normalized_state_rewrite"])
            text = (qdir / "state.md").read_text(encoding="utf-8")
            self.assertTrue(text.startswith("# State\n"))
            self.assertIn("state: ExecuteSlice\n", text)
            self.assertIn("active_slice: 0001_alpha\n", text)
            self.assertIn("global_step: 3\n", text)
            st = quest_fs.read_quest_file_state(qdir)
            self.assertEqual(st.state, "ExecuteSlice")
            self.assertEqual(st.active_slice, "0001_alpha")

    def test_legacy_top_level_quest_is_not_upgraded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            qdir = root / "quests" / "main" / "0000_top_level"
            qdir.mkdir(parents=True)
            (qdir / "state_execution_config.yaml").write_text(
                _LEGACY_CONFIG,
                encoding="utf-8",
            )
            with self.assertRaises(QuestNotUpgradeable):
                upgrade_quest_workflow(root, qdir)
            self.assertTrue((qdir / "state_execution_config.yaml").is_file())

    def _bootstrap_legacy_worktree(self, root: Path, qdir: Path) -> None:
        meta = quest_fs.read_quest_meta(qdir)
        create_quest_scaffold_commit(
            root,
            qdir,
            project=meta.project,
            quest_type=meta.quest_type,
            quest_number=meta.quest_number,
            quest_slug=meta.quest_slug,
        )
        create_quest_worktree(root, meta)

    def test_prepare_run_upgrades_legacy_quest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            qdir = self._legacy_quest(root)
            self._bootstrap_legacy_worktree(root, qdir)
            svc = QuestService(QuestLock(), self.repo_root)
            svc._prepare_run(str(root), "example", "main", 0)
            self.assertFalse(quest_needs_workflow_upgrade(qdir))

    def test_explicit_service_upgrade(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._track_root(Path(tmp))
            _git_init(root)
            _ensure_project(root, "example")
            qdir = self._legacy_quest(root)
            svc = QuestService(QuestLock(), self.repo_root)
            with self.assertRaises(MissingQuestWorktree):
                svc.upgrade_quest(str(root), "example", "main", 0)
            self._bootstrap_legacy_worktree(root, qdir)
            result = svc.upgrade_quest(str(root), "example", "main", 0)
            self.assertEqual(result["status"], "upgraded")
            self.assertFalse(quest_needs_workflow_upgrade(qdir))


if __name__ == "__main__":
    unittest.main()
