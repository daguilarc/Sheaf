from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
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


class CodexHookOutputTests(unittest.TestCase):
    def test_global_outputs_include_rendered_codex_hook(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = Path(tempdir) / "home"
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


if __name__ == "__main__":
    unittest.main()
