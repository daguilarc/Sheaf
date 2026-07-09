## Why

The synth runtime already separates a JUCE-free application/engine contract from
the JUCE host shell, which makes a browser-hosted build plausible without
rewriting application logic. This change defines the browser runtime and UI
backend needed to run any conforming synth application as WebAssembly in Chrome,
with Web Audio and Web MIDI replacing JUCE device ownership.

## What Changes

- Add a Chrome-targeted browser host for `synth::Engine<App>` that is compile-time
  swappable with the existing JUCE runtime and contains no application-specific
  miniapp logic.
- Add a browser UI backend for the existing portable UI surface that consumes
  `synth::ui::NodeTree` and batched draw commands instead of calling into the DOM
  or canvas synchronously per draw operation.
- Add JavaScript/WASM host bindings for Web Audio startup, AudioWorklet render
  callbacks, sysex-enabled Web MIDI input/output device lifecycle with
  multi-device polling/reconnect behavior, runtime configuration, and browser
  persistence.
- Package the browser target as a static website: HTML, JavaScript, WASM,
  AudioWorklet, worker, and asset files that can be served from static hosting
  with the required browser security headers and no application backend.
- Back the existing Audio page with a browser host device catalog that exposes
  only the existing "System Default" option in this change, using option id
  `system_default` and the empty persisted output-device name, so app and page
  logic remain generic while named browser output selection stays out of scope.
- Extend the app/runtime contract only where necessary to state that browser
  hosts require the same generic `SynthApplication` shape as JUCE hosts and must
  fail at compile time when an app depends on JUCE-only APIs.
- Keep application source generic: no hard-coded miniapp controls, no HTML
  fallback implementation, no app-specific browser layout, and no browser host
  special cases for any concrete app.

## Capabilities

### New Capabilities

- `synth-browser-wasm-runtime`: Chrome-targeted WebAssembly host, Web Audio/Web
  MIDI integration, browser persistence, build/test entry points, and generic
  app instantiation contract.

### Modified Capabilities

- `synth-app-runtime`: extend the existing JUCE-free engine/runtime contract so
  multiple hosts can instantiate the same application at compile time and share
  lifecycle, audio block, MIDI bus, patch, and runtime-configuration semantics.
- `synth-runtime-ui`: extend the portable UI backend contract with browser
  rendering, command-buffer serialization, event dispatch, scroll semantics, and
  host-independent tests.

## Impact

- Affected code: `projects/synth/include/synth`, `projects/synth/runtime`,
  `projects/synth/juce`, new browser-specific host/backend sources under
  `projects/synth/browser` or equivalent, and app build scaffolding.
- Browser APIs: `AudioContext`, `AudioWorklet`, `AudioWorkletNode`,
  `navigator.requestMIDIAccess({ sysex: true })`, `MIDIAccess`, `MIDIInput`,
  `MIDIOutput`, and IndexedDB-backed persistence.
- Deployment: static website assets only; the browser runtime is fully
  client-side HTML, JavaScript, WASM, worker, AudioWorklet, and asset files.
  Local development and production hosting may serve those files with required
  headers, but no server-side synth runtime, WebSocket service, dynamic HTTP
  API, or native helper process is required for normal browser operation.
- Tooling: Emscripten/LLVM WebAssembly build rules, Playwright browser test
  harnesses, and Chrome-focused smoke/integration tests.
- Security/deployment: secure context requirements for Web MIDI and sysex
  permission; mandatory cross-origin isolation for the
  `SharedArrayBuffer`/WASM shared-memory audio bridge.
