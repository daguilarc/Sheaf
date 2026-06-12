# Capability: File Browser

Project: `projects/sheaf-chat`
ID prefix: `fb` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Read-only browsing and preview of files under a chat session's root
directory. The capability includes the session-scoped REST file API, the
`file.changed` WebSocket event produced by successful scoped edit-tool
writes, Markdown/KaTeX rendering, file-link navigation, and the browser
workspace tabs/panels that surround the chat transcript.

## Requirements

### Requirement: fb-1 — Root scoping: session root resolution

THE file browser SHALL resolve every file API request against the requested session's root directory, using the manifest root when a manifest exists and the provisional root otherwise.

#### Scenario: Manifest root present

- **WHEN** a file API request arrives for a session that has a manifest root
- **THEN** the request is resolved against the manifest root directory

#### Scenario: No manifest root

- **WHEN** a file API request arrives for a session with no manifest root
- **THEN** the request is resolved against the provisional root directory

### Requirement: fb-2 — Root scoping: client path treatment

THE file browser SHALL treat every client-provided file path as root-relative input; empty paths on file reads are invalid, while an omitted directory-list path means `.`.

#### Scenario: File read with empty path

- **WHEN** a file read request is made with an empty path
- **THEN** the path is treated as invalid

#### Scenario: Directory list with omitted path

- **WHEN** a directory-list request is made with no path parameter
- **THEN** the path defaults to `.`

### Requirement: fb-3 — Root scoping: path escape rejection

IF a file API path is absolute, contains a NUL byte, contains a `..` segment after backslash normalization, resolves through a symlink outside the session root, or otherwise resolves outside the canonical root, THEN THE file browser SHALL return REST error `path_escape`.

#### Scenario: Absolute path

- **WHEN** a file API request uses an absolute path
- **THEN** the file browser returns REST error `path_escape`

#### Scenario: NUL byte in path

- **WHEN** a file API request path contains a NUL byte
- **THEN** the file browser returns REST error `path_escape`

#### Scenario: Parent traversal segment

- **WHEN** a file API request path contains a `..` segment after backslash normalization
- **THEN** the file browser returns REST error `path_escape`

#### Scenario: Symlink escapes root

- **WHEN** a file API request path resolves through a symlink outside the session root
- **THEN** the file browser returns REST error `path_escape`

### Requirement: fb-4 — Root scoping: missing session rejection

IF the session does not exist or has no bootstrap root, THEN THE file browser SHALL return REST error `session_not_found`.

#### Scenario: Session not found

- **WHEN** a file API request references a session that does not exist or has no bootstrap root
- **THEN** the file browser returns REST error `session_not_found`

### Requirement: fb-5 — REST file API: whole-file read route

THE service SHALL serve `GET /api/piles/:pile/sessions/:sessionId/file?path=<path>` as a whole-file read of a supported document under the session root.

#### Scenario: File read request

- **WHEN** `GET /api/piles/:pile/sessions/:sessionId/file?path=<path>` is requested
- **THEN** the service performs a whole-file read of the supported document at that path under the session root

### Requirement: fb-6 — REST file API: successful file read response

WHEN a file read succeeds, THE service SHALL return the file name, root-relative path, kind `file`, `supported: true`, content type, full UTF-8 content string, byte size, and filesystem modification time.

#### Scenario: File read succeeds

- **WHEN** a file read request succeeds
- **THEN** the service returns the file name, root-relative path, kind `file`, `supported: true`, content type, full UTF-8 content string, byte size, and filesystem modification time

### Requirement: fb-7 — REST file API: file read error cases

IF the requested file path is missing, THEN THE service SHALL return `file_not_found`; IF it resolves to a directory, THEN it SHALL return `not_a_file`; IF the file is unsupported, THEN it SHALL return `unsupported_file`.

#### Scenario: File path missing

- **WHEN** the requested file path does not exist
- **THEN** the service returns `file_not_found`

