# Contract: Chat Files

Shared by [repo-workspaces](../../../../openspec/specs/sheaf-chat-repo-workspaces/spec.md),
[workspace-chats](../../../../openspec/specs/sheaf-chat-workspace-chats/spec.md) (the workspace
chat REST contract),
[session-history](../../../../openspec/specs/sheaf-chat-session-history/spec.md),
[chat-protocol](../../../../openspec/specs/sheaf-chat-chat-protocol/spec.md),
[agent-runtime](../../../../openspec/specs/sheaf-chat-agent-runtime/spec.md), and
[file-browser](../../../../openspec/specs/sheaf-chat-file-browser/spec.md). Code:
`src/storage/paths.ts`, `src/storage/repositories.ts`,
`src/storage/validation.ts`, `src/shared/validation.ts`,
`src/shared/envelope.ts`, `src/shared/types.ts`.

## Directory Layout

All runtime state is under `data/sheaf-chat/` relative to the repository root:

```text
data/sheaf-chat/
  pi-agent/
    auth.json
    models.json
  auth/
    openai/
  repositories/
    <repoId>/
      repository.json
      workspaces/
        <workspaceId>/
          workspace.json
          editor-state.json
          chats/
            <chatId>.jsonl
            <chatId>.sheaf-history.jsonl
            <chatId>.provisional.json
            <chatId>.manifest.json
```

A chat shell exists when `<chatId>.jsonl` exists. It is established and shown
in workspace chat lists when `<chatId>.manifest.json` exists. Old
`data/sheaf-chat/sessions/...` data is not migrated; deleting
`data/sheaf-chat` is the reset path for this breaking change.

## Identity Validation

`repoId`, `workspaceId`, and `chatId` are generated, path-safe identity ids:

```text
^[A-Za-z0-9_-]{16,128}$
```

They also reject empty strings, `.` and `..`, `/`, `\`, and non-NFC input
(`invalid_name`). Pattern failures use `invalid_id`.

`repoId` and `workspaceId` are deterministic base64url SHA-256 values derived
from canonical absolute paths. `chatId` is a generated UUID with hyphens
removed.

## Chat Envelope

Every WebSocket frame and every persisted history entry payload is a chat
envelope:

```json
{
  "v": 1,
  "kind": "agui.event",
  "id": "5e0f0b8c-...",
  "repoId": "repo_123456789012",
  "workspaceId": "workspace_123456",
  "chatId": "0123456789abcdef0123456789abcdef",
  "clientId": "browser-client-id",
  "sequence": 12,
  "timestamp": "2026-06-10T00:00:00.000Z",
  "payload": {}
}
```

`v`, `kind`, `id`, `repoId`, `workspaceId`, `chatId`, and `timestamp` are
required. `clientId`, `sequence`, and `payload` are optional. Only the server
assigns persisted `sequence` values.

## Chat Files

`<chatId>.jsonl` is the opaque Pi session file. Sheaf Chat creates it empty
at chat-shell allocation and later passes it to Pi for resume.

`<chatId>.sheaf-history.jsonl` is append-only JSON Lines:

```json
{"sequence": 12, "envelope": { "v": 1, "kind": "agui.event" }}
```

Sequence allocation is serialized per `{repoId, workspaceId, chatId}`. Lines
that are blank or fail to parse are skipped on read.

`<chatId>.provisional.json` is written at shell allocation and records
`repoId`, `workspaceId`, `chatId`, `repositoryPath`, `workspacePath`,
`rootDirectory`, `model`, and `createdAt`. The root is always the selected
workspace canonical absolute path; clients do not choose chat roots.

`<chatId>.manifest.json` is written after the first assistant message
completes and is updated in place afterwards:

```json
{
  "schemaVersion": 1,
  "repoId": "repo_123456789012",
  "workspaceId": "workspace_123456",
  "chatId": "0123456789abcdef0123456789abcdef",
  "repositoryPath": "/Users/name/reporoot",
  "workspacePath": "/Users/name/reporoot",
  "chatName": "Inspect project",
  "description": "Inspect project",
  "rootDirectory": "/Users/name/reporoot",
  "createdAt": "2026-06-10T00:00:00.000Z",
  "updatedAt": "2026-06-10T00:00:00.000Z",
  "lastOpenedAt": "2026-06-10T00:00:00.000Z",
  "model": { "provider": "local", "id": "qwen3-coder" },
  "pi": {
    "sessionFile": "data/sheaf-chat/repositories/<repoId>/workspaces/<workspaceId>/chats/<chatId>.jsonl",
    "extensionVersion": "0.1.0"
  },
  "history": { "messageCount": 0, "lastSequence": 12 }
}
```

Manifest identity must match the requested repo/workspace/chat identity or
the read fails with `invalid_manifest`.

## Workspace Editor State

`editor-state.json` stores server-side file workspace state for a workspace:

```json
{
  "tabs": ["README.md"],
  "selectedPath": "README.md",
  "expandedDirectories": [".", "src"],
  "viewports": {
    "README.md": { "scrollTop": 120 }
  }
}
```

All stored paths are workspace-root-relative and are normalized/rejected by
the server before write. Escaping paths fail with `path_escape`.
