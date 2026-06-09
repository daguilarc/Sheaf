"""Unit tests for quest filesystem helpers."""

import shutil
import tempfile
import textwrap
import unittest
from pathlib import Path

from quest_runner_service.quest_fs import (
    QuestStateParseError,
    append_history,
    append_issue_response,
    list_slice_dirs,
    read_execution_config,
    read_harness_configs,
    read_history,
    read_issue_responses,
    read_issues,
    read_quest_state,
    read_state_execution_config_version,
    write_issues,
    write_quest_state,
)
from quest_runner_service.quest_types import (
    ExecutionProfile,
    HarnessKind,
    IssueEntry,
    IssueResponseEntry,
    QuestState,
    QuestStateInfo,
    TransitionRecord,
)


class QuestStateRoundTripTests(unittest.TestCase):
    def test_quest_active_slice_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            original = QuestStateInfo(
                state=QuestState.ExecuteSlice,
                current_slice=0,
                updated_at="2026-04-01T12:00:00Z",
                active_slice="0000_demo_slice",
            )
            write_quest_state(q, original)
            loaded = read_quest_state(q)
            self.assertEqual(loaded.active_slice, "0000_demo_slice")

    def test_quest_state_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            original = QuestStateInfo(
                state=QuestState.ExecuteSlice,
                current_slice=2,
                updated_at="2026-03-29T12:00:00Z",
            )
            write_quest_state(q, original)
            loaded = read_quest_state(q)
            self.assertEqual(loaded, original)

    def test_current_slice_null(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            path = q / "state.md"
            path.write_text(
                "# Quest State\n\n"
                "state: PrePlanning\n"
                "current_slice: null\n"
                "updated_at: 2026-03-29T12:00:00Z\n",
                encoding="utf-8",
            )
            info = read_quest_state(q)
            self.assertIsNone(info.current_slice)

    def test_current_slice_integer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            path = q / "state.md"
            path.write_text(
                "# Quest State\n\n"
                "state: ExecuteSlice\n"
                "current_slice: 0\n"
                "updated_at: 2026-03-29T12:00:00Z\n",
                encoding="utf-8",
            )
            info = read_quest_state(q)
            self.assertEqual(info.current_slice, 0)


class QuestStateValidationTests(unittest.TestCase):
    """PR-0001: reject invalid state/current_slice combinations."""

    def test_preplanning_with_slice_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state.md").write_text(
                "# Quest State\n\n"
                "state: PrePlanning\n"
                "current_slice: 3\n"
                "updated_at: 2026-03-29T12:00:00Z\n",
                encoding="utf-8",
            )
            with self.assertRaises(QuestStateParseError):
                read_quest_state(q)

    def test_execute_slice_with_null_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state.md").write_text(
                "# Quest State\n\n"
                "state: ExecuteSlice\n"
                "current_slice: null\n"
                "updated_at: 2026-03-29T12:00:00Z\n",
                encoding="utf-8",
            )
            with self.assertRaises(QuestStateParseError):
                read_quest_state(q)

    def test_completed_with_slice_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state.md").write_text(
                "# Quest State\n\n"
                "state: Completed\n"
                "current_slice: 1\n"
                "updated_at: 2026-03-29T12:00:00Z\n",
                encoding="utf-8",
            )
            with self.assertRaises(QuestStateParseError):
                read_quest_state(q)

    def test_execute_slice_with_index_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state.md").write_text(
                "# Quest State\n\n"
                "state: ExecuteSlice\n"
                "current_slice: 0\n"
                "updated_at: 2026-03-29T12:00:00Z\n",
                encoding="utf-8",
            )
            info = read_quest_state(q)
            self.assertEqual(info.state, QuestState.ExecuteSlice)
            self.assertEqual(info.current_slice, 0)

    def test_normalized_execute_slice_without_active_slice_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state.md").write_text(
                textwrap.dedent(
                    """\
                    # State

                    - global_step: 0
                    - machine_name: quest
                    - machine_path: quests/main/0001_slug
                    - state: ExecuteSlice
                    - updated_at: 2026-04-01T12:00:00Z

                    ## Tags

                    - quest_number: 1
                    - quest_slug: slug
                    - quest_type: main
                    """
                ),
                encoding="utf-8",
            )
            info = read_quest_state(q)
            self.assertEqual(info.state, QuestState.ExecuteSlice)
            self.assertIsNone(info.current_slice)
            self.assertIsNone(info.active_slice)


