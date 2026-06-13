## 1. Runtime Config And Prompt

- [x] 1.1 Add `review_system_prompt` to Dictator runtime config decoding, defaults, patch validation, web API models, and config contract docs.
- [x] 1.2 Add `code_review_refiner_v1.md` under the system prompt catalog with instructions to refine spoken code-review comments while preserving review intent.
- [x] 1.3 Add tests proving `review_system_prompt` defaults, prompt catalog selection, web config get/patch behavior, and safe-config reset behavior.

## 2. VS Code Hunk Protocol

- [x] 2.1 Extend shared TypeScript and Swift hunk protocol types with current hunk review context: repo root, file, hunk id, index/count, header, patch hash, and patch text.
- [x] 2.2 Extend extension controller state snapshots to include the current hunk's single-hunk patch text when a current hunk exists.
- [x] 2.3 Extend extension command results with review facts for successful revert and successful undo-revert operations.
- [x] 2.4 Update Dictator hunk registry, command-result handling, diagnostics, and tests to retain hunk context and ignore failed mutation facts.

## 3. Diff Review State

- [x] 3.1 Add a Dictator in-memory diff review store with ordered comment and reverted-hunk entries, hunk snapshot storage, active-review status, append, remove-reverted, serialize, and clear operations.
- [x] 3.2 Implement serialization text that includes spoken comments and rejected hunks while omitting accepted/staged hunks without comments.
- [x] 3.3 Add unit tests for review creation, entry ordering, hunk snapshot retention, reverted marker removal, serialization, clear-on-success, and preserve-on-insert-failure behavior.

## 4. Review Recording Flow

- [x] 4.1 Add a Launchpad review-comment recording mode that snapshots the focused current hunk at recording start.
- [x] 4.2 Add reusable structured refinement context blocks to the prompt builder, preserving existing standard dictation behavior when no blocks are supplied.
- [x] 4.3 Reuse the existing audio capture and STT path, then refine with `review_system_prompt` and a structured hunk context block instead of selected-text replacement context.
- [x] 4.4 Append non-empty refined review text to the active diff review and append nothing on empty transcript, cancellation, or failed refinement.
- [x] 4.5 Add tests for context-block rendering, hunk-context input construction, prompt override selection, recording cancellation, and comment append behavior.

## 5. Launchpad Review Pad

- [x] 5.1 Reserve `(2,7)` in product and fixture Launchpad layouts so no static key action conflicts with the review pad.
- [x] 5.2 Implement review pad rendering: red for active review recording/refinement, blue for focused hunk with active review, grey for focused hunk without active review, green for away-with-review, and off otherwise.
- [x] 5.3 Implement review pad press handling for start recording, stop/process recording, post review, and off-state consumption.
- [x] 5.4 Extend contextual backspace to cancel active review recording or review refinement without appending review entries.
- [x] 5.5 Add Launchpad tests for all review pad colors, press actions, render invalidation, and contextual-backspace cancellation.

## 6. Revert And Undo Tracking

- [x] 6.1 Wire successful VS Code `revert` command results into the diff review store as reverted-hunk markers.
- [x] 6.2 Wire successful undo-revert results into the diff review store to remove the matching reverted marker.
- [x] 6.3 Ensure stage, undo-stage, failed revert, and failed undo results do not create or remove review entries.
- [x] 6.4 Add Swift and TypeScript tests covering revert/undo review facts end to end.

## 7. Posting And Verification

- [x] 7.1 Implement away-mode review posting through clipboard insertion at the active cursor without synthesizing Enter or submit behavior, snapshotting/restoring the prior clipboard and clearing the review only after insertion and clipboard restoration both succeed.
- [x] 7.2 Update diagnostics to report active review presence, entry count, and review recording state.
- [x] 7.3 Run Dictator Swift tests and VS Code extension Node tests.
- [x] 7.4 Manually smoke-test the Launchpad workflow: comment on hunk, revert hunk, undo revert, navigate to agent chat, post review, and confirm review state clears.
