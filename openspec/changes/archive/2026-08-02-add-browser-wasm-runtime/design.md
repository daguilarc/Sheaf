## Context

The synth project already has the right inner boundary for this work:
`synth::Engine<App>` is JUCE-free and owns the framework objects, buses,
application instance, patch/config state, and block pump, while
`synth_runtime::Runtime<App>` is the JUCE shell that owns desktop audio, MIDI,
windowing, and timers. The UI layer also already has a host-neutral
`synth::ui::Surface` returning `NodeTree` values with semantic controls and
`DrawCommand` lists, with JUCE isolated in `PortableJuceBackend.hpp`.

Chrome is the primary target. The relevant platform constraints are:

- Audio output and custom processing should use `AudioContext`,
  `AudioWorklet`, and `AudioWorkletNode`. MDN documents that AudioWorklet runs
  off the main thread and that WebAssembly is appropriate for substantial audio
  processors.
- Web Audio render quanta are currently 128 frames in common browsers, but MDN
  warns implementations should use the actual array length rather than assume
  a fixed block size.
- Web MIDI access is requested through `navigator.requestMIDIAccess()` and is
  secure-context, permission, and permissions-policy gated. The synth MIDI
  profiles require parity with the desktop runtime's controller feedback path,
  so the browser runtime requests sysex access up front with
  `navigator.requestMIDIAccess({ sysex: true })`.
- Although Chrome can expose non-default output selection through
  `AudioContext.setSinkId()`, the first browser runtime does not use it. The
  app-facing Audio page still sees an audio-device provider, but that provider
  offers the existing single "System Default" entry, with option id
  `system_default` and the empty persisted output-device name, so application
  and runtime page logic do not change.
- The shipped audio path uses Emscripten's native Wasm AudioWorklet callback
  over the same `synth_browser::Runtime<App>` instance used for UI, MIDI,
  patches, and controllers. Deployment still requires secure context plus
  cross-origin isolation for Emscripten pthread/Wasm worker support and must
  serve COOP/COEP-compatible headers.
- IndexedDB/IDBFS is the browser persistence fit for the existing patch/config
  file model: Emscripten's IDBFS exposes synchronous POSIX-like file calls to
  C++ while persisting asynchronously to IndexedDB through `FS.syncfs`.
- Playwright is the required browser validation harness. The tests should use
  Chromium/Chrome automation with `--mute-audio` removed when audio flow is
  asserted, and test-controlled browser shims for deterministic Web MIDI ports
  where physical MIDI hardware is not available.
- The browser target is a static website. Runtime code, app code, UI backend,
  workers, and AudioWorklet code are delivered as static HTML/JS/WASM/assets.
  The only server responsibility is static file delivery with required headers;
  no dynamic backend, WebSocket service, server-side synth runtime, or native
  bridge is part of normal operation.

The miniapp appears structurally ready because its app-facing contract is the
generic `SynthApplication` shape and its UI is exposed through the portable
surface, not a JUCE component. If implementation discovers that any required
browser path needs app-specific miniapp knowledge, the implementation must stop
and report the missing generic boundary rather than adding a special case.

## Goals / Non-Goals

**Goals:**

- Build a Chrome-targeted WebAssembly runtime host for any
  `synth::SynthApplication`.
- Keep the browser runtime compile-time swappable with the JUCE runtime.
- Reuse `synth::Engine<App>` and the existing app block-processing contract.
- Add a browser UI backend that consumes portable `NodeTree`/draw-command data
  through batched command buffers.
- Use Web Audio/AudioWorklet for audio, Web MIDI for MIDI, and
  IndexedDB-backed persistence for patches/runtime configuration.
- Make the app portability boundary testable with compile-time and browser
  harness checks.

**Non-Goals:**

- No miniapp-specific browser HTML, layout, controls, or event routing.
- No fallback static HTML UI or hand-authored app-specific DOM.
- No rewrite of DSP or synth module behavior in JavaScript.
- No attempt to support every browser in the first change; Chrome is the
  contract target.
- No new application contract that lets browser-only apps bypass the existing
  `SynthApplication` shape.
- No browser audio input support in this change. The browser runtime creates no
  capture path, keeps the Audio page output-only, and avoids `getUserMedia()`;
  audio input can be added after the library-level input path is complete.
- No named browser output-device picker in this change; the browser audio
  provider exposes only the existing "System Default" output option.
