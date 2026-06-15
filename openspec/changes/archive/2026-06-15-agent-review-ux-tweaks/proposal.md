## Why

Three small Agent Review Mode usability gaps surfaced in use: the physical Launchpad stays lit (and pressable) when no browser tab is actually watching the review; `Next`/`Previous` silently cross file boundaries even though dedicated `Next File`/`Previous File` controls exist; and there is no at-a-glance sense of how much is left to review. None require new server-computed data — the file/hunk summaries and the attached-socket set already exist — so this is a small behavior-and-UI change scoped to Agent Review Mode.

## What Changes

- Gate the Launchpad on browser focus: while no attached Agent Review browser client is focused (its tab is hidden **or** its window has lost OS focus), Sheaf Chat sets all of its owned Launchpad cells off and ignores generic cell-pressed events; when a focused client returns, it restores the cell colors from current Agent Review state. The Launchpad stores nothing — Sheaf Chat re-derives cells from the state it already owns.
- Add a client→service presence frame so the service knows whether any attached client is focused. Focus is strict: a client counts as focused only while its document is visible and its window has OS focus. The Launchpad is lit while **any** attached client is focused, dark only when **all** are unfocused.
- Make `Next`/`Previous` (next-hunk/previous-hunk) loop within the current file: next-hunk at a file's last hunk wraps to its first, previous-hunk at the first wraps to the last. Crossing into another file happens only through `Next File`/`Previous File`. When the current file has a single hunk, next-hunk and previous-hunk are reported unavailable.
- Make `Next File`/`Previous File` available whenever another file with unstaged hunks exists in that direction, regardless of which hunk in the current file is selected, and land on the first hunk of the target file.
- Add an unobtrusive position indicator at the top of the Agent Review bar showing the current hunk's position within the current file (`a/x`) and the current file's position among files with unstaged hunks (`file b/y`), derived from data already in Agent Review state.
- Auto-scroll the file tab bar horizontally so the active file's tab stays visible when the tab bar overflows.
- Remove the current file name from the Agent Review bar (it is now conveyed by the always-visible active tab).

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: add Launchpad presence gating on browser focus (new `presence` client frame; cells off and presses ignored while unfocused), in-file looping semantics for hunk navigation (single-hunk files disable next/previous), file navigation availability/landing across files, and a position indicator in the review UI (no longer repeating the file name).
- `sheaf-chat-file-browser`: auto-scroll the file tab bar so the active tab stays visible.

## Impact

- `projects/sheaf-chat/src/server/agentReview/service.ts`: per-socket focus tracking; gate `UpdateDictatorCells` and `HandleCellPressed` on whether any client is focused; change `Navigate()` next-hunk/previous-hunk to loop within the current file and next-file/previous-file to jump to the first hunk of the adjacent file; change `ActionsFor()` so `canGoUp`/`canGoDown` reflect single-hunk files and `canGoPrevFile`/`canGoNextFile` reflect whether another file exists in that direction.
- `projects/sheaf-chat/src/server/agentReview/types.ts`: add the `presence` frame to `AgentReviewClientFrame`.
- `projects/sheaf-chat/src/ui/sheaf-chat.js`: send presence on entering review and on `visibilitychange`/window `focus`/`blur`; render the position indicator in the review bar (without the file name); scroll the selected file tab into view in `RenderTabs`.
- `projects/sheaf-chat/src/ui/sheaf-chat.css`: styling for the indicator.
- Tests: Sheaf Chat service tests for in-file looping and presence gating; a UI test for the indicator.
