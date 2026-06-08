# Run And Use Sheaf Chat

This guide covers the normal developer and operator workflow for Sheaf Chat.

## Build And Test

From the repository root:

```bash
make sheaf-chat-build
make sheaf-chat-test
```

From `projects/sheaf-chat/`:

```bash
make build
make test
```

`make sheaf-chat-test` builds the TypeScript project and runs compiled `*.test.js` files with Node's built-in test runner through `projects/sheaf-chat/scripts/run-tests.mjs`.

## Start The Service

From the repository root:

```bash
make sheaf-chat-build
make sheaf-chat-run
```

The runtime entry point loads `config/services.json`, finds the `sheaf-chat` service entry, and binds to that entry's host and port. The current service registration uses port `9004`.

Open:

```text
http://localhost:9004/
```

The server also serves:

- `/assets/sheaf-chat/sheaf-chat.js` and `/assets/sheaf-chat/sheaf-chat.css` from `projects/sheaf-chat/src/ui/`.
- `/assets/web/agui-chat.js` and `/assets/web/agui-chat.css` from `projects/web/src/`.

## Configure Providers

Sheaf Chat does not read runtime behavior from a developer's global `~/.pi` directory.

For local inference, set:

```json
{
  "local_inference_url": "http://studio.local:8000/v1/",
  "agent_idle_offload_seconds": 300
}
```

in `config/global_config.json`, and provide this secret in an operator-created `config/api_keys.json`:

```json
{
  "local_inference_api_key": "..."
}
```

For OpenAI bootstrap auth, `config/api_keys.json` may also contain `openai_api_key`. Persisted Pi auth and model files are stored under `data/sheaf-chat/`, not under `~/.pi`.

See [Configuration And Data](../reference/config-and-data.md) for exact paths.

## Browser Workflow

1. Open the service URL. The first screen lists piles.
2. Create or select a pile. Pile names are safe single path segments.
3. Create a session in that pile by choosing a root directory and available model.
4. The browser opens the chat route for `(pile, sessionId)` and connects to `/ws/chat`.
5. Send messages through the composer. Desktop Enter sends and Shift+Enter inserts a newline. Touch layouts use the explicit Send button.
6. Scroll near the top of the transcript to request older history over the WebSocket.
7. Use the model selector to switch the active model for future turns.

The UI renders user messages only after the server broadcasts accepted turns. This keeps multiple browser clients attached to the same session in the same sequence order.

## Reconnect Behavior

The browser stores a stable client id in `localStorage` and reconnects with `after=<lastSequence>`. On reconnect, the server replays persisted envelopes after that sequence, sends `server.caught_up`, and then resumes live delivery.

Outbound frames created while disconnected are queued in memory and flushed after the socket reconnects.

## Common API Checks

Health and dependency configuration:

```bash
curl http://localhost:9004/api/health
```

List models:

```bash
curl http://localhost:9004/api/models
```

Create a pile:

```bash
curl -X POST http://localhost:9004/api/piles \
  -H 'content-type: application/json' \
  -d '{"pile":"default"}'
```

Create a blank session shell:

```bash
curl -X POST http://localhost:9004/api/piles/default/sessions \
  -H 'content-type: application/json' \
  -d '{"rootDirectory":"projects","model":{"provider":"local","id":"local-default"}}'
```

Blank session creation writes a Pi session file, companion history file, and provisional metadata. The manifest is written only after the first assistant message completes.
