## 1. Test Harness Foundations

- [x] 1.1 Review the existing Agent Review WebSocket test helpers and identify reusable connection, command, frame-wait, and Git fixture utilities.
- [x] 1.2 Add a deterministic seeded RNG helper for the state-machine test with assertion labels that include seed and step.
- [x] 1.3 Add helper types for generated semantic line records, edit records, oracle repository state, oracle undo entries, and executed operation records.

## 2. Semantic Fixture Generator

- [x] 2.1 Implement a generator that creates multiple real Git-tracked files with stable semantic line identities and commits the base state.
- [x] 2.2 Generate staged edit records and write them to the index before adding unstaged worktree edits.
- [x] 2.3 Generate unstaged edit records covering replacements, pure insertions, pure deletions, duplicate changed content, close hunks, large insert blocks before later edits, and same-file sibling hunks.
- [x] 2.4 Keep generated edit regions semantically non-overlapping while still allowing Git to regroup or reheader hunks after partial staging.
- [x] 2.5 Record concise seed fixture summaries for failure messages without depending on Agent Review hunk ids or patch hashes.

## 3. Independent Oracle

- [x] 3.1 Implement oracle state transitions for stage, revert, undo-stage, undo-revert, navigation/focus, unavailable commands, and stale command attempts.
- [x] 3.2 Compute expected index file contents and worktree file contents from semantic edit records rather than Git patch parsing.
- [x] 3.3 Track expected rejected-marker state from successful reverts and undo-reverts.
- [x] 3.4 Track expected undo availability and last mutation semantics independently of Agent Review service internals.
- [x] 3.5 Add oracle diagnostics that report mismatched files, edit ids, command result fields, and review-draft markers.

## 4. Random Operation Driver

- [x] 4.1 Drive Agent Review through `/ws/agent-review` bootstrap and command frames only.
- [x] 4.2 At each step, choose a randomized operation from the model-meaningful operation set: navigation, focus, stage, revert, undo, and stale command attempts.
- [x] 4.3 Use Agent Review state only to select exposed command targets and to compare observed results, not to compute oracle expectations.
- [x] 4.4 Run a fixed bounded seed and step count by default, with an environment variable or equivalent deterministic option for a larger local stress run.

## 5. Per-Step Assertions

- [x] 5.1 After every command, assert expected command success, failure, stale flag, and action identity.
- [x] 5.2 After every command, assert Git index file contents match the oracle using `git show :<file>` or equivalent stable Git reads.
- [x] 5.3 After every command, assert worktree file contents match the oracle by reading files from disk.
- [x] 5.4 After every command, assert staged and unstaged diff presence/absence match the oracle without asserting exact hunk grouping.
- [x] 5.5 After every command, assert review-draft rejected markers and undo availability match the oracle.
- [x] 5.6 After every command, assert Agent Review state invariants: current hunk nullability, action availability consistency, and no stale target success after captured stale command attempts.

## 6. Verification

- [x] 6.1 Run the new randomized state-machine test by itself and confirm failures report seed, step, operation, target summary, and semantic mismatch details.
- [x] 6.2 Run the existing Agent Review REST/WebSocket test file to confirm focused regressions still pass.
- [x] 6.3 Run the project-level Sheaf Chat test command used for Agent Review changes.
- [x] 6.4 Update any test documentation or coverage notes if the project tracks Agent Review coverage outside OpenSpec.
