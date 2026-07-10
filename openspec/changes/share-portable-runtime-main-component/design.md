## Context

The application-facing UI boundary is already portable: every `synth::SynthApplication` exposes a `synth::ui::Surface`, and both runtime pages and application widgets can be described as `NodeTree` values. The current top-level composition is not portable. `synth_runtime::MainPane<App>` independently creates JUCE components for the app, sidebar, and pages, while `synth_browser::Runtime<App>` serializes only `App::PortableSurface()`. The desktop host also removes 96 pixels from a window whose configured width is already used by the app tree, clipping the app's right edge.

The browser backend has an in-progress generic layout correction that establishes one surface coordinate space, intrinsic layout for unbounded controls, and responsive whole-surface scaling. A fresh Claude review found three relevant gaps: auto-flow content can extend beyond the root height and be clipped, long labels retain a fixed 120-pixel width, and multiple roots can be transformed independently. The shared composite root eliminates the last issue; the browser backend must correct the first two.

The browser audio bridge is intentionally outside this implementation. Investigation found that a 48 kHz AudioWorklet consumes 375 128-frame blocks per second while the rounded 3 ms main-thread timer requests at most about 333 blocks per second. The ring starts with only one block, and underflow is hard-filled with zero. Main-thread jitter and per-block WASM allocation/copy add pressure, but the timer deficit alone guarantees underruns. This change records that finding and does not alter audio scheduling.

## Goals / Non-Goals

**Goals:**

- Render one host-neutral top-level component in both JUCE and Chrome.
- Preserve any conforming application's configured portable content bounds and place shared runtime chrome beside them.
- Keep application type selection and host service selection compile-time swappable.
- Reuse existing portable sidebar, Audio, Controllers, and File page models with no concrete-app knowledge.
- Match JUCE pointer-drag and rounded-arc behavior in the browser backend.
- Verify layout and interaction through JUCE-free tests and Playwright screenshots/actions.

**Non-Goals:**

- No miniapp-specific or other app-specific browser code, HTML, layout, actions, or tests that bypass the generic app contract.
- No browser audio scheduler, ring-buffer, DSP, sample-rate, or allocation change.
- No browser audio input or named output-device enumeration.
- No redesign of runtime pages, controller mapping behavior, or patch persistence formats.
- No requirement for pixel-identical native browser controls; geometry, visibility, interaction, and drawing semantics are the parity contract.

## Decisions

### D1 - One portable `RuntimeMainComponent<App, Services>`

Add a JUCE-free class template under `projects/synth/include/synth` that implements `synth::ui::Surface`. It receives the live application and a host services object, owns page-selection state plus the existing sidebar/audio/file/controllers surfaces, builds one composite tree, and is the authoritative `DispatchAction` route. Runtime-owned node IDs remain under the reserved `runtime.*` namespace.

The composite tree has one first node/root, `runtime.main.root`. The application root or active runtime-page root and the translated sidebar root are its children. Existing nested root nodes remain structural containers; both backends traverse from the first composite root. Every explicit `Node::bounds` value remains an absolute surface-space rectangle, regardless of hierarchy. Composition translates the sidebar root and every sidebar descendant by the same x offset. The JUCE backend already consumes absolute bounds; the browser backend preserves DOM nesting but converts each resolved absolute child rectangle to parent-relative CSS offsets at attachment time. Composition validates unique IDs, known child references, acyclic reachability, and the reserved runtime namespace.

Alternative: share only a page controller while JUCE and browser compose separate surfaces. This leaves layout and dispatch duplication in place. Alternative: template the JUCE `MainPane` on a browser policy. That keeps JUCE ownership at the architecture center and makes the browser imitate JUCE rather than render the portable contract.

### D2 - App config describes content; runtime chrome is additive

`App::Config().uiWidth` and `uiHeight` describe the application's portable content rectangle. A conforming app tree must expose one origin-zero root matching those positive dimensions. The shared root is `(uiWidth + 96) x uiHeight`; the app remains at `(0, 0)` and the entire sidebar subtree is translated by `uiWidth`. Runtime pages occupy exactly the app content rectangle. The JUCE window uses the shared root's intrinsic dimensions, and the browser scales the single composite DOM root uniformly down when the viewport is narrower.

Each nested `NodeKind::Root` is also an auto-flow layout boundary. Unbounded app controls resolve only within the app root's configured width and height, never against the wider composite root; runtime-page and sidebar controls similarly resolve within their own roots. The JUCE and browser backends both resolve unbounded descendants from their nearest root ancestor, then render the resulting absolute surface coordinates. This keeps generic apps with semantic/unbounded controls out of the sidebar band.

This changes desktop window width by adding the existing sidebar width rather than stealing it from app content. It does not rewrite or scale app node coordinates. If an app violates the portable-root contract, the shared component fails with a generic diagnostic; implementation must not add a concrete-app exception.

### D3 - Host behavior enters through a compile-time services concept

