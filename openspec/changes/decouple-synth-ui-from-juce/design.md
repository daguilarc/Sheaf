## Context

The synth runtime already has a strong JUCE-free core boundary: `Engine<App>`, `AppContext`, `AudioBlock`, patch persistence, parameter modulation, MIDI profile/view-model logic, and the headless `SynthRig` all compile without JUCE. The remaining desktop-only coupling lives in the visible UI contract and host widgets: applications return a JUCE component, miniapp widgets include JUCE directly, runtime pages are JUCE components, and the desktop shell owns layout through JUCE primitives.

The Wasm/browser direction changes the pressure on that boundary. A browser host can reasonably reimplement audio/MIDI/file I/O separately, but it should not need to rewrite every synth widget or controller-page workflow. The portable layer should therefore express UI in synth-owned terms: draw commands, controls, layout nodes, input events, and semantic controller-page structures. JUCE remains the desktop backend rather than the application-facing API.

## Goals / Non-Goals

**Goals:**

- Preserve the miniapp's visible behavior, controls, layout, and interactions while removing direct `juce::` usage from the miniapp-facing UI implementation.
- Define JUCE-free portable UI interfaces for drawing, event input, semantic controls, layout, and lifecycle hooks that can be backed by JUCE desktop now and a browser backend later.
- Move all JUCE includes/usages into backend/adapter implementation files under `projects/synth/juce` and desktop host code that is explicitly JUCE-owned.
- Represent runtime pages, especially Controllers, as semantic UI structures over existing JUCE-free view models so the same structure maps naturally to browser DOM controls.
- Improve the Controllers page abstraction without reducing functionality: adding controllers, endpoint selection, expand/collapse, mapping edits, add/delete, block rows, validation status, focus-safe refresh, and reconcile-triggering commits must remain.
- Add compile and behavior tests that guard the portability boundary.

**Non-Goals:**

- Build the Wasm host, Web Audio bridge, Web MIDI bridge, browser renderer, or IndexedDB-backed persistence in this change.
- Redesign the miniapp's visual style or change its visible layout.
- Remove JUCE from desktop runtime I/O, app/window lifecycle, file chooser, CoreAudio/CoreMIDI integration, or desktop build scaffolding.
- Replace the existing `MidiConfigViewModel` logic or persistence formats.
- Require every future UI backend to mimic JUCE's class hierarchy.

## Decisions

### Decision 1: Introduce a synth-owned portable UI model instead of wrapping JUCE

The portable UI layer will live under synth-owned headers and use only synth/basic C++ types. It should include small geometry, color, text, control, input-event, and draw-command primitives, plus semantic nodes for ordinary controls. Implementers may choose immediate-mode, retained-mode with stable node IDs, or a hybrid, provided both the JUCE backend and a future browser backend can implement it naturally. Stateful controls and DOM-like pages need stable identities; bespoke drawing can be emitted per frame.

Alternatives considered:

- Keep JUCE as the app UI API and add a browser compatibility shim. This would make the browser backend inherit JUCE concepts and turn portability into a large emulation project.
- Write one browser-only UI next to one JUCE UI. This would move fast initially but would duplicate the miniapp and controller-page behavior that this change is trying to preserve.

### Decision 2: Use semantic controls for forms and command-buffer drawing for bespoke synth widgets

The miniapp encoder, segment-display, and waveform visuals are naturally drawing-oriented. The Controllers page, Audio page, and File page are naturally form/document-oriented. The interface should support both: imperative draw commands for canvas-like widgets and DOM-like semantic nodes for buttons, sliders, combos, text fields, rows, sections, scroll areas, and status text.

This avoids forcing form pages into a low-level canvas API while still preserving the existing rich encoder rendering. It also gives the browser path a direct DOM mapping and lets the JUCE backend render semantic controls with real JUCE widgets.

### Decision 3: Keep host I/O separate from UI portability

