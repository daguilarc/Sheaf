#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PLUGIN_ROOT.parents[1]
XAGENT_ROOT = REPO_ROOT / "projects" / "xagent"
ASSET_ROOT = PLUGIN_ROOT / "assets" / "xagent"
PACKAGE_DIRECTORIES = (".codex-plugin", "skills", "scripts")


def run(
    args: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(
        args,
        cwd=cwd,
        env=merged_env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )


def copy_runtime(asset_root: Path) -> None:
    run(["npm", "run", "build"], cwd=XAGENT_ROOT)
    if asset_root.exists():
        shutil.rmtree(asset_root)
    (asset_root / "dist").mkdir(parents=True)
    shutil.copy2(XAGENT_ROOT / "package.json", asset_root / "package.json")
    shutil.copytree(XAGENT_ROOT / "dist" / "src", asset_root / "dist" / "src")


def build_package(destination: Path) -> None:
    destination = destination.resolve()
    if destination.exists():
        if not destination.is_dir():
            raise RuntimeError(f"package output destination is not a directory: {destination}")
        if any(destination.iterdir()):
            raise RuntimeError(
                f"refusing to use non-empty package output destination: {destination}"
            )
    else:
        destination.mkdir(parents=True)
    for directory in PACKAGE_DIRECTORIES:
        shutil.copytree(
            PLUGIN_ROOT / directory,
            destination / directory,
            copy_function=shutil.copy2,
        )
    copy_runtime(destination / "assets" / "xagent")


def stage_runtime() -> None:
    copy_runtime(ASSET_ROOT)


def validate_launcher(plugin_root: Path) -> None:
    launcher = plugin_root / "scripts" / "xagent"
    with tempfile.TemporaryDirectory(prefix="xagent-plugin-help-") as tempdir:
        help_result = run([str(launcher), "--help"], cwd=Path(tempdir))
    if "xagent run" not in help_result.stdout:
        raise RuntimeError("packaged launcher help output did not include xagent usage")
    with tempfile.TemporaryDirectory(prefix="xagent-plugin-repo-") as tempdir:
        repo = Path(tempdir)
        log_root = repo.parent / f"{repo.name}-central-log"
        run(
            [str(launcher), "run", "--harness", "codex", "--subagent", "hello"],
            cwd=repo,
            env={"XAGENT_TEST_ADAPTER": "fake", "XAGENT_LOG_ROOT": str(log_root)},
        )
        if not log_root.is_dir():
            raise RuntimeError("packaged launcher did not write logs under the configured log root")
        if (repo / "data" / "xagent").exists():
            raise RuntimeError("packaged launcher wrote logs under the active repository")
    validate_missing_runtime_error(plugin_root, launcher)


def validate_missing_runtime_error(plugin_root: Path, launcher: Path) -> None:
    entrypoint = plugin_root / "assets" / "xagent" / "dist" / "src" / "main.js"
    hidden_entrypoint = entrypoint.with_name("main.js.hidden-for-validation")
    entrypoint.rename(hidden_entrypoint)
    try:
        with tempfile.TemporaryDirectory(prefix="xagent-plugin-missing-runtime-") as tempdir:
            result = subprocess.run(
                [str(launcher), "--help"],
                cwd=Path(tempdir),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        if result.returncode == 0:
            raise RuntimeError("launcher succeeded even though packaged runtime was missing")
        if "xagent packaged runtime is missing" not in result.stderr:
            raise RuntimeError("missing runtime error did not name the missing packaged asset")
    finally:
        hidden_entrypoint.rename(entrypoint)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build and validate the xagent Codex plugin.")
    parser.add_argument(
        "--output",
        type=Path,
        help="Build a complete plugin package at this untracked destination.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.output is None:
        stage_runtime()
        package_root = PLUGIN_ROOT
        message = f"staged xagent runtime in {ASSET_ROOT}"
    else:
        package_root = args.output.expanduser().resolve()
        build_package(package_root)
        message = f"staged xagent plugin package in {package_root}"
    validate_launcher(package_root)
    print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
