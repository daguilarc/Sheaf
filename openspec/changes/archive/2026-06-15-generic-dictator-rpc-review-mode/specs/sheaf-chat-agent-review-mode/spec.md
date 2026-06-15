## MODIFIED Requirements

### Requirement: arm-5 — Hunk mutation: Stage current hunk

WHEN an Agent Review stage command targets the current hunk and its patch hash still matches the worktree diff, THE Sheaf Chat service SHALL stage only that hunk into the Git index, recompute Agent Review state from Git, and broadcast a successful command result without creating an active-review entry for that staged hunk.

#### Scenario: Stage current hunk succeeds

- **WHEN** a stage command targets the current hunk and the patch hash matches
- **THEN** the service stages only that hunk
- **AND** recomputes and broadcasts Agent Review state
- **AND** reports a successful stage command result

#### Scenario: Stage command is stale

- **WHEN** a stage command targets a hunk whose patch hash no longer matches
- **THEN** the service does not stage the hunk
- **AND** returns a stale-state command result after recomputing Agent Review state

#### Scenario: Successful stage is acceptance only

- **WHEN** a hunk is successfully staged through Agent Review Mode
- **THEN** the service creates no active-review entry for that staged hunk unless the hunk already has an explicit user comment

### Requirement: arm-6 — Hunk mutation: Revert current hunk

WHEN an Agent Review revert command targets the current hunk and its patch hash still matches the worktree diff, THE Sheaf Chat service SHALL reverse only that hunk from the worktree, record a rejected-hunk marker in the active Sheaf Chat review draft, recompute Agent Review state from Git, and broadcast a successful command result.

#### Scenario: Revert current hunk succeeds

- **WHEN** a revert command targets the current hunk and the patch hash matches
- **THEN** the service reverses only that hunk from the worktree
- **AND** records a rejected-hunk marker in the active review draft
- **AND** recomputes and broadcasts Agent Review state
- **AND** reports a successful revert command result

#### Scenario: Revert command is stale

- **WHEN** a revert command targets a hunk whose patch hash no longer matches
- **THEN** the service does not revert the hunk
- **AND** returns a stale-state command result after recomputing Agent Review state

#### Scenario: Revert marker includes snapshot

- **WHEN** a revert command succeeds
- **THEN** the active review draft stores the reverted hunk's provider, repository, file, identity, header, patch hash, and patch text

### Requirement: arm-7 — Hunk mutation: Undo last review mutation

WHEN an Agent Review undo command is available, THE Sheaf Chat service SHALL undo the last successful Agent Review stage or revert command for that session when possible, recompute hunk state from Git, and remove the matching rejected-hunk marker when undo restores a previously reverted hunk.

#### Scenario: Undo stage succeeds

- **WHEN** the last Agent Review mutation staged a hunk and undo is available
- **THEN** the service removes that hunk from the index when possible and recomputes Agent Review state

#### Scenario: Undo revert succeeds

- **WHEN** the last Agent Review mutation reverted a hunk and undo is available
- **THEN** the service restores that hunk to the worktree when possible
- **AND** removes the matching rejected-hunk marker from the active review draft

#### Scenario: Undo unavailable

- **WHEN** no undoable Agent Review mutation exists
- **THEN** the service reports undo unavailable and does not mutate Git state

## ADDED Requirements

### Requirement: arm-8 — Dictator bridge: Generic WebSocket RPC client

WHEN Agent Review Mode is active and Dictator is reachable, THE Sheaf Chat service SHALL connect to Dictator's generic WebSocket RPC endpoint, own the Agent Review Launchpad cells by sending cell colors, receive generic cell pressed/released events, call cursor insertion when posting a serialized review, and push/pop dictation context while review comment text boxes have focus.

#### Scenario: Dictator RPC connected

- **WHEN** Agent Review Mode is active and Dictator accepts the WebSocket RPC connection
- **THEN** Sheaf Chat sends the current Agent Review Launchpad cell colors through the generic RPC protocol

#### Scenario: Launchpad cell event received

- **WHEN** Dictator sends a generic cell pressed event for a Sheaf Chat-owned Agent Review cell
- **THEN** Sheaf Chat applies the matching Agent Review command or UI action

#### Scenario: Dictator unreachable

- **WHEN** Dictator is unavailable
- **THEN** Agent Review Mode remains usable from the Sheaf Chat UI and reports Dictator bridge status as disconnected

