## MODIFIED Requirements

### Requirement: arm-23 — Review UI: Inline diff file view

WHEN a browser client is in Agent Review Mode and the selected file has Agent Review hunks, THE Sheaf Chat UI SHALL render a processed inline review view for that file by layering Agent Review row, hunk, comment, and command affordances onto the unified file viewer's source-backed rendering and navigation pipeline; the view SHALL interleave unchanged file content, added lines, and deleted old lines in file order instead of rendering the focused hunk as a separate fixed patch panel above the file preview.

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

#### Scenario: Unified source behavior retained

- **WHEN** Agent Review Mode renders a selected file with reviewable hunks
- **THEN** the inline review view retains the file browser's syntax highlighting, read-only point, mark, active region, incremental search, minibuffer, and viewport synchronization behavior for the visible review text
- **AND** the Agent Review row treatments, hunk anchors, comment placement, and review commands remain available

### Requirement: arm-24 — Review state: Inline diff file documents

WHEN Agent Review Mode computes state for unstaged text hunks, THE Sheaf Chat service SHALL include file-scoped inline diff documents for files with reviewable hunks; each document SHALL provide ordered rows with stable row identity, row kind, line text, associated hunk identity when applicable, old/new line number metadata, and deterministic render-document mapping metadata sufficient for the browser to render inline additions, deletions, unchanged context, hunk anchors, comment placement, syntax-highlighted code text, and source/virtual text navigation while preserving each hunk row's original placement in file order, including pure deletions represented by zero-length new-file ranges.

#### Scenario: Inline document contains row metadata

- **WHEN** the service reports Agent Review state for a file with an unstaged text hunk
- **THEN** that file's inline diff document contains ordered rows for unchanged context, additions, and deletions
- **AND** rows belonging to a hunk include that hunk's `hunkId`

#### Scenario: Inline document contains render mapping metadata

- **WHEN** the service reports Agent Review state for a file with an unstaged text hunk
- **THEN** each inline diff row exposes enough metadata for the browser to distinguish current-file source text from virtual diff text
- **AND** the browser can project point, mark, search match, syntax highlighting, hunk anchors, and comment placement onto the visible review row text without using diff markers or line-number gutters as source text

#### Scenario: Deleted old lines do not require disk content

- **WHEN** a hunk deletes a line that is no longer present in the worktree file
- **THEN** the inline diff document still includes that deleted line from Git diff data
- **AND** marks that deleted line as virtual review text that remains addressable in the hunk-aware file view

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
