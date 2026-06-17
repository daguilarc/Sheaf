## Context

Sheaf Chat is registered in `config/services.json`, already binds from that registry, and already exposes `GET /health` in the standard service shape. The service contract in `structure/services.md` also requires registered services to expose `POST /exit`, and Conductor uses that endpoint when stopping a service. Today Sheaf Chat only has an internal `server.close()` helper used by tests; production has no HTTP shutdown route.

The server object currently owns the cleanup sequence for broadcasters, persistence hubs, Agent Review sessions, WebSocket servers, and the HTTP server. The production entrypoint owns process lifetime and currently does not retain a shutdown callback.

## Goals / Non-Goals

**Goals:**

- Add `POST /exit` with the service-contract response body `{"exiting": true}`.
- Flush the response before initiating shutdown.
- Reuse the existing server cleanup path so HTTP, chat WebSocket, Agent Review WebSocket, broadcaster, persistence, and Agent Review resources close consistently.
- Make shutdown idempotent across repeated `/exit` requests and future signal wiring.
- Keep service-specific REST error envelopes for unsupported methods and normal route misses.

**Non-Goals:**

- Change the existing `GET /health` or `GET /api/health` response shapes.
- Add a new public service-management API beyond `POST /exit`.
- Change Conductor's stop behavior or the shared `structure/services.md` contract.

## Decisions

1. Implement shutdown in `CreateSheafChatServer`, with an optional production callback.

   The HTTP server is the right place to recognize `/exit` because it already owns dispatch order and has direct access to cleanup resources. `CreateSheafChatServer` should accept an optional `onExit` or `afterExitResponse` callback that `main.ts` wires to a normal process exit. Tests can omit or replace that callback to assert behavior without ending the test process.

   Alternative considered: handle `/exit` only in `main.ts`. That would split HTTP routing across two modules and make tests harder because the existing test helpers instantiate `CreateSheafChatServer` directly.

2. Send the exit response before cleanup starts.

   The request handler should call `SendJson(response, 200, { exiting: true })` and schedule shutdown from the response completion callback or the next event-loop turn after the response is ended. This satisfies Conductor's expectation that the exit request returns before the service stops accepting connections.

   Alternative considered: call `close()` before responding. That risks terminating active sockets before Conductor receives the 2xx response.

3. Centralize idempotency in one shutdown controller inside the server instance.

   A local shutdown promise or state flag should ensure cleanup runs once. Repeated `POST /exit` requests before close completes should return the same 200 body when they can be served; non-exit requests during shutdown should return 404.

   Alternative considered: let repeated calls race through `close()`. Node's `server.close()` and WebSocket closure callbacks are not a good idempotency boundary and can produce confusing errors.

4. Preserve Sheaf Chat's error envelope outside the successful exit response.

   The successful body follows the cross-service contract. Wrong-method `/exit` requests should use the existing `method_not_allowed` REST error body, and normal route misses should continue to use Sheaf Chat's `FormatRestError` shape.

   Alternative considered: adopt Conductor's flat `{"error": "not found"}` during shutdown. That would be inconsistent with Sheaf Chat's documented REST error format and is not needed for Conductor, which only requires a 2xx response from the stop request.

## Risks / Trade-offs

- In-flight chat or Agent Review work may be interrupted by shutdown -> mitigation: reuse the existing `close()` order, including `AgentReviewService.Dispose()`, before closing WebSocket servers and HTTP.
- Tests that call `/exit` can close their own test server unexpectedly -> mitigation: expose a test-friendly shutdown callback and update helpers to tolerate an already-closed server.
- A response-flush race could make Conductor see a transport failure instead of 200 -> mitigation: schedule cleanup only after `response.end` has completed or after the response emits `finish`.
