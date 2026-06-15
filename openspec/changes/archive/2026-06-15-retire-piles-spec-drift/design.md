## Context

Sheaf Chat migrated from a *pile → session* model to a *repository → workspace → chat* model in the archived change `2026-06-14-sheaf-chat-repo-workspaces`. The migration shipped in code (REST under `/api/repositories/:repoId/workspaces/:workspaceId/chats/...`, WebSocket query params `repo`/`workspace`/`chat`, tests asserting `/api/piles` → `not_found` and `"pile" in envelope === false`).

OpenSpec's `archive` command merges only **requirement** deltas (`### Requirement:` blocks) into the live specs; it does not regenerate the surrounding prose (titles, Purpose, `## Contracts`, `## Design`, `## Interactions`, error catalogues, cross-reference links). So when repo-workspaces was archived, its requirement deltas landed (pile requirements `ps-1..ps-9` removed, workspace-chat `ps-10..ps-12` added) but the prose was never updated. The result: live specs whose prose still describes piles while their requirements and the code describe workspace chats — `sheaf-chat-piles-sessions` is even still titled "Piles And Sessions" and documents removed `/api/piles` routes.

This change is drift remediation only: it realigns the specs (and spec-linked docs) with the already-shipped behavior. No code or runtime behavior changes.

## Goals / Non-Goals

**Goals:**
- Rename the `sheaf-chat-piles-sessions` capability to `sheaf-chat-workspace-chats` so its id/title match its requirements.
- Replace every stale pile prose reference (routes, WebSocket URL, error catalogue, example payloads, cross-reference links, screen descriptions) with the contract the code actually implements.
- Clean spec-linked `projects/sheaf-chat/docs/` files that still mention piles.
- Leave the specs internally consistent and matching the code, so a future archive of this change is a no-op for prose (nothing left to drift).

**Non-Goals:**
- No code, route, test, or runtime behavior changes — the implementation is already correct.
- No change to the *meaning* of any requirement; `ps-10..ps-12` are carried over verbatim as `wc-1..wc-3`.
- Not removing the deliberate, test-backed negative assertions that the new model excludes `pile`/`sessionId` (these are correct requirements, not drift).
- Not touching quest directories or unrelated capabilities.

## Decisions

### D1 — Rename the capability rather than fix prose in place
The capability directory/id `sheaf-chat-piles-sessions` is itself drift: its requirements are entirely about workspace chats. We rename to `sheaf-chat-workspace-chats`.
- *Why over keeping the id:* the legacy name keeps misleading every reader and every cross-reference; a one-time rename ends it. (User chose this over the lower-blast-radius "keep id, fix prose only" option.)
- *Mechanics:* OpenSpec has no capability-rename command, and `archive` only merges requirement deltas. So the rename is expressed two ways: (a) requirement deltas in this change — `REMOVED ps-10..ps-12` from `sheaf-chat-piles-sessions` and `ADDED wc-1..wc-3` to `sheaf-chat-workspace-chats`, which archive can apply; and (b) the live-spec directory move + title/prose/link edits, done as direct file edits at apply time (see D3).

### D2 — New `wc-` prefix, not carried `ps-` IDs
The carried requirements get a fresh `wc-1..wc-3` prefix matching the new capability name, with each REMOVED `ps-*` block documenting its `wc-*` successor in its Migration line.
- *Why over keeping `ps-10..ps-12`:* the `ps` prefix stands for "piles-sessions"; carrying it into a `workspace-chats` spec would re-introduce the same naming drift we are removing. The retired `ps-*` IDs are not reused.
- *Append-only rule:* preserved — `ps-1..ps-9` were already retired by the prior change and `ps-10..ps-12` are now retired here; no ID is renumbered or reused.

