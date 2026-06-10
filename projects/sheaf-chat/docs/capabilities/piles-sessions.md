# Capability: Piles And Sessions

ID prefix: `ps`

## Purpose

The REST surface for organizing chat sessions: list and create piles, create
blank session shells inside a pile, and read session manifests. A pile is a
storage directory; a session shell is the minimum on-disk state needed to
open a WebSocket and start chatting.

## Requirements

- **[ps-1]** WHEN it receives `GET /api/piles`, THE service SHALL respond 200
  with `{"piles": [...]}` sorted by pile name; each summary counts
  `*.manifest.json` files as `sessionCount` and reports the newest manifest
  file mtime as `latestUpdatedAt` (ISO string, or `null` when none). The
  piles root is created on demand, so a fresh checkout returns
  `{"piles": []}`.
- **[ps-2]** WHEN it receives `POST /api/piles` with `{"pile": "<name>"}`,
  THE service SHALL create the pile directory (idempotently) and respond 201
  with `{"pile": "<name>", "sessionCount": 0, "latestUpdatedAt": null}`.
- **[ps-3]** IF the create-pile body is not an object or `pile` is not a
  non-empty string, THEN THE service SHALL respond 400 `invalid_request`; IF
  the name fails validation, THEN 400 `invalid_pile` (or `invalid_name` for
  non-NFC input) — patterns in
  [session files](../contracts/session-files.md).
- **[ps-4]** WHEN it receives `GET /api/piles/:pile/sessions`, THE service
  SHALL respond 200 with `{"sessions": [<manifest>...]}` sorted newest-first
  by `updatedAt`. Only sessions with a manifest appear; entries whose
  manifest is unreadable, invalid, or has an invalid session-id stem are
  silently skipped. Message history is never included.
- **[ps-5]** WHEN it receives `POST /api/piles/:pile/sessions` with valid
  `rootDirectory` and `model`, THE service SHALL allocate a blank session
  shell — an empty Pi session file, an empty history log, and a provisional
  record — and respond 201 with the session id, the provisional session
  (root relativized to the repository root when inside it), and the
  WebSocket URL (see Contracts). It SHALL NOT write a manifest.
- **[ps-6]** THE service SHALL resolve a relative `rootDirectory` against the
  repository root, store it absolute, and generate the session id as a UUID
  with hyphens removed.
- **[ps-7]** IF `rootDirectory` is missing/empty or `model.provider` /
  `model.id` are missing/empty, THEN THE service SHALL respond 400
  `invalid_request`; IF the resolved root does not exist or is not a
  directory, THEN 400 `invalid_root_directory`; IF the model is unknown,
  THEN 404 `model_not_found`; IF the model is known but unavailable, THEN
  400 `model_unavailable` (see [models](models.md)).
- **[ps-8]** IF the pile of any `/api/piles/:pile/...` route does not exist
  as a directory, THEN THE service SHALL respond 404 `pile_not_found` with
  message `pile not found: <pile>`.
- **[ps-9]** WHEN it receives `GET /api/piles/:pile/sessions/:sessionId`,
  THE service SHALL respond 200 with `{"manifest": <manifest>}`; IF no
  manifest exists for the session (including blank shells), THEN 404
  `manifest_not_found` with message
  `manifest not found for session <sessionId>`.

## Contracts

Manifest, provisional, and validation shapes:
[session files](../contracts/session-files.md).

### `POST /api/piles`

Request `{"pile": "default"}` → 201:

```json
{ "pile": "default", "sessionCount": 0, "latestUpdatedAt": null }
```

### `POST /api/piles/:pile/sessions`

Request:

```json
{
  "rootDirectory": "projects",
  "model": { "provider": "local", "id": "qwen3-coder" }
}
```

Response — 201:

```json
{
  "sessionId": "0123456789abcdef0123456789abcdef",
  "provisionalSession": {
    "rootDirectory": "projects",
    "model": { "provider": "local", "id": "qwen3-coder" }
  },
  "webSocketUrl": "/ws/chat?p=default&session=0123456789abcdef0123456789abcdef"
}
```

`provisionalSession.rootDirectory` is repo-relative (`.` for the repo root
itself, `<outside-root>` if the stored absolute root is outside the
repository).

### Error catalogue

| Condition | Status / code | Message (exact) |
|---|---|---|
| Body not a JSON object | 400 `invalid_request` | `request body must be a JSON object` |
| `pile` missing/empty | 400 `invalid_request` | `pile name is required` |
| Pile name fails pattern | 400 `invalid_pile` | `pile name must be a safe single path segment` |
| Name not NFC-normalized | 400 `invalid_name` | `<label> must use Unicode NFC normalization` |
| `rootDirectory` missing/empty | 400 `invalid_request` | `rootDirectory is required` |
| `model` not an object | 400 `invalid_request` | `model must be an object` |
| `model.provider` / `model.id` missing | 400 `invalid_request` | `model.provider is required` / `model.id is required` |
| Root missing | 400 `invalid_root_directory` | `root directory does not exist: <input>` |
| Root not a directory | 400 `invalid_root_directory` | `root directory is not a directory: <input>` |
| Unknown model | 404 `model_not_found` | `model not found: <provider>/<id>` |
| Model unavailable | 400 `model_unavailable` | `model unavailable: <reason>` |
| Pile missing | 404 `pile_not_found` | `pile not found: <pile>` |
| Manifest missing | 404 `manifest_not_found` | `manifest not found for session <sessionId>` |

## Design

- `src/server/routes/piles.ts`, `src/server/routes/sessions.ts` — request
  parsing and response shaping; `RelativizeAbsolutePath` (from the AGUI
  sanitizer) produces the repo-relative root in responses.
- `src/storage/piles.ts` — `CreatePile` (mkdir recursive + containment
  assert), `ListPiles` (skips non-directories and invalid names),
  `EnsurePileExists`.
- `src/storage/manifests.ts` — `ReadManifest` (identity check),
  `ListSessionManifests`.
- `src/storage/sessionLog.ts` — `AllocateSessionShell` writes the three
  shell files; `AgentManager.createBlankSession`
  (`src/agents/manager.ts`) validates pile/root/model first, so no files are
  written on validation failure.
- `BuildChatWebSocketUrl` (`src/server/websockets.ts`) builds the returned
  URL with `p` and `session` query parameters.

## Interactions

- [session files](../contracts/session-files.md) — formats of everything
  written here.
- [models](models.md) — model validation at session creation.
- [chat-protocol](chat-protocol.md) — consumes the returned `webSocketUrl`;
  connects only to sessions whose Pi session file exists.
- [agent-runtime](agent-runtime.md) — writes the manifest these listings
  depend on.
- [chat-ui](chat-ui.md) — the piles/sessions screens drive this API.
