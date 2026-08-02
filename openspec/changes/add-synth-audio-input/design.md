## Context

Sheaf already has the outer shape of a portable input contract: `RuntimeConfig::numAudioInputs` is an application request, `AudioBlock` carries planar input pointers and an actual channel count, the JUCE host forwards device input buffers, and `SynthRig` allocates input storage. The current first-party applications request zero inputs, however, so there is no application-facing input idiom or system coverage. The browser runtime goes further in the opposite direction: it creates a native Wasm AudioWorklet node with zero input buses and hides input selection.

The All Electric Smart Grid provides the useful precedent. Its host requests eight inputs, copies one sample from each active planar channel into a fixed-capacity `AudioInputBuffer`, and passes that cross-channel sample frame through sample-oriented DSP. Missing channels are read as silence. Sheaf should preserve that ergonomic frame view and silence behavior without inheriting the fixed sixteen-channel ceiling or copying every channel for every sample.

This change crosses the JUCE-free application contract, JUCE runtime, browser activation and Web Audio graph, portable Audio page, test rig, and deployment security configuration. The audio callback must remain allocation-free and host APIs must stay outside application code.

The completed `add-browser-wasm-runtime` change has been reconciled and archived as the output-only browser runtime base. This change is logically downstream of that work and carries the input-aware deltas separately.

## Goals / Non-Goals

**Goals:**

- Let an application request any nonnegative practical number of logical input channels through `RuntimeConfig`, without a synth-framework fixed channel ceiling.
- Give application DSP zero-copy access to whole planar channels and to one cross-channel sample frame at a time.
- Preserve actual host channel visibility while offering an explicit safe read that returns silence for missing requested channels.
- Make zero-input applications incur no capture, permission, or input-graph work.
- Carry desktop and browser input through the same `AudioBlock` and `Engine<App>::ProcessBlock` path.
- Keep input capture separate from output; monitoring or effects routing is application DSP behavior.
- Provide deterministic multichannel input injection in `SynthRig` and automated browser input-flow coverage.

**Non-Goals:**

- Do not change Mini App or Braid 4 to request or process input in this change.
- Do not add automatic input monitoring, gain control, resampling, channel mixing, or semantic mono/stereo source routing to the framework.
- Do not aggregate channels from multiple simultaneous physical input devices.
- Do not add named browser output selection or browser `AudioContext.setSinkId()` behavior.
- Do not require named browser input-device persistence in the first input implementation; System Default input is sufficient.
- Do not change the app-owned output-buffer writing contract.

## Decisions

### D0 — Reconcile and archive the browser-runtime base first

Before source implementation for this change begins, the completed `add-browser-wasm-runtime` change will be corrected to describe the shipped native callback-only AudioWorklet architecture, renumbered so all of its requirement IDs are unique, strictly validated, and archived to establish `synth-browser-wasm-runtime` as a base capability. Its `synth-app-runtime` requirements become `sar-27` through `sar-30`, and its `synth-runtime-ui` requirements become `sru-56` through `sru-58`. This change then uses `sar-31` and `sar-32` for its new application-runtime requirements and modifies the archived `sar-30` device-catalog contract.

The base reconciliation removes stale architecture language and renumbers requirements only. It does not forward-port input-aware catalog behavior; the `sar-30` modification in this change is the single source of truth for that behavior.

This is a hard sequencing precondition rather than a final cleanup step: implementation tasks after 1.1 do not begin until the base archive succeeds and the composed main specs validate.

### D1 — Keep the application-declared count dynamic and host-neutral

`RuntimeConfig::numAudioInputs` remains an integer supplied by the application. A shared JUCE-free validator throws `std::invalid_argument` before engine/device initialization for negative counts; C/JavaScript host boundaries translate that failure into a startup diagnostic. The synth framework introduces no small compile-time maximum. The JUCE host accepts every nonnegative value representable by the configuration integer and reports device negotiation failure or shortfall. The browser host defines `kMaxBrowserInputChannels = 32`, matching its bounded callback pointer storage, and rejects larger requests before capture or AudioWorklet startup.

The declared count is the number of logical channels the application is prepared to address. Each callback also reports the active count, clamped to the declared count. A device that supplies more channels does not silently expand the application's input shape.

Alternative considered: template the application or audio block on an input count. That would make fixed-channel DSP convenient but would unnecessarily make host/runtime types depend on audio topology and complicate dynamic device negotiation.