Define a narrow services concept consumed by `RuntimeMainComponent`: refresh and action hooks for Audio, Controllers, and File pages; controller-surface refresh; runtime-configuration save; current deadline sample; and lifecycle-safe callback registration where the host requires it. The component owns portable page state and navigation. `RuntimeMainComponent::Refresh()` asks services for the current deadline sample, writes it through `RollingMax256`, refreshes Audio/File snapshots, calls the controller refresh hook, and updates all page surfaces. Services own host APIs and mutate the shared engine/runtime through generic operations.

The JUCE services adapter delegates to the existing `Runtime<App>` audio manager, MIDI connection manager, engine patch operations, and status hooks and returns `deviceManager_.getCpuUsage() * 100` as its deadline sample. The browser services adapter delegates to `Engine<App>`, `BrowserMidiBridge`, and browser persistence state. Its Audio snapshot always contains exactly `system_default` / `System Default`, suppresses input UI, and reports the current `AudioContext` sample rate and block size supplied through generic runtime state. Chrome has no equivalent callback-load value in the current bridge, so the browser adapter returns `0.0f` for the deadline sample until a separately designed realtime instrumentation path exists; it does not infer load from the known-broken render timer. No services method accepts or switches on a concrete app type.

### D4 - Both hosts render the composite surface

Replace JUCE `MainPane<App>`'s four independent page components and sidebar host with one `PortableComponent` rendering the shared main component. `ShellComponent` remains JUCE window glue and forwards refresh/deadline events. Replace browser runtime `BuildUiFrame` and `DispatchAction` direct calls to `App::PortableSurface()` with calls to its shared main component. Browser application entry points continue to name only the app type.

The old JUCE page hosts may be removed after their host-bound behavior has moved into the JUCE services adapter. Portable page surfaces and models remain shared source code.

### D5 - Browser pointer and Canvas parity follow JUCE semantics

On pointer down, an interactive browser node captures the pointer and stores both client coordinates. Each pointer move computes the incremental unscaled delta `(dx - dy) * 0.0025`; values with absolute magnitude below `0.001` are ignored without advancing the anchor, matching JUCE. Accepted moves dispatch immediately through replacement-delta action formatting and advance the anchor. Pointer up, cancel, and lost capture clear state.

Canvas arc commands use round line caps and round joins within a saved/restored drawing state, matching JUCE's curved, rounded `PathStrokeType`. This keeps zero/near-zero modulation indicators visible while stationary. Other draw kinds retain their existing semantics.

### D6 - Layout and tests assert behavior, not app-specific markup

Browser intrinsic sizing uses resolved absolute surface bounds, converts them to parent-relative CSS offsets only when nesting elements, includes auto-flow content in surface height, sizes unbounded labels/status text from their text, and observes/disposes resize handling. One scale transform is applied to the parentless composite DOM root, so its nested descendants scale with it. JUCE auto-flow is likewise resolved per nearest nested root. Command-buffer validation gains cycle/duplicate reachability protection where composition can otherwise recurse forever.

JUCE-free tests cover composite dimensions, page switching, action routing, namespace/root rejection, and browser System Default audio snapshots. TypeScript tests cover incremental pointer capture, rounded arcs, long labels, and resolved surface height. Playwright renders the generic fake app first and the real generic miniapp binding second, captures desktop and narrow screenshots, verifies the sidebar/pages, mouse drag/double click, audio flow, bidirectional SysEx MIDI, multiple devices, polling/reconnect, and static-site startup.

## Risks / Trade-offs

- [Desktop window becomes 96 pixels wider] -> Treat configured app dimensions as content, add runtime chrome explicitly, and pin this in cross-backend geometry tests.
- [Portable app roots may not satisfy the new composition contract] -> Validate generically and stop on failure; miniapp already emits one origin-zero root using config dimensions.
- [Moving JUCE page callbacks can regress page behavior] -> Reuse existing portable surfaces and move behavior behind services one page at a time with existing JUCE tests kept green.
- [Controller services differ between JUCE devices and Web MIDI ports] -> Expose only generic endpoint snapshots, connection state, commits, and reconcile actions; keep browser port objects in JavaScript and browser bridge code.
- [Large integrated refactor obscures the layout fixes] -> Land and review in small TDD tasks: composition, JUCE adapter, browser adapter/pages, pointer/Canvas, then Playwright integration.
- [Audio artifacts remain audible] -> Report the measured producer deficit and zero-fill behavior prominently; schedule a separate realtime-audio change rather than mixing scheduler work into UI architecture.

## Migration Plan

1. Add the composite surface and fake services tests without changing either host.
2. Add the JUCE services adapter and switch `MainPane`/window sizing to the composite surface.
3. Add the browser services adapter and switch command-buffer build/dispatch to the composite surface.
4. Apply browser pointer, Canvas, and generic layout fixes.
5. Run C++/JUCE/TypeScript/Playwright tests and compare desktop/browser screenshots.
6. Remove superseded JUCE page-host composition only after parity tests pass.

Rollback is a normal commit revert: the existing app surface, portable runtime page models, and host runtimes remain independently testable throughout migration.

## Open Questions

None. Chrome remains primary, the sidebar remains fixed-width on the right, browser output remains System Default only, and the audio scheduler is explicitly deferred.
