## Context

Sheaf Chat is normally operated through Conductor, which captures the service process stdout/stderr under `logs/sheaf-chat/`. The service already writes startup and fatal process errors to stderr, and Conductor can expose those logs, but several recoverable server-side failures are only returned to clients.

Agent Review is the motivating example. Stage, revert, undo, stale-hunk validation, verification rollback, and malformed Agent Review frames are handled inside the review WebSocket session. The client may show these as `command_result.error` or an Agent Review error frame, but after the UI state moves on there may be no durable operator-visible record.

## Goals / Non-Goals

**Goals:**

- Emit server logs for handled Sheaf Chat error cases that currently leave no process-log evidence.
- Make Agent Review hunk command failures diagnosable from Conductor logs.
- Include enough context to correlate a log entry with a client-visible failure without logging sensitive or bulky payloads.
- Keep response and WebSocket frame contracts unchanged.

**Non-Goals:**

- No new persistent Sheaf Chat log file format.
- No change to Agent Review hunk staging, reverting, undo, or stale validation semantics.
- No logging of hunk patch bodies, user message text, chat transcript content, secrets, or full file contents.
- No change to Conductor log ingestion.

## Decisions

### Use stderr process logs with structured single-line records

Handled server errors should be logged to stderr as one line per event. Prefer a JSON object payload with stable keys such as `service`, `level`, `event`, `feature`, `action`, `repoId`, `workspaceId`, `clientId`, `commandId`, `requestId`, `code`, `stale`, and `message`.

Rationale: Conductor already captures stdout/stderr for Sheaf Chat. JSON lines are grep-friendly and machine-readable without introducing a new runtime logger dependency.

Alternative considered: write a dedicated `logs/sheaf-chat/sheaf-chat.jsonl`. That would create a second capture path that Conductor does not currently manage for Sheaf Chat and would require path, rotation, and lifecycle decisions unrelated to the immediate debugging gap.

### Centralize log formatting, keep call sites explicit

Add a small server-side logging helper that redacts/normalizes fields and writes through `console.error`. Call it from existing error boundaries rather than replacing the whole error-handling model.

Rationale: REST routes, chat WebSockets, and Agent Review WebSockets already have different response semantics. Central formatting avoids inconsistent output while explicit calls preserve the current control flow.

Alternative considered: monkey-patch every `SendRestError` or WebSocket send path. That is too broad for this change because some client errors are expected validation feedback and not all are equally useful at error severity.

### Treat Agent Review command failures as warn/error events

Agent Review command failures should log when a command result is `ok: false`, including validation failures before Git runs, Git apply failures, post-mutation verification failures, undo failures, and malformed Agent Review client frames. Successful commands should not log by default.

Rationale: the user-visible symptom is "stage hunk seemed to not do anything"; the useful evidence is the failed command result with action and stale/error context.

Alternative considered: log every Agent Review command. That would add noise during normal review sessions and make real failures harder to find.

## Risks / Trade-offs

- [Logs become noisy for user-caused validation errors] -> Keep the initial service-level requirement focused on handled error cases and let tests pin the high-value Agent Review failures first.
- [Sensitive data could leak into logs] -> Use an allowlist of scalar context fields and explicitly exclude patch bodies, text payloads, secrets, and full file contents.
- [JSON log expectations become brittle] -> Tests should assert stable required fields and event names, not exact key ordering.
- [Some failures remain unlogged] -> This proposal targets server-handled errors that reach Sheaf Chat error boundaries. Browser-only rendering issues and network failures before the server receives a frame remain outside scope.

## Migration Plan

Implementing the change is additive. Existing clients continue to receive the same REST responses and WebSocket frames. Rollback is to remove the new logging calls/helper; no data migration is required.

## Open Questions

- None for the initial scope.
