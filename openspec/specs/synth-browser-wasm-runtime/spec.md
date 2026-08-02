# synth-browser-wasm-runtime Specification

Project: `projects/synth`. ID prefix: `sbw`.

## Purpose

Define the Chrome-targeted WebAssembly browser runtime host for conforming synth
applications: static website packaging, generic `synth_browser::Runtime<App>`
instantiation over `synth::Engine<App>`, Web Audio/AudioWorklet output, Web
MIDI sysex multi-device integration, browser persistence, portable UI command
buffer delivery, and browser validation for generic and first-party apps.

## Requirements

### Requirement: sbw-1 — Project: browser runtime layout and build target
WHEN the browser WASM runtime capability is implemented, THE synth project SHALL provide browser-specific runtime and UI-backend sources under a browser-owned project area, Emscripten/LLVM WebAssembly build rules that compile the JUCE-free synth core and a named synth application into browser assets, and an entry-point binding that names only the application type; the build SHALL NOT compile JUCE sources, include JUCE headers, or require app-specific browser source files for the miniapp or any other concrete app.

#### Scenario: Browser fake app builds without JUCE
- **WHEN** a developer builds the browser runtime target for a test application satisfying `synth::SynthApplication`
- **THEN** the generated browser assets compile without JUCE include paths
- **AND** the entry point names only the test application type

#### Scenario: Miniapp has no browser-specific source
- **WHEN** the browser target is built for the miniapp
- **THEN** the build uses the same generic browser runtime and UI backend used by other apps
- **AND** no miniapp-specific HTML, JavaScript, or browser backend source is required

### Requirement: sbw-2 — Deployment: static website artifact
WHEN a browser synth application is built, THE synth browser build SHALL produce a static website artifact made only of static HTML, JavaScript, WebAssembly, worker, AudioWorklet, and asset files; normal browser operation SHALL NOT require a server-side synth process, dynamic HTTP API, WebSocket service, native helper, or application-specific backend.

#### Scenario: Static files serve the app
- **WHEN** the browser fake app or miniapp build output is served by a static file server with the required security headers
- **THEN** the app opens, initializes its browser runtime, loads its WASM module, installs its worker and AudioWorklet, and can run without contacting any dynamic API endpoint

#### Scenario: Dynamic backend is absent
- **WHEN** the browser runtime performs audio, MIDI, UI, patch, or runtime-configuration operations
- **THEN** those operations are handled by browser APIs, WASM code, static assets, and browser persistence
- **AND** no operation requires a server-hosted synth runtime, WebSocket bridge, or native companion process

### Requirement: sbw-3 — Host: generic browser runtime over Engine
WHEN a synth application runs in Chrome through the browser runtime, THE browser runtime SHALL instantiate `synth::Engine<App>` for the selected application type, drive the same initialization, prepare, per-block pump, message-side tick, patch, runtime-configuration, and shutdown responsibilities as a host over that engine, and keep all browser API integration outside application sources.

#### Scenario: Browser host drives engine lifecycle
- **WHEN** the browser runtime starts a conforming application
- **THEN** application `Init`, UI-state creation, runtime configuration load, MIDI processor construction, startup patch load, engine prepare, audio pumping, message ticking, and shutdown execute through `synth::Engine<App>` entry points

#### Scenario: Application-specific browser logic is rejected
- **WHEN** implementing browser runtime behavior would require hard-coded knowledge of miniapp widgets, pages, module graphs, parameters, or layout
- **THEN** implementation SHALL stop and report that the current application/runtime boundary is insufficient
- **AND** it SHALL NOT add the app-specific branch to the browser runtime or backend

### Requirement: sbw-4 — Audio: Web Audio and AudioWorklet bridge
WHEN browser audio is started on a launch path initiated by user activation, THE browser runtime SHALL create or resume the launch-owned `AudioContext`, register that context with the package's Emscripten module, prepare the engine with the `AudioContext` sample rate and actual render quantum, install one native Wasm `AudioWorkletProcessor`, connect its output to `AudioContext.destination`, and invoke the shared engine block pump exactly once per native callback through `ProcessAudioWorklet -> Runtime<App>::Process`; THE browser audio-device provider SHALL expose the existing runtime Audio page to exactly one "System Default" output option with option id `system_default` and an empty persisted output-device name, and this base SHALL create zero worklet input buses, hide browser input controls, and avoid capture APIs.

#### Scenario: User activation starts audio
- **WHEN** the user activates the browser runtime start action
- **THEN** the browser shell creates or resumes the `AudioContext`
- **AND** audio does not attempt to autoplay before that activation

#### Scenario: Native callback block size is not assumed
- **WHEN** the native AudioWorklet callback receives an output `AudioSampleFrame`
- **THEN** the browser runtime uses `samplesPerChannel` as the engine block frame count
- **AND** it does not assume a compile-time block size