### Requirement: arm-11 — Review draft: Sheaf Chat-owned active review
WHEN the user creates a hunk comment or rejected-hunk marker in Agent Review Mode, THE Sheaf Chat service SHALL maintain an active in-memory review draft containing ordered entries with hunk identity, patch hash, patch text, and entry content.

#### Scenario: Comment creates review draft
- **WHEN** the user enters a comment for a hunk and no active review draft exists
- **THEN** Sheaf Chat creates an active review draft and stores the comment entry

#### Scenario: Entry order preserved
- **WHEN** the user creates multiple comments or rejected-hunk markers
- **THEN** Sheaf Chat preserves their insertion order in the active review draft

#### Scenario: Hunk snapshot stored
- **WHEN** Sheaf Chat stores a review entry
- **THEN** the entry includes hunk identity, patch hash, hunk header, file path, and patch text

### Requirement: arm-12 — Review comments: Focused hunk text-box lifecycle
WHEN Agent Review Mode has a focused current hunk, THE Sheaf Chat UI SHALL show a review comment text box only if the focused hunk already has a comment or the user explicitly requests the text box for that hunk; WHEN focus moves away from that hunk, THE UI SHALL hide that text box while preserving its draft content.

#### Scenario: New hunk focused without comment
- **WHEN** the user focuses a reviewable hunk that has no existing comment
- **THEN** Sheaf Chat does not show a review comment text box automatically

#### Scenario: Comment button pressed
- **WHEN** the user presses the Sheaf Chat-owned review/comment Launchpad cell while a reviewable hunk is focused
- **THEN** Sheaf Chat shows the text box near that hunk and moves keyboard focus into it

#### Scenario: Hunk with comment focused
- **WHEN** the user focuses a hunk that already has a comment or draft comment
- **THEN** Sheaf Chat shows that hunk's review comment text box

#### Scenario: Navigate away from commented hunk
- **WHEN** the user navigates away from a hunk with a visible review comment text box
- **THEN** Sheaf Chat hides the text box and preserves the comment content

#### Scenario: Only focused hunk text box visible
- **WHEN** multiple hunks have comments
- **THEN** Sheaf Chat shows only the current focused hunk's review comment text box

### Requirement: arm-13 — Launchpad review cell: Coordinate and colors
WHEN Agent Review Mode is connected to Dictator WebSocket RPC, THE Sheaf Chat service SHALL own Launchpad coordinate `(3,3)` as the review/comment cell and set its color to off when no review action is available, grey when a focused reviewable hunk has no comment, blue when a focused reviewable hunk has a comment or visible draft, and green when no hunk is focused but the active review draft has serialized content ready to insert.

#### Scenario: No review action
- **WHEN** no focused reviewable hunk exists and no active review draft has serialized content
- **THEN** Sheaf Chat sets `(3,3)` off

#### Scenario: Focused hunk without comment
- **WHEN** a reviewable hunk is focused and has no comment
- **THEN** Sheaf Chat sets `(3,3)` grey

#### Scenario: Focused hunk with comment
- **WHEN** a reviewable hunk is focused and has a comment or visible draft
- **THEN** Sheaf Chat sets `(3,3)` blue

#### Scenario: Away with review
- **WHEN** no hunk is focused and the active review draft has serialized content
- **THEN** Sheaf Chat sets `(3,3)` green

### Requirement: arm-14 — Launchpad review cell: Press behavior
WHEN Dictator sends a generic pressed event for Sheaf Chat-owned coordinate `(3,3)`, THE Sheaf Chat service SHALL reveal and focus the current hunk's review comment text box in focused-hunk mode, SHALL call Dictator `cursor.insertText` with the serialized active review in away-review mode, and SHALL do nothing when no review action is available.

#### Scenario: Press focused hunk without visible box
- **WHEN** `(3,3)` is pressed while a reviewable hunk is focused and its text box is hidden
- **THEN** Sheaf Chat reveals the text box and focuses it

#### Scenario: Press focused hunk with visible box
- **WHEN** `(3,3)` is pressed while a reviewable hunk is focused and its text box is already visible
- **THEN** Sheaf Chat keeps focus in that text box

#### Scenario: Press away with review
- **WHEN** `(3,3)` is pressed while no hunk is focused and the active review draft has serialized content
- **THEN** Sheaf Chat calls Dictator `cursor.insertText` with the serialized review

#### Scenario: Press with no action
- **WHEN** `(3,3)` is pressed while no focused hunk and no serialized review are available
- **THEN** Sheaf Chat does not mutate review state and does not call cursor insertion

