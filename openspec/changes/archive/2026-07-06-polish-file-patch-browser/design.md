## Context

The synth runtime already moved file operations into the sidebar-hosted File page. The current implementation has the important behavior in place:

- `projects/synth/include/synth/PatchBrowser.hpp` owns root normalization, deterministic directory listing, selection, parent/enter navigation, and safe path resolution.
- `projects/synth/include/synth/RuntimePages.hpp` builds the File page portable tree and keeps Save As / Load browser state in `FilePageSurface`.
- `projects/synth/juce/RuntimePagesJuce.hpp` hosts the portable surface through `PortableComponent`; `projects/synth/runtime/FilePage.hpp` is a thin alias.
- `projects/synth/tests/portable_ui_tests.cpp` and `projects/synth/juce/RuntimePagesJuceTests.cpp` cover basic File page behavior, while `projects/synth/juce/ControllersPageSimulationTests.cpp` is the stronger precedent for randomized deterministic page simulation.

The weak point is presentation and workflow quality. `BuildFilePageTree` appends an inline browser section below a small command row. Browser rows are plain buttons with `"* "` selection prefixes and separate "Open" buttons; the page has no clear document-like patch identity, no full-height list treatment, no polished empty/error states, and limited renderer-level guarantees that controls stay framed under resize.

Reference research from `~/theallelectricsmartgrid`:

- `JUCE/SmartGridOne/Source/MainComponent.h` hosts Config/File pages behind right-side navigation with a CPU label, matching the sidebar pattern that inspired synth runtime UI.
- `JUCE/SmartGridOne/Source/PatchChooser.hpp` uses a dedicated chooser component rather than an inline control cluster: title, list, selected row color, optional save-name input, OK/Cancel buttons, double-click load, and deterministic directory listing.
- `JUCE/SmartGridOne/Source/ConfigPage.hpp` factors repeated selection controls into a row component (`ConfigDropdownRow`), keeping layout regular and easier to reason about.
- `private/src/DirectoryExplorer.hpp` separates directory state snapshots from rendering and exposes fixed-window list state, which is close in spirit to Sheaf's portable UI surfaces.

The strategy is to take the smart-grid interaction shape and the Controllers-page architecture, not copy smart-grid's ad hoc JUCE implementation.

## Goals / Non-Goals

**Goals:**

- Give Save As and Load a dedicated patch-browser viewer with a clear visual hierarchy and stable semantic structure.
- Keep browser state, validation, action routing, and path resolution JUCE-free and testable.
- Preserve existing patch-manager contracts: save-as/load paths go through the current runtime methods; the browser never exposes arbitrary absolute filesystem picking.
- Make the JUCE renderer capable of a polished dark file UI: patch header, command strip, full-height browser/list, selected-row styling, primary/cancel action area, empty/error states, and responsive layout.
- Add deterministic model-based simulation comparable to `ControllersPageSimulationTests`.

**Non-Goals:**

- No changes to patch JSON, version-file naming, or `PatchManager` save/load semantics.
- No operating-system file picker.
- No general-purpose filesystem browser; this remains a patch-directory picker rooted under runtime `patches/`.
- No browser/DOM backend implementation in this change, though the semantic tree should remain DOM-friendly.
- No redesign of Audio or Controllers pages beyond shared portable UI renderer improvements needed by the File page.

## Decisions

### D1 - Introduce a dedicated rootless patch-browser viewer model

Split the browser state currently embedded in `FilePageSurface` into a dedicated JUCE-free viewer model, likely under `synth::runtime_ui`:

```cpp
class PatchBrowserViewModel final
{
public:
    void Open(FileBrowserKind kind, std::filesystem::path root, std::string initialSaveName);
    void Close();
    std::vector<ui::Node> BuildNodes(ui::Bounds viewerBounds, ui::NodeId parentId) const;
    BrowserDispatchResult DispatchAction(const ui::Action& action);
    const FileBrowserSnapshot& Snapshot() const;
};
```

`FilePageSurface` owns this model and splices its rootless browser nodes into the single File page `NodeTree` under a normal page section. The browser model must not create a second `Root` node or a second top-level `ui::Surface`; `FilePageSurface` remains the only `ui::Surface` exposed to the JUCE backend. Confirmed paths are still surfaced as `kFileConfirmedSaveAs` and `kFileConfirmedLoad`.

Alternative considered: make the browser a child `ui::Surface`. Rejected because the current backend consumes one `NodeTree` per hosted surface, and nested roots would require new composition infrastructure. A rootless model keeps the browser independently testable without changing the surface contract.

Alternative considered: only restyle `BuildFilePageTree` in place. Rejected because the browser already has enough independent state and test surface to deserve the same separation the Controllers work used.

### D2 - Keep `PatchBrowser` as the path authority

`PatchBrowser` remains responsible for root normalization, safe relative path checks, deterministic directory entries, parent/enter navigation, `ResolveSaveAsPath`, and `SelectedLoadPath`. Save As is a *new patch directory* flow: the browser model should reject a target that already exists and keep the viewer open with an inline status such as "Patch already exists"; `PatchManager::SavePatchAs` still retains its existing `AlreadyExists` rejection as defense in depth. The new viewer can add display metadata, but it must not duplicate path validation with string slicing in UI code.

