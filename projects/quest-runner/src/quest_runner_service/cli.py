"""Quest Runner command-line interface wrapping the REST service."""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TextIO
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

_DEFAULT_BASE_URL = "http://localhost:9002"
_SERVICE_NAME = "quest-runner"
_VALID_QUEST_TYPES = frozenset({"main", "side"})
_VALID_SCOPES = frozenset({"physicalplan", "polishing"})
_VALID_STATUSES = frozenset({"open", "completed", "all"})
_VALID_ISSUE_STATUSES = frozenset({"open", "completed"})
_VALID_OUTCOMES = frozenset({"Fixed", "NotFixed"})


class CliValidationError(Exception):
    pass


class TransportError(Exception):
    def __init__(
        self,
        message: str,
        *,
        base_url: str | None = None,
        endpoint: str | None = None,
    ) -> None:
        super().__init__(message)
        self.base_url = base_url
        self.endpoint = endpoint


@dataclass(frozen=True)
class RecordedRequest:
    method: str
    url: str
    body: dict[str, Any] | None


RequestFn = Callable[[str, str, dict[str, Any] | None], tuple[int, dict[str, Any]]]


def _script_start_path(argv: list[str] | None) -> Path:
    if argv is None:
        return Path(sys.argv[0]).resolve()
    if not argv:
        return Path.cwd()
    return Path(argv[0]).resolve()


def _find_repo_root(start: Path) -> Path | None:
    current = start.resolve()
    if current.is_file():
        current = current.parent
    for directory in (current, *current.parents):
        if (directory / "config" / "services.json").is_file():
            return directory
    return None


def _normalize_host(host: str) -> str:
    if host.strip() == "0.0.0.0":
        return "localhost"
    return host.strip()


def _service_url_from_config(repo_root: Path) -> str | None:
    config_path = repo_root / "config" / "services.json"
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, list):
        return None
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        if entry.get("name") != _SERVICE_NAME:
            continue
        host = entry.get("host")
        port = entry.get("port")
        if not host or port is None:
            return None
        return f"http://{_normalize_host(str(host))}:{port}"
    return None


def resolve_base_url(
    *,
    cli_base_url: str | None = None,
    env: dict[str, str] | None = None,
    start_path: Path | None = None,
) -> tuple[str, str | None]:
    """Return (base_url, warning_message). warning is None when no fallback was used."""
    if cli_base_url:
        return cli_base_url.rstrip("/"), None

    environment = os.environ if env is None else env
    env_url = environment.get("QUEST_RUNNER_URL", "").strip()
    if env_url:
        return env_url.rstrip("/"), None

    anchor = start_path if start_path is not None else Path.cwd()
    repo_root = _find_repo_root(anchor)
    if repo_root is not None:
        from_config = _service_url_from_config(repo_root)
        if from_config:
            return from_config.rstrip("/"), None

    return _DEFAULT_BASE_URL, (
        f"Could not resolve quest-runner service URL from config/services.json; "
        f"using fallback {_DEFAULT_BASE_URL}"
    )


def default_request(method: str, url: str, body: dict[str, Any] | None) -> tuple[int, dict[str, Any]]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
    request = Request(url, data=payload, method=method, headers=headers)
    try:
        with urlopen(request) as response:
            text = response.read().decode("utf-8")
            status = response.status
    except HTTPError as exc:
        text = exc.read().decode("utf-8")
        status = exc.code
    except URLError as exc:
        raise TransportError(str(exc.reason)) from exc

    if not text.strip():
        return status, {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = {"error": text}
    if not isinstance(parsed, dict):
        return status, {"data": parsed}
    return status, parsed


def _endpoint_path(path: str) -> str:
    return path if path.startswith("/") else f"/{path}"


def _join_url(base_url: str, path: str, query: dict[str, Any] | None = None) -> str:
    url = urljoin(f"{base_url.rstrip('/')}/", _endpoint_path(path).lstrip("/"))
    if query:
        filtered = {key: value for key, value in query.items() if value is not None}
        if filtered:
            url = f"{url}?{urlencode(filtered, doseq=True)}"
    return url


def _send_request(
    request_fn: RequestFn,
    method: str,
    *,
    base_url: str,
    endpoint: str,
    body: dict[str, Any] | None,
    query: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any]]:
    try:
        return request_fn(method, _join_url(base_url, endpoint, query), body)
    except TransportError as exc:
        if exc.base_url is not None and exc.endpoint is not None:
            raise
        raise TransportError(str(exc), base_url=base_url, endpoint=endpoint) from exc


