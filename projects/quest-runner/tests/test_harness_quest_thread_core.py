"""Tests for harness CLI abstraction and quest thread registry helpers."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quest_runner_service.harness import (
    ClaudeCodeHarness,
    CodexHarness,
    CursorHarness,
    HarnessJsonlLogSink,
    HarnessMessageError,
    HarnessNotAvailable,
    _run_cli_streaming,
    create_harness,
)
from quest_runner_service.quest_fs import read_thread_registry
from quest_runner_service.quest_thread import (
    QuestThread,
    build_role_prompt,
    build_runtime_context,
    build_thread_name,
    resolve_or_create_thread,
)
from quest_runner_service.quest_types import HarnessKind, QuestMeta


def _noop_version_run(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(["x", "--version"], 0, "1.0.0\n", "")


class BuildThreadNameTests(unittest.TestCase):
    def test_format(self) -> None:
        name = build_thread_name(Path("/a/myrepo"), "0000_slug", "implementer", 0)
        self.assertEqual(name, "myrepo_quest_0000_slug_implementer_0")


class BuildRolePromptTests(unittest.TestCase):
    def test_concatenates_role_and_task(self) -> None:
        out = build_role_prompt("implementer", "Do the thing.", Path("/unused"))
        self.assertTrue(out.startswith("# Implementer Role"))
        self.assertIn("\n\n---\n\nDo the thing.", out)


class BuildRuntimeContextTests(unittest.TestCase):
    def test_includes_quest_role_slice_docs_dir_and_issue_cli_guidance(self) -> None:
        meta = QuestMeta(
            project="example",
            quest_type="main",
            quest_number=7,
            quest_slug="ship_it",
            quest_name="Ship It",
            created_at="2026-03-29T00:00:00Z",
        )
        with tempfile.TemporaryDirectory() as tmp:
            docs = Path(tmp) / "docs" / "quest"
            docs.mkdir(parents=True)
            (docs / "schemas.md").write_text(
                "# Schemas\n\n"
                "## Issue Files\n\n"
                "```markdown\n"
                "## Issue QP-0001\n\n"
                "- status: open|completed\n"
                "```\n",
                encoding="utf-8",
            )
            out = build_runtime_context(
                role_name="implementer",
                meta=meta,
                quest_dir=Path("/tmp/repo/quests/main/0007_ship_it"),
                slice_dir=Path("/tmp/repo/quests/main/0007_ship_it/slices/0002_api"),
                quest_docs_dir=docs,
            )
        self.assertIn("main/0007_ship_it (Ship It)", out)
        self.assertIn("- Role: implementer", out)
        self.assertIn("- Current slice: 0002_api", out)
        self.assertIn(str(docs), out)
        self.assertIn("## Issue workflow (CLI)", out)
        self.assertIn("scripts/quest-runner issues", out)
        self.assertIn("issues --help", out)
        self.assertNotIn("Quest Schemas Reference (`schemas.md`)", out)
        self.assertNotIn("## Issue QP-0001", out)
        self.assertNotIn("- status: open|completed", out)


class RolePromptIssueCliTests(unittest.TestCase):
    def test_issue_roles_mention_cli_commands_and_ownership_rules(self) -> None:
        roles_dir = Path(__file__).resolve().parents[1] / "src" / "quest_runner_service" / "roles"
        for name in (
            "physical_planner",
            "physical_plan_reviewer",
            "polisher",
            "polisher_reviewer",
        ):
            text = (roles_dir / f"{name}.md").read_text(encoding="utf-8")
            self.assertIn("scripts/quest-runner issues", text, msg=name)
            self.assertIn("issues respond", text, msg=name)
        reviewer_text = (roles_dir / "physical_plan_reviewer.md").read_text(encoding="utf-8")
        self.assertIn("--status completed", reviewer_text)
        self.assertIn("issues respond", reviewer_text)
        planner_text = (roles_dir / "physical_planner.md").read_text(encoding="utf-8")
        self.assertIn("must not close issues", planner_text)


class ResolveOrCreateThreadTests(unittest.TestCase):
    @patch("quest_runner_service.harness.subprocess.run", side_effect=_noop_version_run)
    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_empty_registry_creates_entry(
        self,
        mock_stream: MagicMock,
        _mock_run: MagicMock,
    ) -> None:
        mock_stream.return_value = {
            "output_text": 'provider-session-id\n',
            "stream_events_count": 1,
            "idle_timeout": False,
            "elapsed_seconds": 0.1,
        }
        with tempfile.TemporaryDirectory() as tmp:
            quest = Path(tmp) / "quest"
            quest.mkdir()
            repo = Path(tmp) / "repo"
            repo.mkdir()
            (quest / "thread_registry.json").write_text("{}", encoding="utf-8")
            h = CursorHarness({})
            qt = resolve_or_create_thread(
                quest,
                repo,
                "implementer",
                h,
                "0000_q",
                "composer-2",
                None,
                60,
            )
            self.assertIsInstance(qt, QuestThread)
            self.assertEqual(qt.role_name, "implementer")
            self.assertEqual(qt.provider_thread_id, "provider-session-id")
            reg = read_thread_registry(quest)
            self.assertIn("implementer", reg)
            self.assertEqual(reg["implementer"]["thread_name"], qt.thread_name)

    @patch("quest_runner_service.harness.subprocess.run", side_effect=_noop_version_run)
    def test_existing_registry_reuses_thread(self, _mock_run: MagicMock) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            quest = Path(tmp) / "quest"
            quest.mkdir()
            repo = Path(tmp) / "repo"
            repo.mkdir()
            reg = {
                "implementer": {
                    "thread_name": "myrepo_quest_x_implementer_0",
                    "harness_kind": "cursor",
                    "provider_thread_id": "fixed-id",
                    "pass_id": 0,
                    "created_at": "2026-03-29T00:00:00Z",
                    "last_used_at": "2026-03-29T00:00:00Z",
                }
            }
            (quest / "thread_registry.json").write_text(
                json.dumps(reg), encoding="utf-8"
            )
            h = CursorHarness({})
            qt = resolve_or_create_thread(
                quest,
                repo,
                "implementer",
                h,
                "0000_q",
                "composer-2",
                None,
                60,
            )
            self.assertEqual(qt.provider_thread_id, "fixed-id")
            loaded = read_thread_registry(quest)
            self.assertNotEqual(
                loaded["implementer"]["last_used_at"], "2026-03-29T00:00:00Z"
            )


class CreateHarnessFactoryTests(unittest.TestCase):
    @patch("quest_runner_service.harness.subprocess.run", side_effect=_noop_version_run)
    def test_returns_typed_harness(self, _mock_run: MagicMock) -> None:
        self.assertIsInstance(create_harness(HarnessKind.Codex), CodexHarness)
        self.assertIsInstance(create_harness(HarnessKind.Cursor), CursorHarness)
        self.assertIsInstance(create_harness(HarnessKind.ClaudeCode), ClaudeCodeHarness)

    def test_validate_failure_raises(self) -> None:
        with patch(
            "quest_runner_service.harness.subprocess.run",
            side_effect=subprocess.CalledProcessError(1, ["codex"]),
        ):
            with self.assertRaises(HarnessNotAvailable):
                create_harness(HarnessKind.Codex)

    @patch("quest_runner_service.harness.subprocess.run", side_effect=_noop_version_run)
    def test_respects_cli_path_override(self, _mock_run: MagicMock) -> None:
        create_harness(
            HarnessKind.ClaudeCode,
            {"cli_path": "/Users/joyo/.local/bin/claude"},
        )
        _mock_run.assert_called_once()
        self.assertEqual(
            _mock_run.call_args[0][0],
            ["/Users/joyo/.local/bin/claude", "--version"],
        )


class RunCliStreamingTests(unittest.TestCase):
    def test_jsonl_log_sink_writes_enveloped_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "logs" / "step_0001_implementer.jsonl"
            sink = HarnessJsonlLogSink(
                path=path,
                step=1,
                role="implementer",
                thread="thread-name",
                harness="cursor",
                provider_thread_id="provider-id",
            )
            sink.write_control("quest_runner_service.run_started", model="m")
            sink.write_control("quest_runner_service.prompt", text="hi")
            sink.write_stdout_chunk(b'{"type":"assistant","text":"ok"}\nwarning')
            sink.flush_stdout()

            rows = [
                json.loads(line)
                for line in path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual([r["sequence"] for r in rows], [1, 2, 3, 4])
        self.assertTrue(all(r["schema_version"] == 1 for r in rows))
        self.assertEqual(rows[0]["event_kind"], "quest_runner_service.run_started")
        self.assertEqual(rows[1]["event_kind"], "quest_runner_service.prompt")
        self.assertEqual(rows[2]["event_kind"], "provider.json")
        self.assertEqual(rows[2]["payload"]["text"], "ok")
        self.assertEqual(rows[3]["event_kind"], "provider.text")
        self.assertEqual(rows[3]["text"], "warning")

    def test_captures_full_output_on_completion(self) -> None:
        proc = MagicMock()
        proc.poll.side_effect = [None, None, 0]
        proc.stdout = MagicMock()

        chunks = [b"hello\n", b""]

        def read1_side_effect(_n: int) -> bytes:
            return chunks.pop(0) if chunks else b""

        proc.stdout.read1.side_effect = read1_side_effect
        proc.stdout.read.return_value = b""

        with tempfile.TemporaryDirectory() as tmp:
            cwd = Path(tmp)
            with patch("quest_runner_service.harness.subprocess.Popen", return_value=proc):
                out = _run_cli_streaming(["echo", "x"], cwd, idle_timeout_seconds=30)
        self.assertEqual(out["output_text"], "hello\n")
        self.assertEqual(out["exit_code"], 0)
        self.assertFalse(out["idle_timeout"])
        self.assertGreaterEqual(out["stream_events_count"], 1)

    def test_idle_timeout_terminates_process(self) -> None:
        proc = MagicMock()
        proc.poll.return_value = None
        proc.stdout = MagicMock()
        proc.stdout.read1.return_value = b""
        proc.stdout.read.return_value = b""

        with tempfile.TemporaryDirectory() as tmp:
            cwd = Path(tmp)
            with patch("quest_runner_service.harness.subprocess.Popen", return_value=proc):
                with patch(
                    "quest_runner_service.harness.time.monotonic",
                    side_effect=[0.0, 0.0, 100.0, 100.0, 100.0],
                ):
                    with patch("quest_runner_service.harness.time.sleep"):
                        out = _run_cli_streaming(
                            ["sleep", "999"], cwd, idle_timeout_seconds=5
                        )
        self.assertTrue(out["idle_timeout"])
        proc.send_signal.assert_called_once()

    def test_idle_timeout_sigkill_after_sigterm_wait_times_out(self) -> None:
        proc = MagicMock()
        proc.poll.return_value = None
        proc.stdout = MagicMock()
        proc.stdout.read1.return_value = b""
        proc.stdout.read.return_value = b""
        proc.wait.side_effect = [
            subprocess.TimeoutExpired(cmd=["stub"], timeout=5),
            0,
        ]

        with tempfile.TemporaryDirectory() as tmp:
            cwd = Path(tmp)
            with patch("quest_runner_service.harness.subprocess.Popen", return_value=proc):
                with patch(
                    "quest_runner_service.harness.time.monotonic",
                    side_effect=[0.0, 0.0, 100.0, 100.0, 100.0, 100.0],
                ):
                    with patch("quest_runner_service.harness.time.sleep"):
                        out = _run_cli_streaming(
                            ["sleep", "999"], cwd, idle_timeout_seconds=5
                        )
        self.assertTrue(out["idle_timeout"])
        self.assertNotEqual(out["exit_code"], 0)
        proc.send_signal.assert_called_once()
        proc.kill.assert_called_once()
        self.assertEqual(proc.wait.call_count, 2)


class ClaudeHarnessTests(unittest.TestCase):
    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_send_message_command(self, mock_run: MagicMock) -> None:
        mock_run.return_value = {
            "output_text": '{"type":"assistant","text":"ok"}\n',
            "stream_events_count": 1,
            "idle_timeout": False,
            "elapsed_seconds": 1.0,
        }
        h = ClaudeCodeHarness({})
        repo = Path("/tmp/repo")
        quest = Path("/tmp/q")
        r = h.send_message(
            provider_thread_id="sess-1",
            quest_dir=quest,
            repo_path=repo,
            message="hi",
            idle_timeout_seconds=60,
            model="claude-opus-4-6",
            reasoning_effort=None,
        )
        mock_run.assert_called_once()
        cmd, cwd, idle = mock_run.call_args[0]
        self.assertEqual(cwd, repo)
        self.assertEqual(idle, 60)
        self.assertEqual(
            cmd,
            [
                "claude",
                "--resume",
                "sess-1",
                "--model",
                "claude-opus-4-6",
                "--effort",
                "high",
                "--permission-mode",
                "acceptEdits",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--include-hook-events",
                "--max-turns",
                "100",
                "-p",
                "hi",
            ],
        )
        self.assertEqual(r.output_text, "ok")
        self.assertEqual(r.provider_thread_id, "sess-1")

    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_create_thread_command(self, mock_run: MagicMock) -> None:
        mock_run.return_value = {
            "output_text": '{"type":"system","subtype":"init","session_id":"provider-thread-id"}\n',
            "stream_events_count": 1,
            "idle_timeout": False,
            "elapsed_seconds": 0.2,
        }
        h = ClaudeCodeHarness({})
        thread_id = h.create_thread(
            thread_name="tn",
            repo_path=Path("/tmp/r"),
            quest_dir=Path("/tmp/q"),
            model="claude-opus-4-6",
            reasoning_effort=None,
            idle_timeout_seconds=30,
        )
        self.assertEqual(thread_id, "provider-thread-id")
        self.assertEqual(
            mock_run.call_args[0][0],
            [
                "claude",
                "--model",
                "claude-opus-4-6",
                "--effort",
                "high",
                "--permission-mode",
                "acceptEdits",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--include-hook-events",
                "--max-turns",
                "1",
                "-p",
                "Session initialization only. Reply with exactly READY.",
            ],
        )

    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_parses_thinking_and_assistant(self, mock_run: MagicMock) -> None:
        lines = [
            '{"type":"thinking","text":"t1"}',
            '{"type":"assistant","text":"a1"}',
        ]
        mock_run.return_value = {
            "output_text": "\n".join(lines) + "\n",
            "stream_events_count": 2,
            "idle_timeout": False,
            "elapsed_seconds": 0.1,
        }
        h = ClaudeCodeHarness({})
        r = h.send_message(
            provider_thread_id="id",
            quest_dir=Path("/q"),
            repo_path=Path("/r"),
            message="m",
            idle_timeout_seconds=1,
            model="m",
            reasoning_effort="medium",
        )
        self.assertEqual(r.thinking_tokens, "t1")
        self.assertEqual(r.output_text, "a1")


class CodexHarnessTests(unittest.TestCase):
    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_send_message_command_shape(self, mock_run: MagicMock) -> None:
        mock_run.side_effect = [
            {
                "output_text": '{"type":"thread.started","thread_id":"provider-thread-id"}\n',
                "stream_events_count": 1,
                "idle_timeout": False,
                "elapsed_seconds": 0.2,
            },
            {
                "output_text": "agent says",
                "stream_events_count": 1,
                "idle_timeout": False,
                "elapsed_seconds": 0.2,
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            quest = Path(tmp) / "quest"
            quest.mkdir()
            repo = Path(tmp) / "repo"
            repo.mkdir()
            h = CodexHarness({})
            tid = h.create_thread(
                thread_name="tn",
                repo_path=repo,
                quest_dir=quest,
                model="gpt-5.4",
                reasoning_effort=None,
                idle_timeout_seconds=30,
            )
            self.assertEqual(tid, "provider-thread-id")
            h.send_message(
                provider_thread_id=tid,
                quest_dir=quest,
                repo_path=repo,
                message="do work",
                idle_timeout_seconds=30,
                model="gpt-5.4",
                reasoning_effort=None,
            )
            self.assertEqual(mock_run.call_count, 2)
            cmd = mock_run.call_args_list[1][0][0]
            self.assertEqual(
                cmd,
                [
                    "codex",
                    "exec",
                    "resume",
                    "--json",
                    "--model",
                    "gpt-5.4",
                    "-c",
                    "model_reasoning_effort=\"high\"",
                    "--full-auto",
                    tid,
                    "do work",
                ],
            )
            self.assertEqual(
                tid,
                h.get_thread(
                    provider_thread_id=tid,
                    quest_dir=quest,
                )["provider_thread_id"],
            )

    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_create_thread_uses_provider_created_id(self, mock_run: MagicMock) -> None:
        mock_run.return_value = {
            "output_text": '{"type":"thread.started","thread_id":"provider-thread-id"}\n',
            "stream_events_count": 1,
            "idle_timeout": False,
            "elapsed_seconds": 0.2,
        }
        h = CodexHarness({})
        thread_id = h.create_thread(
            thread_name="tn",
            repo_path=Path("/tmp/r"),
            quest_dir=Path("/tmp/q"),
            model="gpt-5.4",
            reasoning_effort="medium",
            idle_timeout_seconds=30,
        )
        self.assertEqual(thread_id, "provider-thread-id")
        self.assertEqual(
            mock_run.call_args[0][0],
            [
                "codex",
                "exec",
                "--json",
                "--model",
                "gpt-5.4",
                "-c",
                "model_reasoning_effort=\"medium\"",
                "--full-auto",
                "Session initialization only. Reply with exactly READY.",
            ],
        )

    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_send_message_prefers_provider_thread_started_id(self, mock_run: MagicMock) -> None:
        mock_run.return_value = {
            "output_text": '\n'.join([
                '{"type":"thread.started","thread_id":"real-thread-id"}',
                '{"type":"turn.started"}',
            ]),
            "stream_events_count": 2,
            "idle_timeout": False,
            "elapsed_seconds": 0.2,
        }
        h = CodexHarness({})
        result = h.send_message(
            provider_thread_id="local-placeholder-id",
            quest_dir=Path("/tmp/q"),
            repo_path=Path("/tmp/r"),
            message="do work",
            idle_timeout_seconds=30,
            model="gpt-5.4",
            reasoning_effort=None,
        )
        self.assertEqual(result.provider_thread_id, "real-thread-id")

    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_send_message_raises_on_structured_error_event(self, mock_run: MagicMock) -> None:
        mock_run.return_value = {
            "output_text": (
                '{"type":"thread.started","thread_id":"provider-thread-id"}\n'
                '{"type":"item.completed","item":{"type":"error","message":"bad model"}}\n'
            ),
            "stream_events_count": 2,
            "idle_timeout": False,
            "elapsed_seconds": 0.2,
        }
        h = CodexHarness({})
        with self.assertRaises(HarnessMessageError) as ctx:
            h.send_message(
                provider_thread_id="provider-thread-id",
                quest_dir=Path("/tmp/q"),
                repo_path=Path("/tmp/r"),
                message="do work",
                idle_timeout_seconds=30,
                model="gpt-5.4",
                reasoning_effort=None,
            )
        self.assertEqual(str(ctx.exception), "Codex returned a structured error event")
        self.assertEqual(ctx.exception.detail, "bad model")


class CursorHarnessTests(unittest.TestCase):
    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_send_message_command_shape(self, mock_run: MagicMock) -> None:
        mock_run.side_effect = [
            {
                "output_text": 'provider-session-id\n',
                "stream_events_count": 1,
                "idle_timeout": False,
                "elapsed_seconds": 0.1,
            },
            {
                "output_text": "out",
                "stream_events_count": 1,
                "idle_timeout": False,
                "elapsed_seconds": 0.1,
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            quest = Path(tmp) / "quest"
            quest.mkdir()
            repo = Path(tmp) / "repo"
            repo.mkdir()
            h = CursorHarness({})
            tid = h.create_thread(
                thread_name="tn",
                repo_path=repo,
                quest_dir=quest,
                model="composer-2",
                reasoning_effort=None,
                idle_timeout_seconds=10,
            )
            self.assertEqual(tid, "provider-session-id")
            h.send_message(
                provider_thread_id=tid,
                quest_dir=quest,
                repo_path=repo,
                message="task",
                idle_timeout_seconds=10,
                model="composer-2",
                reasoning_effort=None,
            )
        cmd = mock_run.call_args[0][0]
        self.assertEqual(
            cmd,
            [
                "cursor-agent",
                "--resume",
                tid,
                "--print",
                "--yolo",
                "--model",
                "composer-2",
                "--output-format",
                "stream-json",
                "--stream-partial-output",
                "task",
            ],
        )

    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_create_thread_uses_provider_created_id(self, mock_run: MagicMock) -> None:
        mock_run.return_value = {
            "output_text": 'provider-session-id\n',
            "stream_events_count": 1,
            "idle_timeout": False,
            "elapsed_seconds": 0.1,
        }
        h = CursorHarness({})
        thread_id = h.create_thread(
            thread_name="tn",
            repo_path=Path("/tmp/r"),
            quest_dir=Path("/tmp/q"),
            model="composer-2",
            reasoning_effort="medium",
            idle_timeout_seconds=10,
        )
        self.assertEqual(thread_id, "provider-session-id")
        self.assertEqual(
            mock_run.call_args[0][0],
            [
                "cursor-agent",
                "create-chat",
            ],
        )

    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_send_message_raises_on_top_level_error_field(self, mock_run: MagicMock) -> None:
        mock_run.return_value = {
            "exit_code": 0,
            "output_text": '{"error":"Cannot use this model"}\n',
            "stream_events_count": 1,
            "idle_timeout": False,
            "elapsed_seconds": 0.1,
        }
        h = CursorHarness({})
        with self.assertRaises(HarnessMessageError) as ctx:
            h.send_message(
                provider_thread_id="provider-session-id",
                quest_dir=Path("/tmp/q"),
                repo_path=Path("/tmp/r"),
                message="task",
                idle_timeout_seconds=10,
                model="composer-2",
                reasoning_effort=None,
            )
        self.assertEqual(str(ctx.exception), "Cursor returned a structured error event")
        self.assertEqual(ctx.exception.detail, "Cannot use this model")

    @patch("quest_runner_service.harness._run_cli_streaming")
    def test_send_message_raises_on_nonzero_exit_code(self, mock_run: MagicMock) -> None:
        mock_run.return_value = {
            "exit_code": 1,
            "output_text": "plain stderr error\n",
            "stream_events_count": 1,
            "idle_timeout": False,
            "elapsed_seconds": 0.1,
        }
        h = CursorHarness({})
        with self.assertRaises(HarnessMessageError) as ctx:
            h.send_message(
                provider_thread_id="provider-session-id",
                quest_dir=Path("/tmp/q"),
                repo_path=Path("/tmp/r"),
                message="task",
                idle_timeout_seconds=10,
                model="composer-2",
                reasoning_effort=None,
            )
        self.assertEqual(str(ctx.exception), "Cursor exited with a non-zero status")
        self.assertIn("Cursor exited with status 1", ctx.exception.detail)
        self.assertIn("plain stderr error", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()
