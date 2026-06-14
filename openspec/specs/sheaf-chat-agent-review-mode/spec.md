# sheaf-chat-agent-review-mode Specification

## Purpose
TBD - created by archiving change add-sheaf-chat-agent-review-mode. Update Purpose after archive.
## Requirements
### Requirement: arm-1 — Availability: Git repository detection

WHEN a chat session root resolves inside a Git repository, THE Sheaf Chat service SHALL report Agent Review Mode as available for that session and include the repository root-relative session path; IF the session root does not resolve inside a Git repository, THEN THE service SHALL report Agent Review Mode as unavailable without exposing hunk commands.

#### Scenario: Session root in Git repository

- **WHEN** the session root is contained by a Git repository
- **THEN** Agent Review Mode is available for that session
- **AND** the availability payload identifies the Git repository root and the session root relative to that repository

#### Scenario: Session root outside Git repository

- **WHEN** the session root is not contained by a Git repository
- **THEN** Agent Review Mode is unavailable
- **AND** no hunk mutation command is exposed for that session

### Requirement: arm-2 — Review WebSocket: Upgrade and bootstrap

THE Sheaf Chat service SHALL accept dedicated Agent Review Mode WebSocket upgrades at `/ws/agent-review` with valid `p`/`pile`, `session`, and `client` parameters; WHEN the connection is accepted, THE service SHALL send a non-persisted bootstrap frame containing availability, current hunk state, ordered file summaries, and ordered unstaged hunks.

#### Scenario: Valid review socket upgrade

- **WHEN** a WebSocket upgrade arrives at `/ws/agent-review` with valid pile, session, and client parameters for a session whose root exists
- **THEN** the service accepts the socket and sends an Agent Review bootstrap frame

#### Scenario: Invalid review socket upgrade

- **WHEN** a WebSocket upgrade arrives with missing or invalid pile/session parameters
- **THEN** the service rejects the upgrade before opening the WebSocket

#### Scenario: Review frames are not persisted

- **WHEN** the service sends Agent Review bootstrap, state, command-result, or error frames
- **THEN** those frames are not appended to the chat session history

### Requirement: arm-3 — Hunk model: Unstaged hunk snapshots

WHEN Agent Review Mode is available, THE Sheaf Chat service SHALL compute ordered unstaged text hunks from the Git worktree and represent each hunk with source provider `sheaf-chat`, repository root, session identity, root-relative file path, stable hunk id, hunk header, patch hash, patch text, and action availability for navigation, stage, revert, and undo.

#### Scenario: Unstaged text hunks exist

- **WHEN** the worktree contains unstaged text hunks under the session root
- **THEN** the Agent Review state contains ordered hunk snapshots with provider, repository, file, identity, header, patch hash, patch text, and action availability

#### Scenario: No unstaged hunks

- **WHEN** the worktree contains no unstaged text hunks under the session root
- **THEN** the Agent Review state reports no current hunk and stage/revert navigation unavailable

#### Scenario: Binary or unsupported diff

- **WHEN** Git reports a binary or unsupported diff entry
- **THEN** the Agent Review state does not expose it as a stageable text hunk

### Requirement: arm-4 — Focus and navigation

WHEN a browser client enters Agent Review Mode, THE Sheaf Chat UI SHALL focus an available current hunk and keep the service informed of the focused hunk; WHEN navigation commands select a different hunk, THE service SHALL broadcast the new current hunk and THE UI SHALL reveal that hunk in the file viewer.

#### Scenario: Mode entered with hunks

- **WHEN** a client enters Agent Review Mode and unstaged hunks are available
- **THEN** the UI focuses a current hunk and the service reports that hunk as focused

#### Scenario: Navigate to next hunk

- **WHEN** a next-hunk command succeeds
- **THEN** the service broadcasts the new current hunk
- **AND** connected Agent Review UIs reveal that hunk in the file viewer

#### Scenario: Focus cleared

- **WHEN** the user exits Agent Review Mode or closes the last review socket
- **THEN** the service clears the focused hunk reported to Dictator for that session

### Requirement: arm-5 — Hunk mutation: Stage current hunk

WHEN an Agent Review stage command targets the current hunk and its patch hash still matches the worktree diff, THE Sheaf Chat service SHALL stage only that hunk into the Git index, recompute Agent Review state from Git, and broadcast a successful command result without creating a Dictator voice-review entry.

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
- **THEN** the service does not ask Dictator to append a voice-review entry for that staged hunk