### D2 — Add zero-copy block and frame views instead of copying Smart Grid's buffer

The JUCE-free contract will expose an `AudioInputView` backed by the existing planar `const float* const*`, active channel count, requested channel count, and frame count. `AudioBlock` retains its existing public `inputs` and `numInputChannels` fields and adds view factories, preserving source compatibility. The view provides:

- a contiguous read-only span for an active channel;
- a lightweight frame view that retains the planar pointers plus one frame index;
- strict active-channel access for callers that have checked the negotiated count; and
- explicitly named `SampleOrSilence(channel, frame)`/frame-equivalent access that returns zero for a missing requested channel.

Views are non-owning, valid only for the current callback, trivially copyable, contain no owning storage, and construct without allocation or sample copying. Strict channel access has a documented precondition that the channel index is below the active count and its pointer is non-null. `SampleOrSilence` treats an out-of-active-range channel, a null channel pointer, or an out-of-frame-range sample as silence. Output access remains separate and mutable. A zero-input block has `inputs == nullptr`, `numInputChannels == 0`, and an empty input view.

Alternative considered: port Smart Grid's fixed `float[16]` sample snapshot. That is simple, but imposes an arbitrary ceiling and copies every active channel per frame even when block-oriented DSP could consume planar buffers directly.

### D3 — Treat shortfall as observable silence, not fatal startup

If the selected device or permission state provides `M < N` active channels, the app receives `numInputChannels == M`; strict access is limited to those channels and `SampleOrSilence` yields zero for channels `M..N-1`. The host publishes a clear `requested N / active M` status. Output processing continues.

This matches Smart Grid's safe missing-channel behavior and permits generator-plus-input applications to remain useful when an input disappears. It does not conceal the mismatch because the actual count and status are observable.

Alternative considered: fail all audio unless exactly `N` channels open. That is useful for installations where every channel is mandatory, but it makes transient permission/device loss stop unrelated output. A later application policy could opt into exact-count startup without changing the buffer contract.

### D4 — JUCE continues to own native device negotiation

The desktop runtime requests the application's count through `AudioDeviceManager`, exposes input selection only when `N > 0`, forwards at most `N` callback pointers, and reports negotiated input/output counts. A null pointer inside JUCE's counted range preserves its logical channel position and is treated as unavailable by the safe accessor rather than compacted. Device changes retain the existing callback stop/prepare/restart behavior. The application never sees JUCE types.

No framework scratch copy is needed on the normal JUCE path: the `AudioInputView` points at callback-owned planar buffers. Missing logical channels are synthesized by safe access rather than materialized zero buffers.

An input-capable macOS application bundle includes `NSMicrophoneUsageDescription`; sandboxed/hardened distributions that require it also include the audio-input entitlement. Permission denial or an unavailable device produces zero/short input with a diagnostic while independent output continues. Zero-input applications do not open input and do not trigger the system prompt.

### D5 — Browser capture joins the existing native AudioWorklet graph

Browser startup continues to use the one `AudioContext` created or resumed from user activation. For `N == 0`, the Wasm AudioWorklet node has zero input buses and the host never calls `getUserMedia()`.

For `N > 0`, after the activation-initiated launch path loads the module and discovers its request, the browser host requests a System Default media stream using `{ audio: { channelCount: { ideal: N }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }`, creates a `MediaStreamAudioSourceNode`, and connects it to one input bus on the existing native Wasm AudioWorklet node. The node uses `numberOfInputs = 1`, `channelCount = N`, explicit channel-count mode, and discrete interpretation; its existing output channel configuration is unchanged. This can make the callback bus contain padded silent channels, so every registered input source carries an active physical channel count beside its node handle: capture uses `MediaStreamTrack.getSettings().channelCount`, a test-registered node supplies its explicit fixture count, and a capture track that omits the setting falls back to the source node's positive `channelCount` or one while reporting an `unreported channel count` diagnostic. The control path clamps the chosen value to `N` and publishes it atomically. The Emscripten callback clamps its input pointer count to the minimum of the bus count, published physical count, and `N`, then passes those pointers beside the existing output pointers to `Runtime<App>::Process`, which constructs one complete `AudioBlock`.

