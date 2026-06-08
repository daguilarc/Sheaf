# API Reference

Sheaf Chat exposes REST discovery and recovery endpoints plus one WebSocket route for live chat. All API routes are served by `projects/sheaf-chat/src/server/`.

## REST Errors

REST errors use this shape:

```json
{
  "error": {
    "code": "not_found",
    "message": "route not found"
  }
}
```

Known error codes include `invalid_request`, `invalid_json`, `invalid_pile`, `invalid_session_id`, `invalid_history_request`, `model_not_found`, `model_unavailable`, `invalid_root_directory`, `method_not_allowed`, `not_found`, `pile_not_found`, `manifest_not_found`, and `path_escape`.

## REST Endpoints

### `GET /api/health`

Returns service health, version, and non-secret dependency status.

```json
{
  "service": "sheaf-chat",
  "version": "0.1.0",
  "status": "ok",
  "dependencies": {
    "localInference": {
      "configured": true,
      "available": true
    },
    "openAi": {
      "configured": true
    }
  }
}
```

### `GET /api/piles`

Returns piles sorted by name.

```json
{
  "piles": [
    {
      "pile": "default",
      "sessionCount": 3,
      "latestUpdatedAt": "2026-06-08T00:00:00.000Z"
    }
  ]
}
```

### `POST /api/piles`

Creates a pile.

Request:

```json
{
  "pile": "default"
}
```

Response:

```json
{
  "pile": "default",
  "sessionCount": 0,
  "latestUpdatedAt": null
}
```

### `GET /api/piles/:pile/sessions`

Returns session manifests for a pile, sorted newest first by `updatedAt`. It does not include heavy message history.

```json
{
  "sessions": [
    {
      "schemaVersion": 1,
      "pile": "default",
      "sessionId": "0123456789abcdef",
      "chatName": "Inspect project",
      "description": "Inspect project",
      "rootDirectory": "/repo/projects",
      "createdAt": "2026-06-08T00:00:00.000Z",
      "updatedAt": "2026-06-08T00:00:00.000Z",
      "lastOpenedAt": "2026-06-08T00:00:00.000Z",
      "model": { "provider": "local", "id": "qwen3-coder" },
      "pi": {
        "sessionFile": "data/sheaf-chat/sessions/piles/default/0123456789abcdef.jsonl",
        "extensionVersion": "0.1.0"
      },
      "history": {
        "messageCount": 0,
        "lastSequence": 12
      }
    }
  ]
}
```

### `POST /api/piles/:pile/sessions`

Creates a blank session shell in an existing pile. The request must include an existing root directory and an available model.

Request:

```json
{
  "rootDirectory": "projects",
  "model": {
    "provider": "local",
    "id": "qwen3-coder"
  }
}
```

Response:

```json
{
  "sessionId": "0123456789abcdef",
  "provisionalSession": {
    "rootDirectory": "projects",
    "model": {
      "provider": "local",
      "id": "qwen3-coder"
    }
  },
  "webSocketUrl": "/ws/chat?p=default&session=0123456789abcdef"
}
```

This endpoint creates the Pi session file, companion history file, and provisional metadata. It does not write the manifest. The manifest is written after the first assistant message completes.

### `GET /api/piles/:pile/sessions/:sessionId`

Returns one persisted manifest:

```json
{
  "manifest": {
    "schemaVersion": 1,
    "pile": "default",
    "sessionId": "0123456789abcdef",
    "chatName": "Inspect project",
    "description": "Inspect project",
    "rootDirectory": "/repo/projects",
    "createdAt": "2026-06-08T00:00:00.000Z",
    "updatedAt": "2026-06-08T00:00:00.000Z",
    "lastOpenedAt": "2026-06-08T00:00:00.000Z",
    "model": { "provider": "local", "id": "qwen3-coder" },
    "pi": {
      "sessionFile": "data/sheaf-chat/sessions/piles/default/0123456789abcdef.jsonl",
      "extensionVersion": "0.1.0"
    },
    "history": {
      "messageCount": 0,
      "lastSequence": 12
    }
  }
}
```

### `GET /api/piles/:pile/sessions/:sessionId/history`

Reads a history page from the companion Sheaf Chat history log.

Query parameters:

| Parameter | Meaning |
|-----------|---------|
| `before` | Return envelopes with sequence numbers before this cursor. |
| `after` | Return envelopes with sequence numbers after this cursor. |
| `limit` | Page size. Defaults to `50` and is capped at `200`. |
| `prefer` | `events` or `snapshots`. Defaults to `events` for REST. |

`before` and `after` are mutually exclusive.

Event response:

```json
{
  "direction": "latest",
  "events": [],
  "envelopes": [],
  "oldestSequence": 1,
  "newestSequence": 12,
  "hasMoreBefore": false,
  "hasMoreAfter": false
}
```

Snapshot response with `prefer=snapshots`:

```json
{
  "direction": "latest",
  "messages": [],
  "oldestSequence": 1,
  "newestSequence": 12,
  "hasMoreBefore": false,
  "hasMoreAfter": false
}
```

### `GET /api/models`

Returns browser-facing model metadata.

