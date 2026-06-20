## 1. Logging Helper

- [x] 1.1 Add a Sheaf Chat server logging helper that emits one stderr line per handled error event with stable structured fields.
- [x] 1.2 Ensure the helper allowlists scalar diagnostic fields and excludes secrets, request bodies, chat text, hunk patches, and file contents.

## 2. Shared Server Error Paths

- [x] 2.1 Instrument REST error handling so standard handled REST errors emit a server log entry without changing response bodies.
- [x] 2.2 Instrument chat WebSocket handled error paths so fatal/non-fatal error frames emit server log entries with request correlation where available.
- [x] 2.3 Add focused tests proving handled REST and chat WebSocket errors log once and preserve existing client-facing contracts.

## 3. Agent Review Error Logging

- [x] 3.1 Instrument Agent Review command-result failures for stage, revert, undo, stale-hunk validation, Git apply failures, and verification/rollback failures.
- [x] 3.2 Instrument malformed Agent Review WebSocket frame handling.
- [x] 3.3 Add tests proving Agent Review failures emit diagnostic logs with action, command id, repo/workspace/client ids, stale flag when applicable, and message.
- [x] 3.4 Add tests proving successful Agent Review commands do not emit handled-error log entries.

## 4. Documentation And Verification

- [x] 4.1 Update Sheaf Chat operations or coverage docs to describe that handled server errors are visible through stdout/stderr captured by Conductor.
- [x] 4.2 Run the focused Sheaf Chat server and Agent Review tests.
- [x] 4.3 Run the full Sheaf Chat test suite if local server binding is available.
