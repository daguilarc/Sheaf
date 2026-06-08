# Sheaf Chat

Browser-based Pi agent conversations with pile-organized sessions, REST discovery APIs, and a WebSocket chat protocol.

## Run

From the repository root:

```bash
make sheaf-chat-build
make sheaf-chat-run
```

The service registers as `sheaf-chat` on port `9004` in `config/services.json`. Open `http://localhost:9004/` for the piles screen.

From this directory:

```bash
make build
make run
```

## Build And Test

```bash
make sheaf-chat-build
make sheaf-chat-test
```

Shared AGUI renderer tests live in `projects/web/tests/agui-chat.test.mjs`.

## Configuration

- `config/global_config.json` — `local_inference_url`, optional `agent_idle_offload_seconds`
- `config/api_keys.json` — `local_inference_api_key`, optional `openai_api_key` bootstrap secret
- `config/services.json` — service registration (`sheaf-chat`, port `9004`)

OpenAI OAuth material is stored under `data/sheaf-chat/auth/openai/`, not in global Pi config.

## Data Layout

Runtime data is under `data/sheaf-chat/`:

```text
data/sheaf-chat/
  auth/openai/
  sessions/piles/<pile>/
    <sessionId>.jsonl
    <sessionId>.manifest.json
```

Manifests are written only after the first assistant message completes.

## REST API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Service health |
| GET | `/api/piles` | List piles |
| POST | `/api/piles` | Create pile `{ "pile": "name" }` |
| GET | `/api/piles/:pile/sessions` | List session manifests |
| POST | `/api/piles/:pile/sessions` | Create blank session shell |
| GET | `/api/piles/:pile/sessions/:sessionId` | Read one manifest |
| GET | `/api/piles/:pile/sessions/:sessionId/history` | REST history fallback |
| GET | `/api/models` | Available models |

Errors use `{ "error": { "code", "message" } }`.

## WebSocket Protocol

Connect to:

```text
/ws/chat?p=<pile>&session=<sessionId>&client=<clientId>&after=<sequence>
```

Frames are JSON envelopes (`v`, `kind`, `id`, `pile`, `sessionId`, optional `sequence`, `payload`). Server kinds include `server.hello`, `history.page`, `agui.event`, `chat.user_message`, `model.changed`, `agent.status`, `server.caught_up`, and `server.error`. Client kinds include `client.user_message`, `client.history_request`, `client.model_select`, `client.ack`, and `client.hello`.

See [docs/README.md](docs/README.md) for full protocol and security notes.

## Browser UI

Service-owned UI lives in `src/ui/`. Shared AGUI rendering is in `projects/web/src/agui-chat.js`.

## Documentation

See [docs/README.md](docs/README.md).
