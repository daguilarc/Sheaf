## MODIFIED Requirements

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

WHEN an Agent Review stage command targets the current hunk and its patch hash still matches the worktree diff, THE Sheaf Chat service SHALL stage only that exact hunk snapshot into the Git index, recompute Agent Review state from Git, and broadcast a successful command result without creating an active-review entry for that staged hunk.

#### Scenario: Stage current hunk succeeds

- **WHEN** a stage command targets the current hunk and the patch hash matches
- **THEN** the service stages only that hunk
- **AND** recomputes and broadcasts Agent Review state
- **AND** reports a successful stage command result

#### Scenario: Stage non-first hunk in file

- **WHEN** the current hunk is not the first unstaged hunk in its file and a stage command targets that hunk with a matching patch hash
- **THEN** the service stages the targeted hunk at its original worktree location
- **AND** leaves earlier and later unstaged hunks in that file unstaged

#### Scenario: Stage command is stale

- **WHEN** a stage command targets a hunk whose patch hash no longer matches
- **THEN** the service does not stage the hunk
- **AND** returns a stale-state command result after recomputing Agent Review state

#### Scenario: Successful stage is acceptance only

- **WHEN** a hunk is successfully staged through Agent Review Mode
- **THEN** the service creates no active-review entry for that staged hunk unless the hunk already has an explicit user comment

### Requirement: arm-6 — Hunk mutation: Revert current hunk

WHEN an Agent Review revert command targets the current hunk and its patch hash still matches the worktree diff, THE Sheaf Chat service SHALL reverse only that exact hunk snapshot from the worktree, record a rejected-hunk marker in the active Sheaf Chat review draft, recompute Agent Review state from Git, and broadcast a successful command result.

#### Scenario: Revert current hunk succeeds

- **WHEN** a revert command targets the current hunk and the patch hash matches
- **THEN** the service reverses only that hunk from the worktree
- **AND** records a rejected-hunk marker in the active review draft
- **AND** recomputes and broadcasts Agent Review state
- **AND** reports a successful revert command result

#### Scenario: Revert non-first hunk in file

- **WHEN** the current hunk is not the first unstaged hunk in its file and a revert command targets that hunk with a matching patch hash
- **THEN** the service reverses the targeted hunk at its original worktree location
- **AND** leaves earlier and later unstaged hunks in that file unchanged in the worktree
- **AND** records the rejected-hunk marker for the targeted hunk snapshot

#### Scenario: Revert command is stale

- **WHEN** a revert command targets a hunk whose patch hash no longer matches
- **THEN** the service does not revert the hunk
- **AND** returns a stale-state command result after recomputing Agent Review state

#### Scenario: Revert marker includes snapshot

- **WHEN** a revert command succeeds
- **THEN** the active review draft stores the reverted hunk's provider, repository, file, identity, header, patch hash, and patch text

### Requirement: arm-19 — Launchpad presence gating on browser focus

WHILE no attached Agent Review browser client is focused, THE Sheaf Chat service SHALL set Sheaf Chat-owned Launchpad navigation and mutation cells off regardless of action availability and SHALL ignore generic cell pressed events for those cells; WHEN an active review draft has serialized content ready to insert, THE service SHALL keep the Sheaf Chat-owned `(3,3)` review/comment/post cell lit in away-review mode even if no attached browser client is focused, so that pressing `(3,3)` may paste the review elsewhere. A browser client SHALL report itself focused only WHILE its document is visible and its window has operating-system focus, and SHALL report its focus state on entering Agent Review Mode and whenever that state changes. This gating takes precedence over the navigation and mutation cell coloring defined in requirement arm-17 and applies to the `(3,3)` review cell only when no serialized review draft is ready.

#### Scenario: Tab hidden clears navigation controls

- **WHEN** the only attached client reports it is no longer focused because its tab became hidden
- **THEN** the service sets the navigation and mutation cells off
- **AND** sets `(3,3)` off if no active review draft has serialized content

#### Scenario: Window blurred clears navigation controls

- **WHEN** the only attached client reports it is no longer focused because its browser window lost operating-system focus
- **THEN** the service sets the navigation and mutation cells off
- **AND** sets `(3,3)` off if no active review draft has serialized content

#### Scenario: Armed review remains pasteable while unfocused

