"""Tests for the Quest Runner CLI."""

from __future__ import annotations

import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from quest_runner_service.cli import (
    RecordedRequest,
    build_parser,
    main,
    resolve_base_url,
)


class FakeTransport:
    def __init__(self, responses: list[tuple[int, dict]] | None = None) -> None:
        self.requests: list[RecordedRequest] = []
        self.responses = responses or [(200, {})]
        self.index = 0

    def __call__(
        self,
        method: str,
        url: str,
        body: dict | None,
    ) -> tuple[int, dict]:
        self.requests.append(RecordedRequest(method=method, url=url, body=body))
        if self.index >= len(self.responses):
            return 200, {}
        status, data = self.responses[self.index]
        self.index += 1
        return status, data


class ResolveBaseUrlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[3]

    def test_cli_base_url_wins(self) -> None:
        url, warning = resolve_base_url(
            cli_base_url="http://cli.example:1",
            env={"QUEST_RUNNER_URL": "http://env.example:2"},
            start_path=self.repo_root,
        )
        self.assertEqual(url, "http://cli.example:1")
        self.assertIsNone(warning)

    def test_env_url_wins_over_config(self) -> None:
        url, warning = resolve_base_url(
            env={"QUEST_RUNNER_URL": "http://env.example:2"},
            start_path=self.repo_root,
        )
        self.assertEqual(url, "http://env.example:2")
        self.assertIsNone(warning)

    def test_config_services_json(self) -> None:
        url, warning = resolve_base_url(start_path=self.repo_root)
        self.assertEqual(url, "http://localhost:9002")
        self.assertIsNone(warning)

    def test_zero_host_becomes_localhost(self) -> None:
        config_dir = self.repo_root / "config"
        self.assertTrue((config_dir / "services.json").is_file())
        raw = json.loads((config_dir / "services.json").read_text(encoding="utf-8"))
        quest_runner = next(item for item in raw if item["name"] == "quest-runner")
        self.assertEqual(quest_runner["host"], "0.0.0.0")
        url, _warning = resolve_base_url(start_path=self.repo_root)
        self.assertEqual(url, "http://localhost:9002")

    def test_fallback_when_config_missing(self) -> None:
        with patch(
            "quest_runner_service.cli._service_url_from_config",
            return_value=None,
        ):
            url, warning = resolve_base_url(start_path=self.repo_root)
        self.assertEqual(url, "http://localhost:9002")
        self.assertIn("fallback", warning or "")


class HelpTests(unittest.TestCase):
    def test_top_level_help_includes_examples_and_notes(self) -> None:
        parser = build_parser()
        help_text = parser.format_help()
        self.assertIn("config/services.json", help_text)
        self.assertIn("QUEST_RUNNER_URL", help_text)
        self.assertIn("--base-url", help_text)
        self.assertIn("--project", help_text)
        self.assertIn("--type", help_text)
        self.assertIn("--number", help_text)
        self.assertIn("scripts/quest-runner create", help_text)
        self.assertIn("scripts/quest-runner run", help_text)
        self.assertIn("scripts/quest-runner advance", help_text)
        self.assertIn("scripts/quest-runner land", help_text)
        self.assertIn("scripts/quest-runner issues list", help_text)
        self.assertIn("scripts/quest-runner issues read", help_text)
        self.assertIn("scripts/quest-runner issues create", help_text)
        self.assertIn("scripts/quest-runner issues edit", help_text)
        self.assertIn("scripts/quest-runner issues respond", help_text)
        self.assertIn("scripts/quest-runner issues responses", help_text)
        self.assertIn("human-operated", help_text)
        self.assertIn("issues ...", help_text)

    def test_help_command(self) -> None:
        out = io.StringIO()
        code = main(["help"], request_fn=FakeTransport(), stdout=out)
        self.assertEqual(code, 0)
        self.assertIn("scripts/quest-runner create", out.getvalue())

    def test_each_subcommand_accepts_help(self) -> None:
        commands = [
            ["create", "--help"],
            ["run", "--help"],
            ["advance", "--help"],
            ["land", "--help"],
            ["issues", "list", "--help"],
            ["issues", "read", "--help"],
            ["issues", "create", "--help"],
            ["issues", "edit", "--help"],
            ["issues", "respond", "--help"],
            ["issues", "responses", "--help"],
        ]
        for argv in commands:
            with self.subTest(argv=argv):
                parser = build_parser()
                with self.assertRaises(SystemExit) as ctx:
                    parser.parse_args(argv)
                self.assertEqual(ctx.exception.code, 0)