#### Scenario: Native callback pumps one engine block
- **WHEN** `ProcessAudioWorklet` receives a valid output frame
- **THEN** it builds bounded output channel pointers and calls `Runtime<App>::Process` exactly once
- **AND** the engine receives a JUCE-free output `AudioBlock` sized to the callback's actual frame count
- **AND** monotonic sample position advances by the processed frame count

#### Scenario: Render path avoids browser API calls
- **WHEN** an audio render quantum is processed
- **THEN** the native callback performs bounded pointer adaptation, engine processing, deadline/peak metering, and failure-to-silence handling only
- **AND** it does not touch DOM APIs, IndexedDB, Web MIDI device objects, UI command-buffer construction, or JavaScript DSP/sample transport

#### Scenario: Audio page exposes default output
- **WHEN** the browser runtime Audio page asks the host for output device choices
- **THEN** the browser host returns exactly one selectable output labeled "System Default" with option id `system_default`
- **AND** selecting it writes the existing empty persisted output-device name through the generic audio selection path

#### Scenario: Browser capture path is omitted
- **WHEN** the browser runtime builds its Audio page snapshot
- **THEN** the browser host sets `showInputCombo` to false
- **AND** `inputOptions` is empty
- **AND** it does not call `getUserMedia()` or add microphone/input routing

### Requirement: sbw-5 — MIDI: Web MIDI sysex multi-device bridge
WHEN browser MIDI support is enabled, THE browser runtime SHALL request MIDI access through `navigator.requestMIDIAccess({ sysex: true })`, enumerate multiple `MIDIInput` and `MIDIOutput` ports, map selected ports to the existing runtime MIDI instrument/controller configuration per controller slot, forward incoming MIDI bytes including sysex into the engine's existing MIDI input processor chain, send engine-produced MIDI output bytes including sysex through the selected `MIDIOutput` ports, and maintain desktop-equivalent polling/reconnect semantics without application-specific routing code.

#### Scenario: Sysex permission denial leaves MIDI offline
- **WHEN** Web MIDI sysex access is denied, unavailable, or blocked by permissions policy
- **THEN** the browser runtime keeps audio and UI running
- **AND** controller endpoints are reported as offline or unavailable through the generic runtime controller state
- **AND** status names the missing MIDI sysex permission

#### Scenario: Incoming MIDI uses existing processors
- **WHEN** a selected browser MIDI input receives a message
- **THEN** the message bytes, including any sysex payload, are delivered to the matching controller slot's existing MIDI input processor chain
- **AND** resulting parameter/UI messages flow through the engine MIDI bus

#### Scenario: Outgoing MIDI stays generic
- **WHEN** an engine MIDI output processor emits bytes for a controller slot
- **THEN** the browser bridge sends those bytes to the selected `MIDIOutput` for that slot
- **AND** it does not inspect the concrete application type or widget layout

#### Scenario: Device changes reconcile endpoints
- **WHEN** Web MIDI reports a port connection or disconnection
- **THEN** the browser runtime updates the generic endpoint availability state and reconciles affected controller slots without rebuilding app-specific state
- **AND** it uses the existing JUCE-free MIDI reconciliation policy where the C++/WASM boundary permits

#### Scenario: Polling recovers missed device changes
- **WHEN** a browser MIDI input or output disappears or reappears without a reliable `statechange` delivery
- **THEN** the browser runtime's MIDI poll loop detects the changed port set
- **AND** configured controller slots move offline or reconnect using the same stored endpoint references

#### Scenario: Multiple devices stay independent
- **WHEN** two controller slots are mapped to different browser MIDI input/output port pairs
- **THEN** incoming messages and outgoing feedback for each slot use that slot's selected ports
- **AND** reconnecting one slot's port does not close or remap the other slot's active port

### Requirement: sbw-6 — UI: browser command-buffer backend
WHEN a browser UI frame is rendered, THE browser UI backend SHALL consume a serialized command buffer derived from the application's portable `synth::ui::NodeTree`, update semantic browser controls by stable node identity, render draw-command nodes through a batched canvas-oriented path, and dispatch browser events back as portable `synth::ui::Action` values; the backend SHALL NOT synchronously call browser drawing APIs once per C++ draw call.

#### Scenario: Whole tree serializes to a frame buffer
- **WHEN** the worker builds a portable UI frame
- **THEN** node hierarchy, bounds, semantic control state, options, scroll extents, actions, and draw commands are encoded into a command buffer

#### Scenario: Draw commands are batched
- **WHEN** a draw node contains multiple fill, stroke, line, arc, text, ellipse, rounded-rect, polyline, or polygon commands
- **THEN** the browser backend receives them as buffer records and renders them in a browser-owned batch
- **AND** C++ drawing code does not call Canvas or DOM APIs directly per command

