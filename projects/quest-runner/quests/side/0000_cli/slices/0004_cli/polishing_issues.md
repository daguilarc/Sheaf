# Issues

## Issue PR-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-07T08:15:33Z
- updated_at: 2026-06-07T08:20:02Z
- title: Transport/connection errors omit target base URL and endpoint
- details: |
  Both the slice spec and the physical plan require that on connection/transport
  errors the CLI prints the target base URL and endpoint, then exits non-zero
  (spec `01_quest_runner_cli.md` HTTP behavior; `physicalplan/plan.md` line 54:
  "On connection/transport errors, print the target base URL and endpoint; exit
  non-zero.").

  Current behavior in `src/quest_runner_service/cli.py`:
  - `default_request` raises `TransportError(str(exc.reason))` (only the reason).
  - `main` catches `TransportError` and writes only `transport error: {exc}\n`
    (cli.py:927-929).

  Neither the resolved base URL nor the request endpoint is printed, so the
  required diagnostic context is missing. By contrast, the HTTP-error path
  (`_handle_http_result`) correctly prints `HTTP {status} {endpoint}`.

  The existing test `test_transport_error_exits_nonzero` (tests/test_cli.py:536)
  only asserts the reason substring and exit code 1; it does not verify the base
  URL or endpoint, so this gap is not caught by the suite.
- resolution_notes: none

To mark completed: the CLI must print the target base URL and the request
endpoint on a connection/transport failure (in addition to the underlying
reason) and exit non-zero, and a test must assert that both the base URL and the
endpoint appear in stderr for a transport failure.

Verification (2026-06-07T08:20:02Z): Fixed. `TransportError` now carries
`base_url`/`endpoint` (cli.py:30-40); `_send_request` enriches the exception with
the resolved base URL and endpoint when not already set (cli.py:160-174); all
command dispatch paths route through `_send_request`; and `main` prints
`base_url:` and `endpoint:` lines alongside the reason before exiting non-zero
(cli.py:986-992). `test_transport_error_exits_nonzero` now asserts the base URL
(`http://test.local`) and `/advance_quest` endpoint appear in stderr
(tests/test_cli.py:558-562). Closed.

## Issue PR-0002

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-07T08:15:33Z
- updated_at: 2026-06-07T08:20:02Z
- title: `issues edit --body-file` raises uncaught OSError on unreadable file
- details: |
  In the `issues_edit` handler, the body file is read directly without error
  handling:

      if args.body_file is not None:
          extra["body"] = Path(args.body_file).read_text(encoding="utf-8")

  (cli.py:817-818). If the path is missing or unreadable, this raises `OSError`,
  which `main` does not catch (it only catches `CliValidationError` and
  `TransportError`, cli.py:924-929). The result is an unhandled traceback and a
  non-clean exit, rather than the `error: ...` message and exit code 2 that other
  malformed-local-argument paths produce.

  This is inconsistent with the `issues_create` handler, which routes body
  reading through `_read_text_source` (cli.py:171-181); that helper wraps
  `OSError` in `CliValidationError` ("Could not read --body-file: ..."). The edit
  path should behave the same way for the same `--body-file` feature.

  No test exercises `issues edit --body-file` (success or failure), so this
  divergence is uncovered.
- resolution_notes: none

To mark completed: `issues edit --body-file <path>` for a missing/unreadable
file must fail with a clean validation-style error message and a non-zero exit
(no traceback), consistent with the create path; and a test must cover the
`issues edit --body-file` path (at minimum the unreadable-file failure).

Verification (2026-06-07T08:20:02Z): Fixed. The `issues_edit` handler now reads
the body file via `_read_text_source(args.body, args.body_file, "body")`
(cli.py:865-866), which wraps `OSError` in a `CliValidationError`
("Could not read --body-file: ...", cli.py:175-181); `main` catches that and
exits 2 (cli.py:983-985). New test
`test_issues_edit_body_file_read_error_is_validation_error` asserts the
"Could not read --body-file" message, exit code 2, and that no request was sent
(tests/test_cli.py:634-654). Closed.