class CommandRequestTests(unittest.TestCase):
    def _run(self, argv: list[str], response: tuple[int, dict]) -> tuple[int, FakeTransport, str, str]:
        transport = FakeTransport([response])
        out = io.StringIO()
        err = io.StringIO()
        code = main(
            ["--base-url", "http://test.local"] + argv,
            request_fn=transport,
            stdout=out,
            stderr=err,
        )
        return code, transport, out.getvalue(), err.getvalue()

    def test_create_calls_endpoint(self) -> None:
        code, transport, out, _err = self._run(
            ["create", "--project", "quest-runner", "--type", "side", "--name", "CLI"],
            (
                201,
                {
                    "project": "quest-runner",
                    "quest_type": "side",
                    "quest_number": 0,
                    "quest_slug": "cli",
                    "quest_dir": "/tmp/q",
                    "worktree_branch": "quest/x",
                    "worktree_path": "/tmp/wt",
                },
            ),
        )
        self.assertEqual(code, 0)
        self.assertEqual(len(transport.requests), 1)
        req = transport.requests[0]
        self.assertEqual(req.method, "POST")
        self.assertTrue(req.url.endswith("/create_quest"))
        self.assertEqual(
            req.body,
            {"project": "quest-runner", "quest_type": "side", "name": "CLI"},
        )
        self.assertIn("quest_number: 0", out)
        self.assertIn("dashboard_url:", out)

    def test_run_calls_endpoint(self) -> None:
        code, transport, out, _err = self._run(
            [
                "run",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
                "--max-steps",
                "25",
            ],
            (
                202,
                {
                    "run_id": "rid",
                    "status": "running",
                    "quest_url": "http://test.local/dashboard?project=quest-runner",
                    "status_url": "http://test.local/api/dashboard/run_status",
                },
            ),
        )
        self.assertEqual(code, 0)
        req = transport.requests[0]
        self.assertEqual(req.method, "POST")
        self.assertTrue(req.url.endswith("/run_quest"))
        self.assertEqual(
            req.body,
            {
                "project": "quest-runner",
                "quest_type": "side",
                "quest_number": 0,
                "max_steps": 25,
            },
        )
        self.assertIn("run_id: rid", out)

    def test_advance_calls_endpoint(self) -> None:
        code, transport, out, _err = self._run(
            ["advance", "--project", "quest-runner", "--type", "side", "--number", "0"],
            (
                200,
                {
                    "status": "advanced",
                    "previous_state": "Implementing",
                    "next_state": "PolishingReview",
                    "commit": "abc123",
                },
            ),
        )
        self.assertEqual(code, 0)
        req = transport.requests[0]
        self.assertEqual(req.method, "POST")
        self.assertTrue(req.url.endswith("/advance_quest"))
        self.assertIn("previous_state: Implementing", out)
        self.assertIn("commit: abc123", out)

    def test_land_calls_endpoint(self) -> None:
        code, transport, out, _err = self._run(
            [
                "land",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
                "--target-branch",
                "main",
            ],
            (
                200,
                {
                    "status": "landed",
                    "target_branch": "main",
                    "worktree_branch": "quest/x",
                    "rebased": True,
                    "fast_forwarded": True,
                    "worktree_deleted": True,
                    "target_head": "deadbeef",
                },
            ),
        )
        self.assertEqual(code, 0)
        req = transport.requests[0]
        self.assertEqual(req.method, "POST")
        self.assertTrue(req.url.endswith("/land"))
        self.assertEqual(req.body["target_branch"], "main")
        self.assertIn("target_head: deadbeef", out)

    def test_issues_list_calls_endpoint(self) -> None:
        code, transport, out, _err = self._run(
            [
                "issues",
                "list",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "physicalplan",
                "--status",
                "open",
            ],
            (200, {"issues": [{"issue_id": "QP-0001", "status": "open", "title": "T"}]}),
        )
        self.assertEqual(code, 0)
        req = transport.requests[0]
        self.assertEqual(req.method, "GET")
        self.assertIn("/api/issues?", req.url)
        self.assertIn("scope=physicalplan", req.url)
        self.assertIn("status=open", req.url)
        self.assertIn("QP-0001", out)

    def test_issues_read_calls_endpoint(self) -> None:
        code, transport, _out, _err = self._run(
            [
                "issues",
                "read",
                "QP-0001",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "physicalplan",
            ],
            (200, {"issue_id": "QP-0001", "title": "T", "status": "open", "body": "D"}),
        )
        self.assertEqual(code, 0)
        req = transport.requests[0]
        self.assertEqual(req.method, "GET")
        self.assertIn("/api/issues/QP-0001?", req.url)

    def test_issues_create_calls_endpoint(self) -> None:
        code, transport, _out, _err = self._run(
            [
                "issues",
                "create",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "physicalplan",
                "--title",
                "Title",
                "--body",
                "Body",
            ],
            (201, {"issue_id": "QP-0001", "title": "Title", "status": "open"}),
        )
        self.assertEqual(code, 0)
        req = transport.requests[0]
        self.assertEqual(req.method, "POST")
        self.assertTrue(req.url.endswith("/api/issues"))
        self.assertEqual(req.body["title"], "Title")
        self.assertEqual(req.body["body"], "Body")

    def test_issues_edit_calls_endpoint(self) -> None:
        code, transport, _out, _err = self._run(
            [
                "issues",
                "edit",
                "QP-0001",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "physicalplan",
                "--status",
                "completed",
            ],
            (200, {"issue_id": "QP-0001", "status": "completed"}),
        )
        self.assertEqual(code, 0)
        req = transport.requests[0]
        self.assertEqual(req.method, "PATCH")
        self.assertTrue("/api/issues/QP-0001" in req.url)
        self.assertEqual(req.body["status"], "completed")

    def test_issues_respond_calls_endpoint(self) -> None:
        code, transport, _out, _err = self._run(
            [
                "issues",
                "respond",
                "QP-0001",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "physicalplan",
                "--outcome",
                "Fixed",
                "--explanation",
                "Done",
            ],
            (
                201,
                {
                    "response": {
                        "issue_id": "QP-0001",
                        "outcome": "Fixed",
                        "explanation": "Done",
                    }
                },
            ),
        )
        self.assertEqual(code, 0)
        req = transport.requests[0]
        self.assertEqual(req.method, "POST")
        self.assertTrue(req.url.endswith("/api/issues/QP-0001/responses"))
        self.assertEqual(req.body["outcome"], "Fixed")

    def test_issues_responses_calls_endpoint(self) -> None:
        code, transport, out, _err = self._run(
            [
                "issues",
                "responses",
                "QP-0001",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "physicalplan",
            ],
            (
                200,
                {
                    "responses": [
                        {
                            "response_timestamp": "2026-01-01T00:00:00Z",
                            "outcome": "Fixed",
                            "explanation": "Done",
                        }
                    ]
                },
            ),
        )
        self.assertEqual(code, 0)
        req = transport.requests[0]
        self.assertEqual(req.method, "GET")
        self.assertIn("/api/issues/QP-0001/responses?", req.url)
        self.assertIn("Fixed", out)

    def test_polishing_includes_slice(self) -> None:
        _code, transport, _out, _err = self._run(
            [
                "issues",
                "list",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "polishing",
                "--slice",
                "1",
            ],
            (200, {"issues": []}),
        )
        self.assertIn("slice=1", transport.requests[0].url)


