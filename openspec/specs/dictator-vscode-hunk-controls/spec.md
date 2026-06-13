# Capability: Dictator VS Code Hunk Controls

Project: `projects/dictator`
ID prefix: `dhc` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Dictator receives VS Code extension hunk-pane state, selects the focused healthy
VS Code window as the active target, lights Launchpad controls only when actions
are available, and dispatches hunk commands without falling back to static
keyboard events.

## Requirements

### Requirement: dhc-1 — VS Code hunk state registry
WHEN VS Code extension instances connect to Dictator, THE Dictator service SHALL maintain a registry keyed by extension window id with last heartbeat time, focused state, pane open state, current file/hunk metadata, and action availability.

#### Scenario: Extension registers
- **WHEN** a VS Code extension instance connects and sends its first snapshot
- **THEN** Dictator stores that instance by window id with its hunk-pane state

#### Scenario: Extension heartbeat expires
- **WHEN** an extension instance misses the heartbeat timeout
- **THEN** Dictator marks that instance stale and no longer treats it as commandable

### Requirement: dhc-2 — Focused instance selection
WHEN multiple VS Code extension instances are connected, THE Dictator service SHALL treat the most recent healthy instance reporting `focused: true` as the active VS Code target and SHALL treat there as no active target when no healthy focused instance exists.

#### Scenario: Focused instance exists
- **WHEN** one healthy connected instance reports `focused: true`
- **THEN** Dictator selects that instance as the active VS Code target

#### Scenario: No focused instance
- **WHEN** no healthy connected instance reports `focused: true`
- **THEN** Dictator has no active VS Code target and all hunk-control LEDs render off

### Requirement: dhc-3 — Launchpad hunk-control coordinates
THE Dictator Launchpad hunk control layer SHALL own `(0,2)` revert current hunk, `(1,2)` previous hunk, `(2,2)` stage current hunk, `(3,2)` undo, `(0,3)` previous file with hunks, `(1,3)` next hunk, and `(2,3)` next file with hunks; `(3,3)` SHALL remain unused and off.

#### Scenario: Hunk controls rendered
- **WHEN** Dictator renders the Launchpad hunk control layer
- **THEN** it uses the specified coordinates for revert, previous hunk, stage, undo, previous file, next hunk, and next file
- **AND** `(3,3)` is off

### Requirement: dhc-4 — LED action availability
WHEN the active VS Code target reports pane state, THE hunk control layer SHALL light only actions whose reported availability is true; IF VS Code is not focused, the pane is closed, there are no active hunks, or an action is unavailable, THEN the corresponding LED SHALL be off.

#### Scenario: Pane closed
- **WHEN** the active VS Code target reports `paneOpen: false`
- **THEN** revert, stage, hunk navigation, file navigation, and undo LEDs are off

#### Scenario: Multiple hunks in current file
- **WHEN** the active VS Code target reports previous or next hunk availability
- **THEN** the matching up/down hunk navigation LED is lit

#### Scenario: Multiple files with hunks
- **WHEN** the active VS Code target reports previous or next file availability
- **THEN** the matching left/right file navigation LED is lit

#### Scenario: Undo available
- **WHEN** the active VS Code target reports `canUndo: true`
- **THEN** the undo LED is lit

### Requirement: dhc-5 — Button gating and dispatch
WHEN a Launchpad hunk-control button is pressed, THE hunk control layer SHALL send a command to the active VS Code target only if the button is lit and the target is healthy, focused, pane-open, and reports that action as available; otherwise THE layer SHALL consume the button event without sending a command.

#### Scenario: Lit button pressed
- **WHEN** a lit hunk-control button is pressed while a healthy focused target is active
- **THEN** Dictator sends the matching hunk action command to that target

#### Scenario: Unlit button pressed
- **WHEN** an unlit hunk-control button is pressed
- **THEN** Dictator sends no VS Code command and no keyboard command

#### Scenario: VS Code not focused
- **WHEN** a hunk-control button is pressed while there is no healthy focused VS Code target
- **THEN** Dictator sends no VS Code command and no keyboard command

### Requirement: dhc-6 — State-driven render invalidation
WHEN Dictator receives a VS Code hunk state snapshot, focus change, heartbeat expiration, command result, or disconnect, THE service SHALL invalidate Launchpad rendering so LEDs reflect the latest active-target state.

#### Scenario: State snapshot changes availability
- **WHEN** a snapshot changes any hunk action availability value
- **THEN** Dictator invalidates Launchpad rendering

#### Scenario: Active target disconnects
- **WHEN** the active VS Code target disconnects or expires
- **THEN** Dictator invalidates Launchpad rendering and turns hunk-control LEDs off

### Requirement: dhc-7 — Protocol diagnostics
WHEN the Dictator control protocol is active, THE service SHALL expose enough diagnostic state to report connected VS Code instances, active target window id, pane-open state, current file/hunk metadata, action availability, and last command result.

#### Scenario: Diagnostics requested
- **WHEN** a diagnostics endpoint or log snapshot is requested
- **THEN** Dictator can report connected VS Code instances, active target, pane state, current file/hunk metadata, action availability, and last command result

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
