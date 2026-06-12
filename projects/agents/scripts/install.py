#!/usr/bin/env python3
"""Render shared agent guidance into harness-specific install locations."""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path


SUPPORTED_TARGETS = ("claude", "cursor", "pi", "codex")
TARGET_DIRS = {
    "claude": Path(".claude/skills"),
    "cursor": Path(".cursor/skills"),
    "pi": Path(".pi/skills"),
    "codex": Path(".codex/skills"),
}
MANAGED_MARKER = "<!-- sheaf-agents-managed: DO NOT EDIT"


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
    return f"{MANAGED_MARKER}; source={source.as_posix()} -->"


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


def build_outputs(repo_root: Path) -> list[Output]:
    agents_root = repo_root / "projects" / "agents"
    global_root = agents_root / "global"
    global_source = global_root / "AGENTS.md"
    skills_root = global_root / "skills"

    if not global_source.exists():
        raise ValueError(f"missing global instructions: {global_source}")
    if not skills_root.exists():
        raise ValueError(f"missing skills root: {skills_root}")

    outputs: list[Output] = []
    global_rel = global_source.relative_to(repo_root)
    global_content = f"{marker_for(global_rel)}\n\n{global_source.read_text(encoding='utf-8').strip()}\n"
    outputs.append(Output(repo_root / "AGENTS.md", global_content))
    outputs.append(Output(repo_root / "CLAUDE.md", global_content))

    for skill in read_skills(skills_root):
        rendered = render_skill(skill, repo_root)
        for target in skill.targets:
            outputs.append(
                Output(
                    repo_root / TARGET_DIRS[target] / skill.skill_id / "SKILL.md",
                    rendered,
                )
            )

    return outputs


def is_managed(content: str) -> bool:
    return MANAGED_MARKER in content


def install_outputs(outputs: list[Output], *, force: bool) -> int:
    for output in outputs:
        if output.path.exists():
            existing = output.path.read_text(encoding="utf-8")
            if existing == output.content:
                print(f"ok {output.path}")
                continue
            if not force and not is_managed(existing):
                print(f"conflict unmanaged {output.path}", file=sys.stderr)
                return 1
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


def clean_outputs(outputs: list[Output]) -> int:
    for output in outputs:
        if not output.path.exists():
            continue
        existing = output.path.read_text(encoding="utf-8")
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
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[3],
        help="Repository root. Defaults to the parent of projects/.",
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
    outputs = build_outputs(repo_root)

    if args.mode == "install":
        return install_outputs(outputs, force=args.force)
    if args.mode == "check":
        return check_outputs(outputs)
    if args.mode == "clean":
        return clean_outputs(outputs)
    raise AssertionError(args.mode)


if __name__ == "__main__":
    raise SystemExit(main())
