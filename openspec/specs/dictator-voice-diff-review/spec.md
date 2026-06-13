# Capability: Dictator Voice Diff Review

Project: `projects/dictator`
ID prefix: `vdr` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Dictator maintains a lightweight in-memory voice diff review while the user
reviews VS Code hunk-pane changes from the Launchpad. Spoken review comments,
reverted hunk markers, and undo-revert cleanup are serialized into a
self-contained review that can be pasted into an agent chat without submitting
it automatically.

## Requirements

### Requirement: vdr-1 — Active diff review state
WHEN a voice diff review entry is created, THE Dictator service SHALL maintain at most one active in-memory diff review containing ordered entries, where each entry stores a hunk snapshot and either a review comment or a reverted-hunk marker.

#### Scenario: First entry creates review
- **WHEN** no active diff review exists and Dictator records a review comment or reverted-hunk marker
- **THEN** Dictator creates an active in-memory diff review and appends that entry

#### Scenario: Entry order is preserved
- **WHEN** multiple comments and reverted-hunk markers are recorded during one review
- **THEN** Dictator preserves their insertion order in the active review

#### Scenario: Hunk snapshot is stored
- **WHEN** Dictator records an entry
- **THEN** the entry stores repo root, file path, hunk id, hunk header, patch hash, and patch text from the VS Code hunk snapshot

### Requirement: vdr-2 — Hunk-aware review comment recording
WHEN the review pad starts recording while a healthy focused VS Code hunk target has a current hunk, THE Dictator service SHALL snapshot that hunk, transcribe the audio, refine the transcript with the configured review prompt and a reusable refiner context block for the hunk, and append the refined text as a comment entry in the active diff review.

#### Scenario: Recording starts on current hunk
- **WHEN** the review pad is pressed while VS Code is focused on a current hunk and no review recording is active
- **THEN** Dictator starts a review-comment recording and snapshots the current hunk

#### Scenario: Recording completes
- **WHEN** a review-comment recording is stopped and refinement returns non-empty text
- **THEN** Dictator appends that refined text as a comment entry for the hunk captured at recording start

#### Scenario: Empty review comment
- **WHEN** a review-comment recording produces empty refined text
- **THEN** Dictator appends no review entry and leaves any existing active review unchanged

#### Scenario: Recording cancelled
- **WHEN** the user cancels a review-comment recording before completion
- **THEN** Dictator appends no review entry for that recording

### Requirement: vdr-3 — Reverted hunk tracking
WHEN Dictator receives a successful VS Code `revert` command result with hunk context, THE Dictator service SHALL append a reverted-hunk marker to the active diff review; WHEN Dictator receives a successful undo result for that same revert, THE service SHALL remove the matching reverted-hunk marker.

#### Scenario: Revert succeeds
- **WHEN** the VS Code extension reports a successful `revert` command with reverted hunk context
- **THEN** Dictator appends a reverted-hunk marker for that hunk

#### Scenario: Undo revert succeeds
- **WHEN** the VS Code extension reports a successful `undo` command that restores a previously reverted hunk
- **THEN** Dictator removes the matching reverted-hunk marker from the active review

#### Scenario: Stage does not create entry
- **WHEN** the VS Code extension reports a successful `stage` command
- **THEN** Dictator creates no diff-review entry unless a spoken comment was recorded separately

### Requirement: vdr-4 — Review serialization and clearing
WHEN the review pad is pressed while an active diff review exists and there is no focused current VS Code hunk target, THE Dictator service SHALL serialize the review, insert it at the active cursor target without synthesizing Enter or any submit action, restore the clipboard contents that existed before posting, and clear the in-memory review only after insertion and clipboard restoration both succeed.

#### Scenario: Review inserted
- **WHEN** the review pad is pressed in away mode and clipboard insertion plus clipboard restoration both succeed
- **THEN** Dictator inserts the serialized review text without synthesizing Enter or submitting it
- **AND** restores the clipboard contents that existed before posting
- **AND** clears the active in-memory review

#### Scenario: Insertion fails
- **WHEN** the review pad is pressed in away mode and clipboard insertion fails
- **THEN** Dictator leaves the active review in memory

#### Scenario: Clipboard restoration fails
- **WHEN** the review pad is pressed in away mode and the serialized review is inserted but the prior clipboard contents cannot be restored
- **THEN** Dictator leaves the active review in memory
- **AND** reports the clipboard restoration failure in diagnostics or logs

#### Scenario: Serialized content includes reviewed hunks
- **WHEN** a review contains spoken comments or reverted-hunk markers
- **THEN** the serialized review includes the associated hunk header, patch hash, and fenced diff block so the coding agent can identify the hunk

#### Scenario: Serialized content includes rejected hunks
- **WHEN** a review contains reverted-hunk markers
- **THEN** the serialized review includes those hunks as rejected code the agent must not reintroduce

#### Scenario: Accepted hunks omitted
- **WHEN** a hunk was staged or left unchanged and has no spoken comment
- **THEN** the serialized review does not mention that hunk

### Requirement: vdr-5 — Review diagnostics
WHEN Dictator exposes diagnostics for VS Code hunk controls or Launchpad state, THE service SHALL include whether an active diff review exists, the active review entry count, and whether a review-comment recording is active.

#### Scenario: Diagnostics requested during review
- **WHEN** diagnostics are requested while a diff review contains entries
- **THEN** Dictator reports that an active review exists and includes its entry count

#### Scenario: Diagnostics requested during recording
- **WHEN** diagnostics are requested while a review-comment recording is active
- **THEN** Dictator reports the review recording state
