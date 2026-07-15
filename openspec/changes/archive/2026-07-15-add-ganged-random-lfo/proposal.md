## Why

Set-and-forget modulation needs a way to make several polyphonic destinations move together without making them identical. A ganged random LFO provides that “octopus at the controls” behavior: every voice shares the timing and target tendencies of one gesture while retaining its own duration, destination, and transition shape.

## What Changes

- Add pure shaped-interpolation and correlated random-increment helpers, using the existing fast float `DefaultDspMath::Cos2Pi` path at the output-evaluation boundary while retaining double-precision progress and timing math.
- Add a randomness-free ganged-random-LFO voice processor with explicit waiting, moving, and done states.
- Add a fixed-voice-count ganged random LFO processor that samples shared normally distributed center times, converts their reciprocals to center rates, samples per-voice waiting and moving increments around those rates in a canonical RNG order, and samples correlated targets at round boundaries before driving all voices until the slowest voice completes, with each phase bounded to one hour.
- Publish coherent snapshot UI state containing the live round and per-voice values needed to reconstruct the complete current round without recording samples.
- Add a portable predictive visualizer that draws each voice's whole round, with solid past, dashed future, a present-position dot evaluated from the reconstructed path at the shared present, and assignable per-voice colors so the drawing can match each voice's visual identity.
- Add a two-voice instance to MiniApp as a fourth modulation source, configured for both waiting and movement with a 2 s center-time mean, 500 ms center-time sigma, and 0.125 Hz internal increment sigma, plus 0.1 target internal sigma, and expose its predictive visualization.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-dsp-classes`: Add interpolation, correlated center-time/per-voice-increment sampling, ganged-random-LFO voice/processor state machines, deterministic test hooks, and coherent UI-state publication.
- `synth-portable-visualizers`: Add the reusable snapshot-driven ganged-random-LFO round visualizer.
- `synth-parameter-modulation`: Integrate the configured two-voice ganged random LFO and its visualizer into MiniApp as an address-stable modulation source.

## Impact

- Affected project: `projects/synth`.
- Expected code areas: DSP math/oscillator headers, portable UI builders/visualizers, MiniApp core and portable UI model, and synth unit/system tests.
- Existing portable draw commands are sufficient: the future path can be emitted as bounded polyline segments, so neither the JUCE nor browser draw protocol requires a dashed-stroke extension.
- No performer-facing module, parameter bank, patch schema, external dependency, or breaking API change is introduced.