#### Scenario: Events dispatch through portable actions
- **WHEN** a browser button, slider, combo box, text field, pointer drag, or double-click event fires
- **THEN** the backend dispatches the corresponding portable action to the worker
- **AND** the worker calls the surface's `DispatchAction` path

### Requirement: sbw-7 — Persistence: browser runtime data paths
WHEN the browser runtime starts, THE browser host SHALL mount or provide an app-scoped browser-persistent data root before engine initialization, synchronize persisted data into the runtime-visible file tree before startup patch/config load, expose `patches/`, `logs/`, and configuration paths to the engine as runtime data paths, and synchronize changed patch/config files back to browser storage after save operations complete.

#### Scenario: Startup sync precedes engine initialization
- **WHEN** browser persistent storage contains runtime configuration or patches
- **THEN** those files are synchronized into the runtime-visible data root before `Engine<App>::Initialize()` runs

#### Scenario: Patch save persists to browser storage
- **WHEN** a patch save or save-as command completes successfully
- **THEN** the browser runtime schedules persistence synchronization for the affected files
- **AND** the File page status can report pending, succeeded, or failed persistence sync

#### Scenario: Runtime paths remain root constrained
- **WHEN** browser patch browsing, save-as, or load actions resolve paths
- **THEN** every path remains under the app-scoped runtime `patches/` root
- **AND** browser storage keys or paths do not expose arbitrary host filesystem access

### Requirement: sbw-8 — Deployment: Chrome security gates
WHEN the browser runtime is served for Chrome, THE deployed page SHALL run in a secure context, SHALL require cross-origin isolation for Emscripten pthread/Wasm worker support, SHALL fail with an explicit diagnostic when required browser APIs are unavailable, and SHALL document the HTTP headers and permissions policies required for Web Audio, Web MIDI with sysex, System-Default-only audio selection, and persistent storage.

#### Scenario: Cross-origin isolation gate is explicit
- **WHEN** the browser runtime starts and Emscripten pthread/Wasm worker support requires cross-origin isolation but `crossOriginIsolated` is false
- **THEN** startup fails before audio starts with a diagnostic naming the missing cross-origin isolation requirement

#### Scenario: Web MIDI secure-context gate is explicit
- **WHEN** the browser runtime attempts to enable MIDI outside a secure context
- **THEN** MIDI is marked unavailable with a diagnostic
- **AND** audio and UI startup may continue when their own requirements are satisfied

#### Scenario: Named output selection is not requested
- **WHEN** the browser runtime starts or opens the Audio page
- **THEN** it does not call `AudioContext.setSinkId()` or enumerate named audio output devices
- **AND** it exposes only the "System Default" option through the generic audio-device selection interface

### Requirement: sbw-9 — Verification: Playwright browser runtime coverage
WHEN browser runtime support is implemented, THE synth project SHALL include automated coverage for the generic browser host and backend, including JUCE-free C++ unit tests, command-buffer serialization tests, and Playwright Chrome integration tests that run at least one fake conforming app before the miniapp smoke target and verify app open, audio flow, bidirectional MIDI flow, sysex permission/request behavior, and mouse gesture dispatch.

#### Scenario: Invalid app fails at compile time
- **WHEN** a browser runtime compile test instantiates the browser runtime with a type missing the required application surface or block-processing hook
- **THEN** compilation fails with a diagnostic naming the missing contract member

#### Scenario: Browser fake app runs before miniapp smoke
- **WHEN** the Playwright browser integration test suite runs
- **THEN** it first starts a generic fake synth app through the browser runtime
- **AND** verifies audio startup, UI action dispatch, command-buffer rendering, and persistence without app-specific browser code

#### Scenario: Playwright verifies audio and MIDI flow
- **WHEN** the Playwright fake-app test starts the browser runtime
- **THEN** it opens the app in Chrome, starts audio from user activation, observes finite non-silent output through a test probe, injects Web MIDI input bytes including sysex through test-controlled MIDI ports, observes corresponding runtime state changes, and observes engine-produced MIDI output bytes on the selected test output port

#### Scenario: Playwright verifies mouse gestures
- **WHEN** the Playwright test performs pointer drag and double-click gestures on a browser-rendered draw node with portable gesture actions
- **THEN** the runtime receives the corresponding portable drag and double-click actions
- **AND** the application behavior is reached through `Surface::DispatchAction`
- **AND** encoder/rotary drag actions preserve existing replacement-delta semantics rather than accumulating deltas in the browser backend, including replacement of the suffix after the final colon in action values
- **AND** double-click gestures can trigger portable push actions where the source node provides them

#### Scenario: Miniapp smoke proves generic reuse
- **WHEN** the miniapp Playwright browser smoke test runs
- **THEN** it uses the same browser runtime entry point and backend as the fake app
- **AND** it does not load miniapp-specific browser glue
