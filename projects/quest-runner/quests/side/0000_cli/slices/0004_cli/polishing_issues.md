# Issues

## Issue PR-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-07T08:15:33Z
- updated_at: 2026-06-07T08:15:33Z
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

## Issue PR-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-07T08:15:33Z
- updated_at: 2026-06-07T08:15:33Z
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