- No backend service for the browser runtime. Local development and Playwright
  may use a static file server, but the app itself must not depend on dynamic
  server APIs.

## Decisions

### D1 — Add a sibling browser host over `synth::Engine<App>`

Create a browser-specific runtime template, tentatively
`synth_browser::Runtime<App>`, instead of generalizing the existing JUCE
runtime in place. The browser host owns browser-specific integration and
delegates framework lifecycle, block pumping, message ticks, patches, and app
surface access to the same engine used by JUCE.

Alternative considered: make `synth_runtime::Runtime<App>` take a host policy
for JUCE/browser differences. That would force JUCE and browser APIs into one
large policy surface and make the first browser port riskier. A sibling host
keeps the boundary clearer while preserving compile-time app swapping.

### D2 — Require generic app binding and stop on app-specific leakage

Browser entry points should name only the concrete app type, using a macro or
typed registration equivalent to the JUCE entry-point macro. The browser host
requires the same `SynthApplication` concept and adds browser-portability
assertions only for host boundaries: no JUCE types in app-facing headers, no
host-specific callbacks in app code, and no direct browser API calls from app
sources.

If any browser implementation step cannot be expressed through the generic
engine, app context, portable surface, MIDI profile factory, or runtime page
model, that is a design failure to report, not permission to special-case the
miniapp.

### D3 — Use native Wasm AudioWorklet callbacks over the shared runtime instance

Use a main-thread launcher for permissions and DOM, register the launch-owned
`AudioContext` with the Emscripten module, and start a native Wasm
AudioWorkletProcessor over the already-initialized
`synth_browser::Runtime<App>`. The Emscripten callback
`ProcessAudioWorklet` adapts the callback's `AudioSampleFrame` output buffers
into bounded channel pointers and invokes `Runtime<App>::Process`, which
delegates to the shared `Engine<App>::ProcessBlock` path used by UI, MIDI,
patches, and controllers.

This keeps DOM, Web MIDI, persistence sync, UI tree building, and JS control
APIs out of the realtime callback while avoiding a separate JavaScript audio
sample transport. The callback path is deliberately output-only in this base:
the native node is created with zero input buses, the host does not request
capture, and the app-facing Audio page stays on the existing output selection
model.

Alternative considered: use a JavaScript Worker plus shared sample rings between
the worker and AudioWorklet. That was removed from the shipped base because the
native callback can already pump the shared runtime instance with less latency,
less synchronization, and no second audio transport.

### D4 — Treat browser audio as native callback quanta and expose only System Default

The browser runtime prepares the engine from `audioContext.sampleRate` and the
actual Web Audio render quantum reported by Emscripten for the context. Every
native AudioWorklet callback uses the callback's `samplesPerChannel` as the
block frame count passed through `Runtime<App>::Process` and then
`Engine<App>::ProcessBlock`. No compile-time block size is assumed.

`ProcessAudioWorklet` invokes the shared runtime exactly once for each callback
and passes a monotonic wall-clock timestamp for message-bus scheduling, matching
the JUCE runtime's timestamp role. The engine owns sample-position advancement
from `block.numFrames`; the callback must not separately mutate or
double-advance the engine sample counter. The native node writes the rendered
output directly into Web Audio's output frame and connects to
`audioContext.destination`.

The browser audio-device provider backs the existing Audio page with exactly one
output choice: "System Default", option id `system_default`, persisted as the
existing empty output-device name. This lets existing app/page logic keep
calling the same audio-device selection path without exposing named browser
output devices. Audio input is omitted for this change: browser audio snapshots
keep `showInputCombo` false and `inputOptions` empty, the native node has zero
input buses, and the host does not call `getUserMedia()`.

The runtime must preserve the existing engine ordering: drain patch/UI/MIDI
messages, run optional frame hook, call `ProcessBlock` once per callback block,
and publish UI state at the configured frame cadence.

### D5 — Main thread owns sysex Web MIDI permissions and multi-device ports

The browser shell requests Web MIDI access from a user gesture with
`navigator.requestMIDIAccess({ sysex: true })` and owns `MIDIAccess`,
`MIDIInput`, and `MIDIOutput` objects on the browser side. Incoming MIDI bytes,
including sysex payloads, are serialized into a generic MIDI input queue for the
worker, which forwards them through the existing per-controller processor chain
into `midiBus_`. Outbound MIDI messages from engine-owned output processors are
serialized from the worker to the main thread, where the selected
`MIDIOutput.send()` call happens.

