## Why

Sheaf Chat's file view is already the primary reading surface for workspace files, but it lacks editor-grade keyboard navigation. Adding an Emacs-like cursor, mark, search, file opening, and tab-switching model makes read-only code navigation faster without expanding the file browser into an editor.

## What Changes

- Add a visible read-only cursor, also called point, to the selected file view.
- Move point with arrow keys, page commands, line-boundary commands, and mouse clicks.
- Match Emacs key behavior for `C-a` beginning-of-line, `C-e` end-of-line, `C-v` page down, `M-v` page up, and `C-g` cancellation of active command state.
- Add Emacs-style mark support with `C-SPC` and `C-x C-x`, including an active region highlight between mark and point.
- Add incremental forward and reverse search through `C-s` and `C-r`, including repeat, direction switching, cancellation, and mark interaction.
- Add `C-x C-f` find-file navigation rooted at the selected file's directory, with usable tab completion.
- Add `C-x b` tab switching across currently open file tabs with completion.
- For Markdown previews, run navigation commands against the underlying Markdown source and project the resulting source position into the rendered DOM with best-effort persistence.
- Keep the file viewer read-only: no text insertion, deletion, save, kill, yank, or write behavior is introduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sheaf-chat-file-browser`: Adds read-only Emacs-like navigation commands to the existing file viewer, including point, mark, incremental search, find-file, and buffer/tab switching.

## Impact

- Affects `projects/sheaf-chat/src/ui/sheaf-chat.js` and related CSS for cursor, region, search, and minibuffer-style command UI.
- Affects Sheaf Chat Playwright UI tests for file viewer keyboard and mouse behavior, command orthogonality, randomized navigation simulation, and Agent Review compatibility.
- Does not change REST file APIs, scoped tool APIs, Agent Review mutation contracts, or server-side file write behavior.
