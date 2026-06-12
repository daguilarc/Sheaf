# Contract: Session Files

Shared by [piles-sessions](../../../../openspec/specs/sheaf-chat-piles-sessions/spec.md) (creates the
files), [session-history](../../../../openspec/specs/sheaf-chat-session-history/spec.md) (appends and
pages the envelope log), [chat-protocol](../../../../openspec/specs/sheaf-chat-chat-protocol/spec.md)
(wire envelopes are the persisted envelopes),
[agent-runtime](../../../../openspec/specs/sheaf-chat-agent-runtime/spec.md) (bootstraps from
provisional/manifest and writes the manifest), and
[file-browser](../../../../openspec/specs/sheaf-chat-file-browser/spec.md) (resolves the session root
for read-only file access). Code:
`src/storage/paths.ts`, `src/storage/validation.ts`,
`src/shared/validation.ts`, `src/shared/envelope.ts`,
`src/shared/types.ts`.

## Directory layout

All runtime state is under `data/sheaf-chat/` relative to the repository
root:

```text
data/sheaf-chat/
  pi-agent/                 # service-local Pi agent state (models capability)
    auth.json
    models.json
  auth/
    openai/                 # reserved for OpenAI OAuth material
  sessions/
    piles/
      <pile>/
        <sessionId>.jsonl                 # Pi session file
        <sessionId>.sheaf-history.jsonl   # Sheaf envelope history log
        <sessionId>.provisional.json      # pre-manifest session record
        <sessionId>.manifest.json         # session manifest (deferred)
```

A session exists when `<sessionId>.jsonl` exists; it is *established* (shows
in listings) when `<sessionId>.manifest.json` exists.

## Name validation

Pile names and session ids must be safe single path segments
(`src/shared/validation.ts`):

```text
pile name:  ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$
session id: ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$
```

Additionally rejected for both: empty strings, `.` and `..`, anything
containing `/` or `\`, and strings that are not Unicode-NFC-normalized
(error code `invalid_name`). Pattern failures use error codes `invalid_pile`
/ `invalid_session_id` with messages
`pile name must be a safe single path segment` /
`session id must be a safe single path segment`. Server-generated session
ids are UUIDs with hyphens removed (32 hex chars).

Resolved pile paths are additionally asserted to stay under the piles root
(`AssertPathWithinRoot`, error code `path_escape`, message
`path escapes the storage root`).

## Chat envelope

Every WebSocket frame (both directions) and every persisted history entry
payload is a chat envelope:

```json
{
  "v": 1,
  "kind": "agui.event",
  "id": "5e0f0b8c-…",
  "pile": "default",
  "sessionId": "0123456789abcdef0123456789abcdef",
  "clientId": "browser-client-id",
  "sequence": 12,
  "timestamp": "2026-06-10T00:00:00.000Z",
  "payload": {}
}
```

- `v` is always `1`.
- `kind`, `id`, `pile`, `sessionId`, `timestamp` are required non-empty
  strings; `clientId`, `sequence`, `payload` are optional.
- Server-created envelopes get a random UUID `id` and current ISO timestamp
  unless supplied.
- Only the server assigns `sequence`; persisted envelopes carry strictly
  increasing per-session sequences starting at 1. Client frames must not set
  one (a numeric `sequence` is accepted but ignored on input).

## `<sessionId>.jsonl` — Pi session file

Opaque to Sheaf Chat: created empty at session allocation and thereafter
owned by Pi's `SessionManager.open(sessionFilePath, pileDirectory,
rootDirectory)`. Sheaf Chat never parses it; its existence gates WebSocket
connects.

## `<sessionId>.sheaf-history.jsonl` — envelope history log

One JSON object per line:

```json
{"sequence": 12, "envelope": { "v": 1, "kind": "agui.event", "...": "..." }}
```

Append-only. Lines that are blank or fail to parse are skipped on read.
Entries are sorted by `sequence` on read, so physical order need not be
relied on. Sequence allocation and paging semantics:
[session-history](../../../../openspec/specs/sheaf-chat-session-history/spec.md).

## `<sessionId>.provisional.json` — provisional record

Written at session allocation, pretty-printed with trailing newline:

```json
{
  "rootDirectory": "/abs/path/to/root",
  "model": { "provider": "local", "id": "qwen3-coder" },
  "createdAt": "2026-06-10T00:00:00.000Z"
}
```

`rootDirectory` is absolute (relative request input is resolved against the
repository root). Read on cold resume only when no manifest exists;
`createdAt` is ignored on read. The file is not deleted when the manifest is
later written.

## `<sessionId>.manifest.json` — session manifest

Written (pretty-printed, trailing newline) after the first assistant message
completes; updated in place afterwards:

```json
{
  "schemaVersion": 1,
  "pile": "default",
  "sessionId": "0123456789abcdef0123456789abcdef",
  "chatName": "Inspect project",
  "description": "Inspect project",
  "rootDirectory": "/abs/path/to/root",
  "createdAt": "2026-06-10T00:00:00.000Z",
  "updatedAt": "2026-06-10T00:00:00.000Z",
  "lastOpenedAt": "2026-06-10T00:00:00.000Z",
  "model": { "provider": "local", "id": "qwen3-coder" },
  "pi": {
    "sessionFile": "data/sheaf-chat/sessions/piles/default/0123456789abcdef0123456789abcdef.jsonl",
    "extensionVersion": "0.1.0"
  },
  "history": { "messageCount": 0, "lastSequence": 12 }
}
```

Field meanings:

- `schemaVersion` — `1`.
- `chatName` / `description` — summarizer output from the first user message
  ([agent-runtime](../../../../openspec/specs/sheaf-chat-agent-runtime/spec.md)).
- `rootDirectory` — absolute session root; authoritative for scoped tools on
  resume. Relativized to the repository root only in wire payloads, never on
  disk.
- `createdAt`/`updatedAt`/`lastOpenedAt` — ISO timestamps; all three set to
  the write time on initial write; `updatedAt` refreshed on every update.
- `pi.sessionFile` — repo-relative path to the Pi session file.
- `pi.extensionVersion` — scoped-tools extension version (`0.1.0`).
- `history.lastSequence` — newest persisted envelope sequence; updated on
  every append once the manifest exists.
- `history.messageCount` — written as 0 at creation and never incremented by
  any current code path (known gap; see [coverage](../coverage.md)).

A manifest read whose `pile`/`sessionId` do not match the requested identity
fails with `invalid_manifest` (`manifest identity does not match request`);
unparseable JSON fails with `invalid_manifest` (`manifest is not valid
JSON`).