If the richer design needs additional data, add small library helpers such as:

- display status for existing patch directory vs empty directory,
- latest version-file label/count for a patch directory,
- sanitized/trimmed save-name preview,
- stable row keys derived from relative paths.

Alternative considered: make the viewer operate directly on `std::filesystem`. Rejected because `PatchBrowser` already centralizes the safety constraints the spec cares about.

### D3 - File page layout becomes a page plus focused viewer

The File page tree should have:

- page root with a background draw node;
- top patch identity row: current patch name, root/path summary, last status;
- command strip for New, Save, Save As, Load, Revert;
- browser viewer region that occupies remaining height when a browser is open;
- otherwise an idle state region that still looks intentional, not blank.

The browser viewer should have:

- mode title ("Save Patch" / "Load Patch");
- breadcrumb/current relative path;
- save-name text field for Save As;
- list rows with stable node IDs, selected state, and row action;
- primary action and cancel action anchored at the bottom or top-right;
- empty state when no patch directories exist;
- unreadable-root error state when the root cannot be refreshed;
- invalid-input status inline with the viewer.

The UI can use draw commands for backgrounds, borders, selection fills, and subtle dividers while keeping controls semantic. The renderer can continue using native JUCE `TextButton`, `TextEditor`, and labels for interactive widgets.

Alternative considered: modal browser component. Rejected because runtime pages already replace the app in the content host; a full-page in-page viewer is simpler and matches smart-grid's full-page file workflow.

### D4 - Extend portable UI expressiveness only where needed

The existing portable model can already represent buttons, labels, text fields, rows, sections, scroll areas, status text, and draw commands. If polish requires selected/disabled/primary styling, prefer adding small semantic fields to `ui::Node` rather than baking File page-specific style code into the JUCE renderer. Candidate fields:

- `selected` or reuse `checked` for list row state if appropriate,
- `enabled` for invalid or unavailable primary actions,
- `variant` string/enum for primary, secondary, danger, list-row, and quiet controls,
- optional tooltip/status metadata if needed.

The renderer should map these semantics to consistent JUCE colors and bounds. It should also preserve the current action dispatch behavior and focus-safe text updates.

Alternative considered: encode style entirely with draw nodes behind existing buttons. Acceptable for passive decoration, but insufficient for disabled/primary/list-row semantics that future backends will also need.

### D5 - Simulation is a first-class deliverable

Add `projects/synth/juce/FilePageSimulationTests.cpp` or similar. Use a deterministic seed and a temporary patch root with nested patch directories, invalid names, and empty states. Each step:

1. Build the portable tree.
2. Collect legal actions from visible nodes plus generated save-name edits.
3. Dispatch one randomized action.
4. Refresh the JUCE renderer.
5. Verify semantic invariants and renderer invariants.

Minimum invariants:

- browser never resolves outside the temporary patch root;
- Save with no current patch opens Save As;
- Load confirms only selected valid patch directories;
- invalid save names do not dispatch save callbacks;
- Cancel closes the browser without dispatching save/load;
- selected rows stay rendered and inside parent bounds after resize;
- every rendered semantic control has the expected JUCE component kind;
- no text/control bounds exceed the page or viewer region across desktop-sized and narrow content widths.

This complements JUCE-free model tests rather than replacing them.

Alternative considered: only fixed-path unit tests. Rejected because the controller page already showed that simulation finds interaction/layout regressions that single examples miss.

## Risks / Trade-offs

- [Polish work expands portable UI scope] -> Keep additions generic and minimal; prefer semantic variants and selected/enabled state over File-page-only renderer hacks, and treat any `PortableUI.hpp` change as shared backend contract work.
- [List rows become hard to render with native controls] -> Use a row section with draw-command background plus semantic child controls, and verify parent/child bounds in JUCE tests.
- [Save As overwrite semantics are easy to confuse] -> Preflight existing-directory/file targets in the browser so the user sees an in-viewer error before dispatch; keep `PatchManager::SavePatchAs` as the authority and defense against races.
- [Simulation could become flaky] -> Use a fixed seed, deterministic temp filesystem fixtures, no wall-clock waits, and no platform file dialogs.
- [Nested navigation can complicate load semantics] -> Keep directories as selectable rows and "open" navigation as a separate action; selected directory confirmation remains explicit.

## Migration Plan

No data migration. Patch roots, patch directories, and version files remain unchanged. Existing File page tests should be updated in the same implementation change so the repo does not carry both old inline-browser expectations and new dedicated-viewer expectations.

Rollback is local to UI code: the old `FilePageSurface` behavior can remain available while the new browser surface is introduced, but final implementation should remove the rough inline browser to avoid two divergent flows.

## Open Questions

- Should Load show latest-version metadata per patch directory in the first pass, or keep the list minimal and rely on the patch manager's latest-version behavior? Recommendation: include metadata only if it can be computed cheaply through `PatchBrowser` helpers and tested deterministically.
- Should Save As allow selecting an existing row to prefill the name while still rejecting overwrite on confirm? Recommendation: yes for convenience, but the primary action must keep the browser open and surface a clear "already exists" status rather than dispatching an overwrite attempt.
