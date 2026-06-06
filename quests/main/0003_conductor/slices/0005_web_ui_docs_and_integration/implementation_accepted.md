# Implementation Accepted

Slice `0005_web_ui_docs_and_integration` is accepted by the polisher reviewer.

## Summary

The slice implements the Conductor browser UI, wires it to the existing REST and
WebSocket APIs, consumes shared CSS from `projects/web/`, and adds current-state
project documentation, all matching the slice spec and physical plan:

- Main UI (`GET /`) lists services with health, last-checked, uptime, warnings,
  logs/home links (with `0.0.0.0` → page-hostname rewriting), and
  start/stop/restart controls that call the lifecycle APIs and refresh.
- Logs UI (`GET /services/{service_name}/logs`) lists files via REST, streams
  contents over the WebSocket `open`/`follow`/`read_before` contract, sends file
  paths only over the socket, renders a clear no-logs state, and surfaces errors
  with reopen support.
- Static assets served through the constrained `static.ts` helper with
  traversal rejection; HTML is escaped.
- Docs added/updated: `docs/reference/api.md`, `docs/how-to/operations.md`,
  Conductor and Web READMEs and docs indexes — including `POST /exit` lifecycle
  behavior and the fact that stopping Conductor ends the UI-serving process.
- Tests: `tests/ui.test.ts` and `tests/ui_integration.test.ts` cover UI routes,
  static asset serving/traversal rejection, browser-JS API/WebSocket usage,
  service list/lifecycle integration, and the no-logs state.

## Issues

- PR-0001 (logs viewer scrollback unreachable due to unbounded log-view height):
  resolved. `.sheaf-log-view` now uses `max-height: 70vh` with `overflow: auto`,
  restoring reachable upward-scroll `read_before` loading, with a regression test
  guarding the shared CSS. Verified fixed and marked completed.

No open polishing issues remain.
