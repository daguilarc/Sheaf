# Sheaf Chat Docs

## Overview

Sheaf Chat is a Sheaf service for browser conversations with Pi agents. It provides pile-organized sessions, scoped filesystem tools, provider/model selection, and a bidirectional WebSocket protocol carrying AGUI events.

## Running The Service

From the repository root:

```bash
make sheaf-chat-build
make sheaf-chat-run
```

Open `http://localhost:9004/`. The first screen is the piles list.

Service registration: `config/services.json` (`sheaf-chat`, port `9004`, `make sheaf-chat-run`).

## Configuration And Data Paths

| Path | Purpose |
|------|---------|
| `config/global_config.json` | `local_inference_url`, `agent_idle_offload_seconds` |
| `config/api_keys.json` | `local_inference_api_key`, bootstrap `openai_api_key` |
| `data/sheaf-chat/auth/openai/` | Persisted OpenAI OAuth/subscription material |
| `data/sheaf-chat/sessions/piles/<pile>/` | Session JSONL logs and manifests |

Sheaf Chat does not read runtime behavior from a developer's global `~/.pi` configuration.

Repository layout conventions:

- [structure/configuration.md](../../../structure/configuration.md)
- [structure/logs-and-data.md](../../../structure/logs-and-data.md)
- [structure/repo-layout.md](../../../structure/repo-layout.md)

## REST API Summary

- `GET /api/health` — health and version
- `GET /api/piles` — list piles with session counts
- `POST /api/piles` — create pile
- `GET /api/piles/:pile/sessions` — list manifests (newest first)
- `POST /api/piles/:pile/sessions` — create blank session shell with `rootDirectory` and `model`
- `GET /api/piles/:pile/sessions/:sessionId` — one manifest
- `GET /api/piles/:pile/sessions/:sessionId/history?before=&limit=` — REST history fallback
- `GET /api/models` — merged OpenAI and local inference models

## WebSocket Protocol Summary

**URL:** `/ws/chat?p=<pile>&session=<sessionId>&client=<clientId>&after=<sequence>`

**Envelope:** `{ v: 1, kind, id, pile, sessionId, sequence?, timestamp, payload? }`

**Server → client (selected):**

- `server.hello` — connection metadata, models, history window
- `history.page` — paged AGUI events or message snapshots
- `agui.event` — one AGUI event
- `chat.user_message` — broadcast user turn (all clients render the same copy)
- `model.changed`, `session.updated`, `agent.status`
- `server.caught_up` — replay finished, live mode
- `server.error`

**Client → server (selected):**

- `client.hello` — capabilities and last seen sequence
- `client.user_message` — send a message (server broadcasts; no local-only echo)
- `client.history_request` — lazy history (`before`, `after`, or latest page)
- `client.model_select` — switch model for future turns
- `client.ack` — processed sequence acknowledgement

Sequence numbers are monotonic per session and drive reconnect replay (`after=<lastSequence>`).

AGUI schema: `structure/schemas/ag_ui_events.schema.json`

## Provider And Model Setup

1. **OpenAI subscription/OAuth** — configure OAuth under `data/sheaf-chat/auth/openai/`. Optional bootstrap key in `config/api_keys.json`.
2. **Local inference** — set `local_inference_url` in `config/global_config.json` and `local_inference_api_key` in `config/api_keys.json`.

`GET /api/models` merges OpenAI models with models from the local endpoint. The browser sends `client.model_select` to change the active model.

## Root-Scoped Tool Security

Each session has a `rootDirectory`. The Sheaf Chat Pi extension exposes `read`, `write`, `edit`, `list`, `tree`, `find_files`, `search_text`, and `file_info` scoped to that root.

- No Bash or arbitrary command execution
- Paths are relative to the session root; absolute paths and `..` escapes are rejected
- Symlinks are resolved; targets outside the canonical root are denied
- Tool results relativize paths; parent directories outside the root are not exposed
- Escape attempts emit visible AGUI activity events and audit logs

## Pi Integration Docs

Authoritative Pi documentation (installed package):

- Pi README: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- Extensions: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- SDK: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- Custom providers: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md`
- Models: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/models.md`

## Shared AGUI UI

Generic AGUI rendering lives in:

- `projects/web/src/agui-chat.js`
- `projects/web/src/agui-chat.css`

Sheaf Chat-specific browser code is under `projects/sheaf-chat/src/ui/`.

Mapping reference: `projects/quest-runner/docs/reference/agui-mapping.md`
