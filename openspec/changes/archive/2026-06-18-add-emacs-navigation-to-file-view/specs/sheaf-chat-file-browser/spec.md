## ADDED Requirements

### Requirement: fb-30 — Browser workspace: read-only point navigation

WHEN a supported file tab is selected, THE file browser SHALL expose a visible read-only point in the file view and SHALL move point without modifying file content by using `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, mouse clicks in the file content, `C-a`, `C-e`, `C-v`, and `M-v`; `C-a` SHALL move point to the beginning of the current logical line, `C-e` SHALL move point to the end of the current logical line, `C-v` SHALL move point and the viewport one page forward rather than jumping to the file end, and `M-v` SHALL move point and the viewport one page backward rather than jumping to the file beginning. For Markdown previews, THE file browser SHALL compute navigation targets against the underlying Markdown source text and SHALL project the resulting source position into the rendered DOM at the closest reliable mapped location; when exact mapping is unavailable, THE file browser SHALL preserve the source position as the navigation source of truth and MAY use a nearest-position or source-text fallback presentation.

#### Scenario: Selected file shows point

- **WHEN** a supported file tab finishes rendering
- **THEN** the file view shows a visible point at that tab's current navigation position

#### Scenario: Arrow keys move point

- **WHEN** focus is in the file view and the user presses an arrow key
- **THEN** the file browser moves point in the corresponding direction without changing the selected file content

#### Scenario: Mouse click moves point

- **WHEN** the user clicks a location in rendered file content
- **THEN** the file browser moves point to the nearest addressable text position for that click

#### Scenario: Emacs line commands

- **WHEN** focus is in the file view and the user presses `C-a`
- **THEN** point moves to the beginning of the current logical line
- **WHEN** focus is in the file view and the user presses `C-e`
- **THEN** point moves to the end of the current logical line

#### Scenario: Emacs page commands

- **WHEN** focus is in the file view and the user presses `C-v`
- **THEN** the file view scrolls one page forward
- **AND** point moves forward by approximately one visible page of logical source lines
- **AND** point does not jump directly to the file end unless the next page reaches the end
- **WHEN** focus is in the file view and the user presses `M-v`
- **THEN** the file view scrolls one page backward
- **AND** point moves backward by approximately one visible page of logical source lines
- **AND** point does not jump directly to the file beginning unless the previous page reaches the beginning

#### Scenario: Read-only navigation

- **WHEN** the user invokes any point navigation command
- **THEN** the selected tab's file content, server file content, and file REST APIs are unchanged

#### Scenario: Markdown navigation uses source text

- **WHEN** a Markdown preview is selected
- **AND** focus is in the file view
- **AND** the user invokes a point navigation command
- **THEN** the file browser computes the new point against the underlying Markdown source text
- **AND** renders the point at the closest corresponding position in the rendered Markdown DOM

#### Scenario: Markdown navigation persists best-effort

- **WHEN** a Markdown tab has a point or mark position
- **AND** the tab is switched away, refreshed, or restored from workspace editor state
- **THEN** the file browser restores point and mark near the prior logical Markdown source position using source offset, nearby line and column, or surrounding text as available

### Requirement: fb-37 — Browser workspace: point and viewport synchronization

WHEN a supported file tab is selected, THE file browser SHALL keep the read-only point and the file-view viewport synchronized: point movement SHALL keep point visible by scrolling the file view when point leaves the viewport, viewport movement SHALL move point by the corresponding number of logical source lines, and Agent Review hunk navigation SHALL move point to the newly focused hunk or nearest visible source position.

#### Scenario: Point movement scrolls viewport

- **WHEN** point movement places point below the visible viewport
- **THEN** the file browser scrolls the file view downward enough to bring point back into view near one third of the viewport from the edge
- **WHEN** point movement places point above the visible viewport
- **THEN** the file browser scrolls the file view upward enough to bring point back into view near one third of the viewport from the edge

#### Scenario: Viewport scrolling moves point

- **WHEN** the user scrolls the file view with a wheel, trackpad, scrollbar, or equivalent viewport scroll
- **THEN** the file browser moves point by the approximate number of logical source lines represented by the viewport delta
- **AND** preserves point's relative visible position as closely as practical

#### Scenario: Page commands synchronize point and viewport

- **WHEN** the user invokes `C-v` or `M-v`
- **THEN** the file browser updates both point and scroll position in the same direction
- **AND** point remains visible after the command

#### Scenario: Search keeps point visible

- **WHEN** forward or reverse incremental search moves point to a match outside the visible viewport
- **THEN** the file browser scrolls the file view enough to keep the matched point visible
- **AND** repeated forward or reverse search continues to keep point and viewport synchronized

#### Scenario: Agent Review navigation moves point

- **WHEN** Agent Review hunk navigation scrolls the file view to a different hunk
- **THEN** the file browser moves point to the focused hunk's nearest source position
- **AND** the visible point follows the hunk currently presented by Agent Review

### Requirement: fb-31 — Browser workspace: command cancellation

WHEN focus is in the file view or an Emacs-style prompt, THE file browser SHALL treat `C-g` as the universal cancellation command for active keyboard command state: it SHALL clear pending key prefixes, close active find-file or tab-switch prompts without accepting them, cancel active incremental search according to `fb-33`, deactivate an active mark when no command state is active according to `fb-32`, and otherwise be harmless.

#### Scenario: Cancel pending key prefix

- **WHEN** focus is in the file view
- **AND** the user presses `C-x`
- **AND** the user presses `C-g`
- **THEN** the file browser clears the pending `C-x` prefix
- **AND** does not run any `C-x` command

#### Scenario: Cancel active prompt

- **WHEN** a find-file or tab-switch prompt is active
- **AND** the user presses `C-g`
- **THEN** the file browser closes the prompt without accepting the prompt contents
- **AND** preserves the selected tab and selected file content

#### Scenario: Cancel with inactive mark and no active command

- **WHEN** focus is in the file view
- **AND** no key prefix, prompt, or search is active
- **AND** mark is inactive
- **AND** the user presses `C-g`
- **THEN** the file browser leaves point, mark, selected tab, and file content unchanged

### Requirement: fb-32 — Browser workspace: mark and active region

WHEN focus is in the file view, THE file browser SHALL support Emacs-like mark behavior for read-only navigation: `C-SPC` SHALL set mark at point and activate it, movement while mark is active SHALL show the region between mark and point, and `C-x C-x` SHALL exchange point and mark while leaving the region active.

#### Scenario: Set mark

- **WHEN** focus is in the file view and the user presses `C-SPC`
- **THEN** the file browser sets mark at point
- **AND** activates the mark

#### Scenario: Active region follows movement

- **WHEN** mark is active and the user moves point
- **THEN** the file browser highlights the region between mark and point

#### Scenario: Exchange point and mark

- **WHEN** mark has been set and the user presses `C-x C-x`
- **THEN** the file browser moves point to the previous mark position
- **AND** moves mark to the previous point position
- **AND** leaves mark active

#### Scenario: Exchange inactive mark

- **WHEN** mark has been set but is inactive and the user presses `C-x C-x`
- **THEN** the file browser exchanges point and mark
- **AND** reactivates the mark

#### Scenario: Cancel deactivates active mark

- **WHEN** mark is active and no key prefix, prompt, or search is active
- **AND** the user presses `C-g`
- **THEN** the file browser preserves the stored mark position
- **AND** deactivates the mark so the active region highlight disappears
- **WHEN** the user later presses `C-x C-x`
- **THEN** the file browser exchanges point and the stored mark
- **AND** reactivates the mark

#### Scenario: Mark remains read-only

- **WHEN** mark is active
- **THEN** the file browser exposes no command that deletes, copies, replaces, or edits the highlighted region

### Requirement: fb-33 — Browser workspace: incremental search

WHEN focus is in the file view, THE file browser SHALL support Emacs-like incremental search: `C-s` SHALL start or repeat forward search, `C-r` SHALL start or repeat reverse search, typed printable characters SHALL update the search string and current match immediately, the current match SHALL be highlighted, `RET` SHALL accept the current match, `C-g` SHALL cancel search and restore the origin point, and an ordinary movement command SHALL exit search before running that movement command.

#### Scenario: Forward incremental search

- **WHEN** focus is in the file view and the user presses `C-s`
- **THEN** the file browser opens a search prompt in forward mode
- **AND** each printable character typed into the prompt updates the search string and moves point to the next matching occurrence

#### Scenario: Reverse incremental search

- **WHEN** focus is in the file view and the user presses `C-r`
- **THEN** the file browser opens a search prompt in reverse mode
- **AND** each printable character typed into the prompt updates the search string and moves point to the previous matching occurrence

#### Scenario: Repeat search

- **WHEN** an incremental search has a non-empty search string and the user presses `C-s`
- **THEN** the file browser repeats the search forward for the next occurrence
- **WHEN** an incremental search has a non-empty search string and the user presses `C-r`
- **THEN** the file browser repeats the search backward for the previous occurrence

#### Scenario: Repeat search pauses before wrapping

- **WHEN** a forward incremental search is on the last occurrence after the search origin
- **AND** the user presses `C-s`
- **THEN** the file browser keeps point on the current match
- **AND** the prompt indicates that continuing would wrap past the end
- **WHEN** the user presses `C-s` again
- **THEN** the file browser wraps to the first occurrence and indicates the search has wrapped
- **WHEN** a reverse incremental search is on the first occurrence before the search origin
- **AND** the user presses `C-r`
- **THEN** the file browser keeps point on the current match and indicates that continuing would wrap past the beginning
- **WHEN** the user presses `C-r` again
- **THEN** the file browser wraps to the last occurrence and indicates the search has wrapped

#### Scenario: Direction switch

- **WHEN** an incremental search is active and the user presses the opposite search direction command
- **THEN** the file browser switches search direction without clearing the search string

#### Scenario: Smart case search

- **WHEN** an incremental search string contains only lowercase letters
- **THEN** the file browser matches occurrences case-insensitively
- **WHEN** an incremental search string contains at least one uppercase letter
- **THEN** the file browser matches the entire search string case-sensitively
- **AND** removing the uppercase letter restores case-insensitive matching for the remaining lowercase search string

#### Scenario: Search accepted

- **WHEN** an incremental search is active and the user presses `RET`
- **THEN** the file browser closes the search prompt and leaves point at the current match

#### Scenario: Search canceled

- **WHEN** an incremental search is active and the user presses `C-g`
- **THEN** the file browser closes the search prompt and restores point to the position where the search began

#### Scenario: Movement exits search

- **WHEN** an incremental search is active and the user invokes a point movement command that is not a search editing command
- **THEN** the file browser exits search and then performs that point movement command

### Requirement: fb-34 — Browser workspace: search and mark interaction

WHEN incremental search starts while no mark is active, THE file browser SHALL remember the search origin as an inactive mark candidate so that `C-x C-x` after accepting the search can return to the origin; WHEN incremental search starts while mark is active, THE file browser SHALL preserve the active mark and SHALL NOT replace it with the search origin.

#### Scenario: Search records inactive origin mark

- **WHEN** mark is inactive or unset and the user starts incremental search
- **AND** the user accepts a successful search
- **THEN** the file browser records the search origin as an inactive mark

#### Scenario: Exchange returns to search origin

- **WHEN** the user accepted a search that recorded an inactive origin mark
- **AND** the user presses `C-x C-x`
- **THEN** point moves to the search origin
- **AND** mark moves to the search result position
- **AND** mark becomes active

#### Scenario: Active mark survives search

- **WHEN** mark is active and the user starts incremental search
- **AND** the user accepts the search
- **THEN** the file browser preserves the active mark position
- **AND** the highlighted region extends between that mark and the new point

#### Scenario: Canceled search preserves previous mark state

- **WHEN** the user cancels incremental search with `C-g`
- **THEN** the file browser restores point to the search origin
- **AND** preserves the mark state that existed before the search began

### Requirement: fb-35 — Browser workspace: find-file command

WHEN focus is in the file view and the user presses `C-x C-f`, THE file browser SHALL open a minibuffer-style find-file prompt whose default directory is the directory of the currently selected file, SHALL use `TAB` to complete readable root-scoped path segments from existing directory-list APIs, and SHALL open or focus a supported file tab when the user accepts a file path.

#### Scenario: Find-file default directory

- **WHEN** the selected file path is `docs/guide/readme.md`
- **AND** the user presses `C-x C-f`
- **THEN** the find-file prompt starts from `docs/guide/`

#### Scenario: Find-file tab completion

- **WHEN** the find-file prompt is active and the user presses `TAB`
- **THEN** the file browser extends the current path segment by every unambiguous character shared by matching entries
- **AND** completes the current path segment when there is a unique match
- **AND** shows available completion candidates when there are multiple matches
- **AND** does not choose among multiple matching entries that diverge after the shared prefix

#### Scenario: Find-file opens supported file

- **WHEN** the find-file prompt contains a supported root-relative file path
- **AND** the user presses `RET`
- **THEN** the file browser opens or focuses that file in the normal tabbed file viewer

#### Scenario: Find-file descends directory

- **WHEN** the find-file prompt contains a root-relative directory path
- **AND** the user presses `RET` or completes the directory with a trailing slash
- **THEN** the prompt updates to that directory and offers completion for its children

#### Scenario: Find-file rejects unsafe path

- **WHEN** the find-file prompt contains an absolute path, parent traversal, NUL byte, or otherwise root-escaping path
- **AND** the user presses `RET`
- **THEN** the file browser does not open a tab
- **AND** shows a prompt error without adding a new file API

### Requirement: fb-36 — Browser workspace: buffer-style tab switching

WHEN focus is in the file view and the user presses `C-x b`, THE file browser SHALL open a minibuffer-style tab-switch prompt that treats currently open file tabs as buffers, SHALL complete by tab name or root-relative path, SHALL select the accepted existing tab, and SHALL use empty input to select the most recently selected non-current tab when one exists.

#### Scenario: Tab switch completion

- **WHEN** the tab-switch prompt is active and the user types part of an open tab's name or path
- **AND** the user presses `TAB`
- **THEN** the file browser extends the prompt by every unambiguous character shared by matching open tabs
- **AND** completes to the existing tab when there is a unique match
- **AND** lists matching open tabs when there are multiple matches
- **AND** does not choose among multiple matching tabs that diverge after the shared prefix

#### Scenario: Tab switch accepts existing tab

- **WHEN** the tab-switch prompt contains an existing open tab name or path
- **AND** the user presses `RET`
- **THEN** the file browser selects that tab

#### Scenario: Empty input selects previous tab

- **WHEN** the tab-switch prompt is active with empty input
- **AND** there is a most recently selected non-current tab
- **AND** the user presses `RET`
- **THEN** the file browser selects that non-current tab

#### Scenario: Nonexistent buffer is not created

- **WHEN** the tab-switch prompt contains no existing tab match
- **AND** the user presses `RET`
- **THEN** the file browser does not create an empty buffer or file tab
- **AND** shows a prompt error
