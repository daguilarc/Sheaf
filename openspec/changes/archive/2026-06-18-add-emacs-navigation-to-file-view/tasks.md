## 1. Navigation State And Rendering

- [x] 1.1 Add per-tab navigation state for point, mark, mark activity, desired vertical column, recent tab selection order, active key-prefix or prompt state, and search metadata.
- [x] 1.2 Build line-offset helpers that map file content offsets to logical line starts, line ends, and vertical movement targets.
- [x] 1.3 Render visible point, active region, and current search match for plain-text previews without changing file content.
- [x] 1.4 Extend highlighted preview rendering so cursor, region, and search spans compose with escaped syntax-highlighted text.
- [x] 1.5 Add Markdown navigation that computes command targets against raw Markdown source offsets and projects point, region, and search state into the rendered DOM where mapping is reliable.
- [x] 1.6 Add best-effort Markdown navigation persistence across tab switches, refreshes, and workspace editor-state restore, using source offset plus nearby line/column or surrounding text as fallback anchors.
- [x] 1.7 Add a conservative Agent Review rendering path for navigation state, using exact source-text navigation where rendered DOM source mapping is not reliable.

## 2. Keyboard And Mouse Command Handling

- [x] 2.1 Make the file view focusable and scope keyboard command handling to file-view or prompt focus without intercepting chat composer input.
- [x] 2.2 Implement arrow-key movement, mouse-click point placement, `C-a`, `C-e`, `C-v`, and `M-v` according to `fb-30`.
- [x] 2.3 Implement `C-g` cancellation for active key prefixes, minibuffer prompts, and incremental search according to `fb-31`.
- [x] 2.4 Implement the `C-x` key-sequence dispatcher for `C-x C-x`, `C-x C-f`, and `C-x b`.
- [x] 2.5 Preserve selected-tab viewport capture and restore behavior while point navigation changes scroll position.

## 3. Mark And Search

- [x] 3.1 Implement `C-SPC` mark activation, active region rendering, and `C-x C-x` point/mark exchange according to `fb-32`.
- [x] 3.2 Implement the shared minibuffer-style prompt shell with status text, errors, `RET`, `TAB`, and `C-g` handling.
- [x] 3.3 Implement `C-s` and `C-r` incremental search, typed query updates, current-match highlighting, repeat, direction switching, accept, cancel, and movement-exits-search behavior.
- [x] 3.4 Implement search-origin mark interaction so accepted searches record an inactive origin mark only when no mark was active, and canceled searches restore the prior mark state.

## 4. File And Tab Prompts

- [x] 4.1 Implement `C-x C-f` find-file prompt defaulting to the selected file's directory.
- [x] 4.2 Implement path-segment `TAB` completion through existing directory-list APIs and directory cache reuse.
- [x] 4.3 Accept supported file paths by reusing existing tab open/focus behavior, and reject unsafe or unsupported prompt paths without adding server APIs.
- [x] 4.4 Implement `C-x b` tab-switch prompt with completion by open tab name or path, accepted existing-tab selection, empty-input previous-tab selection, and no empty-buffer creation.

## 5. Styling And Accessibility

- [x] 5.1 Add CSS for point, active region, search match, prompt, completion candidates, and prompt errors across desktop and touch layouts.
- [x] 5.2 Ensure point, region, search match, and prompt styling remains legible in Markdown, plain text, highlighted text, and Agent Review file views.
- [x] 5.3 Add appropriate focus labels and ARIA attributes for the focusable file view and prompt controls.

## 6. Tests And Documentation

- [x] 6.1 Add UI tests for point movement, line commands, page commands, mouse point placement, and read-only invariants.
- [x] 6.2 Add UI tests for `C-g` canceling active key prefixes, prompts, and incremental search without altering file content.
- [x] 6.3 Add UI tests for mark activation, region rendering, point/mark exchange, and inactive search-origin exchange.
- [x] 6.4 Add UI tests for forward and reverse incremental search, repeat, direction switch, accept, cancel, and movement exit behavior.
- [x] 6.5 Add UI tests for Markdown source-backed navigation, best-effort rendered DOM placement, and best-effort persisted point restoration.
- [x] 6.6 Add UI tests for `C-x C-f` default directory, completion, open/focus behavior, directory descent, and unsafe path rejection.
- [x] 6.7 Add UI tests for `C-x b` completion, existing tab selection, empty-input previous-tab behavior, and nonexistent-buffer rejection.
- [x] 6.8 Add Playwright randomized simulation tests with deterministic seeds that exercise mixed Emacs navigation commands and compare observed point, mark, prompt, search, selected-tab, and read-only state against an expected source-offset model.
- [x] 6.9 Add Playwright compatibility tests proving Emacs navigation remains orthogonal to Agent Review hunk navigation, hunk controls, inline diffs, chat composer input, existing file tabs, stale-tab refresh, and Markdown links.
- [x] 6.10 Update Sheaf Chat user-facing docs or coverage notes to describe the read-only Emacs-like navigation commands.

## 7. Point And Viewport Synchronization

- [x] 7.1 Correct `C-v` and `M-v` so they move by approximately one visible page rather than jumping to the file end or beginning.
- [x] 7.2 Keep point visible when keyboard movement carries it outside the viewport, scrolling by roughly one third of the viewport as the initial target.
- [x] 7.3 Update point when the user scrolls the file view, preserving the relative point/viewport position by translating scroll deltas into logical line movement.
- [x] 7.4 Update point when Agent Review hunk navigation scrolls to a focused hunk.
- [x] 7.5 Add Playwright tests for page commands, keyboard auto-scroll, viewport scroll-to-point sync, Agent Review hunk-to-point sync, and randomized mixed point/viewport invariants.

## 8. Search And Completion Refinements

- [x] 8.1 Keep point visible when forward or reverse incremental search moves to an offscreen match.
- [x] 8.2 Make `C-x C-f` `TAB` completion extend the current path segment to the longest unambiguous prefix before choosing a unique candidate.
- [x] 8.3 Make `C-x b` `TAB` completion extend the buffer prompt to the longest unambiguous prefix before choosing a unique candidate.
- [x] 8.4 Add Playwright coverage for search viewport synchronization and longest-unambiguous-prefix completion in find-file and buffer switching.

## 9. Emacs Search Semantics

- [x] 9.1 Make lowercase incremental search queries case-insensitive and queries containing uppercase letters case-sensitive.
- [x] 9.2 Make repeated forward and reverse search pause at the edge before wrapping, then wrap on the next repeat command in the same direction.
- [x] 9.3 Add Playwright coverage for smart case search and two-step wrap behavior.

## 10. Emacs Mark Deactivation Semantics

- [x] 10.1 Make `C-g` deactivate an active mark without clearing the stored mark when no prompt, prefix, or search is active.
- [x] 10.2 Keep `C-x C-x` reactivating an inactive mark while exchanging point and mark.
- [x] 10.3 Add Playwright coverage for mark deactivation/reactivation and accepted-search origin/active-mark behavior.