- **WHEN** no attached client is focused and the active review draft has serialized content
- **THEN** the service keeps `(3,3)` lit in away-review mode
- **AND** pressing `(3,3)` calls Dictator `cursor.insertText` with the serialized review

#### Scenario: Refocus restores cells

- **WHEN** an attached client reports it is focused again
- **THEN** the service restores the owned Launchpad cell colors from current Agent Review state

#### Scenario: Press ignored while unfocused

- **WHEN** Dictator reports a generic cell pressed event for a Sheaf Chat-owned navigation or mutation cell and no attached client is focused
- **THEN** the service does not execute any Agent Review command

#### Scenario: Background refresh does not relight while unfocused

- **WHEN** Agent Review state refreshes from an external change while no attached client is focused and no active review draft has serialized content
- **THEN** the service keeps all Sheaf Chat-owned Launchpad cells off

#### Scenario: Lit while any client is focused

- **WHEN** multiple clients are attached and at least one reports it is focused
- **THEN** the service keeps the owned Launchpad cells colored from current Agent Review state

### Requirement: arm-25 — Navigation and comments: Inline hunk anchors

WHEN Agent Review Mode changes the focused hunk through bootstrap, next-hunk, previous-hunk, next-file, previous-file, stage, revert, undo, or external state refresh, THE Sheaf Chat UI SHALL open the focused hunk's file when necessary and, after that file has rendered, scroll the inline review view only if the focused hunk's changed rows are not already fully visible; WHEN scrolling is needed, THE UI SHALL position the focused hunk's first changed row near the top of the viewport with three preceding inline context rows when available; WHEN the focused hunk's review comment text box is visible, THE UI SHALL place it adjacent to that hunk's inline rows.

#### Scenario: Next hunk scrolls to anchor

- **WHEN** a next-hunk command selects a different hunk in the current file
- **THEN** the UI scrolls the inline review view so the newly focused hunk's first changed row is visible near the top of the viewport with three inline rows of context above it when available

#### Scenario: Already-visible hunk navigation does not scroll

- **WHEN** a next-hunk or previous-hunk command selects a different hunk whose added/deleted rows are already fully visible in the current viewport
- **THEN** the UI updates the focused hunk styling
- **AND** does not change the file viewport scroll position

#### Scenario: File navigation opens and scrolls

- **WHEN** a next-file or previous-file command selects a hunk in a different file
- **THEN** the UI opens that file
- **AND** scrolls the inline review view so the selected hunk's first changed row is visible near the top of the viewport with three inline rows of context above it when available after rendering

#### Scenario: Comment box appears next to focused hunk

- **WHEN** the focused hunk has a visible review comment text box
- **THEN** the UI renders that text box adjacent to the focused hunk's inline rows
- **AND** does not render that text box in a separate top patch panel

#### Scenario: Hidden comment is preserved across navigation

- **WHEN** the user navigates away from a hunk with draft comment text
- **THEN** Sheaf Chat preserves the draft through the existing review draft state
- **AND** hides the text box until that hunk is focused again or explicitly requested

## ADDED Requirements

### Requirement: arm-27 — Navigation: Mutation does not auto-advance across files

WHEN an Agent Review stage, revert, or undo command recomputes hunk state after removing or restoring the focused hunk, THE Sheaf Chat service SHALL keep automatic focus selection within the previously focused file; IF that file has no remaining unstaged hunks, THEN THE service SHALL leave no hunk focused rather than automatically selecting a hunk in another file, and file crossing SHALL happen only through the next-file or previous-file command.

#### Scenario: Stage last hunk in file does not advance files

- **WHEN** the current hunk is the last unstaged hunk in its file and a stage command succeeds while another file still has unstaged hunks
- **THEN** the service leaves no hunk focused for the current file context
- **AND** does not automatically select a hunk in another file

#### Scenario: Revert last hunk in file does not advance files

- **WHEN** the current hunk is the last unstaged hunk in its file and a revert command succeeds while another file still has unstaged hunks
- **THEN** the service leaves no hunk focused for the current file context
- **AND** does not automatically select a hunk in another file

#### Scenario: Next file explicitly advances after file is complete

- **WHEN** no hunk is focused because all hunks in the previous file have been staged or reverted and another file has unstaged hunks
- **AND** a next-file command runs
- **THEN** the service selects the first hunk of the next file with unstaged hunks
