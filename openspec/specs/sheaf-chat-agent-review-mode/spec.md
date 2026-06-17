# sheaf-chat-agent-review-mode Specification

## Purpose
Define Sheaf Chat's Agent Review Mode, where Sheaf Chat owns the entire code-review workflow over a workspace's unstaged Git hunks: hunk discovery, focused navigation, staging/reverting/undo, per-hunk review comments, reverted-hunk markers, and review serialization. Sheaf Chat drives the Launchpad and inserts the serialized review by acting as a client of Dictator's generic `dictator-websocket-rpc` surface (owning the review cell block, handling cell events, calling `cursor.insertText`, and pushing hunk dictation context while a comment text box is focused). Dictator holds no review state.
## Requirements
### Requirement: arm-1 — Availability: Git repository detection

WHEN the service receives `GET /api/repositories/:repoId/workspaces/:workspaceId/agent-review`, THE Sheaf Chat service SHALL resolve Agent Review availability from the selected workspace (worktree) root, independent of any chat; it SHALL report Agent Review Mode as available WHEN that workspace root resolves to a Git worktree top level — the repository's main worktree or any linked worktree — and include the repository root, the workspace-root-relative path, and the ordered unstaged hunks and file summaries computed from that worktree; IF the workspace root does not resolve to a Git worktree, THEN THE service SHALL report Agent Review Mode as unavailable without exposing hunk commands.

#### Scenario: Main worktree

- **WHEN** the selected workspace is the repository's main worktree
- **THEN** Agent Review Mode is available and its state reflects the unstaged hunks in that worktree

#### Scenario: Linked worktree

- **WHEN** the selected workspace is a linked Git worktree
- **THEN** Agent Review Mode is available and its state reflects the unstaged hunks in that worktree

#### Scenario: Availability does not depend on a chat

- **WHEN** availability is requested for a workspace with no open or selected chat
- **THEN** the service still resolves availability and hunks from the workspace worktree root

#### Scenario: Workspace root outside a Git worktree

- **WHEN** the workspace root does not resolve to a Git worktree
- **THEN** Agent Review Mode is unavailable
- **AND** no hunk mutation command is exposed

### Requirement: arm-2 — Review WebSocket: Upgrade and bootstrap

THE Sheaf Chat service SHALL accept dedicated Agent Review Mode WebSocket upgrades at `/ws/agent-review` with valid `repo`, `workspace`, and `client` parameters and no `chat` parameter; WHEN the connection is accepted, THE service SHALL send a non-persisted bootstrap frame containing availability, current hunk state, ordered file summaries, and ordered unstaged hunks computed from the selected workspace worktree.

#### Scenario: Valid review socket upgrade

- **WHEN** a WebSocket upgrade arrives at `/ws/agent-review` with valid `repo`, `workspace`, and `client` parameters for a workspace whose root exists
- **THEN** the service accepts the socket and sends an Agent Review bootstrap frame

#### Scenario: Invalid review socket upgrade

- **WHEN** a WebSocket upgrade arrives with missing or invalid `repo`/`workspace` parameters
- **THEN** the service rejects the upgrade before opening the WebSocket

#### Scenario: Review frames are not persisted

- **WHEN** the service sends Agent Review bootstrap, state, command-result, or error frames
- **THEN** those frames are not appended to any chat history

### Requirement: arm-3 — Hunk model: Unstaged hunk snapshots

WHEN Agent Review Mode is available, THE Sheaf Chat service SHALL compute ordered unstaged zero-context text hunks from the Git worktree such that changed runs separated by one or more unchanged lines are represented as separate hunks, and represent each hunk with source provider `sheaf-chat`, repository root, session identity, root-relative file path, stable hunk id, hunk header, patch hash, patch text, and action availability for navigation, stage, revert, and undo.

#### Scenario: Unstaged text hunks exist

- **WHEN** the worktree contains unstaged text hunks under the session root
- **THEN** the Agent Review state contains ordered hunk snapshots with provider, repository, file, identity, header, patch hash, patch text, and action availability

#### Scenario: Separated edits split into separate hunks

- **WHEN** a text file has two changed runs under the session root with at least one unchanged line between them
- **THEN** the Agent Review state exposes those changed runs as separate ordered hunk snapshots

#### Scenario: Contiguous edits remain one hunk

