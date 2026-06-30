## Why

The synth scope reader currently preserves fractional source indices internally, but the public reader/rendering path rounds each rendered x sample to an integer before reading. Keeping the fractional x coordinate through the reader should reduce waveform jitter when UI pixels and captured scope samples do not line up exactly.

## What Changes

- Change scope reader sampling so callers pass floating-point x samples and receive linearly interpolated values across the aligned scope span.
- Update JUCE waveform path drawing to pass fractional render samples through to the reader instead of truncating them to integer sample indexes.
- **BREAKING**: Remove the integer-index scope reader sampling API; do not keep a fallback overload.
- Keep marker and transfer-boundary math in floating point where possible, converting to integer indexes only at the final buffer access needed for linear interpolation.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-dsp-classes`: Scope reader and waveform rendering requirements should preserve fractional x-sample positions until the final interpolated scope read.

## Impact

- Affected code: `projects/synth/include/synth/DspScope.hpp`, `projects/synth/juce/PathDrawer.hpp`, and focused DSP/JUCE tests.
- APIs: `ScopeReader` should expose floating-point sampling directly; callers should convert only if they truly need integer display coordinates.
- Dependencies: none.
