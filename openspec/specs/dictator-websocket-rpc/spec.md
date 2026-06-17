# dictator-websocket-rpc Specification

## Purpose
Define a generic, app-agnostic local WebSocket RPC surface on Dictator (`/ws/rpc`) that lets an external application own Launchpad cells (setting colors and receiving press/release events), request clipboard-preserving cursor text insertion, and push/pop transient dictation context blocks. The protocol carries no review or hunk semantics; it exposes Dictator's mechanical Launchpad and cursor-insertion capabilities so apps such as Sheaf Chat can build higher-level workflows (e.g. Agent Review Mode) on top of it.
## Requirements
### Requirement: rpc-1 — Connection: Local WebSocket RPC endpoint
WHEN a local client opens a WebSocket connection to `/ws/rpc` with a non-empty `client` query parameter, THE Dictator service SHALL accept the connection, register a per-connection client session, and send a `rpc.hello` event containing the supported protocol version and available capabilities.

#### Scenario: Valid RPC connection
- **WHEN** a WebSocket upgrade arrives at `/ws/rpc` with a non-empty `client` query parameter
- **THEN** Dictator accepts the connection and sends `rpc.hello`

#### Scenario: Invalid RPC connection
- **WHEN** a WebSocket upgrade arrives at `/ws/rpc` without a valid client identity
- **THEN** Dictator rejects the connection before registering a client session

### Requirement: rpc-2 — Framing: Request response and event envelopes
WHEN a connected client sends a JSON request envelope with `id`, `method`, and optional `params`, THE Dictator service SHALL respond with exactly one JSON envelope carrying the same `id` and either `result` or `error`; WHEN Dictator sends an unsolicited event, THE service SHALL send a JSON envelope with `method` and optional `params` and no `id`.

#### Scenario: Successful RPC call
- **WHEN** a client sends a valid request envelope for a supported method
- **THEN** Dictator sends one response envelope with the same `id` and a `result`

#### Scenario: Failed RPC call
- **WHEN** a client sends an unsupported method or invalid params
- **THEN** Dictator sends one response envelope with the same `id` and an `error`

#### Scenario: Dictator event
- **WHEN** Dictator sends a Launchpad event to a client
- **THEN** the envelope has a `method` and no `id`

### Requirement: rpc-3 — Liveness: Heartbeat and cleanup
WHILE a WebSocket RPC client owns Launchpad cells or pushed context blocks, THE Dictator service SHALL treat the connection as live until it closes or exceeds the configured heartbeat timeout; WHEN the client disconnects or times out, THE service SHALL release that client's cell ownership and remove that client's pushed context blocks.

#### Scenario: Client disconnects
- **WHEN** a WebSocket RPC client disconnects after owning cells and pushing context
- **THEN** Dictator clears that client's cell ownership and pushed context

#### Scenario: Client times out
- **WHEN** a WebSocket RPC client exceeds the heartbeat timeout
- **THEN** Dictator clears that client's cell ownership and pushed context

### Requirement: rpc-4 — Launchpad cells: External color ownership
WHEN a connected client calls `launchpad.setCells` with valid Launchpad coordinates and RGB colors or explicit `off` states, THE Dictator service SHALL register that client as the owner of those cells, render the supplied colors over MIDI, and consume hardware events for owned cells instead of dispatching static layout actions; IF any requested cell is owned by another live client, THEN THE service SHALL reject the request with a structured conflict error and leave existing ownership unchanged.

#### Scenario: Cell color set
- **WHEN** a client calls `launchpad.setCells` for coordinate `(3,3)` with a blue RGB color
- **THEN** Dictator renders `(3,3)` blue and marks the client as the owner of `(3,3)`

#### Scenario: Owned cell event consumed
- **WHEN** the user presses a cell owned by a WebSocket RPC client
- **THEN** Dictator consumes the hardware event and does not dispatch the static layout action for that coordinate

#### Scenario: Owned cell turned off
- **WHEN** the owning client calls `launchpad.setCells` with `off` for an owned coordinate
- **THEN** Dictator renders that coordinate off while preserving ownership until the client releases it, disconnects, or times out

