## Why

Synth applications need a reusable white-noise modulation source instead of rebuilding per-voice random generation and modulation-source registration in each application. MiniApp should demonstrate that source in a dedicated fifth modulator slot while preserving index `3` for the parallel fourth-modulator work.

## What Changes

- Add a runtime-sized, JUCE-free noise modulator DSP processor that produces one independent uniform `(0, 1)` sample per configured voice on every process call and exposes address-stable outputs for modulation-source registration.
- Use a lightweight, seedable pseudorandom generator designed for fast audio-rate updates rather than cryptographic randomness.
- Add a portable noise waveform visualizer that needs no processor UI state, represents one illustrative monophonic trace, and generates a new random y position for every horizontal pixel on every UI draw.
- Expand MiniApp to five modulator slots, leave modulator index `3` unclaimed by this change, and register a two-voice noise source plus its visualizer at index `4`.
- Add JUCE-free DSP, portable UI, and MiniApp system coverage for the processor, visualization, and topology contracts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-dsp-classes`: Add the reusable polyphonic noise modulator processor contract and make MiniApp publish it from modulator index `4` in a five-slot group.
- `synth-portable-visualizers`: Add a model-free noise waveform visualizer that regenerates a monophonic random trace on every draw.

## Impact

- Affected synth library code includes DSP processor headers, portable visualizer headers/builders, and their JUCE-free tests under `projects/synth`.
- MiniApp topology and processing under `projects/synth/apps/miniapp` gain a retained two-voice noise processor and a distinct retained visualizer at modulator index `4`.
- The processor introduces a public runtime-sized, seedable API and a stable-output lifetime contract but no new third-party dependency, persistence format, parameter, bank, page, scope channel, or backend-specific implementation.
- Parallel fourth-modulator work owns index `3`; integration may require resolving the shared MiniApp modulator-count line to the final value of five, but this change does not register or attach a visualizer at index `3`.
