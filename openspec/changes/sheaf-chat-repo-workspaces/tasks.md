## 1. Discovery And Storage

- [x] 1.1 Add repository/workspace discovery utilities that inspect only immediate child directories of `$HOME`, include a child only when it is itself the Git top-level root, parse `git worktree list --porcelain`, derive stable path-safe `repoId` and `workspaceId`, use branch names as workspace display names when available, and cache metadata under `data/sheaf-chat/repositories/`.
- [x] 1.2 Replace pile/session storage paths with repository/workspace/chat paths under `data/sheaf-chat/repositories/<repoId>/workspaces/<workspaceId>/chats/`.
- [x] 1.3 Rename storage/runtime public types from pile/session identity to repo/workspace/chat identity where touched by this change.
- [x] 1.4 Update manifest and provisional record shapes to include `repoId`, `workspaceId`, `chatId`, repository/workspace paths, root directory, model, timestamps, and history metadata.
- [x] 1.5 Add server-side workspace editor-state storage with validation for tabs, selected file, expanded directories, and viewport positions.
- [x] 1.6 Update sequence locks, latest-sequence caches, manifest reads/writes, and chat listing to key by repo/workspace/chat identity.
- [x] 1.7 Add storage and discovery tests for ids, direct-home-child repository discovery, exclusion of nested repositories, branch-preferred workspace display names, metadata caching, workspace listing, workspace editor state, chat shell allocation, manifest listing, missing ids, and no old-data migration path.

## 2. REST And WebSocket API

- [x] 2.1 Add REST routes for `GET /api/repositories` and `GET /api/repositories/:repoId/workspaces`.
- [x] 2.2 Add workspace editor-state REST routes for `GET` and `PUT` with server-side path validation and no cookie dependency.
- [x] 2.3 Replace pile/session REST routes with workspace chat routes for list, create, get manifest, history, file read, file list, and agent-review availability.
- [x] 2.4 Update REST error mapping and tests for unknown repository/workspace/chat ids, invalid model selection, missing manifests, invalid editor state, and removed pile routes.
- [x] 2.5 Update chat WebSocket URL construction, query parsing, validation, and connect params to use `repo`, `workspace`, and `chat`.
- [x] 2.6 Update client frame validation and envelope creation to require and compare `repoId`, `workspaceId`, and `chatId`.
- [x] 2.7 Update Agent Review WebSocket query parsing and bootstrap to use repo/workspace/chat identity.

## 3. Runtime And Protocol Internals

- [x] 3.1 Update lifecycle `SessionKey`/format helpers, agent manager runtime maps, startup locks, broadcaster registries, and persistence hubs to use repo/workspace/chat keys.
- [x] 3.2 Update cold resume, Pi session construction, scoped tools, local provider setup, and file-change broadcasts to use the selected workspace root.
- [x] 3.3 Ensure `AppendEnvelope` updates manifest `history.lastSequence` and `updatedAt` on every persisted envelope when a manifest exists.
- [x] 3.4 Update history paging and WebSocket replay to read workspace chat logs and preserve existing sequence/replay behavior.
- [x] 3.5 Update agent review Git availability and hunk filtering to resolve from the workspace chat root.

## 4. Browser UI

- [x] 4.1 Replace the piles screen with a repository picker backed by `GET /api/repositories`.
- [x] 4.2 Add a workspace picker backed by `GET /api/repositories/:repoId/workspaces`, including Back navigation.
- [x] 4.3 Update hash routing and navigation for repository, workspace editor, and selected chat routes.
- [x] 4.4 Move chat listing and chat creation into the editor chat pane for the selected workspace, including model selection for new chats.
- [x] 4.5 Update chat WebSocket, history, file API, and agent-review URLs in the browser to use repo/workspace/chat identity.
- [x] 4.6 Add server-side editor state loading and debounced saving for open file tabs, selected file, expanded explorer directories, and file viewport scroll positions.
- [x] 4.7 Ensure Sheaf Chat introduces no cookie reads or writes for workspace state.
- [x] 4.8 Update UI tests for route parsing, repository/workspace screens, chat list/create behavior, WebSocket URL construction, server-side editor-state restore, and invalid-state sanitization.

## 5. Docs And Verification

- [x] 5.1 Update Sheaf Chat architecture, operations, coverage, and session-file contract docs to describe repository/workspace/chat storage and the expected data-directory reset.
- [x] 5.2 Update OpenSpec references that still mention pile/session routes, manifest fields, or `data/sheaf-chat/sessions/piles`.
- [x] 5.3 Run `make -C projects/sheaf-chat test` and fix regressions.
- [x] 5.4 Run browser integration tests for the repository/workspace editor flow and verify the three-pane editor opens with the selected workspace root.
- [x] 5.5 Verify deleting `data/sheaf-chat`, opening the front door, selecting a repo, selecting main or a worktree, creating a chat, opening files on one browser/device, then reopening the same workspace from another browser/device and seeing restored file tabs and viewport state. Automated by `tests/integration/repoWorkspaceFlow.integration.test.ts`, which drives the full front-door flow against real repository/worktree discovery (a temporary `$HOME` fixture repo) and asserts cross-context tab and viewport restore. This caught and fixed a viewport-restore bug where `CaptureSelectedViewport` clobbered the restored scroll position during `ApplyEditorState`.

## 6. Identity resolution without rediscovery (performance)

