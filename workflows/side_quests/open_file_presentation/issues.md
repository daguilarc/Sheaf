# Issues

## Deferred directory injections render full content instead of being skipped

The deferred-injection branch at `runtime.py:2030-2038` creates
`StateContextInjection(deferred=True)` for **any** context type whose key is
already in `state_map`, including directories. However,
`_render_state_injection` only checks `injection.deferred` inside the
`state_key.context_type == "file"` branch. For directories, the `deferred` flag
is ignored and the full directory listing is rendered.

Before this change, the `if canonical_key in state_map: continue` path silently
skipped all duplicate entries — files and directories alike. Now, duplicate
directory entries produce a `StateContextInjection` that passes through to
rendering and emits a full duplicate listing. This is a behavioral regression
for directories even though the spec is file-scoped.

Fix options:
- Gate the deferred-injection creation on `context_type == "file"` so
  directories keep their previous silent-skip behavior.
- Or handle `deferred` in the directory rendering path too (but the spec doesn't
  call for directory deferred notes, so the first option is simpler).

Status: `completed`

Next Action: `fix` — Fixed: deferred-injection creation gated on
`context_type == "file"`; directories revert to silent-skip. Covered by
`test_context_builder_keeps_duplicate_directory_reads_silently_skipped`.

## Type hint mismatch in test helper `_state_ops_json`

The type hint declares `tuple[str, str, str, str | None, str | None]` (a
5-tuple) but the runtime code accepts 4-element tuples via `if len(op) == 4`.
The hint should be a union or the callers should all pass 5-tuples. Minor test
hygiene — not a production issue.

Status: `completed`

Next Action: `fix` — Fixed: signature now uses a union of 4-tuple and 5-tuple,
body unpacks via `len(op)` check.

## Deferred injection bypassed by existence check for deleted files

`_render_state_injection` (`runtime.py:2115-2117`) checks `path.exists()`
before checking `injection.deferred`. For deferred injections, the file content
is not needed — the method only emits a placeholder note like "You just read
this file; its contents will appear later in your context." If the file was
deleted between the earlier and later operations, the deferred branch is never
reached and the method incorrectly returns "Cannot read …, it may have been
moved or deleted."

The fix is to move the `injection.deferred` check (and its early return) above
the existence check within the `context_type == "file"` branch, so deferred
notes are emitted regardless of whether the file still exists on disk.

Status: `completed`

Next Action: `fix` — Fixed: `injection.deferred` check moved above
`path.exists()` in `_render_state_injection`. Covered by
`test_context_builder_keeps_deferred_file_note_when_file_is_deleted`.
