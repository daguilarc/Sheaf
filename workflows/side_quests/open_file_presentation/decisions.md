# Decisions

- 2026-03-24: Side quest created.
- 2026-03-24: Scope is intentionally narrow. This quest only changes how
  existing file state-context entries are classified and presented
  (`read`/`write`/`patch`) and how deferred file-content notes are emitted.
- 2026-03-24: The semantics of open file context remain unchanged. The change is
  presentation-focused, with the same contextual behavior as current file-open
  state.
- 2026-03-24: File state-context records now carry an optional `action` field
  for file-opening operations. This leaves the existing `operation` field and
  broader open/close/rename state machine unchanged while allowing injected file
  context to distinguish `read`, `write`, and `patch`.
- 2026-03-24: Context assembly now assigns real file-content injection to the
  latest open entry for a file and turns earlier same-file open entries into
  explicit deferred-content notes. This preserves one-content-per-open-file
  semantics while replacing the previous silent-skip behavior the quest called
  out.
- 2026-03-25: Polishing keeps deferred placeholder notes scoped to files only.
  Duplicate directory reads revert to the prior silent-skip behavior because
  the quest spec is intentionally file-focused.
- 2026-03-25: Deferred file placeholder notes now render before any filesystem
  existence check. If the file was deleted later, the earlier deferred entry
  still reports the placeholder note while the latest non-deferred entry
  reports the deletion.
- 2026-03-25: User approved closing this side quest and committing the full
  working tree, so the quest stage moved from `polishing` to `complete`.