#### Scenario: Cell ownership conflict
- **WHEN** a client calls `launchpad.setCells` for a coordinate owned by another live client
- **THEN** Dictator rejects the request with a conflict error
- **AND** leaves existing cell ownership unchanged

### Requirement: rpc-5 — Launchpad events: Pressed and released notifications
WHEN the user presses or releases a Launchpad cell owned by a WebSocket RPC client, THE Dictator service SHALL send that client a `launchpad.cellPressed` or `launchpad.cellReleased` event containing the coordinate and a monotonic event sequence.

#### Scenario: Owned cell pressed
- **WHEN** the user presses an externally owned Launchpad cell
- **THEN** Dictator sends `launchpad.cellPressed` with that cell coordinate

#### Scenario: Owned cell released
- **WHEN** the user releases an externally owned Launchpad cell
- **THEN** Dictator sends `launchpad.cellReleased` with that cell coordinate

#### Scenario: Unowned cell pressed
- **WHEN** the user presses a Launchpad cell not owned by a WebSocket RPC client
- **THEN** Dictator does not send an external cell event for that press

### Requirement: rpc-6 — Cursor insertion: Clipboard-preserving text insert
WHEN a connected client calls `cursor.insertText` with non-empty text up to 1 MiB as UTF-8, THE Dictator service SHALL insert the text at the active macOS cursor target using clipboard-preserving paste, SHALL NOT synthesize Enter or submit the text, and SHALL return success only after the insert path and clipboard restoration both succeed; IF the text is empty or exceeds 1 MiB as UTF-8, THEN THE service SHALL reject the call without modifying the clipboard.

#### Scenario: Insert succeeds
- **WHEN** a client calls `cursor.insertText` and the paste plus clipboard restoration succeed
- **THEN** Dictator returns success without submitting the inserted text

#### Scenario: Insert fails
- **WHEN** a client calls `cursor.insertText` and the paste fails
- **THEN** Dictator returns an error and does not claim success

#### Scenario: Clipboard restore fails
- **WHEN** a client calls `cursor.insertText` and the text is pasted but clipboard restoration fails
- **THEN** Dictator returns an error describing the restoration failure

#### Scenario: Insert text exceeds limit
- **WHEN** a client calls `cursor.insertText` with text exceeding 1 MiB as UTF-8
- **THEN** Dictator rejects the call without modifying the clipboard

### Requirement: rpc-7 — Dictation context: Push and pop context blocks
WHEN a connected client calls `dictationContext.push` with a client-scoped context id, title, optional metadata, and body, THE Dictator service SHALL add or replace that context block for the client; WHEN the client calls `dictationContext.pop` with that id, THE service SHALL remove that block; WHEN Launchpad dictation starts, THE service SHALL include active pushed context blocks in the dictation context snapshot.

#### Scenario: Context pushed
- **WHEN** a client pushes a context block
- **THEN** Dictator stores that block as active for that client connection

#### Scenario: Context popped
- **WHEN** the same client pops the context block id
- **THEN** Dictator removes that block from the active pushed context set

#### Scenario: Dictation starts with context
- **WHEN** Launchpad dictation starts while a pushed context block is active
- **THEN** Dictator includes that context block in the dictation context snapshot

### Requirement: rpc-8 — Liveness: Ping request
WHEN a connected WebSocket RPC client sends a `rpc.ping` request envelope, THE Dictator service SHALL refresh that client's heartbeat liveness and respond with a successful result without changing Launchpad cell ownership, pushed dictation context, or cursor state.

#### Scenario: Ping succeeds
- **WHEN** a connected client sends `{"id":"ping","method":"rpc.ping"}`
- **THEN** Dictator responds with a result for id `ping`
- **AND** the client's heartbeat liveness is renewed

#### Scenario: Ping has no side effects
- **WHEN** a client that owns Launchpad cells and pushed dictation context sends `rpc.ping`
- **THEN** Dictator preserves that client's Launchpad cell ownership
- **AND** preserves that client's pushed dictation context
- **AND** does not insert text or dispatch Launchpad actions
