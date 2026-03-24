# Scope

## Quest

- Name: `open_file_presentation`
- Main Quest: `memory_model`
- Created: `2026-03-24`

## Summary

Improve how file state-context entries are presented to agents by preserving the
operation that produced each file snapshot.

Today, file context is effectively framed as generic "read" content. This side
quest introduces operation-aware presentation so injected file context can say
whether the model just read, wrote, or patched a file, while preserving the
same open-file semantics used today.

This is a small behavioral refinement and should not require redesigning the
memory model.

## Requested Behavior

- Track and present file-origin actions as:
  - `read` when file content came from a read operation.
  - `write` when file content came from a write operation.
  - `patch` when file content came from a patch operation.
- Keep contextual semantics the same as current "read/open file context"
  behavior; only presentation and operation labeling change.
- When injecting file content, the preface should indicate the relevant action,
  such as:
  - "You just read this file..."
  - "You just wrote this file..."
  - "You just patched this file..."

## Deferred Injection Behavior

The runtime currently has cases where a file's first operation is not injected
immediately because a later operation for the same file supersedes it (for
example, read followed by write to the same file).

For those cases:

- Do not silently skip the earlier event.
- Inject an explicit deferred-content placeholder note at the earlier point,
  e.g.:
  - "You just read this file; its contents will appear later in your context."

## Already-Injected File Note

When context building encounters file state-context entries for a file that has
already been injected:

- Inject a note that keeps operation context visible, e.g.:
  - "You just [read/wrote/patched] this file; its contents will appear later in
    your context."
- The note should use the specific operation represented by that state-context
  entry.

## Goals

- Add operation-aware file-context presentation for `read`, `write`, and
  `patch`.
- Preserve existing file-context semantics and ordering as much as possible.
- Replace silent skips with explicit deferred-content notes.
- Ensure repeated entries for already-injected files remain understandable via
  operation-aware notes.

## Non-Goals

- Changing how files are opened/closed in state context.
- Redesigning token-budget policy or compaction strategy.
- Expanding this quest into unrelated tool-call summary or transport changes.
