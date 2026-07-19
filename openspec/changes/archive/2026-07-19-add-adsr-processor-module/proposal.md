## Why

The synth DSP and module layers need a reusable envelope generator with a clear
retrigger contract. Recording the completed ADSR work in OpenSpec makes the
processor and its parameter wrapper discoverable without coupling either to an
application or UI.

## What Changes

- Add a JUCE-free single-voice `AdsrProcessor` with per-sample attack, decay,
  and release increments, sustain, and gate input.
- Add `AdsrModule<Polyphony>` with independent envelope state per voice and
  Attack, Decay, Sustain, Release parameters.
- Map Attack exponentially from 1 ms to 2 s; map Decay and Release
  exponentially from 1 ms to 5 s; map Sustain linearly from 0 to 1.
- Define click-free current-value retriggering and release behavior.
- Keep the work unintegrated: no instrument, audio path, standard modulator,
  UI, controller, patch, or runtime topology changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-dsp-classes`: add the low-level ADSR processor contract.
- `synth-modules`: add the reusable polyphonic ADSR module contract.

## Impact

Affected code is limited to `projects/synth/include/synth/DspAdsr.hpp`,
`projects/synth/include/synth/Modules.hpp`, focused synth tests, and build
dependencies. No external dependencies or persisted data change.
