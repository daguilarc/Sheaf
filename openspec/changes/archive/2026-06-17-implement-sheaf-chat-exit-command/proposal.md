## Why

Conductor expects managed services to expose a coordinated shutdown endpoint, but Sheaf Chat currently has no production `/exit` route and its own service spec explicitly documents that gap. This prevents Conductor and smoke-test workflows from stopping Sheaf Chat through the standard service contract.

## What Changes

- Add a production `POST /exit` endpoint to Sheaf Chat.
- Make `/exit` respond with the service-contract shutdown body before closing listeners, WebSocket servers, registries, and agent-review resources.
- Keep shutdown idempotent so repeated `/exit` or signal-style shutdown triggers cannot race cleanup.
- Update service documentation and coverage notes that currently state there is no shutdown endpoint.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-service`: add the standard shutdown endpoint and lifecycle behavior required by the service contract.

## Impact

- `projects/sheaf-chat/src/server/server.ts`: request dispatch, shutdown state, HTTP/WebSocket closure, and idempotent cleanup.
- `projects/sheaf-chat/src/server/main.ts`: process-lifetime wiring so production `/exit` can terminate after the response is flushed.
- `projects/sheaf-chat/tests/server/rest/rest.test.ts` and any helper updates needed for shutdown assertions.
- `projects/sheaf-chat/docs/operations.md` and `projects/sheaf-chat/docs/coverage.md`: remove stale "no shutdown endpoint" guidance.
