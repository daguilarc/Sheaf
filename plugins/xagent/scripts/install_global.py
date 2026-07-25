#!/usr/bin/env python3
"""Build, stage, and register the Sheaf xagent plugin for the current user."""

from __future__ import annotations

import argparse
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Sequence


PLUGIN_NAME = "xagent"
MANAGED_FILE = ".sheaf-managed"
MANAGED_CONTENT = "sheaf-xagent-plugin\n"

REPO_ROOT = Path(__file__).resolve().parents[3]
HELPER_NAMES = (
    "create_basic_plugin.py",
    "update_plugin_cachebuster.py",
    "read_marketplace_name.py",
    "validate_plugin.py",
)


def run_command(args: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError as error:
        raise RuntimeError(f"missing command dependency: {args[0]}") from error
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or "").strip()
        message = f"command failed ({error.returncode}): {shlex.join(args)}"
        if details:
            message = f"{message}\n{details}"
        raise RuntimeError(message) from error


def require_helpers(codex_home: Path) -> dict[str, Path]:
    scripts_root = (
        codex_home.expanduser().resolve()
        / "skills"
        / ".system"
        / "plugin-creator"
        / "scripts"
    )
    helpers: dict[str, Path] = {}
    for name in HELPER_NAMES:
        path = scripts_root / name
        if not path.is_file():
            raise FileNotFoundError(f"missing plugin-creator helper: {path}")
        helpers[name] = path
    return helpers


def require_managed_destination(destination: Path) -> None:
    if not destination.exists():
        return
    if not destination.is_dir() or destination.is_symlink():
        raise RuntimeError(
            f"refusing to replace unmanaged xagent plugin destination: {destination}"
        )
    marker = destination / MANAGED_FILE
    try:
        content = marker.read_text(encoding="utf-8")
    except (FileNotFoundError, IsADirectoryError, UnicodeDecodeError) as error:
        raise RuntimeError(
            f"refusing to replace unmanaged xagent plugin destination: {destination}"
        ) from error
    if content != MANAGED_CONTENT:
        raise RuntimeError(
            f"refusing to replace unmanaged xagent plugin destination: {destination}"
        )


def replace_managed_destination(staged: Path, destination: Path) -> None:
    backup = destination.with_name(f".{destination.name}-backup-{uuid.uuid4().hex}")
    had_destination = destination.exists()
    if had_destination:
        os.replace(destination, backup)
    try:
        os.replace(staged, destination)
    except OSError:
        if had_destination:
            os.replace(backup, destination)
        raise
    if had_destination:
        shutil.rmtree(backup)


def require_installed_plugin(plugin_list: str, destination: Path) -> None:
    expected_path = str(destination.resolve())
    matching_rows = []
    for raw_line in plugin_list.splitlines():
        line = raw_line.strip()
        lowered = line.lower()
        first_column = lowered.split(maxsplit=1)[0] if lowered else ""
        if (
            (first_column == PLUGIN_NAME or first_column.startswith(f"{PLUGIN_NAME}@"))
            and "installed" in lowered
            and "enabled" in lowered
            and line.endswith(expected_path)
        ):
            matching_rows.append(line)
    if len(matching_rows) != 1:
        raise RuntimeError(
            "codex plugin list did not report exactly one installed and enabled "
            f"{PLUGIN_NAME} row at {expected_path}"
        )


def install_global(
    *,
    repo_root: Path,
    home: Path,
    codex_home: Path,
    codex: str = "codex",
    cachebuster: str | None = None,
) -> None:
    repo_root = repo_root.expanduser().resolve()
    home = home.expanduser().resolve()
    helpers = require_helpers(codex_home)
    package_script = repo_root / "plugins" / "xagent" / "scripts" / "package_xagent.py"
    if not package_script.is_file():
        raise FileNotFoundError(f"missing xagent package builder: {package_script}")

    marketplace_root = home / ".agents" / "plugins"
    marketplace_path = marketplace_root / "marketplace.json"
    destination = marketplace_root / "plugins" / PLUGIN_NAME

    with tempfile.TemporaryDirectory(prefix="sheaf-xagent-install-") as tempdir:
        temporary_root = Path(tempdir)
        package_root = temporary_root / "package"
        run_command(
            [sys.executable, str(package_script), "--output", str(package_root)],
            cwd=repo_root,
        )
        run_command(
            [sys.executable, str(helpers["validate_plugin.py"]), str(package_root)],
            cwd=repo_root,
        )

        require_managed_destination(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        staged = Path(
            tempfile.mkdtemp(prefix=f".{PLUGIN_NAME}-stage-", dir=destination.parent)
        )
        try:
            shutil.copytree(
                package_root,
                staged,
                copy_function=shutil.copy2,
                dirs_exist_ok=True,
            )
            (staged / MANAGED_FILE).write_text(MANAGED_CONTENT, encoding="utf-8")
            cachebuster_command = [
                sys.executable,
                str(helpers["update_plugin_cachebuster.py"]),
                str(staged),
            ]
            if cachebuster is not None:
                cachebuster_command.extend(["--cachebuster", cachebuster])
            run_command(cachebuster_command, cwd=repo_root)
            replace_managed_destination(staged, destination)
        finally:
            shutil.rmtree(staged, ignore_errors=True)

        scaffold_parent = temporary_root / "scaffold"
        scaffold_parent.mkdir()
        run_command(
            [
                sys.executable,
                str(helpers["create_basic_plugin.py"]),
                PLUGIN_NAME,
                "--path",
                str(scaffold_parent),
                "--with-marketplace",
                "--marketplace-path",
                str(marketplace_path),
                "--install-policy",
                "AVAILABLE",
                "--auth-policy",
                "ON_INSTALL",
                "--category",
                "Productivity",
                "--force",
            ],
            cwd=repo_root,
        )
        marketplace_name = run_command(
            [
                sys.executable,
                str(helpers["read_marketplace_name.py"]),
                "--marketplace-path",
                str(marketplace_path),
            ],
            cwd=repo_root,
        ).stdout.strip()
        if not marketplace_name:
            raise RuntimeError(
                f"read_marketplace_name.py returned an empty marketplace name for {marketplace_path}"
            )
        run_command(
            [codex, "plugin", "add", f"{PLUGIN_NAME}@{marketplace_name}"],
            cwd=repo_root,
        )
        plugin_list = run_command(
            [codex, "plugin", "list"],
            cwd=repo_root,
        ).stdout
        require_installed_plugin(plugin_list, destination)


def default_codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME")
    return Path(configured) if configured else Path.home() / ".codex"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    install_parser = subparsers.add_parser("install", help="Install the global xagent plugin")
    install_parser.add_argument("--repo-root", type=Path, default=REPO_ROOT, help=argparse.SUPPRESS)
    install_parser.add_argument("--home", type=Path, default=Path.home())
    install_parser.add_argument("--codex-home", type=Path, default=default_codex_home())
    install_parser.add_argument("--codex", default="codex")
    install_parser.add_argument("--cachebuster", help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        install_global(
            repo_root=args.repo_root,
            home=args.home,
            codex_home=args.codex_home,
            codex=args.codex,
            cachebuster=args.cachebuster,
        )
    except (OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
