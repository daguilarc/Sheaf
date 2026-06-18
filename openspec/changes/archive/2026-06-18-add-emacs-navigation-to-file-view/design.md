## Context

Sheaf Chat's file browser is a read-only workspace surface with explorer navigation, tabs, Markdown/plain-text rendering, syntax highlighting, stale-tab refresh, and optional Agent Review hunk affordances. Today, the selected file is mostly a scrollable preview. Users can open and switch files, but cannot keep a visible point, set a mark, search incrementally, or drive file/tab navigation with editor-style command sequences.

The Emacs behaviors that matter for this change are:

- `C-a` moves to beginning of line and `C-e` moves to end of line.
- `C-v` scrolls one screen forward and `M-v` scrolls one screen backward, moving point onscreen if needed.
- `C-g` cancels active transient command state: pending key prefixes, minibuffer prompts, and incremental search. With no active command state, it is harmless and does not modify navigation state.
- `C-SPC` sets and activates mark at point; `C-x C-x` exchanges point and mark and leaves the region active.
- `C-s` and `C-r` start incremental forward and reverse search. Repeating `C-s` or `C-r` moves through additional matches; exiting search leaves point at the match and records the search origin in the mark ring only when no mark was already active.
- `C-x C-f` visits a file through a minibuffer prompt; `C-x b` switches buffers through minibuffer completion.

The user's `C-e: line start` wording conflicts with Emacs. This design treats it as a dictation slip and implements the Emacs mapping: `C-a` beginning-of-line and `C-e` end-of-line.

## Goals / Non-Goals

**Goals:**

- Add a visible, keyboard-addressable point to the selected file view.
- Support read-only point movement via arrows, mouse clicks, line-boundary commands, and page commands.
- Support `C-g` as the universal cancellation command for active keyboard prefixes, prompts, and incremental search.
- Support mark, active region highlighting, and point/mark exchange close to Emacs.
- Support incremental forward and reverse search close to Emacs, including repeat, direction switching, wrap indication, cancellation, and mark interaction.
- Support `C-x C-f` file opening with default directory from the selected file and tab completion.
- Support `C-x b` tab switching with completion over open file tabs.
- Treat Markdown navigation as source-backed: commands operate on the raw Markdown file, then project the resulting source position to the rendered DOM as closely as possible.
- Preserve existing file browser, mobile panel, persisted editor state, Markdown, syntax highlighting, and Agent Review behaviors.

**Non-Goals:**

- No editing commands, text mutation, save, kill/yank, clipboard integration, or server write APIs.
- No full Emacs minibuffer, mark-ring stack UI, prefix arguments, registers, macros, windows, Dired, remote files, or wildcard file expansion.
- No change to Agent Review server commands, file REST API contracts, or scoped tool behavior.

## Decisions

1. Represent point and mark as plain-text offsets in the selected tab.

   Each open tab should track navigation state: point offset, mark offset, mark activity, desired visual column for vertical motion, last search string, any transient search origin, and the active key-prefix or prompt state needed for `C-g` cancellation. Rendering code maps those offsets onto the current file content and highlights the point and active region in the preview.

   Alternative considered: store DOM node/range positions. That would make Markdown and syntax-highlighted rendering fragile because rendered DOM nodes do not map cleanly to source text after Markdown transforms, highlighting spans, or Agent Review inline diff markup.

2. Use source offsets as the source of truth for Markdown navigation.

   Markdown tabs should treat the raw Markdown source as the navigation document. Line commands, page commands, mark, search, and prompt-driven jumps compute their target positions against the underlying Markdown text, not against the rendered DOM tree. The renderer then projects the resulting source offset onto the rendered DOM location that best corresponds to that source span. When exact source-to-DOM mapping is unavailable, the UI should choose the nearest deterministic DOM placement or temporarily expose a source-text navigation presentation, while preserving the source offset as the authoritative point.

   Navigation state for Markdown should persist on a best-effort basis across tab switches, refreshes, and workspace editor-state restore. It does not need strict byte-perfect restoration after content changes, but it should prefer stable anchors such as source offset, nearby line/column, and surrounding text so the point returns near the user's last logical Markdown position.

   Alternative considered: navigate rendered Markdown structure directly. That would make Emacs commands depend on heading/link/list DOM shape instead of the file the user is conceptually navigating, and would make searches disagree with the Markdown source.

3. Render a navigation overlay from a text-segment model.

   Plain text and highlighted previews should be generated from source text segments so point, search match, and region spans can be inserted before escaping or highlighting boundaries are finalized. Markdown previews should preserve the normal rendered document while projecting point, mark, search match, and region state from source offsets into the DOM wherever source mapping is reliable; if Markdown source-to-DOM mapping is not reliable, fall back to a source-text navigation mode for cursor operations while keeping Markdown preview available.

   Alternative considered: use the browser Selection API directly. That conflicts with persistent point state, Emacs mark semantics, and rendered Markdown links.

