## MODIFIED Requirements

### Requirement: fb-29 — Browser workspace: Unified viewer preserves normal file behavior

WHEN Agent Review state is available, THE file browser SHALL preserve normal file browser behavior for explorer navigation, tab deduplication, tab switching, tab closing, pane layout, stale-tab refresh, Markdown rendering for files without hunks, syntax-highlighted text rendering, plain-text fallback rendering, safe file-link interception, read-only point navigation, mark and active region rendering, incremental search, search-origin mark behavior, minibuffer prompts, and viewport synchronization; files with reviewable unstaged hunks SHALL use the same source-backed rendering and navigation behavior with Agent Review hunk affordances layered on top.

#### Scenario: Normal tab behavior preserved

- **WHEN** Agent Review state is available and a user opens, switches, or closes file tabs
- **THEN** the file browser preserves the same tab deduplication, selection, and close behavior as the regular file viewer

#### Scenario: Normal rendering for non-hunk file

- **WHEN** Agent Review state is available and the selected file has no reviewable unstaged hunks
- **THEN** the file browser renders that file through the same Markdown, syntax-highlighted text, or plain-text preview path used by the regular file viewer

#### Scenario: Syntax highlighting preserved for hunk file

- **WHEN** Agent Review state is available and the selected file has reviewable unstaged hunks
- **AND** the selected file is a `text/*` file whose extension maps to a supported highlight language
- **THEN** the file browser renders the hunk-aware view with the same syntax-highlight language mapping used for the regular file viewer
- **AND** preserves Agent Review addition, deletion, focused-hunk, muted-hunk, hunk-anchor, and comment affordances

#### Scenario: Emacs navigation preserved for hunk file

- **WHEN** Agent Review state is available and the selected file has reviewable unstaged hunks
- **AND** focus is in the file view
- **THEN** point movement, mark activation, active region rendering, point/mark exchange, incremental search, search cancellation, accepted-search origin mark behavior, minibuffer prompts, and viewport synchronization behave according to the normal file-browser requirements
- **AND** Agent Review hunk focus remains synchronized with Agent Review requirements

#### Scenario: Stale tab refresh preserved

- **WHEN** Agent Review state is available and the UI receives `file.changed` for an open file tab
- **THEN** the file browser preserves the selected-tab refetch and background stale-tab behavior defined for the regular file viewer

## ADDED Requirements

### Requirement: fb-38 — Browser workspace: Hunk virtual text is addressable text

WHEN the file browser renders an Agent Review hunk-aware view, THE file browser SHALL treat visible unchanged context text, added text, deleted old text, and replacement-side text as addressable read-only text for point navigation, mark and active region rendering, incremental search, accepted-search origin mark behavior, point/mark exchange, and viewport synchronization, while excluding diff markers, line-number gutters, buttons, and comment controls from the searchable/navigation text document.

#### Scenario: Pure insertion text is addressable

- **WHEN** the selected hunk-aware file contains a pure insertion
- **AND** the user searches for text that appears only in the inserted lines
- **THEN** incremental search moves point to the inserted text
- **AND** highlights the matching inserted text without including diff markers or line numbers in the match

#### Scenario: Pure deletion text is addressable

- **WHEN** the selected hunk-aware file contains a pure deletion
- **AND** the user searches for text that appears only in the deleted old lines
- **THEN** incremental search moves point to the deleted text
- **AND** highlights the matching deleted text without requiring that text to exist in the current worktree file content

#### Scenario: Edit text is addressable on both sides

- **WHEN** the selected hunk-aware file contains a replacement edit with deleted old text and added new text
- **THEN** point movement, mark selection, and incremental search can address both the deleted and added visible text
- **AND** syntax highlighting remains present for both sides when the file extension maps to a supported highlight language

#### Scenario: Mark spans hunk virtual text

- **WHEN** the user sets mark in visible hunk text and moves point across unchanged, added, or deleted visible text
- **THEN** the file browser highlights the active region across the visible text ranges
- **AND** does not include line-number gutters, diff markers, buttons, or comment controls in the selected region
