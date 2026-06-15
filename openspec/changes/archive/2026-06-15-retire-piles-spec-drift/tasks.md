## 1. Rename the capability (sheaf-chat-piles-sessions → sheaf-chat-workspace-chats)

- [x] 1.1 `git mv openspec/specs/sheaf-chat-piles-sessions openspec/specs/sheaf-chat-workspace-chats`
- [x] 1.2 In the moved `spec.md`, rewrite the header: `# Capability: Workspace Chats`, keep `Project: \`projects/sheaf-chat\``, and set `ID prefix: \`wc\` — requirement IDs are append-only; never renumber or reuse.`
- [x] 1.3 Renumber the three requirements `ps-10/ps-11/ps-12` → `wc-1/wc-2/wc-3` (text unchanged), matching the delta in `changes/retire-piles-spec-drift/specs/sheaf-chat-workspace-chats/spec.md`
- [x] 1.4 Rewrite the `## Purpose` to describe workspace-scoped chats (list/create blank chat shells under a discovered workspace, read chat manifests) — remove all pile/session wording

## 2. Replace stale pile contracts in the renamed spec

- [x] 2.1 Delete the `### \`POST /api/piles\`` and `### \`POST /api/piles/:pile/sessions\`` contract blocks
- [x] 2.2 Add `## Contracts` blocks for the implemented routes: `GET /api/repositories/:repoId/workspaces/:workspaceId/chats`, `POST /api/repositories/:repoId/workspaces/:workspaceId/chats`, `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId` — grounded in `src/server/router.ts` and `src/server/routes/sessions.ts`
- [x] 2.3 Rewrite the `### Error catalogue` to the workspace/chat-scoped errors (e.g. `manifest_not_found`, unknown repo/workspace → 404 `not_found`); remove `invalid_pile`/`pile_not_found`/`pile name…` rows
- [x] 2.4 Update the `## Design` and `## Interactions` sections: module map (`src/storage/*`, `src/server/routes/sessions.ts`) and cross-links to `chat-ui`, `models`, `agent-runtime` — no pile/session wording

## 3. Fix chat-protocol prose (keep chat-26 verbatim)

- [x] 3.1 Connect URL: `/ws/chat?p=<pile>&session=<sessionId>&client=<clientId>&after=<sequence>` → `/ws/chat?repo=<repoId>&workspace=<workspaceId>&chat=<chatId>&client=<clientId>&after=<sequence>` (per `src/server/websockets.ts`)
- [x] 3.2 Error catalogue: `pile query parameter is required` / `session query parameter is required` → `repo query parameter is required` / `workspace query parameter is required` / `chat query parameter is required`; `invalid pile/session/\`after\`` → `invalid repo/workspace/chat/\`after\``; `frame pile/sessionId does not match connection` → `frame repoId/workspaceId/chatId does not match connection` (per `src/server/websocket.ts`)
- [x] 3.3 Verify Requirement `chat-26` and its scenarios (the "instead of `pile` and `sessionId`" / "does not include `pile` or `sessionId`" assertions) are left UNCHANGED

## 4. Fix session-history prose

- [x] 4.1 Route `GET /api/piles/:pile/sessions/:sessionId/history` → `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/history`
- [x] 4.2 History-cache-key prose `pile\0sessionId` → the workspace/chat key used in code (verify exact key in `src/storage/*` / history route)
- [x] 4.3 Update the `piles-sessions` cross-reference link → `workspace-chats`

## 5. Fix file-browser prose

- [x] 5.1 Routes `GET /api/piles/:pile/sessions/:sessionId/file` and `.../files` → workspace/chat-scoped equivalents from `src/server/router.ts` (chat-scoped `.../chats/:chatId/file|files` and/or workspace-scoped `.../workspaces/:workspaceId/file|files`)
- [x] 5.2 Example payload `"pile": "default"` → the workspace/chat-scoped response shape

## 6. Fix remaining cross-references (chat-ui, models, service)

- [x] 6.1 `sheaf-chat-chat-ui`: replace "piles, sessions, chat" screen wording with repository/workspace/chat wording and update `../sheaf-chat-piles-sessions/spec.md` links → `../sheaf-chat-workspace-chats/spec.md`
- [x] 6.2 `sheaf-chat-models`: update the `../sheaf-chat-piles-sessions/spec.md` link → `../sheaf-chat-workspace-chats/spec.md` and its surrounding wording
- [x] 6.3 `sheaf-chat-service`: update the capability-list link `../sheaf-chat-piles-sessions/spec.md` → `../sheaf-chat-workspace-chats/spec.md`
- [x] 6.4 Confirm `sheaf-chat-agent-runtime` ("SHALL not use pile names…") is left UNCHANGED (intentional negative assertion)

## 7. Clean spec-linked docs

- [x] 7.1 `projects/sheaf-chat/docs/contracts/session-files.md` — remove residual pile references (linked from chat-protocol error catalogue)
- [x] 7.2 `projects/sheaf-chat/docs/coverage.md` — update any `ps-1[0-2]` references to `wc-1..wc-3` and remove pile wording
- [x] 7.3 `projects/sheaf-chat/docs/architecture.md` and `docs/README.md` — remove residual pile references

## 8. Verify

- [x] 8.1 `openspec validate retire-piles-spec-drift` passes
- [x] 8.2 `openspec spec list` shows `sheaf-chat-workspace-chats` and no `sheaf-chat-piles-sessions`
- [x] 8.3 `grep -rniE "\bpiles?\b" openspec/specs/` returns only the intentional keep-list lines (chat-26 in chat-protocol; the agent-runtime negative assertion)
- [x] 8.4 `grep -rn "sheaf-chat-piles-sessions" openspec/specs projects/sheaf-chat/docs` returns nothing (only `openspec/changes/archive/` may still reference it)
- [x] 8.5 `grep -rniE "/api/piles" openspec/specs projects/sheaf-chat/docs` returns nothing