4. Couple point and viewport movement.

   Point remains the authoritative navigation state, but viewport changes are not independent of it. Keyboard movement should scroll the file view when point leaves the viewport, page commands should move point and scroll by approximately one visible page, user scrolling should translate the viewport delta back into logical source-line movement, and Agent Review hunk navigation should move point to the focused hunk's nearest source position. This keeps Emacs navigation, scroll gestures, and review navigation from drifting into separate notions of "where the user is."

   Alternative considered: preserve scroll position independently from point except during explicit page commands. That matches a passive preview, but it lets point disappear offscreen and makes Agent Review hunk focus disagree with the visible file location.

5. Add a local key-sequence dispatcher scoped to the file workspace.

   The dispatcher should run when focus is in the file view or its command prompt, parse multi-key sequences such as `C-x C-f`, and prevent browser defaults for claimed commands. `C-g` should clear pending prefixes, close prompts, cancel incremental search, and restore search origin state where required. Unclaimed keys should retain existing browser and chat behavior. The command prompt owns text input while active so printable characters can build search/file/tab queries without mutating file content.

   Alternative considered: attach global `document` shortcuts. That risks intercepting chat composer typing, browser controls, and future command surfaces.

6. Implement a small minibuffer-style prompt for transient commands.

   `C-s`, `C-r`, `C-x C-f`, and `C-x b` should share a compact prompt at the bottom of the file pane. The prompt shows command name, current query, completion candidates or search status, and errors. Search updates point as matches change and then uses the normal point/viewport visibility policy. Literal search should mirror Emacs smart case behavior: all-lowercase queries match case-insensitively, while any uppercase character makes the query case-sensitive. Repeating search at an edge should pause in a failing wrap state first, then wrap on the next repeat command in the same direction. `TAB` extends the current completion input by the longest unambiguous prefix shared by matching candidates, `RET` accepts, `C-g` cancels, and ordinary navigation keys exit search before running the movement command where Emacs does.

   Alternative considered: use modal dialogs or browser prompts. Those would not support incremental search, completion previews, or Emacs-like command flow.

7. Keep find-file client-side over existing directory and file APIs.

   `C-x C-f` should use the selected file's directory as the default directory, list directories through the existing files endpoint, complete path segments with `TAB`, open supported files with the existing `OpenFile` path, and descend into directories by completing or accepting a trailing slash. It should not introduce a new server route.

   Alternative considered: add a server-side completion endpoint. Existing directory listing already contains the data needed, and adding another API would widen the file browser contract without necessity.

8. Treat open file tabs as Emacs buffers for `C-x b`.

   `C-x b` should complete against currently open tabs by file name and path. Accepting a match selects that tab. Empty input should select the most recently selected non-current tab when available, matching the useful part of Emacs buffer switching without creating unnamed buffers.

   Alternative considered: create new empty buffers for nonexistent names. That would violate the read-only, file-backed scope of Sheaf Chat's file view.

## Risks / Trade-offs

- Rendered Markdown source mapping can be imprecise -> Keep raw Markdown offsets as authoritative, project to the nearest reliable DOM position when possible, fall back to source-text navigation where exact mapping is unavailable, and keep the rendered preview path unchanged for normal reading.
- Best-effort Markdown persistence can drift after content changes -> Restore from source offset plus nearby line/column and surrounding text, and tolerate near-position restoration instead of promising exact placement.
- Keyboard shortcut collisions with browser defaults or chat input -> Scope shortcuts to file-view focus and command prompt focus, and add tests that chat composer typing still works.
- Large files could make per-keystroke segmentation expensive -> Cache line starts and search indexes per tab content version, and update only selected-tab navigation DOM.
- Agent Review inline diff rendering may need separate mapping -> Reuse selected file content offsets where possible and defer hunk-specific offset mapping to a focused follow-up if the existing inline diff model cannot express exact source offsets.
- Completion against huge directories could feel slow -> Reuse directory cache, load one path segment at a time, and show a pending state while directory listings resolve.
- Command combinations can regress each other -> Use Playwright simulation tests that exercise random but reproducible command sequences across point, mark, search, find-file, tab switching, Markdown rendering, and Agent Review hunk controls, then compare observed state against an expected source-offset model.

## Migration Plan

1. Add navigation state to file tabs and preserve it across tab switches.
2. Add focusable file-view keyboard handling and key-sequence parsing.
3. Add point/mark rendering for plain text and highlighted text, then adapt Markdown and Agent Review paths with source-offset-backed DOM projection and conservative fallbacks.
4. Add the shared prompt for incremental search, find-file, and tab switching.
5. Add file-path and tab completion using existing file browser state and APIs.
6. Expand Playwright UI tests around keyboard behavior, prompt behavior, command scoping, persisted file browser behavior, randomized command simulation, and Agent Review compatibility.

Rollback is to remove the navigation dispatcher, prompt, and point/mark rendering while leaving the existing file browser APIs and tab state unchanged.

## Resolved Questions

- Markdown cursor navigation should compute commands against raw Markdown source and attempt best-effort DOM placement in rendered Markdown first, falling back to source-text navigation only when mapping is not reliable.
- Navigation point and mark should persist best-effort for Markdown and other supported files without promising exact restoration after content changes.