def _quest_dashboard_url(base_url: str, project: str, quest_type: str, quest_number: int) -> str:
    query = urlencode(
        {
            "project": project,
            "quest_type": quest_type,
            "quest_number": str(quest_number),
        }
    )
    return f"{base_url.rstrip('/')}/dashboard?{query}"


def _read_text_source(body: str | None, body_file: str | None, label: str) -> str:
    if body is not None and body_file is not None:
        raise CliValidationError(f"--{label} and --{label}-file are mutually exclusive")
    if body_file is not None:
        try:
            return Path(body_file).read_text(encoding="utf-8")
        except OSError as exc:
            raise CliValidationError(f"Could not read --{label}-file: {exc}") from exc
    if body is None:
        raise CliValidationError(f"--{label} or --{label}-file is required")
    return body


def _validate_quest_type(quest_type: str) -> None:
    if quest_type not in _VALID_QUEST_TYPES:
        raise CliValidationError("--type must be 'main' or 'side'")


def _validate_scope(scope: str) -> None:
    if scope not in _VALID_SCOPES:
        raise CliValidationError("--scope must be 'physicalplan' or 'polishing'")


def _validate_list_status(status: str) -> None:
    if status not in _VALID_STATUSES:
        raise CliValidationError("--status must be 'open', 'completed', or 'all'")


def _validate_issue_status(status: str) -> None:
    if status not in _VALID_ISSUE_STATUSES:
        raise CliValidationError("--status must be 'open' or 'completed'")


def _validate_outcome(outcome: str) -> None:
    if outcome not in _VALID_OUTCOMES:
        raise CliValidationError("--outcome must be 'Fixed' or 'NotFixed'")


def _validate_slice_for_scope(scope: str, slice_number: int | None) -> None:
    if scope == "physicalplan" and slice_number is not None:
        raise CliValidationError("--slice must not be used with --scope physicalplan")
    if scope == "polishing" and slice_number is None:
        raise CliValidationError("--slice is required for --scope polishing")


def _issue_query(
    project: str,
    quest_type: str,
    quest_number: int,
    scope: str,
    slice_number: int | None,
    experiment_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {
        "project": project,
        "quest_type": quest_type,
        "quest_number": quest_number,
        "scope": scope,
    }
    if slice_number is not None:
        query["slice"] = slice_number
    if experiment_id is not None:
        query["experiment_id"] = experiment_id
    if extra:
        query.update(extra)
    return query


def _issue_body(
    project: str,
    quest_type: str,
    quest_number: int,
    scope: str,
    slice_number: int | None,
    experiment_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "project": project,
        "quest_type": quest_type,
        "quest_number": quest_number,
        "scope": scope,
        "slice": slice_number,
    }
    if experiment_id is not None:
        body["experiment_id"] = experiment_id
    if extra:
        body.update(extra)
    return body


def _print_json(data: dict[str, Any], out: TextIO) -> None:
    out.write(json.dumps(data, indent=2, sort_keys=True))
    out.write("\n")


def _print_field(label: str, value: Any, out: TextIO) -> None:
    if value is None:
        return
    out.write(f"{label}: {value}\n")


def _print_table(headers: list[str], rows: list[list[str]], out: TextIO) -> None:
    if not rows:
        out.write("(none)\n")
        return
    widths = [len(header) for header in headers]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))
    header_line = "  ".join(
        header.ljust(widths[index]) for index, header in enumerate(headers)
    )
    out.write(header_line + "\n")
    out.write("  ".join("-" * width for width in widths) + "\n")
    for row in rows:
        out.write(
            "  ".join(cell.ljust(widths[index]) for index, cell in enumerate(row))
            + "\n"
        )


def _format_create_experiment(data: dict[str, Any], out: TextIO) -> None:
    _print_field("experiment_id", data.get("experiment_id"), out)
    _print_field("experiment_number", data.get("experiment_number"), out)
    _print_field("branch_name", data.get("branch_name"), out)
    _print_field("worktree_path", data.get("worktree_path"), out)
    _print_field("base_commit", data.get("base_commit"), out)
    _print_field("dashboard_url", data.get("dashboard_url"), out)


