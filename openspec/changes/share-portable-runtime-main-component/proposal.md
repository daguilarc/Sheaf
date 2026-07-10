## Why

The browser runtime currently renders only the application's portable surface, while the JUCE runtime separately owns the sidebar and runtime pages. This duplicates top-level composition, hides required runtime UI in Chrome, clips app content on desktop, and lets pointer and drawing behavior drift between backends.

## What Changes

- Introduce one JUCE-free, application-templated runtime main component that composes any conforming application's portable surface with the shared sidebar and runtime pages.
- Make the JUCE and browser runtimes render and dispatch through that same top-level component using compile-time-swappable host service adapters.
- Preserve the application's configured content area and place the fixed-width runtime sidebar outside it instead of clipping application content.
- Back the browser Audio page with a generic `System Default` output option and no input selector when the application requests no audio inputs.
- Match JUCE pointer-drag semantics in the browser with pointer capture and incremental two-axis deltas, and match rounded JUCE arc stroke caps in Canvas.
- Correct generic browser surface clipping, coordinate-space, and long-label sizing defects found during review.
- Extend Playwright coverage for static-site startup, the shared sidebar and pages, audio flow, bidirectional SysEx MIDI, reconnect behavior, mouse gestures, and visual layout.
- Leave the diagnosed browser audio render scheduler unchanged; its guaranteed underrun at 48 kHz is reported separately and requires a dedicated realtime-audio design.

## Capabilities

### New Capabilities
- `synth-portable-runtime-shell`: Host-neutral top-level UI composition, runtime service adaptation, backend action routing, and browser/JUCE rendering parity.

### Modified Capabilities
- `synth-runtime-ui`: Require the same sidebar, content host, and runtime pages through every active UI backend without shrinking or clipping the application surface.
- `synth-app-runtime`: Require JUCE and browser hosts to instantiate the same portable runtime main component while keeping application code free of host-specific logic.

## Impact

The change affects portable UI composition under `projects/synth/include/synth`, the JUCE runtime shell and page hosts, the browser WASM runtime and Canvas/DOM backend, browser tests and build targets, and OpenSpec coverage. It adds no application-specific browser code, no HTML fallback UI, no browser framework dependency, and no change to DSP or audio scheduling.
