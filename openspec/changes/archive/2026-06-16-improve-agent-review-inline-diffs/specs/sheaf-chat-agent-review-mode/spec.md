## ADDED Requirements

### Requirement: arm-23 — Review UI: Inline diff file view

WHEN a browser client is in Agent Review Mode and the selected file has Agent Review hunks, THE Sheaf Chat UI SHALL render a processed inline review view for that file that interleaves unchanged file content, added lines, and deleted old lines in file order instead of rendering the focused hunk as a separate fixed patch panel above the file preview.

#### Scenario: All selected-file hunks are visible

- **WHEN** Agent Review Mode is active and the selected file contains multiple unstaged hunks
- **THEN** the inline review view shows every unstaged hunk in that file in file order
- **AND** the view does not limit diff rendering to only the current focused hunk

#### Scenario: Added and deleted lines are inline

- **WHEN** Agent Review Mode renders a file that has an added line and a deleted old line
- **THEN** the added line appears inline with the surrounding code using an addition treatment
- **AND** the deleted old line appears inline at its original position using a deletion treatment

#### Scenario: Focused hunk is visually brighter

- **WHEN** Agent Review Mode renders a selected file that contains the focused hunk and at least one non-focused hunk
- **THEN** rows belonging to the focused hunk use the bright addition and deletion treatments
- **AND** rows belonging to non-focused hunks use duller addition and deletion treatments

#### Scenario: Separate patch panel removed

- **WHEN** Agent Review Mode renders a selected file with a focused hunk
- **THEN** the UI does not render a separate focused-hunk patch preview above the file content
- **AND** the focused hunk is represented within the inline review view

### Requirement: arm-24 — Review state: Inline diff file documents

WHEN Agent Review Mode computes state for unstaged text hunks, THE Sheaf Chat service SHALL include file-scoped inline diff documents for files with reviewable hunks; each document SHALL provide ordered rows with stable row identity, row kind, line text, associated hunk identity when applicable, and old/new line number metadata sufficient for the browser to render inline additions, deletions, unchanged context, hunk anchors, and comment placement.

#### Scenario: Inline document contains row metadata

- **WHEN** the service reports Agent Review state for a file with an unstaged text hunk
- **THEN** that file's inline diff document contains ordered rows for unchanged context, additions, and deletions
- **AND** rows belonging to a hunk include that hunk's `hunkId`

#### Scenario: Deleted old lines do not require disk content

- **WHEN** a hunk deletes a line that is no longer present in the worktree file
- **THEN** the inline diff document still includes that deleted line from Git diff data

#### Scenario: Staged hunk disappears from unstaged diff

- **WHEN** an Agent Review stage command succeeds for the focused hunk
- **THEN** the recomputed Agent Review state no longer includes that hunk in the unstaged inline diff document
- **AND** the selected file view reflects the staged worktree content as normal file content for that area

#### Scenario: Unsupported diff has no inline document

- **WHEN** Git reports a binary or unsupported diff entry
- **THEN** the service does not expose an inline diff document for that entry

### Requirement: arm-25 — Navigation and comments: Inline hunk anchors

WHEN Agent Review Mode changes the focused hunk through bootstrap, next-hunk, previous-hunk, next-file, previous-file, stage, revert, undo, or external state refresh, THE Sheaf Chat UI SHALL open the focused hunk's file when necessary and, after that file has rendered, scroll the inline review view only if the focused hunk's changed rows are not already fully visible; WHEN scrolling is needed, THE UI SHALL position the focused hunk's first changed row near the top of the viewport with a small preceding context offset; WHEN the focused hunk's review comment text box is visible, THE UI SHALL place it adjacent to that hunk's inline rows.

#### Scenario: Next hunk scrolls to anchor

- **WHEN** a next-hunk command selects a different hunk in the current file
- **THEN** the UI scrolls the inline review view so the newly focused hunk's first changed row is visible near the top of the viewport with approximately two inline rows of context above it

#### Scenario: Already-visible hunk navigation does not scroll

- **WHEN** a next-hunk or previous-hunk command selects a different hunk whose added/deleted rows are already fully visible in the current viewport
- **THEN** the UI updates the focused hunk styling
- **AND** does not change the file viewport scroll position

#### Scenario: File navigation opens and scrolls

- **WHEN** a next-file or previous-file command selects a hunk in a different file
- **THEN** the UI opens that file
- **AND** scrolls the inline review view so the selected hunk's first changed row is visible near the top of the viewport with approximately two inline rows of context above it after rendering

#### Scenario: Comment box appears next to focused hunk

- **WHEN** the focused hunk has a visible review comment text box
- **THEN** the UI renders that text box adjacent to the focused hunk's inline rows
- **AND** does not render that text box in a separate top patch panel

#### Scenario: Hidden comment is preserved across navigation

- **WHEN** the user navigates away from a hunk with draft comment text
- **THEN** Sheaf Chat preserves the draft through the existing review draft state
- **AND** hides the text box until that hunk is focused again or explicitly requested
