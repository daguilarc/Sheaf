# Quest Spec: File Server

## Goal

Extend Sheaf chat so a chat session can also act as a read-only file browser for Markdown documents under that chat's root directory. Users can browse files, open multiple file tabs, render Markdown/LaTeX, and receive file-change notifications when the agent edits files in overlapping workspaces.

## Server requirements

### Chat root model

- Each chat has an associated root directory.
- File access is scoped to that root directory.
- All client-provided paths are relative to the chat root.
- The server must normalize and validate paths so callers cannot escape the root directory via `..`, symlinks, absolute paths, URL encoding tricks, or platform-specific separators.
- This quest is read-only from the Sheaf file-server perspective. File edits are still performed by the controlled agent edit tool, not by a general file-write API exposed to the client.

### File retrieval API

Provide a `get` function/API that takes:

- a chat identifier or chat connection context; and
- a relative path within that chat root.

It returns the current contents of the requested file.

Behavior:

- Only files under the chat root are retrievable.
- Markdown files are the primary supported document type for this quest.
- Missing files, directories requested as files, unsupported paths, and paths outside the root return explicit errors.
- The API fetches the whole file. No partial reads, patches, or diff protocol are required.

### Directory browsing API

The client needs to populate a directory explorer, so the server must expose read-only directory metadata for the chat root.

Behavior:

- List directories and files below the chat root.
- Return enough metadata for the client to render a tree: name, relative path, kind (`file` or `directory`), and, if useful, supported-file status.
- Exclude or mark unsupported files according to the implementation's existing safety and ignore rules.
- Directory listing must use the same root-escape protections as file retrieval.

### Agent edit notification API

The agent edit tool is controlled by a Sheaf extension. When the edit tool finishes modifying a file, it must notify the Sheaf server once the change is complete.

The notification includes at least:

- absolute changed file path, or enough information for the server to resolve it safely;
- completion status indicating the edit succeeded; and
- optionally the originating chat/agent connection if available.

The server does not broadcast until the edit operation has completed successfully.

### File-change broadcast behavior

When the server receives a completed edit notification:

1. It checks all open Sheaf connections.
2. For each connection, it compares the changed file path with that connection's chat/agent root directory.
3. It sends a file-change message to connections where the changed file is inside the same root directory or an overlapping root directory.

Overlapping roots means either root contains the other root, or both connection contexts otherwise resolve to a filesystem scope that includes the changed file.

The broadcast message includes at least:

- event type, e.g. `fileChanged`;
- changed file path relative to the receiving chat root when possible;
- enough stable file identity for clients with open tabs to match the event to a tab;
- optional absolute path only if existing security/privacy rules allow it; and
- timestamp or monotonically useful event metadata if already idiomatic in Sheaf messages.

The server does not need to send file diffs or updated file contents.

## Client requirements

### Desktop layout

The desktop client should present a three-pane file/chat workspace:

- Left: directory explorer.
- Center: currently selected file view.
- Right: chat window.

At the top of the center file view is a horizontally scrollable tab bar for open files.

Users can:

- click files in the directory explorer to open them in tabs;
- switch between open tabs from the tab bar;
- close tabs;
- keep multiple file tabs open at the same time;
- collapse the directory explorer;
- collapse the chat window;
- resize the directory explorer and chat window by dragging panel boundaries.

The currently selected tab controls the rendered file content in the center pane.

### iOS/mobile layout

On iOS, the file view is primary, with pullable navigation panels:

- A directory explorer panel pulls out from the left.
- A tab list panel pulls out from the right.
- The right tab panel lists open tabs vertically so each tab is easy to read and select.
- The chat window pulls up from the bottom.
- When the side panels are closed, both are hidden and only the current file is visible.

Users can navigate files by opening the left explorer, switching tabs through the right panel, and chatting through the bottom panel.

### Tab and stale-content behavior

When the client receives a file-change event:

- If the changed file is currently open/visible, immediately refetch the whole file and re-render it.
- If the changed file is open in a background tab, mark that tab stale/dirty internally and defer refetching until the user switches to that tab.
- If the changed file is not open in any tab, no fetch is required.

Do not implement incremental updates, diffing, patch application, or speculative eager fetching for background tabs.

### Markdown and LaTeX rendering

Use Markdown-it and KaTeX for Markdown/LaTeX rendering.

File rendering:

- If the open file is a `.md` Markdown file, render it with Markdown-it.
- Render supported LaTeX math in Markdown through KaTeX.
- Non-Markdown files, if exposed by the directory explorer, may be shown as plain text or marked unsupported according to implementation constraints, but Markdown rendering is the required path.

Chat rendering:

- Sheaf chat messages should also render Markdown and LaTeX using the same Markdown-it/KaTeX pipeline or a shared equivalent configuration.
- Agent output containing Markdown formatting or LaTeX should display as rendered content, not raw syntax, where supported.

### Markdown file-link navigation

Markdown links that target files under the current chat root should integrate with the file tab system instead of behaving like ordinary external browser navigation.

File-view links:

- If a rendered Markdown file contains a hyperlink to another Markdown file under the chat root, clicking the link opens or focuses the target file in the file viewer.
- Relative links resolve from the directory of the Markdown file that contains the link.
- Root-relative links, if supported by the existing client/server conventions, resolve from the chat root.
- Link targets must be normalized and validated with the same root-escape protections as file retrieval.
- Links may include fragments such as `other-file.md#section`; the client should open the target file and, where practical, scroll to the referenced heading/anchor.
- Links to external URLs or unsupported targets continue to behave as normal external links, subject to existing client security rules.

Chat-message links:

- If assistant output contains a hyperlink that points to a file under the current chat root, clicking it opens or focuses that file in the file viewer.
- Supported assistant file links include relative Markdown links where there is enough chat context to resolve them safely, root-relative/project-relative links if supported by existing conventions, and any explicit Sheaf file-link format introduced by implementation.
- Assistant file links must not allow access outside the chat root.
- If the target file is already open in a tab, clicking the link selects that tab; otherwise it opens a new tab and fetches the file.

## Non-goals

- No client-side file editing UI in this quest.
- No general write API exposed by the Sheaf server.
- No patch/diff streaming protocol.
- No collaborative merge or conflict handling.
- No eager background refetch for stale tabs.

## Acceptance criteria

- A chat can retrieve a Markdown file by relative path under its root directory.
- Attempts to retrieve files outside the chat root are rejected.
- The client can browse the chat root, open files into tabs, switch tabs, and close tabs.
- Desktop layout supports directory explorer, tabbed file viewer, and chat pane with collapsible/resizable side panes.
- iOS layout supports left directory pullout, right vertical tab pullout, and bottom chat pullup.
- Markdown files render through Markdown-it, including KaTeX-rendered LaTeX where supported.
- Chat messages render Markdown/LaTeX consistently with file rendering.
- Markdown links from one file to another Markdown file under the chat root open or focus the target file tab.
- Assistant message links to files under the chat root open or focus the target file tab.
- File-link navigation rejects or ignores targets outside the chat root.
- When the controlled edit tool completes a successful file modification, the server broadcasts a file-change event to open connections with the same or overlapping roots.
- The client immediately refetches a changed file if it is the current tab.
- The client defers refetching changed background tabs until they are selected.
