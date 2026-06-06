# Issue responses

## Response PI-0001 2026-06-06T20:23:33Z

- issue_id: PI-0001
- outcome: Fixed
- explanation: Updated `LifecycleManager.RestartService` in `projects/conductor/src/lifecycle.ts` so a successful start makes the restart successful even when the stop phase could not reach `/exit`, and stop-phase errors are not returned when the new process starts. Added a regression test in `projects/conductor/tests/lifecycle.test.ts` that dispatches `POST /api/services/alpha/restart` through the Conductor server request listener with an unreachable stop and successful start, asserting HTTP 200, `restart_requested: true`, `stop_requested: false`, `started: true`, no error, process details, and stop-before-start ordering.
