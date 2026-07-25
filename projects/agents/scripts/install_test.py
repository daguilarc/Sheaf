from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
MODULE_PATH = SCRIPT_DIR / "install.py"

spec = importlib.util.spec_from_file_location("agents_install", MODULE_PATH)
assert spec is not None
install = importlib.util.module_from_spec(spec)
sys.modules["agents_install"] = install
assert spec.loader is not None
spec.loader.exec_module(install)


def hook_outputs(outputs: list[object], codex_home: Path) -> list[object]:
    codex_home = codex_home.resolve()
    wanted = {
        codex_home / "hooks" / "sheaf" / "session_start_after_compact.py",
        codex_home / "hooks.json",
    }
    return [output for output in outputs if output.path in wanted]


def copied_repo_fixture(tempdir: str) -> Path:
    repo_root = Path(tempdir) / "repo"
    agents_dest = repo_root / "projects" / "agents"
    shutil.copytree(
        REPO_ROOT / "projects" / "agents",
        agents_dest,
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    return repo_root


def run_main(*args: str) -> int:
    with mock.patch.object(sys, "argv", ["install.py", *args]):
        return install.main()


class CodexHookOutputTests(unittest.TestCase):
    def test_global_outputs_include_rendered_codex_hook(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = install.build_global_outputs(
                REPO_ROOT,
                home=home,
                codex_home=codex_home,
            )
            hooks = hook_outputs(outputs, codex_home)

            self.assertEqual(2, len(hooks))
            by_path = {output.path: output for output in hooks}
            script_path = codex_home / "hooks" / "sheaf" / "session_start_after_compact.py"
            config_path = codex_home / "hooks.json"

            self.assertIn("sheaf-agents-managed: DO NOT EDIT", by_path[script_path].content)
            self.assertIn("Post-compaction reminder", by_path[script_path].content)

            config = json.loads(by_path[config_path].content)
            self.assertIn("sheaf-agents-managed: DO NOT EDIT", by_path[config_path].content)
            group = config["hooks"]["SessionStart"][0]
            self.assertEqual("^compact$", group["matcher"])
            command = group["hooks"][0]["command"]
            self.assertEqual(f"python3 {script_path}", command)

    def test_install_check_and_clean_codex_hook_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = Path(tempdir) / "home"
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = hook_outputs(
                install.build_global_outputs(REPO_ROOT, home=home, codex_home=codex_home),
                codex_home,
            )

            self.assertEqual(0, install.install_outputs(outputs, force=False))
            self.assertEqual(0, install.check_outputs(outputs))

            config_path = codex_home / "hooks.json"
            config_path.write_text("{}\n", encoding="utf-8")
            self.assertEqual(1, install.check_outputs(outputs))

            self.assertEqual(0, install.install_outputs(outputs, force=True))
            self.assertEqual(0, install.clean_outputs(outputs))
            for output in outputs:
                self.assertFalse(output.path.exists())

    def test_unmanaged_codex_hooks_json_conflicts(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = Path(tempdir) / "home"
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = hook_outputs(
                install.build_global_outputs(REPO_ROOT, home=home, codex_home=codex_home),
                codex_home,
            )
            config_path = codex_home / "hooks.json"
            config_path.parent.mkdir(parents=True)
            config_path.write_text('{"hooks": {}}\n', encoding="utf-8")

            self.assertEqual(1, install.install_outputs(outputs, force=False))
            self.assertEqual(1, install.check_outputs(outputs))
            self.assertEqual(0, install.clean_outputs(outputs))
            self.assertTrue(config_path.exists())


class SkillScopeOutputTests(unittest.TestCase):
    def test_xagent_skill_is_not_an_agents_source_or_desired_output(self) -> None:
        self.assertFalse(
            (REPO_ROOT / "projects/agents/global/skills/xagent-subagents").exists()
        )

        with tempfile.TemporaryDirectory() as tempdir:
            output_sets = [
                install.build_repo_outputs(REPO_ROOT),
                install.build_global_outputs(
                    REPO_ROOT,
                    home=Path(tempdir) / "home",
                    codex_home=Path(tempdir) / "codex-home",
                ),
            ]
            for outputs in output_sets:
                for output in outputs:
                    self.assertNotEqual(
                        Path("xagent-subagents/SKILL.md"),
                        Path(*output.path.parts[-2:]),
                    )

    def test_repo_outputs_include_only_sheaf_skills(self) -> None:
        outputs = install.build_repo_outputs(REPO_ROOT)
        paths = {output.path.relative_to(REPO_ROOT) for output in outputs}
        _global_source, global_skills, sheaf_skills = install.read_sources(REPO_ROOT)

        self.assertIn(Path("AGENTS.md"), paths)
        self.assertIn(Path("CLAUDE.md"), paths)
        for skill in sheaf_skills:
            for target in skill.targets:
                self.assertIn(
                    install.REPO_TARGET_DIRS[target] / skill.skill_id / "SKILL.md",
                    paths,
                )
        for skill in global_skills:
            for target_dir in install.REPO_TARGET_DIRS.values():
                self.assertNotIn(target_dir / skill.skill_id / "SKILL.md", paths)

    def test_repo_outputs_honor_synthetic_codex_only_sheaf_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = copied_repo_fixture(tempdir)
            skill_root = repo_root / "projects" / "agents" / "sheaf" / "skills" / "codex-only"
            skill_root.mkdir(parents=True)
            (skill_root / "skill.yaml").write_text(
                "\n".join(
                    [
                        "id: codex-only",
                        "name: codex-only",
                        "description: Synthetic Codex-only Sheaf skill.",
                        "targets:",
                        "  - codex",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (skill_root / "SKILL.md").write_text("# Codex Only\n", encoding="utf-8")

            outputs = install.build_repo_outputs(repo_root)
            paths = {output.path.relative_to(repo_root) for output in outputs}

            self.assertIn(Path(".codex/skills/codex-only/SKILL.md"), paths)
            self.assertNotIn(Path(".claude/skills/codex-only/SKILL.md"), paths)
            self.assertNotIn(Path(".cursor/skills/codex-only/SKILL.md"), paths)
            self.assertNotIn(Path(".pi/skills/codex-only/SKILL.md"), paths)

    def test_global_outputs_include_only_non_plugin_global_skills(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = install.build_global_outputs(
                REPO_ROOT,
                home=home,
                codex_home=codex_home,
            )
            paths = {output.path for output in outputs}
            _global_source, global_skills, _sheaf_skills = install.read_sources(REPO_ROOT)
            plugin_owned_global_ids = {"xagent-subagents"}

            for skill in global_skills:
                expected_paths = []
                if "claude" in skill.targets:
                    expected_paths.append(
                        home / ".claude" / "skills" / skill.skill_id / "SKILL.md"
                    )
                if "cursor" in skill.targets:
                    expected_paths.append(
                        home / ".cursor" / "skills" / skill.skill_id / "SKILL.md"
                    )
                if "pi" in skill.targets:
                    expected_paths.append(
                        home / ".pi" / "skills" / skill.skill_id / "SKILL.md"
                    )
                if "codex" in skill.targets:
                    expected_paths.extend(
                        [
                            home / ".agents" / "skills" / skill.skill_id / "SKILL.md",
                            codex_home / "skills" / skill.skill_id / "SKILL.md",
                        ]
                    )

                for path in expected_paths:
                    if skill.skill_id in plugin_owned_global_ids:
                        self.assertNotIn(path, paths)
                    else:
                        self.assertIn(path, paths)


class ObsoleteRepoOutputTests(unittest.TestCase):
    def test_repo_obsolete_outputs_cover_all_global_ids_and_retired_xagent(self) -> None:
        outputs = install.build_obsolete_repo_outputs(REPO_ROOT)
        paths = {output.path.relative_to(REPO_ROOT) for output in outputs}
        _global_source, global_skills, _sheaf_skills = install.read_sources(REPO_ROOT)
        obsolete_ids = {skill.skill_id for skill in global_skills}
        obsolete_ids.add("xagent-subagents")

        self.assertEqual(
            {
                target_dir / skill_id / "SKILL.md"
                for skill_id in obsolete_ids
                for target_dir in install.REPO_TARGET_DIRS.values()
            },
            paths,
        )

    def test_repo_install_check_clean_handle_only_managed_obsolete_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = copied_repo_fixture(tempdir)
            managed_obsolete = repo_root / ".claude" / "skills" / "about-me" / "SKILL.md"
            unmanaged_obsolete = repo_root / ".cursor" / "skills" / "about-me" / "SKILL.md"
            managed_obsolete.parent.mkdir(parents=True)
            unmanaged_obsolete.parent.mkdir(parents=True)
            managed_obsolete.write_text(
                "<!-- sheaf-agents-managed: DO NOT EDIT; source=old -->\n",
                encoding="utf-8",
            )
            unmanaged_obsolete.write_text("personal skill\n", encoding="utf-8")

            self.assertEqual(
                0,
                run_main("install", "--scope", "repo", "--repo-root", str(repo_root)),
            )
            self.assertFalse(managed_obsolete.exists())
            self.assertTrue(unmanaged_obsolete.exists())

            self.assertEqual(
                0,
                run_main("check", "--scope", "repo", "--repo-root", str(repo_root)),
            )
            self.assertEqual(
                0,
                run_main("clean", "--scope", "repo", "--repo-root", str(repo_root)),
            )
            self.assertTrue(unmanaged_obsolete.exists())


if __name__ == "__main__":
    unittest.main()
