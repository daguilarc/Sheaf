from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest import mock
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
MODULE_PATH = SCRIPT_DIR / "install.py"
OPENSPEC_VENDOR_TOML = (
    REPO_ROOT / "projects" / "agents" / "vendor" / "openspec" / "VENDOR.toml"
)

spec = importlib.util.spec_from_file_location("agents_install", MODULE_PATH)
assert spec is not None
install = importlib.util.module_from_spec(spec)
sys.modules["agents_install"] = install
assert spec.loader is not None
spec.loader.exec_module(install)


def openspec_vendor_version() -> str:
    raw = tomllib.loads(OPENSPEC_VENDOR_TOML.read_text(encoding="utf-8"))
    return str(raw["version"])


def hook_outputs(outputs: list[object], codex_home: Path) -> list[object]:
    codex_home = codex_home.resolve()
    wanted = {
        codex_home / "hooks" / "sheaf" / "session_start_after_compact.py",
        codex_home / "hooks.json",
    }
    return [output for output in outputs if output.path in wanted]


def copied_repo_fixture(tempdir: str) -> Path:
    repo_root = Path(tempdir) / "repo"
    agents_dest = repo_root / "projects" / "agents"
    shutil.copytree(
        REPO_ROOT / "projects" / "agents",
        agents_dest,
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    return repo_root


def run_main(*args: str) -> int:
    with mock.patch.object(sys, "argv", ["install.py", *args]):
        return install.main()


class CodexHookOutputTests(unittest.TestCase):
    def test_global_outputs_include_rendered_codex_hook(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = install.build_global_outputs(
                REPO_ROOT,
                home=home,
                codex_home=codex_home,
            )
            hooks = hook_outputs(outputs, codex_home)

            self.assertEqual(2, len(hooks))
            by_path = {output.path: output for output in hooks}
            script_path = codex_home / "hooks" / "sheaf" / "session_start_after_compact.py"
            config_path = codex_home / "hooks.json"

            self.assertIn("sheaf-agents-managed: DO NOT EDIT", by_path[script_path].content)
            self.assertIn("Post-compaction reminder", by_path[script_path].content)

            config = json.loads(by_path[config_path].content)
            self.assertIn("sheaf-agents-managed: DO NOT EDIT", by_path[config_path].content)
            group = config["hooks"]["SessionStart"][0]
            self.assertEqual("^compact$", group["matcher"])
            command = group["hooks"][0]["command"]
            self.assertEqual(f"python3 {script_path}", command)

    def test_install_check_and_clean_codex_hook_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = Path(tempdir) / "home"
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = hook_outputs(
                install.build_global_outputs(REPO_ROOT, home=home, codex_home=codex_home),
                codex_home,
            )

            self.assertEqual(0, install.install_outputs(outputs, force=False))
            self.assertEqual(0, install.check_outputs(outputs))

            config_path = codex_home / "hooks.json"
            config_path.write_text("{}\n", encoding="utf-8")
            self.assertEqual(1, install.check_outputs(outputs))

            self.assertEqual(0, install.install_outputs(outputs, force=True))
            self.assertEqual(0, install.clean_outputs(outputs))
            for output in outputs:
                self.assertFalse(output.path.exists())

    def test_unmanaged_codex_hooks_json_conflicts(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = Path(tempdir) / "home"
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = hook_outputs(
                install.build_global_outputs(REPO_ROOT, home=home, codex_home=codex_home),
                codex_home,
            )
            config_path = codex_home / "hooks.json"
            config_path.parent.mkdir(parents=True)
            config_path.write_text('{"hooks": {}}\n', encoding="utf-8")

            self.assertEqual(1, install.install_outputs(outputs, force=False))
            self.assertEqual(1, install.check_outputs(outputs))
            self.assertEqual(0, install.clean_outputs(outputs))
            self.assertTrue(config_path.exists())


class SkillScopeOutputTests(unittest.TestCase):
    def test_xagent_skill_is_not_an_agents_source_or_desired_output(self) -> None:
        self.assertFalse(
            (REPO_ROOT / "projects/agents/global/skills/xagent-subagents").exists()
        )

        with tempfile.TemporaryDirectory() as tempdir:
            output_sets = [
                install.build_repo_outputs(REPO_ROOT),
                install.build_global_outputs(
                    REPO_ROOT,
                    home=Path(tempdir) / "home",
                    codex_home=Path(tempdir) / "codex-home",
                ),
            ]
            for outputs in output_sets:
                for output in outputs:
                    self.assertNotEqual(
                        Path("xagent-subagents/SKILL.md"),
                        Path(*output.path.parts[-2:]),
                    )

    def test_repo_outputs_include_only_sheaf_skills(self) -> None:
        outputs = install.build_repo_outputs(REPO_ROOT)
        paths = {output.path.relative_to(REPO_ROOT) for output in outputs}
        _global_source, global_skills, sheaf_skills = install.read_sources(REPO_ROOT)

        self.assertIn(Path("AGENTS.md"), paths)
        self.assertIn(Path("CLAUDE.md"), paths)
        for skill in sheaf_skills:
            for target in skill.targets:
                self.assertIn(
                    install.REPO_TARGET_DIRS[target] / skill.skill_id / "SKILL.md",
                    paths,
                )
        for skill in global_skills:
            for target_dir in install.REPO_TARGET_DIRS.values():
                self.assertNotIn(target_dir / skill.skill_id / "SKILL.md", paths)

    def test_repo_outputs_honor_synthetic_codex_only_sheaf_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = copied_repo_fixture(tempdir)
            skill_root = repo_root / "projects" / "agents" / "sheaf" / "skills" / "codex-only"
            skill_root.mkdir(parents=True)
            (skill_root / "skill.yaml").write_text(
                "\n".join(
                    [
                        "id: codex-only",
                        "name: codex-only",
                        "description: Synthetic Codex-only Sheaf skill.",
                        "targets:",
                        "  - codex",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (skill_root / "SKILL.md").write_text("# Codex Only\n", encoding="utf-8")

            outputs = install.build_repo_outputs(repo_root)
            paths = {output.path.relative_to(repo_root) for output in outputs}

            self.assertIn(Path(".codex/skills/codex-only/SKILL.md"), paths)
            self.assertNotIn(Path(".claude/skills/codex-only/SKILL.md"), paths)
            self.assertNotIn(Path(".cursor/skills/codex-only/SKILL.md"), paths)
            self.assertNotIn(Path(".pi/skills/codex-only/SKILL.md"), paths)

    def test_global_outputs_include_all_non_plugin_global_skills(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = install.build_global_outputs(
                REPO_ROOT,
                home=home,
                codex_home=codex_home,
            )
            paths = {output.path for output in outputs}
            _global_source, global_skills, _sheaf_skills = install.read_sources(REPO_ROOT)

            for skill in global_skills:
                if "claude" in skill.targets:
                    self.assertIn(
                        home / ".claude" / "skills" / skill.skill_id / "SKILL.md",
                        paths,
                    )
                if "cursor" in skill.targets:
                    self.assertIn(
                        home / ".cursor" / "skills" / skill.skill_id / "SKILL.md",
                        paths,
                    )
                if "pi" in skill.targets:
                    self.assertIn(
                        home / ".pi" / "skills" / skill.skill_id / "SKILL.md",
                        paths,
                    )
                if "codex" in skill.targets:
                    self.assertIn(
                        home / ".agents" / "skills" / skill.skill_id / "SKILL.md",
                        paths,
                    )
                    self.assertIn(
                        codex_home / "skills" / skill.skill_id / "SKILL.md",
                        paths,
                    )

    def test_global_outputs_exclude_synthetic_plugin_owned_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = copied_repo_fixture(tempdir)
            skill_root = (
                repo_root
                / "projects"
                / "agents"
                / "global"
                / "skills"
                / "xagent-subagents"
            )
            skill_root.mkdir(parents=True)
            (skill_root / "skill.yaml").write_text(
                "\n".join(
                    [
                        "id: xagent-subagents",
                        "name: xagent-subagents",
                        "description: Synthetic plugin-owned skill.",
                        "targets:",
                        "  - claude",
                        "  - cursor",
                        "  - pi",
                        "  - codex",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (skill_root / "SKILL.md").write_text(
                "# Synthetic Plugin Skill\n",
                encoding="utf-8",
            )
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = install.build_global_outputs(
                repo_root,
                home=home,
                codex_home=codex_home,
            )
            paths = {output.path for output in outputs}

            self.assertFalse(
                any(
                    path.parts[-2:] == ("xagent-subagents", "SKILL.md")
                    for path in paths
                )
            )


class ObsoleteRepoOutputTests(unittest.TestCase):
    def test_repo_obsolete_outputs_cover_all_global_ids_and_retired_xagent(self) -> None:
        outputs = install.build_obsolete_repo_outputs(REPO_ROOT)
        paths = {output.path.relative_to(REPO_ROOT) for output in outputs}
        _global_source, global_skills, _sheaf_skills = install.read_sources(REPO_ROOT)
        obsolete_ids = {skill.skill_id for skill in global_skills}
        obsolete_ids.add("xagent-subagents")

        self.assertEqual(
            {
                target_dir / skill_id / "SKILL.md"
                for skill_id in obsolete_ids
                for target_dir in install.REPO_TARGET_DIRS.values()
            },
            paths,
        )

    def test_repo_check_reports_managed_obsolete_output(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = copied_repo_fixture(tempdir)
            managed_obsolete = repo_root / ".claude" / "skills" / "about-me" / "SKILL.md"
            self.assertEqual(
                0,
                run_main("install", "--scope", "repo", "--repo-root", str(repo_root)),
            )
            managed_obsolete.parent.mkdir(parents=True)
            managed_obsolete.write_text(
                "<!-- sheaf-agents-managed: DO NOT EDIT; source=old -->\n",
                encoding="utf-8",
            )

            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                result = run_main(
                    "check",
                    "--scope",
                    "repo",
                    "--repo-root",
                    str(repo_root),
                )

            self.assertEqual(1, result)
            self.assertIn(
                f"obsolete managed {managed_obsolete.resolve()}",
                stderr.getvalue(),
            )
            self.assertTrue(managed_obsolete.exists())

    def test_repo_clean_removes_managed_and_preserves_unmanaged_obsolete_output(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = copied_repo_fixture(tempdir)
            managed_obsolete = repo_root / ".claude" / "skills" / "about-me" / "SKILL.md"
            unmanaged_obsolete = repo_root / ".cursor" / "skills" / "about-me" / "SKILL.md"
            managed_obsolete.parent.mkdir(parents=True)
            unmanaged_obsolete.parent.mkdir(parents=True)
            managed_obsolete.write_text(
                "<!-- sheaf-agents-managed: DO NOT EDIT; source=old -->\n",
                encoding="utf-8",
            )
            unmanaged_obsolete.write_text("personal skill\n", encoding="utf-8")

            self.assertEqual(
                0,
                run_main("clean", "--scope", "repo", "--repo-root", str(repo_root)),
            )
            self.assertFalse(managed_obsolete.exists())
            self.assertTrue(unmanaged_obsolete.exists())

    def test_repo_install_prunes_managed_and_preserves_unmanaged_obsolete_output(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = copied_repo_fixture(tempdir)
            managed_obsolete = repo_root / ".claude" / "skills" / "about-me" / "SKILL.md"
            unmanaged_obsolete = repo_root / ".cursor" / "skills" / "about-me" / "SKILL.md"
            managed_obsolete.parent.mkdir(parents=True)
            unmanaged_obsolete.parent.mkdir(parents=True)
            managed_obsolete.write_text(
                "<!-- sheaf-agents-managed: DO NOT EDIT; source=old -->\n",
                encoding="utf-8",
            )
            unmanaged_obsolete.write_text("personal skill\n", encoding="utf-8")

            self.assertEqual(
                0,
                run_main("install", "--scope", "repo", "--repo-root", str(repo_root)),
            )
            self.assertFalse(managed_obsolete.exists())
            self.assertTrue(unmanaged_obsolete.exists())

    def test_global_install_prunes_plugin_owned_managed_and_preserves_unmanaged_output(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = copied_repo_fixture(tempdir)
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            managed_obsolete = (
                home / ".agents" / "skills" / "xagent-subagents" / "SKILL.md"
            )
            unmanaged_obsolete = (
                codex_home / "skills" / "xagent-subagents" / "SKILL.md"
            )
            managed_obsolete.parent.mkdir(parents=True)
            unmanaged_obsolete.parent.mkdir(parents=True)
            managed_obsolete.write_text(
                "<!-- sheaf-agents-managed: DO NOT EDIT; source=old -->\n",
                encoding="utf-8",
            )
            unmanaged_obsolete.write_text("personal plugin skill\n", encoding="utf-8")

            self.assertEqual(
                0,
                run_main(
                    "install",
                    "--scope",
                    "global",
                    "--repo-root",
                    str(repo_root),
                    "--home",
                    str(home),
                    "--codex-home",
                    str(codex_home),
                ),
            )

            self.assertFalse(managed_obsolete.exists())
            self.assertEqual(
                "personal plugin skill\n",
                unmanaged_obsolete.read_text(encoding="utf-8"),
            )

    def test_global_check_and_clean_handle_plugin_owned_obsolete_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = copied_repo_fixture(tempdir)
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            common_args = (
                "--scope",
                "global",
                "--repo-root",
                str(repo_root),
                "--home",
                str(home),
                "--codex-home",
                str(codex_home),
            )
            self.assertEqual(
                0,
                run_main("install", *common_args),
            )
            managed_obsolete = (
                home / ".agents" / "skills" / "xagent-subagents" / "SKILL.md"
            )
            unmanaged_obsolete = (
                codex_home / "skills" / "xagent-subagents" / "SKILL.md"
            )
            managed_obsolete.parent.mkdir(parents=True)
            unmanaged_obsolete.parent.mkdir(parents=True)
            managed_obsolete.write_text(
                "<!-- sheaf-agents-managed: DO NOT EDIT; source=old -->\n",
                encoding="utf-8",
            )
            unmanaged_obsolete.write_text("personal plugin skill\n", encoding="utf-8")

            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                result = run_main("check", *common_args)
            self.assertEqual(1, result)
            self.assertIn(f"obsolete managed {managed_obsolete}", stderr.getvalue())
            self.assertTrue(managed_obsolete.exists())
            self.assertTrue(unmanaged_obsolete.exists())

            self.assertEqual(0, run_main("clean", *common_args))
            self.assertFalse(managed_obsolete.exists())
            self.assertTrue(unmanaged_obsolete.exists())


def skill_output_content(
    outputs: list[install.Output],
    skill_id: str,
    *,
    parent: Path | None = None,
) -> str:
    matches = [
        output
        for output in outputs
        if output.path.parts[-2:] == (skill_id, "SKILL.md")
    ]
    if parent is not None:
        parent = parent.resolve()
        matches = [output for output in matches if output.path.is_relative_to(parent)]
    if len(matches) != 1:
        paths = [str(output.path) for output in matches]
        raise AssertionError(
            f"expected exactly one rendered output for {skill_id}, found {len(matches)}: {paths}"
        )
    return matches[0].content


def assert_all_present(test_case: unittest.TestCase, content: str, phrases: tuple[str, ...]) -> None:
    lowered = content.lower()
    for phrase in phrases:
        test_case.assertIn(
            phrase.lower(),
            lowered,
            f"missing required guidance phrase: {phrase!r}",
        )


def assert_none_present(
    test_case: unittest.TestCase, content: str, phrases: tuple[str, ...]
) -> None:
    lowered = content.lower()
    for phrase in phrases:
        test_case.assertNotIn(
            phrase.lower(),
            lowered,
            f"forbidden routine-polling guidance phrase: {phrase!r}",
        )


def extract_markdown_section(content: str, heading: str) -> str:
    pattern = re.compile(rf"^## {re.escape(heading)}\s*$", re.MULTILINE)
    match = pattern.search(content)
    if match is None:
        raise AssertionError(f"missing section heading: {heading!r}")
    start = match.end()
    next_heading = re.search(r"^## ", content[start:], re.MULTILINE)
    if next_heading is None:
        return content[start:]
    return content[start : start + next_heading.start()]


PROHIBITION_LINE_MARKERS = (
    "do not",
    "never",
    "prohibit",
    "must not",
    "no transport fallback",
    "no sdd fallback",
    "prohibited",
)


def line_looks_prohibitive(line: str) -> bool:
    lowered = line.lower()
    return any(marker in lowered for marker in PROHIBITION_LINE_MARKERS)


def phrase_occurs_only_in_prohibition_context(section: str, phrase: str) -> bool:
    lowered_phrase = phrase.lower()
    lines = section.splitlines()
    for index, line in enumerate(lines):
        if lowered_phrase not in line.lower():
            continue
        context = "\n".join(lines[max(0, index - 2) : index + 2])
        if line_looks_prohibitive(context):
            continue
        return False
    return True


def assert_transport_guidance_scoped(
    test_case: unittest.TestCase,
    content: str,
    *,
    protected_headings: tuple[str, ...],
    forbidden_phrases: tuple[str, ...],
    required_outside_phrases: tuple[str, ...] = (),
) -> None:
    protected_parts = [
        extract_markdown_section(content, heading) for heading in protected_headings
    ]
    for phrase in forbidden_phrases:
        lowered_phrase = phrase.lower()
        for heading, section in zip(protected_headings, protected_parts, strict=True):
            test_case.assertTrue(
                phrase_occurs_only_in_prohibition_context(section, phrase),
                (
                    f"forbidden transport phrase {phrase!r} appeared in "
                    f"{heading!r} outside a prohibition context"
                ),
            )
        if phrase not in required_outside_phrases:
            continue
        remainder = content.lower()
        for section in protected_parts:
            remainder = remainder.replace(section.lower(), "")
        test_case.assertIn(
            lowered_phrase,
            remainder,
            (
                f"expected non-SDD guidance phrase {phrase!r} outside protected "
                f"sections {protected_headings!r}"
            ),
        )


XAGENT_SDD_GUIDANCE_PHRASES = (
    "xagent_sdd_start",
    "xagent_sdd_followup",
    "xagent_sdd_await",
    "xagent_sdd_close",
    "agent_id",
    "sequence",
    "report-before-return",
    "do not start a fresh agent",
    "jsonl position",
    "native subagent",
    "xagent_start",
    "xagent_message",
    "xagent supervise",
    "broken agentic infrastructure",
    "do not poll",
    "single-turn",
)


def assert_xagent_subagents_sdd_guidance(
    test_case: unittest.TestCase, content: str
) -> None:
    sdd_section = extract_markdown_section(content, "Superpowers SDD")
    assert_all_present(test_case, sdd_section, XAGENT_SDD_GUIDANCE_PHRASES)
    assert_transport_guidance_scoped(
        test_case,
        content,
        protected_headings=("Superpowers SDD",),
        forbidden_phrases=(
            "native subagent",
            "xagent_start",
            "xagent_message",
            "xagent supervise",
        ),
        required_outside_phrases=(
            "xagent_start",
            "xagent_message",
            "xagent supervise",
        ),
    )


class DistributedSkillSemanticsTests(unittest.TestCase):
    def test_xagent_subagents_skill_event_driven_supervision_guidance(self) -> None:
        skill_path = REPO_ROOT / "plugins" / "xagent" / "skills" / "xagent-subagents" / "SKILL.md"
        self.assertTrue(skill_path.is_file(), f"missing packaged skill: {skill_path}")
        content = skill_path.read_text(encoding="utf-8")
        generic_section = extract_markdown_section(content, "Generic Delegation")

        assert_xagent_subagents_sdd_guidance(self, content)
        assert_all_present(
            self,
            generic_section,
            (
                "xagent_start",
                "xagent_await",
                "report.text",
                "after_sequence",
                "deterministic",
                "Haiku",
                "watchdog attention never",
                "broken agentic infrastructure",
                "xagent supervise",
                "do not poll",
                "write_stdin",
                "xagent list",
                "xagent logs",
                "claude_code",
                "verify it with local Claude Code",
                "do not silently downgrade",
                "xagent_message",
            ),
        )
        assert_all_present(
            self,
            content,
            (
                "Conductor",
                "xagent",
                "healthy",
                "127.0.0.1:9005",
            ),
        )
        assert_none_present(
            self,
            content,
            (
                "poll every",
                "short timeout loop",
            ),
        )

    def test_openspec_superpowers_workflow_event_driven_coordination_guidance(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            outputs = install.build_global_outputs(
                REPO_ROOT,
                home=home,
                codex_home=codex_home,
            )
            content = skill_output_content(
                outputs,
                "openspec-superpowers-workflow",
                parent=codex_home / "skills",
            )

        provider_section = extract_markdown_section(content, "Provider and model rules")
        pre_plan_section = extract_markdown_section(content, "Pre-plan coordination")
        sdd_section = extract_markdown_section(content, "Superpowers SDD task execution")

        self.assertNotIn(
            "native subagent mechanism",
            provider_section.lower(),
            "provider rules must not authorize native transport for SDD task turns",
        )
        self.assertNotIn(
            "availability only decides the transport",
            provider_section.lower(),
            "provider rules must not treat transport as availability-driven for SDD",
        )
        assert_all_present(
            self,
            provider_section,
            (
                "xagent sdd mcp facade",
                "prohibited",
            ),
        )

        assert_all_present(
            self,
            pre_plan_section,
            (
                "long native mailbox wait",
                "blocker",
                "final completion",
                "required input",
                "reason-gated",
                "list_agents",
                "do not poll",
                "xagent_start",
                "xagent_await",
                "report.text",
                "native subagent",
                "not the default transport",
                "broken agentic infrastructure",
                "xagent_message",
                "xagent supervise",
            ),
        )
        assert_all_present(
            self,
            sdd_section,
            (
                "xagent_sdd_start",
                "xagent_sdd_followup",
                "xagent_sdd_await",
                "xagent_sdd_close",
                "agent_id",
                "sequence",
                "report-before-return",
                "dispatch-prompt",
                "do not start a fresh agent",
                "jsonl position",
                "native subagent",
                "xagent_start",
                "xagent_message",
                "xagent supervise",
                "broken agentic infrastructure",
                "do not poll",
                "single-turn",
            ),
        )
        assert_transport_guidance_scoped(
            self,
            content,
            protected_headings=("Superpowers SDD task execution",),
            forbidden_phrases=(
                "native subagent",
                "xagent_start",
                "xagent_message",
                "xagent supervise",
            ),
        )
        assert_none_present(
            self,
            content,
            (
                "poll every",
                "short timeout loop",
            ),
        )

class OpenSpecCliInstallTests(unittest.TestCase):
    def test_global_install_creates_shim_matching_vendor_version(self) -> None:
        if not install.node_supports_openspec(install.probe_node_version()):
            self.skipTest("requires Node >= 20.19")

        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            common_args = (
                "--scope",
                "global",
                "--repo-root",
                str(REPO_ROOT),
                "--home",
                str(home),
                "--codex-home",
                str(codex_home),
            )

            self.assertEqual(0, run_main("install", *common_args))

            shim = install.openspec_shim_path(home)
            package_root = install.openspec_package_path(home)
            self.assertTrue(shim.is_file())
            self.assertTrue((package_root / "bin" / "openspec.js").is_file())
            self.assertTrue(
                (package_root / install.OPENSPEC_MANAGED_MARKER_NAME).is_file()
            )

            completed = subprocess.run(
                [str(shim), "--version"],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(openspec_vendor_version(), completed.stdout.strip())

            self.assertEqual(0, run_main("check", *common_args))

    def test_install_preserves_managed_tree_when_staging_copy_fails(self) -> None:
        if not install.node_supports_openspec(install.probe_node_version()):
            self.skipTest("requires Node >= 20.19")

        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            common_args = (
                "--scope",
                "global",
                "--repo-root",
                str(REPO_ROOT),
                "--home",
                str(home),
                "--codex-home",
                str(codex_home),
            )
            self.assertEqual(0, run_main("install", *common_args))

            package_root = install.openspec_package_path(home)
            marker_path = package_root / install.OPENSPEC_MANAGED_MARKER_NAME
            marker_before = marker_path.read_text(encoding="utf-8")
            entry = package_root / "bin" / "openspec.js"
            self.assertTrue(entry.is_file())

            with mock.patch.object(
                install.shutil,
                "copytree",
                side_effect=OSError("disk full"),
            ):
                with contextlib.redirect_stderr(io.StringIO()):
                    with contextlib.redirect_stdout(io.StringIO()):
                        result = run_main("install", *common_args)

            self.assertEqual(1, result)
            self.assertTrue(package_root.is_dir())
            self.assertTrue(marker_path.is_file())
            self.assertEqual(marker_before, marker_path.read_text(encoding="utf-8"))
            self.assertTrue(entry.is_file())
            self.assertEqual(0, run_main("check", *common_args))

    def test_global_install_skips_cli_with_warning_when_node_too_old(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            common_args = (
                "--scope",
                "global",
                "--repo-root",
                str(REPO_ROOT),
                "--home",
                str(home),
                "--codex-home",
                str(codex_home),
            )
            real_run = subprocess.run
            recorded: list[list[str]] = []

            def tracking_run(*args: object, **kwargs: object) -> object:
                if args and isinstance(args[0], (list, tuple)):
                    recorded.append([str(part) for part in args[0]])
                return real_run(*args, **kwargs)

            stderr = io.StringIO()
            with mock.patch.object(
                install,
                "probe_node_version",
                return_value=(18, 20, 0),
            ):
                with mock.patch.object(subprocess, "run", side_effect=tracking_run):
                    with contextlib.redirect_stderr(stderr):
                        result = run_main("install", *common_args)

            self.assertEqual(0, result)
            self.assertIn("OpenSpec CLI", stderr.getvalue())
            self.assertIn("Node", stderr.getvalue())
            self.assertFalse(install.openspec_shim_path(home).exists())
            self.assertFalse(install.openspec_package_path(home).exists())
            self.assertTrue((home / ".claude" / "CLAUDE.md").is_file())
            self.assertTrue((codex_home / "hooks.json").is_file())
            self.assertFalse(
                any(Path(part).name == "npm" for command in recorded for part in command)
            )
            self.assertFalse(
                any(
                    "npm" in Path(part).name and "install" in command
                    for command in recorded
                    for part in command
                )
            )

    def test_global_install_skips_cli_with_warning_when_node_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            common_args = (
                "--scope",
                "global",
                "--repo-root",
                str(REPO_ROOT),
                "--home",
                str(home),
                "--codex-home",
                str(codex_home),
            )
            real_run = subprocess.run
            recorded: list[list[str]] = []

            def tracking_run(*args: object, **kwargs: object) -> object:
                if args and isinstance(args[0], (list, tuple)):
                    recorded.append([str(part) for part in args[0]])
                return real_run(*args, **kwargs)

            stderr = io.StringIO()
            with mock.patch.object(install, "probe_node_version", return_value=None):
                with mock.patch.object(subprocess, "run", side_effect=tracking_run):
                    with contextlib.redirect_stderr(stderr):
                        result = run_main("install", *common_args)

            self.assertEqual(0, result)
            self.assertIn("OpenSpec CLI", stderr.getvalue())
            self.assertFalse(install.openspec_shim_path(home).exists())
            self.assertTrue((home / ".cursor" / "AGENTS.md").is_file())
            self.assertFalse(
                any(Path(part).name == "npm" for command in recorded for part in command)
            )
            self.assertFalse(
                any("install" in command and any(
                    Path(part).name == "npm" for part in command
                ) for command in recorded)
            )

    def test_global_check_reports_missing_openspec_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            common_args = (
                "--scope",
                "global",
                "--repo-root",
                str(REPO_ROOT),
                "--home",
                str(home),
                "--codex-home",
                str(codex_home),
            )
            with mock.patch.object(install, "probe_node_version", return_value=None):
                with contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(0, run_main("install", *common_args))

            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                result = run_main("check", *common_args)

            self.assertEqual(1, result)
            self.assertIn("openspec", stderr.getvalue().lower())

    def test_global_clean_removes_managed_openspec_prefix_only(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = (Path(tempdir) / "home").resolve()
            codex_home = (Path(tempdir) / "codex-home").resolve()
            common_args = (
                "--scope",
                "global",
                "--repo-root",
                str(REPO_ROOT),
                "--home",
                str(home),
                "--codex-home",
                str(codex_home),
            )
            self.assertEqual(0, run_main("install", *common_args))

            sheaf_bin = install.sheaf_prefix(home) / "bin"
            unmanaged = sheaf_bin / "keep-me"
            unmanaged.write_text("stay\n", encoding="utf-8")
            foreign = install.sheaf_prefix(home) / "vendor" / "other" / "file.txt"
            foreign.parent.mkdir(parents=True)
            foreign.write_text("foreign\n", encoding="utf-8")

            self.assertEqual(0, run_main("clean", *common_args))

            self.assertFalse(install.openspec_shim_path(home).exists())
            self.assertFalse(install.openspec_package_path(home).exists())
            self.assertTrue(unmanaged.is_file())
            self.assertEqual("stay\n", unmanaged.read_text(encoding="utf-8"))
            self.assertTrue(foreign.is_file())


if __name__ == "__main__":
    unittest.main()
