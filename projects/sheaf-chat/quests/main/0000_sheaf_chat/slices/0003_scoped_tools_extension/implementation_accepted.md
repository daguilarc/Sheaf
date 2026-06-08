# Slice 0003 Implementation Accepted

## Summary

The root-scoped Pi tool library and extension under
`src/extensions/sheaf-chat/` are correct, complete for the slice scope, and
production-ready. The extension registers exactly the eight scoped tools
(`read`, `write`, `edit`, `list`, `tree`, `find_files`, `search_text`,
`file_info`) and no shell/grep/find/ls surface.

## Verification against spec

- **Path policy** (`pathPolicy.ts`): canonical-root enforcement via `realpath`,
  rejection of `..`, absolute-outside, backslash, and symlink escapes;
  root-relative rendering; missing-path handling for writes. Covered by
  `tests/extensions/pathPolicy.test.ts`.
- **Per-tool behavior**: read excerpts/numbering/truncation, write
  create/overwrite + parent dirs under root, edit exact-replacement with
  not-found/ambiguous/overlap errors, list metadata, bounded tree with default
  ignores, find_files filters, search_text literal/regex/context/binary-skip/limit,
  file_info. Covered by `tests/extensions/tools.test.ts`.
- **No absolute-parent leakage**: assertions across tool outputs confirm display
  paths are relativized and never expose the canonical root or parent paths.

## Polishing issues resolved this slice

- **PL-0001 (closed)** — Traversal tools (`search_text`, `find_files`, `tree`,
  `list`) previously followed symlink entries out of the session root
  (`search_text` could read outside file contents). Fixed: all four now use
  `lstat` and skip/report symlink entries without dereferencing targets.
  Regression test "traversal tools do not follow symlink entries outside the root"
  proves no outside contents/paths/children are exposed.
- **PL-0002 (closed)** — `GlobToRegExp` emitted a spurious slash so non-terminal
  `**` globs (e.g. `**/*.json`) matched nothing. Fixed: globstar segments now
  handle their own separators. Tests cover `**/*.json`, `**/foo`, `a/**/b`, and
  globstar include/exclude filters for both `find_files` and `search_text`,
  including negative cases.

## Validation

Implementer/polisher reported `npm test` passing after the fixes (per issue
responses). Reviewer verification was by reading the diff and tests; no further
defects found.