def _format_create(data: dict[str, Any], base_url: str, out: TextIO) -> None:
    _print_field("project", data.get("project"), out)
    _print_field("quest_type", data.get("quest_type"), out)
    _print_field("quest_number", data.get("quest_number"), out)
    _print_field("quest_slug", data.get("quest_slug"), out)
    _print_field("quest_dir", data.get("quest_dir"), out)
    _print_field("worktree_branch", data.get("worktree_branch"), out)
    _print_field("worktree_path", data.get("worktree_path"), out)
    dashboard_url = data.get("dashboard_url")
    if dashboard_url is None and all(
        key in data for key in ("project", "quest_type", "quest_number")
    ):
        dashboard_url = _quest_dashboard_url(
            base_url,
            str(data["project"]),
            str(data["quest_type"]),
            int(data["quest_number"]),
        )
    _print_field("dashboard_url", dashboard_url, out)


def _format_run(data: dict[str, Any], out: TextIO) -> None:
    _print_field("run_id", data.get("run_id"), out)
    _print_field("status", data.get("status"), out)
    _print_field("quest_url", data.get("quest_url"), out)
    _print_field("status_url", data.get("status_url"), out)


def _format_advance(data: dict[str, Any], out: TextIO) -> None:
    _print_field("status", data.get("status"), out)
    if data.get("status") == "completed":
        _print_field("advanced", data.get("advanced"), out)
        return
    _print_field("previous_state", data.get("previous_state"), out)
    _print_field("next_state", data.get("next_state"), out)
    _print_field("active_slice", data.get("active_slice"), out)
    _print_field("previous_slice_state", data.get("previous_slice_state"), out)
    _print_field("next_slice_state", data.get("next_slice_state"), out)
    _print_field("commit", data.get("commit"), out)
    _print_field("message", data.get("message"), out)


def _format_land(data: dict[str, Any], out: TextIO) -> None:
    _print_field("status", data.get("status"), out)
    _print_field("target_branch", data.get("target_branch"), out)
    _print_field("worktree_branch", data.get("worktree_branch"), out)
    _print_field("rebased", data.get("rebased"), out)
    _print_field("fast_forwarded", data.get("fast_forwarded"), out)
    _print_field("worktree_deleted", data.get("worktree_deleted"), out)
    _print_field("branch_deleted", data.get("branch_deleted"), out)
    _print_field("target_head", data.get("target_head"), out)
    if data.get("status") == "rebase_failed":
        _print_field("worktree_path", data.get("worktree_path"), out)
        _print_field("next_step", data.get("next_step"), out)
    if data.get("error"):
        _print_field("error", data.get("error"), out)


def _format_slices_init(data: dict[str, Any], out: TextIO) -> None:
    _print_field("project", data.get("project"), out)
    _print_field("quest_type", data.get("quest_type"), out)
    _print_field("quest_number", data.get("quest_number"), out)
    _print_field("quest_dir", data.get("quest_dir"), out)
    slices = data.get("created_slices", [])
    if not isinstance(slices, list):
        return
    rows = [
        [
            str(item.get("slice_number", "")),
            str(item.get("directory_name", "")),
            str(item.get("slice_dir", "")),
        ]
        for item in slices
        if isinstance(item, dict)
    ]
    out.write("created_slices:\n")
    _print_table(["NUMBER", "DIRECTORY", "PATH"], rows, out)


def _format_issue(data: dict[str, Any], out: TextIO) -> None:
    _print_field("issue_id", data.get("issue_id"), out)
    _print_field("status", data.get("status"), out)
    _print_field("title", data.get("title"), out)
    _print_field("owner_role", data.get("owner_role"), out)
    _print_field("created_at", data.get("created_at"), out)
    _print_field("updated_at", data.get("updated_at"), out)
    body = data.get("body", data.get("details"))
    if body:
        out.write("body:\n")
        out.write(textwrap.indent(str(body).rstrip() + "\n", "  "))


def _format_issue_list(data: dict[str, Any], out: TextIO) -> None:
    issues = data.get("issues", [])
    if not isinstance(issues, list):
        issues = []
    rows = [
        [
            str(item.get("issue_id", "")),
            str(item.get("status", "")),
            str(item.get("title", "")),
        ]
        for item in issues
    ]
    _print_table(["ID", "STATUS", "TITLE"], rows, out)


