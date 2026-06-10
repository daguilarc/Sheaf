# Slice 1: Server File Browser API

## Objective

Add the read-only server API that lets a chat session retrieve file contents and browse directory entries below that session's root directory.

Expected outcome:

- Clients can fetch a whole Markdown/text file by root-relative path for an existing session.
- Clients can list one directory under the same root and receive tree-ready entry metadata.
- All client-provided file paths are treated as root-relative inputs and are rejected if they are absolute, empty, parent-traversing, symlink-escaping, outside the root, directories requested as files, missing, unsupported, or unreadable.
- The implementation exposes reusable server-side helpers for later file-link validation and change-event relative path calculation.

## Key Files And Systems

- `projects/sheaf-chat/src/server/router.ts`
- `projects/sheaf-chat/src/server/routes/files.ts` (new)
- `projects/sheaf-chat/src/server/routes/context.ts`
- `projects/sheaf-chat/src/agents/manager.ts`
- `projects/sheaf-chat/src/extensions/sheaf-chat/pathPolicy.ts`
- `projects/sheaf-chat/src/extensions/sheaf-chat/toolHelpers.ts`
- `projects/sheaf-chat/tests/server/rest/`
- `projects/sheaf-chat/tests/extensions/pathPolicy.test.ts`
- `projects/sheaf-chat/docs/reference/api.md` if API docs are updated in implementation.

## Existing APIs To Reuse

- Reuse `CreateRootPolicy`, `RootPolicy.ResolveInputPath`, `RootPolicy.AssertWithinRoot`, and `RootPolicy.ToRootRelativePath` for canonical root and symlink escape protection.
- Reuse `ReadManifest` and provisional-session access paths through `AgentManager` rather than duplicating session lookup logic.
- Reuse `StorageError`, `SendJson`, `SendRestError`, route dispatch style, and existing REST test helpers.
- Reuse the ignore defaults from `x_treeDefaultIgnores` for directory browser exclusions so the browser and scoped tool behavior stay consistent.

## APIs To Extend Or Modify

- Add `AgentManager.resolveSessionRootDirectory(key)` or equivalent public method that returns the absolute root directory for an active, provisional, or manifested session without requiring the caller to attach/start the agent.
- Add a small file-browser service/helper in the server layer, for example:
  - `CreateSessionRootPolicy(agentManager, pile, sessionId): Promise<RootPolicy>`
  - `ResolveBrowserRelativePath(policy, relativePath, options): Promise<string>`
  - `ReadSessionFile(...): Promise<FileGetResponse>`
  - `ListSessionDirectory(...): Promise<FileListResponse>`
- Extend API routing with two GET endpoints:
  - `GET /api/piles/:pile/sessions/:sessionId/file?path=<relative-path>`
  - `GET /api/piles/:pile/sessions/:sessionId/files?path=<relative-directory>`
- Keep paths in query parameters to avoid ambiguous route segment slash encoding.

## API Shapes

`GET .../file?path=docs/readme.md` returns:

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

`GET .../files?path=docs` returns:

```json
{
  "directory": {
    "name": "docs",
    "path": "docs",
    "kind": "directory"
  },
  "entries": [
    {
      "name": "readme.md",
      "path": "docs/readme.md",
      "kind": "file",
      "supported": true,
      "contentType": "text/markdown"
    },
    {
      "name": "notes",
      "path": "docs/notes",
      "kind": "directory",
      "supported": true
    }
  ]
}
```

Implementation details:

- `path` defaults to `.` only for directory listing. File retrieval requires a non-empty explicit path.
- Supported file status is `true` for `.md`, `.markdown`, and plain UTF-8 text files the implementation chooses to expose. Markdown files must be supported. Binary files should be omitted or returned as `supported: false`; do not return binary contents.
- Directory listings should skip symlinks that cannot be proven to resolve inside root and skip ignored directories such as `.git`, `node_modules`, build output, caches, and generated dependency folders.
- Sort directories before files, then by locale name, to keep the explorer stable.
- Do not include absolute filesystem paths in REST responses.

## Enabling Refactor

This slice should do a small enabling refactor only if needed: move root policy/file classification helpers into a reusable module rather than importing tool implementations from REST handlers. Avoid making the agent tools depend on server routes.

## Validation

- Add REST tests for successful Markdown file retrieval and directory listing.
- Add path escape tests covering `..`, encoded traversal, absolute paths, backslash separators, symlink escapes, root itself requested as a file, missing files, directories requested through the file endpoint, and unsupported/binary files.
- Add tests for provisional sessions and manifested sessions so file browsing works before and after the first agent message.
- Add path-policy or route tests proving absolute inputs are rejected for browser APIs even if the lower-level `RootPolicy` can accept safe absolute paths for agent tools.
- Run `npm test` in `projects/sheaf-chat`.
