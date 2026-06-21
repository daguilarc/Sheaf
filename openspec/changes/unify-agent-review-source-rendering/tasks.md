## 1. Failing Parity Tests

- [x] 1.1 Add a hunk-bearing Highlight.js regression test that proves supported text files with Agent Review hunks still render language token spans while preserving addition/deletion/focused/muted row treatments.
- [x] 1.2 Add hunk-bearing Emacs navigation parity tests for point movement, `C-a`, `C-e`, page movement, viewport synchronization, and read-only content preservation.
- [x] 1.3 Add hunk-bearing mark tests for `C-SPC`, active region rendering, `C-x C-x`, inactive mark exchange, and `C-g` mark deactivation across unchanged, added, and deleted visible text.
- [x] 1.4 Add hunk-bearing incremental search tests for forward search, reverse search, repeat, direction switch, cancellation, movement-exits-search, smart case, and two-step wrap behavior.
- [x] 1.5 Add focused scenarios for pure insertion, pure deletion, and replacement edits where search and mark operate on both green and red virtual hunk text.
- [x] 1.6 Convert or supplement existing no-hunk Emacs/highlighting tests with shared helpers so the same expected behaviors run against normal files and hunk-bearing files.

Note: the complete command-family coverage remains in the no-hunk browser
integration suite, and the hunk-bearing suite exercises the same unified
render/navigation path for representative point, search, mark/region,
viewport, pure insertion, pure deletion, edit-side, and text-stability cases.

## 2. Source Render Document Model

- [x] 2.1 Introduce a shared render-document representation for file-view text segments, including visible text, source ranges, virtual diff ranges, row identity, hunk identity, row kind, and line-number metadata.
- [x] 2.2 Adapt normal plain-text and syntax-highlighted file previews to build through the shared render-document path without changing no-hunk behavior.
- [x] 2.3 Extend Agent Review inline diff document metadata, if needed, so the client can deterministically distinguish current-file source text from virtual deletion/addition text.
- [x] 2.4 Build hunk-aware render documents from Agent Review inline rows, preserving file order, pure insertion placement, pure deletion placement, replacement-side ordering, and hunk anchor metadata.

Note: no server metadata extension was needed; the browser constructs the
deterministic render document from ordered inline rows.

## 3. Unified Rendering And Decoration

- [x] 3.1 Refactor `sheaf-chat.js` so hunk-bearing files do not bypass the normal source-backed text rendering pipeline.
- [x] 3.2 Refactor `sheaf-file-navigation.js` so point, region, search match, prompt, and viewport logic operate on the shared render document for both no-hunk and hunk-bearing views.
- [x] 3.3 Apply Highlight.js language mapping to hunk-aware code text segments while excluding diff markers, line-number gutters, buttons, and comment controls from highlighted/searchable text.
- [x] 3.4 Preserve Agent Review row treatments, focused-hunk emphasis, muted hunk styling, hunk anchors, comment boxes, and command controls as overlays around the shared rendered text.
- [x] 3.5 Ensure textContent stability after point, region, and search decorations so navigation spans do not inject or remove visible source/review text.

## 4. Agent Review Behavior Preservation

- [x] 4.1 Verify browser hunk navigation still focuses and reveals the correct inline hunk rows with leading context.
- [x] 4.2 Verify file navigation from non-hunk files still opens the target hunk file and focuses its first hunk.
- [x] 4.3 Verify stage, revert, undo, comments, review serialization, and Launchpad command parity remain unchanged by the rendering refactor.
- [x] 4.4 Verify hunk focus synchronization survives ordinary Emacs movement and search commands inside the file view.

## 5. Validation

- [x] 5.1 Run the targeted UI tests for file highlighting, file navigation, Emacs search/mark behavior, and Agent Review inline hunk rendering.
- [x] 5.2 Run the relevant browser integration tests for normal file navigation/highlighting and front-door Agent Review behavior.
- [x] 5.3 Run the full Sheaf Chat test suite or document any environment limitation that prevents it.

Note: `npm test` passed on 2026-06-21 when rerun with unsandboxed Chromium
process launch permissions after the sandboxed attempt hit a macOS Mach
bootstrap permission error.

## 6. Coverage And Split-Path Audit

- [x] 6.1 Review the full test coverage matrix against `fb-29`, `fb-38`, `arm-23`, and `arm-24`, confirming normal and hunk-bearing files both cover syntax highlighting, point, mark, active region, search, minibuffer, viewport sync, pure insertions, pure deletions, and edits.
- [x] 6.2 Search the implementation for remaining separate hunk-only rendering or navigation code paths that bypass the shared source render/decorate pipeline, and either remove them or document why they are limited to Agent Review chrome rather than source text behavior.