#### Scenario: Path resolves to directory

- **WHEN** the requested file path resolves to a directory
- **THEN** the service returns `not_a_file`

#### Scenario: File is unsupported

- **WHEN** the requested file is unsupported
- **THEN** the service returns `unsupported_file`

### Requirement: fb-8 — REST file API: file classification

WHEN reading file content, THE service SHALL classify `.md` and `.markdown` files as `text/markdown`, binary extensions as unsupported, and any other file without a NUL byte in the first 8192 bytes as `text/plain`; WHEN listing directories, it SHALL classify unknown non-binary extensions as `text/plain` without reading file content.

#### Scenario: Markdown file read

- **WHEN** a file read is performed on a `.md` or `.markdown` file
- **THEN** the service classifies it as `text/markdown`

#### Scenario: Binary file read

- **WHEN** a file read is performed on a binary extension file
- **THEN** the service classifies it as unsupported

#### Scenario: Other text file read

- **WHEN** a file read is performed on a file with no NUL byte in the first 8192 bytes and no binary extension
- **THEN** the service classifies it as `text/plain`

#### Scenario: Directory listing classification

- **WHEN** a directory listing is performed
- **THEN** unknown non-binary extensions are classified as `text/plain` without reading file content

### Requirement: fb-9 — REST file API: directory listing route

THE service SHALL serve `GET /api/piles/:pile/sessions/:sessionId/files?path=<path>` as a read-only directory listing under the session root.

#### Scenario: Directory listing request

- **WHEN** `GET /api/piles/:pile/sessions/:sessionId/files?path=<path>` is requested
- **THEN** the service performs a read-only directory listing under the session root

### Requirement: fb-10 — REST file API: successful directory listing response

WHEN a directory listing succeeds, THE service SHALL return a `directory` entry and an `entries` array containing root-relative child entries with `name`, `path`, `kind`, `supported`, and `contentType` when known.

#### Scenario: Directory listing succeeds

- **WHEN** a directory listing request succeeds
- **THEN** the service returns a `directory` entry and an `entries` array with root-relative child entries containing `name`, `path`, `kind`, `supported`, and `contentType` when known

### Requirement: fb-11 — REST file API: directory listing sort and omissions

THE directory listing SHALL sort directories before files and then sort by locale string order of `name`; it SHALL omit symlinks that cannot be resolved safely and SHALL omit ignored directory names shared with scoped-tool tree traversal.

#### Scenario: Directory listing sort order

- **WHEN** a directory listing is returned
- **THEN** directories appear before files, and entries within each group are sorted by locale string order of `name`

#### Scenario: Unsafe symlinks omitted

- **WHEN** a directory listing is returned and symlinks cannot be resolved safely
- **THEN** those symlinks are omitted from the listing

#### Scenario: Ignored directories omitted

- **WHEN** a directory listing is returned
- **THEN** ignored directory names shared with scoped-tool tree traversal are omitted

### Requirement: fb-12 — REST file API: directory listing error cases

IF a directory-list path is missing, THEN THE service SHALL return `file_not_found`; IF it resolves to a non-directory, THEN it SHALL return `not_a_directory`.

#### Scenario: Directory path missing

- **WHEN** the directory-list path does not exist
- **THEN** the service returns `file_not_found`

#### Scenario: Path resolves to non-directory

- **WHEN** the directory-list path resolves to a non-directory
- **THEN** the service returns `not_a_directory`

### Requirement: fb-13 — REST file API: no write API

THE file browser SHALL expose no client write, patch, delete, diff, or partial-read API.

#### Scenario: Write API not exposed

- **WHEN** the file browser API is used
- **THEN** no write, patch, delete, diff, or partial-read endpoint is available to clients

### Requirement: fb-14 — Edit notifications and WebSocket events: file.changed broadcast

WHEN the scoped `edit` tool successfully writes a file, THE service SHALL broadcast a non-persisted `file.changed` envelope to each currently connected session broadcaster whose canonical session root contains the changed canonical file path.

