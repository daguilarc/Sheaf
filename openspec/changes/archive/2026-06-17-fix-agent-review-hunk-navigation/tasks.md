## 1. Targeted Hunk Mutation

- [x] 1.1 Add or extend server-side Agent Review test fixtures with multiple files and multiple separated hunks per file, including a non-first hunk whose staged/reverted location can be distinguished from neighboring hunks.
- [x] 1.2 Update targeted hunk mutation to validate the selected hunk id and patch hash immediately before applying the patch.
- [x] 1.3 Add post-apply verification that the targeted hunk was removed from the expected unstaged side and sibling hunks in the same file remain when expected.
- [x] 1.4 Roll back or report a failed command result when post-apply verification detects that Git applied a hunk somewhere other than the selected snapshot.
- [x] 1.5 Add explicit tests for staging and reverting a non-first hunk in a file without staging or reverting earlier/later hunks.
- [x] 1.6 Add undo coverage proving undo-stage and undo-revert restore the selected hunk and rejected-hunk markers without disturbing sibling hunks.

## 2. File-Boundary Navigation Semantics

- [x] 2.1 Update post-mutation refresh/focus selection so stage, revert, and undo preserve focus within the previously focused file when that file still has hunks.
- [x] 2.2 Update post-mutation refresh/focus selection so finishing the final hunk in a file leaves no hunk focused instead of selecting another file.
- [x] 2.3 Keep next-file and previous-file commands as the only way to cross into another file, including from the no-focused-hunk state after a file is complete.
- [x] 2.4 Add server WebSocket command tests for completing a file, asserting no automatic cross-file advance, then pressing next-file to advance explicitly.

## 3. Launchpad Review Cell Focus Gating

- [x] 3.1 Change Dictator cell painting so unfocused Agent Review sessions still paint `(3,3)` green when an active serialized review draft is ready to insert.
- [x] 3.2 Keep all navigation and mutation cells off while no Agent Review browser client is focused.
- [x] 3.3 Change cell press handling so unfocused navigation/mutation presses remain ignored, while unfocused `(3,3)` presses insert the serialized review only when a draft is armed.
- [x] 3.4 Add fake Dictator RPC tests covering unfocused no-draft dark state, unfocused armed-review green state, successful paste, and failed paste preserving the draft.

## 4. Inline Reveal Offset

- [x] 4.1 Fix the inline hunk reveal target helper to convert `parent.children` with `Array.from` and preserve the intended three-row context target (`index - 3`) above the selected hunk.
- [x] 4.2 Preserve the existing no-scroll behavior when the selected hunk's changed rows are already fully visible.
- [x] 4.3 Add UI tests for three-row context scrolling, near-file-start clamping, and already-visible no-scroll behavior.

## 5. Randomized Browser Workflow Regression

- [x] 5.1 Build a deterministic seeded Agent Review workflow test harness with fake Agent Review WebSocket frames and fake Dictator RPC/cell events; do not require Dictator to be running.
- [x] 5.2 Generate randomized review sessions with multiple files, multiple hunks per file, and comments/rejected markers with expected model state tracked in the test.
- [x] 5.3 Simulate navigation button use that jumps between hunks and files, skips decisions, adds and edits comments, stages selected hunks, reverts selected hunks, undoes mutations, changes focus/presence, and presses `(3,3)` to paste.
- [x] 5.4 Assert after every randomized step that the UI focused hunk/file, rendered comments, button availability, fake Launchpad colors, staged/unstaged model, undo model, and serialized review draft match the expected state.
- [x] 5.5 Run the randomized workflow under a fixed seed in CI and log the seed so failures can be reproduced locally; use Playwright for this test only if the existing UI harness cannot provide reliable viewport geometry.

## 6. Verification

- [x] 6.1 Run the targeted Sheaf Chat Agent Review server tests.
- [x] 6.2 Run the targeted Sheaf Chat UI/browser tests that cover inline reveal and randomized review workflow behavior.
- [x] 6.3 Run the full `projects/sheaf-chat` test suite or the repository's documented Sheaf Chat test command.
- [x] 6.4 Run `openspec status --change "fix-agent-review-hunk-navigation"` and confirm the change is apply-ready.
