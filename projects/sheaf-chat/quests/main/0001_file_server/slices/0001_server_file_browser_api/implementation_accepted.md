# Implementation Accepted: Server File Browser API (Slice 1)

## Decision

Accepted. The slice implements the read-only server file browser API correctly and
completely against the slice spec and physical plan. All polishing issues are resolved.

## What was delivered

- `GET /api/piles/:pile/sessions/:sessionId/file?path=<relative-path>` for whole-file
  retrieval (explicit non-empty path required).
- `GET /api/piles/:pile/sessions/:sessionId/files?path=<relative-directory>` for
  directory listing (`path` defaults to `.`).
- Reusable server helpers in `src/server/files/sessionBrowser.ts`
  (`CreateSessionRootPolicy`, `ResolveBrowserRelativePath`, `ReadSessionFile`,
  `ListSessionDirectory`) and shared file classification in
  `src/extensions/sheaf-chat/fileClassification.ts` (with `IsBinaryBuffer` de-duplicated
  out of the read tool).
- `AgentManager.resolveSessionRootDirectory()` resolving roots for provisional and
  manifested sessions without attaching the agent, via the existing
  `ResolveSessionBootstrap` path.
- New REST error codes wired with correct status mappings (`session_not_found` 404,
  `file_not_found` 404, `path_escape` 403, `unsupported_file`/`not_a_file`/
  `not_a_directory` 400).

## Review basis

- Reviewed the implementer diff (since `ad6358d`) and the polisher follow-up
  (commits through `5b68471`) primarily via `git diff`, with targeted reads of
  `pathPolicy.ts`, `errors.ts`, `sessionRuntime.ts`, and `toolHelpers.ts` to confirm
  the relied-upon contracts.
- Path safety is layered: browser-level rejection of absolute / Windows-drive /
  parent-traversal / NUL inputs, plus the underlying `RootPolicy` realpath +
  within-root assertion. Symlink escapes map to `path_escape`; in-listing escaping
  symlinks are skipped. Escape protection was confirmed intact after the fix.
- Binary/markdown/text classification, ignored directories (`x_treeDefaultIgnores`),
  stable dir-before-file/locale sorting, and root-relative-only response paths all
  conform to the spec.
- Test coverage is thorough and covers the spec validation list: traversal variants,
  backslash, absolute, symlink escape, root-as-file, directory-as-file, missing file,
  binary/unsupported, missing session, and both provisional and manifested sessions.

## Polishing issues

- **PL-0001** (completed): Directory listing reported in-root symlink entries at the
  resolved target path instead of the entry's own path, causing name/path basename
  mismatch and duplicate `path` collisions. Fixed by computing the listed
  `rootRelativePath` from the entry's own location (`path.join(parentAbsolute,
  entryName)`) while still using the resolved target only for the within-root safety
  and kind checks. Verified the fix and the added regression test
  (`ListSessionDirectory reports in-root symlinks at their own entry path`).

No escalations or harness issues were encountered.
