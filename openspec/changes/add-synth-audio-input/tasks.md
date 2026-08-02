## 1. Specification Dependency And Contract Baseline

- [ ] 1.1 Before source implementation, reconcile the completed `add-browser-wasm-runtime` change with the shipped callback-only audio path: replace stale worker/ring and worker-negotiated-block language in `sbw-4`, `sbw-8`, and its host-callback requirement; renumber its `sar-22..25` to `sar-27..30` and `sru-21..23` to `sru-56..58` without forward-porting this change's input-aware catalog behavior; strictly validate it; archive it to establish the base `synth-browser-wasm-runtime` capability; then validate main specs and this change with its new requirements fixed at `sar-31` and `sar-32`.
- [ ] 1.2 Add failing JUCE-free validation tests proving negative input counts throw `std::invalid_argument` before initialization, JUCE accepts a 17-channel representable request, and the browser accepts 32 but rejects 33 with an explicit startup diagnostic.
- [ ] 1.3 Add failing input-view behavior tests for active-count clamping, exact zero-input null/empty state, channel/frame sample equivalence, strict bounds/preconditions, null-channel safety, and missing-channel or invalid-frame safe silence.
- [ ] 1.4 Implement shared runtime-config validation and additive `AudioBlock::InputView()` block/frame accessors while retaining existing public input/output fields and performing no allocation or sample copy.
- [ ] 1.5 Add source-boundary and compile-time coverage proving the input views remain JUCE-free, trivially copyable, bounded-size/non-owning, documented as callback-lifetime-only, and usable by both core-only and full `SynthApplication` types.

## 2. Headless Input Injection

- [ ] 2.1 Add failing `SynthRig` tests for default silent declared inputs, validated channel/sample/frame/block injection, rejected shape mutations with no partial write, preserved whole-block `RunSamples` semantics, and distinct multichannel ordering through the production engine pump.
- [ ] 2.2 Add deterministic transactional injection and clear helpers to the rig's existing preallocated planar input storage, preserving no allocation during `RunBlocks`, `RunSamples`, or `RunSeconds`.
- [ ] 2.3 Add a generic JUCE-free input probe application that requests multiple channels, exercises both block and frame access, explicitly transforms selected input into output, and proves that unused input is not implicitly monitored.

## 3. JUCE Desktop Host

- [ ] 3.1 Add failing JUCE runtime tests for zero-input startup, a 17-channel requested input count, actual-count clamping, null counted-channel handling, requested-versus-active status, input-device selector visibility, missing-device/permission continuation, and input/output isolation.
- [ ] 3.2 Update the JUCE runtime to validate and request the application input count, forward at most that many actual callback pointers, preserve actual count negotiation across device switches, and publish clear requested/active input diagnostics.
- [ ] 3.3 Verify input selection and runtime-configuration restore continue to reopen only host devices, reprepare the engine before callbacks resume, and leave application code free of JUCE types.
- [ ] 3.4 Add and verify `NSMicrophoneUsageDescription` for input-capable macOS bundles and the audio-input entitlement where the distribution sandbox/signing profile requires it; document that zero-input applications do not open input or trigger the system prompt.

## 4. Browser ABI And Native AudioWorklet

- [ ] 4.1 Add failing C++ browser-runtime tests for requested-input discovery, zero-input null handling, 32-channel acceptance/33-channel rejection, and monotonic sample advancement by the actual callback frame count.
- [ ] 4.2 Add failing native callback tests for planar input/output processing, active-count clamping to `min(bus, published physical, requested)`, null/missing-input silence, and stale-count clearing after capture loss.
- [ ] 4.3 Extend the browser runtime facade and Wasm ABI with requested-input discovery, published physical-channel state, and optional registered input-source startup data carrying both node handle and positive physical channel count; bump/validate the relevant ABI contract and update export/scaffold/fake-module coverage.
- [ ] 4.4 Extend `Runtime<App>::Process` and the native Emscripten callback to construct one complete `AudioBlock` from actual input/output `AudioSampleFrame` values using preallocated 32-channel pointer storage, atomic physical-count reads, and no realtime allocation.
- [ ] 4.5 Create the native AudioWorklet node with zero input buses for zero-input apps or `numberOfInputs=1`, `channelCount=N`, explicit count mode, and discrete interpretation for input-capable apps; connect the registered media source only after node creation succeeds and retain unchanged output bus/destination wiring.
- [ ] 4.6 Add callback failure and capture-loss handling that clears stale physical/input visibility, silences output only for processing failures, updates diagnostics outside browser control APIs, and keeps the engine/output callback live.

