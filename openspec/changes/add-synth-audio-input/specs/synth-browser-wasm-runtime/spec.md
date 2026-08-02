## MODIFIED Requirements

### Requirement: sbw-4 — Audio: Web Audio and AudioWorklet bridge
WHEN browser audio is started on a launch path initiated by user activation, THE browser runtime SHALL create or resume the launch-owned `AudioContext`, prepare the engine with the context's negotiated sample rate and actual render quantum, install one native Wasm `AudioWorkletProcessor` that invokes the shared engine block pump exactly once per callback, and connect its output to `AudioContext.destination`; THE browser output catalog SHALL expose exactly one `System Default` option with id `system_default` whose selection commits the existing empty persisted output-device name. WHERE the application requests zero inputs, THE host SHALL create zero worklet input buses and SHALL NOT request microphone permission; WHERE the application requests `N` inputs from 1 through the browser limit of 32, THE host SHALL discover `N` after module load, request System Default media with `channelCount: { ideal: N }` and echo cancellation, noise suppression, and automatic gain control disabled, connect its source to one explicit/discrete worklet input bus, publish outside the callback an active physical count supplied with the registered source, adapt the callback's planar input and output frames into one JUCE-free `AudioBlock`, expose at most the minimum of bus channels, published physical channels, and `N`, and report permission, stream, and requested-versus-active status through the portable Audio page. Capture sources SHALL derive the published count from `MediaStreamTrack.getSettings().channelCount`; test-registered sources SHALL supply an explicit count with their node handle; and an omitted capture setting SHALL fall back to the source node's positive `channelCount` or one and SHALL report a distinct unreported-count diagnostic. Input SHALL NOT be connected directly to output, and input failure or loss SHALL leave independent output/UI/MIDI operation running with zero active input channels and safe missing-channel silence.

#### Scenario: User activation starts audio
- **WHEN** the user activates the browser runtime start action
- **THEN** the browser shell creates or resumes the `AudioContext`
- **AND** capture and output do not attempt to autoplay before that activation

#### Scenario: Output-only app does not request microphone permission
- **WHEN** an application's runtime config requests zero audio inputs
- **THEN** the native AudioWorklet node is created with zero input buses
- **AND** the browser host does not call `getUserMedia()`
- **AND** callback-only output continues through the shared engine instance

#### Scenario: Input-capable app connects capture to native processing
- **WHEN** an application's runtime config requests `N > 0` inputs and System Default capture permission is granted
- **THEN** the browser host creates a media-stream source and connects it to one native AudioWorklet input bus configured for the requested channel shape
- **AND** the callback forwards the actual input frame pointers and output frame pointers through one `AudioBlock` to the shared engine instance

#### Scenario: Input node preserves the requested discrete shape
- **WHEN** an input-capable application creates its native worklet node
- **THEN** the node uses one input bus, `channelCount = N`, explicit channel-count mode, and discrete channel interpretation
- **AND** its existing output bus count, output channel counts, and destination connection are unchanged

#### Scenario: Browser voice processing does not force mono
- **WHEN** the host requests System Default media for an input-capable application
- **THEN** it uses an ideal rather than exact channel-count constraint
- **AND** it disables echo cancellation, noise suppression, and automatic gain control
- **AND** a device shortfall remains non-fatal and observable

#### Scenario: Callback uses actual frame and channel counts
- **WHEN** the native AudioWorklet callback receives an input or output frame shape different from a preferred application block size or requested input count
- **THEN** the runtime uses the callback's actual frame count and clamps input pointers to the minimum of callback bus channels, the atomically published physical track count, and the application request
- **AND** monotonic output sample position advances exactly by the processed output frame count
- **AND** safe reads of requested but inactive input channels return silence

#### Scenario: Permission denial leaves output running
- **WHEN** microphone permission is denied or capture APIs are unavailable for an input-capable application
- **THEN** the Audio page reports the specific input-unavailable state
- **AND** audio blocks expose zero active inputs with safe missing-channel silence
- **AND** output, UI, persistence, and MIDI continue when their own requirements are satisfied

#### Scenario: Capture loss is observable
- **WHEN** an established media track ends or the input graph becomes unavailable
- **THEN** the runtime releases the failed capture path and reports input offline
- **AND** subsequent blocks expose zero active inputs without retaining stale samples
- **AND** the output callback remains active

