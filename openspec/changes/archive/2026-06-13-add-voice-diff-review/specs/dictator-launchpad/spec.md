## ADDED Requirements

### Requirement: lp-19 — Voice diff review pad
THE Launchpad controller SHALL reserve `(2,7)` as the voice diff review pad and SHALL render it red while a review recording is active, blue when a current VS Code hunk and an active review are both present, grey when a current VS Code hunk is present with no active review, green when an active review exists without a focused current hunk, and off otherwise.

#### Scenario: Review recording renders red
- **WHEN** a review-comment recording is active
- **THEN** the review pad at `(2,7)` renders red

#### Scenario: Focused hunk with existing review renders blue
- **WHEN** a healthy focused VS Code target has a current hunk and Dictator has an active diff review
- **THEN** the review pad renders blue

#### Scenario: Focused hunk without review renders grey
- **WHEN** a healthy focused VS Code target has a current hunk and Dictator has no active diff review
- **THEN** the review pad renders grey

#### Scenario: Away with review renders green
- **WHEN** Dictator has an active diff review and no healthy focused VS Code target has a current hunk
- **THEN** the review pad renders green

#### Scenario: No review action renders off
- **WHEN** there is no active review and no healthy focused current hunk
- **THEN** the review pad renders off

### Requirement: lp-20 — Voice diff review pad actions
WHEN the review pad is pressed, THE Launchpad controller SHALL start or stop hunk review-comment recording in focused-hunk mode, SHALL serialize and post the active review in away-review mode, and SHALL ignore the press when the pad is off.

#### Scenario: Press focused hunk pad
- **WHEN** the review pad is pressed while a healthy focused VS Code target has a current hunk and no review recording is active
- **THEN** Dictator starts a hunk review-comment recording

#### Scenario: Stop active review recording
- **WHEN** the review pad is pressed while a review-comment recording is active
- **THEN** Dictator stops recording and processes the comment

#### Scenario: Press away review pad
- **WHEN** the review pad is pressed while an active review exists and there is no healthy focused current hunk
- **THEN** Dictator serializes and posts the active review

#### Scenario: Press off review pad
- **WHEN** the review pad is pressed while it is off
- **THEN** Dictator consumes the event without starting recording, posting text, or sending a keystroke

### Requirement: lp-21 — Voice diff review cancellation
WHEN the contextual-backspace pad is pressed during review-comment recording or review-comment refinement, THE Launchpad controller SHALL cancel that active review operation without appending a review entry.

#### Scenario: Cancel review recording
- **WHEN** contextual backspace is pressed while a review-comment recording is active
- **THEN** Dictator cancels recording and appends no review entry

#### Scenario: Cancel review refinement
- **WHEN** contextual backspace is pressed while a review-comment refinement task is active
- **THEN** Dictator cancels processing and appends no review entry