Desktop `Runtime<App>` can continue to own JUCE audio callbacks, MIDI device handlers, timers, file choosers, and window lifecycle. The portable UI contract should not pretend those are portable yet. Instead, desktop runtime code adapts portable UI nodes to JUCE components, while future browser runtime code will adapt the same application/core and UI nodes to Web Audio/Web MIDI/browser storage separately.

The first JUCE backend implementation should live under `projects/synth/juce`. Runtime-specific JUCE adapters may exist there with clear names, but portable runtime headers and app-facing UI code should not accumulate JUCE-specific files under `projects/synth/runtime`.

For the source-boundary check, treat desktop host files that own process/window/audio lifecycles (for example `Runtime.hpp` and `Shell.hpp`) as JUCE-allowed runtime host code. Runtime UI page producers and renderers (`MainPane`, `AudioConfigPage`, `FilePage`, `ControllersPage`, miniapp widgets, and reusable widget adapters) should move toward portable producers plus JUCE backend files under `projects/synth/juce`.

### Decision 4: Make Controllers page a semantic tree over `MidiConfigViewModel`

The existing view model already owns the hard parts: controller rows, sections, mapping row fields, catalogs, validation, add/delete, block expansion, and edit application. The refactor should add a JUCE-free presentation/action layer that turns that view model into a DOM-friendly tree:

- controller cards/rows;
- endpoint selectors;
- expandable config sections;
- mapping tables with typed field controls;
- add/delete actions;
- validation/status messages;
- focus/edit lifecycle hints.

The JUCE backend then renders that tree with a more sophisticated component set, instead of embedding page workflow in one large JUCE header. The current Controllers page look and feel is not a parity target: functionality must be preserved, but the renderer should not do extra work to maintain the current dense presentation. Natural improvements to grouping, spacing, labels, and control choice are welcome as long as they do not make the page worse or remove workflows.

### Decision 5: Preserve desktop behavior through a JUCE backend parity pass

The first backend is a JUCE implementation that consumes the portable model. For miniapp, parity means visual snapshots/geometry tests and interaction tests stay equivalent. For Controllers, parity means existing view-model tests still pass and renderer/system tests cover representative workflows: endpoint selection, edit refusal/revert, add controller, add/delete mapping rows, block rows, focus-safe refresh, and patch/out-of-band rebuild refresh.

## Risks / Trade-offs

- Portable UI scope grows too broad -> Keep the first interface intentionally small: only primitives needed by miniapp, runtime pages, and Controllers workflows.
- JUCE backend becomes more complex than current direct components -> Accept some backend complexity to remove app/runtime-page coupling and unlock browser hosting.
- Pixel-perfect miniapp parity is difficult -> Preserve layout constants and geometry helpers, and compare command output/geometry rather than relying only on manual inspection.
- Controllers page refactor regresses behavior hidden in JUCE callbacks -> Route every action through the existing `MidiConfigViewModel` APIs and add workflow tests before replacing the renderer.
- Command buffers may not map cleanly to accessible DOM -> Use semantic nodes for controls/forms and reserve raw drawing for bespoke synth visuals.

## Migration Plan

1. Add portable UI headers and compile tests with no JUCE include paths.
2. Extract reusable miniapp layout/geometry and drawing into JUCE-free code that produces portable draw/control descriptions.
3. Implement the JUCE backend adapter in JUCE-owned files and wire the desktop shell to it.
4. Move miniapp widgets to the portable interface and verify no visible behavior changes.
5. Add the runtime page semantic layer and migrate Audio/File pages first as smaller proof points.
6. Refactor Controllers page to emit/render the semantic tree over `MidiConfigViewModel`, preserving all edit and reconcile flows.
7. Add boundary checks that fail if portable app/UI headers include JUCE or expose `juce::` types.
8. Run synth tests and the JUCE miniapp/controller renderer tests.

Rollback is straightforward before archive: the change is isolated behind new adapters and does not alter patch formats, MIDI profile formats, DSP, or engine message semantics. If the Controllers page migration proves too large, the miniapp portable UI and smaller runtime pages can land first, leaving Controllers behind the existing JUCE renderer for a follow-up change.