- [x] 6.1 Make `ResolveRepository`/`ResolveWorkspace` resolve a known id from cached `repository.json`/`workspace.json` first, falling back to discovery only on a cache miss; keep full `$HOME` repository discovery in `ListRepositories` (used only by `GET /api/repositories`) and worktree discovery in `ListWorkspaces` (used only by `GET /api/repositories/:repoId/workspaces`).
- [x] 6.2 Make `CacheRepositoryMetadata`/`CacheWorkspaceMetadata` write only when the metadata content changed (compared ignoring the volatile `discoveredAt`); do not rewrite unchanged metadata on read/resolve.
- [x] 6.3 Confirm chat list/create, file browsing, history reads, and editor-state read/write resolve by id without scanning `$HOME` or running discovery (all go through `ResolveRepository`/`ResolveWorkspace`).
- [x] 6.4 Add/adjust tests: resolve-by-id performs no discovery and no metadata rewrite; picker endpoints still discover and refresh; unknown id after cache miss returns 404 `not_found` (`tests/storage/repositories.test.ts`).

## 7. First-message visibility

- [x] 7.1 Add a failing reproduction test for the missing first message (optimistic render + echo dedupe) in `tests/ui/chatScreen.test.ts`.
- [x] 7.2 Render submitted messages optimistically in the chat pane, keyed by the client `messageId`, and reconcile the later `chat.user_message`/agui echo to the same message (`AppendUserMessage` in `sheaf-chat.js`).
- [x] 7.3 Give a user message one stable id (the client `messageId`) across its persisted echo, agui representation, and history replay (verified by `tests/server/websocket/protocol.test.ts`; the mapper already preserves the client id end-to-end).
- [x] 7.4 Harden the connection bootstrap so the first message on a cold-starting chat is delivered live exactly once, with no envelope lost between catch-up replay and live subscription (subscribe-before-replay with per-client buffering + sequence dedupe in `sessionBroadcaster.ts`).
- [x] 7.5 Update the existing "chat send waits for server broadcast" test to the optimistic-echo behavior; add server-side coverage for bootstrap ordering and stable user-message id.

## 8. Chat open/close in the chat pane

- [x] 8.1 Merge the workspace and chat screens into one editor mount keyed by `repoId`+`workspaceId`, with a chat pane that swaps between `list` and `open` sub-states. Both layouts share `CreateChatPaneController`: `RenderWorkspaceEditorDesktop` and `RenderWorkspaceEditorTouch`. The old `RenderDesktopChatScreen`, `RenderTouchChatScreen`, `RenderChatScreen`, and `RenderWorkspaceScreen` were removed.
- [x] 8.2 Make the router treat a `chatId`-only change for the same workspace as a chat-pane update — no editor re-mount and no file/editor-state re-fetch (diffing in `Boot`/`OnRouteChange`).
- [x] 8.3 Add two-level back: top-level Back navigates to the workspace picker; a chat-pane Back returns to the chat list, re-rendering only the chat pane.
- [x] 8.4 Connect the chat socket on chat selection (list click or chat-bearing URL) and destroy it on close or when leaving the workspace; agent review tracks the active chat via `SetActiveChat`.
- [x] 8.5 Update UI/router tests for pane sub-state, `chatId`-only updates, two-level back, and connect-on-selection.

## 9. Verification (follow-up refinements)

- [x] 9.1 Run `make -C projects/sheaf-chat test` and fix regressions, including the updated chat-send and routing tests (181/181 passing).
- [x] 9.2 Confirm the message-visibility reproduction test and the repository/workspace browser integration test both pass.
- [x] 9.3 Manually verify: navigating repo → workspace → open/close chats performs no `$HOME` rescan (no per-request git storm) and no editor-state re-fetch; the first message of a brand-new chat appears immediately; chat-pane Back returns to the chat list without reloading the editor; top-left Back returns to the workspace picker. Verified by the user across desktop and mobile, including the workspace-scoped Agent Review tab and hunk/file navigation.
- [x] 9.4 Bring the touch/mobile layout into the same chat-pane ownership model (shared `CreateChatPaneController`); add CSS for the swappable chat-pane body/top/back; update mobile UI tests. Verified at a phone viewport: file pane primary, chat panel list↔conversation swap, two-level back, composer.

## 10. Agent Review: workspace-scoped, gated on unstaged hunks

- [x] 10.1 Add a workspace-root resolver (`AgentManager.resolveWorkspaceRootDirectory`) and make the Agent Review service resolve availability/state/commands from the selected workspace (worktree) root instead of a chat root; key review sessions by `repoId`+`workspaceId`.
- [x] 10.2 Add REST `GET /api/repositories/:repoId/workspaces/:workspaceId/agent-review` and accept `/ws/agent-review?repo&workspace&client` (no `chat`); update query parsing (`ParseAgentReviewWebSocketQuery`) and URL construction.
- [x] 10.3 In the workspace editor, load Agent Review for the workspace (not the active chat), and present the Agent Review tab only when the worktree has at least one unstaged hunk; removed the chat-scoped `SetActiveChat`/`activeChatId` review wiring.
- [x] 10.4 Update agent-review and UI tests for workspace scoping; verified live: clean main worktree → 0 hunks → no tab; linked worktree → 367 hunks → tab shown in the file pane with no chat open.
- [x] 10.5 Fix hunk/file navigation (arm-4): `Navigate` now updates the cached focus so the follow-up `Refresh` re-pins to the navigated hunk by id instead of restoring the previous one (navigation does not mutate the worktree, so the old hunk was still present and was being restored). Added a multi-file/multi-hunk WS test (`Agent Review WebSocket navigates between hunks and files`) that reproduced the regression; verified live (Next advances within a file, Next File advances to the next file).
