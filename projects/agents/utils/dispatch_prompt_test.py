#!/usr/bin/env python3
"""Tests for projects/agents/utils/dispatch-prompt."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


UTIL = Path(__file__).resolve().parent / "dispatch-prompt"

_UNSET = "\0unset\0"


def make_template(prompt_body: str, *, scaffold_extra: str = "") -> str:
    """A template in the upstream shape: wrapper prose around one column-0 fence."""
    indented = "\n".join(f"    {line}" if line else "" for line in prompt_body.splitlines())
    return (
        "# Some Prompt Template\n"
        "\n"
        "Use this template when dispatching a subagent.\n"
        "\n"
        "```\n"
        "Subagent (general-purpose):\n"
        '  description: "Do the thing"\n'
        "  model: [MODEL — REQUIRED: choose per SKILL.md]\n"
        f"{scaffold_extra}"
        "  prompt: |\n"
        f"{indented}\n"
        "```\n"
        "\n"
        "**Placeholders:**\n"
        "- `[BRIEF_FILE]` — REQUIRED: the task brief\n"
        "\n"
        "**Reviewer returns:** a verdict\n"
    )


IMPLEMENTER_BODY = """\
You are implementing Task N: [task name]

## Task Description

Read your task brief first: [BRIEF_FILE]

## Context

[Scene-setting: where this fits, dependencies, architectural context]

Work from: [directory]

## Report Format

Write your full report to [REPORT_FILE]
"""

REVIEWER_BODY = """\
You are reviewing one task's implementation.

## What Was Requested

Read the task brief: [BRIEF_FILE]

Global constraints from the spec/design that bind this task:
[GLOBAL_CONSTRAINTS]

## What the Implementer Claims They Built

Read the implementer's report: [REPORT_FILE]

## Diff Under Review

**Base:** [BASE_SHA]
**Head:** [HEAD_SHA]
**Diff file:** [DIFF_FILE]

Do not crawl the broader codebase. Cross-cutting changes are legitimate
named risks: checking the call sites is the right method.

## Do Not Trust the Report

Treat the implementer's report as unverified claims.

## Part 2: Code Quality

- Do the new and changed tests verify real behavior, not mocks?

## Calibration

Not everything is Critical.
"""

REREVIEW_BODY = """\
You are re-reviewing one task's fix round.

## The Task

Read the task brief: [BRIEF_FILE]

## The Findings Under Verification

[FINDINGS]

## The Fix

Read the implementer's report: [REPORT_FILE]

**Fix base:** [FIX_BASE_SHA]
**Head:** [HEAD_SHA]
**Diff file:** [DIFF_FILE]
"""

CODE_REVIEWER_BODY = """\
You are a Senior Code Reviewer.

## What Was Implemented

[DESCRIPTION]

## Requirements / Plan

[PLAN_OR_REQUIREMENTS]

## Git Range to Review

**Base:** [BASE_SHA]
**Head:** [HEAD_SHA]

```bash
git diff --stat [BASE_SHA]..[HEAD_SHA]
```

## Read-Only Review