### D3 — Prose, links, and docs are direct edits, not deltas
Most of the drift lives in non-requirement prose, which OpenSpec deltas cannot express and `archive` does not regenerate. These fixes are therefore direct edits to the live spec/doc files, enumerated in `tasks.md`, applied during `/opsx:apply`:
- New `sheaf-chat-workspace-chats/spec.md`: header (`# Capability: Workspace Chats`, project, `ID prefix: wc`), Purpose, and a `## Contracts` section documenting the real `GET/POST .../chats` and `GET .../chats/:chatId` routes + error catalogue (replacing the removed `/api/piles*` contracts).
- `sheaf-chat-chat-protocol`: Connect-URL `/ws/chat?p=<pile>&session=<sessionId>...` → `/ws/chat?repo=<repoId>&workspace=<workspaceId>&chat=<chatId>...`; error catalogue `pile query parameter is required` → `repo`/`workspace`/`chat query parameter is required`, and `frame pile/sessionId does not match connection` → `frame repoId/workspaceId/chatId does not match connection`. Grounded in `projects/sheaf-chat/src/server/websocket.ts` and `websockets.ts`.
- `sheaf-chat-session-history`: route `GET /api/piles/:pile/sessions/:sessionId/history` → `.../repositories/:repoId/workspaces/:workspaceId/chats/:chatId/history`; cache-key prose `pile\0sessionId` → the workspace/chat key the code uses.
- `sheaf-chat-file-browser`: routes `.../piles/:pile/sessions/:sessionId/file` and `.../files` → workspace/chat-scoped equivalents; example `"pile": "default"` → the workspace/chat-scoped shape.
- `sheaf-chat-chat-ui`, `sheaf-chat-models`, `sheaf-chat-service`: "piles, sessions" wording and `../sheaf-chat-piles-sessions/spec.md` links → workspace/chat wording and `../sheaf-chat-workspace-chats/spec.md` links.
- `projects/sheaf-chat/docs/`: `contracts/session-files.md`, `coverage.md`, `architecture.md`, `README.md`.

### D4 — Preserve negative assertions about pile absence
`sheaf-chat-chat-protocol` chat-26 ("…`repoId`, `workspaceId`, `chatId` instead of `pile` and `sessionId`" / "does not include `pile` or `sessionId`") and `sheaf-chat-agent-runtime` ("SHALL not use pile names as part of runtime identity") are kept verbatim.
- *Why:* they are pinned by tests (`assert.equal("pile" in envelope, false)`) and express real guarantees of the migrated model. Their `pile` mentions are intentional contrast, not stale description.

### D5 — Ground every replacement in code, not the archived delta
Each corrected route, query param, and error string is taken from the current implementation (`src/server/router.ts`, `websocket.ts`, `websockets.ts`, `routes/*`), so the specs match what ships, not what an older proposal once intended.

## Risks / Trade-offs

- **[Renaming breaks dangling cross-reference links]** → Grep for `sheaf-chat-piles-sessions` across `openspec/specs/` and `projects/sheaf-chat/docs/` and update every link in the same change; verify with a final `grep -rn "piles-sessions"` returning nothing outside `openspec/changes/archive/`.
- **[New `wc-` IDs unmoor coverage/tests that referenced `ps-10..ps-12`]** → `ps-10..ps-12` are workspace-chat requirements added only by the prior change; check `projects/sheaf-chat/docs/coverage.md` and tests for `ps-1[0-2]` references and update them to `wc-1..wc-3`.
- **[Over-cleaning removes a legitimate negative assertion]** → D4 fixes the keep-list explicitly; reviewers verify chat-26 and the agent-runtime requirement are untouched and that the envelope-absence test still maps to a requirement.
- **[Residual pile references reappear from non-spec sources]** → scope includes spec-linked docs; quest dirs and `openspec/changes/archive/` are intentionally left as historical record.

## Migration Plan

This is a spec/doc edit; there is nothing to deploy or roll back at runtime.
1. Apply requirement deltas + direct edits via `/opsx:apply` (tasks.md order).
2. Move the live spec dir `openspec/specs/sheaf-chat-piles-sessions/` → `sheaf-chat-workspace-chats/` and rewrite its header/prose; update all inbound links and docs.
3. Verify: `openspec validate retire-piles-spec-drift`, `openspec spec list` shows `sheaf-chat-workspace-chats` (not `-piles-sessions`), and `grep -rniE "\bpiles?\b"` over `openspec/specs/` returns only the intentional D4 keep-list lines.
4. Rollback (if needed): revert the worktree branch; no data or service impact.

## Open Questions

- None. The rename target (`sheaf-chat-workspace-chats`) and the keep-list for intentional `pile` mentions are settled.
