"""Tests for project-local quest discovery and metadata."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from quest_runner_service import quest_fs
from quest_runner_service.quest_types import QuestMeta


class ProjectQuestDiscoveryTests(unittest.TestCase):
    def _layout(self, root: Path) -> None:
        legacy = root / "quests" / "main" / "0000_legacy"
        legacy.mkdir(parents=True)
        (legacy / "meta.json").write_text(
            json.dumps(
                {
                    "quest_type": "main",
                    "quest_number": 0,
                    "quest_slug": "legacy",
                    "quest_name": "Legacy",
                    "created_at": "2026-01-01T00:00:00Z",
                }
            )
            + "\n",
            encoding="utf-8",
        )
        modern = root / "projects" / "example" / "quests" / "main" / "0000_modern"
        modern.mkdir(parents=True)
        (modern / "meta.json").write_text(
            json.dumps(
                {
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": 0,
                    "quest_slug": "modern",
                    "quest_name": "Modern",
                    "created_at": "2026-01-01T00:00:00Z",
                }
            )
            + "\n",
            encoding="utf-8",
        )

    def test_find_quest_dir_ignores_legacy_top_level(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._layout(root)
            found = quest_fs.find_quest_dir(root, "example", "main", 0)
            self.assertIsNotNone(found)
            assert found is not None
            self.assertTrue(found.name.endswith("_modern"))
            self.assertNotIn("/quests/main/", found.as_posix().split("projects")[0])
            self.assertIn("/projects/example/quests/", found.as_posix())

    def test_list_quest_dirs_scoped_by_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._layout(root)
            other = root / "projects" / "other" / "quests" / "main" / "0000_x"
            other.mkdir(parents=True)
            (other / "meta.json").write_text("{}", encoding="utf-8")
            example_dirs = quest_fs.list_quest_dirs(root, "example", "main")
            other_dirs = quest_fs.list_quest_dirs(root, "other", "main")
            self.assertEqual(len(example_dirs), 1)
            self.assertEqual(len(other_dirs), 1)
            self.assertNotEqual(example_dirs[0], other_dirs[0])

    def test_iter_project_quest_roots_excludes_legacy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._layout(root)
            roots = quest_fs.iter_project_quest_roots(root)
            self.assertEqual([r.project for r in roots], ["example"])

    def test_project_quest_root_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(
                quest_fs.project_quest_root(root, "demo"),
                root / "projects" / "demo" / "quests",
            )


class QuestMetaProjectFieldTests(unittest.TestCase):
    def test_write_includes_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            qdir = Path(tmp) / "projects" / "web" / "quests" / "main" / "0001_api"
            qdir.mkdir(parents=True)
            meta = QuestMeta(
                project="web",
                quest_type="main",
                quest_number=1,
                quest_slug="api",
                quest_name="API",
                created_at="2026-03-29T00:00:00Z",
            )
            quest_fs.write_quest_meta(qdir, meta)
            data = json.loads((qdir / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(data["project"], "web")

    def test_read_derives_project_from_path_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            qdir = Path(tmp) / "projects" / "web" / "quests" / "main" / "0001_api"
            qdir.mkdir(parents=True)
            (qdir / "meta.json").write_text(
                json.dumps(
                    {
                        "quest_type": "main",
                        "quest_number": 1,
                        "quest_slug": "api",
                        "quest_name": "API",
                        "created_at": "2026-03-29T00:00:00Z",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            meta = quest_fs.read_quest_meta(qdir)
            self.assertEqual(meta.project, "web")

    def test_read_without_project_field_on_legacy_top_level_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            qdir = Path(tmp) / "quests" / "main" / "0000_legacy"
            qdir.mkdir(parents=True)
            (qdir / "meta.json").write_text(
                json.dumps(
                    {
                        "quest_type": "main",
                        "quest_number": 0,
                        "quest_slug": "legacy",
                        "quest_name": "Legacy",
                        "created_at": "2026-03-29T00:00:00Z",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            meta = quest_fs.read_quest_meta(qdir)
            self.assertEqual(meta.project, "")


if __name__ == "__main__":
    unittest.main()
