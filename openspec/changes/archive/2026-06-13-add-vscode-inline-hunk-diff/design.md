## Context

The archived `add-vscode-unstaged-hunk-pane` change added a standalone VS Code extension that computes worktree-vs-index hunks, tracks the current hunk, exposes hunk commands, and reports hunk state to Dictator for Launchpad control. Its review surface is a custom webview panel revealed beside the editor.

That separate panel is reliable for custom UI, but it breaks the desired flow: the hunk context is no longer visually part of the file being edited. The new direction keeps the existing extension and controller architecture, but replaces the panel rendering surface with read-only virtual hunk documents opened in the editor area.

VS Code's public extension API supports text editor decorations, whole-line styling, range borders, overview-ruler markers, before/after decoration attachments, and virtual documents through `TextDocumentContentProvider`. It does not expose native peek view internals as a general custom inline block API. Smoke testing showed decoration attachments do not reliably allocate separate editor rows: deleted text either overlaps nearby code or is pushed horizontally after the real line. Therefore deleted-line rendering should move to a read-only virtual document where every displayed code line is real document text.

## Goals / Non-Goals

**Goals:**
- Render unstaged hunks in a read-only virtual hunk document opened in the editor area after completely removing the separate webview-panel review UI.
- Use conventional red/green diff styling for deletions and additions.
- Make the current hunk visually obvious with brighter colors and stronger borders while keeping other hunks visible in duller colors.
- Display deleted text in the virtual document with each deleted code line on its own viewport row.
- Provide a reusable mapping layer that maps real file paths, real line ranges, hunk IDs, and synthetic deleted rows to virtual document rows, and maps virtual rows back to underlying real-file context.
- Reveal the newly selected hunk in the active editor viewport whenever previous/next hunk navigation changes the current hunk, including arrow-key-driven navigation.
- Preserve existing hunk navigation, stage, revert, undo, get-current-hunk, file navigation, and Dictator/Launchpad action-state behavior.
- Clear all inline hunk decorations promptly when the active file has no unstaged hunks, the active editor changes, or the extension is deactivated.

**Non-Goals:**
- Do not keep a hidden, demoted, command-only, or diagnostic webview panel for hunk review.
- Do not modify the user's real document buffer to insert deleted lines.
- Do not require deleted text to have normal line numbers, selection behavior, or editing behavior.
- Do not redesign Dictator's Launchpad hunk controls.
- Do not build a full side-by-side diff editor.

## Decisions

### Read-only virtual hunk document

Use a `TextDocumentContentProvider` for a custom URI scheme such as `sheaf-hunks:`. A virtual hunk document represents one underlying real file plus its current worktree-vs-index hunk model. Its text content is synthesized from the real file contents and hunk diff data.

The virtual document should be opened in the editor area when hunk review is requested from a normal file or when Launchpad/file navigation selects a changed file. It is read-only by construction. Stage, revert, undo, and navigation commands operate on the underlying real file and hunk model, then refresh the virtual document.

The existing "pane open" controller concept can remain as a compatibility state flag meaning "the hunk review surface is active for this editor"; it must not create, reveal, or retain a separate webview panel.

Alternative considered: keep the webview panel and make it more diff-like. That would improve color and formatting, but it would still leave review in a separate pane instead of integrating it into the file.

Alternative considered: render deleted rows with decoration attachments in the original editor. Smoke testing proved this does not allocate real rows and creates overlap or horizontal displacement.

### Virtual document mapping layer

Add a reusable internal mapping layer that builds and owns the relationship between real files, hunks, and virtual document rows. This should be a clean module rather than UI glue because future features may need to answer "what real file/hunk does this virtual row represent?".

The mapping layer should expose a small API with these concepts:

```text
VirtualHunkDocument
├─ uri: sheaf-hunks:<encoded repo/file identity>
├─ repoRoot
├─ file
├─ text
├─ rows: VirtualHunkRow[]
└─ hunks: VirtualHunkSpan[]

VirtualHunkRow
├─ virtualLine: number
├─ kind: context | added | deleted
├─ text
├─ realLine: number | null
├─ hunkId: string | null
└─ source: real | synthetic

VirtualHunkSpan
├─ hunkId
├─ hunkIndex
├─ virtualStartLine
├─ virtualEndLineExclusive
├─ addedVirtualRange
├─ deletedVirtualRange
└─ realNewRange
```

Required operations:

```text
buildVirtualHunkDocument(realText, hunks) -> VirtualHunkDocument
virtualLineToContext(document, virtualLine) -> VirtualHunkRow
hunkIdToVirtualSpan(document, hunkId) -> VirtualHunkSpan
realLineToVirtualLine(document, realLine) -> number | null
virtualUriFor(repoRoot, file) -> Uri
parseVirtualUri(uri) -> { repoRoot, file } | null
```

The mapping layer is authoritative for viewport reveal, current-hunk decoration ranges, click/selection context, and future commands that need to act from a virtual row back to the real file.

