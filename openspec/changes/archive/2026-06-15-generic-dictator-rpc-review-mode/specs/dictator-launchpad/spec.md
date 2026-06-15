## ADDED Requirements

### Requirement: lp-24 — External cells: WebSocket RPC ownership
WHEN the WebSocket RPC layer owns one or more Launchpad cells, THE Launchpad controller SHALL render the RPC-supplied colors for those cells, route press and release events for those cells to the RPC layer, and prevent owned cells from dispatching static layout actions.

#### Scenario: RPC-owned cell renders supplied color
- **WHEN** a WebSocket RPC client owns `(3,3)` and supplies a grey color
- **THEN** the Launchpad controller renders `(3,3)` grey

#### Scenario: RPC-owned cell press routed externally
- **WHEN** the user presses a WebSocket RPC-owned cell
- **THEN** the Launchpad controller routes the press to the RPC layer and does not dispatch a static layout action

#### Scenario: RPC ownership removed
- **WHEN** the WebSocket RPC layer releases ownership of a cell
- **THEN** the Launchpad controller returns that cell to the normal static-layout or off rendering behavior

### Requirement: lp-25 — External cells: Agent review controls move to generic RPC ownership
THE Launchpad controller SHALL NOT treat `(2,7)` as a review control and SHALL NOT implement built-in review, hunk-navigation, stage, revert, or undo behavior at the Agent Review coordinates; all Sheaf Chat Agent Review controls — hunk navigation, stage, revert, undo, and the review/comment/post cell — SHALL be provided through WebSocket RPC cell ownership and generic cell events, with Dictator rendering only the supplied colors and routing only the generic press/release events.

#### Scenario: Coordinate two seven removed from review workflow
- **WHEN** the user presses `(2,7)`
- **THEN** Dictator does not start review recording, post a review, or otherwise treat `(2,7)` as part of the review workflow

#### Scenario: Coordinate three three owned
- **WHEN** `(3,3)` is owned by Sheaf Chat over WebSocket RPC
- **THEN** Dictator sends generic cell press and release events for the Sheaf Chat review/comment/post Launchpad cell

#### Scenario: Hunk navigation and mutation cells owned externally
- **WHEN** Sheaf Chat owns the hunk navigation, stage, revert, and undo cells over WebSocket RPC
- **THEN** Dictator renders their supplied colors and sends generic cell press and release events without performing any hunk navigation, staging, reverting, or undo itself

## REMOVED Requirements

### Requirement: lp-19 — Voice diff review pad
**Reason**: Dictator no longer owns voice diff review state or a built-in review pad.
**Migration**: Sheaf Chat owns the logical review/comment cell at `(3,3)` through `dictator-websocket-rpc` `launchpad.setCells` and handles generic press/release events.

### Requirement: lp-20 — Voice diff review pad actions
**Reason**: Review-comment editing and serialized-review insertion decisions now belong to Sheaf Chat, not Dictator.
**Migration**: Sheaf Chat handles `(3,3)` cell events and calls `cursor.insertText` with the serialized review when insertion is appropriate.

### Requirement: lp-21 — Voice diff review cancellation
**Reason**: There is no Dictator-owned review recording or review refinement operation to cancel.
**Migration**: Contextual backspace keeps its normal dictation/backspace behavior; Sheaf Chat owns any review text-box cancellation or editing behavior.

### Requirement: lp-22 — Hunk controls: Provider routing
**Reason**: Dictator no longer routes semantic hunk commands to hunk providers.
**Migration**: External apps own Launchpad cells through `dictator-websocket-rpc`, choose colors, receive generic cell events, and execute app-specific hunk actions themselves.
