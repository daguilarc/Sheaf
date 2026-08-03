## ADDED Requirements

### Requirement: sar-31 — Audio: requested inputs and portable views
WHEN an application declares a `RuntimeConfig::numAudioInputs` value `N`, THE synth runtime SHALL reject negative values before engine or device startup, accept any representable nonnegative value on JUCE and any value up to the browser host's explicit 32-channel limit, request `N` logical input channels from the active host, expose no more than `N` active channels in each `AudioBlock`, and provide JUCE-free trivially-copyable non-owning input views for contiguous channel blocks and cross-channel sample frames without allocation, ownership, or sample copying; the block SHALL expose the actual active channel count, strict access SHALL require an active non-null channel, explicitly safe access SHALL return silence for a missing channel, null channel pointer, or invalid frame, and callers SHALL NOT retain any view beyond its callback.

#### Scenario: Negative input request is rejected uniformly
- **WHEN** any host or `SynthRig` encounters an application config with a negative input count
- **THEN** the shared JUCE-free validation raises `std::invalid_argument` before engine preparation, device opening, capture, or AudioWorklet startup
- **AND** a C or JavaScript ABI boundary translates that failure into an explicit startup diagnostic

#### Scenario: Multichannel request has no framework ceiling
- **WHEN** a conforming application requests 17 input channels
- **THEN** the JUCE-free application/runtime contract accepts the count without imposing a synth-framework fixed-array maximum
- **AND** JUCE accepts the representable request while the browser accepts requests through 32 and rejects 33 or more with an explicit platform-limit diagnostic before capture or audio starts

#### Scenario: Channel and frame views address the same samples
- **WHEN** a block contains distinct finite samples across multiple input channels and frames
- **THEN** reading sample `(channel, frame)` through the channel-block view and through the cross-channel frame view returns the same underlying value
- **AND** constructing or reading either view performs no allocation or input-buffer copy

#### Scenario: Input views are structurally non-owning
- **WHEN** contract checks inspect the input block and frame view types
- **THEN** each type is trivially copyable, contains no owning storage, and has a bounded size independent of channel or frame count
- **AND** its documentation marks the view invalid after the callback returns

#### Scenario: Device exposes fewer channels than requested
- **WHEN** an application requests `N` inputs and the active host provides `M < N` channels
- **THEN** `AudioBlock::numInputChannels` reports `M`
- **AND** strict access is available for non-null channels `0..M-1`
- **AND** strict access to a counted null channel is a documented precondition violation rather than a defined sample return
- **AND** explicitly safe access for channels `M..N-1` returns zero
- **AND** the host reports a requested-versus-active channel diagnostic while output processing continues

#### Scenario: Counted null channel is safe silence
- **WHEN** a host reports a channel inside the counted input range with a null sample pointer
- **THEN** its logical channel position is preserved
- **AND** strict access documents that the channel is unavailable
- **AND** explicitly safe access returns zero without dereferencing the pointer

#### Scenario: Extra device channels are not injected
- **WHEN** the selected device exposes more active channels than the application-requested count
- **THEN** the application block exposes only the first requested number of logical input channels
- **AND** changing hardware does not silently expand the application's input shape

#### Scenario: Zero-input application does not capture
- **WHEN** an application declares zero audio inputs
- **THEN** the active host opens or constructs no input path for that application
- **AND** the application receives a block with `inputs == nullptr`, zero active input channels, and an empty input view

#### Scenario: Input is not implicitly monitored
- **WHEN** nonzero samples arrive on an active input and application DSP does not copy or otherwise incorporate them into output
- **THEN** the runtime leaves output determined solely by application output writes
- **AND** the host creates no direct input-to-output monitoring path

### Requirement: sar-32 — Test rig: deterministic multichannel audio input
WHEN JUCE-free system tests exercise an input-capable synth application, THE `SynthRig` SHALL allocate block-sized planar storage for the application's declared input count before processing begins, initialize it to silence, provide validated helpers for deterministic channel, frame, sample, and complete-block injection without adding allocations beyond the rig's existing capture-vector path, and pass the configured input through the production `Engine<App>::ProcessBlock` path without allocating in the block pump.

#### Scenario: Rig is silent until input is injected
- **WHEN** an input-capable rig runs before a test supplies samples
- **THEN** every declared input channel reads as zero
- **AND** the app still observes the declared rig input storage through the production audio-block contract

#### Scenario: Injected channels reach application DSP
- **WHEN** a test injects distinct sample sequences into multiple rig input channels and runs one block
- **THEN** the application receives those sequences with the same channel and frame ordering
- **AND** an application that explicitly transforms them into output produces the expected transformed output

