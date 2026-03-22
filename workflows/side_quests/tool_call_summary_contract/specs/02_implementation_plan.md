# Implementation Plan

## Intent

This side quest should replace ambiguity with a small, testable contract. The
work is expected to be a light Obsidian-only refinement rather than a broad
tooling change.

## Planned Changes

### 1. Lock The File-Oriented Tool List

Treat these tools as the canonical file-oriented summary set:

- `list_directory`
- `read_file`
- `create_file`
- `create_directory`
- `apply_patch`
- `move_path`
- `delete_path`

No legacy alias handling is needed in this side quest. `list_notes` should not
appear in the spec or implementation plan.

### 2. Tighten Path Formatting

Update the Obsidian summary helper so that path display follows this order:

1. Normalize path separators.
2. If the path belongs to `data/vaults/<current-vault>/`, strip that prefix.
3. If the path is exactly the current vault root, show `/`.
4. If the path is relative, keep it as-is.
5. Otherwise, show only the basename.

This intentionally keeps non-current-vault absolute paths compact while still
making current-vault paths readable.

### 3. Keep Directory Summaries Minimal

`list_directory` should remain a path-label-only summary. The summary should use
the derived directory label and should not surface any content-like or
non-essential arguments.

This means there is no special `data` field to preserve for `list_directory`,
and no raw argument dump should be shown.

### 4. Add Explicit Move Summary Behavior

Add first-class summary handling for `move_path` so transcript entries show both
ends of the operation:

- source path label
- destination path label

If either label cannot be derived safely, fall back to the generic move summary
without exposing raw argument maps.

## Validation

- Add or update Obsidian summary tests for current-vault stripping.
- Add a test for the current-vault root rendering as `/`.
- Add a test confirming non-current-vault absolute paths collapse to basename.
- Add a test confirming `list_directory` remains argument-safe.
- Add a test confirming `move_path` shows both source and destination labels.

## Exit Criteria

- The spec names the authoritative file-oriented tools.
- The spec explicitly classifies `list_directory` as file-oriented.
- Legacy `list_notes` language is removed from this side quest.
- The path display contract matches the intended current-vault-only stripping
  behavior.
- The implementation plan is narrow enough to execute without broad UI or
  server changes.
