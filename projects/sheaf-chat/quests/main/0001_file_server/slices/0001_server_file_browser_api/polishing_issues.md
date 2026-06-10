# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-10T03:41:55Z
- updated_at: 2026-06-10T03:41:55Z
- title: Directory listing reports symlink target path instead of the entry's own path
- details: ## What is wrong

In `ListSessionDirectory` (`src/server/files/sessionBrowser.ts`), for directory entries that are symlinks resolving INSIDE the root, the returned `path` is computed from the symlink's resolved real target rather than the entry's own location:

- `ResolveListableEntry` returns `{ absolutePath: resolved, ... }` where `resolved = await realpath(entryAbsolute)` for symlinks.
- `ListSessionDirectory` then sets `rootRelativePath = policy.ToRootRelativePath(resolved.absolutePath)`.

For non-symlink entries `resolved.absolutePath` is the entry's own join path, so they are correct. Only symlinks are affected.

## Why it is a problem

Consider a real directory `docs/sub` and a symlink `docs/link -> docs/sub` (both inside root). Listing `docs` yields:

- entry `{ name: "sub", path: "docs/sub" }`
- entry `{ name: "link", path: "docs/sub" }`  <-- wrong

This produces (a) a `name`/`path` basename mismatch for the symlink entry, and (b) two entries sharing the same `path`. A tree UI keyed on `path` would collide or mis-navigate, and following the entry would silently traverse the target rather than the named link. The spec calls for stable, tree-ready entry metadata, so each listed entry's `path` should identify that entry.

## What must be true to close

- For symlink entries that resolve inside root, the listed `path` must be the entry's own root-relative path (e.g. `docs/link`), not the resolved target path. The realpath result should still be used only for the within-root safety check / kind determination.
- A concrete approach: in `ListSessionDirectory`, compute `rootRelativePath` from `path.join(parentAbsolute, entryName)` (the entry's own path) rather than from `resolved.absolutePath`.
- Add/adjust a directory-listing test with an in-root symlink asserting the entry's `path` equals its own location (e.g. `docs/link`) and that name/path basename agree, with no duplicate `path` collision against the real target.
- resolution_notes: none