#### Scenario: Edit tool writes file successfully

- **WHEN** the scoped `edit` tool successfully writes a file
- **THEN** the service broadcasts a non-persisted `file.changed` envelope to each currently connected session broadcaster whose canonical session root contains the changed canonical file path

### Requirement: fb-15 — Edit notifications and WebSocket events: file.changed payload

WHEN a `file.changed` envelope is broadcast, THE payload SHALL contain event type `fileChanged`, root-relative `path`, matching `fileId`, ISO `changedAt`, and source `edit_tool`; it SHALL NOT include an absolute path.

#### Scenario: file.changed envelope broadcast

- **WHEN** a `file.changed` envelope is broadcast
- **THEN** the payload contains event type `fileChanged`, root-relative `path`, matching `fileId`, ISO `changedAt`, and source `edit_tool`, and does not include an absolute path

### Requirement: fb-16 — Edit notifications and WebSocket events: no broadcast on failed edit

IF an edit fails validation or does not write the file, THEN THE service SHALL NOT broadcast `file.changed`.

#### Scenario: Edit fails validation

- **WHEN** an edit fails validation
- **THEN** the service does not broadcast `file.changed`

#### Scenario: Edit does not write the file

- **WHEN** an edit does not write the file
- **THEN** the service does not broadcast `file.changed`

### Requirement: fb-17 — Browser workspace: non-touch three-pane layout

WHEN the chat screen renders on a non-touch layout, THE UI SHALL show a three-pane workspace: directory explorer on the left, file view with a horizontal tab bar in the center, and chat on the right.

#### Scenario: Non-touch chat screen rendered

- **WHEN** the chat screen renders on a non-touch layout
- **THEN** the UI shows a three-pane workspace with directory explorer on the left, file view with horizontal tab bar in the center, and chat on the right

### Requirement: fb-18 — Browser workspace: non-touch interactions and persistence

THE non-touch workspace SHALL let users open explorer files in tabs, switch tabs, close tabs, collapse the explorer and chat panes, and resize the explorer/chat panes by dragging handles; resized pane widths SHALL be stored in `localStorage`.

#### Scenario: Non-touch workspace interactions

- **WHEN** a user interacts with the non-touch workspace
- **THEN** they can open explorer files in tabs, switch tabs, close tabs, collapse the explorer and chat panes, and resize the explorer/chat panes by dragging handles

#### Scenario: Pane width persistence

- **WHEN** a user resizes explorer or chat panes
- **THEN** the resized pane widths are stored in `localStorage`

### Requirement: fb-19 — Browser workspace: touch layout

WHEN the chat screen renders on a touch layout, THE UI SHALL make the file view primary and expose toolbar buttons for a left explorer panel, right vertical tab panel, and bottom chat panel; opening one mobile panel SHALL close the others, and the backdrop or close buttons SHALL hide the open panel without destroying tabs or chat state.

#### Scenario: Touch chat screen rendered

- **WHEN** the chat screen renders on a touch layout
- **THEN** the UI makes the file view primary and exposes toolbar buttons for a left explorer panel, right vertical tab panel, and bottom chat panel

#### Scenario: One mobile panel open at a time

- **WHEN** a user opens a mobile panel
- **THEN** the other panels close

#### Scenario: Mobile panel closed via backdrop or close button

- **WHEN** a user hides the open panel via the backdrop or close buttons
- **THEN** the panel is hidden without destroying tabs or chat state

### Requirement: fb-20 — Browser workspace: file tab deduplication

WHEN a user opens a file from the explorer or from a supported file link, THE UI SHALL open a new tab and fetch the file unless a tab for the normalized path already exists, in which case it SHALL focus the existing tab.

#### Scenario: File opened with no existing tab

- **WHEN** a user opens a file from the explorer or a supported file link and no tab for the normalized path exists
- **THEN** the UI opens a new tab and fetches the file

