# Design

## Intent

Implement a minimal, low-risk refinement to file state-context rendering:

- persist or derive the operation label (`read`/`write`/`patch`) alongside file
  state-context entries
- use that label when constructing injected file-context messages
- emit explicit deferred-content notes when content is intentionally postponed

The storage and lifecycle behavior of file state context should remain aligned
with the existing model.

## Planned Changes

### 1. Add Operation Label To File State-Context Entries

- Extend the file state-context shape to include an operation/action field with
  allowed values `read`, `write`, and `patch`.
- Map existing file-affecting tools to those values:
  - `read_file` -> `read`
  - file creation/write-style tools -> `write`
  - `apply_patch` -> `patch`
- Preserve backward compatibility for existing rows that do not carry the new
  field by defaulting to current behavior (treated as `read` presentation).

### 2. Update Injection Prefaces To Be Action-Aware

- Where file contents are injected, switch from generic wording to operation
  wording tied to each entry's action.
- Keep current content payload formatting and ordering behavior unless required
  by the deferred-note changes below.

### 3. Replace Silent Skips With Deferred Notes

- In code paths that currently suppress an earlier file injection because a later
  entry for the same file will supply content, emit an explicit note at the
  earlier point:
  - "You just <action> this file; its contents will appear later in your
    context."
- This applies to read-before-write/patch supersession and similar same-file
  postponement cases.

### 4. Emit Notes For Already-Injected File Entries

- During context assembly, if an entry refers to a file whose contents are
  already injected in the current build pass, emit an operation-aware note
  instead of re-injecting content.
- The note text should use the entry's action (`read`, `write`, `patch`) and
  consistently communicate that content appears later in context.

## Validation

- Add/adjust unit tests for state-context mutation generation to assert operation
  labels are set correctly for read/write/patch-producing tool calls.
- Add/adjust context-render tests to verify operation-aware message prefixes.
- Add/adjust tests for deferred-content paths (for example, read then write same
  file) to verify placeholder-note emission instead of silent skipping.
- Add/adjust tests for repeated/already-injected file entries to verify
  operation-aware note rendering.
- Include compatibility coverage for legacy state-context entries missing the new
  action field.

## Exit Criteria

- File state-context entries can represent `read`, `write`, and `patch`.
- Context injection messages clearly identify which action occurred.
- Previously silent skip paths now emit explicit deferred-content notes.
- Already-injected file entries emit operation-aware notes rather than raw
  duplicate content.
- The implementation remains narrow and does not alter broader memory-model
  lifecycle semantics.