def _format_responses_list(data: dict[str, Any], out: TextIO) -> None:
    responses = data.get("responses", [])
    if not isinstance(responses, list):
        responses = []
    rows = [
        [
            str(item.get("response_timestamp", "")),
            str(item.get("outcome", "")),
            str(item.get("explanation", "")),
        ]
        for item in responses
    ]
    _print_table(["TIMESTAMP", "OUTCOME", "EXPLANATION"], rows, out)


def _format_respond(data: dict[str, Any], out: TextIO) -> None:
    response = data.get("response")
    if isinstance(response, dict):
        _print_field("issue_id", response.get("issue_id"), out)
        _print_field("outcome", response.get("outcome"), out)
        _print_field("response_timestamp", response.get("response_timestamp"), out)
        explanation = response.get("explanation")
        if explanation:
            out.write("explanation:\n")
            out.write(textwrap.indent(str(explanation).rstrip() + "\n", "  "))
    issue = data.get("issue")
    if isinstance(issue, dict):
        out.write("\n")
        _format_issue(issue, out)


def _handle_http_result(
    *,
    status: int,
    endpoint: str,
    data: dict[str, Any],
    json_output: bool,
    out: TextIO,
    err: TextIO,
) -> int:
    if 200 <= status < 300:
        if json_output:
            _print_json(data, out)
        return 0

    message = data.get("error", data.get("message", "request failed"))
    err.write(f"HTTP {status} {endpoint}\n")
    err.write(f"error: {message}\n")
    if json_output:
        _print_json(data, err)
    return 1


def _add_quest_identity_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--project", required=True, help="Project name")
    parser.add_argument(
        "--type",
        required=True,
        choices=sorted(_VALID_QUEST_TYPES),
        help="Quest type (main or side)",
    )
    parser.add_argument(
        "--number",
        required=True,
        type=int,
        help="Quest number",
    )


def _add_experiment_id_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--experiment-id",
        default=None,
        help="Experiment id when operating in an experiment worktree",
    )


def _add_issue_scope_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--scope",
        required=True,
        choices=sorted(_VALID_SCOPES),
        help="Issue scope (physicalplan or polishing)",
    )
    parser.add_argument(
        "--slice",
        type=int,
        default=None,
        help="Slice number (required for polishing scope)",
    )


