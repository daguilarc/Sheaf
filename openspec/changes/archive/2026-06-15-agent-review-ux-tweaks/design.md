## Context

Agent Review Mode lives in `projects/sheaf-chat/src/server/agentReview/` (service + git + types) with a vanilla-JS UI in `projects/sheaf-chat/src/ui/sheaf-chat.js`. The Launchpad is a physical device owned by Dictator; Sheaf Chat drives its cells over the generic Dictator WebSocket RPC (`launchpad.setCells`) and receives generic press events. The authoritative review state (`m_state`, `m_currentIndex`, `actions`) lives entirely in the `AgentReviewSession`; the Launchpad is a stateless renderer of the colors Sheaf Chat last sent.

Hunks are stored as a flat array grouped contiguously by file (see `BuildHunks` in `git.ts`): all of file 0's hunks, then file 1's, etc. Each hunk carries `fileIndex`, `fileCount`, and a global `hunkIndex`/`hunkCount`; the state also carries a `files` summary (`{ file, hunkCount }[]`). The set of attached browser sockets is `m_sockets` (a `Set`).

## Goals / Non-Goals

**Goals:**

- Clear the Launchpad cells and ignore presses while no attached browser client is focused, and restore on refocus — without the Launchpad needing to remember anything.
- Make next-hunk/previous-hunk loop within the current file; keep file crossing on the file commands only.
- Show files-with-unstaged-hunks and current-file-hunk counts at the top of the review bar.

**Non-Goals:**

- Do not change what `Next File`/`Previous File` do (they still cross files; no wrapping across the whole list).
- Do not add new server-computed data; the indicator and counts come from existing state.
- Do not persist focus/presence across reconnects; presence is live connection state only.
- Do not change Dictator: it remains a stateless cell renderer and event forwarder.

## Decisions

### Presence is a per-socket flag, aggregated as "any focused"

`m_sockets` can hold more than one client, so the service tracks a focused flag per socket and lights the Launchpad while **any** attached client is focused, dark only when **all** are unfocused. A new client→service frame carries the signal:

```
{ "type": "presence", "focused": boolean }
```

The UI sends it on entering review (initial state) and whenever focus changes. New sockets default to focused on attach until told otherwise, preserving today's behavior for the common single-tab case.

_Alternative considered:_ a single global flag. Rejected because two tabs on one review session would fight over it; per-socket aggregation is a few lines and correct.

### "Focused" is strict: visible AND window-focused

The UI computes focus as `!document.hidden && document.hasFocus()` and re-evaluates on `visibilitychange`, window `focus`, and window `blur`. This matches "the browser is not focused" — switching to another application clears the Launchpad, not just switching tabs. `visibilitychange` covers tab switch/minimize; window `blur`/`focus` covers app switching while the tab stays active.

### Gating lives inside `UpdateDictatorCells` and `HandleCellPressed`

Clearing cannot be a one-shot "send off on blur," because a background `RefreshAndBroadcast` (fired by file-change notifications) calls `UpdateDictatorCells` and would re-light the grid while the user is away. So:

- `UpdateDictatorCells`: when no client is focused, send all owned cells off (navigation/mutation + the `(3,3)` review cell) regardless of action availability; otherwise behave as today. This is the only "memory" required, and it lives on the Sheaf Chat side where the state already is.
- `HandleCellPressed`: when no client is focused, drop the event. Dictator forwards presses regardless of LED state, so this guard is what makes the dark pads inert.

This gating takes precedence over the per-action coloring in arm-13 (`(3,3)`) and arm-17 (navigation/mutation cells).

### In-file looping computes the current file's contiguous run

Because hunks are contiguous per file, the current file occupies `[start..end]`, the first/last indices whose `hunk.file === current.file`. Then next-hunk is `currentIndex === end ? start : currentIndex + 1` and previous-hunk is `currentIndex === start ? end : currentIndex - 1`. `ActionsFor` sets `canGoUp`/`canGoDown` true only when `end > start` (more than one hunk in the file); both false for a single-hunk file. `canGoPrevFile`/`canGoNextFile` and the file commands are unchanged. The on-screen buttons and the Launchpad cells both derive from `actions`, so both follow automatically — arm-17 cell-coloring wording is unchanged; only the availability it reads from changes.

### File navigation is fileIndex-based and lands on the file's first hunk

Availability previously checked whether the immediately adjacent hunk was in another file, so file navigation was dark whenever the current file's neighbor hunk was same-file. It now keys off the file's position: `canGoPrevFile = current.fileIndex > 0`, `canGoNextFile = current.fileIndex < current.fileCount - 1` — available from any hunk in the file. `Navigate()` for next/previous-file uses `findIndex(hunk => hunk.fileIndex === current.fileIndex ± 1)`, which (since hunks are grouped by file) lands on the first hunk of the adjacent file. This makes both directions symmetric (next-file already landed on the next file's first hunk; previous-file previously landed on the prior file's last hunk).

### Indicator is UI-only, from existing state

The review bar renders a small muted element with two positions: the current hunk within its file (`a/x`) and the current file among files with unstaged hunks (`file b/y`). All derived from `reviewState.files` plus the current hunk's `fileIndex`/`hunkIndex`: `x = files[fileIndex].hunkCount`, `b = fileIndex + 1`, `y = files.length`, and `a = hunkIndex − (sum of hunkCounts of files before fileIndex) + 1`. No protocol or server change is needed. When no hunk is focused it falls back to the files count.

## Risks / Trade-offs

- Some environments fire `blur` when DevTools takes focus, briefly darkening the Launchpad → acceptable; refocusing restores immediately.
- "Lit while any focused" means a hidden second tab won't dark the grid if a first tab is focused → this is the intended reading of the feature.
- Disabling next/previous on single-hunk files is a deliberate change from today's clamp-to-bounds → consistent with looping (nothing to loop to).
