## 1. Parity Test Harness

- [x] 1.1 Add shared Agent Review test helpers that can drive the same scripted flow through browser command buttons or fake Dictator RPC `launchpad.cellPressed` events.
- [x] 1.2 Make the paired helpers assert selected file tab, focused hunk id, inline focused rows, scroll target, command-result/state delivery, and Launchpad cell availability after each step.
- [x] 1.3 Add a browser-control baseline test for cross-file navigation from a selected file with hunks.
- [x] 1.4 Add the matching Launchpad-cell test for cross-file navigation from a selected file with hunks, and confirm it fails against the current incorrect behavior before implementation changes.
- [x] 1.5 Add browser-control and Launchpad-cell paired tests for navigating from a selected file that has no reviewable hunk to the next or previous hunk file.
- [x] 1.6 Add browser-control and Launchpad-cell paired tests for same-file next/previous hunk navigation.
- [x] 1.7 Add browser-control and Launchpad-cell paired tests for stage, revert, and undo post-command file-viewer synchronization.
- [x] 1.8 Add or extend disabled-action tests so an unavailable browser command corresponds to an off Launchpad cell and a no-op Launchpad press.

## 2. Command Path Convergence

- [x] 2.1 Refactor Agent Review Launchpad coordinate handling so navigation and mutation cells synthesize the same Agent Review command model used by browser WebSocket commands.
- [x] 2.2 Ensure Launchpad-originated navigation and mutation commands produce command-result/state semantics equivalent to browser-originated commands for connected review clients.
- [x] 2.3 Keep the `(3,3)` review/comment/post Launchpad cell on its existing review-cell-specific path and document that it is intentionally outside navigation/mutation command parity.
- [x] 2.4 Remove or neutralize browser-only command intent state that makes selected-file synchronization depend on whether the browser initiated the command.
- [x] 2.5 Ensure successful command results from any origin open the authoritative current hunk's file and reveal the hunk in the unified file viewer.
- [x] 2.6 Ensure client focus synchronization does not immediately override a successful Launchpad-originated navigation result with the previously selected file.

## 3. Verification

- [x] 3.1 Run the new Launchpad parity tests alone and confirm they pass after the fix.
- [x] 3.2 Run the full Sheaf Chat test suite with `/opt/homebrew/bin/npm test` from `projects/sheaf-chat`.
- [x] 3.3 Run focused Dictator RPC/Launchpad tests that cover external cell ownership and press forwarding.
- [x] 3.4 Update Sheaf Chat coverage documentation if it tracks Agent Review input parity or if the new tests close an existing gap.
- [x] 3.5 Manually smoke-test, or document why not smoke-tested, browser and Launchpad navigation for next hunk, next file, non-hunk selected file, stage, revert, and undo.

Manual hardware smoke was not run in this implementation pass. The completed verification uses fake Dictator RPC `launchpad.cellPressed` tests for next hunk, next file, non-hunk selected-file navigation, disabled actions, stage, undo, and revert, plus browser harness coverage for the unified file viewer following Launchpad-origin command results.
