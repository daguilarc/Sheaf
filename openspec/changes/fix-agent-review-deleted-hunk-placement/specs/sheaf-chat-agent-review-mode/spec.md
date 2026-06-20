## MODIFIED Requirements

### Requirement: arm-24 — Review state: Inline diff file documents

WHEN Agent Review Mode computes state for unstaged text hunks, THE Sheaf Chat service SHALL include file-scoped inline diff documents for files with reviewable hunks; each document SHALL provide ordered rows with stable row identity, row kind, line text, associated hunk identity when applicable, and old/new line number metadata sufficient for the browser to render inline additions, deletions, unchanged context, hunk anchors, and comment placement while preserving each hunk row's original placement in file order, including pure deletions represented by zero-length new-file ranges.

#### Scenario: Inline document contains row metadata

- **WHEN** the service reports Agent Review state for a file with an unstaged text hunk
- **THEN** that file's inline diff document contains ordered rows for unchanged context, additions, and deletions
- **AND** rows belonging to a hunk include that hunk's `hunkId`

#### Scenario: Deleted old lines do not require disk content

- **WHEN** a hunk deletes a line that is no longer present in the worktree file
- **THEN** the inline diff document still includes that deleted line from Git diff data

#### Scenario: Pure deletion after context line

- **WHEN** Git reports a zero-context pure deletion hunk with a zero-length new-file range after an unchanged worktree line
- **THEN** the inline diff document places the preceding unchanged line before the deleted row
- **AND** places following unchanged worktree rows after the deleted row

#### Scenario: Staged hunk disappears from unstaged diff

- **WHEN** an Agent Review stage command succeeds for the focused hunk
- **THEN** the recomputed Agent Review state no longer includes that hunk in the unstaged inline diff document
- **AND** the selected file view reflects the staged worktree content as normal file content for that area

#### Scenario: Unsupported diff has no inline document

- **WHEN** Git reports a binary or unsupported diff entry
- **THEN** the service does not expose an inline diff document for that entry
