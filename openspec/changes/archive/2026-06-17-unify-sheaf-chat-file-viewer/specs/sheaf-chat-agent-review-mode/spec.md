## MODIFIED Requirements

### Requirement: arm-4 — Focus and navigation

WHEN a browser client displays the unified Sheaf Chat file viewer for a workspace where Agent Review Mode is available, THE Sheaf Chat UI SHALL focus an available current hunk when the selected file has reviewable unstaged hunks and keep the service informed of the focused hunk; WHEN navigation commands select a different hunk, THE service SHALL broadcast the new current hunk and THE UI SHALL reveal that hunk in the file viewer with up to three visible inline rows above the hunk when such rows exist; WHEN the selected file has no reviewable unstaged hunks, THE UI SHALL clear hunk focus while preserving Agent Review file navigation availability for other files with hunks.

#### Scenario: Selected file has hunks

- **WHEN** a client displays a selected file with reviewable unstaged hunks
- **THEN** the UI focuses a current hunk in that file
- **AND** the service reports that hunk as focused

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

#### Scenario: Selected file has no hunks

- **WHEN** the selected file has no reviewable unstaged hunks
- **THEN** the UI clears the focused hunk reported for that client
- **AND** the service keeps next-file or previous-file available when another file with reviewable unstaged hunks exists in that direction

#### Scenario: Focus cleared

- **WHEN** the user closes the file viewer, navigates to a non-reviewable workspace, or closes the last review socket
- **THEN** the service clears the focused hunk reported to Dictator for that session

## ADDED Requirements

### Requirement: arm-28 — Review UI: Single viewer integration

WHEN Agent Review Mode is available for a workspace, THE Sheaf Chat UI SHALL integrate Agent Review rendering and controls into the normal tabbed file viewer rather than presenting a separate Agent Review file-viewing mode; all Agent Review review-draft, hunk mutation, hunk navigation, file navigation, Dictator Launchpad, focus gating, dictation context, serialization, and teardown behavior SHALL remain governed by the Agent Review requirements.

#### Scenario: No separate review-mode viewer

- **WHEN** Agent Review Mode is available
- **THEN** the UI uses the normal tabbed file viewer as the only file viewing surface
- **AND** does not require an Agent Review entry or exit action to view files with hunk-aware affordances

#### Scenario: Existing Agent Review behavior preserved

- **WHEN** the unified file viewer exposes hunk-aware affordances
- **THEN** hunk discovery, in-file hunk looping, file navigation, stage, revert, undo, review comments, rejected-hunk markers, review serialization, Launchpad cell ownership, focus gating, dictation context, and teardown semantics behave according to the existing Agent Review requirements

#### Scenario: Normal file selection clears hunk focus

- **WHEN** the user selects a normal file that has no reviewable unstaged hunks
- **THEN** Agent Review has no focused hunk for that client
- **AND** existing review draft content remains available for later posting or further hunk review

### Requirement: arm-29 — Navigation: File navigation from a non-hunk selected file

WHEN the unified file viewer has no focused hunk because the selected file has no reviewable unstaged hunks, THE Sheaf Chat service SHALL report previous-file and next-file availability relative to the selected file's position among the ordered files with reviewable unstaged hunks, and WHEN a previous-file or next-file command runs, THE service SHALL select the first hunk of the target file and THE UI SHALL open or focus that file in the normal tabbed file viewer.

#### Scenario: Next-file available from before hunk files

- **WHEN** the selected file has no reviewable unstaged hunks and at least one file with reviewable unstaged hunks is ordered after it
- **THEN** the Agent Review state reports next-file as available

#### Scenario: Previous-file available from after hunk files

- **WHEN** the selected file has no reviewable unstaged hunks and at least one file with reviewable unstaged hunks is ordered before it
- **THEN** the Agent Review state reports previous-file as available

#### Scenario: File command opens target file

- **WHEN** a next-file or previous-file command runs from a selected file with no reviewable unstaged hunks
- **THEN** the service selects the first hunk of the target file with reviewable unstaged hunks
- **AND** the UI opens or focuses that target file in the normal tabbed file viewer

#### Scenario: No reachable hunk file

- **WHEN** the selected file has no reviewable unstaged hunks and no file with reviewable unstaged hunks exists in a requested navigation direction
- **THEN** the Agent Review state reports that file navigation direction as unavailable
- **AND** a command for that direction does not mutate Agent Review state
