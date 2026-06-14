## ADDED Requirements

### Requirement: fb-26 — Browser workspace: Agent Review Mode entry and hunk viewer

WHEN the file browser is rendered for a session whose root has Agent Review Mode available, THE UI SHALL expose an Agent Review Mode control; WHEN Agent Review Mode is active, THE file viewer SHALL render the selected file with hunk-focused review affordances and SHALL allow the user to stage or revert the focused hunk through Agent Review commands.

#### Scenario: Review mode available

- **WHEN** the chat screen renders for a session whose root has Agent Review Mode available
- **THEN** the file browser exposes a control to enter Agent Review Mode

#### Scenario: Review mode unavailable

- **WHEN** the chat screen renders for a session whose root has Agent Review Mode unavailable
- **THEN** the file browser does not expose hunk mutation controls

#### Scenario: Hunk-focused review view

- **WHEN** Agent Review Mode is active and the service reports a current hunk
- **THEN** the file viewer reveals the file containing that hunk and visually identifies the focused hunk

#### Scenario: User stages focused hunk

- **WHEN** the user invokes stage for the focused hunk in Agent Review Mode
- **THEN** the UI sends an Agent Review stage command for that hunk rather than editing the file directly

#### Scenario: User reverts focused hunk

- **WHEN** the user invokes revert for the focused hunk in Agent Review Mode
- **THEN** the UI sends an Agent Review revert command for that hunk rather than editing the file directly

