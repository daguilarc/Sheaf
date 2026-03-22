"""Filesystem tools with visibility enforcement and vault-backed write logging."""

from __future__ import annotations

from pathlib import Path

from sheaf.tools.patching import apply_patch_envelope_update, parse_patch_envelope
from sheaf.tools.simple_tool import tool
from sheaf.tools.visibility import ensure_visible, resolve_input_path
from sheaf.vaults.logging import WriteOperation, record_filesystem_write


def _display(path: Path) -> str:
    resolved = path.resolve()
    home = Path.home().resolve()
    try:
        rel = resolved.relative_to(home)
    except ValueError:
        return str(resolved)
    return f"~/{rel.as_posix()}"


def _resolve_visible_directory(path_text: str) -> Path:
    candidate = resolve_input_path(path_text, default_to_repo_root=True)
    ensure_visible(candidate)
    if not candidate.exists():
        raise ValueError(f"Path does not exist: {candidate}")
    if not candidate.is_dir():
        raise ValueError(f"Path is not a directory: {candidate}")
    return candidate


def _is_visible_entry(path: Path) -> bool:
    try:
        ensure_visible(path)
        return True
    except ValueError:
        return False


@tool("list_directory")
def list_directory_tool(path: str = ".", recursive: bool = False) -> str:
    """List entries under a visible directory path."""

    target = _resolve_visible_directory("" if path == "." else path)
    if recursive:
        entries = sorted(_display(item) for item in target.rglob("*") if _is_visible_entry(item))
    else:
        entries = sorted(_display(item) for item in target.iterdir() if _is_visible_entry(item))
    if not entries:
        return f"No entries under {_display(target)}"
    return "\n".join([f"Directory: {_display(target)}", *entries])


@tool("read_file")
def read_file_tool(path: str, start_line: int = 0, end_line: int = 0) -> str:
    """Read a visible UTF-8 file, optionally by line range."""

    target = resolve_input_path(path)
    ensure_visible(target)
    if not target.exists():
        raise ValueError(f"File does not exist: {target}")
    if not target.is_file():
        raise ValueError(f"Path is not a file: {target}")
    text = target.read_text(encoding="utf-8")
    if start_line <= 0 and end_line <= 0:
        return text
    lines = text.splitlines()
    total = len(lines)
    start_idx = max(0, start_line - 1)
    end_idx = total if end_line <= 0 else min(total, end_line - 1)
    if end_idx < start_idx:
        raise ValueError("end_line must be greater than or equal to start_line")
    return "\n".join(lines[start_idx:end_idx])


@tool("create_file")
def create_file_tool(path: str, content: str, overwrite: bool = False) -> str:
    """Create or overwrite a UTF-8 file and record the write in the vault log."""

    result = record_filesystem_write(
        WriteOperation(
            kind="create_file",
            path=resolve_input_path(path),
            content=content,
            overwrite=overwrite,
        )
    )
    return result.message


@tool("create_directory")
def create_directory_tool(path: str) -> str:
    """Create a directory and record the write in the vault log."""

    result = record_filesystem_write(WriteOperation(kind="create_directory", path=resolve_input_path(path)))
    return result.message


@tool(
    "apply_patch",
    description=(
        "Apply the OpenAI/Codex patch envelope to visible UTF-8 files. "
        "Send one string in `patch` using `*** Begin Patch`, one or more file sections "
        "like `*** Update File:`, `*** Add File:`, or `*** Delete File:`, and finish with "
        "`*** End Patch`. Do not send raw unified diff hunks."
    ),
)
def apply_patch_tool(patch: str) -> str:
    """Apply the OpenAI/Codex patch envelope to visible UTF-8 files."""

    operations = parse_patch_envelope(patch)
    messages: list[str] = []
    for operation in operations:
        path = resolve_input_path(operation.path)
        if operation.kind == "update":
            ensure_visible(path)
            if not path.exists() or not path.is_file():
                raise ValueError(f"File does not exist: {path}")
            original = path.read_text(encoding="utf-8")
            patch_text = apply_patch_envelope_update(original, str(path), operation.hunk_lines or [])
            result = record_filesystem_write(
                WriteOperation(kind="patch_file", path=path, patch=patch_text)
            )
        elif operation.kind == "add":
            result = record_filesystem_write(
                WriteOperation(kind="create_file", path=path, content=operation.content or "", overwrite=False)
            )
        else:
            result = record_filesystem_write(WriteOperation(kind="delete_path", path=path))
        messages.append(result.message)
    return "\n".join(messages)


@tool("move_path")
def move_path_tool(source_path: str, destination_path: str) -> str:
    """Move or rename a file or directory and record the write in the vault log."""

    source = resolve_input_path(source_path)
    destination = resolve_input_path(destination_path)
    kind = "move_directory" if source.exists() and source.is_dir() else "move_file"
    result = record_filesystem_write(WriteOperation(kind=kind, path=source, new_path=destination))
    return result.message


@tool("delete_path")
def delete_path_tool(path: str) -> str:
    """Delete a file or empty directory and record the write in the vault log."""

    result = record_filesystem_write(WriteOperation(kind="delete_path", path=resolve_input_path(path)))
    return result.message