- **WHEN** a text file has multiple adjacent changed lines under the session root with no unchanged line between them
- **THEN** the Agent Review state exposes those adjacent changed lines as one hunk snapshot

#### Scenario: No unstaged hunks

- **WHEN** the worktree contains no unstaged text hunks under the session root
- **THEN** the Agent Review state reports no current hunk and stage/revert navigation unavailable

#### Scenario: Binary or unsupported diff

- **WHEN** Git reports a binary or unsupported diff entry
- **THEN** the Agent Review state does not expose it as a stageable text hunk

### Requirement: arm-4 — Focus and navigation

WHEN a browser client enters Agent Review Mode, THE Sheaf Chat UI SHALL focus an available current hunk and keep the service informed of the focused hunk; WHEN navigation commands select a different hunk, THE service SHALL broadcast the new current hunk and THE UI SHALL reveal that hunk in the file viewer with up to three visible inline rows above the hunk when such rows exist.

#### Scenario: Mode entered with hunks

- **WHEN** a client enters Agent Review Mode and unstaged hunks are available
- **THEN** the UI focuses a current hunk and the service reports that hunk as focused

#### Scenario: Navigate to next hunk

- **WHEN** a next-hunk command succeeds
- **THEN** the service broadcasts the new current hunk
- **AND** connected Agent Review UIs reveal that hunk in the file viewer

#### Scenario: Navigated hunk has leading context

- **WHEN** navigation selects a hunk whose inline file has at least three rows before that hunk's first row
- **THEN** connected Agent Review UIs reveal the hunk with three visible inline rows above the hunk

#### Scenario: Navigated hunk near file start

- **WHEN** navigation selects a hunk whose inline file has fewer than three rows before that hunk's first row
- **THEN** connected Agent Review UIs reveal the hunk using the earliest available inline row as the scroll target

#### Scenario: Focus cleared

- **WHEN** the user exits Agent Review Mode or closes the last review socket
- **THEN** the service clears the focused hunk reported to Dictator for that session

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

### Requirement: arm-9 — Safety: Root-scoped Git side effects

WHEN Agent Review Mode runs Git commands, THE Sheaf Chat service SHALL execute them with argument arrays scoped to the resolved repository root, SHALL limit hunk discovery and commands to paths contained by the selected workspace worktree root, and SHALL reject commands whose target file or patch would escape that root.

#### Scenario: Hunk under workspace root

- **WHEN** a hunk target path resolves under the workspace worktree root
- **THEN** the service may run the requested hunk command subject to the command's other validation rules

#### Scenario: Hunk outside workspace root

- **WHEN** a hunk target path does not resolve under the workspace worktree root
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

### Requirement: arm-18 — Navigation: In-file hunk looping

WHEN an Agent Review next-hunk or previous-hunk command runs, THE Sheaf Chat service SHALL move the current hunk only within the current file's contiguous run of unstaged hunks — wrapping from that file's last hunk to its first hunk on next-hunk and from its first hunk to its last hunk on previous-hunk — SHALL report next-hunk and previous-hunk availability as false WHEN the current file has a single unstaged hunk, and SHALL cross into another file only through the next-file and previous-file commands.

#### Scenario: Next-hunk wraps within the file

- **WHEN** the current hunk is the last unstaged hunk of its file and a next-hunk command runs
- **THEN** the service selects the first unstaged hunk of that same file
- **AND** does not select a hunk in another file

#### Scenario: Previous-hunk wraps within the file

- **WHEN** the current hunk is the first unstaged hunk of its file and a previous-hunk command runs
- **THEN** the service selects the last unstaged hunk of that same file
- **AND** does not select a hunk in another file

#### Scenario: Next-hunk and previous-hunk stay within the file

- **WHEN** next-hunk or previous-hunk runs and the current file has more than one unstaged hunk
- **THEN** the newly selected hunk belongs to the same file as the previous current hunk

#### Scenario: Single-hunk file disables hunk navigation

- **WHEN** the current file has exactly one unstaged hunk
- **THEN** the Agent Review state reports next-hunk and previous-hunk as unavailable

#### Scenario: File crossing uses file commands

- **WHEN** a next-file or previous-file command runs and another file with unstaged hunks exists in that direction
- **THEN** the service selects a hunk in that other file

### Requirement: arm-19 — Launchpad presence gating on browser focus

