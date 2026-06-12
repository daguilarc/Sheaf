## ADDED Requirements

### Requirement: lp-18 — VS Code hunk-control static layout reservation
THE shipped Launchpad product layout and fixture layout SHALL NOT define static pads at `(0,2)`, `(1,2)`, `(2,2)`, `(3,2)`, `(0,3)`, `(1,3)`, `(2,3)`, or `(3,3)`; those coordinates are reserved for the VS Code hunk-control layer and SHALL NOT send F13-F20 or any other static keystroke from the base layout.

#### Scenario: Product layout reserves hunk controls
- **WHEN** `projects/dictator/src/launchpad/launchpad-layout.json` is decoded
- **THEN** no static pad exists at `(0,2)`, `(1,2)`, `(2,2)`, `(3,2)`, `(0,3)`, `(1,3)`, `(2,3)`, or `(3,3)`

#### Scenario: Fixture layout reserves hunk controls
- **WHEN** `projects/dictator/tests/fixtures/launchpad-layout.json` is decoded
- **THEN** no static pad exists at `(0,2)`, `(1,2)`, `(2,2)`, `(3,2)`, `(0,3)`, `(1,3)`, `(2,3)`, or `(3,3)`

#### Scenario: Reserved coordinates do not send F-commands
- **WHEN** a hunk-control coordinate is pressed with no active VS Code hunk-control layer action available
- **THEN** Dictator sends no F13-F20 keyboard event
