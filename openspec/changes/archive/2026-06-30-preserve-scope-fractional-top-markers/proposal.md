## Why

The scope reader now preserves fractional x-sample coordinates, but VCO cycle alignment still records top/start markers at whole scope-writer sample indexes. That means the displayed cycle can still jump by up to one sample as oscillator frequency changes, which matches the remaining miniapp wiggle.

## What Changes

- Store scope start/end markers as floating-point writer positions instead of integer sample indexes.
- Have the oscillator incrementer compute the fractional offset inside the current sample where a top crossing occurred.
- Record VCO scope start markers at `current writer index - 1 + top crossing offset` so the marker lands between the previous and current post-increment samples.
- Keep scope sample storage and audio sample writes indexed as they are; only marker/alignment coordinates become floating point.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-dsp-classes`: Scope marker and VCO top-crossing requirements should preserve fractional marker positions for waveform alignment.

## Impact

- Affected code: `projects/synth/include/synth/DspScope.hpp`, `projects/synth/include/synth/DspOscillators.hpp`, and focused DSP tests.
- APIs: `ScopeWriterHolder::RecordStart` / `RecordEnd` and `ScopeWriter::RecordStart` / `RecordEnd` should accept floating-point offsets.
- Dependencies: none.
