from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import shutil
import socket
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from plugins.xagent.scripts import install_global, package_xagent


REPO_ROOT = Path(__file__).resolve().parents[3]
PLUGIN_CREATOR_SCRIPTS = (
    Path.home() / ".codex" / "skills" / ".system" / "plugin-creator" / "scripts"
)
HELPER_NAMES = (
    "create_basic_plugin.py",
    "update_plugin_cachebuster.py",
    "read_marketplace_name.py",
    "validate_plugin.py",
)
FIXED_CACHEBUSTER = "test-20260725"
XAGENT_MCP_URL = "http://127.0.0.1:9005/mcp"
XAGENT_MCP_TIMEOUT_SEC = 7200
EXPECTED_MCP_TOOL_NAMES = (
    "xagent_await",
    "xagent_close",
    "xagent_inspect",
    "xagent_interrupt",
    "xagent_message",
    "xagent_start",
)


def write_stub_mcp_json(plugin_root: Path) -> None:
    (plugin_root / ".mcp.json").write_text(
        json.dumps(
            {
                "mcpServers": {
                    "xagent": {
                        "type": "http",
                        "url": XAGENT_MCP_URL,
                        "tool_timeout_sec": XAGENT_MCP_TIMEOUT_SEC,
                    }
                }
            }
        )
        + "\n",
        encoding="utf-8",
    )