Permission requests, stream/device lifecycle, DOM interaction, and Audio page updates remain outside the realtime callback. The callback performs only bounded pointer adaptation, atomic state reads, engine processing, metering, and failure-to-silence output handling. Input is not connected directly to `AudioContext.destination`. Permission denial or stream loss leaves a visible `Retry Input` action; invoking it re-runs capture and reconnects the source to the existing context/worklet/engine/app instance. No automatic or realtime retry loop exists.

Alternative considered: copy browser input through a JavaScript/`SharedArrayBuffer` ring. The runtime now deliberately uses a native callback-only output path; a second transport would add latency, synchronization, and a divergent engine pump without benefit when the native callback already receives Web Audio input frames.

### D6 — Browser input is System-Default-only initially

When an app requests input, the Audio page exposes a System Default input option, permission/channel status in its existing status line, and `Retry Input` while offline; it does not enumerate or persist named browser input devices in this change. System Default input selection commits the existing empty `AudioDeviceState::inputDeviceName`, and any other browser input option id is rejected. This avoids prematurely mapping the existing name-oriented `AudioDeviceState` onto privacy-scoped browser device IDs. Device enumeration and stable selection can be added later without changing the app input-count or view contracts.

Output remains the existing System-Default-only choice. Selecting or displaying either default does not imply automatic monitoring.

### D7 — Headless injection is planar, bounded, and deterministic

`SynthRig` owns `N` input channels sized to its configured block, initializes them to silence, and offers test helpers to set a channel, sample, frame, or complete block with explicit size validation and transactional whole-shape validation before mutation. Existing `RunSamples` whole-block rounding semantics remain unchanged. Tests can change input between blocks; the rig does not race producers because it remains single-threaded.

The generic fake application used for contracts will request multiple inputs and explicitly copy or transform selected samples to output. This proves transport without changing either first-party synth.

### D8 — Security and failure states are part of the host contract

Browser hosting policy includes `microphone=(self)` alongside existing MIDI policy. Capture requires a secure context. Permission denial, unavailable APIs, stream interruption, and channel shortfall are distinct observable states. Denial or loss removes active input, supplies silence through the application accessor, exposes user-initiated retry, and leaves output/UI/MIDI running when their own requirements are satisfied.

## Risks / Trade-offs

- Browser implementations or hardware may downmix or expose fewer channels than requested → use explicit/discrete graph configuration where available, report actual channels, test mono/stereo/multichannel fakes, and provide safe silence for the remainder.
- A safe silence accessor can hide an accidentally unplugged interface from DSP code → expose actual counts and a prominent runtime Audio status in addition to the safe read.
- Microphone permission can delay activation or be denied → request only for input apps, keep permission work outside the callback, and allow output to continue with an explicit input-offline state.
- Adding named input devices now would entangle privacy-scoped browser IDs with name-based persistence → limit the first browser implementation to System Default input.
- A retained frame/channel view would dangle after its callback → document callback lifetime, keep views trivially non-owning, and add tests/static constraints that discourage ownership.
- Feedback is possible when an application deliberately monitors a live microphone to speakers → provide no automatic passthrough and leave gain/monitoring decisions explicit in application DSP.
- Browser base/delta sequencing can regress if future sync work skips the archived callback-only base → keep D0 as the hard precondition and validate the final composed specification before syncing or archiving this delta.

## Migration Plan

1. As a hard precondition, reconcile, validate, and archive the completed `add-browser-wasm-runtime` delta with the current callback-only implementation and establish `synth-browser-wasm-runtime` as the base capability before source implementation of this change.
2. Add the JUCE-free input views, validation, and contract tests while preserving existing `AudioBlock` fields and output-only application source compatibility.
3. Extend `SynthRig` input ownership/injection and prove multichannel input-to-output behavior through a generic fake app.
4. Wire and test requested/actual input semantics and diagnostics in the JUCE runtime.
5. Add browser permission/stream orchestration, native AudioWorklet input adaptation, default-input Audio page state, and hosting policy.
6. Run core synth, JUCE, browser unit, and real-Wasm Playwright suites; update coverage and browser hosting documentation.

Rollback can disable/remove browser stream creation and input-bus wiring while leaving the additive JUCE-free views unused. Existing apps remain output-only throughout, so desktop and browser output behavior has a direct fallback.

## Open Questions

- Whether an application should later be able to declare an exact-count/fail-closed policy in addition to the initial available-count-plus-silence behavior.
- Whether browser named-input selection should use origin-scoped `deviceId` persistence or a best-effort label match when that follow-up is designed.
