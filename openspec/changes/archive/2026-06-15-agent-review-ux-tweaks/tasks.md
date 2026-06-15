## 1. In-File Hunk Looping (arm-18)

- [x] 1.1 Change `Navigate()` next-hunk/previous-hunk in `service.ts` to compute the current file's contiguous `[start..end]` run and wrap within it instead of moving along the global flat list.
- [x] 1.2 Update `ActionsFor()` so `canGoUp`/`canGoDown` are true only when the current file has more than one hunk, and false for a single-hunk file.
- [x] 1.3 Confirm `Next File`/`Previous File` behavior and `canGoPrevFile`/`canGoNextFile` are unchanged.
- [x] 1.4 Add service tests: next wraps last→first within a file, previous wraps first→last, navigation never crosses a file boundary, single-hunk file disables next/previous, file crossing still works via file commands.

## 2. Launchpad Presence Gating (arm-19)

- [x] 2.1 Add a `presence` client frame (`{ type: "presence", focused }`) to `AgentReviewClientFrame` in `types.ts` and parse/validate it in the service message handler.
- [x] 2.2 Track a focused flag per socket; default new sockets to focused on attach; compute an "any client focused" aggregate.
- [x] 2.3 Gate `UpdateDictatorCells` so it sends all owned cells (navigation/mutation + `(3,3)`) off while no client is focused, and restores colors from state when a client is focused.
- [x] 2.4 Gate `HandleCellPressed` to drop generic cell-pressed events while no client is focused.
- [x] 2.5 Re-run the cell update when the aggregate focus state changes (off on going dark, restore on refocus).
- [x] 2.6 UI: compute focus as `!document.hidden && document.hasFocus()`; send presence on entering review and on `visibilitychange`/window `focus`/`blur`.
- [x] 2.7 Add service tests: cells off while unfocused, presses ignored while unfocused, a background refresh does not relight while unfocused, refocus restores cells, grid stays lit while any client is focused.

## 3. Position Indicator (arm-20)

- [x] 3.1 Render an unobtrusive position indicator in the review bar (`sheaf-chat.js`) showing hunk-in-file (`a/x`) and file (`file b/y`), deriving the within-file hunk index from `files[]` and the current hunk's `fileIndex`/`hunkIndex`.
- [x] 3.2 Handle the no-current-hunk case (files count only) and update on every Agent Review state change.
- [x] 3.3 Add CSS for the indicator in `sheaf-chat.css`.
- [x] 3.4 Add a UI test asserting the indicator shows hunk and file positions and updates with state.

## 4. File Navigation Across Files (arm-21)

- [x] 4.1 Change `ActionsFor()` so `canGoPrevFile`/`canGoNextFile` reflect whether another file with hunks exists before/after the current file (by `fileIndex`), not the adjacent hunk's file.
- [x] 4.2 Change `Navigate()` next-file/previous-file to land on the first hunk of the adjacent file, from any selected hunk.
- [x] 4.3 Add a service test: file navigation is available from a non-boundary hunk and lands on the target file's first hunk in both directions; first/last files disable previous/next file.

## 5. File Tab Auto-Scroll & Review Bar Cleanup (fb-28, arm-20)

- [x] 5.1 Add `ScrollSelectedTabIntoView()` and call it from `RenderTabs()` so the selected desktop tab is scrolled into view (guarded `scrollIntoView`).
- [x] 5.2 Remove the current file name from the Agent Review bar status text in `sheaf-chat.js`.
- [x] 5.3 Add a UI test asserting the selected tab is scrolled into view on open and on tab switch.

## 6. Validation

- [x] 6.1 Run Sheaf Chat tests covering hunk looping, file navigation, presence gating, the position indicator, and tab auto-scroll.
- [x] 6.2 Manual smoke test with Dictator + Launchpad: background the tab/window and confirm pads go dark and presses are inert; refocus and confirm they restore; loop next/previous within a multi-hunk file; cross files from any hunk with next/previous file; verify the position indicator and that the active tab auto-scrolls into view. _(Verified by the user against the live Dictator + Launchpad — reported clean.)_
- [x] 6.3 Update Sheaf Chat coverage/operations docs if documented review behavior changes. _(No-op: docs do not describe review navigation, tab behavior, or Launchpad cell behavior, so nothing to update.)_