WHILE no attached Agent Review browser client is focused, THE Sheaf Chat service SHALL set all Sheaf Chat-owned Launchpad cells off regardless of action availability and SHALL ignore generic cell pressed events for those cells; WHEN at least one attached client becomes focused, THE service SHALL restore the owned cell colors from current Agent Review state. A browser client SHALL report itself focused only WHILE its document is visible and its window has operating-system focus, and SHALL report its focus state on entering Agent Review Mode and whenever that state changes. This gating takes precedence over the cell coloring defined in requirements arm-13 and arm-17.

#### Scenario: Tab hidden clears the Launchpad

- **WHEN** the only attached client reports it is no longer focused because its tab became hidden
- **THEN** the service sets all Sheaf Chat-owned Launchpad cells off

#### Scenario: Window blurred clears the Launchpad

- **WHEN** the only attached client reports it is no longer focused because its browser window lost operating-system focus
- **THEN** the service sets all Sheaf Chat-owned Launchpad cells off

#### Scenario: Refocus restores cells

- **WHEN** an attached client reports it is focused again
- **THEN** the service restores the owned Launchpad cell colors from current Agent Review state

#### Scenario: Press ignored while unfocused

- **WHEN** Dictator reports a generic cell pressed event for a Sheaf Chat-owned cell and no attached client is focused
- **THEN** the service does not execute any Agent Review command or review-cell action

#### Scenario: Background refresh does not relight while unfocused

- **WHEN** Agent Review state refreshes from an external change while no attached client is focused
- **THEN** the service keeps all Sheaf Chat-owned Launchpad cells off

#### Scenario: Lit while any client is focused

- **WHEN** multiple clients are attached and at least one reports it is focused
- **THEN** the service keeps the owned Launchpad cells colored from current Agent Review state

### Requirement: arm-20 — Review UI: Position indicator

WHEN a browser client is in Agent Review Mode with a focused hunk, THE Sheaf Chat UI SHALL display at the top of the Agent Review bar an indicator showing the current hunk's position within the current file (current hunk number and total hunks in that file) and the current file's position among files with unstaged hunks (current file number and total files), derived from Agent Review state, and SHALL update it whenever Agent Review state changes; THE Agent Review bar SHALL NOT repeat the current file name, which is conveyed by the always-visible file tab; WHEN no hunk is focused, THE indicator SHALL show the number of files with unstaged hunks.

#### Scenario: Indicator shows hunk and file position

- **WHEN** Agent Review Mode is active, the current hunk is the first of two hunks in its file, and that file is the first of two files with unstaged hunks
- **THEN** the indicator shows the hunk position `1/2` within the current file and the file position `1/2`

#### Scenario: Indicator updates on navigation

- **WHEN** the focused hunk moves to a different hunk or file
- **THEN** the indicator reflects the new hunk position and file position

#### Scenario: No current hunk

- **WHEN** Agent Review Mode is active but no hunk is focused
- **THEN** the indicator shows the number of files with unstaged hunks and no hunk position

#### Scenario: File name not repeated in the bar

- **WHEN** a hunk is focused in Agent Review Mode
- **THEN** the Agent Review bar shows the hunk and file positions without repeating the current file name

### Requirement: arm-21 — Navigation: File navigation across files

WHEN Agent Review Mode has a focused hunk, THE Sheaf Chat service SHALL report previous-file as available whenever a file with unstaged hunks exists before the current file and next-file as available whenever a file with unstaged hunks exists after the current file — regardless of which hunk in the current file is focused — and WHEN a previous-file or next-file command runs, THE service SHALL move the current hunk to the first hunk of the adjacent file in that direction.

#### Scenario: Next-file available from a non-boundary hunk

- **WHEN** the current hunk is not the last hunk of its file but another file with unstaged hunks exists after the current file
- **THEN** the Agent Review state reports next-file as available

#### Scenario: Next-file lands on the next file's first hunk

- **WHEN** a next-file command runs and another file with unstaged hunks exists after the current file
- **THEN** the service selects the first hunk of that next file

#### Scenario: Previous-file lands on the previous file's first hunk

- **WHEN** a previous-file command runs and another file with unstaged hunks exists before the current file
- **THEN** the service selects the first hunk of that previous file

#### Scenario: First file has no previous file

