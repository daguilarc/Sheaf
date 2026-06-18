## ADDED Requirements

### Requirement: arm-30 — Input parity: Browser and Launchpad review commands

WHEN a Sheaf Chat-owned Launchpad navigation or mutation cell corresponds to an Agent Review browser command, THE Sheaf Chat service and UI SHALL treat pressing that Launchpad cell as the same Agent Review command as pressing the matching browser control, producing equivalent command execution, command-result/state delivery, selected-file synchronization, focused-hunk synchronization, inline hunk reveal behavior, and Launchpad cell availability for all connected Agent Review browser clients.

#### Scenario: Same-file navigation parity

- **WHEN** a connected Agent Review browser client can move from one hunk to another hunk in the same file
- **THEN** pressing the browser next-hunk or previous-hunk control and pressing the matching Launchpad cell from the same starting state produce the same focused hunk
- **AND** the UI highlights and reveals the same inline hunk rows
- **AND** the resulting Launchpad cell colors reflect the same action availability

#### Scenario: Cross-file navigation parity

- **WHEN** a connected Agent Review browser client can move to a hunk in another file
- **THEN** pressing the browser next-file or previous-file control and pressing the matching Launchpad cell from the same starting state produce the same focused hunk
- **AND** the unified file viewer selects the same file tab
- **AND** the UI reveals the focused hunk in that selected file
- **AND** client focus synchronization does not steer the service back to the previously selected file

#### Scenario: Non-hunk selected file navigation parity

- **WHEN** the selected file has no reviewable unstaged hunk and Agent Review reports next-file or previous-file available
- **THEN** pressing the browser file-navigation control and pressing the matching Launchpad cell from the same starting state both focus the same target file's first hunk
- **AND** the unified file viewer opens that target file
- **AND** the UI reveals the target hunk inline

#### Scenario: Mutation command parity

- **WHEN** stage, revert, or undo is available for the current Agent Review state
- **THEN** pressing the browser control and pressing the matching Launchpad cell from the same starting state execute the same Agent Review mutation command
- **AND** both paths recompute and broadcast equivalent review state
- **AND** both paths leave the unified file viewer focused according to the same post-mutation navigation rules

#### Scenario: Unavailable action parity

- **WHEN** a browser control is disabled because its Agent Review action is unavailable
- **THEN** the matching Launchpad cell is off
- **AND** pressing that Launchpad cell does not execute an Agent Review command or change review state

#### Scenario: Review cell exception

- **WHEN** the Launchpad review/comment/post cell is pressed
- **THEN** Sheaf Chat may apply the review-cell-specific behavior defined by the review draft and insertion requirements instead of mapping it to a browser navigation or mutation command
- **AND** that exception does not apply to hunk navigation, file navigation, stage, revert, or undo cells
