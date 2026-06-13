## ADDED Requirements

### Requirement: dhc-8 — Current hunk patch context
WHEN the active VS Code target reports pane state, THE Dictator service SHALL accept and retain current hunk patch context containing repo root, file path, hunk id, hunk header, patch hash, and patch text for use by voice diff review.

#### Scenario: Snapshot includes patch context
- **WHEN** a VS Code extension snapshot includes current hunk patch context
- **THEN** Dictator stores that context with the active target state

#### Scenario: No current hunk
- **WHEN** a VS Code extension snapshot reports no current hunk
- **THEN** Dictator treats review-comment recording as unavailable for that target

### Requirement: dhc-9 — Hunk mutation result facts
WHEN Dictator receives a VS Code hunk command result, THE service SHALL accept mutation facts that identify the hunk affected by a successful revert or undo-revert operation and forward those facts to voice diff review tracking.

#### Scenario: Revert result has hunk facts
- **WHEN** a successful `revert` command result includes reverted hunk context
- **THEN** Dictator forwards that hunk context to the active diff review tracker

#### Scenario: Undo revert result has hunk facts
- **WHEN** a successful `undo` command result includes restored hunk context for a prior revert
- **THEN** Dictator forwards that hunk context to remove the matching reverted marker

#### Scenario: Failed mutation ignored
- **WHEN** a hunk command result reports `ok: false`
- **THEN** Dictator does not add or remove diff-review entries from that command result

### Requirement: dhc-10 — Review state render invalidation
WHEN voice diff review state changes, THE hunk control layer SHALL invalidate Launchpad rendering so the review pad and hunk controls reflect the latest recording, hunk-focus, and active-review state.

#### Scenario: Review entry appended
- **WHEN** a review comment or reverted-hunk marker is appended
- **THEN** Dictator invalidates Launchpad rendering

#### Scenario: Review cleared
- **WHEN** the active diff review is posted and cleared
- **THEN** Dictator invalidates Launchpad rendering