### Requirement: arm-6 — Hunk mutation: Revert current hunk

WHEN an Agent Review revert command targets the current hunk and its patch hash still matches the worktree diff, THE Sheaf Chat service SHALL reverse only that hunk from the worktree, recompute Agent Review state from Git, broadcast a successful command result, and include reverted hunk facts suitable for Dictator voice-review tracking.

#### Scenario: Revert current hunk succeeds

- **WHEN** a revert command targets the current hunk and the patch hash matches
- **THEN** the service reverses only that hunk from the worktree
- **AND** recomputes and broadcasts Agent Review state
- **AND** reports a successful revert command result with reverted hunk facts

#### Scenario: Revert command is stale

- **WHEN** a revert command targets a hunk whose patch hash no longer matches
- **THEN** the service does not revert the hunk
- **AND** returns a stale-state command result after recomputing Agent Review state

#### Scenario: Revert facts include snapshot

- **WHEN** a revert command succeeds
- **THEN** the command result includes the reverted hunk snapshot that Dictator can record as a rejected hunk

### Requirement: arm-7 — Hunk mutation: Undo last review mutation

WHEN an Agent Review undo command is available, THE Sheaf Chat service SHALL undo the last successful Agent Review stage or revert command for that session when possible, recompute hunk state from Git, and include restored hunk facts when an undo restores a previously reverted hunk.

#### Scenario: Undo stage succeeds

- **WHEN** the last Agent Review mutation staged a hunk and undo is available
- **THEN** the service removes that hunk from the index when possible and recomputes Agent Review state

#### Scenario: Undo revert succeeds

- **WHEN** the last Agent Review mutation reverted a hunk and undo is available
- **THEN** the service restores that hunk to the worktree when possible
- **AND** reports restored hunk facts for Dictator voice-review cleanup

#### Scenario: Undo unavailable

- **WHEN** no undoable Agent Review mutation exists
- **THEN** the service reports undo unavailable and does not mutate Git state

### Requirement: arm-8 — Dictator bridge: Focused hunk provider

WHEN Agent Review Mode is active and Dictator is reachable, THE Sheaf Chat service SHALL register as a Dictator hunk target provider, send focused-hunk snapshots and action availability, accept navigation/stage/revert/undo commands from Dictator, and forward command results with mutation facts.

#### Scenario: Focused hunk sent to Dictator

- **WHEN** Agent Review Mode has a focused current hunk and Dictator is connected
- **THEN** Sheaf Chat sends Dictator the current provider-neutral hunk snapshot and action availability

#### Scenario: Launchpad command received

- **WHEN** Dictator sends a hunk navigation or mutation command to the Sheaf Chat provider
- **THEN** Sheaf Chat applies the corresponding Agent Review command rules and sends a command result back to Dictator

#### Scenario: Dictator unreachable

- **WHEN** Dictator is unavailable
- **THEN** Agent Review Mode remains usable from the Sheaf Chat UI and reports Dictator bridge status as disconnected

### Requirement: arm-9 — Safety: Root-scoped Git side effects

WHEN Agent Review Mode runs Git commands, THE Sheaf Chat service SHALL execute them with argument arrays scoped to the resolved repository root, SHALL limit hunk discovery and commands to paths contained by the session root, and SHALL reject commands whose target file or patch would escape that root.

#### Scenario: Hunk under session root

- **WHEN** a hunk target path resolves under the session root
- **THEN** the service may run the requested hunk command subject to the command's other validation rules

#### Scenario: Hunk outside session root

- **WHEN** a hunk target path does not resolve under the session root
- **THEN** the service rejects the command and does not mutate Git state

#### Scenario: Git command construction

- **WHEN** the service invokes Git for Agent Review Mode
- **THEN** it uses explicit executable arguments rather than shell-interpolated command strings

### Requirement: arm-10 — State refresh: External changes

WHEN Agent Review Mode observes a successful scoped edit, a file-change notification under the session root, or a completed hunk command, THE Sheaf Chat service SHALL refresh the Git hunk state and broadcast the new Agent Review state to connected review sockets.

#### Scenario: Scoped edit changes a reviewed file

- **WHEN** a scoped edit writes a file under the active Agent Review session root
- **THEN** the service refreshes Git hunk state and broadcasts the updated review state

#### Scenario: Hunk command completes

- **WHEN** a stage, revert, undo, or navigation command completes
- **THEN** the service broadcasts the resulting Agent Review state to connected review sockets