```json
{
  "models": [
    {
      "provider": "local",
      "id": "qwen3-coder",
      "displayName": "qwen3-coder",
      "contextTokens": 128000,
      "available": true
    }
  ]
}
```

Unavailable local models include `unavailableReason`, such as `local_inference_url_missing`, `local_inference_api_key_missing`, or `local_models_fetch_failed`.

## WebSocket Route

Connect to:

```text
/ws/chat?p=<pile>&session=<sessionId>&client=<clientId>&after=<sequence>
```

Query parameters:

| Parameter | Required | Meaning |
|-----------|----------|---------|
| `p` or `pile` | Yes | Pile name. |
| `session` | Yes | Session id. |
| `client` | No | Stable browser client id used for diagnostics and lifecycle attach/detach. |
| `after` | No | Last processed server sequence. The server replays persisted envelopes after this sequence. |

The upgrade is rejected before opening the WebSocket if the pile/session identifiers are invalid or the session file does not exist.

## Envelope

Every client and server frame is a UTF-8 JSON object:

```json
{
  "v": 1,
  "kind": "client.user_message",
  "id": "frame-id",
  "pile": "default",
  "sessionId": "0123456789abcdef",
  "clientId": "browser-client-id",
  "sequence": 12,
  "timestamp": "2026-06-08T00:00:00.000Z",
  "payload": {}
}
```

Clients must not assign `sequence`. Server-persisted envelopes receive strictly increasing per-session sequence numbers.

## Server Frames

### `server.hello`

Sent first after successful attachment.

Payload fields:

- `connectionId`: server-generated connection id.
- `manifest`: persisted manifest or `null`.
- `provisionalSession`: present when the manifest is still deferred.
- `latestSequence`: newest persisted sequence, or `0`.
- `historyWindow`: `{ oldestSequence, newestSequence }`.
- `models`: model metadata list.
- `activeModel`: current model reference.

### `history.page`

Sent in response to `client.history_request`.

Payload fields:

- `requestId`: id of the client request frame.
- `direction`: `before`, `after`, or `latest`.
- `messages`: AGUI-compatible snapshots when `prefer` is `snapshots`.
- `events`: AGUI events when `prefer` is `events`.
- `oldestSequence`, `newestSequence`, `hasMoreBefore`, `hasMoreAfter`.

WebSocket history defaults to `snapshots`.

### `agui.event`

Carries one mapped AGUI event from Pi output or Sheaf Chat activity. Events are mapped and sanitized under `projects/sheaf-chat/src/agui/`.

### `chat.user_message`

Broadcasts an accepted user message to every attached client, including the sender.

```json
{
  "messageId": "client-message-id",
  "text": "Please inspect src/app.ts",
  "attachments": [],
  "steer": true
}
```

The server also persists equivalent AGUI text message events.

### `model.changed`

Broadcast after a validated model switch.

```json
{
  "model": { "provider": "local", "id": "qwen3-coder" },
  "applyTo": "next_turn"
}
```

### `session.updated`

Broadcast when manifest metadata changes, including initial manifest creation after the first assistant message. Root paths in this payload are relativized to the repository root when possible.

### `agent.status`

Broadcast lifecycle state changes:

```json
{
  "state": "active",
  "previousState": "starting"
}
```

States are `cold`, `starting`, `active`, `idle`, `stopping`, and `failed`.

### `server.caught_up`

Sent after reconnect replay has completed. Frames after this marker are live frames.

### `server.error`

Recoverable or fatal error:

```json
{
  "code": "invalid_frame",
  "message": "frame version must be 1",
  "fatal": false,
  "requestId": "client-frame-id"
}
```

### `server.pong`

Response to `client.ping`; payload contains `requestId`.

## Client Frames

### `client.hello`

Optional capability frame.

```json
{
  "supportsSnapshots": true,
  "supportsLazyHistory": true,
  "lastSeenSequence": 12
}
```

### `client.user_message`

Submits a user message.

```json
{
  "messageId": "client-generated-id",
  "text": "Continue with the local model.",
  "attachments": [],
  "steer": true
}
```

The server deduplicates by `messageId`, persists and broadcasts the accepted message, emits AGUI message events, then delivers the text to the Pi session. If the Pi delivery fails, the accepted user turn remains in history and the server emits an error frame.

### `client.history_request`

Requests older, newer, or latest history.

```json
{
  "before": 80,
  "limit": 50,
  "prefer": "snapshots"
}
```

`before` and `after` cannot be combined.

### `client.model_select`

Switches the active model.

```json
{
  "provider": "local",
  "id": "qwen3-coder",
  "applyTo": "next_turn"
}
```

`applyTo` is `next_turn` by default and may also be `current_turn`.

### `client.ack`

Records the latest processed sequence for diagnostics and reconnect hints.

```json
{
  "sequence": 12
}
```

Acknowledgements do not provide exactly-once delivery.

### `client.cancel` and `client.stop_generating`

Request cancellation of the current Pi turn. The runtime calls `abort()` on the active Pi session and emits a non-fatal `cancelled` error activity.

### `client.ping`

Keepalive frame. The server responds with `server.pong`.
