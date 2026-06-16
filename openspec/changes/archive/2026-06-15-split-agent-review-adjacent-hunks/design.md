## Context

Agent Review discovers hunks by running `git diff --no-ext-diff --unified=3` for the selected workspace pathspec, parsing Git's unified diff, and using each parsed hunk patch as the unit for navigation, stage, revert, undo, comments, rejected markers, and review serialization. The three-line Git context makes each hunk more readable, but it also lets nearby edits collapse into one review action. In review mode that is too coarse: if there is an unchanged line between two edits, the user expects two independent review decisions.

The UI already renders inline files from current worktree content plus parsed hunk rows, so hunk readability does not have to depend on the hunk patch carrying Git context. We can make the mutation patch minimal while keeping the viewer oriented.

## Goals / Non-Goals

**Goals:**

- Split Agent Review hunks whenever edits are separated by one or more unchanged lines.
- Keep contiguous changed lines grouped as one hunk.
- Preserve existing stage, revert, undo, comment, rejected-marker, Dictator, and review-serialization semantics for the smaller hunk patches.
- Reveal a navigated hunk with up to three visible lines above it in the inline file viewer.
- Keep the implementation local to Sheaf Chat's Agent Review server and UI.

**Non-Goals:**

- Changing general chat diff rendering or any non-Agent Review diff feature.
- Adding user-configurable hunk context size.
- Changing Git's diff algorithm for detecting moved/renamed files beyond Agent Review's current behavior.
- Making binary diffs reviewable.

## Decisions

### Use zero-context Git diffs for Agent Review hunk snapshots

Agent Review hunk discovery should run Git with zero unified context, equivalent to `git diff --no-ext-diff --unified=0 -- <pathspec>`. This makes Git emit distinct hunk headers for changed runs separated by unchanged lines, so Sheaf Chat can continue using Git's hunk boundaries rather than inventing a second splitter.

Alternative considered: keep `--unified=3` and post-process hunks into smaller pieces. That would require rebuilding valid patch headers and old/new line ranges by hand, which is more fragile than asking Git to produce the patch shape we need.

### Apply zero-context patches with Git's zero-context apply mode

Stage, unstage, revert, and restore should continue to use the hunk patch snapshot, but `git apply` invocations must include the zero-context apply flag. Without it, Git may reject valid zero-context patches because normal apply expects contextual lines around hunks.

Alternative considered: keep two patch forms per hunk, one zero-context identity for review and one three-context patch for mutation. That complicates stale validation and review serialization, and it can reintroduce coarse mutation if the apply patch covers neighboring edits.

### Keep the inline viewer context independent of patch context

The hunk patch should be minimal, but the inline file viewer should still render surrounding unchanged file lines using the current file content. Rows that belong to a hunk remain additions/deletions tied to that hunk id; unchanged lines between hunks remain ordinary context rows without a hunk id.

Alternative considered: show only zero-context patch rows. That would make the review surface precise but cramped, especially when navigating through a file by Launchpad.

### Reveal navigated hunks with a three-line lead

When navigation focuses a hunk, the browser should scroll to the hunk anchor with up to three preceding inline rows visible above the first hunk row. Near the start of a file, it should use the earliest available row rather than attempting to overscroll.

Alternative considered: use CSS `scroll-margin-top`. That helps with fixed toolbars but does not directly express "three source rows above the hunk"; an explicit row-anchor target is easier to test and matches the requested behavior.

## Risks / Trade-offs

- [Zero-context patches are less tolerant of concurrent edits] -> Keep the existing `hunkId` and `patchHash` stale checks before mutation, and refresh state after file changes and commands.
- [Duplicate changed text could make zero-context apply ambiguous] -> Use Git's zero-context apply support and rely on line ranges plus stale patch hashes; add regression tests for separated nearby hunks.
- [Patch serialization becomes less visually rich] -> Keep serialized review fenced diffs accurate to the actual review unit, and rely on file path/header/hash plus the UI's inline context for review-time orientation.
- [Scroll offset can be flaky in headless tests] -> Test the row target selection logic in UI unit tests and keep any browser integration assertion tolerant of layout differences.

## Migration Plan

This is an in-place behavior change for Agent Review Mode. No persisted data migration is required because Agent Review state and review drafts are in-memory. Rollback is to restore three-context diff discovery and remove zero-context apply flags and three-row reveal targeting.

## Open Questions

- None. Serialized review entries remain exact minimal hunk patches rather than adding extra surrounding context.
