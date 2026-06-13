## MODIFIED Requirements

### Requirement: vshu-2 — Pane visibility follows active-file unstaged hunks
WHEN the focused VS Code window has an active text editor whose file has worktree-vs-index hunks, THE extension SHALL activate a read-only virtual hunk document review surface for that file without opening a separate webview panel; WHEN the active file has no unstaged hunks or there is no active file, THE extension SHALL clear or hide that review surface and report `paneOpen: false`.

#### Scenario: Active file has unstaged hunks
- **WHEN** the active file has one or more worktree-vs-index hunks
- **THEN** the extension activates a read-only virtual hunk document review surface for that file
- **AND** reports `paneOpen: true`

#### Scenario: Active file has no unstaged hunks
- **WHEN** the active file has no worktree-vs-index hunks
- **THEN** the extension clears or hides the editor-integrated review surface
- **AND** reports `paneOpen: false`

### Requirement: vshu-4 — Hunk and file navigation APIs
WHEN commands are invoked, THE extension SHALL support previous hunk, next hunk, previous file with unstaged hunks, next file with unstaged hunks, and get current hunk; unavailable navigation commands SHALL leave state unchanged and report a no-op result.

#### Scenario: Navigate to previous hunk
- **WHEN** previous-hunk is invoked and a previous hunk exists in the active file
- **THEN** the extension makes that hunk current and updates the virtual hunk document review surface and controller state
- **AND** reveals the newly current hunk in the active editor viewport

#### Scenario: Navigate to next changed file
- **WHEN** next-file is invoked and another file with unstaged hunks exists
- **THEN** the extension opens that file's virtual hunk document, computes its hunks, selects a current hunk, and updates the review surface and controller state
- **AND** reveals the selected hunk in the active editor viewport

#### Scenario: Arrow-key hunk navigation reveals hunk
- **WHEN** arrow-key-driven hunk navigation changes the current hunk
- **THEN** the extension reveals the newly current hunk in the active editor viewport

#### Scenario: Get current hunk
- **WHEN** get-current-hunk is invoked while a current hunk exists
- **THEN** the extension returns the current hunk path, index, count, patch metadata, and action availability

### Requirement: vshu-6 — Reactivity to editor, filesystem, and Git changes
WHEN an open text document changes, an active editor changes, a watched workspace file changes on disk, Git/index state changes, or the extension completes a hunk mutation, THE extension SHALL debounce and recompute the affected hunk state, update the virtual hunk document review surface, and publish a fresh controller state snapshot.

#### Scenario: Open buffer edited
- **WHEN** `workspace.onDidChangeTextDocument` fires for the active file
- **THEN** the extension recomputes the active file hunk state and publishes updated controller state

#### Scenario: External agent writes file
- **WHEN** a workspace file-system watcher observes a file create/change/delete event for a tracked workspace file
- **THEN** the extension recomputes affected hunk state and publishes updated controller state

#### Scenario: Index changes
- **WHEN** Git/index state changes after staging, unstaging, or another Git operation
- **THEN** the extension recomputes worktree-vs-index hunks and publishes updated controller state

### Requirement: vshu-8 — Inline diff rendering
WHEN the active editor review surface is active, THE extension SHALL render the current file's unstaged diff in a read-only virtual hunk document with visibly selected current hunk styling and visible added/deleted text styling for both current and non-current hunks, and SHALL render every displayed source line on a separate viewport row.

#### Scenario: Current hunk visible
- **WHEN** the active editor contains a file with multiple unstaged hunks
- **THEN** the current hunk is visibly selected with brighter red/green diff styling than non-current hunks

#### Scenario: Non-current hunks visible
- **WHEN** the active editor contains unstaged hunks that are not current
- **THEN** the extension renders those hunks with duller red/green diff styling than the current hunk

#### Scenario: Added text visible
- **WHEN** a hunk contains added lines that exist in the active editor buffer
- **THEN** the extension highlights the added line ranges using green diff styling

#### Scenario: Deleted text visible
- **WHEN** a hunk contains deleted lines that no longer exist in the active editor buffer
- **THEN** the extension displays the deleted text inline at the hunk's new-file position using red diff styling without inserting it into the document buffer
- **AND** each deleted source line occupies its own viewport row
- **AND** deleted rows display the original source text without adding a leading diff marker such as `-`
- **AND** deleted text does not overlap or horizontally displace added or unchanged source lines

#### Scenario: Virtual document uses source syntax highlighting
- **WHEN** the extension opens a virtual hunk document for a source file
- **THEN** the virtual hunk document uses the source file's detected language mode
- **AND** code tokens in the virtual hunk document receive the same syntax highlighting style available to that language mode

#### Scenario: Replacement hunk groups new and old code at new position
- **WHEN** a hunk contains both deleted lines and added lines
- **THEN** the extension displays all added lines for that hunk together as a green block at the new-file position
- **AND** displays all deleted lines for that hunk together as a red block immediately adjacent to that green block
- **AND** anchors the replacement group near the new lines rather than the deleted lines' original line numbers
- **AND** does not interleave deleted and added lines within that hunk's inline rendering
- **AND** displays each added or deleted source line on its own viewport row

#### Scenario: Uneven replacement groups remain contiguous
- **WHEN** a hunk replaces any number of deleted lines with any number of added lines
- **THEN** the extension displays all added lines for that hunk as one contiguous group
- **AND** displays all deleted lines for that hunk as one contiguous group
- **AND** avoids alternating between deleted and added display lines within that hunk

#### Scenario: Action unavailable
- **WHEN** an action is unavailable for the current hunk state
- **THEN** the extension reports the matching action as unavailable in controller state

#### Scenario: No active hunks
- **WHEN** the active file has no unstaged hunks or the active editor is no longer a file editor
- **THEN** the extension clears inline hunk decorations from the previously decorated editor

#### Scenario: No separate review panel
- **WHEN** the active editor review surface is active
- **THEN** the extension does not open, reveal, or retain a separate webview panel for hunk review

### Requirement: vshu-9 — Virtual hunk document mapping
WHEN the extension renders a virtual hunk document, THE extension SHALL maintain a reusable mapping layer from virtual document rows to real file/hunk context and from real file/hunk context to virtual document rows.

#### Scenario: Virtual row maps to real context
- **WHEN** a consumer asks for the context of a virtual document row
- **THEN** the mapping layer returns whether that row is context, added, or deleted
- **AND** returns the underlying real file path
- **AND** returns the associated hunk id when the row belongs to a hunk
- **AND** returns the real line number when the row corresponds to a real file line

#### Scenario: Hunk maps to virtual span
- **WHEN** a consumer asks for a hunk's virtual location
- **THEN** the mapping layer returns the hunk's virtual start line, virtual end line, added virtual range, and deleted virtual range

#### Scenario: Real line maps to virtual row
- **WHEN** a consumer asks for the virtual row corresponding to a real file line
- **THEN** the mapping layer returns the matching virtual row when that real line is present in the virtual document
- **AND** returns no row when the real line is not represented

#### Scenario: Virtual URI round trip
- **WHEN** the extension creates a virtual hunk document URI for a repo root and file path
- **THEN** the mapping layer can parse that URI back to the same repo root and file path
