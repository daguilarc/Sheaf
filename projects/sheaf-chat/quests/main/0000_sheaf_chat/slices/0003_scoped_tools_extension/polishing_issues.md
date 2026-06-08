# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T21:37:20Z
- updated_at: 2026-06-08T21:37:20Z
- title: Traversal tools follow symlinks out of session root (search_text reads outside contents)
- details: ## What is wrong

The traversal tools (`search_text`, `find_files`, `tree`, `list`) follow symlinks
that point outside the session root, allowing root escape. They build each child
path lexically (`path.join(parentAbsolute, entry.name)`), call only
`policy.AssertWithinRoot(entryAbsolute)` — which is a purely lexical check — and then
`stat()`/`readFile()`/`readdir()` the entry. Because `stat`/`readFile`/`readdir`
follow symlinks, a symlink that lives inside the root but targets a path outside the
root is dereferenced without ever resolving the target through `realpath` /
`ResolveInputPath`.

Concrete escapes (root contains a symlink `link` -> `/outside/...`):

- `search_text` (most severe): in `WalkSearch` (searchText.ts:162-181) a symlink entry
  falls through to `stat(absolutePath)` (follows link) → `isFile()` → `readFile(absolutePath)`
  reads the **contents** of the outside target and returns matching lines, labeled with the
  in-root display path. If the symlink targets an outside *directory*, `readdir` follows it
  and the walk recurses through the entire outside subtree, reading every file.
- `find_files` (findFiles.ts:124-134): `entryStat = stat(...)` follows the link;
  `entryStat.isDirectory()` recurses into an outside directory and enumerates its
  files; outside file paths are emitted (relativized as if in-root).
- `tree` (tree.ts:73-95) and `list` (list.ts:92-95): `stat()` follows links and
  reports metadata of / recurses into outside targets.

By contrast `read`, `write`, `edit`, and `file_info` resolve the input path with
`ResolveInputPath` (which calls `realpath` and re-asserts), so they correctly reject
symlink escapes. The traversal tools bypass that path entirely.

## Why it is a problem

The slice spec/plan state explicitly: "Every filesystem operation resolves through the
canonical session root and rejects escapes through absolute paths, `..`, symlinks, cwd
tricks, or generated host paths," and the validation section requires "Unit tests for
every escape vector in the spec: ... symlink targets." This is the central security
guarantee of the slice (no shell, no arbitrary FS access). `search_text` following a
symlink to read arbitrary outside file contents is a direct, exploitable violation of
that guarantee. The existing symlink test only covers the direct `ResolveInputPath`
case (path-policy / `read`), not symlink *entries encountered during traversal*, so the
gap is uncovered.

Related minor defect with the same root cause: `list`/`tree`/`file_info` advertise a
`"symlink"` entry type, but they call `stat` (which follows links) rather than `lstat`,
so `isSymbolicLink()` is always false and that branch is dead code.

## What must be true to close

- For `search_text`, `find_files`, `tree`, and `list`, symlink entries are detected
  (e.g. via `Dirent.isSymbolicLink()` or `lstat`) and either skipped or resolved through
  the root policy (`realpath` + `AssertWithinRoot`) before being stat'd / read / recursed
  into, so that no symlink whose realpath is outside the root is ever dereferenced.
- A symlink inside the root pointing to an outside file/directory cannot cause
  `search_text` to return outside contents, nor `find_files`/`tree`/`list` to enumerate
  or report outside paths/metadata.
- New unit tests cover the symlink-during-traversal escape vector for these tools
  (the test helpers already expose `CreateOutsideSymlink`).
- If the `"symlink"` entry type is intended to be reported, the tools use `lstat` so the
  type is accurate; otherwise the dead branch is removed.
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T21:37:24Z
- updated_at: 2026-06-08T21:37:24Z
- title: Glob patterns with non-terminal ** (e.g. **/*.json) never match
- details: ## What is wrong

`GlobToRegExp` in `glob.ts` produces a regex that never matches when `**` appears as a
non-terminal path segment (e.g. `**/*.json`, `**/foo`, `a/**/b`). For a non-terminal
`**`, the code pushes the part `"(?:.*/)?"` (which already encodes its own optional
trailing slash), and then `GlobToRegExp` joins all parts with `"/"` (glob.ts:67:
`regexParts.join("/")`). That inserts a second, mandatory `/` after the optional group.

For pattern `**/*.json` the resulting regex is:

    ^(?:.*/)?/[^/]*\.json$

The literal `/` immediately after `(?:.*/)?` requires a path of the form
`.../<something>//file.json` (double slash) or `/file.json` (leading slash). Normal
relative paths such as `a/b/c.json` or `c.json` therefore never match, so the pattern
matches nothing.

This affects:

- `find_files` `glob` parameter — whose own schema description advertises
  `'**/*.json'` as an example (findFiles.ts:19), so the documented usage is broken.
- `find_files` and `search_text` `include` / `exclude` arrays — any `**/...`
  include silently matches nothing (returns no results); any `**/...` exclude silently
  excludes nothing.

## Why it is a problem

`**/` is the most common and idiomatic glob form for "anywhere in the tree," and it is
explicitly offered to the agent in the tool schema. Silent mismatching means
`find_files`/`search_text` return empty or unfiltered results with no error, which is a
correctness defect that will mislead the agent. The slice validation calls for
"file discovery filters" and "text search options" tests, but no test exercises a `**`
glob, so this is uncovered.

(Terminal `**`, e.g. `src/**`, happens to work because that branch pushes `"(?:.*)"`;
the bug is specific to `**` followed by more segments.)

## What must be true to close

- `GlobToRegExp` matches `**/` semantics correctly: e.g. `**/*.json` matches
  `c.json`, `a/c.json`, and `a/b/c.json`; `**/foo` matches `foo` and `a/b/foo`;
  `a/**/b` matches `a/b` and `a/x/y/b`. The fix must avoid emitting a spurious extra
  `/` (for example, build the regex by concatenating segment parts with explicit
  separators rather than `join("/")` over parts that already include slashes).
- `find_files` with `glob: "**/*.json"` and `include`/`exclude` arrays using `**/`
  patterns behave as documented.
- Unit tests cover `**`-prefixed and `**`-embedded glob patterns for `find_files`
  filters and `search_text` include/exclude.
- resolution_notes: none