def build_parser() -> argparse.ArgumentParser:
    epilog = textwrap.dedent(
        """
        Service URL resolution (highest precedence first):
          1. --base-url <url>
          2. QUEST_RUNNER_URL environment variable
          3. config/services.json entry named "quest-runner"
          4. fallback http://localhost:9002

        Quest identity fields are required on most commands:
          --project <project>  --type main|side  --number <n>

        Examples:
          scripts/quest-runner create --project quest-runner --type side --name "CLI"
          scripts/quest-runner run --project quest-runner --type side --number 0 --max-steps 25
          scripts/quest-runner run --project quest-runner --type main --number 0 --experiment-id experiment_quest-runner_main_0_0
          scripts/quest-runner advance --project quest-runner --type side --number 0
          scripts/quest-runner land --project quest-runner --type side --number 0
          scripts/quest-runner slices init --project quest-runner --type side --number 0 --count 2 --slug api --slug cli
          scripts/quest-runner issues list --project quest-runner --type side --number 0 --scope physicalplan
          scripts/quest-runner issues list --project quest-runner --type main --number 0 --scope physicalplan --experiment-id experiment_quest-runner_main_0_0
          scripts/quest-runner issues read QP-0001 --project quest-runner --type side --number 0 --scope physicalplan
          scripts/quest-runner issues create --project quest-runner --type side --number 0 --scope physicalplan --title "Title" --body "Details"
          scripts/quest-runner issues edit QP-0001 --project quest-runner --type side --number 0 --scope physicalplan --status completed
          scripts/quest-runner issues respond QP-0001 --project quest-runner --type side --number 0 --scope physicalplan --outcome Fixed --explanation "Done"
          scripts/quest-runner issues responses QP-0001 --project quest-runner --type side --number 0 --scope physicalplan
          scripts/quest-runner issues list --project quest-runner --type side --number 0 --scope polishing --slice 1
          scripts/quest-runner --json advance --project quest-runner --type side --number 0
          scripts/quest-runner experiments create --project quest-runner --type main --number 0 --start-step 5 --stop-node slice_completed --notes-file /tmp/notes.md --config-file /tmp/config.yaml

        Notes:
          - advance and land are human-operated recovery and integration workflows.
          - Agents should use `scripts/quest-runner issues ...` instead of editing issue markdown files directly.
        """
    ).strip()

    parser = argparse.ArgumentParser(
        prog="quest-runner",
        description="Quest Runner CLI for lifecycle, manual advancement, landing, and issue APIs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=epilog,
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Override Quest Runner service base URL",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print raw JSON responses",
    )

    subparsers = parser.add_subparsers(dest="command")

    help_parser = subparsers.add_parser("help", help="Show this help message")
    help_parser.set_defaults(handler="help")

    create_parser = subparsers.add_parser("create", help="Create a new quest")
    create_parser.add_argument("--project", required=True)
    create_parser.add_argument("--type", required=True, choices=sorted(_VALID_QUEST_TYPES))
    create_parser.add_argument("--name", required=True)
    create_parser.add_argument("--slug", default=None)
    create_parser.set_defaults(handler="create")

    run_parser = subparsers.add_parser("run", help="Run a quest")
    _add_quest_identity_args(run_parser)
    _add_experiment_id_arg(run_parser)
    run_parser.add_argument("--max-steps", type=int, default=None)
    run_parser.set_defaults(handler="run")

    advance_parser = subparsers.add_parser(
        "advance",
        help="Manually advance a stopped quest after fix-ups",
    )
    _add_quest_identity_args(advance_parser)
    _add_experiment_id_arg(advance_parser)
    advance_parser.set_defaults(handler="advance")

    land_parser = subparsers.add_parser(
        "land",
        help="Land a quest worktree branch onto the target branch",
    )
    _add_quest_identity_args(land_parser)
    _add_experiment_id_arg(land_parser)
    land_parser.add_argument("--target-branch", default="main")
    land_parser.set_defaults(handler="land")

    slices_parser = subparsers.add_parser("slices", help="Slice commands")
    slices_sub = slices_parser.add_subparsers(dest="slices_command")

    slices_init = slices_sub.add_parser(
        "init",
        help="Initialize physically-plannable quest slice directories",
    )
    _add_quest_identity_args(slices_init)
    _add_experiment_id_arg(slices_init)
    slices_init.add_argument("--count", required=True, type=int)
    slices_init.add_argument(
        "--slug",
        action="append",
        default=[],
        help="Slice slug. Repeat exactly --count times.",
    )
    slices_init.set_defaults(handler="slices_init")

    issues_parser = subparsers.add_parser("issues", help="Issue commands")
    issues_sub = issues_parser.add_subparsers(dest="issues_command")

    issues_list = issues_sub.add_parser("list", help="List issues")
    _add_quest_identity_args(issues_list)
    _add_experiment_id_arg(issues_list)
    _add_issue_scope_args(issues_list)
    issues_list.add_argument(
        "--status",
        default="all",
        choices=sorted(_VALID_STATUSES),
    )
    issues_list.set_defaults(handler="issues_list")

    issues_read = issues_sub.add_parser("read", help="Read one issue")
    issues_read.add_argument("issue_id")
    _add_quest_identity_args(issues_read)
    _add_experiment_id_arg(issues_read)
    _add_issue_scope_args(issues_read)
    issues_read.set_defaults(handler="issues_read")

    issues_create = issues_sub.add_parser("create", help="Create an issue")
    _add_quest_identity_args(issues_create)
    _add_experiment_id_arg(issues_create)
    _add_issue_scope_args(issues_create)
    issues_create.add_argument("--title", required=True)
    issues_create.add_argument("--body", default=None)
    issues_create.add_argument("--body-file", default=None)
    issues_create.add_argument(
        "--status",
        default="open",
        choices=sorted(_VALID_ISSUE_STATUSES),
    )
    issues_create.set_defaults(handler="issues_create")

    issues_edit = issues_sub.add_parser("edit", help="Edit an issue")
    issues_edit.add_argument("issue_id")
    _add_quest_identity_args(issues_edit)
    _add_experiment_id_arg(issues_edit)
    _add_issue_scope_args(issues_edit)
    issues_edit.add_argument("--status", default=None, choices=sorted(_VALID_ISSUE_STATUSES))
    issues_edit.add_argument("--title", default=None)
    issues_edit.add_argument("--body", default=None)
    issues_edit.add_argument("--body-file", default=None)
    issues_edit.set_defaults(handler="issues_edit")

    issues_respond = issues_sub.add_parser("respond", help="Respond to an issue")
    issues_respond.add_argument("issue_id")
    _add_quest_identity_args(issues_respond)
    _add_experiment_id_arg(issues_respond)
    _add_issue_scope_args(issues_respond)
    issues_respond.add_argument("--outcome", required=True, choices=sorted(_VALID_OUTCOMES))
    issues_respond.add_argument("--explanation", default=None)
    issues_respond.add_argument("--explanation-file", default=None)
    issues_respond.set_defaults(handler="issues_respond")

    issues_responses = issues_sub.add_parser("responses", help="List issue responses")
    issues_responses.add_argument("issue_id")
    _add_quest_identity_args(issues_responses)
    _add_experiment_id_arg(issues_responses)
    _add_issue_scope_args(issues_responses)
    issues_responses.set_defaults(handler="issues_responses")

    experiments_parser = subparsers.add_parser(
        "experiments",
        help="Experiment commands",
    )
    experiments_sub = experiments_parser.add_subparsers(dest="experiments_command")

    experiments_create = experiments_sub.add_parser(
        "create",
        help="Create a quest experiment from an earlier step",
    )
    _add_quest_identity_args(experiments_create)
    experiments_create.add_argument("--start-step", required=True, type=int)
    experiments_create.add_argument("--stop-node", required=True)
    experiments_create.add_argument("--stop-machine-path", default=None)
    experiments_create.add_argument("--notes-file", required=True)
    experiments_create.add_argument("--config-file", required=True)
    experiments_create.set_defaults(handler="experiments_create")

    return parser