### Parse diff lines for display planning

Extend the hunk model or diff parser so each hunk exposes display-oriented line segments in addition to patch text:

```text
hunk
├─ context line -> virtual row mapped to real line
├─ added line   -> virtual row mapped to real new line, green
├─ deleted line -> synthetic virtual row mapped to hunk/old line, red
└─ metadata     -> current/non-current, old/new positions
```

The patch text remains the mutation source for stage, revert, and undo. The display segments are derived data for rendering and tests.

Alternative considered: derive decoration ranges directly from patch text inside the renderer. Keeping parsing closer to `diffParser.ts` makes it easier to unit test hunk display planning without a VS Code host.

### Deleted text as synthetic virtual rows

Deleted lines must be rendered as red display-only content anchored at the hunk's new-file position, with each deleted source line occupying its own viewport row. In the virtual document approach, deleted lines are real rows in the virtual document text and synthetic rows in the mapping layer. Plain `TextEditorDecorationType` before/after attachments are not acceptable for deleted code because smoke testing showed they do not reserve separate rows reliably.

For replacement hunks, render all added code as one contiguous green block and all deleted code as one contiguous red block immediately adjacent to that green block. The display planner should avoid interleaving deleted and added lines inside the same hunk, even if the underlying unified diff alternates `-` and `+` lines. This preserves the visual grammar of "new block, then removed block" at the new-file location. For one-line replacements, the added and deleted lines should appear as a tight pair at the replacement location. For two-line, twenty-line, or uneven replacements, all added lines should stay together and all deleted lines should stay together.

This makes deleted text visible in the editor area without changing the real document. The renderer should preserve leading whitespace visually, keep the deleted text clearly marked as removed, and avoid horizontal displacement of real code.

Alternative considered: use a side-by-side diff editor. That would show deletions naturally, but it would move review into a different diff surface and away from the hunk-focused single-file flow.

### Current versus non-current hunk styling

Create separate decoration types for current and non-current additions/deletions on the virtual document. Current-hunk additions and deletions use brighter green/red backgrounds and stronger borders; non-current hunks use lower-opacity equivalents. The current hunk should also have a boundary cue, such as top/bottom borders or gutter/overview-ruler markers, so it remains legible when the changed lines are sparse.

Alternative considered: highlight only the current hunk. Showing dim non-current hunks keeps the user oriented when navigating through several changes in one file.

### Webview panel removal

Remove the hunk review webview panel code path rather than demoting it. The extension should not register a fallback command that opens the old hunk panel, and normal hunk review should have only one visual surface: decorations in the active editor.

Alternative considered: keep both surfaces active. That creates duplicate state and keeps the separate-pane distraction that this change is meant to remove.

### Navigation reveals the current hunk

After previous/next hunk navigation changes the current hunk, the extension should call the VS Code editor reveal API for the current hunk's virtual span from the mapping layer. The reveal should be centered or near-centered enough that the selected hunk is immediately visible without manual scrolling.

Alternative considered: only update decorations and leave the viewport alone. That makes hardware or arrow-key navigation feel broken when the next hunk is off screen.

## Risks / Trade-offs

- [Virtual documents are read-only and separate from the real file URI] -> Keep commands mapped to the underlying real file through the mapping layer and provide a clear way to open the real file for editing.
- [Virtual document content can become stale after edits or Git operations] -> Rebuild the virtual document and fire provider change events after editor, filesystem, Git index, and hunk command events.
- [Mapping drift can cause commands to affect the wrong hunk] -> Treat the mapping layer as an explicit tested contract and rebuild it from the same hunk model used for stage/revert.
- [Decoration ranges can drift after edits] -> Recompute from Git diff after editor, filesystem, Git index, and hunk command events, and clear stale decorations before applying new ones.
- [Large diffs could create many decoration options] -> Limit rendering to the active file and reuse decoration types; debounce recomputation as the existing model already does.
- [Controller state names still say pane] -> Preserve protocol compatibility during this change and interpret `paneOpen` as "review surface active"; do not use that compatibility name to retain a webview panel.

## Migration Plan

1. Add display-line metadata to hunk parsing/model tests, including new-file-anchored grouped replacement-block planning, without changing mutation patch behavior.
2. Add the virtual hunk document provider and reusable mapping layer, then wire it into model state publication.
3. Delete the separate webview panel review code path so it cannot open as a hunk review surface.
4. Update extension tests for hunk display planning and renderer cleanup behavior.
5. Manually smoke test multiple hunks, deletion-only hunks, additions, replacements, navigation, stage, revert, undo, file switching, and no-hunk cleanup in VS Code.

Rollback is a code revert of this change: restore the previous webview-panel implementation and stop applying inline decorations. Hunk model and Dictator control behavior should remain compatible.

## Open Questions

- Whether reveal should use centered or nearest-edge viewport positioning for the smoothest repeated arrow-key navigation.