def write_executable(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def tree_snapshot(root: Path) -> dict[str, tuple[int, str]]:
    snapshot: dict[str, tuple[int, str]] = {}
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        snapshot[str(path.relative_to(root))] = (
            stat.S_IMODE(path.stat().st_mode),
            hashlib.sha256(path.read_bytes()).hexdigest(),
        )
    return snapshot


def is_loopback_port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
        handle.settimeout(0.2)
        return handle.connect_ex(("127.0.0.1", port)) == 0


def wait_for_loopback_port(port: int, *, timeout_sec: float = 10.0) -> None:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if is_loopback_port_open(port):
            return
        time.sleep(0.05)
    raise RuntimeError(f"timed out waiting for 127.0.0.1:{port}")


def discover_mcp_tools(url: str) -> list[str]:
    probe = f"""
import {{ Client }} from "@modelcontextprotocol/sdk/client/index.js";
import {{ StreamableHTTPClientTransport }} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL({url!r}));
const client = new Client({{ name: "xagent-plugin-package-test", version: "0.0.0" }});
await client.connect(transport);
const listed = await client.listTools();
console.log(JSON.stringify(listed.tools.map((tool) => tool.name).sort()));
await client.close();
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", probe],
        cwd=REPO_ROOT / "projects" / "xagent",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return json.loads(result.stdout.strip())


class PackageXagentOutputTests(unittest.TestCase):
    def test_built_package_excludes_python_bytecode_and_cache_directories(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xagent-package-output-test-") as tempdir:
            root = Path(tempdir)
            plugin_root = root / "plugin"
            destination = root / "package"
            for directory in (".codex-plugin", "skills", "scripts"):
                (plugin_root / directory).mkdir(parents=True)
            write_stub_mcp_json(plugin_root)
            launcher = plugin_root / "scripts" / "xagent"
            write_executable(launcher, "#!/bin/sh\n")
            (plugin_root / "scripts" / "package_xagent.py").write_text(
                "# package builder\n",
                encoding="utf-8",
            )
            (plugin_root / "scripts" / "package_xagent.pyc").write_bytes(b"bytecode")
            cache_file = plugin_root / "scripts" / "__pycache__" / "package_xagent.cpython.pyc"
            cache_file.parent.mkdir()
            cache_file.write_bytes(b"cached bytecode")

            def copy_runtime(asset_root: Path) -> None:
                asset_root.mkdir(parents=True)
                (asset_root / "package.json").write_text(
                    '{"name":"xagent"}\n',
                    encoding="utf-8",
                )

            with (
                mock.patch.object(package_xagent, "PLUGIN_ROOT", plugin_root),
                mock.patch.object(package_xagent, "copy_runtime", copy_runtime),
            ):
                package_xagent.build_package(destination)

            self.assertTrue((destination / "scripts" / "xagent").is_file())
            self.assertTrue(os.access(destination / "scripts" / "xagent", os.X_OK))
            self.assertEqual([], list(destination.rglob("__pycache__")))
            self.assertEqual([], list(destination.rglob("*.pyc")))

    def test_non_empty_output_is_rejected_without_deleting_contents(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xagent-package-output-test-") as tempdir:
            destination = Path(tempdir) / "existing-output"
            destination.mkdir()
            sentinel = destination / "keep.txt"
            sentinel.write_text("user data\n", encoding="utf-8")

            with (
                mock.patch.object(package_xagent, "copy_runtime"),
                self.assertRaisesRegex(RuntimeError, "non-empty"),
            ):
                package_xagent.build_package(destination)

            self.assertEqual("user data\n", sentinel.read_text(encoding="utf-8"))
            self.assertEqual(["keep.txt"], [path.name for path in destination.iterdir()])

    def test_check_tracked_assets_accepts_current_assets(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xagent-package-check-test-") as tempdir:
            root = Path(tempdir)
            plugin_root = root / "plugin"
            asset_root = plugin_root / "assets" / "xagent"
            for directory in (".codex-plugin", "skills", "scripts"):
                (plugin_root / directory).mkdir(parents=True)
            write_stub_mcp_json(plugin_root)
            asset_root.mkdir(parents=True)
            (asset_root / "package.json").write_text('{"name":"xagent"}\n', encoding="utf-8")

            def copy_runtime(destination: Path) -> None:
                destination.mkdir(parents=True)
                (destination / "package.json").write_text('{"name":"xagent"}\n', encoding="utf-8")

            with (
                mock.patch.object(package_xagent, "PLUGIN_ROOT", plugin_root),
                mock.patch.object(package_xagent, "ASSET_ROOT", asset_root),
                mock.patch.object(package_xagent, "copy_runtime", copy_runtime),
            ):
                package_xagent.check_tracked_assets_current()

    def test_check_tracked_assets_reports_stale_assets_without_rewriting(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xagent-package-check-test-") as tempdir:
            root = Path(tempdir)
            plugin_root = root / "plugin"
            asset_root = plugin_root / "assets" / "xagent"
            for directory in (".codex-plugin", "skills", "scripts"):
                (plugin_root / directory).mkdir(parents=True)
            write_stub_mcp_json(plugin_root)
            asset_root.mkdir(parents=True)
            tracked = asset_root / "package.json"
            tracked.write_text('{"name":"stale"}\n', encoding="utf-8")

            def copy_runtime(destination: Path) -> None:
                destination.mkdir(parents=True)
                (destination / "package.json").write_text('{"name":"current"}\n', encoding="utf-8")

            with (
                mock.patch.object(package_xagent, "PLUGIN_ROOT", plugin_root),
                mock.patch.object(package_xagent, "ASSET_ROOT", asset_root),
                mock.patch.object(package_xagent, "copy_runtime", copy_runtime),
                self.assertRaisesRegex(RuntimeError, "tracked xagent plugin assets are stale"),
            ):
                package_xagent.check_tracked_assets_current()

            self.assertEqual('{"name":"stale"}\n', tracked.read_text(encoding="utf-8"))

    def test_check_main_validates_temporary_package_before_cleanup(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xagent-package-check-test-") as tempdir:
            root = Path(tempdir)
            asset_root = root / "plugin" / "assets" / "xagent"
            asset_root.mkdir(parents=True)
            (asset_root / "package.json").write_text('{"name":"xagent"}\n', encoding="utf-8")
            validated_roots: list[Path] = []

            def build_package(destination: Path) -> None:
                (destination / "assets" / "xagent").mkdir(parents=True)
                (destination / "assets" / "xagent" / "package.json").write_text(
                    '{"name":"xagent"}\n',
                    encoding="utf-8",
                )
                (destination / "scripts").mkdir()
                (destination / "scripts" / "xagent").write_text("#!/bin/sh\n", encoding="utf-8")

            def validate_launcher(plugin_root: Path) -> None:
                if not plugin_root.exists():
                    raise RuntimeError(f"validated after cleanup: {plugin_root}")
                validated_roots.append(plugin_root)

            with (
                mock.patch.object(package_xagent, "parse_args", return_value=mock.Mock(check=True, output=None)),
                mock.patch.object(package_xagent, "ASSET_ROOT", asset_root),
                mock.patch.object(package_xagent, "build_package", build_package),
                mock.patch.object(package_xagent, "validate_launcher", validate_launcher),
            ):
                self.assertEqual(0, package_xagent.main())

            self.assertEqual(1, len(validated_roots))

    def test_check_main_uses_shared_drift_guard(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xagent-package-check-test-") as tempdir:
            asset_root = Path(tempdir) / "plugin" / "assets" / "xagent"
            asset_root.mkdir(parents=True)
            (asset_root / "package.json").write_text('{"name":"xagent"}\n', encoding="utf-8")
            calls: list[bool] = []

            def build_package(destination: Path) -> None:
                (destination / "assets" / "xagent").mkdir(parents=True)
                (destination / "assets" / "xagent" / "package.json").write_text(
                    '{"name":"xagent"}\n',
                    encoding="utf-8",
                )

            def check_tracked_assets_current(*, validate: bool = False) -> None:
                calls.append(validate)

            with (
                mock.patch.object(
                    package_xagent,
                    "parse_args",
                    return_value=mock.Mock(check=True, output=None),
                ),
                mock.patch.object(package_xagent, "ASSET_ROOT", asset_root),
                mock.patch.object(package_xagent, "build_package", build_package),
                mock.patch.object(package_xagent, "validate_launcher"),
                mock.patch.object(
                    package_xagent,
                    "check_tracked_assets_current",
                    check_tracked_assets_current,
                ),
            ):
                self.assertEqual(0, package_xagent.main())

            self.assertEqual([True], calls)

    def test_packaged_plugin_declares_http_mcp_without_local_supervisor(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xagent-package-mcp-test-") as tempdir:
            destination = Path(tempdir) / "package"
            package_xagent.build_package(destination)

            manifest = json.loads(
                (destination / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8")
            )
            self.assertEqual("./.mcp.json", manifest.get("mcpServers"))

            mcp_path = destination / ".mcp.json"
            self.assertTrue(mcp_path.is_file(), ".mcp.json must be packaged")
            mcp = json.loads(mcp_path.read_text(encoding="utf-8"))
            xagent = mcp["mcpServers"]["xagent"]
            self.assertEqual("http", xagent["type"])
            self.assertEqual(XAGENT_MCP_URL, xagent["url"])
            self.assertEqual(XAGENT_MCP_TIMEOUT_SEC, xagent["tool_timeout_sec"])
            self.assertNotIn("command", xagent)

            runtime_root = destination / "assets" / "xagent" / "dist" / "src"
            self.assertFalse((runtime_root / "service_main.js").exists())
            service_root = runtime_root / "service"
            self.assertTrue((service_root / "client.js").is_file())
            self.assertTrue((service_root / "config.js").is_file())
            self.assertTrue((service_root / "tool_schemas.js").is_file())
            self.assertFalse((service_root / "mcp.js").exists())
            self.assertFalse((service_root / "run_manager.js").exists())
            self.assertFalse((service_root / "server.js").exists())

            if is_loopback_port_open(9005):
                tool_names = discover_mcp_tools(XAGENT_MCP_URL)
                self.assertEqual(list(EXPECTED_MCP_TOOL_NAMES), tool_names)
            else:
                service_process = subprocess.Popen(
                    ["node", "dist/src/service_main.js"],
                    cwd=REPO_ROOT / "projects" / "xagent",
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                try:
                    wait_for_loopback_port(9005)
                    tool_names = discover_mcp_tools(XAGENT_MCP_URL)
                    self.assertEqual(list(EXPECTED_MCP_TOOL_NAMES), tool_names)
                finally:
                    service_process.terminate()
                    try:
                        service_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        service_process.kill()
                        service_process.wait(timeout=5)


class GlobalPluginInstallTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="xagent-global-install-test-")
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.codex_home = self.root / "codex-home"
        self.repo_root = self.root / "repo"
        self.bin_root = self.root / "bin"
        self.codex_log = self.root / "codex.log"
        self.destination = self.home / ".agents" / "plugins" / "plugins" / "xagent"
        self.marketplace_path = self.home / ".agents" / "plugins" / "marketplace.json"

        plugin_root = self.repo_root / "plugins" / "xagent"
        for directory in (".codex-plugin", "skills", "scripts"):
            shutil.copytree(REPO_ROOT / "plugins" / "xagent" / directory, plugin_root / directory)
        shutil.copy2(REPO_ROOT / "plugins" / "xagent" / ".mcp.json", plugin_root / ".mcp.json")

        xagent_root = self.repo_root / "projects" / "xagent"
        real_xagent = REPO_ROOT / "projects" / "xagent"
        xagent_root.mkdir(parents=True)
        shutil.copy2(real_xagent / "package.json", xagent_root / "package.json")
        if (real_xagent / "package-lock.json").is_file():
            shutil.copy2(real_xagent / "package-lock.json", xagent_root / "package-lock.json")
        shutil.copytree(
            real_xagent / "dist" / "src",
            xagent_root / "dist" / "src",
            dirs_exist_ok=True,
        )
        if (real_xagent / "node_modules").is_dir():
            node_modules_link = xagent_root / "node_modules"
            if not node_modules_link.exists():
                node_modules_link.symlink_to(
                    real_xagent / "node_modules",
                    target_is_directory=True,
                )

        helper_root = (
            self.codex_home / "skills" / ".system" / "plugin-creator" / "scripts"
        )
        helper_root.mkdir(parents=True)
        for helper_name in HELPER_NAMES:
            shutil.copy2(PLUGIN_CREATOR_SCRIPTS / helper_name, helper_root / helper_name)
        self.helper_root = helper_root

        write_executable(
            self.bin_root / "npm",
            """#!/usr/bin/env python3
raise SystemExit(0)
""",
        )
        write_executable(
            self.bin_root / "node",
            """#!/usr/bin/env python3
import os
import sys
from pathlib import Path

args = sys.argv[1:]
if args and args[0] == "-p":
    print("20")
elif args and args[0] == "--version":
    print("v20.0.0")
elif len(args) >= 2 and args[1] == "--help":
    print("xagent run --harness HARNESS --subagent PROMPT")
elif len(args) >= 2 and args[1] == "run":
    Path(os.environ["XAGENT_LOG_ROOT"]).mkdir(parents=True, exist_ok=True)
else:
    raise SystemExit(f"unexpected fake node arguments: {args!r}")
""",
        )
        write_executable(
            self.bin_root / "codex",
            """#!/usr/bin/env python3
import os
import sys
from pathlib import Path

args = sys.argv[1:]
log_path = Path(os.environ["FAKE_CODEX_LOG"])
with log_path.open("a", encoding="utf-8") as handle:
    handle.write(" ".join(args) + "\\n")
if os.environ.get("FAKE_CODEX_FAIL") and args[:2] == ["plugin", "add"]:
    print("fake codex add failure", file=sys.stderr)
    raise SystemExit(23)
if args == ["plugin", "list"]:
    print("NAME    VERSION    STATUS               PATH")
    print(
        "xagent  0.1.0     installed, enabled   "
        + str(Path(os.environ["FAKE_CODEX_PLUGIN_PATH"]).resolve())
    )
""",
        )
        self.environment = mock.patch.dict(
            os.environ,
            {
                "PATH": f"{self.bin_root}{os.pathsep}{os.environ.get('PATH', '')}",
                "FAKE_CODEX_LOG": str(self.codex_log),
                "FAKE_CODEX_PLUGIN_PATH": str(self.destination),
            },
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()
        self.temporary.cleanup()

    def install(self) -> None:
        self.install_with_codex(self.bin_root / "codex")

    def install_with_codex(self, codex: Path) -> None:
        install_global.install_global(
            repo_root=self.repo_root,
            home=self.home,
            codex_home=self.codex_home,
            codex=str(codex),
            cachebuster=FIXED_CACHEBUSTER,
        )

    def test_new_marketplace_defaults_to_personal(self) -> None:
        self.install()

        marketplace = json.loads(self.marketplace_path.read_text(encoding="utf-8"))
        self.assertEqual("personal", marketplace["name"])
        self.assertEqual(
            [
                {
                    "name": "xagent",
                    "source": {
                        "source": "local",
                        "path": "./.agents/plugins/plugins/xagent",
                    },
                    "policy": {
                        "installation": "AVAILABLE",
                        "authentication": "ON_INSTALL",
                    },
                    "category": "Productivity",
                }
            ],
            marketplace["plugins"],
        )
        self.assertEqual(
            ["plugin add xagent@personal", "plugin list"],
            self.codex_log.read_text(encoding="utf-8").splitlines(),
        )

    def test_existing_marketplace_name_interface_and_unrelated_entries_survive(self) -> None:
        existing = {
            "name": "joyo_local",
            "interface": {
                "displayName": "Joyo's Plugins",
                "description": "Personal development plugins",
            },
            "plugins": [
                {
                    "name": "other",
                    "source": {"source": "local", "path": "./plugins/other"},
                    "policy": {
                        "installation": "NOT_AVAILABLE",
                        "authentication": "ON_USE",
                    },
                    "category": "Other",
                }
            ],
        }
        self.marketplace_path.parent.mkdir(parents=True)
        self.marketplace_path.write_text(json.dumps(existing) + "\n", encoding="utf-8")

        self.install()

        marketplace = json.loads(self.marketplace_path.read_text(encoding="utf-8"))
        self.assertEqual(existing["name"], marketplace["name"])
        self.assertEqual(existing["interface"], marketplace["interface"])
        self.assertEqual(existing["plugins"][0], marketplace["plugins"][0])
        self.assertEqual(["other", "xagent"], [entry["name"] for entry in marketplace["plugins"]])
        self.assertEqual(
            "./.agents/plugins/plugins/xagent",
            marketplace["plugins"][1]["source"]["path"],
        )
        self.assertIn(
            "plugin add xagent@joyo_local",
            self.codex_log.read_text(encoding="utf-8").splitlines(),
        )

    def test_second_install_updates_one_xagent_entry(self) -> None:
        self.install()
        self.install()

        marketplace = json.loads(self.marketplace_path.read_text(encoding="utf-8"))
        xagent_entries = [
            entry for entry in marketplace["plugins"] if entry.get("name") == "xagent"
        ]
        self.assertEqual(1, len(xagent_entries))
        self.assertEqual(
            "sheaf-xagent-plugin\n",
            (self.destination / ".sheaf-managed").read_text(encoding="utf-8"),
        )
        self.assertEqual(
            2,
            self.codex_log.read_text(encoding="utf-8")
            .splitlines()
            .count("plugin add xagent@personal"),
        )

    def test_unmanaged_destination_is_rejected(self) -> None:
        self.destination.mkdir(parents=True)
        sentinel = self.destination / "keep.txt"
        sentinel.write_text("unmanaged\n", encoding="utf-8")

        with self.assertRaisesRegex(RuntimeError, "unmanaged"):
            self.install()

        self.assertEqual("unmanaged\n", sentinel.read_text(encoding="utf-8"))
        self.assertFalse(self.marketplace_path.exists())
        self.assertFalse(self.codex_log.exists())

        shutil.rmtree(self.destination)
        self.destination.write_text("unmanaged file\n", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "unmanaged"):
            self.install()

        self.assertEqual("unmanaged file\n", self.destination.read_text(encoding="utf-8"))

    def test_staged_package_has_marker_cachebuster_and_executable_launcher(self) -> None:
        self.install()

        self.assertEqual(
            "sheaf-xagent-plugin\n",
            (self.destination / ".sheaf-managed").read_text(encoding="utf-8"),
        )
        manifest = json.loads(
            (self.destination / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8")
        )
        self.assertEqual("0.1.0+codex.test-20260725", manifest["version"])
        self.assertTrue(os.access(self.destination / "scripts" / "xagent", os.X_OK))
        self.assertTrue((self.destination / "skills" / "xagent-subagents" / "SKILL.md").is_file())
        self.assertTrue((self.destination / "assets" / "xagent" / "dist" / "src" / "main.js").is_file())
        with self.assertRaisesRegex(RuntimeError, "installed and enabled"):
            install_global.require_installed_plugin(
                f"xagent  enabled  {self.destination.resolve()}\n",
                self.destination,
            )

    def test_non_default_home_is_used_for_codex_marketplace_resolution(self) -> None:
        write_executable(
            self.bin_root / "codex-home-aware",
            """#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

expected_home = Path(os.environ["EXPECTED_HOME"]).resolve()
actual_home = Path(os.environ["HOME"]).resolve()
if actual_home != expected_home:
    print(f"HOME mismatch: {actual_home} != {expected_home}", file=sys.stderr)
    raise SystemExit(24)
args = sys.argv[1:]
if args == ["plugin", "add", "xagent@personal"]:
    raise SystemExit(0)
if args == ["plugin", "list"]:
    marketplace = json.loads(
        (actual_home / ".agents" / "plugins" / "marketplace.json").read_text(
            encoding="utf-8"
        )
    )
    [entry] = [item for item in marketplace["plugins"] if item["name"] == "xagent"]
    source_path = Path(entry["source"]["path"])
    if not source_path.is_absolute():
        source_path = actual_home / source_path
    print("NAME    VERSION    STATUS               PATH")
    print("xagent  0.1.0     installed, enabled   " + str(source_path.resolve()))
    raise SystemExit(0)
raise SystemExit(f"unexpected fake codex arguments: {args!r}")
""",
        )
        with mock.patch.dict(os.environ, {"EXPECTED_HOME": str(self.home)}):
            self.install_with_codex(self.bin_root / "codex-home-aware")

        marketplace = json.loads(self.marketplace_path.read_text(encoding="utf-8"))
        [entry] = [item for item in marketplace["plugins"] if item["name"] == "xagent"]
        self.assertEqual(
            f"./{self.destination.relative_to(self.home).as_posix()}",
            entry["source"]["path"],
        )

    def test_tracked_plugin_tree_is_unchanged(self) -> None:
        plugin_root = self.repo_root / "plugins" / "xagent"
        before = tree_snapshot(plugin_root)

        self.install()

        self.assertEqual(before, tree_snapshot(plugin_root))
        self.assertFalse((plugin_root / "assets").exists())

    def test_missing_helper_and_failed_codex_command_are_reported(self) -> None:
        (self.helper_root / "validate_plugin.py").unlink()
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            result = install_global.main(
                [
                    "install",
                    "--repo-root",
                    str(self.repo_root),
                    "--home",
                    str(self.home),
                    "--codex-home",
                    str(self.codex_home),
                    "--codex",
                    str(self.bin_root / "codex"),
                    "--cachebuster",
                    FIXED_CACHEBUSTER,
                ]
            )
        self.assertNotEqual(0, result)
        self.assertIn("validate_plugin.py", stderr.getvalue())

        shutil.copy2(
            PLUGIN_CREATOR_SCRIPTS / "validate_plugin.py",
            self.helper_root / "validate_plugin.py",
        )
        os.environ["FAKE_CODEX_FAIL"] = "add"
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            result = install_global.main(
                [
                    "install",
                    "--repo-root",
                    str(self.repo_root),
                    "--home",
                    str(self.home),
                    "--codex-home",
                    str(self.codex_home),
                    "--codex",
                    str(self.bin_root / "codex"),
                    "--cachebuster",
                    FIXED_CACHEBUSTER,
                ]
            )
        self.assertNotEqual(0, result)
        self.assertIn("plugin add xagent@personal", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