def _dispatch_command(
    args: argparse.Namespace,
    *,
    base_url: str,
    request_fn: RequestFn,
    json_output: bool,
    out: TextIO,
    err: TextIO,
) -> int:
    handler = getattr(args, "handler", None)

    if handler == "help":
        build_parser().print_help(out)
        return 0

    if handler == "experiments_create":
        notes = Path(args.notes_file).read_text(encoding="utf-8")
        config = Path(args.config_file).read_text(encoding="utf-8")
        body = {
            "project": args.project,
            "quest_type": args.type,
            "quest_number": args.number,
            "start_step": args.start_step,
            "stop_node": args.stop_node,
            "notes": notes,
            "config": config,
        }
        if args.stop_machine_path is not None:
            body["stop_machine_path"] = args.stop_machine_path
        endpoint = "/experiments/create"
        status, data = _send_request(
            request_fn, "POST", base_url=base_url, endpoint=endpoint, body=body
        )
        if 200 <= status < 300:
            if json_output:
                _print_json(data, out)
            else:
                _format_create_experiment(data, out)
            return 0
        return _handle_http_result(
            status=status,
            endpoint=endpoint,
            data=data,
            json_output=json_output,
            out=out,
            err=err,
        )

    if handler == "create":
        body: dict[str, Any] = {
            "project": args.project,
            "quest_type": args.type,
            "name": args.name,
        }
        if args.slug is not None:
            body["slug"] = args.slug
        endpoint = "/create_quest"
        status, data = _send_request(
            request_fn, "POST", base_url=base_url, endpoint=endpoint, body=body
        )
        if 200 <= status < 300:
            if json_output:
                _print_json(data, out)
            else:
                _format_create(data, base_url, out)
            return 0
        return _handle_http_result(
            status=status,
            endpoint=endpoint,
            data=data,
            json_output=json_output,
            out=out,
            err=err,
        )

    if handler == "run":
        body = {
            "project": args.project,
            "quest_type": args.type,
            "quest_number": args.number,
        }
        if args.experiment_id is not None:
            body["experiment_id"] = args.experiment_id
        if args.max_steps is not None:
            body["max_steps"] = args.max_steps
        endpoint = "/run_quest"
        status, data = _send_request(
            request_fn, "POST", base_url=base_url, endpoint=endpoint, body=body
        )
        if 200 <= status < 300:
            if json_output:
                _print_json(data, out)
            else:
                _format_run(data, out)
            return 0
        return _handle_http_result(
            status=status,
            endpoint=endpoint,
            data=data,
            json_output=json_output,
            out=out,
            err=err,
        )

    if handler == "advance":
        body = {
            "project": args.project,
            "quest_type": args.type,
            "quest_number": args.number,
        }
        if args.experiment_id is not None:
            body["experiment_id"] = args.experiment_id
        endpoint = "/advance_quest"
        status, data = _send_request(
            request_fn, "POST", base_url=base_url, endpoint=endpoint, body=body
        )
        if 200 <= status < 300:
            if json_output:
                _print_json(data, out)
            else:
                _format_advance(data, out)
            return 0
        return _handle_http_result(
            status=status,
            endpoint=endpoint,
            data=data,
            json_output=json_output,
            out=out,
            err=err,
        )

    if handler == "land":
        if args.experiment_id is not None:
            raise CliValidationError(
                "Experiment landing is implemented by `experiments land` in slice 5; "
                "do not use `land --experiment-id`."
            )
        body = {
            "project": args.project,
            "quest_type": args.type,
            "quest_number": args.number,
            "target_branch": args.target_branch,
        }
        endpoint = "/land"
        status, data = _send_request(
            request_fn, "POST", base_url=base_url, endpoint=endpoint, body=body
        )
        if 200 <= status < 300:
            if json_output:
                _print_json(data, out)
            else:
                _format_land(data, out)
            return 0
        if not json_output:
            _format_land(data, err)
        return _handle_http_result(
            status=status,
            endpoint=endpoint,
            data=data,
            json_output=json_output,
            out=out,
            err=err,
        )

    if handler == "slices_init":
        if args.count < 1:
            raise CliValidationError("--count must be a positive integer")
        if len(args.slug) != args.count:
            raise CliValidationError("--slug must be provided exactly --count times")
        body = {
            "project": args.project,
            "quest_type": args.type,
            "quest_number": args.number,
            "count": args.count,
            "slugs": args.slug,
        }
        if args.experiment_id is not None:
            body["experiment_id"] = args.experiment_id
        endpoint = "/api/slices/init"
        status, data = _send_request(
            request_fn, "POST", base_url=base_url, endpoint=endpoint, body=body
        )
        if 200 <= status < 300:
            if json_output:
                _print_json(data, out)
            else:
                _format_slices_init(data, out)
            return 0
        return _handle_http_result(
            status=status,
            endpoint=endpoint,
            data=data,
            json_output=json_output,
            out=out,
            err=err,
        )

    if handler and handler.startswith("issues_"):
        _validate_scope(args.scope)
        _validate_slice_for_scope(args.scope, args.slice)

        project = args.project
        quest_type = args.type
        quest_number = args.number
        scope = args.scope
        slice_number = args.slice
        experiment_id = args.experiment_id

        if handler == "issues_list":
            _validate_list_status(args.status)
            endpoint = "/api/issues"
            query = _issue_query(
                project,
                quest_type,
                quest_number,
                scope,
                slice_number,
                experiment_id,
                {"status": args.status},
            )
            status, data = _send_request(
                request_fn,
                "GET",
                base_url=base_url,
                endpoint=endpoint,
                query=query,
                body=None,
            )
            if 200 <= status < 300:
                if json_output:
                    _print_json(data, out)
                else:
                    _format_issue_list(data, out)
                return 0
            return _handle_http_result(
                status=status,
                endpoint=endpoint,
                data=data,
                json_output=json_output,
                out=out,
                err=err,
            )

        if handler == "issues_read":
            endpoint = f"/api/issues/{args.issue_id}"
            query = _issue_query(
                project,
                quest_type,
                quest_number,
                scope,
                slice_number,
                experiment_id,
            )
            status, data = _send_request(
                request_fn,
                "GET",
                base_url=base_url,
                endpoint=endpoint,
                query=query,
                body=None,
            )
            if 200 <= status < 300:
                if json_output:
                    _print_json(data, out)
                else:
                    _format_issue(data, out)
                    responses = data.get("responses")
                    if isinstance(responses, list) and responses:
                        out.write("\nresponses:\n")
                        _format_responses_list({"responses": responses}, out)
                return 0
            return _handle_http_result(
                status=status,
                endpoint=endpoint,
                data=data,
                json_output=json_output,
                out=out,
                err=err,
            )

        if handler == "issues_create":
            body_text = _read_text_source(args.body, args.body_file, "body")
            _validate_issue_status(args.status)
            endpoint = "/api/issues"
            body = _issue_body(
                project,
                quest_type,
                quest_number,
                scope,
                slice_number,
                experiment_id,
                {"title": args.title, "body": body_text, "status": args.status},
            )
            status, data = _send_request(
                request_fn, "POST", base_url=base_url, endpoint=endpoint, body=body
            )
            if 200 <= status < 300:
                if json_output:
                    _print_json(data, out)
                else:
                    _format_issue(data, out)
                return 0
            return _handle_http_result(
                status=status,
                endpoint=endpoint,
                data=data,
                json_output=json_output,
                out=out,
                err=err,
            )

        if handler == "issues_edit":
            if args.body is not None and args.body_file is not None:
                raise CliValidationError("--body and --body-file are mutually exclusive")
            if args.status is None and args.title is None and args.body is None and args.body_file is None:
                raise CliValidationError(
                    "At least one of --status, --title, --body, or --body-file is required"
                )
            if args.status is not None:
                _validate_issue_status(args.status)
            endpoint = f"/api/issues/{args.issue_id}"
            extra: dict[str, Any] = {}
            if args.status is not None:
                extra["status"] = args.status
            if args.title is not None:
                extra["title"] = args.title
            if args.body is not None or args.body_file is not None:
                extra["body"] = _read_text_source(args.body, args.body_file, "body")
            body = _issue_body(
                project,
                quest_type,
                quest_number,
                scope,
                slice_number,
                experiment_id,
                extra,
            )
            status, data = _send_request(
                request_fn, "PATCH", base_url=base_url, endpoint=endpoint, body=body
            )
            if 200 <= status < 300:
                if json_output:
                    _print_json(data, out)
                else:
                    _format_issue(data, out)
                return 0
            return _handle_http_result(
                status=status,
                endpoint=endpoint,
                data=data,
                json_output=json_output,
                out=out,
                err=err,
            )

        if handler == "issues_respond":
            _validate_outcome(args.outcome)
            explanation = _read_text_source(args.explanation, args.explanation_file, "explanation")
            endpoint = f"/api/issues/{args.issue_id}/responses"
            body = _issue_body(
                project,
                quest_type,
                quest_number,
                scope,
                slice_number,
                experiment_id,
                {"outcome": args.outcome, "explanation": explanation},
            )
            status, data = _send_request(
                request_fn, "POST", base_url=base_url, endpoint=endpoint, body=body
            )
            if 200 <= status < 300:
                if json_output:
                    _print_json(data, out)
                else:
                    _format_respond(data, out)
                return 0
            return _handle_http_result(
                status=status,
                endpoint=endpoint,
                data=data,
                json_output=json_output,
                out=out,
                err=err,
            )

        if handler == "issues_responses":
            endpoint = f"/api/issues/{args.issue_id}/responses"
            query = _issue_query(
                project,
                quest_type,
                quest_number,
                scope,
                slice_number,
                experiment_id,
            )
            status, data = _send_request(
                request_fn,
                "GET",
                base_url=base_url,
                endpoint=endpoint,
                query=query,
                body=None,
            )
            if 200 <= status < 300:
                if json_output:
                    _print_json(data, out)
                else:
                    _format_responses_list(data, out)
                return 0
            return _handle_http_result(
                status=status,
                endpoint=endpoint,
                data=data,
                json_output=json_output,
                out=out,
                err=err,
            )

    build_parser().print_help(err)
    return 2


def main(
    argv: list[str] | None = None,
    *,
    request_fn: RequestFn | None = None,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
    env: dict[str, str] | None = None,
    start_path: Path | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    out = sys.stdout if stdout is None else stdout
    err = sys.stderr if stderr is None else stderr
    json_output = bool(args.json)

    base_url, warning = resolve_base_url(
        cli_base_url=args.base_url,
        env=env,
        start_path=start_path if start_path is not None else _script_start_path(argv),
    )
    if warning and not json_output:
        err.write(warning + "\n")

    if args.command is None:
        parser.print_help(out)
        return 0

    try:
        transport = default_request if request_fn is None else request_fn
        return _dispatch_command(
            args,
            base_url=base_url,
            request_fn=transport,
            json_output=json_output,
            out=out,
            err=err,
        )
    except CliValidationError as exc:
        err.write(f"error: {exc}\n")
        return 2
    except TransportError as exc:
        err.write(f"transport error: {exc}\n")
        if exc.base_url is not None:
            err.write(f"base_url: {exc.base_url}\n")
        if exc.endpoint is not None:
            err.write(f"endpoint: {exc.endpoint}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