#### Scenario: User retries input without replacing the app
- **WHEN** permission was denied or an established stream ended and the user activates `Retry Input`
- **THEN** the host re-runs capture and reconnects the replacement source to the existing AudioContext and native worklet input bus
- **AND** it does not recreate the engine, application, or shared runtime instance
- **AND** no retry is initiated from the realtime callback

#### Scenario: Audio page exposes default devices
- **WHEN** the browser runtime Audio page asks the host for device choices
- **THEN** the host returns exactly one output option labeled `System Default` with option id `system_default`
- **AND** an input-capable application receives one System Default input option plus permission and active-channel status
- **AND** a zero-input application receives `showInputCombo == false` and an empty input option list
- **AND** an offline input-capable application receives permission/requested/active status plus a visible `Retry Input` action

#### Scenario: Default input persistence stays host-neutral
- **WHEN** the user selects the browser System Default input
- **THEN** the generic selection path commits the existing empty persisted input-device name
- **AND** the browser provider rejects any input option id other than `system_default`

#### Scenario: Input is not implicitly monitored
- **WHEN** browser capture supplies nonzero input and application DSP leaves it unused
- **THEN** no input samples reach `AudioContext.destination` through a host-created bypass
- **AND** only application-written output is audible

#### Scenario: Realtime callback avoids browser control APIs
- **WHEN** an audio render quantum is processed
- **THEN** the native callback performs bounded pointer adaptation, engine processing, output metering, and failure-to-silence handling only
- **AND** it does not call DOM, permission, media-device enumeration, IndexedDB, Web MIDI device, or UI command-buffer APIs

## ADDED Requirements

### Requirement: sbw-10 — Security: microphone permission and hosting policy
WHEN an input-capable browser synth is hosted, THE deployment and runtime SHALL require a secure context, permit same-origin microphone use through `Permissions-Policy`, request capture only on a launch or retry path initiated by user activation and never on page load or autoplay, and distinguish denied permission, unavailable capture API, ended stream, and channel shortfall without exposing media samples or device-private data to persistence, logs, or the UI command buffer.

#### Scenario: Hosting policy permits same-origin capture
- **WHEN** the production browser artifact is generated
- **THEN** its security headers include a same-origin microphone permissions policy alongside the existing cross-origin isolation and MIDI policy
- **AND** output-only applications remain launchable without granting microphone permission

#### Scenario: Insecure or blocked capture is diagnosed
- **WHEN** an input-capable application launches where secure-context or microphone-policy requirements are not met
- **THEN** the runtime reports the missing prerequisite by name
- **AND** it does not repeatedly prompt or enter a capture retry loop from the realtime callback

#### Scenario: Captured samples remain realtime-only
- **WHEN** browser input samples pass through the audio callback
- **THEN** the runtime does not write those samples to IndexedDB, logs, catalog metadata, or UI command buffers
- **AND** only application DSP receives the non-owning callback view

### Requirement: sbw-11 — Verification: browser audio input coverage
WHEN browser audio input support is implemented, THE synth browser suite SHALL exercise zero-input and input-capable generic applications through unit and real-Wasm Chrome tests, including permission grant and denial through media-device fixtures, deterministic mono, stereo, and greater-than-two-channel signals through a test-only registered Web Audio source, multichannel shortfall, stream loss, no implicit monitoring, deterministic input-to-output transformation, and continued output after input failure.

#### Scenario: Real Wasm input reaches shared application instance
- **WHEN** the Playwright fixture registers a deterministic multichannel Web Audio source with a real Wasm application
- **THEN** the application observes the signal through its portable input view
- **AND** its expected transformed output is observed from the same runtime instance used for UI and lifecycle operations

#### Scenario: Registered source publishes its fixture shape
- **WHEN** a test registers an `N`-channel deterministic Web Audio node and supplies physical count `N`
- **THEN** the native callback exposes `active == N` when the bus and application request also contain `N` channels
- **AND** no `MediaStreamTrack` is required for the deterministic signal fixture

#### Scenario: Output-only regression coverage observes no prompt
- **WHEN** existing Mini App and Braid 4 browser smokes launch with zero requested inputs
- **THEN** neither launch requests microphone permission or constructs an input source
- **AND** their existing non-silent output and deadline checks continue to pass

#### Scenario: Failure matrix remains live
- **WHEN** permission denial, insufficient channels, or stream termination is injected
- **THEN** the test observes the matching Audio page diagnostic and safe input silence
- **AND** it verifies that the output callback and non-audio runtime functions remain live
