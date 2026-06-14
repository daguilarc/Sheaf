## Context

Sheaf Chat currently has a pile/session model across storage, REST routes, WebSocket identity, runtime keys, and the browser hash router. A session already has a `rootDirectory`, and the three-pane editor/file browser already uses that root to scope tools and file reads. The requested model makes the root explicit: users first choose a Git repository, then a Git workspace, then open or create chats scoped to that workspace.

The user explicitly accepts deleting `data/sheaf-chat` after the change, so the implementation does not need to read or upgrade existing pile data.

## Goals / Non-Goals

**Goals:**

- Replace piles with the hierarchy `repositories -> workspaces -> chats`.
- Discover Git repositories whose top-level directory is a direct child of the user's home directory from the backend.
- Discover a selected repository's main worktree and linked Git worktrees from the backend.
- Scope new chats to the selected workspace root with no free-form root directory input.
- Keep enough metadata to list chats for a workspace newest-first by last chat activity.
- Restore per-workspace editor state through the server: open file tabs, selected file, expanded explorer paths, and file viewport positions.
- Preserve the existing chat protocol behavior, history replay, scoped tools, file browser, model selection, and agent review mode under the new identity.

**Non-Goals:**

- Migrating existing pile/session data.
- Creating repositories or worktrees from Sheaf Chat.
- Listing repositories outside direct children of the user's home directory.
- Multi-user permissions or per-user editor state isolation.
- Reworking the shared AGUI renderer or Pi session file format beyond identity/root metadata changes.

## Decisions

### 1. Introduce repository and workspace discovery routes

Add a backend module, for example `src/server/repositories.ts`, and routes:

- `GET /api/repositories`
- `GET /api/repositories/:repoId/workspaces`

`/api/repositories` reads only the immediate child directories of the user's home directory and returns children that are themselves Git top-level worktree roots. For each `$HOME/<child>` candidate, the service can run `git -C <candidate> rev-parse --show-toplevel` and include it only when the canonical top-level path equals the canonical candidate path. It must not recursively walk deeper directories, so `$HOME/src/reporoot` is not discovered unless `$HOME/src` itself is the repository top level. Results include:

- `repoId`: a URL/storage-safe stable id derived from canonical repo path, such as base64url(SHA-256(canonical path)).
- `name`: display name from the repo directory basename.
- `path`: canonical absolute path.

`/api/repositories/:repoId/workspaces` resolves `repoId` through the current discovery index, runs `git worktree list --porcelain` from the repository, and returns the main workspace plus linked worktrees. Each workspace includes:

- `workspaceId`: base64url(SHA-256(canonical workspace path)).
- `repoId`.
- `kind`: `main` or `worktree`.
- `path`: canonical absolute workspace path.
- `displayName`: the Git branch name when available; for detached worktrees, fall back to the directory basename or short HEAD.
- optional `branch`, `head`, and `bare`/`detached` indicators when available.

Alternative considered: encode absolute paths directly in route segments. That is simpler, but it creates path escaping and URL length problems and exposes implementation detail to every client route.

### 2. Store chats under workspace ids, not path text

Replace the old pile-based data layout with a fresh repository/workspace/chat layout:

```text
data/sheaf-chat/
  repositories/
    <repoId>/
      repository.json
      workspaces/
        <workspaceId>/
          workspace.json
          chats/
            <chatId>.jsonl
            <chatId>.sheaf-history.jsonl
            <chatId>.provisional.json
            <chatId>.manifest.json
```

`repository.json` and `workspace.json` are cached metadata snapshots. They allow a workspace's chats to remain listable even if discovery changes ordering or a worktree temporarily disappears. On every repository/workspace listing and chat creation, canonical paths are refreshed.

Alternative considered: store chats by escaped path segments. That keeps storage readable but makes rename/move handling and path validation harder. Stable hash ids give short path-safe keys while manifests keep the readable paths.

### 3. Rename session identity to chat identity internally

Introduce a `ChatKey` with `{ repoId, workspaceId, chatId }` and move runtime/persistence registries from pile/session keys to chat keys. Keep file suffixes and Pi session files conceptually the same, but rename public types toward chat terminology:

- `SessionManifest` -> `ChatManifest` in the implementation surface touched by this change.
- `sessionId` -> `chatId` in REST, WebSocket, browser routes, and stored manifests.
- The opaque Pi session file can remain a `.jsonl` file; only Sheaf Chat's identity around it changes.

Alternative considered: keep `sessionId` internally and only rename the UI. That would reduce churn but leaves the pile/session abstraction in the core contracts and makes future work harder to reason about.

### 4. Keep the editor route workspace-first and chat-optional

Use hash routes similar to:

- `#/` and `#/repositories` -> repository picker
- `#/repositories/:repoId` -> workspace picker
- `#/repositories/:repoId/workspaces/:workspaceId` -> editor view with chat list open
- `#/repositories/:repoId/workspaces/:workspaceId/chats/:chatId` -> editor view with selected chat connected

The editor view always knows a workspace root. When no chat is selected, the chat pane shows the workspace chat list sorted newest-first and a plus button. The plus button posts to the workspace chat collection, then navigates to the returned chat route.

Alternative considered: keep a separate chat-list screen after workspace selection. That adds another navigation step and delays reaching the three-pane editor, which is the primary workspace surface.

### 5. Store per-workspace editor state server-side

Persist workspace editor state under the selected workspace metadata, for example:

```text
data/sheaf-chat/
  repositories/
    <repoId>/
      workspaces/
        <workspaceId>/
          editor-state.json
```

Expose it through workspace-scoped routes:

