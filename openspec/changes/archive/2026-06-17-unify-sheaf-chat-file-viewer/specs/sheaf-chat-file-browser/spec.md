## MODIFIED Requirements

### Requirement: fb-26 — Browser workspace: Unified hunk-aware file viewer

WHEN the file browser is rendered for a session whose workspace root has Agent Review available, THE UI SHALL use the normal tabbed file viewer as the only file viewing surface and conditionally add Agent Review affordances to that viewer based on the selected file's unstaged hunk state; WHEN the selected file has reviewable unstaged hunks, THE file viewer SHALL render the selected file with Agent Review inline diff affordances and SHALL allow the user to navigate, comment on, stage, revert, and undo the focused hunk through Agent Review commands; WHEN the selected file has no reviewable unstaged hunks but another file does, THE file viewer SHALL keep the normal file preview visible and SHALL allow Agent Review file navigation commands to jump to another file with hunks.

#### Scenario: Review state available without mode switch

- **WHEN** the chat screen renders for a session whose workspace root has Agent Review available
- **THEN** the file browser uses the normal tabbed file viewer
- **AND** does not require the user to enter a separate Agent Review file-viewing mode before review affordances can appear

#### Scenario: Review state unavailable

- **WHEN** the chat screen renders for a session whose workspace root has Agent Review unavailable
- **THEN** the file browser does not expose hunk mutation controls

#### Scenario: Selected file has hunks

- **WHEN** the selected file has one or more reviewable unstaged hunks
- **THEN** the file viewer renders that selected file with Agent Review inline diff affordances
- **AND** visually identifies the focused hunk

#### Scenario: User stages focused hunk

- **WHEN** the user invokes stage for the focused hunk
- **THEN** the UI sends an Agent Review stage command for that hunk rather than editing the file directly

#### Scenario: User reverts focused hunk

- **WHEN** the user invokes revert for the focused hunk
- **THEN** the UI sends an Agent Review revert command for that hunk rather than editing the file directly

#### Scenario: Selected file has no hunks but another file does

- **WHEN** the selected file has no reviewable unstaged hunks and another file in the workspace has reviewable unstaged hunks
- **THEN** the file viewer keeps the normal preview for the selected file visible
- **AND** exposes Agent Review next-file or previous-file navigation for reachable files with hunks

#### Scenario: File navigation opens hunk file

- **WHEN** the user invokes Agent Review next-file or previous-file navigation from a selected file without hunks
- **THEN** the UI opens or focuses the target file with reviewable hunks in the normal tabbed file viewer
- **AND** renders that file with Agent Review inline diff affordances

## ADDED Requirements

### Requirement: fb-29 — Browser workspace: Unified viewer preserves normal file behavior

WHEN Agent Review state is available, THE file browser SHALL preserve normal file browser behavior for explorer navigation, tab deduplication, tab switching, tab closing, pane layout, stale-tab refresh, Markdown rendering, syntax-highlighted text rendering, plain-text fallback rendering, and safe file-link interception.

#### Scenario: Normal tab behavior preserved

- **WHEN** Agent Review state is available and a user opens, switches, or closes file tabs
- **THEN** the file browser preserves the same tab deduplication, selection, and close behavior as the regular file viewer

#### Scenario: Normal rendering for non-hunk file

- **WHEN** Agent Review state is available and the selected file has no reviewable unstaged hunks
- **THEN** the file browser renders that file through the same Markdown, syntax-highlighted text, or plain-text preview path used by the regular file viewer

#### Scenario: Stale tab refresh preserved

- **WHEN** Agent Review state is available and the UI receives `file.changed` for an open file tab
- **THEN** the file browser preserves the selected-tab refetch and background stale-tab behavior defined for the regular file viewer
