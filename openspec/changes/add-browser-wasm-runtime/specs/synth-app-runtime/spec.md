## ADDED Requirements

### Requirement: sar-22 — Hosts: compile-time swappable runtime shells
WHEN a synth application is hosted by a platform runtime, THE synth runtime architecture SHALL allow multiple compile-time runtime shells to instantiate the same `synth::Engine<App>` and `synth::SynthApplication` type without changing application source; each host shell SHALL own only platform integration for audio devices, MIDI devices, UI presentation, persistence mounting, timers, and process/window lifecycle, while engine, application, patch, parameter, MIDI-processor, and portable UI semantics remain shared.

#### Scenario: Same app type binds to multiple hosts
- **WHEN** a conforming application type is named by the JUCE runtime entry point and by the browser runtime entry point
- **THEN** both targets compile against the same application headers
- **AND** neither target requires app-specific runtime glue outside the generic host binding

#### Scenario: Host-specific APIs stay in host paths
- **WHEN** runtime host sources are inspected
- **THEN** JUCE APIs appear only in JUCE-owned host/backend paths
- **AND** browser APIs or JavaScript bindings appear only in browser-owned host/backend paths
- **AND** synth application sources include neither host API family

### Requirement: sar-23 — Hosts: application portability gate
WHEN a new runtime host is implemented for synth applications, THE implementation SHALL prove that at least one fake application and each targeted concrete application satisfy the generic `SynthApplication` contract without host-specific code; IF a targeted concrete application cannot be hosted without app-specific runtime/backend logic, THEN implementation SHALL stop and document the missing generic contract rather than adding the special case.

#### Scenario: Fake app proves generic host path
- **WHEN** host conformance tests instantiate a fake application with config, init, process-block, and portable-surface hooks
- **THEN** the host compiles and drives the fake application through the same generic runtime path used for concrete apps

#### Scenario: Concrete app portability failure blocks implementation
- **WHEN** the browser host attempts to run the miniapp or any other concrete app and discovers a required operation that is not expressible through `AppContext`, `Engine`, MIDI profile factories, patch/config APIs, or `synth::ui::Surface`
- **THEN** the browser change is considered blocked
- **AND** no app-specific browser branch is added

### Requirement: sar-24 — Audio: host-owned device callback abstraction
WHEN a non-JUCE runtime host provides audio, THE host SHALL adapt its platform audio callback or render-ahead bridge into the JUCE-free `AudioBlock` contract, call `Engine<App>::Prepare` with the platform-negotiated sample rate and engine render block size before the first processed block, call `Engine<App>::ProcessBlock` exactly once for each engine-rendered block, and preserve monotonic sample-position semantics independent of the platform's native callback representation.

#### Scenario: Browser host uses negotiated Web Audio values
- **WHEN** the browser runtime starts its Web Audio bridge
- **THEN** the engine has been prepared with the `AudioContext` sample rate and the worker-negotiated engine render block size
- **AND** the app receives a JUCE-free `AudioBlock`

#### Scenario: Host callback does not own DSP
- **WHEN** any platform host processes an audio block
- **THEN** the host performs platform buffer adaptation and delegates to the engine/app block path
- **AND** it does not call app DSP modules or parameter processing directly

### Requirement: sar-25 — Audio: host-provided device catalog
WHEN the runtime Audio page needs audio device choices, THE synth runtime architecture SHALL obtain those choices from the active host shell through a generic audio-device catalog interface, so JUCE hosts may expose enumerated native devices while browser hosts may expose only the existing "System Default" option without changing application logic, runtime page logic, or patch/runtime configuration semantics.

#### Scenario: Browser host provides System-Default-only output catalog
- **WHEN** the Audio page is hosted by the browser runtime
- **THEN** the page receives exactly one output option labeled "System Default" with option id `system_default`
- **AND** selecting it commits the existing empty persisted output-device name
- **AND** the page receives `showInputCombo == false` and an empty `inputOptions` list

#### Scenario: JUCE host keeps native device enumeration
- **WHEN** the Audio page is hosted by the JUCE runtime
- **THEN** the page can continue to list host-enumerated output devices
- **AND** the application source does not branch on the active host