- **WHEN** the current file is the first file with unstaged hunks
- **THEN** the Agent Review state reports previous-file as unavailable

#### Scenario: Last file has no next file

- **WHEN** the current file is the last file with unstaged hunks
- **THEN** the Agent Review state reports next-file as unavailable

### Requirement: arm-22 — Lifecycle: Deterministic teardown drains in-flight work

WHEN an Agent Review service instance is disposed or its connection/workspace is closed, THE service SHALL stop accepting new Launchpad cell-press events, inbound WebSocket messages, and Dictator RPC callbacks, SHALL await or cancel all in-flight command, refresh, git, and Dictator RPC work it started, and SHALL NOT produce any asynchronous activity (including unhandled promise rejections) after teardown has resolved. Errors from in-flight work SHALL be observed by the teardown drain rather than escaping as unhandled rejections, and teardown SHALL NOT swallow such errors silently.

#### Scenario: Cell press in flight during dispose

- **WHEN** a Launchpad cell press has started command/git work and the service is disposed before that work completes
- **THEN** dispose awaits (or cancels) the in-flight work before resolving
- **AND** no git or Dictator RPC activity runs after dispose resolves
- **AND** no unhandled promise rejection is emitted

#### Scenario: New events after teardown begins are ignored

- **WHEN** the service has begun teardown and a new cell press, inbound message, or Dictator RPC callback arrives
- **THEN** the service ignores it without starting new command, git, or RPC work

#### Scenario: Dictator RPC closes with pending calls

- **WHEN** the Dictator RPC socket closes while the service has pending RPC calls
- **THEN** each pending call's rejection is observed by the service's lifecycle handling
- **AND** no unhandled promise rejection escapes from a fire-and-forget RPC callsite

#### Scenario: Teardown completes before resource removal

- **WHEN** a caller closes the service and then removes the underlying workspace/repository
- **THEN** the close completes only after all in-flight git and RPC work has settled, so later removal cannot race in-flight work

### Requirement: arm-23 — Review UI: Inline diff file view

WHEN a browser client is in Agent Review Mode and the selected file has Agent Review hunks, THE Sheaf Chat UI SHALL render a processed inline review view for that file that interleaves unchanged file content, added lines, and deleted old lines in file order instead of rendering the focused hunk as a separate fixed patch panel above the file preview.

#### Scenario: All selected-file hunks are visible

- **WHEN** Agent Review Mode is active and the selected file contains multiple unstaged hunks
- **THEN** the inline review view shows every unstaged hunk in that file in file order
- **AND** the view does not limit diff rendering to only the current focused hunk

#### Scenario: Added and deleted lines are inline

- **WHEN** Agent Review Mode renders a file that has an added line and a deleted old line
- **THEN** the added line appears inline with the surrounding code using an addition treatment
- **AND** the deleted old line appears inline at its original position using a deletion treatment

#### Scenario: Focused hunk is visually brighter

- **WHEN** Agent Review Mode renders a selected file that contains the focused hunk and at least one non-focused hunk
- **THEN** rows belonging to the focused hunk use the bright addition and deletion treatments
- **AND** rows belonging to non-focused hunks use duller addition and deletion treatments

#### Scenario: Separate patch panel removed

- **WHEN** Agent Review Mode renders a selected file with a focused hunk
- **THEN** the UI does not render a separate focused-hunk patch preview above the file content
- **AND** the focused hunk is represented within the inline review view

### Requirement: arm-24 — Review state: Inline diff file documents

WHEN Agent Review Mode computes state for unstaged text hunks, THE Sheaf Chat service SHALL include file-scoped inline diff documents for files with reviewable hunks; each document SHALL provide ordered rows with stable row identity, row kind, line text, associated hunk identity when applicable, and old/new line number metadata sufficient for the browser to render inline additions, deletions, unchanged context, hunk anchors, and comment placement.

#### Scenario: Inline document contains row metadata

- **WHEN** the service reports Agent Review state for a file with an unstaged text hunk
- **THEN** that file's inline diff document contains ordered rows for unchanged context, additions, and deletions
- **AND** rows belonging to a hunk include that hunk's `hunkId`

#### Scenario: Deleted old lines do not require disk content

- **WHEN** a hunk deletes a line that is no longer present in the worktree file
- **THEN** the inline diff document still includes that deleted line from Git diff data

