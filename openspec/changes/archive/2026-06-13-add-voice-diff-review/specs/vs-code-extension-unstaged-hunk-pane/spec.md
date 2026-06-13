## ADDED Requirements

### Requirement: vshu-10 — Current hunk review context
WHEN the extension publishes controller state while a current hunk exists, THE extension SHALL include review context for that hunk: repo root, file path, hunk id, hunk index/count, hunk header, patch hash, and the single-hunk patch text.

#### Scenario: State snapshot contains hunk patch
- **WHEN** the active hunk pane has a current hunk
- **THEN** the controller state snapshot includes the current hunk's single-hunk patch text and identity metadata

#### Scenario: No current hunk context
- **WHEN** the active file has no current hunk
- **THEN** the controller state snapshot reports no current hunk review context

### Requirement: vshu-11 — Mutation result review facts
WHEN the extension completes a hunk mutation command, THE extension SHALL include review facts in the command result for successful reverts and successful undo operations that restore a reverted hunk.

#### Scenario: Revert reports reverted hunk
- **WHEN** `revert-current-hunk` succeeds
- **THEN** the command result identifies the reverted hunk using the hunk context captured before mutation

#### Scenario: Undo revert reports restored hunk
- **WHEN** `undo` succeeds for a previous revert operation
- **THEN** the command result identifies the restored hunk using the undo entry's saved hunk context

#### Scenario: Undo stage has no restored revert
- **WHEN** `undo` succeeds for a previous stage operation
- **THEN** the command result does not report a restored reverted hunk

#### Scenario: Failed command has no review facts
- **WHEN** a hunk mutation command fails
- **THEN** the command result does not report review facts
