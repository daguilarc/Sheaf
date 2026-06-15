## ADDED Requirements

### Requirement: arm-18 — Navigation: In-file hunk looping

WHEN an Agent Review next-hunk or previous-hunk command runs, THE Sheaf Chat service SHALL move the current hunk only within the current file's contiguous run of unstaged hunks — wrapping from that file's last hunk to its first hunk on next-hunk and from its first hunk to its last hunk on previous-hunk — SHALL report next-hunk and previous-hunk availability as false WHEN the current file has a single unstaged hunk, and SHALL cross into another file only through the next-file and previous-file commands.

#### Scenario: Next-hunk wraps within the file

- **WHEN** the current hunk is the last unstaged hunk of its file and a next-hunk command runs
- **THEN** the service selects the first unstaged hunk of that same file
- **AND** does not select a hunk in another file

#### Scenario: Previous-hunk wraps within the file

- **WHEN** the current hunk is the first unstaged hunk of its file and a previous-hunk command runs
- **THEN** the service selects the last unstaged hunk of that same file
- **AND** does not select a hunk in another file

#### Scenario: Next-hunk and previous-hunk stay within the file

- **WHEN** next-hunk or previous-hunk runs and the current file has more than one unstaged hunk
- **THEN** the newly selected hunk belongs to the same file as the previous current hunk

#### Scenario: Single-hunk file disables hunk navigation

- **WHEN** the current file has exactly one unstaged hunk
- **THEN** the Agent Review state reports next-hunk and previous-hunk as unavailable

#### Scenario: File crossing uses file commands

- **WHEN** a next-file or previous-file command runs and another file with unstaged hunks exists in that direction
- **THEN** the service selects a hunk in that other file

### Requirement: arm-19 — Launchpad presence gating on browser focus

WHILE no attached Agent Review browser client is focused, THE Sheaf Chat service SHALL set all Sheaf Chat-owned Launchpad cells off regardless of action availability and SHALL ignore generic cell pressed events for those cells; WHEN at least one attached client becomes focused, THE service SHALL restore the owned cell colors from current Agent Review state. A browser client SHALL report itself focused only WHILE its document is visible and its window has operating-system focus, and SHALL report its focus state on entering Agent Review Mode and whenever that state changes. This gating takes precedence over the cell coloring defined in requirements arm-13 and arm-17.

#### Scenario: Tab hidden clears the Launchpad

- **WHEN** the only attached client reports it is no longer focused because its tab became hidden
- **THEN** the service sets all Sheaf Chat-owned Launchpad cells off

#### Scenario: Window blurred clears the Launchpad

- **WHEN** the only attached client reports it is no longer focused because its browser window lost operating-system focus
- **THEN** the service sets all Sheaf Chat-owned Launchpad cells off

#### Scenario: Refocus restores cells

- **WHEN** an attached client reports it is focused again
- **THEN** the service restores the owned Launchpad cell colors from current Agent Review state

#### Scenario: Press ignored while unfocused

- **WHEN** Dictator reports a generic cell pressed event for a Sheaf Chat-owned cell and no attached client is focused
- **THEN** the service does not execute any Agent Review command or review-cell action

#### Scenario: Background refresh does not relight while unfocused

- **WHEN** Agent Review state refreshes from an external change while no attached client is focused
- **THEN** the service keeps all Sheaf Chat-owned Launchpad cells off

#### Scenario: Lit while any client is focused

- **WHEN** multiple clients are attached and at least one reports it is focused
- **THEN** the service keeps the owned Launchpad cells colored from current Agent Review state

### Requirement: arm-20 — Review UI: Position indicator

WHEN a browser client is in Agent Review Mode with a focused hunk, THE Sheaf Chat UI SHALL display at the top of the Agent Review bar an indicator showing the current hunk's position within the current file (current hunk number and total hunks in that file) and the current file's position among files with unstaged hunks (current file number and total files), derived from Agent Review state, and SHALL update it whenever Agent Review state changes; THE Agent Review bar SHALL NOT repeat the current file name, which is conveyed by the always-visible file tab; WHEN no hunk is focused, THE indicator SHALL show the number of files with unstaged hunks.

#### Scenario: Indicator shows hunk and file position

- **WHEN** Agent Review Mode is active, the current hunk is the first of two hunks in its file, and that file is the first of two files with unstaged hunks
- **THEN** the indicator shows the hunk position `1/2` within the current file and the file position `1/2`

#### Scenario: Indicator updates on navigation

- **WHEN** the focused hunk moves to a different hunk or file
- **THEN** the indicator reflects the new hunk position and file position

#### Scenario: No current hunk

- **WHEN** Agent Review Mode is active but no hunk is focused
- **THEN** the indicator shows the number of files with unstaged hunks and no hunk position

#### Scenario: File name not repeated in the bar

- **WHEN** a hunk is focused in Agent Review Mode
- **THEN** the Agent Review bar shows the hunk and file positions without repeating the current file name

### Requirement: arm-21 — Navigation: File navigation across files

WHEN Agent Review Mode has a focused hunk, THE Sheaf Chat service SHALL report previous-file as available whenever a file with unstaged hunks exists before the current file and next-file as available whenever a file with unstaged hunks exists after the current file — regardless of which hunk in the current file is focused — and WHEN a previous-file or next-file command runs, THE service SHALL move the current hunk to the first hunk of the adjacent file in that direction.

#### Scenario: Next-file available from a non-boundary hunk

- **WHEN** the current hunk is not the last hunk of its file but another file with unstaged hunks exists after the current file
- **THEN** the Agent Review state reports next-file as available

#### Scenario: Next-file lands on the next file's first hunk

- **WHEN** a next-file command runs and another file with unstaged hunks exists after the current file
- **THEN** the service selects the first hunk of that next file

#### Scenario: Previous-file lands on the previous file's first hunk

- **WHEN** a previous-file command runs and another file with unstaged hunks exists before the current file
- **THEN** the service selects the first hunk of that previous file

#### Scenario: First file has no previous file

- **WHEN** the current file is the first file with unstaged hunks
- **THEN** the Agent Review state reports previous-file as unavailable

#### Scenario: Last file has no next file

- **WHEN** the current file is the last file with unstaged hunks
- **THEN** the Agent Review state reports next-file as unavailable
