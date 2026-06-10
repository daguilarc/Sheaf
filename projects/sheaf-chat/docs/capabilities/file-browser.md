# Capability: File Browser

ID prefix: `fb`

## Purpose

Read-only browsing and preview of files under a chat session's root
directory. The capability includes the session-scoped REST file API, the
`file.changed` WebSocket event produced by successful scoped edit-tool
writes, Markdown/KaTeX rendering, file-link navigation, and the browser
workspace tabs/panels that surround the chat transcript.

## Requirements

### Root scoping

- **[fb-1]** THE file browser SHALL resolve every file API request against
  the requested session's root directory, using the manifest root when a
  manifest exists and the provisional root otherwise.
- **[fb-2]** THE file browser SHALL treat every client-provided file path as
  root-relative input; empty paths on file reads are invalid, while an
  omitted directory-list path means `.`.
- **[fb-3]** IF a file API path is absolute, contains a NUL byte, contains a
  `..` segment after backslash normalization, resolves through a symlink
  outside the session root, or otherwise resolves outside the canonical
  root, THEN THE file browser SHALL return REST error `path_escape`.
- **[fb-4]** IF the session does not exist or has no bootstrap root, THEN THE
  file browser SHALL return REST error `session_not_found`.

### REST file API

- **[fb-5]** THE service SHALL serve `GET
  /api/piles/:pile/sessions/:sessionId/file?path=<path>` as a whole-file
  read of a supported document under the session root.
- **[fb-6]** WHEN a file read succeeds, THE service SHALL return the file
  name, root-relative path, kind `file`, `supported: true`, content type,
  full UTF-8 content string, byte size, and filesystem modification time.
- **[fb-7]** IF the requested file path is missing, THEN THE service SHALL
  return `file_not_found`; IF it resolves to a directory, THEN it SHALL
  return `not_a_file`; IF the file is unsupported, THEN it SHALL return
  `unsupported_file`.
- **[fb-8]** WHEN reading file content, THE service SHALL classify `.md`
  and `.markdown` files as `text/markdown`, binary extensions as
  unsupported, and any other file without a NUL byte in the first 8192 bytes
  as `text/plain`; WHEN listing directories, it SHALL classify unknown
  non-binary extensions as `text/plain` without reading file content.
- **[fb-9]** THE service SHALL serve `GET
  /api/piles/:pile/sessions/:sessionId/files?path=<path>` as a read-only
  directory listing under the session root.
- **[fb-10]** WHEN a directory listing succeeds, THE service SHALL return a
  `directory` entry and an `entries` array containing root-relative child
  entries with `name`, `path`, `kind`, `supported`, and `contentType` when
  known.
- **[fb-11]** THE directory listing SHALL sort directories before files and
  then sort by locale string order of `name`; it SHALL omit symlinks that
  cannot be resolved safely and SHALL omit ignored directory names shared
  with scoped-tool tree traversal.
- **[fb-12]** IF a directory-list path is missing, THEN THE service SHALL
  return `file_not_found`; IF it resolves to a non-directory, THEN it SHALL
  return `not_a_directory`.
- **[fb-13]** THE file browser SHALL expose no client write, patch, delete,
  diff, or partial-read API.

### Edit notifications and WebSocket events

- **[fb-14]** WHEN the scoped `edit` tool successfully writes a file, THE
  service SHALL broadcast a non-persisted `file.changed` envelope to each
  currently connected session broadcaster whose canonical session root
  contains the changed canonical file path.
- **[fb-15]** WHEN a `file.changed` envelope is broadcast, THE payload SHALL
  contain event type `fileChanged`, root-relative `path`, matching `fileId`,
  ISO `changedAt`, and source `edit_tool`; it SHALL NOT include an absolute
  path.
- **[fb-16]** IF an edit fails validation or does not write the file, THEN
  THE service SHALL NOT broadcast `file.changed`.

### Browser workspace