## 5. Browser Capture, Audio Page, And Lifecycle

- [ ] 5.1 Add failing TypeScript/browser tests proving zero-input apps never call `getUserMedia()`, while input-capable apps request System Default capture only after the activation-initiated launch path loads the module and reports `N > 0`, using `channelCount: { ideal: N }` with echo cancellation, noise suppression, and automatic gain control disabled.
- [ ] 5.2 Extend `AudioBridge` and the runtime facade to query the application input request, acquire a `MediaStream`, derive and publish a positive physical count from `MediaStreamTrack.getSettings().channelCount` or the source node's count/one fallback, create/register its `MediaStreamAudioSourceNode`, and pass the registered node plus count into native worklet startup without adding JavaScript DSP or a sample-ring fallback.
- [ ] 5.3 Implement and test idempotent teardown for media tracks, source nodes, AudioContext registration, failed startup, app replacement, and page unload.
- [ ] 5.4 Implement and test distinct permission-denied, API-unavailable, insecure/policy-blocked, stream-ended, unreported-channel-count fallback, and requested/active-shortfall states, including stale active-count clearing while output remains live.
- [ ] 5.5 Add a user-initiated `Retry Input` path that reacquires and reconnects capture to the existing AudioContext/worklet/engine/app instance without any automatic or realtime retry loop.
- [ ] 5.6 Update browser audio services and the portable Audio page to hide input controls/status/retry for zero-input apps and expose one System Default input plus permission and `requested N / active M` status for input-capable apps; System Default selection commits the empty persisted name, other ids are rejected, and Retry Input appears only while offline.
- [ ] 5.7 Update published/local hosting headers and documentation with `Permissions-Policy: microphone=(self)`, secure-context requirements, capture privacy guarantees, input shortfall/retry behavior, and the absence of automatic monitoring or named input selection.

## 6. Browser End-To-End Verification

- [ ] 6.1 Add browser media-device fixtures for permission grant/denial, omitted `getSettings().channelCount`, and ended tracks, plus a test-only registered `ChannelMergerNode` source that supplies its explicit physical count with distinct deterministic mono, stereo, and greater-than-two-channel signals and controllable channel shortfall, without using developer hardware.
- [ ] 6.2 Build a generic real-Wasm input probe app/fixture and add Playwright coverage proving its captured samples reach the same shared application instance and produce the exact explicit input-to-output transformation.
- [ ] 6.3 Add Playwright failure-matrix coverage proving permission denial, shortfall, and stream termination produce the correct Audio page status and safe silence while output callbacks, UI frames, persistence, and MIDI remain live.
- [ ] 6.4 Extend Mini App and Braid 4 browser regression tests to assert that their zero-input launches request no microphone permission, construct no media source, and retain existing non-silent output/deadline behavior.

## 7. Full Verification And Documentation

- [ ] 7.1 Add an `audio_input_tests` binary/target to `projects/synth/Makefile` for JUCE-free contract/view/rig coverage, extend the existing `browser-unit-test` and `browser-audio-device-test` targets for native browser/ABI/device coverage, and add named Playwright audio-input specs; run all focused targets and resolve failures without weakening requested/actual or no-monitoring contracts.
- [ ] 7.2 Run `make -C projects/synth test`, the JUCE runtime/application test targets used by the synth build, `make -C projects/synth/browser test`, `make -C projects/synth/browser browser-apps`, and `make -C projects/synth/browser browser-apps-smoke` including the real-Wasm Chrome suite.
- [ ] 7.3 Update `projects/synth/docs/coverage.md`, browser runtime documentation, and any app-author contract documentation with test mappings, block/frame input examples, lifetime rules, platform limits, permission behavior, and explicit input-to-output routing.
- [ ] 7.4 Validate the composed OpenSpec change, confirm the browser base/delta sequencing is archive-safe, and perform final source scans for forbidden JUCE/browser APIs in application code, realtime allocation, JavaScript DSP/ring fallbacks, unintended `getUserMedia()` calls, and automatic input monitoring.
