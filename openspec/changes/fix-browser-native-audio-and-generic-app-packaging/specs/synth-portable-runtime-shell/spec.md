## MODIFIED Requirements

### Requirement: sprs-8 — Browser audio: runtime-owned AudioWorklet callback
WHEN the Chrome static site starts audio for any conforming browser-hosted application, THE browser runtime SHALL require browser ABI v2, use a generic Emscripten Wasm AudioWorklet callback that invokes the C++ `Runtime<App>::Process` path against the same runtime/engine instance used by UI, MIDI, patch, and controller operations, register the host `AudioContext` acquired synchronously by catalog selection with the selected module before native callback startup, and SHALL NOT schedule DSP production through a timer, animation frame, message-loop cadence, ScriptProcessor, or JavaScript sample ring.

#### Scenario: No duplicated application runtime
- **WHEN** the browser audio path starts
- **THEN** it does not construct a second application or runtime instance inside JavaScript or an AudioWorklet
- **AND** it does not use concrete-application JavaScript, HTML, node IDs, actions, or layout

#### Scenario: One selection click starts the native callback
- **WHEN** a user selects a catalog application before its package has been downloaded
- **THEN** the synchronous selection handler creates and resumes one host audio context before awaiting package work
- **AND** after verification and module initialization the generic host registers that same context with the module and starts its native Wasm AudioWorklet
- **AND** no second user gesture or second audio context is required

#### Scenario: Missing native support fails closed
- **WHEN** a loaded runtime module does not expose compatible host-context registration and native AudioWorklet startup
- **THEN** launch fails with a diagnostic before reporting audio online
- **AND** the browser does not start timer-driven, ring-buffered, or otherwise degraded audio

#### Scenario: ABI v1 package is rejected
- **WHEN** a catalog package reports browser ABI v1 or changes the v2 context-aware start signature
- **THEN** compatibility negotiation rejects it before runtime creation
- **AND** the publisher must rebuild the package with the v2 generic browser boundary

#### Scenario: Allocation completes before callback startup
- **WHEN** an application requires Wasm heap allocation or growth during construction and initialization
- **THEN** those operations complete before its native AudioWorklet is started
- **AND** the real-time callback does not allocate or trigger memory growth

#### Scenario: Browser callback verification
- **WHEN** Chromium can be launched with the required host permissions
- **THEN** Playwright verifies every real first-party browser app starts the runtime-owned AudioWorklet callback from one catalog selection and observes advancing processed-block and finite deadline diagnostics
- **AND** the verification cannot pass by merely resuming a silent host context
