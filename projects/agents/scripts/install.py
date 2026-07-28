#!/usr/bin/env python3
"""Render shared agent guidance into harness-specific install locations."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from pathlib import Path

from managed_package import (
    MANAGED_MARKER,
    MANAGED_MARKER_NAME as OPENSPEC_MANAGED_MARKER_NAME,
    install_package_tree as install_managed_package_tree,
    managed_marker_content,
    package_is_managed,
)


SUPPORTED_TARGETS = ("claude", "cursor", "pi", "codex")
SCOPES = ("repo", "global", "all")
RETIRED_REPO_SKILL_IDS = ("xagent-subagents",)
# Owned by plugins/xagent, which installs it globally for Claude, Cursor, and
# Pi (Codex receives it inside the plugin package). This installer never
# renders it. It still prunes STALE copies this installer wrote in the past —
# keyed on our own marker — but a file carrying the plugin's marker is the
# plugin installer's live output and must be left alone and reported as owned,
# not as an unmanaged obstacle.
PLUGIN_OWNED_GLOBAL_SKILL_IDS = ("xagent-subagents",)
PLUGIN_OWNED_MARKER = "sheaf-xagent-managed: DO NOT EDIT"
OBSOLETE_GLOBAL_SKILL_IDS = ("smoke-test", "xagent-subagents")
REPO_TARGET_DIRS = {
    "claude": Path(".claude/skills"),
    "cursor": Path(".cursor/skills"),
    "pi": Path(".pi/skills"),
    "codex": Path(".codex/skills"),
}
CODEX_HOOK_COMMAND_PLACEHOLDER = "__SHEAF_CODEX_POST_COMPACT_HOOK_COMMAND__"
OPENSPEC_MIN_NODE = (20, 19, 0)
OPENSPEC_VENDOR_REL = Path("projects") / "agents" / "vendor" / "openspec"
OPENSPEC_PACKAGE_REL = OPENSPEC_VENDOR_REL / "package"
OPENSPEC_PINNED_TOOLS = ("claude", "cursor", "pi", "codex")
OPENSPEC_PINNED_WORKFLOWS = (
    "propose",
    "apply-change",
    "archive-change",
    "explore",
    "sync-specs",
)
OPENSPEC_WORKFLOW_TO_SKILL_ID = {
    "propose": "openspec-propose",
    "apply-change": "openspec-apply-change",
    "archive-change": "openspec-archive-change",
    "explore": "openspec-explore",
    "sync-specs": "openspec-sync-specs",
}
OPENSPEC_WORKFLOW_TO_COMMAND_NAME = {
    "propose": "propose",
    "apply-change": "apply",
    "archive-change": "archive",
    "explore": "explore",
    "sync-specs": "sync",
}
OPENSPEC_COMMAND_TOOLS = ("claude", "cursor", "pi")


@dataclass(frozen=True)
class Skill:
    skill_id: str
    name: str
    description: str
    targets: tuple[str, ...]
    source_dir: Path
    body: str


@dataclass(frozen=True)
class Output:
    path: Path
    content: str


def parse_skill_yaml(path: Path) -> dict[str, object]:
    data: dict[str, object] = {}
    current_list: str | None = None

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line.startswith("  - "):
            if current_list is None:
                raise ValueError(f"{path}: list item without list key")
            data.setdefault(current_list, [])
            values = data[current_list]
            if not isinstance(values, list):
                raise ValueError(f"{path}: {current_list} is not a list")
            values.append(line[4:].strip())
            continue
        if ":" not in line:
            raise ValueError(f"{path}: unsupported metadata line: {raw_line}")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            raise ValueError(f"{path}: empty metadata key")
        if value:
            data[key] = value
            current_list = None
        else:
            data[key] = []
            current_list = key

    return data


def read_skills(skills_root: Path) -> list[Skill]:
    if not skills_root.exists():
        return []

    skills: list[Skill] = []
    for source_dir in sorted(p for p in skills_root.iterdir() if p.is_dir()):
        metadata_path = source_dir / "skill.yaml"
        body_path = source_dir / "SKILL.md"
        if not metadata_path.exists():
            raise ValueError(f"missing metadata: {metadata_path}")
        if not body_path.exists():
            raise ValueError(f"missing source body: {body_path}")

        metadata = parse_skill_yaml(metadata_path)
        skill_id = str(metadata.get("id", "")).strip()
        name = str(metadata.get("name", "")).strip()
        description = str(metadata.get("description", "")).strip()
        targets = metadata.get("targets", [])
        if not isinstance(targets, list):
            raise ValueError(f"{metadata_path}: targets must be a list")
        target_tuple = tuple(str(target).strip() for target in targets)

        if not skill_id:
            raise ValueError(f"{metadata_path}: id is required")
        if skill_id != source_dir.name:
            raise ValueError(f"{metadata_path}: id must match directory name")
        if not name:
            raise ValueError(f"{metadata_path}: name is required")
        if not description:
            raise ValueError(f"{metadata_path}: description is required")
        unknown_targets = sorted(set(target_tuple) - set(SUPPORTED_TARGETS))
        if unknown_targets:
            raise ValueError(
                f"{metadata_path}: unsupported targets: {', '.join(unknown_targets)}"
            )

        skills.append(
            Skill(
                skill_id=skill_id,
                name=name,
                description=description,
                targets=target_tuple,
                source_dir=source_dir,
                body=body_path.read_text(encoding="utf-8").strip() + "\n",
            )
        )

    return skills


def marker_for(source: Path) -> str:
    return f"<!-- {MANAGED_MARKER}; source={source.as_posix()} -->"


def line_comment_marker_for(source: Path) -> str:
    return f"# {MANAGED_MARKER}; source={source.as_posix()}"


def render_skill(skill: Skill, repo_root: Path) -> str:
    source_rel = skill.source_dir.relative_to(repo_root)
    return (
        "---\n"
        f"name: {skill.name}\n"
        f"description: {skill.description}\n"
        "metadata:\n"
        "  managedBy: sheaf-agents-installer\n"
        f"  source: {source_rel.as_posix()}\n"
        "---\n\n"
        f"{marker_for(source_rel)}\n\n"
        f"{skill.body}"
    )


def global_content_for(global_source: Path, repo_root: Path) -> str:
    global_rel = global_source.relative_to(repo_root)
    return (
        f"{marker_for(global_rel)}\n\n"
        f"{global_source.read_text(encoding='utf-8').strip()}\n"
    )


def script_content_for(script_source: Path, repo_root: Path) -> str:
    script_rel = script_source.relative_to(repo_root)
    body = script_source.read_text(encoding="utf-8").strip()
    marker = line_comment_marker_for(script_rel)
    if body.startswith("#!"):
        shebang, _, rest = body.partition("\n")
        return f"{shebang}\n{marker}\n{rest.strip()}\n"
    return f"{marker}\n\n{body}\n"


def replace_hook_command(value: object, command: str) -> tuple[object, int]:
    if isinstance(value, dict):
        replaced: dict[str, object] = {}
        count = 0
        for key, nested in value.items():
            if key == "command" and nested == CODEX_HOOK_COMMAND_PLACEHOLDER:
                replaced[key] = command
                count += 1
                continue
            replaced_value, replaced_count = replace_hook_command(nested, command)
            replaced[key] = replaced_value
            count += replaced_count
        return replaced, count
    if isinstance(value, list):
        replaced_list: list[object] = []
        count = 0
        for nested in value:
            replaced_value, replaced_count = replace_hook_command(nested, command)
            replaced_list.append(replaced_value)
            count += replaced_count
        return replaced_list, count
    return value, 0


def codex_hooks_content_for(
    hooks_source: Path, repo_root: Path, installed_script: Path
) -> str:
    hooks_rel = hooks_source.relative_to(repo_root)
    template = json.loads(hooks_source.read_text(encoding="utf-8"))
    command = f"python3 {shlex.quote(str(installed_script))}"
    rendered, replacement_count = replace_hook_command(template, command)
    if replacement_count != 1:
        raise ValueError(
            f"{hooks_source}: expected exactly one Codex hook command placeholder, "
            f"found {replacement_count}"
        )
    if not isinstance(rendered, dict):
        raise ValueError(f"{hooks_source}: hook template must be a JSON object")
    rendered["_sheaf_agents_managed"] = (
        f"{MANAGED_MARKER}; source={hooks_rel.as_posix()}"
    )
    return json.dumps(rendered, indent=2) + "\n"


def read_sources(repo_root: Path) -> tuple[Path, list[Skill], list[Skill]]:
    agents_root = repo_root / "projects" / "agents"
    global_root = agents_root / "global"
    sheaf_root = agents_root / "sheaf"
    global_source = global_root / "AGENTS.md"
    global_skills_root = global_root / "skills"
    sheaf_skills_root = sheaf_root / "skills"

    if not global_source.exists():
        raise ValueError(f"missing global instructions: {global_source}")
    if not global_skills_root.exists():
        raise ValueError(f"missing skills root: {global_skills_root}")

    return global_source, read_skills(global_skills_root), read_skills(sheaf_skills_root)


def build_repo_outputs(repo_root: Path) -> list[Output]:
    global_source, _global_skills, sheaf_skills = read_sources(repo_root)
    outputs: list[Output] = []
    global_content = global_content_for(global_source, repo_root)
    outputs.append(Output(repo_root / "AGENTS.md", global_content))
    outputs.append(Output(repo_root / "CLAUDE.md", global_content))

    for skill in sheaf_skills:
        rendered = render_skill(skill, repo_root)
        for target in skill.targets:
            outputs.append(
                Output(
                    repo_root / REPO_TARGET_DIRS[target] / skill.skill_id / "SKILL.md",
                    rendered,
                )
            )

    return outputs


def build_obsolete_repo_outputs(repo_root: Path) -> list[Output]:
    _global_source, global_skills, _sheaf_skills = read_sources(repo_root)
    skill_ids = {skill.skill_id for skill in global_skills}
    skill_ids.update(RETIRED_REPO_SKILL_IDS)
    return [
        Output(repo_root / target_dir / skill_id / "SKILL.md", "")
        for skill_id in sorted(skill_ids)
        for target_dir in REPO_TARGET_DIRS.values()
    ]


def codex_home_for(home: Path, explicit_codex_home: Path | None) -> Path:
    if explicit_codex_home is not None:
        return explicit_codex_home
    env_value = os.environ.get("CODEX_HOME", "").strip()
    if env_value:
        return Path(env_value).expanduser()
    return home / ".codex"


def build_global_outputs(
    repo_root: Path, *, home: Path, codex_home: Path | None
) -> list[Output]:
    home = home.expanduser().resolve()
    resolved_codex_home = codex_home_for(home, codex_home).expanduser().resolve()
    global_source, global_skills, _sheaf_skills = read_sources(repo_root)
    global_content = global_content_for(global_source, repo_root)

    instruction_paths = [
        home / ".claude" / "CLAUDE.md",
        home / ".cursor" / "AGENTS.md",
        home / ".pi" / "AGENTS.md",
        resolved_codex_home / "AGENTS.md",
    ]
    outputs = [Output(path, global_content) for path in instruction_paths]

    for skill in global_skills:
        if skill.skill_id in OBSOLETE_GLOBAL_SKILL_IDS:
            continue
        if skill.skill_id in PLUGIN_OWNED_GLOBAL_SKILL_IDS:
            continue
        rendered = render_skill(skill, repo_root)
        if "claude" in skill.targets:
            outputs.append(
                Output(home / ".claude" / "skills" / skill.skill_id / "SKILL.md", rendered)
            )
        if "cursor" in skill.targets:
            outputs.append(
                Output(home / ".cursor" / "skills" / skill.skill_id / "SKILL.md", rendered)
            )
        if "pi" in skill.targets:
            outputs.append(
                Output(home / ".pi" / "skills" / skill.skill_id / "SKILL.md", rendered)
            )
        if "codex" in skill.targets:
            outputs.append(
                Output(home / ".agents" / "skills" / skill.skill_id / "SKILL.md", rendered)
            )
            outputs.append(
                Output(
                    resolved_codex_home / "skills" / skill.skill_id / "SKILL.md",
                    rendered,
                )
            )

    codex_hooks_root = repo_root / "projects" / "agents" / "global" / "codex" / "hooks"
    codex_script_source = codex_hooks_root / "session_start_after_compact.py"
    codex_hooks_source = codex_hooks_root / "hooks.json"
    if not codex_script_source.exists():
        raise ValueError(f"missing Codex hook script: {codex_script_source}")
    if not codex_hooks_source.exists():
        raise ValueError(f"missing Codex hook config: {codex_hooks_source}")
    installed_codex_script = (
        resolved_codex_home / "hooks" / "sheaf" / "session_start_after_compact.py"
    )
    outputs.append(
        Output(
            installed_codex_script,
            script_content_for(codex_script_source, repo_root),
        )
    )
    outputs.append(
        Output(
            resolved_codex_home / "hooks.json",
            codex_hooks_content_for(
                codex_hooks_source,
                repo_root,
                installed_codex_script,
            ),
        )
    )

    repo_root_resolved = repo_root.resolve()
    in_repo = [output.path for output in outputs if output.path.is_relative_to(repo_root_resolved)]
    if in_repo:
        joined = ", ".join(str(path) for path in in_repo)
        raise ValueError(f"global output path is inside repository: {joined}")

    return outputs


def build_obsolete_global_outputs(*, home: Path, codex_home: Path | None) -> list[Output]:
    home = home.expanduser().resolve()
    resolved_codex_home = codex_home_for(home, codex_home).expanduser().resolve()

    outputs: list[Output] = []
    for skill_id in OBSOLETE_GLOBAL_SKILL_IDS:
        outputs.extend(
            [
                Output(home / ".claude" / "skills" / skill_id / "SKILL.md", ""),
                Output(home / ".cursor" / "skills" / skill_id / "SKILL.md", ""),
                Output(home / ".pi" / "skills" / skill_id / "SKILL.md", ""),
                Output(home / ".agents" / "skills" / skill_id / "SKILL.md", ""),
                Output(resolved_codex_home / "skills" / skill_id / "SKILL.md", ""),
            ]
        )

    return outputs


def sheaf_prefix(home: Path) -> Path:
    return home.expanduser().resolve() / ".local" / "share" / "sheaf"


def openspec_package_path(home: Path) -> Path:
    return sheaf_prefix(home) / "vendor" / "openspec"


def openspec_shim_path(home: Path) -> Path:
    return sheaf_prefix(home) / "bin" / "openspec"


def openspec_vendor_dir(repo_root: Path) -> Path:
    return repo_root / OPENSPEC_VENDOR_REL


def openspec_vendor_package(repo_root: Path) -> Path:
    return repo_root / OPENSPEC_PACKAGE_REL


def _parse_openspec_string_list(
    path: Path, raw: dict[str, object], field: str
) -> list[str]:
    value = raw.get(field)
    if not isinstance(value, list) or not value:
        raise ValueError(f"{path}: {field} must be a non-empty list of strings")
    items: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{path}: {field} entries must be non-empty strings")
        items.append(item.strip())
    return items


def read_openspec_vendor_pin(repo_root: Path) -> dict[str, object]:
    path = openspec_vendor_dir(repo_root) / "VENDOR.toml"
    if not path.exists():
        raise ValueError(f"missing OpenSpec vendor pin: {path}")
    raw = tomllib.loads(path.read_text(encoding="utf-8"))
    required = ("url", "revision", "version", "retrieved_at")
    missing = [field for field in required if field not in raw]
    if missing:
        raise ValueError(
            f"{path}: missing required pin fields: {', '.join(missing)}"
        )
    pin: dict[str, object] = {}
    for field in required:
        value = raw[field]
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{path}: {field} must be a non-empty string")
        pin[field] = value

    tools = _parse_openspec_string_list(path, raw, "tools")
    workflows = _parse_openspec_string_list(path, raw, "workflows")
    if tuple(tools) != OPENSPEC_PINNED_TOOLS:
        raise ValueError(
            f"{path}: tools must be exactly {list(OPENSPEC_PINNED_TOOLS)}, got {tools}"
        )
    if tuple(workflows) != OPENSPEC_PINNED_WORKFLOWS:
        raise ValueError(
            f"{path}: workflows must be exactly {list(OPENSPEC_PINNED_WORKFLOWS)}, "
            f"got {workflows}"
        )
    pin["tools"] = tools
    pin["workflows"] = workflows
    return pin


def openspec_pin_field(pin: dict[str, object], field: str) -> str:
    value = pin[field]
    if not isinstance(value, str):
        raise ValueError(f"OpenSpec pin field {field} must be a string")
    return value


def probe_node_version() -> tuple[int, ...] | None:
    try:
        completed = subprocess.run(
            ["node", "--version"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    text = completed.stdout.strip()
    if text.startswith("v") or text.startswith("V"):
        text = text[1:]
    parts = text.split(".")
    if len(parts) < 2:
        return None
    try:
        numbers = [int(part) for part in parts[:3]]
    except ValueError:
        return None
    while len(numbers) < 3:
        numbers.append(0)
    return (numbers[0], numbers[1], numbers[2])


def node_supports_openspec(version: tuple[int, ...] | None) -> bool:
    if version is None:
        return False
    return version >= OPENSPEC_MIN_NODE


def format_node_version(version: tuple[int, ...]) -> str:
    return ".".join(str(part) for part in version)


def openspec_managed_marker_content(pin: dict[str, object]) -> str:
    return managed_marker_content(
        source=OPENSPEC_PACKAGE_REL.as_posix(),
        revision=openspec_pin_field(pin, "revision"),
        version=openspec_pin_field(pin, "version"),
    )


def package_is_openspec_managed(package_root: Path) -> bool:
    return package_is_managed(package_root)


def shim_is_openspec_managed(shim: Path) -> bool:
    if not shim.is_file():
        return False
    try:
        content = shim.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    return MANAGED_MARKER in content


def write_openspec_shim(shim: Path, package_root: Path) -> None:
    entry = package_root / "bin" / "openspec.js"
    content = (
        "#!/bin/sh\n"
        f"# {MANAGED_MARKER}; source={OPENSPEC_PACKAGE_REL.as_posix()}\n"
        f"exec node {shlex.quote(str(entry))} \"$@\"\n"
    )
    shim.parent.mkdir(parents=True, exist_ok=True)
    shim.write_text(content, encoding="utf-8")
    shim.chmod(shim.stat().st_mode | 0o111)


def install_openspec_cli(repo_root: Path, *, home: Path, force: bool) -> int:
    home = home.expanduser().resolve()
    node_version = probe_node_version()
    if not node_supports_openspec(node_version):
        if node_version is None:
            detail = "Node.js was not found"
        else:
            detail = (
                f"Node.js {format_node_version(node_version)} is older than "
                f"{format_node_version(OPENSPEC_MIN_NODE)}"
            )
        print(
            f"warning: skipping OpenSpec CLI install: {detail} "
            f"(requires >={format_node_version(OPENSPEC_MIN_NODE)}); "
            "continuing with other global outputs",
            file=sys.stderr,
        )
        return 0

    pin = read_openspec_vendor_pin(repo_root)
    source = openspec_vendor_package(repo_root)
    if not (source / "bin" / "openspec.js").is_file():
        print(f"missing vendored OpenSpec package entry: {source}", file=sys.stderr)
        return 1

    package_root = openspec_package_path(home)
    shim = openspec_shim_path(home)
    if package_root.exists() and not package_is_openspec_managed(package_root):
        if not force:
            print(f"conflict unmanaged {package_root}", file=sys.stderr)
            return 1
    if shim.exists() and not shim_is_openspec_managed(shim):
        if not force:
            print(f"conflict unmanaged {shim}", file=sys.stderr)
            return 1

    try:
        install_managed_package_tree(
            source,
            package_root,
            marker_text=openspec_managed_marker_content(pin),
        )
    except OSError as exc:
        print(f"failed openspec CLI install: {exc}", file=sys.stderr)
        return 1

    write_openspec_shim(shim, package_root)
    print(f"wrote {package_root}")
    print(f"wrote {shim}")
    return 0


def read_openspec_shim_version(shim: Path) -> str | None:
    if not shim.is_file():
        return None
    try:
        completed = subprocess.run(
            [str(shim), "--version"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return completed.stdout.strip() or None


def check_openspec_cli(repo_root: Path, *, home: Path) -> int:
    home = home.expanduser().resolve()
    pin = read_openspec_vendor_pin(repo_root)
    expected = openspec_pin_field(pin, "version")
    shim = openspec_shim_path(home)
    package_root = openspec_package_path(home)
    status = 0

    if not shim.is_file():
        print(f"missing openspec shim {shim}", file=sys.stderr)
        status = 1
    elif not shim_is_openspec_managed(shim):
        print(f"conflict unmanaged {shim}", file=sys.stderr)
        status = 1

    if not package_root.is_dir():
        print(f"missing openspec package {package_root}", file=sys.stderr)
        status = 1
    elif not package_is_openspec_managed(package_root):
        print(f"conflict unmanaged {package_root}", file=sys.stderr)
        status = 1

    if status != 0:
        return status

    actual = read_openspec_shim_version(shim)
    if actual != expected:
        print(
            f"stale openspec CLI: expected version {expected}, got {actual!r} "
            f"from {shim}",
            file=sys.stderr,
        )
        return 1

    print(f"ok openspec CLI {shim} ({actual})")
    return 0


def clean_openspec_cli(*, home: Path) -> int:
    home = home.expanduser().resolve()
    package_root = openspec_package_path(home)
    shim = openspec_shim_path(home)

    if package_root.exists():
        if package_is_openspec_managed(package_root):
            shutil.rmtree(package_root)
            print(f"removed {package_root}")
            parent = package_root.parent
            try:
                parent.rmdir()
            except OSError:
                pass
        else:
            print(f"skip unmanaged {package_root}")

    if shim.exists():
        if shim_is_openspec_managed(shim):
            shim.unlink()
            print(f"removed {shim}")
            parent = shim.parent
            try:
                parent.rmdir()
            except OSError:
                pass
        else:
            print(f"skip unmanaged {shim}")

    return 0


def require_node_for_openspec_repo() -> None:
    node_version = probe_node_version()
    if node_supports_openspec(node_version):
        return
    if node_version is None:
        detail = "Node.js was not found"
    else:
        detail = (
            f"Node.js {format_node_version(node_version)} is older than "
            f"{format_node_version(OPENSPEC_MIN_NODE)}"
        )
    raise RuntimeError(
        f"OpenSpec repo harness generation requires Node.js "
        f">={format_node_version(OPENSPEC_MIN_NODE)}: {detail}"
    )


def openspec_harness_rel_paths(pin: dict[str, object]) -> list[Path]:
    tools = pin["tools"]
    workflows = pin["workflows"]
    if not isinstance(tools, list) or not isinstance(workflows, list):
        raise ValueError("OpenSpec pin tools/workflows must be lists")

    paths: list[Path] = []
    for tool in tools:
        if not isinstance(tool, str):
            raise ValueError("OpenSpec pin tools entries must be strings")
        for workflow in workflows:
            if not isinstance(workflow, str):
                raise ValueError("OpenSpec pin workflows entries must be strings")
            skill_id = OPENSPEC_WORKFLOW_TO_SKILL_ID[workflow]
            paths.append(Path(f".{tool}") / "skills" / skill_id / "SKILL.md")

    for tool in OPENSPEC_COMMAND_TOOLS:
        if tool not in tools:
            continue
        for workflow in workflows:
            if not isinstance(workflow, str):
                raise ValueError("OpenSpec pin workflows entries must be strings")
            command_name = OPENSPEC_WORKFLOW_TO_COMMAND_NAME[workflow]
            if tool == "claude":
                paths.append(Path(".claude") / "commands" / "opsx" / f"{command_name}.md")
            elif tool == "cursor":
                paths.append(Path(".cursor") / "commands" / f"opsx-{command_name}.md")
            elif tool == "pi":
                paths.append(Path(".pi") / "prompts" / f"opsx-{command_name}.md")
    return paths


def list_openspec_harness_outputs(repo_root: Path) -> list[Output]:
    pin = read_openspec_vendor_pin(repo_root)
    return [
        Output(repo_root / rel, "")
        for rel in openspec_harness_rel_paths(pin)
    ]


def wrap_openspec_managed_content(content: str) -> str:
    marker = marker_for(OPENSPEC_PACKAGE_REL)
    if not content.endswith("\n"):
        content = content + "\n"
    lines = content.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ValueError("OpenSpec harness content missing YAML frontmatter")
    close_idx = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            close_idx = index
            break
    if close_idx is None:
        raise ValueError(
            "OpenSpec harness content missing closing YAML frontmatter delimiter"
        )

    # Idempotent if marker already sits immediately after frontmatter.
    #
    trailing = "".join(lines[close_idx + 1 :])
    if trailing.lstrip().startswith(marker):
        return content

    frontmatter = "".join(lines[: close_idx + 1])
    body = trailing.lstrip("\n")
    return f"{frontmatter}\n{marker}\n\n{body}"


def generate_openspec_harness_tree(repo_root: Path, staging_root: Path) -> None:
    pin = read_openspec_vendor_pin(repo_root)
    tools = pin["tools"]
    if not isinstance(tools, list):
        raise ValueError("OpenSpec pin tools must be a list")
    tools_csv = ",".join(str(tool) for tool in tools)
    entry = openspec_vendor_package(repo_root) / "bin" / "openspec.js"
    if not entry.is_file():
        raise FileNotFoundError(f"missing vendored OpenSpec package entry: {entry}")

    isolated_home = staging_root / "home"
    isolated_config = staging_root / "xdg-config"
    project_root = staging_root / "project"
    isolated_home.mkdir(parents=True, exist_ok=True)
    isolated_config.mkdir(parents=True, exist_ok=True)
    project_root.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["HOME"] = str(isolated_home)
    env["XDG_CONFIG_HOME"] = str(isolated_config)
    env.pop("APPDATA", None)
    env.pop("LOCALAPPDATA", None)
    env.pop("XDG_DATA_HOME", None)

    command = [
        "node",
        str(entry.resolve()),
        "init",
        "--tools",
        tools_csv,
        "--profile",
        "core",
        "--force",
        str(project_root),
    ]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        env=env,
        cwd=str(staging_root),
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(
            f"OpenSpec harness generation failed (exit {completed.returncode}): {detail}"
        )


def build_openspec_harness_outputs(repo_root: Path) -> list[Output]:
    require_node_for_openspec_repo()
    pin = read_openspec_vendor_pin(repo_root)
    expected_rels = openspec_harness_rel_paths(pin)

    with tempfile.TemporaryDirectory(prefix="sheaf-openspec-harness-") as tempdir:
        staging_root = Path(tempdir)
        generate_openspec_harness_tree(repo_root, staging_root)
        project_root = staging_root / "project"
        outputs: list[Output] = []
        for rel in expected_rels:
            source = project_root / rel
            if not source.is_file():
                raise FileNotFoundError(
                    f"OpenSpec generation missing expected harness file: {rel}"
                )
            raw = source.read_text(encoding="utf-8")
            outputs.append(
                Output(repo_root / rel, wrap_openspec_managed_content(raw))
            )

        # Guard: generation must never invent root instruction files we would copy.
        for forbidden in ("AGENTS.md", "CLAUDE.md"):
            candidate = project_root / forbidden
            if candidate.exists():
                raise RuntimeError(
                    f"OpenSpec generation produced unexpected {forbidden} in staging"
                )
        return outputs


def build_outputs(
    repo_root: Path, *, scope: str, home: Path, codex_home: Path | None
) -> list[Output]:
    outputs: list[Output] = []
    if scope in ("repo", "all"):
        outputs.extend(build_repo_outputs(repo_root))
    if scope in ("global", "all"):
        outputs.extend(build_global_outputs(repo_root, home=home, codex_home=codex_home))
    return outputs


def is_managed(content: str) -> bool:
    return MANAGED_MARKER in content


def install_outputs(outputs: list[Output], *, force: bool) -> int:
    conflicts: list[Path] = []
    for output in outputs:
        if output.path.exists():
            existing = output.path.read_text(encoding="utf-8")
            if not force and not is_managed(existing):
                conflicts.append(output.path)
    if conflicts:
        for path in conflicts:
            print(f"conflict unmanaged {path}", file=sys.stderr)
        return 1

    for output in outputs:
        if output.path.exists():
            existing = output.path.read_text(encoding="utf-8")
            if existing == output.content:
                print(f"ok {output.path}")
                continue
        output.path.parent.mkdir(parents=True, exist_ok=True)
        output.path.write_text(output.content, encoding="utf-8")
        print(f"wrote {output.path}")
    return 0


def check_outputs(outputs: list[Output]) -> int:
    status = 0
    for output in outputs:
        if not output.path.exists():
            print(f"missing {output.path}", file=sys.stderr)
            status = 1
            continue
        existing = output.path.read_text(encoding="utf-8")
        if existing != output.content:
            label = "stale"
            if not is_managed(existing):
                label = "conflict unmanaged"
            print(f"{label} {output.path}", file=sys.stderr)
            status = 1
        else:
            print(f"ok {output.path}")
    return status


def is_plugin_owned(content: str) -> bool:
    return PLUGIN_OWNED_MARKER in content


def check_obsolete_outputs(outputs: list[Output]) -> int:
    status = 0
    for output in outputs:
        if not output.path.exists():
            continue
        existing = output.path.read_text(encoding="utf-8")
        if is_plugin_owned(existing):
            print(f"plugin-owned {output.path}")
            continue
        if is_managed(existing):
            print(f"obsolete managed {output.path}", file=sys.stderr)
            status = 1
        else:
            print(f"skip unmanaged obsolete {output.path}")
    return status


def clean_outputs(outputs: list[Output]) -> int:
    for output in outputs:
        if not output.path.exists():
            continue
        existing = output.path.read_text(encoding="utf-8")
        if is_plugin_owned(existing):
            print(f"plugin-owned {output.path}")
            continue
        if not is_managed(existing):
            print(f"skip unmanaged {output.path}")
            continue
        output.path.unlink()
        print(f"removed {output.path}")
        parent = output.path.parent
        try:
            parent.rmdir()
        except OSError:
            pass
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("install", "check", "clean"))
    parser.add_argument(
        "--scope",
        choices=SCOPES,
        default="all",
        help="Output scope to process. Defaults to all.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[3],
        help="Repository root. Defaults to the parent of projects/.",
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=Path.home(),
        help="Home directory for global outputs. Defaults to the current user's home.",
    )
    parser.add_argument(
        "--codex-home",
        type=Path,
        default=None,
        help="Codex home for global Codex outputs. Defaults to CODEX_HOME or ~/.codex.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite differing unmanaged destination files during install.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    outputs = build_outputs(
        repo_root,
        scope=args.scope,
        home=args.home,
        codex_home=args.codex_home,
    )
    if args.scope in ("repo", "all"):
        try:
            if args.mode in ("install", "check"):
                outputs.extend(build_openspec_harness_outputs(repo_root))
            else:
                outputs.extend(list_openspec_harness_outputs(repo_root))
        except (RuntimeError, FileNotFoundError, ValueError) as exc:
            print(str(exc), file=sys.stderr)
            return 1

    obsolete_outputs: list[Output] = []
    if args.scope in ("repo", "all"):
        obsolete_outputs.extend(build_obsolete_repo_outputs(repo_root))
    if args.scope in ("global", "all"):
        obsolete_outputs.extend(
            build_obsolete_global_outputs(
                home=args.home,
                codex_home=args.codex_home,
            )
        )

    if args.mode == "install":
        install_status = install_outputs(outputs, force=args.force)
        if install_status != 0:
            return install_status
        obsolete_status = clean_outputs(obsolete_outputs)
        cli_status = 0
        if args.scope in ("global", "all"):
            cli_status = install_openspec_cli(
                repo_root,
                home=args.home,
                force=args.force,
            )
        return obsolete_status or cli_status
    if args.mode == "check":
        check_status = check_outputs(outputs)
        obsolete_status = check_obsolete_outputs(obsolete_outputs)
        cli_status = 0
        if args.scope in ("global", "all"):
            cli_status = check_openspec_cli(repo_root, home=args.home)
        return check_status or obsolete_status or cli_status
    if args.mode == "clean":
        clean_status = clean_outputs(outputs)
        obsolete_status = clean_outputs(obsolete_outputs)
        cli_status = 0
        if args.scope in ("global", "all"):
            cli_status = clean_openspec_cli(home=args.home)
        return clean_status or obsolete_status or cli_status
    raise AssertionError(args.mode)


if __name__ == "__main__":
    raise SystemExit(main())
