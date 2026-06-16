## MODIFIED Requirements

### Requirement: arm-3 — Hunk model: Unstaged hunk snapshots

WHEN Agent Review Mode is available, THE Sheaf Chat service SHALL compute ordered unstaged zero-context text hunks from the Git worktree such that changed runs separated by one or more unchanged lines are represented as separate hunks, and represent each hunk with source provider `sheaf-chat`, repository root, session identity, root-relative file path, stable hunk id, hunk header, patch hash, patch text, and action availability for navigation, stage, revert, and undo.

#### Scenario: Unstaged text hunks exist

- **WHEN** the worktree contains unstaged text hunks under the session root
- **THEN** the Agent Review state contains ordered hunk snapshots with provider, repository, file, identity, header, patch hash, patch text, and action availability

#### Scenario: Separated edits split into separate hunks

- **WHEN** a text file has two changed runs under the session root with at least one unchanged line between them
- **THEN** the Agent Review state exposes those changed runs as separate ordered hunk snapshots

#### Scenario: Contiguous edits remain one hunk

- **WHEN** a text file has multiple adjacent changed lines under the session root with no unchanged line between them
- **THEN** the Agent Review state exposes those adjacent changed lines as one hunk snapshot

#### Scenario: No unstaged hunks

- **WHEN** the worktree contains no unstaged text hunks under the session root
- **THEN** the Agent Review state reports no current hunk and stage/revert navigation unavailable

#### Scenario: Binary or unsupported diff

- **WHEN** Git reports a binary or unsupported diff entry
- **THEN** the Agent Review state does not expose it as a stageable text hunk

### Requirement: arm-4 — Focus and navigation

WHEN a browser client enters Agent Review Mode, THE Sheaf Chat UI SHALL focus an available current hunk and keep the service informed of the focused hunk; WHEN navigation commands select a different hunk, THE service SHALL broadcast the new current hunk and THE UI SHALL reveal that hunk in the file viewer with up to three visible inline rows above the hunk when such rows exist.

#### Scenario: Mode entered with hunks

- **WHEN** a client enters Agent Review Mode and unstaged hunks are available
- **THEN** the UI focuses a current hunk and the service reports that hunk as focused

#### Scenario: Navigate to next hunk

- **WHEN** a next-hunk command succeeds
- **THEN** the service broadcasts the new current hunk
- **AND** connected Agent Review UIs reveal that hunk in the file viewer

#### Scenario: Navigated hunk has leading context

- **WHEN** navigation selects a hunk whose inline file has at least three rows before that hunk's first row
- **THEN** connected Agent Review UIs reveal the hunk with three visible inline rows above the hunk

#### Scenario: Navigated hunk near file start

- **WHEN** navigation selects a hunk whose inline file has fewer than three rows before that hunk's first row
- **THEN** connected Agent Review UIs reveal the hunk using the earliest available inline row as the scroll target

#### Scenario: Focus cleared

- **WHEN** the user exits Agent Review Mode or closes the last review socket
- **THEN** the service clears the focused hunk reported to Dictator for that session