class JsonOutputTests(unittest.TestCase):
    def test_json_prints_formatted_response(self) -> None:
        transport = FakeTransport([(200, {"status": "advanced", "commit": "abc"})])
        out = io.StringIO()
        code = main(
            [
                "--json",
                "--base-url",
                "http://test.local",
                "advance",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
            ],
            request_fn=transport,
            stdout=out,
        )
        self.assertEqual(code, 0)
        parsed = json.loads(out.getvalue())
        self.assertEqual(parsed["commit"], "abc")

    def test_json_suppresses_fallback_warning(self) -> None:
        transport = FakeTransport([(200, {"issues": []})])
        out = io.StringIO()
        err = io.StringIO()
        with patch(
            "quest_runner_service.cli.resolve_base_url",
            return_value=("http://localhost:9002", "fallback warning"),
        ):
            main(
                [
                    "--json",
                    "issues",
                    "list",
                    "--project",
                    "p",
                    "--type",
                    "side",
                    "--number",
                    "0",
                    "--scope",
                    "physicalplan",
                ],
                request_fn=transport,
                stdout=out,
                stderr=err,
            )
        self.assertEqual(err.getvalue(), "")


class HttpErrorTests(unittest.TestCase):
    def test_http_failure_exits_nonzero(self) -> None:
        transport = FakeTransport([(409, {"error": "quest is running"})])
        out = io.StringIO()
        err = io.StringIO()
        code = main(
            [
                "--base-url",
                "http://test.local",
                "advance",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
            ],
            request_fn=transport,
            stdout=out,
            stderr=err,
        )
        self.assertEqual(code, 1)
        self.assertIn("HTTP 409", err.getvalue())
        self.assertIn("/advance_quest", err.getvalue())
        self.assertIn("quest is running", err.getvalue())

    def test_transport_error_exits_nonzero(self) -> None:
        def broken(_method: str, _url: str, _body: dict | None) -> tuple[int, dict]:
            from quest_runner_service.cli import TransportError

            raise TransportError("connection refused")

        err = io.StringIO()
        code = main(
            [
                "--base-url",
                "http://test.local",
                "advance",
                "--project",
                "quest-runner",
                "--type",
                "side",
                "--number",
                "0",
            ],
            request_fn=broken,
            stderr=err,
        )
        self.assertEqual(code, 1)
        self.assertIn("connection refused", err.getvalue())


