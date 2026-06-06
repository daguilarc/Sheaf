# Issues

## Issue PI-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-06T00:00:00Z
- updated_at: 2026-06-06T20:30:00Z
- title: Restart of a stopped service reports HTTP 500 despite a successful start
- details: |
  `RestartService` (`projects/conductor/src/lifecycle.ts:307-326`) defines
  `restart_requested = stopResult.stop_requested && startResult.started` and sets
  `error = startResult.error ?? stopResult.error`. When the target service is
  currently down, the `POST /exit` stop request fails (connection refused), so
  `stop_requested = false`, while the subsequent `StartService` succeeds with
  `started = true` and a populated `process`. The result is
  `restart_requested = false` with `error` carrying the stop-phase failure.

  The restart route in `projects/conductor/src/server.ts:192-205` then evaluates
  `if (result.error && !result.restart_requested)` and, because the stop error does
  not contain "missing or empty", returns **HTTP 500** — even though a fresh process
  was spawned successfully and the body still reports `started: true` with valid
  `process` details.

  Why this is a problem: restarting a service that is not currently running is a
  normal, expected user action (e.g. clicking "restart" on a down service). The
  physical plan specifies restart as "request stop first, then start with the
  configured command" and does not require the stop phase to succeed. Reporting a
  500 failure when the new process actually started is misleading to API/UI
  consumers and is inconsistent with the success-shaped body returned alongside the
  500. This edge case is also untested — existing restart tests
  (`tests/lifecycle.test.ts:343-412`) only exercise paths where stop succeeds.

  To mark completed, one of the following must be true and covered by a test:
  - Restart returns a success status (200) when the new process starts successfully,
    regardless of whether the stop phase reached a running `/exit`, OR
  - The semantics are deliberately reconsidered with the planner and the
    success/failure status is made consistent with the returned body (i.e. a 500 is
    not returned while `started: true` and a valid `process` are present), AND
  - A test covers restarting a service whose `/exit` is unreachable but whose start
    succeeds, asserting the chosen status code and response shape.
- resolution_notes: |
  Verified fixed. `RestartService` (`projects/conductor/src/lifecycle.ts:313-314`)
  now sets `restart_requested = startResult.started` and
  `error = startResult.error ?? (startResult.started ? undefined : stopResult.error)`,
  so a successful start yields `restart_requested: true` with no error even when the
  stop phase could not reach `/exit`. The restart route in
  `projects/conductor/src/server.ts:192-205` consequently skips the 500 branch and
  returns 200 with the populated `process`. Regression test
  `projects/conductor/tests/lifecycle.test.ts:376-446` covers the unreachable-stop /
  successful-start path and asserts HTTP 200, `restart_requested: true`,
  `stop_requested: false`, `started: true`, `error: undefined`, process details, and
  stop-before-start ordering. When start itself fails, `started: false` and the start
  error are still surfaced with the appropriate 4xx/5xx status.
