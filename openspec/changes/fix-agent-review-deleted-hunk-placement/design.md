## Context

Agent Review computes inline file documents from `git diff --unified=0` plus the current worktree file. The current builder uses each hunk's `newStart` as the insertion point for changed rows. That works for replacements and additions, but Git represents a pure deletion as a zero-length new-file range after the preceding live line, such as `@@ -3 +2,0 @@`; inserting at `newStart` places the deleted row before line 2 instead of after it.

The browser renders rows in the order provided by the service, so the misplaced deleted line originates in server-side inline document construction.

## Goals / Non-Goals

**Goals:**

- Preserve original file placement for pure deletion rows in Agent Review inline diff documents.
- Keep replacements, additions, and mixed hunks ordered as they are today.
- Cover the zero-length new-range case with a regression test that asserts row order relative to surrounding context.

**Non-Goals:**

- Change the Agent Review WebSocket or REST state shape.
- Change hunk mutation behavior, patch application, or focus/navigation semantics.
- Replace Git zero-context diff parsing with a new dependency.

## Decisions

1. Treat `newCount === 0` as an insertion after `newStart`.

   For pure deletion hunks, the inline builder should push live worktree context through `newStart` before emitting deletion rows. In the existing exclusive helper this means using an insertion point of `hunk.newStart + 1` for zero-length new ranges.

   Alternative considered: request extra unified context from Git and infer placement from surrounding context lines. That would make hunk splitting less direct and could merge currently separate hunks, so it is a larger behavioral change than needed.

2. Keep row metadata unchanged.

   Deleted rows already carry `oldLineNumber`, added/context rows carry `newLineNumber`, and clients already render based on the ordered row array. The fix should only change service row ordering, not the serialized row fields.

   Alternative considered: add an explicit insertion anchor field to deletion rows. That would expose implementation detail in the protocol and require UI changes for a bug the server can resolve internally.

3. Add server-side ordering coverage.

   The regression should create a real Git diff where a line is deleted immediately after an unchanged boundary line, then assert the inline document orders the boundary context row before the deleted row and the following context row after it.

   Alternative considered: only add a browser/UI fixture. That would verify rendering but would not isolate the source of the ordering bug.

## Risks / Trade-offs

- [Off-by-one at file start] -> Cover deletions at or near the beginning of a file, where `newStart` can be `0` or `1` depending on Git's hunk header.
- [Mixed hunks accidentally shifted] -> Gate the adjusted insertion point on `newCount === 0`, leaving replacements and additions on the existing path.
- [Adjacent deletion hunks] -> Use Git's parsed hunk order and existing row index generation, so adjacent zero-length ranges remain deterministic.
