## MODIFIED Requirements

### Requirement: sar-3 — Context: application access to managers and configuration
WHEN the runtime initializes an application, THE runtime SHALL pass a pointer to an `AppContext` holding non-owning, address-stable pointers to the parameter manager, runtime-owned grid manager, runtime-owned master clock, patch manager, UI message input bus, MIDI message input bus, parameter message output bus, patch message input and output buses, MIDI sender, live and default MIDI instrument configurations, the runtime configuration, and the host's shared monotonic timestamp provider (so application UI code timestamps messages from the same clock as the engine); the grid-manager pointer SHALL be available during `Init` so an application can declare fixed grid/slot topology before runtime finalization, the master-clock pointer SHALL be available during `Init` for stable storage but SHALL report prepared output-sample-domain values and a current committed plan only after the host prepare entry point and first block commit respectively, while the context's UI-state pointer SHALL be null during `Init` and SHALL be populated before MIDI processors, audio, or UI processing begin; all pointees SHALL remain valid for the application's lifetime.

#### Scenario: Context grants manager access during Init
- **WHEN** the application's `Init(AppContext*)` runs
- **THEN** the application can create groups, register modules and parameters, configure pages and banks through the context's parameter manager pointer, declare fixed grid/slot topology through the runtime-owned grid-manager pointer, and retain the runtime-owned master-clock pointer

#### Scenario: Context pointers remain stable
- **WHEN** the application stores the context pointer during `Init` and dereferences a member from a hook permitted to touch that member under the sar-7 threading contract
- **THEN** every pointer refers to the same live object the runtime constructed
- **AND** the context documentation names the thread role permitted to use each member

#### Scenario: UI state populated after topology lock
- **WHEN** application initialization completes and the runtime creates the manager UI state
- **THEN** the context's UI-state pointer is set before the first MIDI processor rebuild, audio callback, or UI frame

#### Scenario: Application seeds a default instrument
- **WHEN** the application's `Init` populates the live MIDI instrument configuration through the context
- **THEN** the runtime snapshots it as the default instrument restored by revert/new

#### Scenario: Clock is prepared from negotiated audio
- **WHEN** the host calls Engine prepare with its actual sample rate and block size
- **THEN** the retained master clock computes its increment and scheduling horizon from those negotiated values before the first application block

### Requirement: sar-6 — Audio: device ownership and block delegation
WHEN audio is running, THE runtime SHALL own the JUCE audio device and its callback, and per device block SHALL apply pending patch messages (using an engine-owned preallocated patch serialization context whose arena growth and retry are owned by the message thread), process the UI and MIDI message buses into the parameter manager and runtime-owned master clock, commit one immutable affine `ClockBlockPlan` over the block's monotonic half-open output-sample range, analytically enqueue that plan's enabled MIDI clock crossings, and call the application's block-processing function exactly once with a JUCE-free audio block view exposing input pointers, output pointers, actual channel counts, frame count, monotonic starting output-sample index, and a non-owning pointer to the exact committed clock plan also returned by `MasterClock::CurrentPlan()`; that plan pointer SHALL remain valid through the callback. THE runtime SHALL NOT use host audio block boundaries as the steady-state parameter target recomputation cadence, SHALL NOT call `Process` on any application DSP module, and SHALL NOT perform per-sample parameter processing — application per-sample work (parameter target refresh through the parameter system's configured sample interval, parameter `ProcessLite`, modulation-source updates, module processing, output writes) SHALL be owned by the application's block-processing function. Runtime clock work SHALL remain output-block-rate plus enumerated musical crossings, and applications SHALL obtain sample-accurate clock values by direct integer-or-fractional output-sample queries rather than advancing runtime time.

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

### Requirement: sar-10 — UI: runtime shell hosting an application component
WHEN a JUCE or browser runtime presents UI, THE runtime SHALL own its host-specific application/window or browser integration and SHALL render one shared JUCE-free runtime main component templated on the application and host services; that component SHALL host the library sidebar with Audio/Controllers/Sync/File pages and deadline readout plus the application's portable UI surface as default content, the runtime SHALL drive shared component refresh from manager and master-clock UI-state atomics at the configured frame rate, and each host entry point SHALL define its executable or static WASM application by naming only the application type.

#### Scenario: Shell hosts the complete application surface
- **WHEN** the JUCE window or Chrome static site opens
- **THEN** the application's complete portable UI surface is displayed as main-pane content beside the sidebar through the active backend
- **AND** no patch or MIDI chrome row sits above it
- **AND** the sidebar does not consume or clip the configured application content width

#### Scenario: Both hosts share top-level behavior
- **WHEN** sidebar navigation, runtime-page Back, or application actions are dispatched in JUCE and Chrome
- **THEN** both hosts route them through the same portable runtime main component
- **AND** host adapters contain no concrete-application UI or sync-policy behavior

#### Scenario: Repaint reads UI-state atomics
- **WHEN** the UI timer fires
- **THEN** sidebar, runtime Sync status, and application widgets render from published UI state without touching the parameter manager or mutable master-clock DSP state directly

#### Scenario: Typed application entry points
- **WHEN** a JUCE or browser application entry point names a conforming application type
- **THEN** the build produces the corresponding runtime-hosted application without application-specific host source

