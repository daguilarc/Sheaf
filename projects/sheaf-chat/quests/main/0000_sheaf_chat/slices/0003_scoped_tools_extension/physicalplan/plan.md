# Slice 3: Root-Scoped Pi Tools And Extension

## Objective

Build the Sheaf Chat Pi extension and scoped tool library that lets agents inspect and edit only the session root directory, with no shell or arbitrary command execution surface.

Expected outcome:

- The extension registers `read`, `write`, `edit`, `list`, `tree`, `find_files`, `search_text`, and `file_info`.
- `read`, `write`, and `edit` preserve Pi built-in argument names and result expectations while changing path enforcement and rendered paths.
- Every filesystem operation resolves through the canonical session root and rejects escapes through absolute paths, `..`, symlinks, cwd tricks, or generated host paths.
- Escape attempts produce a visible activity/control event hook and an audit log hook for later AGUI/WebSocket slices.

## Key Files And Systems

- `projects/sheaf-chat/src/extensions/sheaf-chat/index.ts`
- `projects/sheaf-chat/src/extensions/sheaf-chat/tools/*.ts`
- `projects/sheaf-chat/src/extensions/sheaf-chat/pathPolicy.ts`
- `projects/sheaf-chat/src/extensions/sheaf-chat/audit.ts`
- `projects/sheaf-chat/tests/extensions/`

## Existing APIs To Reuse

- Pi extension API: `pi.registerTool()` from `@earendil-works/pi-coding-agent`.
- Typebox schema style used by Pi extension examples.
- Node `fs/promises`, `path`, and `fs.realpath` for canonical root enforcement.
- Shared validation and error/event types from slices 1 and 2.

## APIs To Extend Or Modify

- Add a tool factory that accepts `{ rootDirectory, audit, emitActivity }` so slice 5 can bind the extension per session.
- Add reusable path policy APIs:
  - `createRootPolicy(rootDirectory)`
  - `resolveInputPath(inputPath, options)`
  - `toRootRelativePath(absolutePath)`
  - `assertWithinRoot(absolutePath)`
- Add tool result helpers that redact or relativize absolute paths under the root and never expose parent directories.

## Implementation Notes

- Do not enable Pi built-in `bash`, `grep`, `find`, or `ls` tools for Sheaf Chat sessions. The session tool list should name only the scoped tools from this slice.
- `read` should accept UTF-8 text files only, line-number excerpts, and root-relative display paths.
- `write` should create parent directories only under root and report root-relative paths.
- `edit` should use exact text replacement semantics compatible with Pi's built-in edit behavior; if the exact text is missing or ambiguous, return a clear tool error.
- `list` reports name, type, size, and modified time.
- `tree` must apply bounded depth/entry limits and default ignores for VCS, dependency, build, cache, and large generated directories.
- `find_files` should support glob, extension, path segment, include/exclude globs, max depth, and limit. Prefer pure Node traversal for portability; use no shell.
- `search_text` should support literal/regex mode, case sensitivity, include/exclude globs, context lines, binary skipping, multiline-safe line grouping, and match limits. Do not spawn `rg`; implement with Node reads and regex handling unless a safe in-process library is added.
- Guard against TOCTOU around symlinks by resolving parent and target paths as close as practical before each operation.

## Validation

- Unit tests for every escape vector in the spec: absolute paths outside root, `..`, symlink targets, backslashes, path normalization changes, and root-relative rendering.
- Tool-specific tests for read excerpts, write overwrite/create, edit exact replacement failure/success, list metadata, bounded tree ignores, file discovery filters, text search options, binary skipping, and match limits.
- Tests assert no tool result reveals an absolute parent path outside the root.
