"""Filesystem, git, and role-profile adapters for the state machine runtime."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Callable

from .. import quest_fs
from ..quest_service import FatalInvariantError
from ..quest_types import RoleProfile, StateMachineId, StateMachineState
from .commit_metadata import (
    CommitMetadataValidationError,
    parse_step_commit_message,
    validate_parsed_step_commit,
)
from .machine import ConcreteStateMachine
from .protocols import StateIo, StateMachineDefinition


def find_quest_root_for_machine_dir(state_machine_dir: Path) -> Path | None:
    """Walk parents until a directory contains both ``meta.json`` and ``state_execution_config.yaml``."""
    cur = state_machine_dir.resolve()
    while True:
        if (cur / "state_execution_config.yaml").is_file() and (cur / "meta.json").is_file():
            return cur
        parent = cur.parent
        if parent == cur:
            return None
        cur = parent


class QuestRootRoleProfileResolver:
    """Resolves role profiles from quest-root ``state_execution_config.yaml`` (version 2 only)."""

    def ResolveRoleProfile(self, state_machine_dir: Path, role: str) -> RoleProfile:
        root = find_quest_root_for_machine_dir(state_machine_dir)
        if root is None:
            raise FatalInvariantError(
                f"No quest root (meta.json + state_execution_config.yaml) found "
                f"at or above {state_machine_dir}"
            )
        try:
            version = quest_fs.read_state_execution_config_version(root)
        except (FileNotFoundError, ValueError) as e:
            raise FatalInvariantError(
                f"Cannot read execution config version for quest root {root}: {e}"
            ) from e
        if version != 2:
            raise FatalInvariantError(
                f"state_execution_config.yaml at {root} must be version 2 "
                f"for state machine role resolution (got {version})"
            )
        try:
            profiles = quest_fs.read_execution_config(root)
        except (FileNotFoundError, ValueError) as e:
            raise FatalInvariantError(
                f"Cannot read execution config at {root}: {e}"
            ) from e
        if role not in profiles:
            raise FatalInvariantError(f"Unknown role profile {role!r} in {root}")
        ep = profiles[role]
        return RoleProfile(
            harness=ep.harness.value,
            model=ep.model,
            reasoning_effort=ep.reasoning_effort,
            idle_timeout_seconds=ep.idle_timeout_seconds,
            modify_allow=tuple(ep.modify_allow),
            modify_block=tuple(ep.modify_block),
        )


class FileStateIo:
    """Reads and writes normalized ``state.md`` using :mod:`conductor.quest_fs`."""

    def __init__(self, top_level_machine_dir: Path) -> None:
        self._top = top_level_machine_dir.resolve()

    def ReadStateMachineState(self, state_machine_dir: Path) -> StateMachineState:
        require_gs = state_machine_dir.resolve() == self._top
        return quest_fs.read_normalized_machine_state(
            state_machine_dir,
            require_global_step=require_gs,
        )

    def WriteStateMachineState(
        self, state_machine_dir: Path, state: StateMachineState
    ) -> None:
        quest_fs.write_normalized_machine_state(state_machine_dir, state)


def _git_checked(repo_root: Path, *git_args: str) -> subprocess.CompletedProcess[str]:
    r = subprocess.run(
        ["git", "-C", str(repo_root), *git_args],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").strip()
        raise FatalInvariantError(f"git {' '.join(git_args)} failed: {err}")
    return r


class SubprocessGitOps:
    """Minimal git operations backed by the ``git`` CLI."""

    def IsClean(self, repo_root: Path) -> bool:
        r = _git_checked(repo_root, "status", "--porcelain")
        return not (r.stdout or "").strip()

    def GetHeadSha(self, repo_root: Path) -> str:
        r = _git_checked(repo_root, "rev-parse", "HEAD")
        return r.stdout.strip()

    def StageAll(self, repo_root: Path) -> None:
        _git_checked(repo_root, "add", "-A")

    def HasStagedChanges(self, repo_root: Path) -> bool:
        r = _git_checked(
            repo_root,
            "diff",
            "--cached",
            "--name-only",
        )
        return bool((r.stdout or "").strip())

    def Commit(self, repo_root: Path, message: str) -> str:
        _git_checked(repo_root, "commit", "-m", message)
        return self.GetHeadSha(repo_root)

    def ReadGlobalStep(self, repo_root: Path, state_machine_id: StateMachineId) -> int:
        target = state_machine_id.machine_path.replace("\\", "/")
        r = subprocess.run(
            ["git", "-C", str(repo_root), "log", "-z", "--format=%B"],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            quest_dir = repo_root / target
            hist = quest_fs.read_history(quest_dir / "state_history.md")
            return len(hist)
        for blob in (r.stdout or "").split("\0"):
            if not blob.strip():
                continue
            parsed = parse_step_commit_message(blob)
            if parsed is None:
                continue
            if parsed.metadata.snapshot.machine_path != target:
                continue
            try:
                validate_parsed_step_commit(parsed)
            except CommitMetadataValidationError:
                continue
            return parsed.metadata.global_step
        quest_dir = repo_root / target
        hist = quest_fs.read_history(quest_dir / "state_history.md")
        return len(hist)


class RegistryStateMachineLoader:
    """Maps absolute machine directories to definition factories."""

    def __init__(self, state_io: StateIo) -> None:
        self._state_io = state_io
        self._factories: dict[str, Callable[[Path], StateMachineDefinition]] = {}

    def register(
        self,
        state_machine_dir: Path,
        factory: Callable[[Path], StateMachineDefinition],
    ) -> None:
        self._factories[str(state_machine_dir.resolve())] = factory

    def LoadStateMachine(self, state_machine_dir: Path) -> ConcreteStateMachine:
        key = str(state_machine_dir.resolve())
        fac = self._factories.get(key)
        if fac is None:
            raise KeyError(f"No state machine registered for directory {key}")
        definition = fac(state_machine_dir)
        return ConcreteStateMachine(state_machine_dir, definition, self._state_io)

    def LoadTopStateMachine(self, machine_root_dir: Path) -> ConcreteStateMachine:
        return self.LoadStateMachine(machine_root_dir)
