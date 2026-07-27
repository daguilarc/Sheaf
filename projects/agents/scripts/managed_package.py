"""Shared helpers for Sheaf-managed package trees (markers + atomic install)."""

from __future__ import annotations

import os
import shutil
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path


MANAGED_MARKER = "sheaf-agents-managed: DO NOT EDIT"
MANAGED_MARKER_NAME = ".sheaf-managed"

CopyIgnore = Callable[[str, list[str]], set[str]]


def managed_marker_content(*, source: str, revision: str, version: str) -> str:
    return (
        f"{MANAGED_MARKER}\n"
        f"source={source}\n"
        f"revision={revision}\n"
        f"version={version}\n"
    )


def package_is_managed(package_root: Path) -> bool:
    marker = package_root / MANAGED_MARKER_NAME
    if not marker.is_file():
        return False
    try:
        content = marker.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    return MANAGED_MARKER in content


def replace_managed_destination(staged: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    backup = destination.with_name(f".{destination.name}-backup-{uuid.uuid4().hex}")
    had_destination = destination.exists()
    if had_destination:
        os.replace(destination, backup)
    try:
        os.replace(staged, destination)
    except OSError:
        if had_destination and backup.exists() and not destination.exists():
            os.replace(backup, destination)
        raise
    if had_destination and backup.exists():
        shutil.rmtree(backup)


def stage_package(
    source: Path,
    destination: Path,
    *,
    marker_text: str,
    copy_ignore: CopyIgnore | None = None,
    copy_function: Callable[[str, str], object] = shutil.copy2,
) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    staged = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}-stage-", dir=destination.parent)
    )
    try:
        shutil.copytree(
            source,
            staged,
            symlinks=False,
            dirs_exist_ok=True,
            copy_function=copy_function,
            ignore=copy_ignore,
        )
        (staged / MANAGED_MARKER_NAME).write_text(marker_text, encoding="utf-8")
    except Exception:
        shutil.rmtree(staged, ignore_errors=True)
        raise
    return staged


def install_package_tree(
    source: Path,
    destination: Path,
    *,
    marker_text: str,
    copy_ignore: CopyIgnore | None = None,
    copy_function: Callable[[str, str], object] = shutil.copy2,
) -> None:
    staged = stage_package(
        source,
        destination,
        marker_text=marker_text,
        copy_ignore=copy_ignore,
        copy_function=copy_function,
    )
    try:
        replace_managed_destination(staged, destination)
    finally:
        shutil.rmtree(staged, ignore_errors=True)
