#!/usr/bin/env python3
"""Install, check, and clean Sheaf-managed Superpowers plugins for four harnesses."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import tomllib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence


PLUGIN_NAME = "superpowers"
MARKETPLACE_NAME = "sheaf-managed"
CLAUDE_PLUGIN_KEY = f"{PLUGIN_NAME}@{MARKETPLACE_NAME}"
MANAGED_MARKER_NAME = ".sheaf-managed"
MANAGED_MARKER = "sheaf-agents-managed: DO NOT EDIT"
VENDOR_REL = Path("projects") / "agents" / "vendor" / "superpowers"
VENDOR_TREE_REL = VENDOR_REL / "tree"
REQUIRED_PIN_FIELDS = ("url", "revision", "version", "retrieved_at")
COPY_IGNORE = shutil.ignore_patterns(
    ".git",
    ".git/*",
    "__pycache__",
    "*.pyc",
    ".DS_Store",
    ".in_use",
    ".orphaned_at",
)


def repo_root_from_script() -> Path:
    return Path(__file__).resolve().parents[3]


def default_codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME")
    return Path(configured) if configured else Path.home() / ".codex"


def read_vendor_pin(repo_root: Path) -> dict[str, str]:
    path = repo_root / VENDOR_REL / "VENDOR.toml"
    if not path.is_file():
        raise ValueError(f"missing Superpowers vendor pin: {path}")
    raw = tomllib.loads(path.read_text(encoding="utf-8"))
    missing = [field for field in REQUIRED_PIN_FIELDS if field not in raw]
    if missing:
        raise ValueError(
            f"{path}: missing required pin fields: {', '.join(missing)}"
        )
    pin: dict[str, str] = {}
    for field in REQUIRED_PIN_FIELDS:
        value = raw[field]
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{path}: {field} must be a non-empty string")
        pin[field] = value
    return pin


def managed_marker_content(pin: dict[str, str]) -> str:
    return (
        f"{MANAGED_MARKER}\n"
        f"source={VENDOR_TREE_REL.as_posix()}\n"
        f"revision={pin['revision']}\n"
        f"version={pin['version']}\n"
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


def marker_matches_pin(package_root: Path, pin: dict[str, str]) -> bool:
    marker = package_root / MANAGED_MARKER_NAME
    if not marker.is_file():
        return False
    content = marker.read_text(encoding="utf-8")
    return (
        MANAGED_MARKER in content
        and f"revision={pin['revision']}" in content
        and f"version={pin['version']}" in content
    )


def vendor_tree(repo_root: Path) -> Path:
    path = repo_root / VENDOR_TREE_REL
    if not path.is_dir():
        raise FileNotFoundError(f"missing Superpowers vendor tree: {path}")
    return path


def claude_package_path(home: Path, version: str) -> Path:
    return (
        home
        / ".claude"
        / "plugins"
        / "cache"
        / MARKETPLACE_NAME
        / PLUGIN_NAME
        / version
    )


def cursor_package_path(home: Path) -> Path:
    return home / ".cursor" / "plugins" / "local" / PLUGIN_NAME


def codex_package_path(home: Path) -> Path:
    return home / ".agents" / "plugins" / "plugins" / PLUGIN_NAME


def pi_package_path(home: Path) -> Path:
    return home / ".pi" / "packages" / MARKETPLACE_NAME / PLUGIN_NAME


def claude_installed_plugins_path(home: Path) -> Path:
    return home / ".claude" / "plugins" / "installed_plugins.json"


def claude_known_marketplaces_path(home: Path) -> Path:
    return home / ".claude" / "plugins" / "known_marketplaces.json"


def claude_marketplace_root(home: Path) -> Path:
    return home / ".claude" / "plugins" / "marketplaces" / MARKETPLACE_NAME


def codex_marketplace_path(home: Path) -> Path:
    return home / ".agents" / "plugins" / "marketplace.json"


def pi_settings_path(home: Path) -> Path:
    return home / ".pi" / "agent" / "settings.json"


def require_managed_or_absent(destination: Path, *, force: bool) -> int:
    if not destination.exists():
        return 0
    if package_is_managed(destination):
        return 0
    if force:
        return 0
    print(f"conflict unmanaged {destination}", file=sys.stderr)
    return 1


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


def stage_package(source: Path, destination: Path, pin: dict[str, str]) -> Path:
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
            copy_function=shutil.copy2,
            ignore=COPY_IGNORE,
        )
        (staged / MANAGED_MARKER_NAME).write_text(
            managed_marker_content(pin),
            encoding="utf-8",
        )
    except Exception:
        shutil.rmtree(staged, ignore_errors=True)
        raise
    return staged


def install_package_tree(
    source: Path,
    destination: Path,
    pin: dict[str, str],
    *,
    force: bool,
) -> int:
    if require_managed_or_absent(destination, force=force) != 0:
        return 1
    staged = stage_package(source, destination, pin)
    try:
        replace_managed_destination(staged, destination)
    finally:
        shutil.rmtree(staged, ignore_errors=True)
    print(f"wrote {destination}")
    return 0


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def load_json_object(path: Path, default: dict[str, object]) -> dict[str, object]:
    if not path.is_file():
        return dict(default)
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise RuntimeError(f"{path} must contain a JSON object")
    return raw


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def ensure_claude_marketplace(home: Path, pin: dict[str, str]) -> None:
    marketplace_root = claude_marketplace_root(home)
    plugin_dir = marketplace_root / ".claude-plugin"
    plugin_dir.mkdir(parents=True, exist_ok=True)
    marketplace = {
        "name": MARKETPLACE_NAME,
        "description": "Sheaf-managed local plugins",
        "owner": {"name": "Sheaf"},
        "plugins": [
            {
                "name": PLUGIN_NAME,
                "description": "Vendored Superpowers skills library",
                "version": pin["version"],
                "source": "./",
            }
        ],
    }
    write_json(plugin_dir / "marketplace.json", marketplace)

    known_path = claude_known_marketplaces_path(home)
    known = load_json_object(known_path, {})
    known[MARKETPLACE_NAME] = {
        "source": {"source": "sheaf-managed", "path": str(marketplace_root)},
        "installLocation": str(marketplace_root.resolve()),
        "lastUpdated": utc_now_iso(),
    }
    write_json(known_path, known)


def merge_claude_installed_plugins(
    home: Path,
    destination: Path,
    pin: dict[str, str],
    *,
    force: bool,
) -> int:
    path = claude_installed_plugins_path(home)
    payload = load_json_object(path, {"version": 2, "plugins": {}})
    plugins = payload.setdefault("plugins", {})
    if not isinstance(plugins, dict):
        raise RuntimeError(f"{path} field 'plugins' must be an object")

    existing = plugins.get(CLAUDE_PLUGIN_KEY)
    if existing is not None and not force:
        install_path = None
        if isinstance(existing, list) and existing:
            first = existing[0]
            if isinstance(first, dict):
                install_path = first.get("installPath")
        if install_path is not None:
            existing_path = Path(str(install_path))
            if existing_path.exists() and not package_is_managed(existing_path):
                print(
                    f"conflict unmanaged registry key {CLAUDE_PLUGIN_KEY}",
                    file=sys.stderr,
                )
                return 1

    now = utc_now_iso()
    installed_at = now
    if isinstance(existing, list) and existing and isinstance(existing[0], dict):
        previous = existing[0].get("installedAt")
        if isinstance(previous, str) and previous:
            installed_at = previous

    plugins[CLAUDE_PLUGIN_KEY] = [
        {
            "scope": "user",
            "installPath": str(destination.resolve()),
            "version": pin["version"],
            "installedAt": installed_at,
            "lastUpdated": now,
            "gitCommitSha": pin["revision"],
        }
    ]
    payload["version"] = payload.get("version", 2)
    write_json(path, payload)
    print(f"wrote {path}")
    return 0


def marketplace_source_path(*, home: Path, destination: Path) -> str:
    try:
        relative = destination.resolve().relative_to(home.resolve())
    except ValueError:
        return str(destination.resolve())
    return f"./{relative.as_posix()}"


def upsert_codex_marketplace(home: Path, destination: Path, *, force: bool) -> int:
    path = codex_marketplace_path(home)
    payload = load_json_object(
        path,
        {
            "name": "personal",
            "interface": {"displayName": "Personal"},
            "plugins": [],
        },
    )
    plugins = payload.setdefault("plugins", [])
    if not isinstance(plugins, list):
        raise RuntimeError(f"{path} field 'plugins' must be an array")

    source_path = marketplace_source_path(home=home, destination=destination)
    for index, entry in enumerate(plugins):
        if not isinstance(entry, dict) or entry.get("name") != PLUGIN_NAME:
            continue
        existing_source = entry.get("source")
        existing_path = None
        if isinstance(existing_source, dict):
            raw_path = existing_source.get("path")
            if isinstance(raw_path, str):
                candidate = Path(raw_path)
                if not candidate.is_absolute():
                    candidate = home / candidate
                existing_path = candidate
        if (
            existing_path is not None
            and existing_path.exists()
            and not package_is_managed(existing_path)
            and not force
        ):
            print(
                f"conflict unmanaged marketplace entry {PLUGIN_NAME}",
                file=sys.stderr,
            )
            return 1
        entry = dict(entry)
        source = entry.get("source")
        if not isinstance(source, dict):
            source = {}
        source = dict(source)
        source["source"] = "local"
        source["path"] = source_path
        entry["source"] = source
        entry.setdefault(
            "policy",
            {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        )
        entry.setdefault("category", "Developer Tools")
        plugins[index] = entry
        write_json(path, payload)
        print(f"wrote {path}")
        return 0

    plugins.append(
        {
            "name": PLUGIN_NAME,
            "source": {"source": "local", "path": source_path},
            "policy": {
                "installation": "AVAILABLE",
                "authentication": "ON_INSTALL",
            },
            "category": "Developer Tools",
        }
    )
    write_json(path, payload)
    print(f"wrote {path}")
    return 0


def upsert_pi_settings(home: Path, destination: Path) -> None:
    path = pi_settings_path(home)
    payload = load_json_object(path, {"packages": []})
    packages = payload.setdefault("packages", [])
    if not isinstance(packages, list):
        raise RuntimeError(f"{path} field 'packages' must be an array")
    target = str(destination.resolve())
    resolved_existing = []
    for item in packages:
        if not isinstance(item, str):
            resolved_existing.append(item)
            continue
        if item == target:
            continue
        candidate = Path(item)
        if not candidate.is_absolute():
            # Keep relative foreign entries as-is.
            #
            resolved_existing.append(item)
            continue
        if candidate.resolve() == destination.resolve():
            continue
        resolved_existing.append(item)
    resolved_existing.append(target)
    payload["packages"] = resolved_existing
    write_json(path, payload)
    print(f"wrote {path}")


def install_superpowers(
    *,
    repo_root: Path,
    home: Path,
    codex_home: Path,
    force: bool = False,
) -> int:
    del codex_home  # Superpowers must not mutate Sheaf $CODEX_HOME/hooks.json.
    repo_root = repo_root.expanduser().resolve()
    home = home.expanduser().resolve()
    pin = read_vendor_pin(repo_root)
    source = vendor_tree(repo_root)
    version = pin["version"]

    destinations = (
        claude_package_path(home, version),
        cursor_package_path(home),
        codex_package_path(home),
        pi_package_path(home),
    )
    for destination in destinations:
        status = install_package_tree(source, destination, pin, force=force)
        if status != 0:
            return status

    ensure_claude_marketplace(home, pin)
    status = merge_claude_installed_plugins(
        home,
        claude_package_path(home, version),
        pin,
        force=force,
    )
    if status != 0:
        return status

    status = upsert_codex_marketplace(home, codex_package_path(home), force=force)
    if status != 0:
        return status

    upsert_pi_settings(home, pi_package_path(home))
    return 0


def check_package(destination: Path, pin: dict[str, str], label: str) -> int:
    if not destination.is_dir():
        print(f"missing {label} package {destination}", file=sys.stderr)
        return 1
    if not package_is_managed(destination):
        print(f"conflict unmanaged {destination}", file=sys.stderr)
        return 1
    if not marker_matches_pin(destination, pin):
        print(f"stale {label} package pin at {destination}", file=sys.stderr)
        return 1
    return 0


def check_claude_registry(home: Path, destination: Path) -> int:
    path = claude_installed_plugins_path(home)
    if not path.is_file():
        print(f"missing {path}", file=sys.stderr)
        return 1
    payload = json.loads(path.read_text(encoding="utf-8"))
    plugins = payload.get("plugins")
    if not isinstance(plugins, dict) or CLAUDE_PLUGIN_KEY not in plugins:
        print(f"missing registry key {CLAUDE_PLUGIN_KEY}", file=sys.stderr)
        return 1
    entries = plugins[CLAUDE_PLUGIN_KEY]
    if not isinstance(entries, list) or not entries:
        print(f"invalid registry key {CLAUDE_PLUGIN_KEY}", file=sys.stderr)
        return 1
    install_path = entries[0].get("installPath") if isinstance(entries[0], dict) else None
    if str(destination.resolve()) != str(Path(str(install_path)).resolve()):
        print(
            f"registry {CLAUDE_PLUGIN_KEY} points at {install_path}, expected {destination}",
            file=sys.stderr,
        )
        return 1
    return 0


def check_codex_marketplace(home: Path, destination: Path) -> int:
    path = codex_marketplace_path(home)
    if not path.is_file():
        print(f"missing {path}", file=sys.stderr)
        return 1
    payload = json.loads(path.read_text(encoding="utf-8"))
    plugins = payload.get("plugins")
    if not isinstance(plugins, list):
        print(f"{path} field 'plugins' must be an array", file=sys.stderr)
        return 1
    matches = [entry for entry in plugins if isinstance(entry, dict) and entry.get("name") == PLUGIN_NAME]
    if len(matches) != 1:
        print(f"missing marketplace entry {PLUGIN_NAME}", file=sys.stderr)
        return 1
    source = matches[0].get("source")
    if not isinstance(source, dict) or source.get("source") != "local":
        print(f"marketplace entry {PLUGIN_NAME} is not local", file=sys.stderr)
        return 1
    raw_path = source.get("path")
    if not isinstance(raw_path, str):
        print(f"marketplace entry {PLUGIN_NAME} missing path", file=sys.stderr)
        return 1
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = home / candidate
    if candidate.resolve() != destination.resolve():
        print(
            f"marketplace {PLUGIN_NAME} points at {candidate}, expected {destination}",
            file=sys.stderr,
        )
        return 1
    return 0


def check_pi_settings(home: Path, destination: Path) -> int:
    path = pi_settings_path(home)
    if not path.is_file():
        print(f"missing {path}", file=sys.stderr)
        return 1
    payload = json.loads(path.read_text(encoding="utf-8"))
    packages = payload.get("packages")
    if not isinstance(packages, list):
        print(f"{path} field 'packages' must be an array", file=sys.stderr)
        return 1
    target = str(destination.resolve())
    if target not in packages:
        print(f"missing pi package entry {target}", file=sys.stderr)
        return 1
    return 0


def check_superpowers(
    *,
    repo_root: Path,
    home: Path,
    codex_home: Path,
) -> int:
    del codex_home
    repo_root = repo_root.expanduser().resolve()
    home = home.expanduser().resolve()
    pin = read_vendor_pin(repo_root)
    version = pin["version"]
    status = 0
    checks = (
        (claude_package_path(home, version), "claude"),
        (cursor_package_path(home), "cursor"),
        (codex_package_path(home), "codex"),
        (pi_package_path(home), "pi"),
    )
    for destination, label in checks:
        status |= check_package(destination, pin, label)
    status |= check_claude_registry(home, claude_package_path(home, version))
    status |= check_codex_marketplace(home, codex_package_path(home))
    status |= check_pi_settings(home, pi_package_path(home))
    return status


def remove_managed_package(destination: Path) -> None:
    if destination.is_dir() and package_is_managed(destination):
        shutil.rmtree(destination)
        print(f"removed {destination}")


def clean_claude_registry(home: Path) -> None:
    path = claude_installed_plugins_path(home)
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    plugins = payload.get("plugins")
    if not isinstance(plugins, dict) or CLAUDE_PLUGIN_KEY not in plugins:
        return
    del plugins[CLAUDE_PLUGIN_KEY]
    write_json(path, payload)
    print(f"wrote {path}")


def clean_codex_marketplace(home: Path) -> None:
    path = codex_marketplace_path(home)
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    plugins = payload.get("plugins")
    if not isinstance(plugins, list):
        return
    destination = codex_package_path(home)
    expected = marketplace_source_path(home=home, destination=destination)
    kept: list[object] = []
    changed = False
    for entry in plugins:
        if not (isinstance(entry, dict) and entry.get("name") == PLUGIN_NAME):
            kept.append(entry)
            continue
        source = entry.get("source")
        if not isinstance(source, dict) or source.get("source") != "local":
            kept.append(entry)
            continue
        raw_path = source.get("path")
        if not isinstance(raw_path, str):
            kept.append(entry)
            continue
        candidate = Path(raw_path)
        if not candidate.is_absolute():
            candidate = home / candidate
        if raw_path == expected or candidate.resolve() == destination.resolve():
            changed = True
            continue
        kept.append(entry)
    if changed:
        payload["plugins"] = kept
        write_json(path, payload)
        print(f"wrote {path}")


def clean_pi_settings(home: Path) -> None:
    path = pi_settings_path(home)
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    packages = payload.get("packages")
    if not isinstance(packages, list):
        return
    destination = pi_package_path(home)
    target = str(destination.resolve())
    kept = [item for item in packages if item != target]
    if kept != packages:
        payload["packages"] = kept
        write_json(path, payload)
        print(f"wrote {path}")


def clean_superpowers(*, home: Path, codex_home: Path) -> int:
    del codex_home
    home = home.expanduser().resolve()
    # Discover managed Claude versioned packages under sheaf-managed cache.
    #
    claude_root = home / ".claude" / "plugins" / "cache" / MARKETPLACE_NAME / PLUGIN_NAME
    if claude_root.is_dir():
        for child in sorted(claude_root.iterdir()):
            remove_managed_package(child)
        if claude_root.is_dir() and not any(claude_root.iterdir()):
            claude_root.rmdir()

    remove_managed_package(cursor_package_path(home))
    remove_managed_package(codex_package_path(home))
    remove_managed_package(pi_package_path(home))

    clean_claude_registry(home)
    clean_codex_marketplace(home)
    clean_pi_settings(home)

    marketplace_root = claude_marketplace_root(home)
    if marketplace_root.is_dir():
        marker = marketplace_root / ".claude-plugin" / "marketplace.json"
        if marker.is_file():
            try:
                payload = json.loads(marker.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                payload = {}
            if payload.get("name") == MARKETPLACE_NAME:
                shutil.rmtree(marketplace_root)
                print(f"removed {marketplace_root}")
    known_path = claude_known_marketplaces_path(home)
    if known_path.is_file():
        known = json.loads(known_path.read_text(encoding="utf-8"))
        if isinstance(known, dict) and MARKETPLACE_NAME in known:
            record = known[MARKETPLACE_NAME]
            if isinstance(record, dict) and record.get("source", {}).get("source") in (
                "sheaf-managed",
                "local",
            ):
                del known[MARKETPLACE_NAME]
                write_json(known_path, known)
                print(f"wrote {known_path}")
    return 0


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("install", "check", "clean"))
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=repo_root_from_script(),
        help="Repository root. Defaults to the parent of projects/.",
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=Path.home(),
        help="Home directory for harness plugin outputs.",
    )
    parser.add_argument(
        "--codex-home",
        type=Path,
        default=None,
        help="Codex home (unused for Superpowers hooks; accepted for CLI parity).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite unmanaged same-key Superpowers destinations/registry entries.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    codex_home = args.codex_home if args.codex_home is not None else default_codex_home()
    try:
        if args.mode == "install":
            return install_superpowers(
                repo_root=args.repo_root,
                home=args.home,
                codex_home=codex_home,
                force=args.force,
            )
        if args.mode == "check":
            return check_superpowers(
                repo_root=args.repo_root,
                home=args.home,
                codex_home=codex_home,
            )
        if args.mode == "clean":
            return clean_superpowers(home=args.home, codex_home=codex_home)
    except (OSError, RuntimeError, ValueError, FileNotFoundError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    raise AssertionError(args.mode)


if __name__ == "__main__":
    raise SystemExit(main())
