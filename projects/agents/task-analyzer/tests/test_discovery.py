"""Tests for discovery.py: landed-change discovery, role/task-key
classification, review-round assignment, canonical-arm selection, and the
Quarantine record shape.

landed_changes reads a git ref via `git ls-tree`, never the working tree, so
its tests build a throwaway git repo fixture under tmp_path with subprocess
git commands (branch literally named `main`, matching the default
archive_ref) rather than touching the real repo.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import discovery  # noqa: E402
import extractors  # noqa: E402


def _run_git(repo, *args):
    subprocess.run(
        ["git", "-C", str(repo)] + list(args),
        check=True,
        capture_output=True,
        text=True,
    )


def _make_repo(root):
    """A temporary git repo with two landed (committed) archive dirs -- one
    with a matching plan file, one without -- on a branch named `main`."""
    repo = root / "repo"
    repo.mkdir()
    _run_git(repo, "init", "-q")
    _run_git(repo, "checkout", "-q", "-b", "main")
    _run_git(repo, "config", "user.email", "test@example.com")
    _run_git(repo, "config", "user.name", "Test")

    with_plan = repo / "openspec" / "changes" / "archive" / "2026-07-16-add-noise-modulator"
    with_plan.mkdir(parents=True)
    (with_plan / "proposal.md").write_text("proposal\n")

    without_plan = repo / "openspec" / "changes" / "archive" / "2026-07-01-add-other-thing"
    without_plan.mkdir(parents=True)
    (without_plan / "proposal.md").write_text("proposal\n")

    plans_dir = repo / "docs" / "superpowers" / "plans"
    plans_dir.mkdir(parents=True)
    (plans_dir / "2026-07-15-add-noise-modulator.md").write_text("plan\n")
    # deliberately no plan file for add-other-thing

    _run_git(repo, "add", "-A")
    _run_git(repo, "commit", "-q", "-m", "seed")
    sha = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return repo, sha


class TestLandedChanges(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo, self.sha = _make_repo(Path(self._tmp.name))

    def test_lists_landed_changes_matching_plan_by_stripped_name(self):
        changes, ref_sha = discovery.landed_changes(str(self.repo))
        self.assertEqual(ref_sha, self.sha)
        by_name = {c.name: c for c in changes}
        self.assertIn("add-noise-modulator", by_name)
        self.assertIn("add-other-thing", by_name)

        nm = by_name["add-noise-modulator"]
        self.assertEqual(
            nm.archive_path, "openspec/changes/archive/2026-07-16-add-noise-modulator"
        )
        self.assertEqual(
            nm.plan_path, "docs/superpowers/plans/2026-07-15-add-noise-modulator.md"
        )
        self.assertIsNone(by_name["add-other-thing"].plan_path)

    def test_never_reads_uncommitted_working_tree_changes(self):
        uncommitted = (
            self.repo / "openspec" / "changes" / "archive" / "2026-07-20-uncommitted-change"
        )
        uncommitted.mkdir(parents=True)
        (uncommitted / "proposal.md").write_text("x\n")

        changes, _ = discovery.landed_changes(str(self.repo))
        names = {c.name for c in changes}
        self.assertNotIn("uncommitted-change", names)

    def test_archive_ref_is_configurable(self):
        _run_git(self.repo, "branch", "other-ref")
        changes, ref_sha = discovery.landed_changes(
            str(self.repo), archive_ref="refs/heads/other-ref"
        )
        self.assertEqual(ref_sha, self.sha)
        self.assertTrue(any(c.name == "add-noise-modulator" for c in changes))


class TestClassifyRole(unittest.TestCase):
    """8 canned prompts covering implementer/reviewer/fixer/auditor/other and
    the spawn_path fallback, including the reviewer-vs-brief-reference
    ordering-bug regression called out in the task brief."""

    def test_implementer_brief_file(self):
        prompt = (
            "Read your task brief at "
            ".superpowers/sdd/task-analyzer/task-4-brief.md and implement it."
        )
        self.assertEqual(discovery.classify_role(prompt, None), "implementer")

    def test_reviewer_read_only_task_reviewer_beats_brief_reference(self):
        # Regression for the fixed ordering bug: this prompt references a
        # task-N-brief.md path (which alone would look like an implementer
        # prompt) AND uses explicit reviewer framing. Reviewer patterns must
        # win because they are checked first.
        prompt = (
            "You are a READ-ONLY task reviewer. Read the brief at "
            ".superpowers/sdd/task-analyzer/task-4-brief.md and review the "
            "implementation for spec compliance. Do not edit any files."
        )
        self.assertEqual(discovery.classify_role(prompt, None), "reviewer")

    def test_reviewer_re_review(self):
        prompt = "This is a RE-REVIEW of task 4 after the fixer applied changes."
        self.assertEqual(discovery.classify_role(prompt, None), "reviewer")

    def test_fixer(self):
        prompt = "This is a follow-up fix for task 4 based on reviewer feedback."
        self.assertEqual(discovery.classify_role(prompt, None), "fixer")

    def test_spawn_path_task_fallback(self):
        prompt = "Continue the work as directed."
        self.assertEqual(
            discovery.classify_role(prompt, "/root/task_4_subagent"), "implementer"
        )

    def test_auditor(self):
        prompt = "Perform a full audit of task 4's changes for security issues."
        self.assertEqual(discovery.classify_role(prompt, None), "auditor")

    def test_other_unclassifiable(self):
        prompt = "Please summarize the changelog for this repository."
        self.assertEqual(discovery.classify_role(prompt, None), "other")

    def test_empty_prompt_is_other(self):
        self.assertEqual(discovery.classify_role("", None), "other")
        self.assertEqual(discovery.classify_role(None, None), "other")


class TestTaskKeys(unittest.TestCase):
    """6 canned prompts covering brief-path/change_dir extraction, the
    backtick openspec-change form, `Plan N Task M`, the /private/tmp/sheaf-x
    fallback, .claude/worktrees non-greedy capture, and `task group N`."""

    def test_brief_path_with_change_dir(self):
        prompt = (
            "Read your task brief at "
            ".superpowers/sdd/task-analyzer/task-4-brief.md and implement it."
        )
        keys = discovery.task_keys(prompt, cwd=None)
        self.assertEqual(keys.get("change_dir"), "task-analyzer")
        self.assertEqual(keys.get("task"), "task-4")

    def test_openspec_backtick_name(self):
        prompt = "This session works on OpenSpec change `add-widget-thing` per the design doc."
        keys = discovery.task_keys(prompt, cwd=None)
        self.assertEqual(keys.get("openspec_change"), "add-widget-thing")

    def test_plan_n_task_m(self):
        prompt = "Please complete Plan 2 Task 5 of the SDD decomposition before moving on."
        keys = discovery.task_keys(prompt, cwd=None)
        self.assertEqual(keys.get("task"), "p2-task-5")

    def test_private_tmp_sheaf_fallback(self):
        prompt = "All work for this happens under /private/tmp/sheaf-widget-refactor for now."
        keys = discovery.task_keys(prompt, cwd=None)
        self.assertEqual(keys.get("openspec_change"), "widget-refactor")

    def test_claude_worktrees_non_greedy_capture(self):
        cwd = (
            "/Users/joyo/Sheaf/.claude/worktrees/romantic-germain-72d5b4"
            "/projects/agents/task-analyzer"
        )
        prompt = "Implement the assigned task within this worktree."
        keys = discovery.task_keys(prompt, cwd=cwd)
        self.assertEqual(keys.get("worktree"), "romantic-germain-72d5b4")

    def test_task_group_n(self):
        prompt = "Complete task group 3 before moving to integration testing."
        keys = discovery.task_keys(prompt, cwd=None)
        self.assertEqual(keys.get("task"), "taskgroup-3")


class TestAssignReviewRounds(unittest.TestCase):
    def test_synthetic_task_rounds(self):
        # implementer@t0, reviewer(end t1), implementer@t2, reviewer(end t3),
        # reviewer(end t4, no intervening fix)
        sessions = [
            {
                "session_id": "impl0",
                "role": "implementer",
                "started_at": "2026-07-19T00:00:00",
                "ended_at": "2026-07-19T00:30:00",
            },
            {
                "session_id": "rev1",
                "role": "reviewer",
                "started_at": "2026-07-19T00:45:00",
                "ended_at": "2026-07-19T01:00:00",
            },
            {
                "session_id": "impl2",
                "role": "implementer",
                "started_at": "2026-07-19T02:00:00",
                "ended_at": "2026-07-19T02:30:00",
            },
            {
                "session_id": "rev2",
                "role": "reviewer",
                "started_at": "2026-07-19T02:45:00",
                "ended_at": "2026-07-19T03:00:00",
            },
            {
                "session_id": "rev3",
                "role": "reviewer",
                "started_at": "2026-07-19T03:45:00",
                "ended_at": "2026-07-19T04:00:00",
            },
        ]
        rounds = discovery.assign_review_rounds(sessions)
        self.assertEqual(rounds["impl0"], 0)
        self.assertEqual(rounds["impl2"], 1)
        # each reviewer opens the round following its own boundary; strictly
        # increasing across the three sequential reviewer sessions.
        self.assertLess(rounds["rev1"], rounds["rev2"])
        self.assertLess(rounds["rev2"], rounds["rev3"])
        self.assertGreaterEqual(rounds["rev1"], 1)

    def test_aborted_zero_output_session_still_numbered(self):
        sessions = [
            {
                "session_id": "impl0",
                "role": "implementer",
                "started_at": "2026-07-19T00:00:00",
                "ended_at": "2026-07-19T00:05:00",
            },
            {
                "session_id": "aborted",
                "role": "fixer",
                "started_at": "2026-07-19T00:10:00",
                "ended_at": None,
            },
        ]
        rounds = discovery.assign_review_rounds(sessions)
        self.assertIn("aborted", rounds)
        self.assertEqual(rounds["aborted"], 0)


class TestReviewBoundaries(unittest.TestCase):
    """followup-4 (design.md D5 amendment): a persistent reviewer session
    doing review + re-review contributes ONE boundary per detected verdict
    turn, not just its final ended_at -- so a later implementer/fixer
    session starting between two verdicts gets the round the FIRST verdict
    opened, not round 0."""

    def test_multi_verdict_reviewer_contributes_multiple_boundaries(self):
        sessions = [
            {
                "session_id": "rev-persistent",
                "role": "reviewer",
                "started_at": "2026-07-19T00:00:00",
                "ended_at": "2026-07-19T02:00:00",
                "verdict_boundaries": ["2026-07-19T00:30:00", "2026-07-19T01:30:00"],
            },
        ]
        self.assertEqual(
            discovery.review_boundaries(sessions),
            ["2026-07-19T00:30:00", "2026-07-19T01:30:00"],
        )

    def test_session_without_verdict_boundaries_falls_back_to_ended_at(self):
        # Unchanged single-boundary-per-session behavior for a session with
        # no recoverable turn/verdict data (or a genuinely single-verdict
        # session whose verdict_boundaries key is simply absent).
        sessions = [
            {
                "session_id": "rev-plain",
                "role": "reviewer",
                "started_at": "2026-07-19T00:00:00",
                "ended_at": "2026-07-19T00:30:00",
            },
        ]
        self.assertEqual(discovery.review_boundaries(sessions), ["2026-07-19T00:30:00"])

    def test_empty_verdict_boundaries_list_falls_back_to_ended_at(self):
        sessions = [
            {
                "session_id": "rev-empty",
                "role": "reviewer",
                "started_at": "2026-07-19T00:00:00",
                "ended_at": "2026-07-19T00:30:00",
                "verdict_boundaries": [],
            },
        ]
        self.assertEqual(discovery.review_boundaries(sessions), ["2026-07-19T00:30:00"])

    def test_implementer_between_two_verdicts_gets_round_opened_by_first(self):
        # A persistent reviewer session detects verdicts at t=30 and t=90;
        # a fixer session starting at t=60 (after the first verdict, before
        # the second) must be round 1, not round 0 -- the exact bug
        # (single-boundary-per-session) this amendment fixes.
        sessions = [
            {
                "session_id": "impl0", "role": "implementer",
                "started_at": "2026-07-19T00:00:00", "ended_at": "2026-07-19T00:20:00",
            },
            {
                "session_id": "rev-persistent", "role": "reviewer",
                "started_at": "2026-07-19T00:25:00", "ended_at": "2026-07-19T02:00:00",
                "verdict_boundaries": ["2026-07-19T00:30:00", "2026-07-19T01:30:00"],
            },
            {
                "session_id": "fix1", "role": "fixer",
                "started_at": "2026-07-19T01:00:00", "ended_at": "2026-07-19T01:10:00",
            },
        ]
        rounds = discovery.assign_review_rounds(sessions)
        self.assertEqual(rounds["impl0"], 0)
        self.assertEqual(rounds["fix1"], 1)

    def test_reviewer_own_round_reflects_its_latest_verdict(self):
        sessions = [
            {
                "session_id": "rev-persistent", "role": "reviewer",
                "started_at": "2026-07-19T00:25:00", "ended_at": "2026-07-19T02:00:00",
                "verdict_boundaries": ["2026-07-19T00:30:00", "2026-07-19T01:30:00"],
            },
        ]
        rounds = discovery.assign_review_rounds(sessions)
        # Both of this session's own boundaries are <= its own ended_at, so
        # it's counted at round 2 (its final state), matching the original
        # single-boundary-per-session semantics generalized to N boundaries.
        self.assertEqual(rounds["rev-persistent"], 2)


class TestParseTimestamp(unittest.TestCase):
    """fix-round-1 review, finding 3: raw ISO timestamp STRINGS must never
    be sorted/compared directly -- providers format them differently ('Z'
    suffix vs explicit '+00:00' offset) and even within one provider, two
    events at the same whole second may differ in whether they carry a
    fractional-second component, which flips string-comparison order
    ('.' (0x2E) sorts before 'Z' (0x5A))."""

    def test_z_suffix_and_offset_form_parse_equal(self):
        a = discovery.parse_timestamp("2026-07-19T00:00:08Z")
        b = discovery.parse_timestamp("2026-07-19T00:00:08+00:00")
        self.assertEqual(a, b)

    def test_bare_second_sorts_after_fractional_same_second_by_value(self):
        # The exact failure mode: a fractional-second timestamp sorts
        # BEFORE a bare-second timestamp at the same whole second under
        # plain string comparison ('.' (0x2E) < 'Z' (0x5A)), even though
        # 08.500 is chronologically LATER than (bare) 08.000 -- string
        # order gets it backwards.
        bare = "2026-07-19T00:00:08Z"  # == 08.000
        fractional = "2026-07-19T00:00:08.500Z"
        self.assertLess(fractional, bare)  # string order: backwards
        # ...but as real instants, the datetime parse must reflect the
        # TRUE order: bare (08.000) is earlier than fractional (08.500).
        self.assertLess(discovery.parse_timestamp(bare), discovery.parse_timestamp(fractional))

    def test_missing_or_empty_parses_to_earliest_possible(self):
        self.assertEqual(discovery.parse_timestamp(None), discovery.parse_timestamp(""))
        self.assertLessEqual(discovery.parse_timestamp(None), discovery.parse_timestamp("2026-01-01T00:00:00Z"))

    def test_unparseable_falls_back_to_earliest_without_raising(self):
        self.assertEqual(discovery.parse_timestamp("not-a-timestamp"), discovery.parse_timestamp(None))

    def test_review_boundaries_sorted_by_value_not_string_across_mixed_precision(self):
        # A task whose reviewer boundaries mix bare-second and
        # fractional-second timestamps must still sort into true
        # chronological order, not raw string order.
        sessions = [
            {
                "session_id": "rev-1", "role": "reviewer",
                "started_at": "2026-07-19T00:00:00Z", "ended_at": "2026-07-19T00:00:09Z",
                "verdict_boundaries": ["2026-07-19T00:00:08Z", "2026-07-19T00:00:08.500Z"],
            },
        ]
        # True chronological order: 08Z (=08.000) before 08.500Z.
        self.assertEqual(
            discovery.review_boundaries(sessions),
            ["2026-07-19T00:00:08Z", "2026-07-19T00:00:08.500Z"],
        )

    def test_assign_review_rounds_correct_under_mixed_timestamp_precision(self):
        # A fixer session starting at 08.250Z (between the two boundaries
        # in TRUE chronological order) must land in round 1 -- a plain
        # string comparison would place it incorrectly since "08.250Z" <
        # "08Z" as strings even though 08.250 is chronologically AFTER
        # 08.000 (bare "08Z").
        sessions = [
            {
                "session_id": "rev-1", "role": "reviewer",
                "started_at": "2026-07-19T00:00:00Z", "ended_at": "2026-07-19T00:00:09Z",
                "verdict_boundaries": ["2026-07-19T00:00:08Z", "2026-07-19T00:00:08.500Z"],
            },
            {
                "session_id": "fix-1", "role": "fixer",
                "started_at": "2026-07-19T00:00:08.250Z", "ended_at": "2026-07-19T00:00:08.900Z",
            },
        ]
        rounds = discovery.assign_review_rounds(sessions)
        self.assertEqual(rounds["fix-1"], 1)


def _session_record(session_id, output_tokens, model, effort, started_at, ended_at, role):
    """A real extractors.SessionRecord, with `role` bolted on as a plain
    attribute -- SessionRecord itself has no `role` field (Task 3's
    extraction layer doesn't classify), but a real joined session (as Task 5
    will produce) is exactly this shape: a SessionRecord plus a role decided
    by classify_role. output_tokens lives at `tokens.output_tokens`, not as
    a top-level field."""
    rec = extractors.SessionRecord(
        session_id=session_id,
        provider="claude",
        harness_entry="main",
        model=model,
        effort=effort,
        started_at=started_at,
        ended_at=ended_at,
        prompt="implement the task",
        tokens=extractors.TokenTotals(output_tokens=output_tokens),
        peak_context=0,
        n_compactions=0,
        n_turns=1,
        n_tool_calls=0,
        turns=[],
        last_message=None,
    )
    rec.role = role
    return rec


class TestCanonicalArm(unittest.TestCase):
    def test_picks_larger_round0_implementer_when_two_exist_session_record(self):
        # Regression: canonical_arm must read output_tokens from a real
        # SessionRecord's nested `tokens.output_tokens`, not a top-level
        # field that SessionRecord doesn't have (which would silently read
        # as 0 for every session and degrade selection to input order).
        sessions = [
            _session_record(
                "impl_a",
                1000,
                "gpt-5.5",
                "high",
                "2026-07-19T00:00:00",
                "2026-07-19T00:30:00",
                "implementer",
            ),
            _session_record(
                "impl_b",
                2500,
                "claude-sonnet-5",
                "high",
                "2026-07-19T00:05:00",
                "2026-07-19T00:35:00",
                "implementer",
            ),
            _session_record(
                "rev1",
                0,
                "claude-sonnet-5",
                "high",
                "2026-07-19T01:00:00",
                "2026-07-19T01:30:00",
                "reviewer",
            ),
        ]
        model, effort, basis = discovery.canonical_arm(sessions)
        self.assertEqual(model, "claude-sonnet-5")
        self.assertEqual(effort, "high")
        self.assertEqual(basis["output_tokens"], 2500)
        alt_ids = {a["session_id"] for a in basis["alternates"]}
        self.assertEqual(alt_ids, {"impl_a"})

    def test_picks_larger_round0_implementer_when_two_exist(self):
        sessions = [
            {
                "session_id": "impl_a",
                "role": "implementer",
                "started_at": "2026-07-19T00:00:00",
                "ended_at": "2026-07-19T00:30:00",
                "model": "gpt-5.5",
                "effort": "high",
                "output_tokens": 1000,
            },
            {
                "session_id": "impl_b",
                "role": "implementer",
                "started_at": "2026-07-19T00:05:00",
                "ended_at": "2026-07-19T00:35:00",
                "model": "claude-sonnet-5",
                "effort": "high",
                "output_tokens": 2500,
            },
            {
                "session_id": "rev1",
                "role": "reviewer",
                "started_at": "2026-07-19T01:00:00",
                "ended_at": "2026-07-19T01:30:00",
            },
        ]
        model, effort, basis = discovery.canonical_arm(sessions)
        self.assertEqual(model, "claude-sonnet-5")
        self.assertEqual(effort, "high")
        alt_ids = {a["session_id"] for a in basis["alternates"]}
        self.assertEqual(alt_ids, {"impl_a"})


class TestQuarantine(unittest.TestCase):
    def test_ambiguous_task_key_record_shape(self):
        q = discovery.Quarantine(
            session_id="codex:abc123",
            reason="task key matches >1 task",
            candidates=["task-4", "p2-task-4"],
        )
        self.assertEqual(q.session_id, "codex:abc123")
        self.assertEqual(q.reason, "task key matches >1 task")
        self.assertEqual(q.candidates, ["task-4", "p2-task-4"])


if __name__ == "__main__":
    unittest.main()
