#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PLUGIN_ROOT.parents[1]
XAGENT_ROOT = REPO_ROOT / "projects" / "xagent"
ASSET_ROOT = PLUGIN_ROOT / "assets" / "xagent"


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


def stage_runtime() -> None:
    run(["npm", "run", "build"], cwd=XAGENT_ROOT)
    if ASSET_ROOT.exists():
        shutil.rmtree(ASSET_ROOT)
    (ASSET_ROOT / "dist").mkdir(parents=True)
    shutil.copy2(XAGENT_ROOT / "package.json", ASSET_ROOT / "package.json")
    shutil.copytree(XAGENT_ROOT / "dist" / "src", ASSET_ROOT / "dist" / "src")


def validate_launcher() -> None:
    launcher = PLUGIN_ROOT / "scripts" / "xagent"
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
    validate_missing_runtime_error(launcher)


def validate_missing_runtime_error(launcher: Path) -> None:
    entrypoint = ASSET_ROOT / "dist" / "src" / "main.js"
    hidden_entrypoint = entrypoint.with_name("main.js.hidden-for-validation")
    entrypoint.rename(hidden_entrypoint)
    try:
        result = subprocess.run(
            [str(launcher), "--help"],
            cwd=Path(tempfile.mkdtemp(prefix="xagent-plugin-missing-runtime-")),
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


def main() -> int:
    stage_runtime()
    validate_launcher()
    print(f"staged xagent runtime in {ASSET_ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
