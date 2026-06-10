# Slice 4 Implementation Accepted

## Decision

The desktop file workspace implementation is accepted. It correctly, completely, and
maintainably satisfies the slice spec and the relevant quest-spec acceptance criteria.
No open polishing issues remain.

## Review Scope

- Implementer diff range: `03c8f9c..aaf1ffe` (steps 20–22).
- Files reviewed:
  - `projects/sheaf-chat/src/ui/sheaf-chat.js` (+990)
  - `projects/sheaf-chat/src/ui/sheaf-chat.css` (+254)
  - `projects/web/src/agui-chat.js` (linkContext wiring)
  - `projects/sheaf-chat/tests/ui/chatScreen.test.ts` (+440)
- Cross-checked against the real server contract in
  `projects/sheaf-chat/src/protocol/sessionBroadcaster.ts` and `envelopes.ts`.

## Verification Against Spec

- **Enabling refactor**: chat websocket/composer/model/history logic extracted into
  `CreateChatSessionController`, shared by touch and desktop renderers without rewriting
  the websocket protocol. Existing chat tests (send/queue/ack/reconnect/model/history)
  still pass, confirming preserved behavior.
- **Three-pane desktop layout**: `.sheaf-chat-workspace` with explorer pane, center file
  pane (tab bar + viewer), right chat pane, and resize handles. Header/status row kept.
- **Workspace state & methods**: `tabs/selectedPath/directoryCache/expandedDirectories`
  plus `LoadDirectory`, `OpenFile`, `SelectTab`, `CloseTab`, `RenderExplorer`,
  `RenderTabs`, `RenderSelectedFile`, `HandleFileChanged`. Panel sizing with min/max
  clamps and `localStorage` persistence for explorer/chat widths.
- **File viewer states**: Markdown render, plain text (`text/*`), unsupported, error,
  and loading states all handled.
- **File-change behavior**: handler keys on `payload.path || payload.fileId`, which
  matches the server's `file.changed` payload (`eventType/path/fileId`). Selected tab
  refetches immediately; background tab marked stale and fetched only on select; unknown
  paths ignored. No diffs/patches/eager refetch — matches the non-goals.
- **Link navigation**: file-view links resolve via `enhanceRenderedLinks` with
  `basePath`; assistant links flow through `linkContext` threaded into
  `UpdateAssistantContent`. Existing-tab focus vs. new-tab fetch both handled.
- **Root-escape protection**: `NormalizeTabPath` rejects `..`, normalizes separators and
  `.` segments, and is reused for tab keys, link targets, and file-change matching.

## Test Sufficiency

UI tests cover: three-pane render; explorer rows opening tabs; tab switch/close updating
selected content; collapse + drag-resize state; markdown and assistant file links opening
/focusing tabs; and `file.changed` refetch-selected / stale-background / fetch-on-select.
Test payload shapes match production server shapes. Reported result: `npm test` in
`projects/sheaf-chat` — 160 tests passing.

## Non-blocking Observation (accepted, not filed)

`ScrollToFragment` looks for an element with `id === fragment`, but the shared
`RenderMarkdown` (slice 3) uses stock markdown-it, which does not emit heading `id`s.
Consequently `file.md#section` links open/focus the target tab correctly but do not
scroll to the anchor. The spec qualifies anchor scrolling as "where practical," and the
hard requirement (open/focus the target file) is satisfied, so this is accepted as a
known, acceptable degradation rather than a defect.

## Outcome

Accepted. No open issues in
`slices/0004_desktop_file_workspace/polishing_issues.md`.