Do not mutate the working tree.
"""

BODIES = {
    ("subagent-driven-development", "implementer-prompt.md"): IMPLEMENTER_BODY,
    ("subagent-driven-development", "task-reviewer-prompt.md"): REVIEWER_BODY,
    ("subagent-driven-development", "re-review-prompt.md"): REREVIEW_BODY,
    ("requesting-code-review", "code-reviewer.md"): CODE_REVIEWER_BODY,
}


class DispatchPromptTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

        self.repo = self.tmp / "repo"
        (self.repo / "docs").mkdir(parents=True)
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        subprocess.run(
            ["git", "config", "user.email", "t@example.com"], cwd=self.repo, check=True
        )
        subprocess.run(["git", "config", "user.name", "t"], cwd=self.repo, check=True)
        (self.repo / "seed.txt").write_text("seed\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "seed"], cwd=self.repo, check=True)

        self.plan = self.repo / "docs" / "my-plan.md"
        self.plan.write_text("# Plan\n\n## Task 1: Thing\n\nDo it.\n", encoding="utf-8")

        self.brief = self.repo / "brief.md"
        self.brief.write_text("BRIEF-BODY-SENTINEL\n", encoding="utf-8")

        self.roots = self.tmp / "plugins"
        self.write_templates(self.roots / "6.2.0" / "skills")

        self.workspace = self.repo / ".superpowers" / "sdd" / "my-plan"

    def write_templates(self, root: Path, bodies: dict | None = None) -> Path:
        for (skill, filename), body in (bodies or BODIES).items():
            target = root / skill / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(make_template(body), encoding="utf-8")
        return root

    def run_util(self, *args: str, root: str | None = None, env: dict | None = None):
        argv = [str(UTIL), *args]
        if root is not None:
            argv += ["--templates-root", root]
        environ = dict(os.environ)
        environ.pop("SUPERPOWERS_TEMPLATES_ROOT", None)
        environ.update(env or {})
        return subprocess.run(
            argv, cwd=self.repo, capture_output=True, text=True, env=environ
        )

    def reviewer(self, *extra: str, root: str | None = _UNSET, **kwargs):
        """Dispatch task-reviewer. root=None omits --templates-root entirely."""
        return self.run_util(
            "task-reviewer",
            "--plan",
            str(self.plan),
            "--task",
            "1",
            "--brief",
            str(self.brief),
            "--base",
            "HEAD",
            "--head",
            "HEAD",
            *extra,
            root=str(self.roots / "6.2.0" / "skills") if root is _UNSET else root,
            **kwargs,
        )

    def short(self, rev: str = "HEAD") -> str:
        out = subprocess.run(
            ["git", "rev-parse", "--short", rev],
            cwd=self.repo,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()

    def seed_report(self, name: str = "task-1-report.md") -> Path:
        """Seed the artifacts the reviewer templates expect to derive."""
        self.workspace.mkdir(parents=True, exist_ok=True)
        report = self.workspace / name
        report.write_text("Implementer report.\n", encoding="utf-8")
        sha = self.short()
        (self.workspace / f"review-{sha}..{sha}.diff").write_text(
            "# Review package\n", encoding="utf-8"
        )
        return report


class DispatchPromptTests(DispatchPromptTestCase):
    # ------------------------------------------------------------ resolution

    def test_selects_highest_installed_version(self) -> None:
        """6.10.0 must beat 6.2.0 — numeric ordering, not lexicographic."""
        self.seed_report()
        home = self.tmp / "fakehome"
        cache = home / ".claude/plugins/cache/claude-plugins-official/superpowers"
        self.write_templates(cache / "6.2.0" / "skills")
        self.write_templates(cache / "6.10.0" / "skills")
        marker = "HIGHEST-VERSION-MARKER"
        (cache / "6.10.0/skills/subagent-driven-development/task-reviewer-prompt.md").write_text(
            make_template(REVIEWER_BODY + f"\n{marker}\n"), encoding="utf-8"
        )
        result = self.reviewer(root=None, env={"HOME": str(home)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(marker, Path(result.stdout.strip()).read_text(encoding="utf-8"))

    def test_env_root_used_when_no_flag(self) -> None:
        self.seed_report()
        other = self.write_templates(self.tmp / "envroot" / "skills")
        marker = "ENV-ROOT-MARKER"
        other.joinpath("subagent-driven-development", "task-reviewer-prompt.md").write_text(
            make_template(REVIEWER_BODY + f"\n{marker}\n"), encoding="utf-8"
        )
        result = self.reviewer(root=None, env={"SUPERPOWERS_TEMPLATES_ROOT": str(other)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(marker, Path(result.stdout.strip()).read_text(encoding="utf-8"))

    def test_explicit_root_overrides_env(self) -> None:
        self.seed_report()
        other = self.write_templates(self.tmp / "other" / "skills")
        marker = "EXPLICIT-ROOT-MARKER"
        other.joinpath("subagent-driven-development", "task-reviewer-prompt.md").write_text(
            make_template(REVIEWER_BODY + f"\n{marker}\n"), encoding="utf-8"
        )
        result = self.reviewer(
            root=str(other),
            env={"SUPERPOWERS_TEMPLATES_ROOT": str(self.roots / "6.2.0" / "skills")},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(marker, Path(result.stdout.strip()).read_text(encoding="utf-8"))

    def test_unresolvable_root_names_searched_paths(self) -> None:
        result = self.reviewer(root=str(self.tmp / "nope"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nope", result.stderr)

    def test_falls_through_to_older_version_that_has_the_template(self) -> None:
        """A newer version missing this template must not mask an older one."""
        self.seed_report()
        home = self.tmp / "fallthrough"
        cache = home / ".claude/plugins/cache/claude-plugins-official/superpowers"
        self.write_templates(cache / "6.2.0" / "skills")
        marker = "OLDER-VERSION-MARKER"
        (cache / "6.2.0/skills/subagent-driven-development/task-reviewer-prompt.md").write_text(
            make_template(REVIEWER_BODY + f"\n{marker}\n"), encoding="utf-8"
        )
        # 6.10.0 exists and has a skills/ tree, but not this template.
        newer = cache / "6.10.0" / "skills" / "requesting-code-review"
        newer.mkdir(parents=True)
        newer.joinpath("code-reviewer.md").write_text(
            make_template(CODE_REVIEWER_BODY), encoding="utf-8"
        )
        result = self.reviewer(root=None, env={"HOME": str(home)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(marker, Path(result.stdout.strip()).read_text(encoding="utf-8"))

    # ------------------------------------------------------------ extraction

    def test_emits_body_only(self) -> None:
        self.seed_report()
        result = self.reviewer()
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        for leaked in (
            "# Some Prompt Template",
            "Subagent (general-purpose)",
            "description:",
            "model:",
            "**Placeholders:**",
            "Reviewer returns",
        ):
            self.assertNotIn(leaked, rendered, f"wrapper leaked: {leaked}")
        self.assertTrue(rendered.startswith("You are reviewing one task"))

    def test_rubric_survives_verbatim(self) -> None:
        self.seed_report()
        result = self.reviewer()
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        for sentence in (
            "Do Not Trust the Report",
            "Cross-cutting changes are legitimate",
            "verify real behavior, not mocks",
            "Not everything is Critical",
        ):
            self.assertIn(sentence, rendered)

    def test_indented_inner_fence_survives(self) -> None:
        self.seed_report()
        result = self.run_util(
            "code-reviewer",
            "--plan",
            str(self.plan),
            "--description",
            "d",
            "--requirements",
            "r",
            "--base",
            "HEAD",
            "--head",
            "HEAD",
            root=str(self.roots / "6.2.0" / "skills"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        self.assertIn("```bash", rendered)
        self.assertIn("## Read-Only Review", rendered)

    # ---------------------------------------------------------- placeholders

    def test_unknown_template_rejected(self) -> None:
        result = self.run_util("nonsense", "--plan", str(self.plan))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("task-reviewer", result.stderr)

    def test_no_residual_tokens(self) -> None:
        self.seed_report()
        result = self.reviewer()
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        for token in ("[BRIEF_FILE]", "[GLOBAL_CONSTRAINTS]", "[REPORT_FILE]",
                      "[BASE_SHA]", "[HEAD_SHA]", "[DIFF_FILE]"):
            self.assertNotIn(token, rendered)

    def test_drift_check_rejects_renamed_token(self) -> None:
        self.seed_report()
        drifted = self.write_templates(
            self.tmp / "drifted" / "skills",
            {
                ("subagent-driven-development", "task-reviewer-prompt.md"): REVIEWER_BODY.replace(
                    "[GLOBAL_CONSTRAINTS]", "[CONSTRAINTS_RENAMED]"
                )
            },
        )
        result = self.reviewer(root=str(drifted))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("template drift", result.stderr)
        self.assertIn("GLOBAL_CONSTRAINTS", result.stderr)

    def test_missing_report_is_rejected(self) -> None:
        result = self.reviewer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--report", result.stderr)

    def test_missing_review_package_is_rejected(self) -> None:
        """A derived diff that was never generated must fail, not render a token."""
        self.seed_report()
        sha = self.short()
        (self.workspace / f"review-{sha}..{sha}.diff").unlink()
        result = self.reviewer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--diff", result.stderr)

    def test_substituted_value_containing_a_token_is_not_rescanned(self) -> None:
        """A findings file quoting [DIFF_FILE] must survive verbatim."""
        report = self.seed_report()
        findings = self.repo / "findings.md"
        findings.write_text(
            "- The prompt still shows a literal [DIFF_FILE] token.\n", encoding="utf-8"
        )
        result = self.run_util(
            "re-review", "--plan", str(self.plan), "--task", "1", "--round", "1",
            "--brief", str(self.brief), "--findings", str(findings),
            "--report", str(report), "--base", "HEAD", "--head", "HEAD",
            "--diff", str(self.brief),
            root=str(self.roots / "6.2.0" / "skills"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        self.assertIn("a literal [DIFF_FILE] token", rendered)

    def test_task_n_replacement_is_word_anchored(self) -> None:
        """"Task Name" in body prose must not be mangled into "Task 1ame"."""
        anchored = self.write_templates(
            self.tmp / "anchored" / "skills",
            {
                ("subagent-driven-development", "implementer-prompt.md"):
                    IMPLEMENTER_BODY + "\nRecord the Task Name in your report.\n"
            },
        )
        result = self.run_util(
            "implementer", "--plan", str(self.plan), "--task", "1",
            "--name", "Thing", "--brief", str(self.brief),
            root=str(anchored),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        self.assertIn("Record the Task Name in your report.", rendered)
        self.assertIn("You are implementing Task 1: Thing", rendered)

    def test_derived_report_and_diff_are_used(self) -> None:
        report = self.seed_report()
        sha = self.short()
        result = self.reviewer()
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        self.assertIn(str(report.resolve()), rendered)
        self.assertIn(f"review-{sha}..{sha}.diff", rendered)

    # ----------------------------------------------------------------- brief

    def test_brief_is_required_and_error_says_file_path(self) -> None:
        self.seed_report()
        result = self.run_util(
            "task-reviewer",
            "--plan",
            str(self.plan),
            "--task",
            "1",
            "--base",
            "HEAD",
            "--head",
            "HEAD",
            root=str(self.roots / "6.2.0" / "skills"),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--brief", result.stderr)
        self.assertIn("file path", result.stderr)

    def test_missing_brief_file_is_rejected(self) -> None:
        self.seed_report()
        result = self.reviewer()  # baseline passes
        self.assertEqual(result.returncode, 0, result.stderr)
        self.brief.unlink()
        result = self.reviewer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(str(self.brief), result.stderr)

    def test_empty_brief_file_is_rejected(self) -> None:
        self.seed_report()
        self.brief.write_text("   \n", encoding="utf-8")
        result = self.reviewer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("empty", result.stderr)

    def test_brief_substituted_as_path_not_content(self) -> None:
        self.seed_report()
        result = self.reviewer()
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        self.assertIn(str(self.brief.resolve()), rendered)
        self.assertNotIn("BRIEF-BODY-SENTINEL", rendered)

    # ----------------------------------------------------- workspace/defaults

    def test_workspace_matches_sdd_convention(self) -> None:
        self.seed_report()
        result = self.reviewer()
        out = Path(result.stdout.strip())
        # macOS reports /private/var for /var, so compare resolved paths.
        self.assertEqual(out.parent.resolve(), self.workspace.resolve())
        self.assertEqual(
            (self.repo / ".superpowers" / "sdd" / ".gitignore").read_text(encoding="utf-8"),
            "*\n",
        )

    def test_constraints_default_from_workspace(self) -> None:
        self.seed_report()
        self.workspace.joinpath("global-constraints.md").write_text(
            "CONSTRAINTS-SENTINEL\n", encoding="utf-8"
        )
        result = self.reviewer()
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        self.assertIn("CONSTRAINTS-SENTINEL", rendered)

    def test_explicit_constraints_overrides_default(self) -> None:
        self.seed_report()
        self.workspace.joinpath("global-constraints.md").write_text(
            "CONSTRAINTS-SENTINEL\n", encoding="utf-8"
        )
        explicit = self.repo / "other-constraints.md"
        explicit.write_text("EXPLICIT-SENTINEL\n", encoding="utf-8")
        result = self.reviewer("--constraints", str(explicit))
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        self.assertIn("EXPLICIT-SENTINEL", rendered)
        self.assertNotIn("CONSTRAINTS-SENTINEL", rendered)

    def code_reviewer(self, *extra: str):
        return self.run_util(
            "code-reviewer",
            "--plan",
            str(self.plan),
            "--description",
            "d",
            "--requirements",
            "r",
            "--base",
            "HEAD",
            "--head",
            "HEAD",
            *extra,
            root=str(self.roots / "6.2.0" / "skills"),
        )

    def test_constraints_rejected_for_template_without_slot(self) -> None:
        result = self.code_reviewer("--constraints", str(self.brief))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("code-reviewer", result.stderr)
        self.assertIn("--constraints", result.stderr)

    def test_irrelevant_options_are_rejected_not_ignored(self) -> None:
        """Silently ignoring --brief would let a caller think it was included."""
        for option, value in (("--brief", str(self.brief)), ("--findings", str(self.brief)),
                              ("--name", "Thing"), ("--task", "1")):
            with self.subTest(option=option):
                result = self.code_reviewer(option, value)
                self.assertNotEqual(result.returncode, 0, f"{option} was accepted")
                self.assertIn(option, result.stderr)

    def test_implementer_report_path_need_not_exist(self) -> None:
        result = self.run_util(
            "implementer",
            "--plan",
            str(self.plan),
            "--task",
            "1",
            "--name",
            "Thing",
            "--brief",
            str(self.brief),
            root=str(self.roots / "6.2.0" / "skills"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
        self.assertIn("task-1-report.md", rendered)
        self.assertIn("You are implementing Task 1: Thing", rendered)

    # -------------------------------------------------------- output contract

    def test_stdout_is_exactly_the_path(self) -> None:
        self.seed_report()
        result = self.reviewer()
        self.assertEqual(result.returncode, 0)
        lines = result.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertTrue(Path(lines[0]).is_absolute())
        self.assertTrue(Path(lines[0]).is_file())

    def test_roles_write_distinct_paths(self) -> None:
        self.seed_report()
        reviewer_out = Path(self.reviewer().stdout.strip())
        impl = self.run_util(
            "implementer", "--plan", str(self.plan), "--task", "1",
            "--name", "Thing", "--brief", str(self.brief),
            root=str(self.roots / "6.2.0" / "skills"),
        )
        self.assertEqual(impl.returncode, 0, impl.stderr)
        self.assertNotEqual(reviewer_out, Path(impl.stdout.strip()))

    def test_rereview_rounds_are_distinct(self) -> None:
        report = self.seed_report()
        findings = self.repo / "findings.md"
        findings.write_text("- finding one\n", encoding="utf-8")
        paths = set()
        for round_no in ("1", "2"):
            result = self.run_util(
                "re-review", "--plan", str(self.plan), "--task", "1",
                "--round", round_no, "--brief", str(self.brief),
                "--findings", str(findings), "--report", str(report),
                "--base", "HEAD", "--head", "HEAD",
                "--diff", str(self.brief),
                root=str(self.roots / "6.2.0" / "skills"),
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            paths.add(result.stdout.strip())
        self.assertEqual(len(paths), 2)

    def test_failure_writes_nothing(self) -> None:
        self.seed_report()
        first = Path(self.reviewer().stdout.strip())
        before = first.read_text(encoding="utf-8")
        self.brief.write_text("", encoding="utf-8")
        result = self.reviewer()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(first.read_text(encoding="utf-8"), before)
        leftovers = list(self.workspace.glob(".dispatch-*"))
        self.assertEqual(leftovers, [])


class RealTemplatesTestCase(unittest.TestCase):
    """Render against whatever Superpowers version is actually installed."""

    PLUGIN_ROOT = Path.home() / ".claude/plugins/cache/claude-plugins-official/superpowers"

    def setUp(self) -> None:
        if not self.PLUGIN_ROOT.is_dir():
            self.skipTest("Superpowers plugin cache not installed")

    def test_all_four_templates_render_against_installed_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            repo = tmp / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
            subprocess.run(
                ["git", "config", "user.email", "t@example.com"], cwd=repo, check=True
            )
            subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True)
            (repo / "seed.txt").write_text("seed\n", encoding="utf-8")
            subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
            subprocess.run(["git", "commit", "-qm", "seed"], cwd=repo, check=True)

            plan = repo / "plan.md"
            plan.write_text("# Plan\n\n## Task 1: Thing\n\nDo it.\n", encoding="utf-8")
            brief = repo / "brief.md"
            brief.write_text("A brief.\n", encoding="utf-8")
            aux = repo / "aux.md"
            aux.write_text("Some content.\n", encoding="utf-8")
            workspace = repo / ".superpowers" / "sdd" / "plan"
            workspace.mkdir(parents=True)
            (workspace / "task-1-report.md").write_text("Report.\n", encoding="utf-8")

            common = ["--plan", str(plan), "--task", "1", "--brief", str(brief)]
            cases = {
                "implementer": ["implementer", *common, "--name", "Thing"],
                "task-reviewer": [
                    "task-reviewer", *common, "--base", "HEAD", "--head", "HEAD",
                    "--diff", str(aux),
                ],
                "re-review": [
                    "re-review", *common, "--round", "1", "--findings", str(aux),
                    "--base", "HEAD", "--head", "HEAD", "--diff", str(aux),
                ],
                "code-reviewer": [
                    "code-reviewer", "--plan", str(plan), "--description", "d",
                    "--requirements", "r", "--base", "HEAD", "--head", "HEAD",
                ],
            }
            for name, argv in cases.items():
                with self.subTest(template=name):
                    result = subprocess.run(
                        [str(UTIL), *argv], cwd=repo, capture_output=True, text=True
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    rendered = Path(result.stdout.strip()).read_text(encoding="utf-8")
                    self.assertGreater(len(rendered), 500)
                    self.assertNotIn("Subagent (general-purpose)", rendered)
                    self.assertNotIn("**Placeholders:**", rendered)

    @staticmethod
    def _version(name: str) -> tuple[int, ...] | None:
        import re as _re

        if not _re.fullmatch(r"\d+(\.\d+)*", name):
            return None
        return tuple(int(part) for part in name.split("."))

    def test_installed_task_reviewer_keeps_its_rubric(self) -> None:
        # Order numerically, matching the utility — lexicographic sorting would
        # inspect 6.2.0 while renders used 6.10.0.
        entries = sorted(
            (
                (version, entry)
                for entry in self.PLUGIN_ROOT.iterdir()
                if entry.is_dir() and (version := self._version(entry.name)) is not None
            ),
            key=lambda pair: pair[0],
            reverse=True,
        )
        source = None
        for _, entry in entries:
            candidate = entry / "skills/subagent-driven-development/task-reviewer-prompt.md"
            if candidate.is_file():
                source = candidate
                break
        if source is None:
            self.skipTest("no installed task-reviewer-prompt.md")
        text = source.read_text(encoding="utf-8")
        for sentence in (
            "Do Not Trust the Report",
            "Cross-cutting changes are legitimate",
            "verify real behavior, not mocks",
            "Not everything is Critical",
            "Cannot verify from diff",
        ):
            self.assertIn(sentence, text, "upstream template changed; update the manifest")


class DescribeSlotsTests(DispatchPromptTestCase):
    def test_describe_slots_needs_no_plan(self):
        result = self.run_util("--describe-slots")
        self.assertEqual(result.returncode, 0, result.stderr)
        doc = json.loads(result.stdout)
        self.assertEqual(doc["schema_version"], 1)

    def test_every_template_and_slot_appears(self):
        doc = json.loads(self.run_util("--describe-slots").stdout)
        self.assertEqual(
            set(doc["templates"]),
            {"implementer", "task-reviewer", "re-review", "code-reviewer"},
        )
        options = {s["option"] for s in doc["templates"]["task-reviewer"]}
        self.assertIn("--brief", options)
        self.assertIn("--report", options)
        self.assertIn("--diff", options)

    def test_directions_are_declared_only_for_artifact_slots(self):
        doc = json.loads(self.run_util("--describe-slots").stdout)
        by_option = {
            s["option"]: s for s in doc["templates"]["implementer"]
        }
        self.assertEqual(by_option["--brief"]["direction"], "reads")
        self.assertEqual(by_option["--report"]["direction"], "writes")
        self.assertIsNone(by_option["--context"]["direction"])
        self.assertIsNone(by_option["--name"]["direction"])

    def test_reviewer_report_reads_and_diff_derives(self):
        doc = json.loads(self.run_util("--describe-slots").stdout)
        by_option = {s["option"]: s for s in doc["templates"]["task-reviewer"]}
        self.assertEqual(by_option["--report"]["direction"], "reads")
        self.assertFalse(by_option["--report"]["has_fallback"])
        self.assertEqual(
            by_option["--diff"]["derivation"],
            {
                "kind": "plan_workspace",
                "pattern": "review-{short(base)}..{short(head)}.diff",
                "requires_existing": True,
            },
        )
        self.assertTrue(by_option["--constraints"]["has_fallback"])

    def test_described_diff_pattern_matches_what_supplied_looks_for(self) -> None:
        self.seed_report()
        doc = json.loads(self.run_util("--describe-slots").stdout)
        entry = next(s for s in doc["templates"]["task-reviewer"]
                     if s["option"] == "--diff")
        sha = self.short()
        resolved = (entry["derivation"]["pattern"]
                    .replace("{short(base)}", sha)
                    .replace("{short(head)}", sha))
        self.assertTrue((self.workspace / resolved).is_file())


class FaultTrailerTests(DispatchPromptTestCase):
    def trailer(self, result) -> dict:
        lines = [line for line in result.stderr.splitlines() if line.strip()]
        self.assertTrue(lines, "expected stderr output")
        return json.loads(lines[-1])

    def test_no_such_file_names_option_and_path(self) -> None:
        self.seed_report()
        missing = str(self.repo / "absent.md")
        result = self.reviewer("--brief", missing)
        self.assertEqual(result.returncode, 2)
        body = self.trailer(result)
        self.assertEqual(body["error"], "no_such_file")
        self.assertEqual(body["option"], "--brief")
        self.assertEqual(body["path"], missing)

    def test_empty_file_is_distinct(self) -> None:
        self.seed_report()
        empty = self.repo / "empty.md"
        empty.write_text("", encoding="utf-8")
        body = self.trailer(self.reviewer("--brief", str(empty)))
        self.assertEqual(body["error"], "empty_file")

    def test_not_accepted_names_template(self) -> None:
        self.seed_report()
        body = self.trailer(self.reviewer("--dir", str(self.repo)))
        self.assertEqual(body["error"], "not_accepted")
        self.assertEqual(body["option"], "--dir")
        self.assertEqual(body["template"], "task-reviewer")

    def test_required_missing_when_no_derivation(self) -> None:
        # No seed_report(), so neither the report nor the diff can be derived.
        body = self.trailer(self.reviewer())
        self.assertEqual(body["error"], "required_missing")
        self.assertIn(body["option"], {"--report", "--diff"})
        self.assertEqual(body["template"], "task-reviewer")

    def test_parent_missing_for_a_write_slot(self) -> None:
        result = self.run_util(
            "implementer", "--plan", str(self.plan), "--task", "1",
            "--name", "Thing", "--brief", str(self.brief),
            "--report", str(self.repo / "nodir" / "r.md"),
            root=str(self.roots / "6.2.0" / "skills"),
        )
        self.assertEqual(self.trailer(result)["error"], "parent_missing")

    def test_trailer_never_carries_file_contents(self) -> None:
        # self.brief holds BRIEF-BODY-SENTINEL; a constraints file is inlined.
        constraints = self.repo / "constraints.md"
        constraints.write_text("CONSTRAINTS-BODY-SENTINEL\n", encoding="utf-8")
        result = self.reviewer("--constraints", str(constraints))
        self.assertNotIn("BRIEF-BODY-SENTINEL", result.stderr)
        self.assertNotIn("CONSTRAINTS-BODY-SENTINEL", result.stderr)

    def test_non_argument_failure_emits_no_trailer(self) -> None:
        result = self.reviewer(root=str(self.tmp / "no-such-root"))
        self.assertEqual(result.returncode, 2)
        lines = [line for line in result.stderr.splitlines() if line.strip()]
        with self.assertRaises(json.JSONDecodeError):
            json.loads(lines[-1])


if __name__ == "__main__":
    unittest.main()
