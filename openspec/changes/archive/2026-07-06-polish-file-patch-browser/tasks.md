## 1. Browser Model And Semantics

- [x] 1.1 Extract the Save As / Load browser state from `FilePageSurface` into a dedicated rootless JUCE-free patch-browser model that wraps `synth::PatchBrowser`.
- [x] 1.2 Define browser snapshots and node IDs for mode title, save-name field, flat patch-directory rows, selected-row state, empty/error states, primary confirm, cancel, row double-click accept, overwrite Save As, and current-patch version rows.
- [x] 1.3 Keep `PatchBrowser` as the only authority for root normalization, relative navigation, save-as path validation, and selected load path resolution; add small metadata helpers only if needed for display.
- [x] 1.4 Preserve current File page action routing: Save with no current patch opens Save As, explicit Save As and Load open the browser, accepted confirmations dispatch `kFileConfirmedSaveAs` / `kFileConfirmedLoad`, existing Save As targets stay open with an inline already-exists status, and ordinary patch commands continue through the runtime.

## 2. File Page Layout And Polish

- [x] 2.1 Redesign `BuildFilePageTree` around a patch identity header, runtime patch-root/path context, command strip, status area, and idle empty-state region.
- [x] 2.2 Render Save As / Load as a dedicated full-height browser viewer region rather than a cramped inline section below the command row.
- [x] 2.3 Add semantic or draw-command styling for selected rows, viewer background, dividers, invalid-input status, primary/secondary actions, and readable page text without moving behavior into JUCE-only code.
- [x] 2.4 Ensure responsive bounds for desktop and narrow content widths so buttons, text fields, list rows, and status text do not overlap or escape their parent bounds.

## 3. JUCE Backend

- [x] 3.1 Extend `PortableJuceBackend` only as needed for generic selected/enabled/variant semantics or list-row rendering.
- [x] 3.2 Update `RuntimePagesJuce` File page hosting to refresh and resize the new browser surface correctly while retaining existing runtime save/load callbacks.
- [x] 3.3 Verify the JUCE File page host contains no `juce::FileChooser` usage and keeps File page behavior in the portable surface.

## 4. JUCE-Free Tests

- [x] 4.1 Add focused tests for the new browser model: opening Save As/Load, deterministic flat directory ordering, row double-click load/save-as overwrite, cancel, valid confirm, invalid save names, existing Save As targets, unreadable roots, missing load selection, current-patch versions, and root escape rejection.
- [x] 4.2 Update portable UI tests to assert the new File page tree includes the header, command strip, idle region, browser viewer, selected row state, save-name field, empty state, and status text.
- [x] 4.3 Add/adjust `PatchBrowser` tests for any new metadata helpers and for nested directories, existing file conflicts, and path normalization edge cases.

## 5. JUCE Renderer And Simulation Tests

- [x] 5.1 Update `RuntimePagesJuceTests` to verify the polished File page nodes render to expected JUCE component kinds and refresh text/selection state.
- [x] 5.2 Add deterministic File page simulation tests that drive randomized Save, Save As, Load, row select, row double-click accept/overwrite, save-name edit, confirm, cancel, and resize actions against the production portable surface and JUCE renderer.
- [x] 5.3 In the simulation oracle, verify no dispatched save/load path escapes the temp patch root, invalid inputs and existing Save As targets do not dispatch callbacks, cancel closes without callbacks, unreadable roots show error state, and first Save opens the same Save As browser state machine.
- [x] 5.4 In renderer simulation checks, verify visible controls remain inside parent/root bounds across desktop and narrow sizes and every visible semantic control has a matching JUCE component of the expected kind.

## 6. Verification

- [x] 6.1 Run `openspec validate polish-file-patch-browser --strict`.
- [x] 6.2 Run the JUCE-free synth test suite that includes portable UI and patch browser coverage.
- [x] 6.3 Run the JUCE runtime page tests and the new File page simulation test.
- [x] 6.4 Run `make -C projects/synth test` or the repo's current synth aggregate test target, then record any environment-specific skips or failures.