class ValidationTests(unittest.TestCase):
    def _expect_validation_error(self, argv: list[str]) -> str:
        transport = FakeTransport()
        err = io.StringIO()
        code = main(
            ["--base-url", "http://test.local"] + argv,
            request_fn=transport,
            stderr=err,
        )
        self.assertEqual(code, 2)
        self.assertEqual(transport.requests, [])
        return err.getvalue()

    def test_polishing_requires_slice(self) -> None:
        msg = self._expect_validation_error(
            [
                "issues",
                "list",
                "--project",
                "p",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "polishing",
            ]
        )
        self.assertIn("--slice is required", msg)

    def test_physicalplan_rejects_slice(self) -> None:
        msg = self._expect_validation_error(
            [
                "issues",
                "list",
                "--project",
                "p",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "physicalplan",
                "--slice",
                "1",
            ]
        )
        self.assertIn("must not be used", msg)

    def test_conflicting_body_sources(self) -> None:
        msg = self._expect_validation_error(
            [
                "issues",
                "create",
                "--project",
                "p",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "physicalplan",
                "--title",
                "T",
                "--body",
                "A",
                "--body-file",
                "/tmp/x",
            ]
        )
        self.assertIn("mutually exclusive", msg)

    def test_conflicting_explanation_sources(self) -> None:
        msg = self._expect_validation_error(
            [
                "issues",
                "respond",
                "QP-0001",
                "--project",
                "p",
                "--type",
                "side",
                "--number",
                "0",
                "--scope",
                "physicalplan",
                "--outcome",
                "Fixed",
                "--explanation",
                "A",
                "--explanation-file",
                "/tmp/x",
            ]
        )
        self.assertIn("mutually exclusive", msg)

    def test_invalid_outcome(self) -> None:
        parser = build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(
                [
                    "issues",
                    "respond",
                    "QP-0001",
                    "--project",
                    "p",
                    "--type",
                    "side",
                    "--number",
                    "0",
                    "--scope",
                    "physicalplan",
                    "--outcome",
                    "Maybe",
                    "--explanation",
                    "x",
                ]
            )


class SymlinkTests(unittest.TestCase):
    def test_root_symlink_resolves_to_bin_script(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        link = repo_root / "scripts" / "quest-runner"
        self.assertTrue(link.is_symlink())
        target = link.resolve()
        expected = (repo_root / "projects" / "quest-runner" / "bin" / "quest-runner").resolve()
        self.assertEqual(target, expected)


if __name__ == "__main__":
    unittest.main()
