## MODIFIED Requirements

### Requirement: lp-18 — VS Code hunk-control static layout reservation

THE shipped Launchpad product layout and fixture layout SHALL NOT define static pads at `(0,2)`, `(1,2)`, `(2,2)`, `(3,2)`, `(0,3)`, `(1,3)`, `(2,3)`, or `(3,3)`; those coordinates are reserved for the hunk-control layer and SHALL NOT send F13-F20 or any other static keystroke from the base layout.

#### Scenario: Product layout reserves hunk controls

- **WHEN** `projects/dictator/src/launchpad/launchpad-layout.json` is decoded
- **THEN** no static pad exists at `(0,2)`, `(1,2)`, `(2,2)`, `(3,2)`, `(0,3)`, `(1,3)`, `(2,3)`, or `(3,3)`

#### Scenario: Fixture layout reserves hunk controls

- **WHEN** `projects/dictator/tests/fixtures/launchpad-layout.json` is decoded
- **THEN** no static pad exists at `(0,2)`, `(1,2)`, `(2,2)`, `(3,2)`, `(0,3)`, `(1,3)`, `(2,3)`, or `(3,3)`

#### Scenario: Reserved coordinates do not send F-commands

- **WHEN** a hunk-control coordinate is pressed with no active hunk-control layer action available
- **THEN** Dictator sends no F13-F20 keyboard event

### Requirement: lp-19 — Voice diff review pad

THE Launchpad controller SHALL reserve `(2,7)` as the voice diff review pad and SHALL render it red while a review recording is active, blue when a current focused hunk review target and an active review are both present, grey when a current focused hunk review target is present with no active review, green when an active review exists without a focused current hunk review target, and off otherwise.

#### Scenario: Review recording renders red

- **WHEN** a review-comment recording is active
- **THEN** the review pad at `(2,7)` renders red

#### Scenario: Focused hunk with existing review renders blue

- **WHEN** a healthy focused hunk review target has a current hunk and Dictator has an active diff review
- **THEN** the review pad renders blue

#### Scenario: Focused hunk without review renders grey

- **WHEN** a healthy focused hunk review target has a current hunk and Dictator has no active diff review
- **THEN** the review pad renders grey

#### Scenario: Away with review renders green

- **WHEN** Dictator has an active diff review and no healthy focused hunk review target has a current hunk
- **THEN** the review pad renders green

#### Scenario: No review action renders off

- **WHEN** there is no active review and no healthy focused current hunk review target
- **THEN** the review pad renders off

### Requirement: lp-20 — Voice diff review pad actions

WHEN the review pad is pressed, THE Launchpad controller SHALL start or stop hunk review-comment recording in focused-hunk mode, SHALL serialize and post the active review in away-review mode, and SHALL ignore the press when the pad is off.

#### Scenario: Press focused hunk pad

- **WHEN** the review pad is pressed while a healthy focused hunk review target has a current hunk and no review recording is active
- **THEN** Dictator starts a hunk review-comment recording

#### Scenario: Stop active review recording

- **WHEN** the review pad is pressed while a review-comment recording is active
- **THEN** Dictator stops recording and processes the comment

#### Scenario: Press away review pad

- **WHEN** the review pad is pressed while an active review exists and there is no healthy focused current hunk review target
- **THEN** Dictator serializes and posts the active review

#### Scenario: Press off review pad

- **WHEN** the review pad is pressed while it is off
- **THEN** Dictator consumes the event without starting recording, posting text, or sending a keystroke

## ADDED Requirements

### Requirement: lp-22 — Hunk controls: Provider routing

WHEN a Launchpad hunk-control button is pressed, THE Launchpad controller SHALL route the matching navigation, stage, revert, or undo command to the healthy focused hunk review target selected by Dictator, including either VS Code or Sheaf Chat providers; IF no healthy focused hunk review target reports the action available, THEN the controller SHALL consume the button without sending a keyboard fallback.

#### Scenario: Sheaf Chat hunk target focused

- **WHEN** Sheaf Chat Agent Review Mode is the healthy focused hunk review target and a lit hunk-control button is pressed
- **THEN** Dictator sends the matching hunk command to the Sheaf Chat provider

#### Scenario: VS Code hunk target focused

- **WHEN** VS Code is the healthy focused hunk review target and a lit hunk-control button is pressed
- **THEN** Dictator sends the matching hunk command to the VS Code provider

#### Scenario: No commandable hunk target

- **WHEN** no healthy focused hunk review target reports the button's action available
- **THEN** Dictator sends no hunk command and no keyboard command

