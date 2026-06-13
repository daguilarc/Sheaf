# Capability: VS Code Extension Unstaged Hunk Pane

Project: `projects/vs-code-extension`
ID prefix: `vshu` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The VS Code extension provides a custom peek-like pane for worktree-vs-index
unstaged hunks, keeps that pane synchronized with editor, filesystem, and Git
changes, exposes hunk navigation and mutation commands, and reports state to
Dictator for hardware-controller integration.

## Requirements

### Requirement: vshu-1 — Project scaffold and manifest
WHEN the unstaged hunk extension is implemented, THE repository SHALL contain `projects/vs-code-extension` as a standalone VS Code extension project with a package manifest, TypeScript source, build script, test script, and extension activation for hunk-pane commands and workspace/editor state events.

#### Scenario: Extension project exists
- **WHEN** a developer inspects the repository
- **THEN** `projects/vs-code-extension` exists with a package manifest, TypeScript source, build script, and test script

#### Scenario: Manifest activates hunk commands
- **WHEN** the extension manifest is loaded by VS Code
- **THEN** it declares activation for the hunk-pane commands and the workspace/editor events required to keep pane state current

### Requirement: vshu-2 — Pane visibility follows active-file unstaged hunks
WHEN the focused VS Code window has an active text editor whose file has worktree-vs-index hunks, THE extension SHALL open or reveal a custom peek-like unstaged changes pane for that file; WHEN the active file has no unstaged hunks or there is no active file, THE extension SHALL close or hide the pane and report `paneOpen: false`.

#### Scenario: Active file has unstaged hunks
- **WHEN** the active file has one or more worktree-vs-index hunks
- **THEN** the extension opens or reveals the custom pane for that file
- **AND** reports `paneOpen: true`

#### Scenario: Active file has no unstaged hunks
- **WHEN** the active file has no unstaged hunks
- **THEN** the extension closes or hides the custom pane
- **AND** reports `paneOpen: false`

### Requirement: vshu-3 — Hunk model and current hunk
WHEN the active file has unstaged hunks, THE extension SHALL compute an ordered hunk model from the worktree-vs-index diff, maintain a current hunk, and preserve the current hunk across recomputes when a matching path/header/content identity still exists.

#### Scenario: Hunk model computed
- **WHEN** a file diff contains multiple hunks
- **THEN** the extension exposes them in file order with stable hunk identity, hunk indexes, hunk counts, and patch metadata

#### Scenario: Current hunk survives recompute
- **WHEN** the hunk model is recomputed and the previous hunk identity still exists
- **THEN** that hunk remains current

#### Scenario: Current hunk disappears
- **WHEN** the hunk model is recomputed and the previous current hunk no longer exists
- **THEN** the extension chooses the nearest valid hunk or closes the pane if no hunks remain

### Requirement: vshu-4 — Hunk and file navigation APIs
WHEN commands are invoked, THE extension SHALL support previous hunk, next hunk, previous file with unstaged hunks, next file with unstaged hunks, and get current hunk; unavailable navigation commands SHALL leave state unchanged and report a no-op result.

#### Scenario: Navigate to previous hunk
- **WHEN** previous-hunk is invoked and a previous hunk exists in the active file
- **THEN** the extension makes that hunk current and updates the pane and controller state

#### Scenario: Navigate to next changed file
- **WHEN** next-file is invoked and another file with unstaged hunks exists
- **THEN** the extension opens that file, computes its hunks, selects a current hunk, and updates the pane and controller state

#### Scenario: Get current hunk
- **WHEN** get-current-hunk is invoked while a current hunk exists
- **THEN** the extension returns the current hunk path, index, count, patch metadata, and action availability

### Requirement: vshu-5 — Stage, revert, and undo current hunk
WHEN mutation commands are invoked, THE extension SHALL stage the current hunk to the index, revert the current hunk from the worktree, and undo the last successful stage or revert operation using a LIFO undo stack; IF undo does not apply cleanly, THEN the extension SHALL clear the undo stack and recompute pane state.

#### Scenario: Stage current hunk
- **WHEN** stage-current-hunk succeeds
- **THEN** the current hunk is staged to the index
- **AND** an undo entry is pushed that can unstage that hunk

#### Scenario: Revert current hunk
- **WHEN** revert-current-hunk succeeds
- **THEN** the current hunk is removed from the worktree
- **AND** an undo entry is pushed that can restore the reverted patch as unstaged changes

#### Scenario: Undo stage
- **WHEN** the latest undo entry is a stage operation and undo succeeds
- **THEN** the hunk is unstaged and remains available as an unstaged change

#### Scenario: Undo revert
- **WHEN** the latest undo entry is a revert operation and undo succeeds
- **THEN** the reverted patch is restored to the worktree as unstaged changes

#### Scenario: Undo no longer applies
- **WHEN** undo is invoked and the saved patch cannot apply cleanly
- **THEN** the extension clears the undo stack and recomputes pane state

### Requirement: vshu-6 — Reactivity to editor, filesystem, and Git changes
WHEN an open text document changes, an active editor changes, a watched workspace file changes on disk, Git/index state changes, or the extension completes a hunk mutation, THE extension SHALL debounce and recompute the affected hunk state, update the pane, and publish a fresh controller state snapshot.

#### Scenario: Open buffer edited
- **WHEN** `workspace.onDidChangeTextDocument` fires for the active file
- **THEN** the extension recomputes the active file hunk state and publishes updated controller state

#### Scenario: External agent writes file
- **WHEN** a workspace file-system watcher observes a file create/change/delete event for a tracked workspace file
- **THEN** the extension recomputes affected hunk state and publishes updated controller state

#### Scenario: Index changes
- **WHEN** Git/index state changes after staging, unstaging, or another Git operation
- **THEN** the extension recomputes worktree-vs-index hunks and publishes updated controller state

### Requirement: vshu-7 — Dictator controller protocol
WHEN Dictator is available, THE extension SHALL maintain a local bidirectional controller connection that registers one instance per VS Code window, sends heartbeat and pane-state snapshots including focused-window state, and accepts hunk action commands only when they target the current instance.

#### Scenario: State snapshot sent
- **WHEN** pane state changes
- **THEN** the extension sends a snapshot containing window id, focused state, pane open state, current file, hunk counts, current hunk identity, and action availability

#### Scenario: Button command received
- **WHEN** Dictator sends a hunk action command for the focused extension instance
- **THEN** the extension executes the matching command and sends an updated state snapshot

#### Scenario: Command targets stale instance
- **WHEN** a command targets a stale or non-current extension instance
- **THEN** the extension rejects or ignores the command without mutating files

### Requirement: vshu-8 — Pane rendering
WHEN the custom pane is open, THE extension SHALL render the current file's unstaged diff with the current hunk visibly selected and SHALL provide visible affordances for stage, revert, hunk navigation, file navigation, and undo only when those actions are available.

#### Scenario: Current hunk visible
- **WHEN** the pane renders a file with multiple hunks
- **THEN** the current hunk is visibly selected

#### Scenario: Action unavailable
- **WHEN** an action is unavailable for the current pane state
- **THEN** the pane disables or hides the matching affordance