class IssueFileTests(unittest.TestCase):
    def test_read_issues_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "issues.md"
            p.write_text("# Issues\n", encoding="utf-8")
            self.assertEqual(read_issues(p), [])

    def test_read_issues_one_and_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "issues.md"
            issue = IssueEntry(
                issue_id="QP-0001",
                status="open",
                owner_role="physical_plan_reviewer",
                created_at="2026-03-28T00:00:00Z",
                updated_at="2026-03-28T00:00:00Z",
                title="Example",
                details="Body text.",
                resolution_notes=None,
            )
            write_issues(p, [issue])
            loaded = read_issues(p)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0], issue)

    def test_read_issues_multiple(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "issues.md"
            a = IssueEntry(
                issue_id="QP-0001",
                status="open",
                owner_role="physical_plan_reviewer",
                created_at="2026-03-28T00:00:00Z",
                updated_at="2026-03-28T00:00:00Z",
                title="First",
                details="d1",
                resolution_notes=None,
            )
            b = IssueEntry(
                issue_id="QP-0002",
                status="completed",
                owner_role="polisher_reviewer",
                created_at="2026-03-28T01:00:00Z",
                updated_at="2026-03-28T02:00:00Z",
                title="Second",
                details="d2",
                resolution_notes="fixed",
            )
            write_issues(p, [a, b])
            loaded = read_issues(p)
            self.assertEqual(loaded, [a, b])


class IssueMarkdownRoundTripTests(unittest.TestCase):
    """PR-0002: multi-line markdown in details/resolution_notes must round-trip."""

    def test_multiline_details_with_bullets_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "issues.md"
            details = (
                "First paragraph explaining the problem.\n"
                "\n"
                "Second paragraph with more context:\n"
                "\n"
                "- bullet one\n"
                "- bullet two\n"
                "- bullet three\n"
                "\n"
                "Final paragraph."
            )
            issue = IssueEntry(
                issue_id="PR-0010",
                status="open",
                owner_role="polisher_reviewer",
                created_at="2026-03-29T00:00:00Z",
                updated_at="2026-03-29T00:00:00Z",
                title="Multi-line test",
                details=details,
                resolution_notes=None,
            )
            write_issues(p, [issue])
            loaded = read_issues(p)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0].details, details)
            self.assertIsNone(loaded[0].resolution_notes)

    def test_multiline_resolution_notes_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "issues.md"
            notes = (
                "Fixed by:\n"
                "\n"
                "1. Adding validation\n"
                "2. Updating the parser\n"
                "\n"
                "See commit abc123."
            )
            issue = IssueEntry(
                issue_id="PR-0011",
                status="completed",
                owner_role="polisher_reviewer",
                created_at="2026-03-29T00:00:00Z",
                updated_at="2026-03-29T01:00:00Z",
                title="Resolution notes test",
                details="Simple details.",
                resolution_notes=notes,
            )
            write_issues(p, [issue])
            loaded = read_issues(p)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0].resolution_notes, notes)

    def test_details_with_reserved_field_name_bullets_round_trip(self) -> None:
        """Bullets like '- status: ...' inside details must not be parsed as fields."""
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "issues.md"
            details = (
                "The parser has problems:\n"
                "\n"
                "- status: it silently accepts bad data\n"
                "- title: is not validated\n"
                "- details: can be corrupted\n"
                "\n"
                "All of these need fixing."
            )
            issue = IssueEntry(
                issue_id="PR-0020",
                status="open",
                owner_role="polisher_reviewer",
                created_at="2026-03-29T00:00:00Z",
                updated_at="2026-03-29T00:00:00Z",
                title="Reserved field name bullets in details",
                details=details,
                resolution_notes=None,
            )
            write_issues(p, [issue])
            loaded = read_issues(p)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0].details, details)
            self.assertEqual(loaded[0].status, "open")
            self.assertEqual(loaded[0].title, "Reserved field name bullets in details")

    def test_resolution_notes_with_reserved_field_name_bullets_round_trip(self) -> None:
        """Bullets like '- details: ...' inside resolution_notes must not break parsing."""
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "issues.md"
            notes = (
                "Changes made:\n"
                "\n"
                "- details: updated the parser to handle this\n"
                "- status: now properly validated\n"
                "- title: also checked"
            )
            issue = IssueEntry(
                issue_id="PR-0021",
                status="completed",
                owner_role="polisher_reviewer",
                created_at="2026-03-29T00:00:00Z",
                updated_at="2026-03-29T01:00:00Z",
                title="Reserved names in resolution notes",
                details="Simple.",
                resolution_notes=notes,
            )
            write_issues(p, [issue])
            loaded = read_issues(p)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0].resolution_notes, notes)

    def test_multiple_issues_with_multiline_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "issues.md"
            a = IssueEntry(
                issue_id="PR-0001",
                status="open",
                owner_role="reviewer",
                created_at="2026-03-29T00:00:00Z",
                updated_at="2026-03-29T00:00:00Z",
                title="First",
                details="Para one.\n\n- item a\n- item b",
                resolution_notes=None,
            )
            b = IssueEntry(
                issue_id="PR-0002",
                status="completed",
                owner_role="reviewer",
                created_at="2026-03-29T00:00:00Z",
                updated_at="2026-03-29T01:00:00Z",
                title="Second",
                details="Simple.",
                resolution_notes="Done.\n\n- step 1\n- step 2",
            )
            write_issues(p, [a, b])
            loaded = read_issues(p)
            self.assertEqual(loaded, [a, b])


