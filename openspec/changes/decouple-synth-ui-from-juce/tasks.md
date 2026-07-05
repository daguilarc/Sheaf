## 1. Portable UI Contract

- [x] 1.1 Add JUCE-free portable UI primitives for geometry, color, text, draw commands, input events, stable node IDs, and semantic control nodes under synth-owned headers, choosing immediate/retained/hybrid structure based on what keeps both JUCE and browser backends natural.
- [x] 1.2 Update app-facing UI hooks and any necessary concept checks so applications expose a portable UI surface; do not assume `AppConcepts.hpp` currently names `juce::Component&`.
- [x] 1.3 Add compile tests proving the portable UI headers and updated application concept compile without JUCE include paths and expose no `juce::` public signatures.
- [x] 1.4 Document the portable UI ownership/threading contract, including which callbacks run on the host UI/message thread and how UI events enqueue `MessageIn` values.

## 2. JUCE Backend Adapter

- [x] 2.1 Create the JUCE desktop backend adapter under `projects/synth/juce` that turns portable UI nodes and draw commands into JUCE components, graphics calls, focus handling, and input events.
- [x] 2.2 Move JUCE-specific color/string/rectangle/event translation helpers into explicitly JUCE-owned backend files under `projects/synth/juce`.
- [x] 2.3 Update the runtime shell to host portable UI surfaces through the JUCE backend, and move MainPane/page behavior toward portable producers while preserving existing startup, repaint, and shutdown ordering.
- [x] 2.4 Add backend tests or geometry tests for draw-command translation of arcs, paths, text, fills, and layout bounds used by existing synth widgets.

## 3. Miniapp UI Parity

- [x] 3.1 Extract miniapp encoder-grid layout, button/slider metadata, scene labels, modifier state, and waveform draw descriptions into JUCE-free miniapp UI code.
- [x] 3.2 Port encoder, fourteen-segment display, VCO waveform, and LFO waveform rendering to emit portable draw commands while preserving existing geometry and colors.
- [x] 3.3 Replace direct miniapp usage of `juce::Component`, `juce::TextButton`, `juce::Slider`, `juce::Graphics`, and JUCE geometry types with portable UI nodes/events.
- [x] 3.4 Wire miniapp user actions through the portable event callbacks to the existing `MessageInBus` paths with the runtime timestamp provider.
- [x] 3.5 Add or update tests proving the miniapp application-facing UI headers compile without JUCE and that miniapp visible layout/interaction parity is preserved through the JUCE backend.

## 4. Runtime Pages

- [x] 4.1 Port the sidebar/main-pane content selection model to portable semantic nodes while keeping Audio/Controllers/File navigation and deadline readout behavior.
- [x] 4.2 Port the Audio page to portable semantic controls for output/input selection, current-device display, status text, and back navigation.
- [x] 4.3 Port the File page to portable semantic controls for New/Save/Save As/Load/Revert, current patch name, status text, file chooser handoff, and first-save fallback.
- [x] 4.4 Add regression tests covering page navigation, page state refresh, and desktop JUCE backend rendering of the runtime pages.

## 5. Controllers Page Semantic Tree

- [ ] 5.1 Add a JUCE-free Controllers page presentation/action layer that derives a semantic tree from `MidiConfigViewModel` and connection state.
- [ ] 5.2 Represent controller rows, endpoint selectors, connection states, expandable config sections, mapping tables, add/delete affordances, block rows, validation status, and focus/edit lifecycle as stable semantic nodes.
- [ ] 5.3 Route every semantic action through existing `MidiConfigViewModel` APIs and commit accepted edits through `engine.EditInstrument`.
- [ ] 5.4 Preserve dirty refresh behavior for MIDI processor rebuilds, patch load/revert changes, endpoint reconnects, and focus-safe deferred rebuilds.
- [ ] 5.5 Implement the JUCE Controllers page renderer over the semantic tree, improving grouping, spacing, headers, and control presentation where natural without preserving the current dense look for its own sake or removing current functionality.
- [ ] 5.6 Add workflow tests for add controller, endpoint selection, mapping edit acceptance/refusal, add/delete row, add/delete block, empty-group add affordances, launchpad variant selection, and out-of-band refresh.

## 6. Boundary Cleanup And Verification

- [ ] 6.1 Move or rename remaining JUCE-dependent widget files so only explicitly JUCE-owned backend files under `projects/synth/juce` and desktop runtime host paths include JUCE headers.
- [ ] 6.2 Add a source-boundary check with an explicit allowlist for desktop runtime host files that may keep JUCE, and fail if portable synth UI, app-facing miniapp UI, runtime page producers, or JUCE-free tests include JUCE headers or refer to `juce::`.
- [ ] 6.3 Run `make -C projects/synth test` and fix any JUCE-free compile/test regressions.
- [ ] 6.4 Run `make -C projects/synth/apps/miniapp test` and fix JUCE backend or geometry regressions.
- [ ] 6.5 Build the miniapp desktop app and perform a manual smoke pass for visible miniapp parity and Controllers page functionality.
- [ ] 6.6 Update synth and miniapp documentation to describe the portable UI contract, JUCE backend role, and browser/Wasm follow-up boundary.