This avoids assuming Web MIDI is available inside workers and keeps permission
prompts in the user-gesture/DOM context. Device references remain generic:
ports are matched by stable browser identifiers and descriptive metadata, and
absent ports degrade to offline state like JUCE absent devices.

The browser runtime should mirror the desktop MIDI connection manager's shape:
one handler/sink binding per controller slot, multiple simultaneous input and
output ports, a browser-owned poll loop plus `MIDIAccess.statechange` events,
offline status when a configured port disappears, and automatic reconnect when
a matching port returns. The browser bridge should reuse the existing JUCE-free
MIDI reconciliation core (`PlanMidiReconciliation`/`ExecuteReconcilePlan`) where
the C++/WASM boundary permits, binding its endpoint operations to browser port
open/close/update/resync messages rather than reimplementing reconcile policy in
JavaScript. Browser JavaScript timers replace the JUCE poll thread
mechanically, but the observable runtime semantics are the same: polling keeps
connection state fresh even when browser events are missed.

The generic browser ABI is part of this bridge. It must expose C-callable,
application-agnostic operations for: submitting a browser MIDI endpoint snapshot
to the C++ reconcile bridge; returning generic endpoint actions/status for the
main thread to apply to Web MIDI port objects; delivering inbound bytes plus a
controller-slot index into the existing engine MIDI input processor chain; and
draining engine-produced outbound bytes per controller slot for the main thread
to send through `MIDIOutput.send()`. These operations are owned by
`synth_browser::Runtime<App>`/`BrowserMidiBridge`, not by any concrete app entry
point, and the Emscripten export list must include them.

### D6 — Serialize UI frames as compact binary command buffers

The browser backend should not call into JavaScript or the browser per draw
operation. Instead, the worker builds the current portable `NodeTree` and
serializes a compact binary frame command buffer containing:

- node records with stable IDs, kinds, bounds, state, action IDs, and parent
  relationships,
- a string table for labels, text, action names/values, and option labels,
- draw records for fill, stroke, line, arc, text, ellipse, rounded rect,
  polyline, and polygon commands,
- scroll extents and viewport bounds,
- dirty/epoch metadata for incremental DOM/canvas updates.

The main-thread browser backend consumes one buffer per UI frame. It diffs
semantic controls into DOM nodes and renders draw nodes in batches to Canvas2D
or OffscreenCanvas. Browser pointer/keyboard/form events dispatch portable
`Action` values back to the worker; the worker calls
`Surface::DispatchAction`. Pointer-drag actions must preserve the existing
portable value convention used by the JUCE backend: if an action value contains
a colon-delimited prefix, the backend replaces the suffix after the final colon
with the current drag delta; otherwise it dispatches the delta as the whole
value.

### D7 — Preserve semantic controls instead of painting everything

Buttons, toggles, sliders, combo boxes, text fields, labels, status text, rows,
sections, and scroll areas remain semantic in the buffer. Bespoke synth visuals
use draw commands. This keeps runtime pages accessible/testable and avoids
rebuilding browser form controls as raw canvas pixels.

### D8 — Browser persistence mirrors runtime data paths on IDBFS

Mount an app-scoped IDBFS tree before `Runtime<App>::Start()`, call
`FS.syncfs(true)` before engine initialization, and set browser runtime data
paths under that mounted root. After runtime configuration saves or patch
commands complete, schedule `FS.syncfs(false)` from the message side and report
status through existing runtime page status fields.

The implementation may later replace IDBFS with a custom IndexedDB adapter, but
the first port should keep the current `std::filesystem`-based patch/config code
alive with the least surface area.

### D9 — Use handwritten browser glue around the Emscripten module

Use a small handwritten TypeScript/JavaScript browser shell around the
Emscripten modularized WASM output. The shell owns main-thread permissions,
Playwright-test shims, the worker protocol, the AudioWorklet module, command
buffer consumption, and Web MIDI port objects. The C++ side exposes a narrow C
ABI or embind boundary for runtime creation, block processing, UI buffer
production, action dispatch, and diagnostics.

Alternative considered: Emscripten's Wasm Audio Worklets API. It is attractive
for smaller demos, but this runtime needs explicit control over the multi-device
MIDI bridge, command-buffer UI loop, persistence sync, and deterministic
Playwright shims. Handwritten glue keeps those generic host responsibilities
visible.