#### Scenario: Staged hunk disappears from unstaged diff

- **WHEN** an Agent Review stage command succeeds for the focused hunk
- **THEN** the recomputed Agent Review state no longer includes that hunk in the unstaged inline diff document
- **AND** the selected file view reflects the staged worktree content as normal file content for that area

#### Scenario: Unsupported diff has no inline document

- **WHEN** Git reports a binary or unsupported diff entry
- **THEN** the service does not expose an inline diff document for that entry

### Requirement: arm-25 — Navigation and comments: Inline hunk anchors

WHEN Agent Review Mode changes the focused hunk through bootstrap, next-hunk, previous-hunk, next-file, previous-file, stage, revert, undo, or external state refresh, THE Sheaf Chat UI SHALL open the focused hunk's file when necessary and, after that file has rendered, scroll the inline review view only if the focused hunk's changed rows are not already fully visible; WHEN scrolling is needed, THE UI SHALL position the focused hunk's first changed row near the top of the viewport with a small preceding context offset; WHEN the focused hunk's review comment text box is visible, THE UI SHALL place it adjacent to that hunk's inline rows.

#### Scenario: Next hunk scrolls to anchor

- **WHEN** a next-hunk command selects a different hunk in the current file
- **THEN** the UI scrolls the inline review view so the newly focused hunk's first changed row is visible near the top of the viewport with approximately two inline rows of context above it

#### Scenario: Already-visible hunk navigation does not scroll

- **WHEN** a next-hunk or previous-hunk command selects a different hunk whose added/deleted rows are already fully visible in the current viewport
- **THEN** the UI updates the focused hunk styling
- **AND** does not change the file viewport scroll position

#### Scenario: File navigation opens and scrolls

- **WHEN** a next-file or previous-file command selects a hunk in a different file
- **THEN** the UI opens that file
- **AND** scrolls the inline review view so the selected hunk's first changed row is visible near the top of the viewport with approximately two inline rows of context above it after rendering

#### Scenario: Comment box appears next to focused hunk

- **WHEN** the focused hunk has a visible review comment text box
- **THEN** the UI renders that text box adjacent to the focused hunk's inline rows
- **AND** does not render that text box in a separate top patch panel

#### Scenario: Hidden comment is preserved across navigation

- **WHEN** the user navigates away from a hunk with draft comment text
- **THEN** Sheaf Chat preserves the draft through the existing review draft state
- **AND** hides the text box until that hunk is focused again or explicitly requested

### Requirement: arm-26 — Dictator bridge: RPC heartbeat and stale-session recovery

WHILE Agent Review Mode has an active Dictator WebSocket RPC client, THE Sheaf Chat service SHALL keep the Dictator RPC session live by sending periodic heartbeat requests below Dictator's configured heartbeat timeout; IF Dictator reports that the current RPC client session is no longer recognized while Sheaf Chat is updating Agent Review Launchpad cells, THEN THE service SHALL reconnect the Dictator RPC client and retry the cell update once so the owned cells are repainted without requiring a browser refresh.

#### Scenario: Quiet review session remains live

- **WHEN** Agent Review Mode is active, Dictator is reachable, and no hunk navigation, mutation, review insertion, or context push/pop occurs for longer than Dictator's heartbeat timeout
- **THEN** Sheaf Chat sends heartbeat requests that keep Dictator from expiring the Agent Review RPC session
- **AND** Dictator keeps Sheaf Chat's Launchpad cell ownership intact

#### Scenario: Stale session is repainted

- **WHEN** Dictator has expired Sheaf Chat's RPC client session while the Agent Review browser session remains active
- **AND** Sheaf Chat attempts to update Agent Review Launchpad cell colors
- **THEN** Sheaf Chat reconnects the Dictator RPC client
- **AND** retries the cell update once with the current Agent Review state

#### Scenario: Reconnect failure preserves browser review mode

- **WHEN** Sheaf Chat attempts stale-session recovery and Dictator is unavailable
- **THEN** Agent Review Mode remains usable from the browser UI
- **AND** Sheaf Chat reports the Dictator bridge as disconnected or errored without clearing the active review draft

#### Scenario: Focus gating still applies

- **WHEN** no attached Agent Review browser client is focused
- **THEN** Sheaf Chat keeps its owned Launchpad cells off even while heartbeat requests keep the Dictator RPC session live
