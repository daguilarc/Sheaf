# Slice 0008: WebSocket Protocol — Implementation Complete

## Summary

Implemented the bidirectional Sheaf Chat WebSocket protocol with multi-client multiplexing, live broadcast, reconnect replay, history paging, model selection, cancellation, and ping/pong.

## Delivered

- `src/protocol/envelopes.ts` — server frame kind constants and envelope re-exports
- `src/protocol/clientFrames.ts` — client frame parsing and validation
- `src/protocol/sessionBroadcaster.ts` — per-session sequencing, persistence, lifecycle fan-out, and client registry
- `src/server/websocket.ts` — `/ws/chat` upgrade handling, handshake, replay, and client frame dispatch
- `src/server/server.ts` — HTTP upgrade integration with `SessionBroadcasterRegistry`
- `src/agents/sessionRuntime.ts` — cancellation error emission for WebSocket clients
- `tests/server/websocket/` — protocol integration tests (hello, invalid queries, multiplexing, dedupe, replay, history, live+during-history, model select, cancel, ping/pong, idle offload)
- Added `ws` and `@types/ws` dependencies

## Protocol Behavior

- `/ws/chat?p=<pile>&session=<sessionId>&client=<clientId>&after=<sequence>` validates pile/session, attaches the agent, sends `server.hello`, replays backlog after `after`, then `server.caught_up`.
- All frames use `ChatEnvelope`; server assigns monotonic per-session sequences on persist/broadcast.
- `SessionBroadcaster` fans out user messages, AGUI events, status, model changes, manifest updates, and errors to all attached clients.
- `client.user_message` is deduplicated by `messageId`, serialized by acceptance order, persisted/broadcast before agent delivery.
- `client.history_request` returns `history.page` without blocking live broadcasts.
- `client.model_select`, `client.cancel` / `client.stop_generating`, `client.ack`, `client.ping`, and `client.hello` are handled per spec.

## Validation

`make sheaf-chat-test` passes (107 tests).
