# Slice 8: WebSocket Protocol And Multiplexing

## Objective

Implement the bidirectional WebSocket chat protocol, multi-client multiplexing, live broadcast, replay, acknowledgements, history paging, model selection, cancellation, and reconnect synchronization.

Expected outcome:

- `/ws/chat?p=<pile>&session=<sessionId>&client=<clientId>&after=<sequence>` accepts new and resumed sessions.
- Server sends `server.hello` first, optional backlog after `after`, then `server.caught_up`.
- All server and client frames use `ChatEnvelope`.
- Multiple clients attached to the same session receive the same sequenced user messages, AGUI events, status updates, model changes, and manifest updates.
- Reconnect and lazy history requests work without blocking live event broadcast.

## Key Files And Systems

- `projects/sheaf-chat/src/server/websocket.ts`
- `projects/sheaf-chat/src/protocol/envelopes.ts`
- `projects/sheaf-chat/src/protocol/clientFrames.ts`
- `projects/sheaf-chat/src/protocol/sessionBroadcaster.ts`
- `projects/sheaf-chat/tests/server/websocket/`

## Existing APIs To Reuse

- `ws` package if introduced in slice 1.
- Storage append/history APIs from slice 2.
- Agent lifecycle event emitter and manager from slice 5.
- AGUI mapper and snapshots from slice 6.
- REST server from slice 7 for HTTP upgrade integration.

## APIs To Extend Or Modify

- Add `SessionBroadcaster` keyed by `(pile, sessionId)` to sequence, persist, and fan out frames.
- Add client-frame handlers for:
  - `client.hello`
  - `client.user_message`
  - `client.history_request`
  - `client.model_select`
  - `client.ack`
  - `client.cancel` / `client.stop_generating`
  - `client.ping`
- Add deduplication by `messageId` for `client.user_message`.

## Implementation Notes

- Validate query parameters and reject invalid pile/session before opening the agent.
- `server.hello` includes connection ID, manifest or `null`, provisional session if manifest is deferred, latest sequence, history window, model list, and active model.
- Assign sequences only server-side after accepting a session event. Sequences are strictly increasing per session and define conversation order.
- On connect with `after`, replay available envelopes after that sequence in order before live mode and then send `server.caught_up`.
- For `client.history_request`, support `before`, `after`, and no cursor; respond with `history.page` carrying AGUI events or message snapshots and pagination flags. Do not pause live broadcasts while reading history.
- For user messages, validate, deduplicate, persist, sequence, broadcast to all clients including sender, emit equivalent AGUI events, then deliver to the agent. If Pi later fails, the accepted user message remains in history.
- Concurrent user messages are serialized by acceptance time and sequence.
- `client.model_select` validates availability, updates manager/manifest, broadcasts `model.changed`, and emits AGUI/custom activity as appropriate.
- `client.cancel` routes to the manager and emits status plus AGUI lifecycle close/error events.
- Track `client.ack` only for diagnostics/reconnect hints; do not make it an exactly-once requirement.
- `client.ping` receives `server.pong`.

## Validation

- WebSocket tests for hello, invalid query errors, new-session first message flow, hot attach with two clients, sender receives broadcast, no duplicate local rendering on retry, reconnect replay by `after`, `server.caught_up`, lazy history before/after, model selection, cancellation, ping/pong, and disconnect/idle handoff.
- Tests assert ordering and sequence monotonicity under concurrent clients.
- Tests assert live broadcasts continue while a history request is served.
