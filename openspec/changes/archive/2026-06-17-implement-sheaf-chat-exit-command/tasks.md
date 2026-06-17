## 1. Server Shutdown Endpoint

- [x] 1.1 Add shutdown state to `CreateSheafChatServer` so cleanup runs at most once and non-exit requests during shutdown return 404.
- [x] 1.2 Add `POST /exit` handling before `/api/` and static dispatch, returning 200 `{"exiting": true}` and scheduling cleanup only after the response is flushed.
- [x] 1.3 Reject WebSocket upgrades with HTTP 404 while shutdown is in progress.
- [x] 1.4 Return 405 with the standard REST error body for non-POST requests to `/exit`.
- [x] 1.5 Add a production shutdown callback in `src/server/main.ts` so `/exit` lets the process exit with code 0 after server cleanup.

## 2. Test Coverage

- [x] 2.1 Add REST tests for `POST /exit` response body and cleanup scheduling without terminating the test process.
- [x] 2.2 Add REST tests for repeated `POST /exit`, wrong-method `/exit`, and non-exit requests during shutdown.
- [x] 2.3 Add WebSocket test coverage that upgrade attempts during shutdown receive HTTP 404.
- [x] 2.4 Update test helpers to tolerate `/exit` closing the test server once and to avoid double-close failures.

## 3. Documentation And Validation

- [x] 3.1 Update `projects/sheaf-chat/docs/operations.md` to document `curl -X POST /exit` for clean shutdown.
- [x] 3.2 Update `projects/sheaf-chat/docs/coverage.md` to remove the stale shutdown gap.
- [x] 3.3 Run the focused Sheaf Chat test suite that covers server REST and WebSocket behavior.
- [x] 3.4 Run `openspec status --change implement-sheaf-chat-exit-command` and confirm the change is apply-ready.