### D10 — Ship as static web assets

The browser build emits a static site: an HTML shell, browser JS/TS bundle,
worker script, AudioWorklet script, `.wasm` module, and any required static
metadata/assets. All runtime state that would otherwise need a server lives in
the browser runtime, WASM heap, Web Audio graph, Web MIDI ports, and
IndexedDB/IDBFS persistence. A static file server is acceptable for local
development, Playwright, and production hosting, but the synth runtime must not
require HTTP APIs, WebSockets, server-side patch storage, or a native helper.

This choice follows from the generic app boundary: the browser host is just
another compile-time runtime shell over `Engine<App>`, not a client for a
server-hosted synth.

### D11 — Playwright is the required browser acceptance harness

Verification should prove the generic host, not just the miniapp:

- C++ concept/static-assert tests for a fake conforming app and fake invalid
  apps.
- JUCE-free command-buffer serialization tests over synthetic portable trees.
- Playwright integration tests in Chrome/Chromium that open the app, start audio
  after user activation, assert finite/non-silent audio flow through a browser
  test probe, dispatch UI and mouse gestures, simulate Web MIDI input/output
  including sysex through injectable ports, and verify no app-specific DOM
  exists.
- A miniapp browser smoke target only after the generic fake app passes.

## Risks / Trade-offs

- [Emscripten worker support requires cross-origin isolation] -> Make Chrome
  deployment headers part of the spec and fail clearly when
  `crossOriginIsolated` is false.
- [Native AudioWorklet callback can miss its deadline] -> Publish callback
  deadline/peak metrics, fail closed when callback startup makes no progress,
  and verify finite non-silent output through browser tests.
- [AudioWorklet block size assumptions break later] -> Always derive frame count
  from the actual native callback frame shape.
- [Web MIDI sysex permission denied or blocked by policy] -> Treat MIDI as
  offline while audio/UI continue running; show generic status through runtime
  pages, including that sysex permission was required.
- [Browser MIDI events are missed] -> Run a browser-owned poll loop in addition
  to `statechange` handling, matching the desktop runtime's reconnect
  semantics.
- [Named output device selection is tempting but permission-heavy] -> Expose a
  single "System Default" provider in the browser host and leave `setSinkId()`
  out of scope for this change.
- [IDBFS sync is asynchronous] -> Complete initial sync before engine startup and
  make save/load UI status reflect pending/succeeded/failed persistence sync.
- [Command buffers grow too large] -> Start with whole-frame buffers for
  correctness, include epochs and dirty metadata, and optimize incrementally
  only after profiling.
- [Miniapp still hides host assumptions] -> The implementation gate is explicit:
  stop on any required app-specific browser special case.
- [Static hosting headers are easy to omit] -> Treat COOP/COEP and MIDI
  permissions-policy guidance as deployment artifacts, and have Playwright serve
  the static build with those headers.

## Migration Plan

1. Add generic browser build scaffolding and fake-app compile tests without
   touching the JUCE runtime behavior.
2. Add portable UI command-buffer serialization tests and a browser backend
   harness over synthetic trees.
3. Add the browser runtime shell around `synth::Engine<App>` with IDBFS-backed
   data paths and message-side ticking.
4. Add the native Wasm AudioWorklet callback bridge and verify a fake app can
   produce non-silent finite output in Chrome.
5. Add the sysex Web MIDI multi-device bridge, poll/reconnect manager, and
   runtime page status/device enumeration plumbing.
6. Package the browser app as static assets and add local static serving with
   required headers for Playwright.
7. Add Playwright tests for app open, audio flow, bidirectional MIDI flow,
   sysex, and mouse gestures.
8. Wire a generic browser app entry-point macro/registration and build the
   miniapp only through that generic entry point.
9. Run JUCE tests, synth headless tests, browser fake-app tests, and miniapp
   browser smoke tests.

Rollback is straightforward while the browser target is additive: remove the
browser build target and generated web assets without changing the JUCE runtime
or core engine contracts.

## Open Questions

None. The first implementation uses compact binary command buffers, handwritten
browser glue around Emscripten output, sysex Web MIDI permission requests, a
browser System-Default-only audio provider, no browser audio input support,
static website deployment, and Playwright for browser acceptance coverage.
