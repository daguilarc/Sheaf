# Configuration And Data

Sheaf Chat reads repository-local configuration and writes runtime state under `data/sheaf-chat/`. It does not depend on a developer's global `~/.pi` configuration for runtime behavior.

## Service Registration

The service is registered in `config/services.json`:

```json
{
  "name": "sheaf-chat",
  "host": "0.0.0.0",
  "port": 9004,
  "home_path": "/",
  "command": "make sheaf-chat-run"
}
```

`projects/sheaf-chat/src/server/main.ts` loads this registry at startup and fails if the `sheaf-chat` entry is missing.

## Non-Secret Configuration

`config/global_config.json` owns Sheaf Chat's non-secret runtime knobs:

```json
{
  "local_inference_url": "http://studio.local:8000/v1/",
  "agent_idle_offload_seconds": 300
}
```

| Key | Meaning |
|-----|---------|
| `local_inference_url` | Base URL for an OpenAI-compatible local inference endpoint. The model registry calls `/models` when the URL ends with `/v1`, otherwise `/v1/models`. |
| `agent_idle_offload_seconds` | Seconds an agent may remain disconnected and inactive before the runtime disposes the Pi session. Defaults to `300`. |

## Secrets

`config/api_keys.example.json` documents the expected secret keys. Operators provide real secrets in `config/api_keys.json` when needed:

```json
{
  "openai_api_key": "...",
  "local_inference_api_key": "..."
}
```

The real `config/api_keys.json` may be absent. Missing local inference configuration makes local models unavailable instead of crashing the service. Missing OpenAI bootstrap keys only means the OpenAI provider depends on persisted service-local auth.

## Pi Auth And Model Files

Sheaf Chat creates Pi agent state under:

```text
data/sheaf-chat/pi-agent/
  auth.json
  models.json
```

OpenAI OAuth/subscription material belongs under:

```text
data/sheaf-chat/auth/openai/
```

The auth path guard rejects global Pi paths containing `/.pi/`.

## Session Data Layout

Runtime session data is stored under:

```text
data/sheaf-chat/
  auth/
    openai/
  pi-agent/
    auth.json
    models.json
  sessions/
    piles/
      <pile>/
        <sessionId>.jsonl
        <sessionId>.sheaf-history.jsonl
        <sessionId>.provisional.json
        <sessionId>.manifest.json
```

File roles:

| File | Role |
|------|------|
| `<sessionId>.jsonl` | Pi session file passed to Pi's `SessionManager.open(...)`. |
| `<sessionId>.sheaf-history.jsonl` | Sheaf Chat envelope history used for replay, lazy loading, and REST history fallback. |
| `<sessionId>.provisional.json` | Root directory and model for a blank session whose manifest has not been created yet. |
| `<sessionId>.manifest.json` | Persisted session metadata written after the first assistant message completes. |

## Piles And Session IDs

Pile names and session ids must be safe single path segments. Validation rejects empty names, `.`, `..`, slashes, backslashes, non-NFC strings, and names that do not match the safe-stem pattern.

The pile name pattern is:

```text
^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$
```

Session ids use the same safe path-segment rules. Server-generated ids are UUIDs with hyphens removed.

## Provisional Sessions

`POST /api/piles/:pile/sessions` allocates a blank session shell. It writes:

- an empty Pi session JSONL file;
- an empty Sheaf Chat history JSONL file;
- a provisional JSON record containing the absolute root directory, selected model, and creation time.

It does not write a manifest.

## Manifests

The initial manifest is written only after the first assistant message completes. The chat name and description are generated from the first user message by the summarizer. The default summarizer uses a deterministic first-line fallback truncated to 80 characters.

Manifest shape:

```json
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
  "model": {
    "provider": "local",
    "id": "qwen3-coder"
  },
  "pi": {
    "sessionFile": "data/sheaf-chat/sessions/piles/default/0123456789abcdef.jsonl",
    "extensionVersion": "0.1.0"
  },
  "history": {
    "messageCount": 0,
    "lastSequence": 12
  }
}
```

`rootDirectory` is stored as an absolute path when possible. On resume, the manifest root is authoritative for scoped tools. When WebSocket `session.updated` frames send manifest data to browsers, root paths are relativized to the repository root when possible.

## History Log

The companion `*.sheaf-history.jsonl` file stores one JSON object per line:

```json
{
  "sequence": 12,
  "envelope": {
    "v": 1,
    "kind": "agui.event",
    "id": "frame-id",
    "pile": "default",
    "sessionId": "0123456789abcdef",
    "sequence": 12,
    "timestamp": "2026-06-08T00:00:00.000Z",
    "payload": {}
  }
}
```

Sequence allocation is serialized per session. Appending an envelope also updates `manifest.history.lastSequence` when the manifest exists.

History reads support:

- latest page when no cursor is provided;
- older page with `before`;
- newer page with `after`;
- page limits defaulting to `50` and capped at `200`.

## Model Registry

The model registry combines:

- OpenAI models from Pi's model registry when OpenAI auth is configured for the service-local auth storage.
- Local inference models fetched from the configured endpoint.

The local provider is named `local`. If the local endpoint is unavailable or returns no models, the registry still exposes a placeholder `local-default` model with `available: false` and an `unavailableReason`.
