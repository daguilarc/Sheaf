## MODIFIED Requirements

### Requirement: vdr-5 — Review diagnostics

WHEN Dictator exposes diagnostics for voice diff review or Launchpad state, THE service SHALL include whether an active diff review exists, the active review entry count, whether a review-comment recording is active, and the source provider of any focused current hunk review target.

#### Scenario: Diagnostics requested during review

- **WHEN** diagnostics are requested while a diff review contains entries
- **THEN** Dictator reports that an active review exists and includes its entry count

#### Scenario: Diagnostics requested during recording

- **WHEN** diagnostics are requested while a review-comment recording is active
- **THEN** Dictator reports the review recording state

#### Scenario: Diagnostics requested with focused provider

- **WHEN** diagnostics are requested while a hunk review target has focus
- **THEN** Dictator reports the focused target's source provider
