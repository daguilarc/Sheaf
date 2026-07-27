from __future__ import annotations

import contextlib
import io
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path

import install_superpowers


REVISION = "abc123def456"
VERSION = "6.2.0"


def write_executable(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def seed_vendor_tree(repo_root: Path) -> Path:
    tree = (
        repo_root
        / "projects"
        / "agents"
        / "vendor"
        / "superpowers"
        / "tree"
    )
    (tree / "skills" / "writing-plans").mkdir(parents=True)
    (tree / "skills" / "writing-plans" / "SKILL.md").write_text(
        "# writing-plans\n",
        encoding="utf-8",
    )
    (tree / "hooks").mkdir(parents=True)
    (tree / "hooks" / "hooks.json").write_text("{}\n", encoding="utf-8")
    write_executable(tree / "hooks" / "session-start", "#!/bin/sh\nexit 0\n")
    write_executable(tree / "hooks" / "run-hook.cmd", "#!/bin/sh\nexit 0\n")
    (tree / ".claude-plugin").mkdir()
    (tree / ".claude-plugin" / "plugin.json").write_text(
        json.dumps({"name": "superpowers", "version": VERSION}) + "\n",
        encoding="utf-8",
    )
    (tree / ".cursor-plugin").mkdir()
    (tree / ".cursor-plugin" / "plugin.json").write_text(
        json.dumps(
            {
                "name": "superpowers",
                "version": VERSION,
                "skills": "./skills/",
                "hooks": "./hooks/hooks-cursor.json",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (tree / "hooks" / "hooks-cursor.json").write_text("{}\n", encoding="utf-8")
    (tree / ".codex-plugin").mkdir()
    (tree / ".codex-plugin" / "plugin.json").write_text(
        json.dumps(
            {
                "name": "superpowers",
                "version": VERSION,
                "skills": "./skills/",
                "hooks": {},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (tree / ".pi" / "extensions").mkdir(parents=True)
    (tree / ".pi" / "extensions" / "superpowers.ts").write_text(
        "export default function () {}\n",
        encoding="utf-8",
    )
    (tree / "package.json").write_text(
        json.dumps(
            {
                "name": "superpowers",
                "version": VERSION,
                "keywords": ["pi-package"],
                "pi": {
                    "extensions": ["./.pi/extensions/superpowers.ts"],
                    "skills": ["./skills"],
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )
    vendor_toml = tree.parent / "VENDOR.toml"
    vendor_toml.write_text(
        "\n".join(
            [
                'url = "https://github.com/obra/superpowers.git"',
                f'revision = "{REVISION}"',
                f'version = "{VERSION}"',
                'retrieved_at = "2026-07-27T00:00:00Z"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    return tree


class InstallSuperpowersTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="install-superpowers-")
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.codex_home = self.root / "codex-home"
        self.repo_root = self.root / "repo"
        self.home.mkdir()
        self.codex_home.mkdir()
        seed_vendor_tree(self.repo_root)
        # Sheaf-owned Codex hooks file that must never be touched.
        #
        (self.codex_home / "hooks.json").write_text(
            json.dumps({"hooks": {"PostToolUse": []}}) + "\n",
            encoding="utf-8",
        )
        self.codex_hooks_before = (self.codex_home / "hooks.json").read_text(
            encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def install(self, *, force: bool = False) -> int:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(
            io.StringIO()
        ):
            return install_superpowers.install_superpowers(
                repo_root=self.repo_root,
                home=self.home,
                codex_home=self.codex_home,
                force=force,
            )

    def check(self) -> int:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(
            io.StringIO()
        ):
            return install_superpowers.check_superpowers(
                repo_root=self.repo_root,
                home=self.home,
                codex_home=self.codex_home,
            )

    def clean(self) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return install_superpowers.clean_superpowers(
                home=self.home,
                codex_home=self.codex_home,
            )

    def test_claude_package_destination_and_installed_plugins_key_merge(self) -> None:
        unrelated = {
            "version": 2,
            "plugins": {
                "other@somewhere": [
                    {
                        "scope": "user",
                        "installPath": "/tmp/other",
                        "version": "1.0.0",
                    }
                ]
            },
        }
        registry = self.home / ".claude" / "plugins" / "installed_plugins.json"
        registry.parent.mkdir(parents=True)
        registry.write_text(json.dumps(unrelated) + "\n", encoding="utf-8")

        self.assertEqual(0, self.install())

        destination = (
            self.home
            / ".claude"
            / "plugins"
            / "cache"
            / "sheaf-managed"
            / "superpowers"
            / VERSION
        )
        self.assertTrue(destination.is_dir())
        self.assertTrue((destination / "skills" / "writing-plans" / "SKILL.md").is_file())
        marker = (destination / ".sheaf-managed").read_text(encoding="utf-8")
        self.assertIn(REVISION, marker)
        self.assertIn(VERSION, marker)
        self.assertIn("sheaf-agents-managed", marker)

        payload = json.loads(registry.read_text(encoding="utf-8"))
        self.assertEqual(unrelated["plugins"]["other@somewhere"], payload["plugins"]["other@somewhere"])
        key = "superpowers@sheaf-managed"
        self.assertIn(key, payload["plugins"])
        entry = payload["plugins"][key][0]
        self.assertEqual(str(destination.resolve()), entry["installPath"])
        self.assertEqual(VERSION, entry["version"])

        marketplace_root = (
            self.home / ".claude" / "plugins" / "marketplaces" / "sheaf-managed"
        )
        marketplace = json.loads(
            (marketplace_root / ".claude-plugin" / "marketplace.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual("./superpowers", marketplace["plugins"][0]["source"])
        marketplace_plugin = marketplace_root / "superpowers"
        self.assertTrue(
            (marketplace_plugin / "skills" / "writing-plans" / "SKILL.md").is_file()
        )
        known = json.loads(
            (
                self.home / ".claude" / "plugins" / "known_marketplaces.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(
            "directory",
            known["sheaf-managed"]["source"]["source"],
        )
        self.assertEqual(
            str(marketplace_root.resolve()),
            known["sheaf-managed"]["source"]["path"],
        )
        self.assertEqual(
            str(marketplace_root.resolve()),
            known["sheaf-managed"]["installLocation"],
        )

    def test_registry_conflict_preflight_before_any_mutation(self) -> None:
        foreign_path = self.home / "foreign-superpowers"
        foreign_path.mkdir()
        (foreign_path / "foreign.txt").write_text("keep\n", encoding="utf-8")
        registry = self.home / ".claude" / "plugins" / "installed_plugins.json"
        registry.parent.mkdir(parents=True)
        registry.write_text(
            json.dumps(
                {
                    "version": 2,
                    "plugins": {
                        "superpowers@sheaf-managed": [
                            {
                                "scope": "user",
                                "installPath": str(foreign_path),
                                "version": "9.9.9",
                            }
                        ]
                    },
                }
            )
            + "\n",
            encoding="utf-8",
        )

        stderr = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(
            stderr
        ):
            status = install_superpowers.install_superpowers(
                repo_root=self.repo_root,
                home=self.home,
                codex_home=self.codex_home,
                force=False,
            )
        self.assertEqual(1, status)
        self.assertIn("conflict unmanaged registry key", stderr.getvalue())

        claude_dest = (
            self.home
            / ".claude"
            / "plugins"
            / "cache"
            / "sheaf-managed"
            / "superpowers"
            / VERSION
        )
        self.assertFalse(claude_dest.exists())
        self.assertFalse(
            (self.home / ".cursor" / "plugins" / "local" / "superpowers").exists()
        )
        self.assertFalse(
            (self.home / ".agents" / "plugins" / "plugins" / "superpowers").exists()
        )
        self.assertFalse(
            (
                self.home / ".pi" / "packages" / "sheaf-managed" / "superpowers"
            ).exists()
        )
        self.assertEqual(
            "keep\n",
            (foreign_path / "foreign.txt").read_text(encoding="utf-8"),
        )

    def test_foreign_superpowers_marketplace_refused_without_force(self) -> None:
        foreign = (
            self.home
            / ".claude"
            / "plugins"
            / "cache"
            / "claude-plugins-official"
            / "superpowers"
            / VERSION
        )
        foreign.mkdir(parents=True)
        (foreign / "keep.txt").write_text("official\n", encoding="utf-8")
        registry = self.home / ".claude" / "plugins" / "installed_plugins.json"
        registry.parent.mkdir(parents=True, exist_ok=True)
        registry.write_text(
            json.dumps(
                {
                    "version": 2,
                    "plugins": {
                        "superpowers@claude-plugins-official": [
                            {
                                "scope": "user",
                                "installPath": str(foreign),
                                "version": VERSION,
                            }
                        ]
                    },
                }
            )
            + "\n",
            encoding="utf-8",
        )

        stderr = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(
            stderr
        ):
            status = install_superpowers.install_superpowers(
                repo_root=self.repo_root,
                home=self.home,
                codex_home=self.codex_home,
                force=False,
            )
        self.assertEqual(1, status)
        self.assertIn("superpowers@claude-plugins-official", stderr.getvalue())
        self.assertFalse(
            (
                self.home
                / ".claude"
                / "plugins"
                / "cache"
                / "sheaf-managed"
                / "superpowers"
                / VERSION
            ).exists()
        )

        self.assertEqual(0, self.install(force=True))
        payload = json.loads(registry.read_text(encoding="utf-8"))
        self.assertIn("superpowers@claude-plugins-official", payload["plugins"])
        self.assertIn("superpowers@sheaf-managed", payload["plugins"])
        self.assertEqual(
            "official\n",
            (foreign / "keep.txt").read_text(encoding="utf-8"),
        )

    def test_codex_path_parallel_to_xagent_and_marketplace_upsert(self) -> None:
        marketplace_path = self.home / ".agents" / "plugins" / "marketplace.json"
        marketplace_path.parent.mkdir(parents=True)
        marketplace_path.write_text(
            json.dumps(
                {
                    "name": "joyo_local",
                    "interface": {"displayName": "Local"},
                    "plugins": [
                        {
                            "name": "xagent",
                            "source": {
                                "source": "local",
                                "path": "./.agents/plugins/plugins/xagent",
                            },
                        }
                    ],
                }
            )
            + "\n",
            encoding="utf-8",
        )

        self.assertEqual(0, self.install())

        destination = self.home / ".agents" / "plugins" / "plugins" / "superpowers"
        self.assertTrue(destination.is_dir())
        self.assertTrue((destination / ".codex-plugin" / "plugin.json").is_file())
        marker = (destination / ".sheaf-managed").read_text(encoding="utf-8")
        self.assertIn(REVISION, marker)
        self.assertIn(VERSION, marker)

        marketplace = json.loads(marketplace_path.read_text(encoding="utf-8"))
        self.assertEqual("joyo_local", marketplace["name"])
        self.assertEqual(
            {
                "name": "xagent",
                "source": {
                    "source": "local",
                    "path": "./.agents/plugins/plugins/xagent",
                },
            },
            marketplace["plugins"][0],
        )
        [superpowers] = [
            entry for entry in marketplace["plugins"] if entry.get("name") == "superpowers"
        ]
        self.assertEqual("local", superpowers["source"]["source"])
        self.assertEqual(
            "./.agents/plugins/plugins/superpowers",
            superpowers["source"]["path"],
        )
        self.assertEqual(
            self.codex_hooks_before,
            (self.codex_home / "hooks.json").read_text(encoding="utf-8"),
        )

    def test_executable_bits_preserved_on_hook_scripts(self) -> None:
        self.assertEqual(0, self.install())
        for harness_path in (
            self.home
            / ".claude"
            / "plugins"
            / "cache"
            / "sheaf-managed"
            / "superpowers"
            / VERSION,
            self.home / ".cursor" / "plugins" / "local" / "superpowers",
            self.home / ".agents" / "plugins" / "plugins" / "superpowers",
            self.home / ".pi" / "packages" / "sheaf-managed" / "superpowers",
        ):
            session_start = harness_path / "hooks" / "session-start"
            run_hook = harness_path / "hooks" / "run-hook.cmd"
            self.assertTrue(os.access(session_start, os.X_OK), session_start)
            self.assertTrue(os.access(run_hook, os.X_OK), run_hook)

    def test_unrelated_registry_keys_untouched_on_second_install(self) -> None:
        claude_registry = self.home / ".claude" / "plugins" / "installed_plugins.json"
        claude_registry.parent.mkdir(parents=True)
        claude_registry.write_text(
            json.dumps(
                {
                    "version": 2,
                    "plugins": {
                        "keep@me": [{"scope": "user", "installPath": "/tmp/keep"}],
                    },
                }
            )
            + "\n",
            encoding="utf-8",
        )
        marketplace_path = self.home / ".agents" / "plugins" / "marketplace.json"
        marketplace_path.parent.mkdir(parents=True)
        marketplace_path.write_text(
            json.dumps(
                {
                    "name": "personal",
                    "plugins": [
                        {
                            "name": "keep",
                            "source": {"source": "local", "path": "./keep"},
                        }
                    ],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        pi_settings = self.home / ".pi" / "agent" / "settings.json"
        pi_settings.parent.mkdir(parents=True)
        pi_settings.write_text(
            json.dumps({"packages": ["npm:pi-web-access"], "retry": {"enabled": True}})
            + "\n",
            encoding="utf-8",
        )

        self.assertEqual(0, self.install())
        self.assertEqual(0, self.install())

        claude = json.loads(claude_registry.read_text(encoding="utf-8"))
        self.assertEqual(
            [{"scope": "user", "installPath": "/tmp/keep"}],
            claude["plugins"]["keep@me"],
        )
        marketplace = json.loads(marketplace_path.read_text(encoding="utf-8"))
        self.assertEqual("keep", marketplace["plugins"][0]["name"])
        pi = json.loads(pi_settings.read_text(encoding="utf-8"))
        self.assertIn("npm:pi-web-access", pi["packages"])
        self.assertEqual({"enabled": True}, pi["retry"])

    def test_unmanaged_same_key_conflict_without_force(self) -> None:
        destination = (
            self.home
            / ".claude"
            / "plugins"
            / "cache"
            / "sheaf-managed"
            / "superpowers"
            / VERSION
        )
        destination.mkdir(parents=True)
        (destination / "skills").mkdir()
        (destination / "foreign.txt").write_text("nope\n", encoding="utf-8")
        registry = self.home / ".claude" / "plugins" / "installed_plugins.json"
        registry.parent.mkdir(parents=True, exist_ok=True)
        registry.write_text(
            json.dumps(
                {
                    "version": 2,
                    "plugins": {
                        "superpowers@sheaf-managed": [
                            {
                                "scope": "user",
                                "installPath": str(destination),
                                "version": VERSION,
                            }
                        ]
                    },
                }
            )
            + "\n",
            encoding="utf-8",
        )

        self.assertEqual(1, self.install())
        self.assertEqual("nope\n", (destination / "foreign.txt").read_text(encoding="utf-8"))

        self.assertEqual(0, self.install(force=True))
        self.assertFalse((destination / "foreign.txt").exists())
        self.assertTrue((destination / ".sheaf-managed").is_file())

    def test_stale_pin_check_fails_until_reinstall(self) -> None:
        self.assertEqual(0, self.install())
        self.assertEqual(0, self.check())

        destination = (
            self.home
            / ".claude"
            / "plugins"
            / "cache"
            / "sheaf-managed"
            / "superpowers"
            / VERSION
        )
        (destination / ".sheaf-managed").write_text(
            "sheaf-agents-managed: DO NOT EDIT\n"
            "source=projects/agents/vendor/superpowers/tree\n"
            "revision=stale-rev\n"
            f"version={VERSION}\n",
            encoding="utf-8",
        )
        self.assertEqual(1, self.check())

        self.assertEqual(0, self.install())
        self.assertEqual(0, self.check())

    def test_cursor_and_pi_packages_installed_with_markers(self) -> None:
        self.assertEqual(0, self.install())

        cursor_dest = self.home / ".cursor" / "plugins" / "local" / "superpowers"
        self.assertTrue((cursor_dest / ".cursor-plugin" / "plugin.json").is_file())
        self.assertIn(
            REVISION,
            (cursor_dest / ".sheaf-managed").read_text(encoding="utf-8"),
        )

        pi_dest = self.home / ".pi" / "packages" / "sheaf-managed" / "superpowers"
        self.assertTrue((pi_dest / "package.json").is_file())
        self.assertTrue((pi_dest / ".pi" / "extensions" / "superpowers.ts").is_file())
        settings = json.loads(
            (self.home / ".pi" / "agent" / "settings.json").read_text(encoding="utf-8")
        )
        self.assertIn(str(pi_dest.resolve()), settings["packages"])

    def test_clean_removes_managed_only_and_leaves_foreign(self) -> None:
        self.assertEqual(0, self.install())

        foreign_claude = (
            self.home
            / ".claude"
            / "plugins"
            / "cache"
            / "claude-plugins-official"
            / "superpowers"
            / VERSION
        )
        foreign_claude.mkdir(parents=True)
        (foreign_claude / "keep.txt").write_text("foreign\n", encoding="utf-8")

        foreign_cursor = self.home / ".cursor" / "plugins" / "local" / "other"
        foreign_cursor.mkdir(parents=True)
        (foreign_cursor / "keep.txt").write_text("foreign\n", encoding="utf-8")

        claude_registry = self.home / ".claude" / "plugins" / "installed_plugins.json"
        payload = json.loads(claude_registry.read_text(encoding="utf-8"))
        payload["plugins"]["superpowers@claude-plugins-official"] = [
            {"scope": "user", "installPath": str(foreign_claude), "version": VERSION}
        ]
        claude_registry.write_text(json.dumps(payload) + "\n", encoding="utf-8")

        self.assertEqual(0, self.clean())

        self.assertFalse(
            (
                self.home
                / ".claude"
                / "plugins"
                / "cache"
                / "sheaf-managed"
                / "superpowers"
                / VERSION
            ).exists()
        )
        self.assertEqual(
            "foreign\n",
            (foreign_claude / "keep.txt").read_text(encoding="utf-8"),
        )
        self.assertEqual(
            "foreign\n",
            (foreign_cursor / "keep.txt").read_text(encoding="utf-8"),
        )
        cleaned = json.loads(claude_registry.read_text(encoding="utf-8"))
        self.assertNotIn("superpowers@sheaf-managed", cleaned["plugins"])
        self.assertIn("superpowers@claude-plugins-official", cleaned["plugins"])
        self.assertEqual(
            self.codex_hooks_before,
            (self.codex_home / "hooks.json").read_text(encoding="utf-8"),
        )

    def test_install_py_module_stays_unaware_of_superpowers(self) -> None:
        import install as agents_install

        source = Path(agents_install.__file__).read_text(encoding="utf-8")
        self.assertNotIn("install_superpowers", source)
        self.assertNotIn("superpowers@", source)
        self.assertFalse(hasattr(agents_install, "install_superpowers"))


if __name__ == "__main__":
    unittest.main()