- **[fb-17]** WHEN the chat screen renders on a non-touch layout, THE UI
  SHALL show a three-pane workspace: directory explorer on the left, file
  view with a horizontal tab bar in the center, and chat on the right.
- **[fb-18]** THE non-touch workspace SHALL let users open explorer files in
  tabs, switch tabs, close tabs, collapse the explorer and chat panes, and
  resize the explorer/chat panes by dragging handles; resized pane widths
  SHALL be stored in `localStorage`.
- **[fb-19]** WHEN the chat screen renders on a touch layout, THE UI SHALL
  make the file view primary and expose toolbar buttons for a left explorer
  panel, right vertical tab panel, and bottom chat panel; opening one mobile
  panel SHALL close the others, and the backdrop or close buttons SHALL hide
  the open panel without destroying tabs or chat state.
- **[fb-20]** WHEN a user opens a file from the explorer or from a supported
  file link, THE UI SHALL open a new tab and fetch the file unless a tab for
  the normalized path already exists, in which case it SHALL focus the
  existing tab.
- **[fb-21]** WHEN the selected file is Markdown, THE UI SHALL render it
  with Markdown-it and render supported math syntax through KaTeX; WHEN the
  selected file is another `text/*` type, THE UI SHALL show plain text; IF a
  file cannot be fetched or is unsupported, THEN THE UI SHALL show the
  server error message or an unsupported-preview message in the file pane.
- **[fb-22]** WHEN the UI receives `file.changed` for the selected tab, THE
  UI SHALL immediately refetch that whole file; WHEN it receives
  `file.changed` for an open background tab, THE UI SHALL mark that tab
  stale and defer refetch until the user selects it; WHEN no open tab
  matches, THE UI SHALL do nothing.
- **[fb-23]** WHEN rendered Markdown contains a safe link to a Markdown file
  under the current root, THE UI SHALL intercept the click and open or focus
  the target file tab; external URLs and unsupported targets SHALL keep
  normal link behavior.
- **[fb-24]** THE UI SHALL support `sheaf-file:<path>` links in chat
  messages and file previews as root-relative file links, and SHALL support
  relative Markdown file links in file previews resolved from the source
  file's directory.

## Contracts

### `GET /api/piles/:pile/sessions/:sessionId/file`

Query:

| Parameter | Required | Meaning |
|---|---:|---|
| `path` | yes | Root-relative file path. Backslashes are normalized to `/`; absolute paths and parent traversal are rejected. |

Successful response:

```json
{
  "file": {
    "name": "readme.md",
    "path": "docs/readme.md",
    "kind": "file",
    "supported": true,
    "contentType": "text/markdown",
    "content": "# Title\n",
    "size": 8,
    "modifiedAt": "2026-06-10T00:00:00.000Z"
  }
}
```

### `GET /api/piles/:pile/sessions/:sessionId/files`

Query:

| Parameter | Required | Default | Meaning |
|---|---:|---|---|
| `path` | no | `.` | Root-relative directory path to list. |

Successful response:

```json
{
  "directory": {
    "name": "docs",
    "path": "docs",
    "kind": "directory",
    "supported": true
  },
  "entries": [
    { "name": "notes", "path": "docs/notes", "kind": "directory", "supported": true },
    { "name": "image.png", "path": "docs/image.png", "kind": "file", "supported": false },
    {
      "name": "readme.md",
      "path": "docs/readme.md",
      "kind": "file",
      "supported": true,
      "contentType": "text/markdown"
    }
  ]
}
```

Ignored directory names are the default scoped-tool traversal ignores:
`node_modules`, `.git`, `dist`, `build`, `.cache`, `__pycache__`, `.venv`,
`venv`, `target`, `vendor`, `.next`, `.turbo`, `coverage`,
`.pytest_cache`, `.mypy_cache`, `.tox`, and `out`.

### REST error catalogue additions

All errors use the standard service envelope
`{"error":{"code":"...","message":"..."}}`.