#### Scenario: Invalid injection is rejected before processing
- **WHEN** a test attempts to inject a channel, frame, or block shape outside the rig's configured input dimensions
- **THEN** the helper rejects the operation deterministically
- **AND** no partial input mutation reaches the next processed block

## MODIFIED Requirements

### Requirement: sar-6 — Audio: device ownership and block delegation
WHEN audio is running, THE runtime SHALL own the JUCE audio device and its callback, and per device block SHALL apply pending patch messages (using an engine-owned preallocated patch serialization context whose arena growth and retry are owned by the message thread), process the UI and MIDI message buses into the parameter manager and runtime-owned master clock, commit one immutable affine `ClockBlockPlan` over the block's monotonic half-open output-sample range, analytically enqueue that plan's enabled MIDI clock crossings, and call the application's block-processing function exactly once with a JUCE-free audio block view exposing input pointers, output pointers, the actual output channel count, the host-observed active input count clamped to the application's requested count, frame count, monotonic starting output-sample index, and a non-owning pointer to the exact committed clock plan also returned by `MasterClock::CurrentPlan()`; zero-input blocks SHALL expose null input storage, and the plan pointer SHALL remain valid through the callback. THE runtime SHALL NOT use host audio block boundaries as the steady-state parameter target recomputation cadence, SHALL NOT call `Process` on any application DSP module, and SHALL NOT perform per-sample parameter processing — application per-sample work (parameter target refresh through the parameter system's configured sample interval, parameter `ProcessLite`, modulation-source updates, module processing, output writes) SHALL be owned by the application's block-processing function. Runtime clock work SHALL remain output-block-rate plus enumerated musical crossings, and applications SHALL obtain sample-accurate clock values by direct integer-or-fractional output-sample queries rather than advancing runtime time.

#### Scenario: Runtime commits clock then delegates
- **WHEN** an audio device block is processed
- **THEN** queued patch, UI, and MIDI messages are applied before the clock plan is committed and enabled crossings are enqueued
- **AND** the application's block-processing function is called exactly once with that immutable plan

#### Scenario: Control edits slew rather than snap
- **WHEN** an encoder message changes a parameter target while audio runs
- **THEN** the parameter's audible value approaches the new target through the parameter system's per-sample processing and `ProcessLite` slewing over subsequent samples rather than jumping in one block

#### Scenario: Application owns per-sample DSP processing
- **WHEN** the application's block-processing function runs
- **THEN** application module processing, per-sample parameter processing, and modulation-source updates are invoked by application code, not by runtime code
- **AND** the runtime-provided clock plan requires no application call to advance global time

#### Scenario: Clock plan is JUCE-free
- **WHEN** the application's block-processing code is compiled in a JUCE-free translation unit
- **THEN** the audio block and clock plan types compile without JUCE headers

#### Scenario: Block view exposes monotonic sample position
- **WHEN** the runtime calls the application's block-processing function for consecutive blocks
- **THEN** the second block's starting sample index equals the first block's starting sample index plus the first block's frame count

#### Scenario: App-owned oversampling maps into output time
- **WHEN** an application renders an internal sample at local oversampled index `i` and factor `F`
- **THEN** it may query the committed plan at `block.startSample + i / F` without informing the runtime of `F`
- **AND** the runtime does not call into the application once per internal sample

#### Scenario: Device channels are clamped to the app shape
- **WHEN** a host callback exposes more input channels than the application requested
- **THEN** the delegated block exposes only the requested prefix
- **AND** output delegation and monotonic sample-position behavior remain unchanged

### Requirement: sar-30 — Audio: host-provided device catalog
WHEN the runtime Audio page needs audio device choices, THE synth runtime architecture SHALL obtain those choices from the active host shell through a generic audio-device catalog interface, so JUCE hosts may expose enumerated native devices while browser hosts expose System Default choices without changing application logic, runtime page logic, or patch/runtime configuration semantics.

#### Scenario: Browser catalog follows the input request
- **WHEN** a browser-hosted application requests zero inputs
- **THEN** the page receives `showInputCombo == false` and an empty input option list
- **AND** selecting the System Default output commits the existing empty persisted output-device name
- **WHEN** a browser-hosted application requests one or more inputs
- **THEN** the page receives `showInputCombo == true` and exactly one input option labeled `System Default` with option id `system_default`
- **AND** selecting that option commits the existing empty persisted input-device name
- **AND** any other browser input option id is rejected

#### Scenario: JUCE host keeps native device enumeration
- **WHEN** the Audio page is hosted by the JUCE runtime
- **THEN** the page can continue to list host-enumerated input and output devices according to the application request
- **AND** the application source does not branch on the active host