class IssueResponseTests(unittest.TestCase):
    def test_read_empty_when_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "responses.md"
            self.assertEqual(read_issue_responses(p), [])

    def test_append_and_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "responses.md"
            entry = IssueResponseEntry(
                issue_id="QP-0001",
                response_timestamp="2026-01-02T00:00:00Z",
                outcome="Fixed",
                explanation="Line one.\nLine two.",
            )
            append_issue_response(p, entry)
            loaded = read_issue_responses(p)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0].issue_id, "QP-0001")
            self.assertEqual(loaded[0].outcome, "Fixed")
            self.assertEqual(loaded[0].explanation, "Line one.\nLine two.")
            second = IssueResponseEntry(
                issue_id="QP-0001",
                response_timestamp="2026-01-03T00:00:00Z",
                outcome="NotFixed",
                explanation="Still blocked.",
            )
            append_issue_response(p, second)
            loaded2 = read_issue_responses(p)
            self.assertEqual(len(loaded2), 2)
            self.assertEqual(loaded2[1].outcome, "NotFixed")


class ListSliceDirsTests(unittest.TestCase):
    def test_sorts_and_ignores_non_matching(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            quest = Path(tmp) / "0000_q"
            sl = quest / "slices"
            sl.mkdir(parents=True)
            (sl / "0001_second").mkdir()
            (sl / "0000_first").mkdir()
            (sl / "not_a_slice").mkdir()
            (sl / "readme.txt").write_text("x", encoding="utf-8")
            dirs = list_slice_dirs(quest)
            self.assertEqual([p.name for p in dirs], ["0000_first", "0001_second"])


class ExecutionConfigTests(unittest.TestCase):
    def test_read_execution_config(self) -> None:
        root = Path(__file__).resolve().parents[1]
        default_cfg = (
            root / "src" / "quest_runner_service" / "default_state_execution_config.yaml"
        )
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            dest = q / "state_execution_config.yaml"
            shutil.copy(default_cfg, dest)
            profiles = read_execution_config(q)
            self.assertIn("implementer", profiles)
            impl = profiles["implementer"]
            self.assertIsInstance(impl, ExecutionProfile)
            self.assertEqual(impl.harness, HarnessKind.Cursor)
            self.assertEqual(impl.model, "composer-2.5")
            self.assertIsNone(impl.reasoning_effort)
            self.assertEqual(impl.idle_timeout_seconds, 3600)
            self.assertEqual(impl.config_version, 2)
            self.assertEqual(impl.modify_block, ["$currentProject/quests/**"])
            self.assertIn("$currentSlice/implementation_done.md", impl.modify_allow)
            self.assertIn("$currentQuest/human_intervention_request.md", impl.modify_allow)
            plan_reviewer = profiles["physical_plan_reviewer"]
            self.assertIn(
                "$currentQuest/physicalplan_accepted.md",
                plan_reviewer.modify_allow,
            )
            impl_reviewer = profiles["polisher_reviewer"]
            self.assertIn(
                "$currentSlice/implementation_accepted.md",
                impl_reviewer.modify_allow,
            )
            doc = profiles["documenter"]
            self.assertEqual(doc.config_version, 2)
            self.assertIn("$currentProject/docs/**", doc.modify_allow)
            self.assertEqual(read_state_execution_config_version(q), 2)

    def test_read_execution_config_version_1_empty_path_rules(self) -> None:
        cfg = textwrap.dedent(
            """\
            version: 1
            profiles:
              implementer:
                harness: cursor
                model: composer-2
                idle_timeout_seconds: 3600
                modify_allow:
                  - "should/be/ignored"
                modify_block:
                  - "**"
            """
        )
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state_execution_config.yaml").write_text(cfg, encoding="utf-8")
            profiles = read_execution_config(q)
            impl = profiles["implementer"]
            self.assertEqual(impl.config_version, 1)
            self.assertIsNone(impl.reasoning_effort)
            self.assertEqual(impl.modify_allow, [])
            self.assertEqual(impl.modify_block, [])

    def test_read_execution_config_reasoning_effort_optional(self) -> None:
        cfg = textwrap.dedent(
            """\
            version: 2
            profiles:
              implementer:
                harness: cursor
                model: composer-2
                reasoning_effort: medium
                idle_timeout_seconds: 3600
                modify_allow: []
                modify_block: []
            """
        )
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state_execution_config.yaml").write_text(cfg, encoding="utf-8")
            profiles = read_execution_config(q)
            self.assertEqual(profiles["implementer"].reasoning_effort, "medium")

    def test_read_execution_config_v2_rejects_standalone_starstar_in_allow(self) -> None:
        cfg = textwrap.dedent(
            """\
            version: 2
            profiles:
              implementer:
                harness: cursor
                model: composer-2
                idle_timeout_seconds: 3600
                modify_allow:
                  - "**"
                modify_block:
                  - "**"
            """
        )
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state_execution_config.yaml").write_text(cfg, encoding="utf-8")
            with self.assertRaises(ValueError) as ctx:
                read_execution_config(q)
            self.assertIn("standalone", str(ctx.exception).lower())

    def test_read_execution_config_v2_accepts_known_placeholder_in_block(self) -> None:
        cfg = textwrap.dedent(
            """\
            version: 2
            profiles:
              implementer:
                harness: cursor
                model: composer-2
                idle_timeout_seconds: 3600
                modify_allow:
                  - "$currentQuest/human_intervention_request.md"
                modify_block:
                  - "$currentQuest/**"
            """
        )
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state_execution_config.yaml").write_text(cfg, encoding="utf-8")
            profiles = read_execution_config(q)
            self.assertEqual(profiles["implementer"].modify_block, ["$currentQuest/**"])

    def test_read_execution_config_v2_rejects_unknown_placeholder(self) -> None:
        cfg = textwrap.dedent(
            """\
            version: 2
            profiles:
              implementer:
                harness: cursor
                model: composer-2
                idle_timeout_seconds: 3600
                modify_allow:
                  - "$currentRepo/foo"
                modify_block:
                  - "$currentRepo/**"
            """
        )
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state_execution_config.yaml").write_text(cfg, encoding="utf-8")
            with self.assertRaises(ValueError) as ctx:
                read_execution_config(q)
            self.assertIn("unknown placeholder", str(ctx.exception).lower())

    def test_read_execution_config_v2_rejects_non_list_modify_allow(self) -> None:
        cfg = textwrap.dedent(
            """\
            version: 2
            profiles:
              implementer:
                harness: cursor
                model: composer-2
                idle_timeout_seconds: 3600
                modify_allow: "oops"
                modify_block:
                  - "**"
            """
        )
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state_execution_config.yaml").write_text(cfg, encoding="utf-8")
            with self.assertRaises(ValueError) as ctx:
                read_execution_config(q)
            self.assertIn("modify_allow", str(ctx.exception))

    def test_read_execution_config_rejects_bad_version(self) -> None:
        cfg = "version: 99\nprofiles: {}\n"
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state_execution_config.yaml").write_text(cfg, encoding="utf-8")
            with self.assertRaises(ValueError):
                read_execution_config(q)

    def test_read_harness_configs(self) -> None:
        root = Path(__file__).resolve().parents[1]
        default_cfg = (
            root / "src" / "quest_runner_service" / "default_state_execution_config.yaml"
        )
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            dest = q / "state_execution_config.yaml"
            shutil.copy(default_cfg, dest)
            harnesses = read_harness_configs(q)
            self.assertIn("claude_code", harnesses)
            self.assertEqual(
                harnesses["claude_code"]["cli_path"],
                "/Users/joyo/.local/bin/claude",
            )


class MalformedStateTests(unittest.TestCase):
    def test_bad_header_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state.md").write_text(
                "# Wrong\n\nstate: PrePlanning\ncurrent_slice: null\n"
                "updated_at: 2026-03-29T12:00:00Z\n",
                encoding="utf-8",
            )
            with self.assertRaises(QuestStateParseError):
                read_quest_state(q)

    def test_bad_state_value_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state.md").write_text(
                "# Quest State\n\nstate: NotAState\ncurrent_slice: null\n"
                "updated_at: 2026-03-29T12:00:00Z\n",
                encoding="utf-8",
            )
            with self.assertRaises(QuestStateParseError):
                read_quest_state(q)

    def test_bad_current_slice_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            q = Path(tmp) / "quest"
            q.mkdir()
            (q / "state.md").write_text(
                "# Quest State\n\nstate: PrePlanning\n"
                "current_slice: bogus\nupdated_at: 2026-03-29T12:00:00Z\n",
                encoding="utf-8",
            )
            with self.assertRaises(QuestStateParseError):
                read_quest_state(q)


class HistoryTests(unittest.TestCase):
    def test_append_and_read_history(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "state_history.md"
            r1 = TransitionRecord(
                timestamp="2026-03-28T18:22:41Z",
                previous_state="PrePlanning",
                next_state="PhysicalPlanning",
                commit="a" * 40,
                thread_name="none",
                notes="first",
            )
            r2 = TransitionRecord(
                timestamp="2026-03-29T06:51:47Z",
                previous_state="ReviewPhysicalPlan",
                next_state="ExecuteSlice",
                commit="b" * 40,
                thread_name="none",
                notes="second",
            )
            append_history(p, r1)
            append_history(p, r2)
            rows = read_history(p)
            self.assertEqual(rows, [r1, r2])


if __name__ == "__main__":
    unittest.main()