#### Scenario: File opened with existing tab

- **WHEN** a user opens a file from the explorer or a supported file link and a tab for the normalized path already exists
- **THEN** the UI focuses the existing tab

### Requirement: fb-21 — Browser workspace: file rendering and error display

WHEN the selected file is Markdown, THE UI SHALL render it with Markdown-it and render supported math syntax through KaTeX; WHEN the selected file is another `text/*` type, THE UI SHALL show plain text; IF a file cannot be fetched or is unsupported, THEN THE UI SHALL show the server error message or an unsupported-preview message in the file pane.

#### Scenario: Markdown file selected

- **WHEN** the selected file is Markdown
- **THEN** the UI renders it with Markdown-it and renders supported math syntax through KaTeX

#### Scenario: Other text file selected

- **WHEN** the selected file is another `text/*` type
- **THEN** the UI shows plain text

#### Scenario: File cannot be fetched or is unsupported

- **WHEN** a file cannot be fetched or is unsupported
- **THEN** the UI shows the server error message or an unsupported-preview message in the file pane

### Requirement: fb-22 — Browser workspace: file.changed tab refresh

WHEN the UI receives `file.changed` for the selected tab, THE UI SHALL immediately refetch that whole file; WHEN it receives `file.changed` for an open background tab, THE UI SHALL mark that tab stale and defer refetch until the user selects it; WHEN no open tab matches, THE UI SHALL do nothing.

#### Scenario: file.changed for selected tab

- **WHEN** the UI receives `file.changed` for the currently selected tab
- **THEN** the UI immediately refetches that whole file

#### Scenario: file.changed for background tab

- **WHEN** the UI receives `file.changed` for an open background tab
- **THEN** the UI marks that tab stale and defers refetch until the user selects it

#### Scenario: file.changed with no matching tab

- **WHEN** the UI receives `file.changed` and no open tab matches
- **THEN** the UI does nothing

### Requirement: fb-23 — Browser workspace: Markdown file-link interception

WHEN rendered Markdown contains a safe link to a Markdown file under the current root, THE UI SHALL intercept the click and open or focus the target file tab; external URLs and unsupported targets SHALL keep normal link behavior.

#### Scenario: Safe Markdown link clicked

- **WHEN** a user clicks a safe link to a Markdown file under the current root in rendered Markdown
- **THEN** the UI intercepts the click and opens or focuses the target file tab

#### Scenario: External URL or unsupported link clicked

- **WHEN** a user clicks an external URL or an unsupported link target in rendered Markdown
- **THEN** normal link behavior is kept

### Requirement: fb-24 — Browser workspace: sheaf-file link and relative Markdown link support

THE UI SHALL support `sheaf-file:<path>` links in chat messages and file previews as root-relative file links, and SHALL support relative Markdown file links in file previews resolved from the source file's directory.

#### Scenario: sheaf-file link in chat or preview

- **WHEN** the UI encounters a `sheaf-file:<path>` link in a chat message or file preview
- **THEN** the link is treated as a root-relative file link

#### Scenario: Relative Markdown link in file preview

- **WHEN** the UI encounters a relative Markdown file link in a file preview
- **THEN** the link is resolved from the source file's directory

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

- [service](../sheaf-chat-service/spec.md) — serves the REST routes and Markdown/KaTeX static assets, and maps the file API error codes.
- [chat-protocol](../sheaf-chat-chat-protocol/spec.md) — defines the shared envelope contract and the live `file.changed` frame behavior.
- [scoped-tools](../sheaf-chat-scoped-tools/spec.md) — the controlled `edit` tool is the only write path that produces file-change notifications.
- [chat-ui](../sheaf-chat-chat-ui/spec.md) — owns the rest of the chat screen behavior around the file workspace.
- [session files](../../../projects/sheaf-chat/docs/contracts/session-files.md) — session root directories come from provisional records and manifests.
