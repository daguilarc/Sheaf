## ADDED Requirements

### Requirement: arm-12 — Logging: Agent Review command and frame errors

WHEN Agent Review Mode rejects or fails a client command or frame, THE Sheaf Chat service SHALL emit a server log entry that identifies Agent Review as the feature area and includes the action when available, command id when available, repo id, workspace id, client id, stale-state flag when applicable, and the failure message.

#### Scenario: Stage command failure is logged

- **WHEN** an Agent Review stage command returns a command result with `ok: false`
- **THEN** the service emits a server log entry for the failed stage command
- **AND** the log entry identifies the action as `stage`
- **AND** the command result sent to the client remains unchanged

#### Scenario: Stale hunk command is logged

- **WHEN** an Agent Review stage, revert, or undo command fails because the focused hunk or patch hash is stale
- **THEN** the service emits a server log entry with the stale-state flag set
- **AND** the service still recomputes and broadcasts Agent Review state according to the existing hunk command requirements

#### Scenario: Git apply or verification failure is logged

- **WHEN** an Agent Review stage, revert, undo, rollback, or post-mutation verification step fails after command validation
- **THEN** the service emits a server log entry containing the command action and failure message
- **AND** the log entry does not include the hunk patch body

#### Scenario: Malformed Agent Review frame is logged

- **WHEN** an Agent Review WebSocket client sends malformed JSON or an invalid Agent Review client frame
- **THEN** the service emits a server log entry with the frame parsing or validation error message
- **AND** the service sends the existing Agent Review error frame behavior to the client

#### Scenario: Successful hunk command is not logged as an error

- **WHEN** an Agent Review stage, revert, undo, or navigation command succeeds
- **THEN** the service does not emit a handled-error log entry for that command
