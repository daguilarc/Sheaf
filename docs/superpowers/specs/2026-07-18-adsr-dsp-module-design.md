# ADSR DSP Processor and Module Design

## Purpose

Add a straightforward ADSR envelope processor and a reusable polyphonic module
wrapper. The low-level processor accepts stage increments in normalized progress
per sample, a sustain value, and a gate. The module owns parameter registration,
maps normalized controls to natural time values, converts those times to DSP
increments, and runs one independent processor per voice.

This change stops at the reusable processor and module boundary. It does not wire
the envelope into an application, an instrument, audio gain, the standard
modulator bundle, runtime pages, patch topology, or controller mappings.

## Considered Approaches

### Stage-progress interpolation

Each stage advances a normalized progress value from zero to one. The output is
interpolated from the value captured when the stage begins to that stage's target.
Attack targets one, decay targets sustain, and release targets zero.

This is the selected approach. It makes stage duration depend only on the supplied
increment, lands exactly on stage endpoints, and naturally supports retriggering
or releasing from the current value.

### Direct output slopes

The processor could add or subtract fixed values directly from the output. This
has less explicit state, but interrupted stages require slope recalculation to
preserve their requested duration and are harder to reason about at endpoints.

### Exponential DSP segments

The processor could apply exponential curves to its attack, decay, and release
outputs. That adds a curve policy that was not requested. In this design,
"exponential" describes the module's knob-to-time mapping; the DSP segments
themselves remain linear.

## Low-Level Processor

Add a JUCE-free `AdsrProcessor` in `include/synth/DspAdsr.hpp`. It is a
single-voice state machine with this natural-unit input:

```cpp
struct Input {
    double attackIncrement = 0.0;
    double decayIncrement = 0.0;
    float sustain = 0.0f;
    double releaseIncrement = 0.0;
    bool gate = false;
};
```

An increment represents normalized stage progress per processed sample. For a
stage time `t` and sample rate `r`, the module supplies `1 / (t * r)`. The input
contract requires finite, nonnegative increments and a finite sustain value in
the inclusive range `[0, 1]`. The module always satisfies this contract. The
processor does not allocate, lock, or throw on its per-sample path.

The processor has five observable states: `Idle`, `Attack`, `Decay`, `Sustain`,
and `Release`. It starts idle at output zero with its remembered gate low. Each
`Process(const Input&)` call returns the current sample's envelope output and
updates the remembered gate.

## State and Gate Semantics

A low-to-high gate transition enters attack, captures the current output as the
attack source, and resets stage progress. Attack linearly interpolates from that
captured value to one. This applies in every prior state, including decay and
release, so retriggering never forces the output to zero.

A high-to-low gate transition enters release, captures the current output as the
release source, and resets stage progress. This applies during attack, decay, or
sustain. A gate that remains low does not restart release.

While the gate stays high, attack completion lands exactly on one and transitions
to decay. Decay interpolates from one to the current sustain input, lands exactly
on sustain, and transitions to sustain. Sustain publishes the current sustain
input each sample so smoothed or modulated sustain changes remain live. While the
gate stays low, release lands exactly on zero and transitions to idle.

The gate edge is handled before advancing the sample's active stage. Consequently,
the first sample after an edge advances attack or release by one supplied
increment. Progress is clamped at one. Increments greater than or equal to one
complete their stage in one call; a zero increment deliberately holds the stage.

The processor exposes its current state and output for inspection and testing.
It remains independent of sample rate, parameters, polyphony, banks, modulation
sources, UI state, and product integration.

## Polyphonic Module

Add `AdsrModule<Polyphony>` to `include/synth/Modules.hpp`, following the existing
module structural pattern. `Polyphony` must be positive. The module owns one
`AdsrProcessor` per voice, one address-stable output per voice, the current DSP
input per voice, and four registered parameter IDs:

1. Attack
2. Decay
3. Sustain
4. Release

`RegisterParameters` supports an optional name prefix and caller-supplied
indicator colors, rejects repeat registration, validates capacity and duplicate
names before making partial changes, and records the owning `ParameterManager`.
`RegisterToBank` exposes the four parameters in ADSR order. The module is
non-copyable and non-movable, matching other processor-owning modules.

`SetInput` accepts the registered parameter manager and one boolean gate per
voice. For each voice it maps the current parameter values, converts time values
to per-sample increments using the configured sample rate, and stores an
`AdsrProcessor::Input`. Using a different manager or calling manager-dependent
operations before registration is a coding error. `Process` advances every voice
once and updates the output array. Outputs are available by voice and as an
immutable span for later composition, but the module does not register them as
modulation sources in this change.

The constructor defaults to 48 kHz. Construction and `SetSampleRate` reject
nonfinite or nonpositive sample rates. Changing sample rate affects increments
computed by the next `SetInput` call and does not reset envelope state.

## Parameter Mapping

All time ranges are positive and use `ParameterManager::GetExponential`:

| Parameter | Mapping | Default |
| --- | --- | --- |
| Attack | 1 ms to 2 s | 10 ms |
| Decay | 1 ms to 5 s | 100 ms |
| Sustain | linear 0 to 1 | 0.7 |
| Release | 1 ms to 5 s | 250 ms |

Parameter defaults are stored at the normalized positions that map back to
these natural values. Sustain uses `ParameterManager::GetLinear`. The module
does not add a second smoothing layer; it consumes the parameter system's
per-voice values.

## Realtime and Ownership Contract

All storage is fixed by `Polyphony` and owned by the module. Parameter
registration may allocate during initialization. `SetInput`, `Process`, output
inspection, and sample-rate changes perform no dynamic allocation. The DSP path
uses no locks, atomics, exceptions, UI snapshots, or external framework types.

The processor and module are header-only, consistent with the neighboring DSP
and module implementations. Build dependency lists may name the new header so
focused tests rebuild correctly; that is build hygiene, not product integration.

## Verification

Focused DSP tests will cover:

- default idle state and a low gate remaining at zero;
- attack, decay, sustain, release, and exact endpoint transitions;
- one-sample stages and zero-increment held stages;
- gate-off interruption from attack and decay;
- low-to-high retriggering from the current release or decay value;
- no repeated restart while a gate remains unchanged;
- live sustain changes and outputs constrained to `[0, 1]`; and
- JUCE-free compilation of the processor contract.

Focused module tests will cover:

- positive-polyphony and non-copyable/non-movable contracts;
- prefixed registration, ADSR parameter order, defaults, indicator colors, and
  bank registration;
- atomic rejection of insufficient capacity, duplicate names, and repeated
  registration;
- exponential time endpoints and linear sustain endpoints;
- exact seconds-to-increment conversion at representative sample rates;
- independent gates, state, and output for multiple voices;
- state preservation across sample-rate changes; and
- failures for invalid sample rates, wrong managers, and use before registration.

After focused red-green cycles, verification runs the complete synth test suite
and checks that no app, runtime, patch, controller, or standard-modulator source
began depending on `AdsrModule`.

## Non-Goals

- No application, instrument, voice, or audio-amplitude integration.
- No registration as a standard modulation source.
- No visualizer, scope, or DSP-to-UI snapshot.
- No patch migration or persistence-specific behavior.
- No MIDI, controller, page, or runtime layout changes.
- No logarithmic or exponential DSP envelope curvature control.
- No delay, hold, loop, legato mode, velocity scaling, or forced reset-to-zero
  retrigger mode.
