## Why

The archived change `2026-06-14-sheaf-chat-repo-workspaces` replaced Sheaf Chat's *pile → session* model with a *repository → workspace → chat* model. Its requirement deltas were synced into the live specs (pile requirements `ps-1..ps-9` removed, workspace-chat `ps-10..ps-12` added) and the code fully dropped piles — the REST surface is now `/api/repositories/:repoId/workspaces/:workspaceId/chats/...`, the WebSocket connects with `repo`/`workspace`/`chat` query params, and tests assert `/api/piles` returns `not_found` and that envelopes contain no `pile` field. But OpenSpec deltas only touch Requirement blocks, so the surrounding **prose** (capability titles, Purpose, Contracts, Design, Interactions, error catalogues, cross-reference links) was never regenerated and still describes piles. Several live specs now contradict both the code and their own requirements.

## What Changes

- **Rename the `sheaf-chat-piles-sessions` capability to `sheaf-chat-workspace-chats`** so the spec id/title match its actual content (requirements `ps-10..ps-12` describe workspace chats, not piles). Carry the requirements across and update every inbound cross-reference link in the other sheaf-chat specs.
- **Rewrite stale pile prose to match the implemented contracts** across the live specs:
  - `sheaf-chat-workspace-chats` (renamed): drop the "Piles And Sessions" title/Purpose and the removed `POST /api/piles` and `POST /api/piles/:pile/sessions` contracts; document the real `GET/POST .../chats` and `GET .../chats/:chatId` routes and their error catalogue.
  - `sheaf-chat-chat-protocol`: fix the Connect-URL contract (`/ws/chat?p=<pile>&session=<sessionId>` → `/ws/chat?repo=<repoId>&workspace=<workspaceId>&chat=<chatId>`) and the error catalogue (`pile query parameter is required` → `repo`/`workspace`/`chat query parameter is required`; `frame pile/sessionId does not match connection` → `frame repoId/workspaceId/chatId does not match connection`).
  - `sheaf-chat-session-history`: fix the `GET /api/piles/:pile/sessions/:sessionId/history` route to `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/history` and the `pile\0sessionId` history-cache key prose.
  - `sheaf-chat-file-browser`: fix the `GET /api/piles/:pile/sessions/:sessionId/file` and `.../files` routes to their workspace/chat-scoped equivalents and the `"pile": "default"` example payload.
  - `sheaf-chat-chat-ui`, `sheaf-chat-models`, `sheaf-chat-service`: replace "piles, sessions" wording and `piles-sessions` cross-reference links with workspace/chat wording and the renamed capability link.
- **Preserve the deliberate negative assertions** that the migrated model excludes piles — these are real, test-backed requirements, not drift, and must NOT be deleted:
  - `sheaf-chat-chat-protocol` chat-26 ("…`repoId`, `workspaceId`, `chatId` instead of `pile` and `sessionId`" / "does not include `pile` or `sessionId`").
  - `sheaf-chat-agent-runtime` ("SHALL not use pile names as part of runtime identity").
- **Clean adjacent non-spec docs** that specs link to or that pin requirements: `projects/sheaf-chat/docs/contracts/session-files.md` (referenced from the chat-protocol error catalogue), `docs/coverage.md`, `docs/architecture.md`, and `docs/README.md`.

This is a spec/documentation-correctness change: it brings the specs back in line with the already-shipped code and the already-migrated requirements. No code or runtime behavior changes.

## Capabilities

### New Capabilities
<!-- None: this is drift remediation, not new behavior. -->

### Modified Capabilities

- `sheaf-chat-piles-sessions` → `sheaf-chat-workspace-chats`: rename the capability; requirements `ps-10..ps-12` are unchanged in meaning but re-homed under the new name, and the stale pile contract prose is replaced with the implemented `.../chats` REST contract.
- `sheaf-chat-chat-protocol`: correct the Connect-URL and error-catalogue prose to the implemented `repo`/`workspace`/`chat` WebSocket identity (no normative requirement text changes).
- `sheaf-chat-session-history`: correct the history route and cache-key prose to workspace/chat identity (no normative requirement text changes).
- `sheaf-chat-file-browser`: correct the file/files routes and example payload to workspace/chat identity (no normative requirement text changes).
- `sheaf-chat-chat-ui`: correct screen-description prose and cross-reference links to workspace/chat and the renamed capability (no normative requirement text changes).
- `sheaf-chat-models`: correct the cross-reference link to the renamed capability (no normative requirement text changes).
- `sheaf-chat-service`: correct the capability-list cross-reference link to the renamed capability (no normative requirement text changes).

## Impact

- **Specs (`openspec/specs/`)**: rename `sheaf-chat-piles-sessions/` → `sheaf-chat-workspace-chats/`; edit prose/contracts/links in `sheaf-chat-chat-protocol`, `sheaf-chat-session-history`, `sheaf-chat-file-browser`, `sheaf-chat-chat-ui`, `sheaf-chat-models`, `sheaf-chat-service`. The OpenSpec spec registry/index that lists capability names is updated for the rename.
- **Docs (`projects/sheaf-chat/docs/`)**: `contracts/session-files.md`, `coverage.md`, `architecture.md`, `README.md` — remove residual pile references so spec-linked docs and the coverage audit stay consistent.
- **No code changes**: the implementation already reflects the workspace/chat model; this change only stops the specs from contradicting it.
- **No tests change**: existing tests already pin the workspace/chat behavior and the absence of `pile`.
