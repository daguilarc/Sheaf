# Physical Plan Accepted: File Server

All five slice physical plans were reviewed against `specs/file_server.md` and the
current `projects/sheaf-chat` / `projects/web` codebase. No open issues remain in
`physicalplan_issues.md`. The physical plan is accepted for implementation.

## Slices reviewed

1. **0001_server_file_browser_api** — Read-only REST file `get` + directory listing
   under the chat root, with root-escape protections and reusable server helpers.
2. **0002_edit_change_broadcasts** — `file.changed` websocket broadcast after a
   successful controlled `edit`, matched to overlapping/same connection roots.
3. **0003_markdown_katex_file_links** — Markdown-it/KaTeX rendering pipeline for chat
   and files, plus safe file-link resolution into the tab system.
4. **0004_desktop_file_workspace** — Three-pane desktop workspace: explorer, tabbed
   file viewer, chat pane; collapse/resize; stale-tab refetch behavior; link routing.
5. **0005_mobile_panels_completion** — iOS pullable explorer/tabs/chat panels reusing
   the slice-4 state, plus completion/cleanup and acceptance coverage.

## Why accepted

- **Spec alignment** — every spec section (chat root model, file/dir APIs, edit
  notification, broadcast semantics, desktop layout, iOS layout, stale-content
  behavior, Markdown/LaTeX rendering, file-link navigation) maps to exactly one slice;
  all acceptance criteria are covered.
- **Dependency ordering is explicit and correct** — Slice 2 reuses Slice 1's session
  root-resolution helper; Slice 4 reuses Slice 1 endpoints, Slice 2 envelopes, and
  Slice 3 `window.SheafMarkdown`; Slice 5 reuses all Slice 4 workspace state. Slices
  execute sequentially with no backward dependency.
- **API references are real** — verified against the codebase: `RootPolicy`
  (`CreateRootPolicy`/`ResolveInputPath`/`AssertWithinRoot`/`ToRootRelativePath`),
  `ReadManifest`, `AgentManager`, `StorageError`/`SendJson`/`SendRestError`,
  `x_treeDefaultIgnores`, `ScopedToolContext`, `CreateChatEnvelope`,
  `SessionBroadcasterRegistry`, `AttachChatWebSocketConnection`, the `x_*Kind` envelope
  convention, `ChatView`/`UpdateAssistantContent` (`projects/web/src/agui-chat.js`),
  `FetchJson`/`RenderChatScreen`/`IsTouchLayout` and `sheaf-chat-touch`/
  `sheaf-chat-desktop` toggles. Slice 3's "ad hoc chat Markdown formatter" is the
  `FormatMarkdown` call in `UpdateAssistantContent` (agui-chat.js:1100); Slice 2's
  notification hook lands precisely after the successful `writeFile` in `edit.ts:173`.
- **Granularity** — five cohesive, independently testable slices; not over-sliced, not
  too coarse. Each has a clear objective, expected outcome, and validation section.
- **Refactors scoped** — each slice limits itself to a small enabling refactor (root
  policy/file-classification extraction, path-within-root utility, RenderChatScreen
  helper extraction) without introducing a frontend framework or build system.
- **Cleanup captured** — Slice 5 removes obsolete fallback UI paths, retires temporary
  branches except the intentional Markdown-renderer-unavailable fallback, and updates
  docs.

## Risks noted (non-blocking)

- Slices 3 and 4 both touch `src/ui/sheaf-chat.js`; Slice 4's `RenderChatScreen`
  restructure may churn over Slice 3's rendering edits. Both plans scope their changes
  to distinct concerns, keeping churn minor.
- Directory browsing is lazy per-directory rather than a single recursive tree dump.
  This is a reasonable, arguably better interpretation of the spec's "render a tree"
  requirement and matches the Slice 4 explorer's lazy-expand design.
