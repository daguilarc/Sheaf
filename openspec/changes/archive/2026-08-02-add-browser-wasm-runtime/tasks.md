## 1. Browser Build And Portability Gates

- [x] 1.1 Add browser-owned source/build directories and Emscripten build targets for a generic synth browser app without compiling JUCE.
- [x] 1.2 Add a fake conforming synth application used only for browser host and backend tests.
- [x] 1.3 Add compile-time tests proving the browser runtime accepts the fake conforming app and rejects apps missing required config, init, process-block, or portable-surface hooks.
- [x] 1.4 Add source-boundary checks or compile tests proving app-facing headers and browser targets do not include JUCE headers or browser APIs outside host/backend paths.
- [x] 1.5 Add the browser app entry-point binding that names only the concrete application type.
- [x] 1.6 Package browser builds as static website artifacts containing only static HTML, JavaScript, WASM, worker, AudioWorklet, and asset files.
- [x] 1.7 Add a static local server for Playwright that serves the browser build with required COOP/COEP and permissions-policy headers and no dynamic app API.

## 2. Portable UI Command Buffers

- [x] 2.1 Define the compact binary browser command-buffer record format for node hierarchy, stable IDs, semantic controls, action metadata, scroll extents, string-table entries, draw commands, and dirty/epoch metadata.
- [x] 2.2 Implement JUCE-free serialization from `synth::ui::NodeTree` to the browser command buffer.
- [x] 2.3 Add serialization tests for representative runtime page controls, scroll areas, and bespoke draw nodes.
- [x] 2.4 Add stable-identity tests across consecutive UI frames with changed values/draw commands.
- [x] 2.5 Add unsupported-node/unsupported-draw-command diagnostics that report generic portable feature gaps without app-specific fallback.

## 3. Browser UI Backend

- [x] 3.1 Implement the browser-side command-buffer consumer that diffs semantic controls by node ID.
- [x] 3.2 Implement batched Canvas2D or OffscreenCanvas rendering for draw-command nodes.
- [x] 3.3 Implement browser event translation for buttons, toggles, sliders, combo boxes, text fields, pointer drags, row double-clicks, and draw-node double-clicks into portable actions, preserving existing drag-delta replacement semantics for encoder/rotary actions, including replacement of the suffix after the final colon in action values, and double-click push behavior.
- [x] 3.4 Add scroll viewport/content-extent rendering and tests proving bottom content remains reachable.
- [x] 3.5 Add a Playwright Chrome harness over synthetic trees proving the backend uses no app-specific HTML or app-specific DOM construction and dispatches pointer drag/double-click actions correctly.

## 4. Browser Runtime Core

- [x] 4.1 Implement `synth_browser::Runtime<App>` over `synth::Engine<App>` with generic start, stop, message tick, app surface, patch/config, and runtime data path access.
- [x] 4.2 Mount or provide app-scoped browser persistent paths before engine initialization and call initial storage sync before startup config/patch load.
- [x] 4.3 Add browser runtime status plumbing for startup, persistence, MIDI availability, audio availability, and unsupported security gates.
- [x] 4.4 Add handwritten worker/main-thread message protocols around the Emscripten module for runtime start/stop, action dispatch, UI frame transfer, patch/config status, MIDI, audio status, and diagnostics.
- [x] 4.5 Add tests proving no browser runtime path branches on miniapp or any concrete application identity.

## 5. Web Audio Bridge

- [x] 5.1 Add the main-thread audio startup flow using user activation, `AudioContext`, AudioWorklet module installation, and AudioWorkletNode graph connection.
- [x] 5.2 Implement native Emscripten Wasm AudioWorklet startup with launch-owned `AudioContext` registration, processor/node creation, zero input buses, callback progress diagnostics, and clear failure when cross-origin isolation or native worklet support is unavailable.
- [x] 5.3 Adapt native AudioWorklet output frames into `synth::AudioBlock`, prepare the engine from `AudioContext.sampleRate` plus the actual render quantum, and invoke `Runtime<App>::Process` exactly once per callback without a JavaScript/worker sample ring.
- [x] 5.4 Implement the browser audio-device catalog as a generic host provider with exactly one selectable "System Default" option (`system_default`) persisted as the existing empty output-device name, with no `setSinkId()` or named-output enumeration.
- [x] 5.5 Keep browser audio output-only in this base, keep browser Audio page snapshots with `showInputCombo == false` and empty `inputOptions`, expose only the System Default output catalog, and avoid `getUserMedia()` in this change.
- [x] 5.6 Add Playwright Chrome tests proving the fake app opens, starts audio after activation, produces finite non-silent output through the native callback, handles actual worklet callback frame counts, exposes only System Default audio output, and reports callback-start/security failures.

## 6. Web MIDI Bridge

- [x] 6.1 Implement Web MIDI sysex permission request using `navigator.requestMIDIAccess({ sysex: true })`, port enumeration, statechange handling, and unavailable/denied status reporting.
- [x] 6.2 Implement a browser MIDI connection manager with one handler/sink binding per controller slot, multiple simultaneous input/output ports, stored endpoint references, and no app-specific routing.
- [x] 6.3 Add the browser MIDI poll loop so missed port changes are detected and configured devices reconnect/offline like the desktop runtime, reusing the existing JUCE-free MIDI reconcile core through generic browser runtime ABI operations for endpoint snapshots, endpoint actions, inbound bytes, and outbound-byte draining.
- [x] 6.4 Forward incoming browser MIDI bytes, including sysex, through the existing per-controller MIDI input processor chain into the engine MIDI bus.
- [x] 6.5 Forward engine-produced MIDI output bytes, including sysex, to the selected browser `MIDIOutput` for each controller slot.
- [x] 6.6 Add injectable Web MIDI tests for sysex permission denial, multiple devices, input message routing, output message routing, sysex round-trip visibility, polling recovery, and device connect/disconnect reconciliation.

## 7. Browser Persistence

- [x] 7.1 Persist runtime configuration and patch files through IDBFS or an equivalent IndexedDB-backed app-scoped storage adapter.
- [x] 7.2 Synchronize browser storage after successful config save, patch save, save-as, overwrite-save-as, and load-related metadata updates.
- [x] 7.3 Surface pending/succeeded/failed browser persistence sync status through existing runtime page status paths.
- [x] 7.4 Add tests proving patch browsing/save/load paths remain under the app-scoped `patches/` root.

## 8. Generic And Miniapp Browser Validation

- [x] 8.1 Add the Playwright Chrome integration test runner and document required static-hosting secure-context, cross-origin-isolation, and permissions-policy headers.
- [x] 8.2 Run the generic fake-app Playwright test before any miniapp browser smoke test.
- [x] 8.3 Add a miniapp browser build using only the generic browser entry point and backend.
- [x] 8.4 Add miniapp Playwright smoke coverage for app open, audio flow, bidirectional MIDI flow through injectable ports, mouse gesture dispatch, UI command-buffer rendering, and absence of miniapp-specific browser glue.
- [x] 8.5 Add Playwright assertions that the browser app does not call dynamic HTTP APIs or WebSocket endpoints during normal audio, MIDI, UI, patch, or configuration flows.
- [x] 8.6 Run `make -C projects/synth test` and the browser test suite; document any browser-only prerequisites or skipped checks.