| Condition | Status | Code | Message |
|---|---:|---|---|
| Missing read `path` | 400 | `invalid_request` | `path query parameter is required` |
| Missing file/list path | 404 | `file_not_found` | `path not found` |
| Missing session bootstrap | 404 | `session_not_found` | `session not found: <sessionId>` |
| Directory requested as file | 400 | `not_a_file` | `path is a directory, not a file` |
| File requested as directory | 400 | `not_a_directory` | `path is not a directory` |
| Unsupported file read | 400 | `unsupported_file` | `file is not a supported text document` |
| Root escape | 403 | `path_escape` | `path must be relative to the session root` or lower-level root-policy message |

### `file.changed` envelope

`file.changed` is a live WebSocket broadcast frame. It is not appended to the
session history log and does not carry a `sequence`.

```json
{
  "v": 1,
  "kind": "file.changed",
  "id": "5e0f0b8c-...",
  "pile": "default",
  "sessionId": "0123456789abcdef0123456789abcdef",
  "timestamp": "2026-06-10T00:00:00.000Z",
  "payload": {
    "eventType": "fileChanged",
    "path": "docs/readme.md",
    "fileId": "docs/readme.md",
    "changedAt": "2026-06-10T00:00:00.000Z",
    "source": "edit_tool"
  }
}
```

When a parent-root session and child-root session are both connected, the
same edit may be delivered with different receiver-relative payload paths
(for example `demo/docs/readme.md` for the parent root and `docs/readme.md`
for the child root).

### File links

Supported file-link targets normalize to root-relative Markdown paths:

| Link form | Context | Resolution |
|---|---|---|
| `sheaf-file:docs/readme.md` | file preview or chat message | root-relative |
| `other.md` | file preview only | relative to the source Markdown file directory |
| `/docs/readme.md` | file preview or chat message | root-relative after trimming leading slashes |
| `https://example.com/` | any | external link, not intercepted |

Fragments are preserved as `{path, fragment}` during tab opening. The UI
attempts to scroll to an element whose `id` exactly matches the fragment.

## Design

- `src/server/router.ts` and `src/server/routes/files.ts` add the two GET
  routes and dispatch through the shared REST error handler.
- `src/server/files/sessionBrowser.ts` owns session-root lookup,
  path normalization, read/list operations, file classification, sorting,
  ignore handling, and response shapes.
- `src/extensions/sheaf-chat/fileClassification.ts` defines supported file
  types and the binary NUL-byte check.
- `src/extensions/sheaf-chat/tools/edit.ts` calls `notifyFileChanged` after
  `writeFile` succeeds and before returning the edit success result.
- `src/server/server.ts` wires the `AgentManager` file-change callback to a
  `SessionBroadcasterRegistry`; `src/protocol/sessionBroadcaster.ts`
  canonicalizes the changed path and broadcasts receiver-relative
  `file.changed` envelopes to matching active broadcasters.
- `src/ui/sheaf-chat.js` implements the desktop/mobile workspace, directory
  fetches, tabs, stale-tab refetch policy, panel controls, and chat
  integration.
- `src/ui/sheaf-markdown.js` wraps Markdown-it/KaTeX rendering and file-link
  resolution/enhancement. `src/ui/index.html` loads Markdown-it, KaTeX, the
  helper, the shared chat renderer, and the app script in that order.
- Tests: `tests/server/rest/files.test.ts`,
  `tests/server/websocket/protocol.test.ts`,
  `tests/extensions/tools.test.ts`, `tests/ui/chatScreen.test.ts`, and
  `tests/integration/fileServer.integration.test.ts`.

## Interactions

- [service](service.md) — serves the REST routes and Markdown/KaTeX static
  assets, and maps the file API error codes.
- [chat-protocol](chat-protocol.md) — defines the shared envelope contract
  and the live `file.changed` frame behavior.
- [scoped-tools](scoped-tools.md) — the controlled `edit` tool is the only
  write path that produces file-change notifications.
- [chat-ui](chat-ui.md) — owns the rest of the chat screen behavior around
  the file workspace.
- [session files](../contracts/session-files.md) — session root directories
  come from provisional records and manifests.