- `GET /api/repositories/:repoId/workspaces/:workspaceId/editor-state`
- `PUT /api/repositories/:repoId/workspaces/:workspaceId/editor-state`

The state body is a JSON object:

```json
{
  "tabs": ["README.md", "src/index.ts"],
  "selectedPath": "src/index.ts",
  "expandedDirectories": [".", "src"],
  "viewports": {
    "README.md": { "scrollTop": 320 },
    "src/index.ts": { "scrollTop": 0 }
  }
}
```

The server validates and normalizes every path as workspace-root-relative before storing it. The browser fetches state when the workspace editor opens, applies valid state, then writes debounced updates when tabs, selection, expanded explorer paths, or viewport positions change. The write policy is last-writer-wins; that is acceptable for a local single-user tool and keeps phone/desktop handoff simple.

No cookies should be introduced anywhere in Sheaf Chat. Existing localStorage usage for stable client id and global pane widths can remain unless implementation chooses to move those values later; the new workspace editor state must be server-side.

Alternative considered: use browser-local storage. That would be simpler, but it fails the cross-device continuation requirement.

### 6. Update recency on every persisted envelope

The chat list is sorted by `updatedAt`, which must represent last persisted chat activity, not just initial manifest write or model changes. `AppendEnvelope` should update the chat manifest's `history.lastSequence` and `updatedAt` whenever a manifest exists. Blank provisional chats still do not appear in listings until a manifest is written after first assistant completion.

Alternative considered: scan history logs to compute recency at list time. That avoids manifest updates but makes list operations more expensive and duplicates logic already in append.

### 7. Resolve by cached id; discover only at the pickers

`ResolveRepository`/`ResolveWorkspace` currently call `ListRepositories`/`ListWorkspaces`, which scan every child of `$HOME` (a `git rev-parse` subprocess per child) and rewrite every `repository.json`/`workspace.json` — and they are invoked on chat listing, chat creation, file browsing, history reads, and every debounced editor-state save. That re-derives "what repos exist" from scratch on nearly every request.

Decision: `ResolveRepository`/`ResolveWorkspace` SHALL read the cached `repository.json`/`workspace.json` by id (the existing `ReadRepositoryMetadata`/`ReadWorkspaceMetadata`) and only fall back to discovery on a cache miss. `ListRepositories` (full `$HOME` scan) runs only for `GET /api/repositories`; `ListWorkspaces` (git worktree list) only for `GET /api/repositories/:repoId/workspaces`. `CacheRepositoryMetadata`/`CacheWorkspaceMetadata` write only when the content actually changes. The cached snapshots are already the source of truth for addressability; this just stops re-running discovery to reach them.

Alternative considered: a TTL/in-memory discovery cache. Useful later, but the by-id cached read removes the hot-path cost without added invalidation logic.

### 8. First-message visibility: optimistic echo + stable id + bootstrap ordering

Three orthogonal layers, applied together. (a) **Optimistic local echo**: the chat pane renders a submitted message immediately, keyed by the client `messageId`, so visibility never depends on a server round-trip. (b) **Stable user-message id**: the persisted `chat.user_message` echo, its agui representation, and history replay all use the client `messageId`, so the optimistic render, live echo, and replay reconcile to one message instead of duplicating (today the pi mapper assigns the user turn a different id than the client echo). (c) **Bootstrap ordering**: the connection subscribes to the live broadcaster before/consistently with its catch-up replay window so no envelope — in particular the first user message during a cold start — falls into the gap between replay and live subscription. (b) is the glue that keeps (a) duplicate-free against history.

Alternative considered: optimistic echo alone. It fixes the visible symptom but can duplicate the message after a reload/history page unless ids are unified, and leaves the underlying server delivery gap in place.

### 9. Chat open/close is chat-pane state, mirrored by the URL

The workspace editor is a single mounted view keyed by `repoId`+`workspaceId`. The chat pane owns a `list ↔ open` sub-state; opening/closing a chat swaps only the chat pane and never re-mounts the editor or re-fetches file/editor state. The `chatId` URL segment mirrors the pane (deep-link + refresh-restore), and the router treats a `chatId`-only change for the same workspace as a pane update, not a screen teardown. Top-level Back goes to the workspace picker; a chat-pane Back returns to the chat list. This removes the full-editor teardown (and its re-fetch storm) that today happens on every chat open/close.

Alternative considered: drop `chatId` from the URL entirely (purely pane-local). Simpler, but loses deep-linking and refresh-restore of the open chat; the URL-mirror keeps both while still making the pane the owner.

## Risks / Trade-offs

- Repository discovery intentionally only checks direct children of `$HOME` -> nested repositories are invisible by design, matching the requested `/Users/name/reporoot` layout and avoiding expensive recursive scans.
- `repoId` and `workspaceId` are path-derived, so moving a repo changes identity -> acceptable for a local tool; manifests retain paths, and no migration is required for this change.
- Git worktree parsing can vary by Git version -> use `git worktree list --porcelain`, parse conservatively, and include unit tests for main, linked, detached, and missing worktree cases.
- Server-side editor state can become stale after files move or are deleted -> validate paths on save, ignore missing paths on restore, and let users close stale tabs.
- The rename from session to chat touches many files -> do it in slices: discovery/storage first, REST/WebSocket/runtime second, UI third, docs/tests last.

## Migration Plan

No data migration is required. Before or after landing, delete `data/sheaf-chat` to remove pile-based state. Rollback is code rollback plus deleting any new `data/sheaf-chat/repositories` data written by the changed version.

## Open Questions

- Should hidden direct children of `$HOME` be considered if they are Git top-level roots?