### Requirement: arm-15 — Review insertion: Serialize and clear on success
WHEN Sheaf Chat calls Dictator `cursor.insertText` with a serialized Agent Review draft, THE Sheaf Chat service SHALL clear the active review draft only after Dictator reports successful text insertion and clipboard restoration; IF Dictator returns an error, THEN Sheaf Chat SHALL keep the active review draft.

#### Scenario: Serialized review inserted
- **WHEN** Dictator reports success for `cursor.insertText`
- **THEN** Sheaf Chat clears the active review draft

#### Scenario: Serialized review insertion fails
- **WHEN** Dictator reports an error for `cursor.insertText`
- **THEN** Sheaf Chat keeps the active review draft available for retry

#### Scenario: Serialized review content
- **WHEN** Sheaf Chat serializes the active review draft
- **THEN** the serialized review includes each entry's file path, hunk header, patch hash, comment or rejected-marker content, and fenced diff block

#### Scenario: Reverted hunks included
- **WHEN** the active review draft contains rejected-hunk markers from reverted hunks
- **THEN** the serialized review includes those rejected hunks with their hunk snapshots and fenced diff blocks

### Requirement: arm-17 — Launchpad navigation cells: Hunk navigation, stage, revert, and undo

WHEN Agent Review Mode is connected to Dictator WebSocket RPC, THE Sheaf Chat service SHALL own the Launchpad hunk navigation and mutation cells in addition to the `(3,3)` review/comment/post cell, set each navigation/mutation cell to its assigned color when that cell's Agent Review action is currently available and off when it is not, and execute the matching Agent Review command when Dictator reports a generic pressed event for one of those cells.

THE Sheaf Chat service SHALL own these cells, preserving the prior Launchpad positions and colors:

| Coordinate | Action | Color when available |
| --- | --- | --- |
| `(0,2)` | revert | red |
| `(1,2)` | previous hunk | yellow |
| `(2,2)` | stage | green |
| `(3,2)` | undo | white |
| `(0,3)` | previous file | yellow |
| `(1,3)` | next hunk | yellow |
| `(2,3)` | next file | yellow |

#### Scenario: Navigation cells colored by availability
- **WHEN** Agent Review state allows staging and reverting the current hunk but undo is unavailable
- **THEN** Sheaf Chat sets the stage cell green and the revert cell red
- **AND** sets the undo cell off

#### Scenario: Navigation cell press dispatches command
- **WHEN** Dictator reports a generic pressed event for the next-hunk cell and next-hunk is available
- **THEN** Sheaf Chat executes the next-hunk Agent Review command and broadcasts the updated state

#### Scenario: Unavailable navigation cell press is a no-op
- **WHEN** Dictator reports a generic pressed event for a navigation or mutation cell whose action is currently unavailable
- **THEN** Sheaf Chat does not mutate Agent Review state

#### Scenario: Navigation cells released on disconnect
- **WHEN** Agent Review Mode disconnects from Dictator
- **THEN** the navigation, mutation, and review cells are released through normal Dictator client cleanup

### Requirement: arm-16 — Dictation context: Focused review hunk push and pop
WHEN a review comment text box gains keyboard focus, THE Sheaf Chat service SHALL push a Dictator RPC dictation context block for that hunk; WHEN the text box loses focus, is hidden, or its hunk stops being current, THE service SHALL pop that context block.

#### Scenario: Text box focused
- **WHEN** the focused hunk's review comment text box receives keyboard focus
- **THEN** Sheaf Chat pushes a dictation context block containing the hunk file path, header, patch hash, and patch text

#### Scenario: Text box blurred
- **WHEN** the review comment text box loses keyboard focus
- **THEN** Sheaf Chat pops the matching dictation context block

#### Scenario: Hunk navigation hides text box
- **WHEN** hunk navigation hides the current review comment text box
- **THEN** Sheaf Chat pops the matching dictation context block

## REMOVED Requirements

### Requirement: arm-8 — Dictator bridge: Focused hunk provider
**Reason**: Sheaf Chat is no longer a hunk provider that Dictator polls; the Dictator bridge is now a generic WebSocket RPC client relationship.
**Migration**: Replaced by the new arm-8 "Dictator bridge: Generic WebSocket RPC client", in which Sheaf Chat owns Launchpad cells, receives generic cell events, and calls cursor insertion over the `dictator-websocket-rpc` capability.
