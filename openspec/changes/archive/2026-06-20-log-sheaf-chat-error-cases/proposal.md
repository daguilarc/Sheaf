## Why

Sheaf Chat currently surfaces several recoverable failures to the browser while leaving no server-side evidence in stdout/stderr, which makes operator debugging through Conductor logs incomplete. The immediate pain point is Agent Review hunk staging: a failed or stale command can look like a no-op after the fact because expected command-result errors are not logged.

## What Changes

- Add a Sheaf Chat server logging requirement for handled error cases that are returned to REST or WebSocket clients.
- Log Agent Review command failures, including stage/revert/undo failures, stale hunk validation failures, verification failures, and malformed Agent Review frames.
- Keep logs suitable for Conductor's existing stdout/stderr capture rather than introducing a separate Sheaf Chat log file.
- Include enough structured context to diagnose the failure: feature area, action, repo/workspace/session identity where available, command id/request id where available, error code/stale flag, and message.
- Avoid logging hunk patch bodies, user chat text, secrets, or full file contents.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-service`: define the standard server logging contract for handled REST/WebSocket error cases.
- `sheaf-chat-agent-review-mode`: require Agent Review command and frame errors to emit server logs while preserving existing client-facing command-result behavior.

## Impact

- Affected code:
  - `projects/sheaf-chat/src/server/errors.ts`
  - `projects/sheaf-chat/src/server/websocket.ts`
  - `projects/sheaf-chat/src/server/agentReview/service.ts`
  - likely focused tests under `projects/sheaf-chat/tests/server/rest/agentReview.test.ts` and WebSocket/REST error tests.
- Affected APIs:
  - No response shape or WebSocket frame shape changes are intended.
  - Logs are emitted to stderr/stdout as process output for Conductor capture.
- Dependencies:
  - No new runtime dependency is required.
