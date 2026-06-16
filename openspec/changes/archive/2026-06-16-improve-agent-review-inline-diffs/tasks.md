## 1. Inline Review Data Model

- [x] 1.1 Add `AgentReviewInlineFile`, `AgentReviewInlineRow`, and row-kind types to `projects/sheaf-chat/src/server/agentReview/types.ts`.
- [x] 1.2 Extend `AgentReviewState` with inline review documents for files that contain reviewable hunks.
- [x] 1.3 Update any test helpers or frame assertions that construct `AgentReviewState` manually.

## 2. Git Diff Parsing and Inline Document Builder

- [x] 2.1 Refactor `projects/sheaf-chat/src/server/agentReview/git.ts` so parsed file diffs retain hunk old/new ranges and typed hunk lines.
- [x] 2.2 Implement an inline document builder that combines parsed Git diff data with current worktree file content.
- [x] 2.3 Ensure deleted rows come from Git diff data, added/context rows align to current file content, and every hunk row carries the existing `hunkId`.
- [x] 2.4 Keep binary and unsupported diffs excluded from both hunk snapshots and inline documents.
- [x] 2.5 Verify that staging a hunk and recomputing state removes that hunk from the inline document while leaving the staged worktree content as normal rows.

## 3. Agent Review Service State

- [x] 3.1 Include inline documents in Agent Review bootstrap, state, and command-result frames.
- [x] 3.2 Preserve existing stage, revert, undo, review draft, Dictator bridge, and presence-gating behavior while adding the new state fields.
- [x] 3.3 Add defensive handling so clients can still operate if an inline document is absent for an unsupported file.

## 4. Browser Inline Review UI

- [x] 4.1 Add UI helpers in `projects/sheaf-chat/src/ui/sheaf-chat.js` to find the selected file's inline review document and current focused hunk.
- [x] 4.2 Replace the separate focused-hunk patch panel with a dedicated inline review renderer when Agent Review Mode is active and an inline document exists.
- [x] 4.3 Render row elements with stable row IDs, hunk IDs, row-kind classes, and focused/non-focused classes.
- [x] 4.4 Style additions and deletions in `projects/sheaf-chat/src/ui/sheaf-chat.css` with bright focused red/green and duller non-focused red/green treatments.
- [x] 4.5 Mount the visible review comment textarea adjacent to the focused hunk's inline rows and preserve existing comment input/focus/blur frame behavior.
- [x] 4.6 Keep the normal markdown, highlighted, and plain file preview paths for non-review mode and files without inline review documents.

## 5. Navigation and Scroll Behavior

- [x] 5.1 Track a pending focused-hunk scroll target when Agent Review state changes.
- [x] 5.2 After file loading and render complete, scroll the focused hunk anchor into view for bootstrap and navigation-driven focus changes.
- [x] 5.3 Ensure next-file and previous-file open the selected hunk's file before attempting to scroll.
- [x] 5.4 Ensure staging, reverting, undo, and external refreshes render the recomputed inline document without leaving stale hunk anchors or comment boxes behind.
- [x] 5.5 Position each focused hunk's first changed row near the top of the viewport with roughly two rows of preceding context instead of centering the hunk.
- [x] 5.6 Leave the file viewport in place when navigation targets a hunk that is already fully visible.

## 6. Tests and Verification

- [x] 6.1 Add server tests for inline documents with additions, deletions, mixed hunks, multiple hunks in one file, and unsupported diffs.
- [x] 6.2 Add a server test proving a successfully staged hunk disappears from the unstaged inline document after recomputation.
- [x] 6.3 Add UI tests proving all selected-file hunks render inline, focused rows use focused classes, non-focused rows use muted classes, and the old patch panel is absent.
- [x] 6.4 Add UI tests for hunk navigation scroll anchoring and comment textarea placement next to the focused inline hunk.
- [x] 6.5 Add a Chromium Playwright integration test using the repository/workspace fixture to verify the inline Agent Review workflow end to end.
- [x] 6.6 Add browser assertions that navigation places the focused hunk near the top of the viewport, not centered low on the screen.
- [x] 6.7 Add browser assertions that already-visible hunk navigation does not change the file viewport scroll position.
- [x] 6.8 Run `npm run build` and the relevant Sheaf Chat test suite from `projects/sheaf-chat`.