### Requirement: sar-11 — Miniapp: runtime-hosted reference application
WHEN the miniapp is ported to the runtime, THE miniapp application at `projects/synth/apps/miniapp` SHALL contain only application-specific content — runtime config, duophonic group and VCO/LFO/filter/ADSR module setup, page/bank/slot layout, scope wiring, per-sample block processing, clock-derived gate construction, and its bespoke widgets — SHALL preserve the existing specced miniapp behaviors (encoder grid, pages, scenes, gestures, MIDI controller configuration, patch commands, waveform pane), SHALL process its parameter group through the synth parameter system's group-level per-sample processing API using the audio block's monotonic sample index, SHALL expose the VCO page as module-backed VCO controls plus filter Cutoff, Resonance, and Blend controls, SHALL expose the LFO page and bank in order as five module-backed LFO parameters, ADSR Attack/Decay/Sustain/Release, and Tempo, SHALL copy `AdsrModule<2>::Outputs()` after each process call into an application-owned stable two-float mirror registered as one polyphonic modulation source at index 7 before the same-frame modulation-value update, and SHALL write its filtered VCO output to the negotiated audio device outputs using the device-provided sample rate.

#### Scenario: Miniapp init is application content only
- **WHEN** the miniapp sources are inspected
- **THEN** manager/bus/patch-manager/master-clock construction, message pumping, MIDI device glue, and patch orchestration are absent, provided instead by the runtime

#### Scenario: Miniapp produces audible filtered output
- **WHEN** the miniapp runs with an output-capable audio device
- **THEN** the filtered VCO voices are written to the device output channels
- **AND** the VCO, filter, LFO, and ADSR modules use the negotiated device sample rate

#### Scenario: Miniapp VCO page exposes filter controls
- **WHEN** the miniapp VCO page is active
- **THEN** the selected slot exposes Tune, Phase, Shape, Volume, Cutoff, Resonance, and Blend in that visible order
- **AND** Cutoff, Resonance, and Blend come from `ClassicSvfModule<2>`

#### Scenario: Miniapp LFO page is module-backed
- **WHEN** the miniapp LFO page is active
- **THEN** the selected slot exposes Frequency, Shape, Phase Offset, Skew, Exponent, Attack, Decay, Sustain, Release, and Tempo in that visible order
- **AND** the first five controls come from `BasicLfoModule<2>`, the next four come from `AdsrModule<2>`, and Tempo maps 30–300 BPM with a 120 BPM default

#### Scenario: Miniapp ADSR gate follows transport quarters
- **WHEN** transport is Running
- **THEN** MiniApp queries the committed plan at each frame's absolute output-sample position and both ADSR voices receive a high gate for transport quarter-note phase `[0, 0.5)` and a low gate for `[0.5, 1.0)` modulo one
- **AND** every integer quarter-note boundary retriggers an eighth-note-long gate
- **WHEN** transport Stops
- **THEN** the next processed ADSR sample receives gate low

#### Scenario: Miniapp ADSR is a modulation source
- **WHEN** MiniApp processes an audio frame
- **THEN** it processes `AdsrModule<2>` before the group modulation-value update
- **AND** the current per-voice envelope outputs are available from one connected application modulator index in that same frame

#### Scenario: Miniapp tempo control uses clock authority
- **WHEN** MiniApp's effective Tempo parameter changes with receive-clock disabled
- **THEN** it calls the master-clock tempo API and the new manual tempo applies no later than the next audio block
- **WHEN** receive-clock is enabled
- **THEN** the same control call is ignored by MasterClock and external tempo remains authoritative

#### Scenario: Miniapp uses parameter-owned compute cadence
- **WHEN** the miniapp's per-sample block processing is inspected
- **THEN** it calls the synth parameter system's group-level per-sample processing API with `block.startSample + frame`
- **AND** it does not separately schedule steady-state `Compute()` or `ComputeAllTargets()` from host block size

#### Scenario: Behavior parity with the probe app
- **WHEN** the ported miniapp runs
- **THEN** the existing miniapp scenarios for encoders, modulation views, scenes, gestures, MIDI configuration, and patch save/load continue to hold

### Requirement: sar-18 — Configuration: runtime startup load and save ownership
WHEN the runtime starts, THE runtime SHALL initialize the application-defined synth topology first, then load the runtime configuration document from the runtime-owned data root if it exists, applying MIDI instrument/controller configuration, audio device selection, and sync configuration before MIDI processors are built, controller reconciliation starts, the master clock is prepared for output, or the audio device is opened; WHEN the runtime is asked to save configuration, THE runtime SHALL write the current MIDI instrument/controller configuration, audio device selection, and sync configuration to that document without writing synthesizer patch data.

#### Scenario: Missing configuration keeps app defaults
- **WHEN** the runtime starts and no runtime configuration document exists
- **THEN** the MIDI instrument and audio device state established by application initialization and system defaults remain active
- **AND** sync uses all-disabled flags with PPQN 24
- **AND** startup continues without reporting a persistence failure

#### Scenario: Configuration loads before controller reconciliation
- **WHEN** the runtime configuration document contains a MIDI instrument with controller endpoint references and non-default sync settings
- **THEN** MIDI processors are built from that loaded instrument
- **AND** startup controller reconciliation uses the loaded endpoint references
- **AND** the master clock uses the loaded sync settings before its first processed audio block

#### Scenario: Configuration save excludes patch state
- **WHEN** runtime configuration is saved after Audio, Controllers, or Sync page edits
- **THEN** the saved document contains MIDI instrument/controller configuration, audio device state, and sync configuration
- **AND** it does not contain patch parameter values or patch identity
