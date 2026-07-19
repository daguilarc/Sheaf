## Why

Sheaf's synth runtime can represent MIDI realtime bytes, but it does not yet own a musical timeline, consume realtime clock/transport messages, or emit schedulable clock output. A runtime-owned master clock gives every application one sample-domain source of tempo, phase, and transport while making external MIDI synchronization stable enough for musical use.

## What Changes

- Add a JUCE-free runtime-owned master clock that commits one continuous affine lifetime/transport timeline per output block, exposes fractional output-sample queries to applications, and changes tempo slope only at block boundaries without moving an already committed position backward.
- Add a `Phasor2Tick` DSP processor and use it to derive configurable-PPQN tick crossings without allocation or locks.
- Route MIDI Timing Clock, Start, Continue, and Stop from every connected input to the master clock with explicit internal-versus-external transport provenance and receive gating.
- Recover tempo and phase from accepted external clock timestamps, including first-clock-after-Start behavior, dropout/outlier handling, and deterministic transitions between internal and external sync.
- Analytically solve every PPQN crossing in each committed timeline segment and broadcast enabled clock and transport messages through timestamp-aware lookahead scheduling, using a continuous slew-limited audio-sample/monotonic-time map plus fixed latency so callback, input-handoff, browser-poll, and worker jitter do not quantize outgoing deadlines.
- Add a portable runtime Sync sidebar page for send/receive clock, send/receive transport, and PPQN controls, persisted as runtime configuration.
- Extend MiniApp with a tempo control (30–300 BPM) and an ADSR modulator gated for one eighth note at each quarter-note boundary while transport runs; place the ADSR controls on its LFO page.

## Capabilities

### New Capabilities

- `synth-master-clock`: Runtime clock ownership, accumulators and transport state, internal/external clock semantics, tempo recovery, phase discipline, PPQN tick generation, and scheduled MIDI clock/transport output.

### Modified Capabilities

- `synth-dsp-classes`: Add the low-level double-time `Phasor2Tick` crossing processor.
- `synth-app-runtime`: Expose and drive the runtime-owned clock, route transport messages, extend the application context, and integrate the MiniApp clocked ADSR and tempo control.
- `synth-midi-instrument`: Carry realtime input from every controller and add scheduled broadcast output without disturbing per-controller feedback routing or reconnect safety.
- `synth-runtime-ui`: Add the portable, persisted Sync page and sidebar navigation.

## Impact

The change affects the JUCE-free synth core and tests, `Engine`/`AppContext`/`SynthRig`, JUCE and browser runtime services, MIDI processor-chain construction, `MidiSender` and host output sinks, runtime configuration JSON, portable runtime pages, and MiniApp parameters and DSP composition. Existing applications retain their once-per-block `ProcessBlock` contract and existing immediate controller-feedback output remains supported; applications that consume the clock may query it at integer or fractional output-sample positions, independent of their internal oversampling factor. Runtime configuration requires a schema update and migration/default handling for installations without sync fields.
