## 1. Shared Portable Main Component

- [x] 1.1 Add failing JUCE-free tests for composite root geometry, app-tree validation, page switching, action routing, and runtime namespace protection.
- [x] 1.2 Implement `RuntimeMainComponent<App, Services>` and its compile-time host services contract using the existing portable sidebar and runtime page surfaces.
- [x] 1.3 Add tree-composition validation for one config-sized app root, unique IDs, known children, acyclic reachability, and the reserved `runtime.*` namespace.

## 2. JUCE Host Integration

- [x] 2.1 Add a JUCE runtime services adapter that preserves Audio, Controllers, File, deadline, configuration-save, and refresh behavior behind the shared component contract.
- [x] 2.2 Replace independent `MainPane` app/sidebar/page component ownership with one `PortableComponent` rendering `RuntimeMainComponent`, and make window size additive for the 96-pixel sidebar.
- [x] 2.3 Update JUCE runtime-shell and page tests to prove shared navigation, complete app bounds, refresh, and action parity.

## 3. Browser Host Integration

- [x] 3.1 Add a browser runtime services adapter for System Default audio, controller/MIDI state, engine patch operations, persistence status, deadline state, and runtime-configuration save.
- [x] 3.2 Route browser command-buffer construction and action dispatch through the shared main component without changing concrete app entry points.
- [x] 3.3 Add JUCE-free browser runtime tests for sidebar/page frames, System Default audio, app action routing, and no concrete-app source dependency.

## 4. Browser UI Parity

- [x] 4.1 Add failing TypeScript browser-backend tests for pointer capture, incremental two-axis drag math, threshold retention, scale compensation, and capture cleanup.
- [x] 4.2 Implement JUCE-equivalent pointer gesture dispatch and rounded, state-isolated Canvas arc strokes.
- [x] 4.3 Make portable bounds absolute in both backends by translating complete composed subtrees, resolving auto-flow per nearest nested root, and converting absolute child bounds to parent-relative DOM offsets; also correct resolved surface height, long label/status sizing, single-root scaling, cycle-safe traversal, and resize disposal.

## 5. Browser Integration Verification

- [x] 5.1 Extend Playwright fake-app coverage for shared sidebar/page navigation, app actions, pointer gestures, desktop and narrow visual screenshots, and static-site-only startup.
- [x] 5.2 Extend real-WASM miniapp coverage to assert complete app/sidebar rendering, finite non-silent audio, bidirectional SysEx MIDI, multiple devices, polling/reconnect, and generic runtime reuse.
- [x] 5.3 Build the JUCE app and browser miniapp, compare fresh desktop/browser screenshots, and correct remaining generic layout or interaction discrepancies.

## 6. Review and Documentation

- [x] 6.1 Record the deferred audio diagnosis: 48 kHz producer/consumer deficit, zero-fill underruns, and per-block allocation/copy pressure, with no audio code changes.
- [x] 6.2 Run per-task xagent Claude reviews and resolve all critical/important findings without adding application-specific logic.
- [x] 6.3 Run synth, JUCE, TypeScript, Playwright, generic-boundary, and OpenSpec validation suites and update coverage documentation.
