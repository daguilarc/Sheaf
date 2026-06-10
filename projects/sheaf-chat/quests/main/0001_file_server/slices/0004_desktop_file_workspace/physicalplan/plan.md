# Slice 4: Desktop File Workspace

## Objective

Replace the single chat screen on desktop with a three-pane file/chat workspace that can browse directories, open Markdown files in tabs, render the selected file, handle file links, and react to server file-change events with the required stale-tab behavior.

Expected outcome:

- Desktop chat sessions show a left directory explorer, center tabbed file viewer, and right chat pane.
- Users can open files into tabs, switch tabs, close tabs, collapse explorer/chat panes, and resize explorer/chat panes by dragging boundaries.
- The selected tab controls the rendered file content.
- File-change events immediately refetch the visible changed file and mark background changed tabs stale until selected.
- Markdown links in files and assistant messages open or focus file tabs.

## Key Files And Systems

- `projects/sheaf-chat/src/ui/sheaf-chat.js`
- `projects/sheaf-chat/src/ui/sheaf-chat.css`
- `projects/web/src/agui-chat.js`
- `projects/sheaf-chat/src/ui/index.html`
- `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
- `projects/sheaf-chat/tests/server/rest/rest.test.ts` only if integration fixtures are needed.

## Existing APIs To Reuse

- Reuse `FetchJson`, `RenderChatScreen` websocket connection logic, `ChatView.create`, and existing composer/model/history behavior.
- Reuse slice 1 REST endpoints:
  - `GET /api/piles/:pile/sessions/:sessionId/files?path=...`
  - `GET /api/piles/:pile/sessions/:sessionId/file?path=...`
- Reuse `window.SheafMarkdown.renderMarkdown` and link enhancement from slice 3.
- Reuse `file.changed` websocket envelopes from slice 2.

## APIs To Extend Or Modify

- Factor the current chat screen into a workspace controller without rewriting the websocket protocol:
  - Keep chat connection state and message handling in the same module.
  - Add file workspace state beside it.
  - Pass assistant link callbacks into `ChatView` or attach delegated click handling to the chat container after render.
- Add file tab state:

```js
{
  tabs: [
    {
      path: "docs/readme.md",
      name: "readme.md",
      content: "# Title\n",
      contentType: "text/markdown",
      isLoading: false,
      error: null,
      stale: false,
      fragment: null
    }
  ],
  selectedPath: "docs/readme.md",
  directoryCache: { ".": { entries: [] } },
  expandedDirectories: new Set(["."])
}
```

- Add workspace methods:
  - `LoadDirectory(path)`
  - `OpenFile(path, options)`
  - `SelectTab(path, options)`
  - `CloseTab(path)`
  - `RenderExplorer()`
  - `RenderTabs()`
  - `RenderSelectedFile()`
  - `HandleFileChanged(payload)`
- Add desktop panel sizing state stored in memory or `localStorage`:
  - explorer width with min/max constraints;
  - chat width with min/max constraints;
  - collapsed flags for explorer and chat.

## Layout Details

- Desktop DOM should be:
  - top app/session header and status row as currently used;
  - `.sheaf-chat-workspace` with explorer pane, center file pane, chat pane;
  - resize handles between explorer/center and center/chat;
  - composer remains attached to the chat pane, not the whole viewport.
- The explorer is a semantic tree/list of directories and file buttons. Directory rows expand/collapse and lazy-load entries through the directory endpoint.
- The tab bar is horizontally scrollable. Each tab has a text label, stale indicator through CSS class, and a close button.
- The file viewer shows:
  - Markdown rendered content for supported Markdown files;
  - plain text for supported non-Markdown text files if exposed by slice 1;
  - an unsupported/error state for unsupported files;
  - loading and fetch-error states.
- Avoid nested card layouts. Panes are structural regions with borders and stable dimensions.

## File Change Behavior

On `file.changed`:

- Normalize the payload path as a tab key only if it is a safe relative path and matches an open tab.
- If it matches the currently selected tab, refetch that whole file immediately and re-render.
- If it matches a background tab, set `stale: true` and update the tab affordance. Do not fetch until selected.
- If it does not match any tab, do nothing.
- When selecting a stale tab, fetch the whole file before rendering final content and clear `stale` on success.
- Do not implement diffs, patches, or speculative background refetching.

## File-Link Navigation

- File-view rendered links call `OpenFile(targetPath, { fragment })`.
- Assistant message file links call the same method.
- If the target tab exists, focus it and scroll to the fragment where practical.
- If the tab does not exist, create it, fetch through the server file endpoint, render, then scroll to the fragment where practical.
- If server fetch rejects the target, show a file pane error and do not bypass root protections.

## Enabling Refactor

The existing `RenderChatScreen` is large. A small local refactor is expected:

- Extract chat websocket/composer setup into helpers inside `sheaf-chat.js` before adding workspace state.
- Keep route behavior unchanged.
- Do not split into a new frontend build system.

## Validation

- UI tests for desktop:
  - workspace renders three panes;
  - root directory loads and file rows open tabs;
  - switching and closing tabs updates selected content;
  - collapsed explorer/chat classes and resize state update through pointer/mouse events;
  - Markdown file links and assistant file links invoke tab open/focus;
  - `file.changed` refetches selected tab, marks background tab stale, and fetches stale background tab only when selected.
- Tests should mock `fetch` responses for directory/file endpoints and websocket `file.changed` envelopes.
- CSS/manual verification notes for desktop widths, scroll containment, tab overflow, and no text overlap.
- Run `npm test` in `projects/sheaf-chat`.
