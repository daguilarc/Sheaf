## Context

Sheaf's synth project already has a JUCE-free DSP class layer under `projects/synth/include/synth`, including table-backed `DspMath<Bits>`, `BasicWavetable<Bits>`, `DiscreteFourierTransform<Bits>`, one-pole filters, a classic SVF, `TanhSaturator`, scope utilities, n-ary channel values, and wavetable oscillators. The requested processors still live in Smart Grid's older `private/src` headers and were built around a different product architecture: parameter wrappers such as `FrequencyDependentParameter` and `PhaseUtils::ExpParam`, UI snapshot helpers, file-loading helpers, grain-manager scheduling, and occasional hard-coded aliases such as `Math4096`.

The target is not to port Smart Grid modules. The target is to extract low-level DSP math and state machines into Sheaf processor classes that match the existing DSP contract: owned state, `Input` structs, natural DSP units, no JUCE in core headers, and UI state only where low-level processors genuinely publish inspectable state.

Source inspection highlights:

- `TanhSaturator` is already present in `DspFilters.hpp`.
- `DspWavetable.hpp` already has the Smart Grid-style FFT normalization and Hann partial write kernel, but the port must audit generic usage and avoid hard-coded table aliases when templated on `Bits`.
- `ButterworthFilter.hpp`, `LinkwitzRileyCrossover.hpp`, `BitCrush.hpp`, `BufferResampler.hpp`, `Metering.hpp`, `OLA.hpp`, `SpectralModel.hpp`, and `Resynthesis.hpp` are good direct math sources.
- `Resynthesis.hpp` contains reusable phase-vocoder math, but its old production path is scheduled through grains. Sheaf should replace that scheduling with an OLA path.

## Goals / Non-Goals

**Goals:**

- Provide low-level Sheaf DSP processors for biquad, Butterworth, Linkwitz-Riley, spectral model, OLA resynthesizer, upsampling/downsampling, bit crusher, sample-rate reducer, and metering.
- Port supporting Fourier, OLA, bounded buffer, rolling buffer, interpolation, and resampling utilities needed by those processors.
- Keep processor inputs in DSP units such as cycles per sample, normalized magnitudes, alphas, ratios, and fixed-size parameter arrays. Sheaf's parameter system remains responsible for mapping, smoothing, modulation, and UI controls.
- Use `DspMath<Bits>` or the relevant template parameter's math alias for trig, roots of unity, Hann windows, polar values, and partial kernels.
- Preserve Smart Grid's core math where possible, with focused tests proving transfer functions, FFT normalization, OLA continuity, spectral tracking, phase behavior, and degradation/meter behavior.
- Keep the port free of `TheoryOfTime`, Smart Grid modules, JUCE UI, file IO, and movable write-head grain manager dependencies.

**Non-Goals:**

- No new synth modules, miniapp pages, patch format entries, MIDI controller mappings, or user-visible UI.
- No port of Smart Grid `InputSetter` classes, `FrequencyDependentParameter`, `PhaseUtils::ExpParam` object graphs, encoder metadata, or extra parameter-slew layers.
- No WAV directory loading, recording-manager workflow, or async IO port as part of this low-level DSP work.
- No port of Smart Grid's Partial Machine processor, `PartialMachine.hpp`, or effect-level Partial Machine synthesis graph. Fourier "partial" helpers remain in scope only as low-level harmonic/DFT utilities.
- No attempt to make the old resynthesis grain pool available as a Sheaf scheduling primitive.
- No change to the existing `TanhSaturator` contract unless implementation discovers a concrete mismatch with the current Smart Grid math.

## Decisions

1. Treat this as an expansion of `synth-dsp-classes`, not a module capability.

   All requested artifacts are low-level processors or support utilities. They should live alongside `DspFilters.hpp`, `DspWavetable.hpp`, and `DspOscillators.hpp`, with tests in `projects/synth/tests/dsp_tests.cpp` or adjacent focused DSP test files. Future modules can compose them later through a separate change.

   Alternative considered: port related module-level or effect-level systems at the same time. That would force parameter registration, patch persistence, UI wiring, and visible controls into a change whose main risk is DSP correctness.

2. Keep Sheaf's existing Fourier foundation and reconcile it with Smart Grid.

   Sheaf's `DiscreteFourierTransform<Bits>` already matches the Smart Grid forward normalization (`workspace[k] / N`), inverse reconstruction, and Hann partial writes. Implementation should add missing API affordances only where the new processors need them, and tests should lock FFT normalization and partial-write behavior. Any templated code must call `DspMath<Bits>` rather than hard-coded aliases such as `Math4096`.

   Alternative considered: copy `AdaptiveWaveTable.hpp`'s DFT wholesale. That would duplicate an already-ported core and risk divergence.

3. Add filter processors around a reusable biquad section.

   Port `BiquadSection` into Sheaf style with an `Input` struct for value plus coefficients or mode-specific normalized cutoff/Q inputs. `ButterworthFilter` should own four cascaded low-pass biquads for the Smart Grid 8th-order response. `LinkwitzRileyCrossover` should own low/high cascades and expose low/high outputs plus transfer-function helpers.

   Alternative considered: implement Butterworth and Linkwitz-Riley directly without exposing biquad. The Smart Grid code already shares a stable biquad core, and making it reusable improves testability.

4. Port buffer and resampling utilities as DSP data structures, not file loaders.

   The useful low-level pieces are bounded audio buffers with fractional reads and section extrema, rolling buffers, offline linear resampling with anti-alias filtering for downsampling, and any streaming up/downsampler needed by processors. `AudioBuffer::LoadFromFile`, `WavReader`, directory banks, `SampleTimer`, and snapshot UI are out of scope.

   Alternative considered: port `AudioBuffer.hpp` intact. That would import file IO and product workflow code into the DSP layer.

5. Replace Smart Grid parameter-provider dependencies with plain DSP input arrays.

   `SpectralModelGeneric` currently uses a `ParameterProvider` concept whose `Parameter` values can process by frequency index. In Sheaf, the low-level port should represent frequency-indexed controls as fixed-size arrays or lightweight parameter-curve/value providers that are not tied to `FrequencyDependentParameter` or `ExpParam`. Attack/decay/portamento inputs should be alphas at the analysis hop rate, and frequency values should be cycles per sample.

   Alternative considered: port `FrequencyDependentParameter`. That would preserve old code shape but duplicate Sheaf's parameter responsibility and add product semantics to the low-level DSP layer.

6. Make resynthesis OLA-driven.

   The phase-vocoder math in `Resynthesis.hpp` should become a stateful low-level processor that accepts previous/current analysis frames or a stream feeding hop windows, synthesizes into a DFT frame, and writes that frame through `OLA`/`QuadOLA`. It should not expose or require `Grain`, `GrainManager`, movable write heads, delay-line read heads, or sample-source scheduling.

   Alternative considered: port `Grain` and `GrainManager` first, then wrap them. That contradicts the requested OLA direction and would bring delay/sample playback concerns into the core processor.

7. Keep metering's gain-reduction estimate inside the meter-owned saturating path.

   Plain meter processing should track RMS and peak only. When callers explicitly use the meter's saturating process path, the meter should compute gain reduction as the saturated output/input magnitude ratio with a small positive floor for near-zero values, matching Smart Grid's meter math without making ordinary level metering imply compression.

   Alternative considered: make gain reduction a generic meter input. That would blur level metering and dynamics/saturation responsibilities and would not match the source behavior.

8. Verify dependency hygiene mechanically.

   Implementation should include compile-time/include tests or `rg` checks in the task flow for forbidden names in the new DSP headers: `TheoryOfTime`, `FrequencyDependentParameter`, `ExpParam`, `SampleTimer`, Smart Grid encoder/module types, JUCE symbols, `GrainManager`, `PartialMachine`, and hard-coded math aliases in templated code. Source comments may mention Smart Grid provenance, but public APIs must not require those dependencies.

   Alternative considered: rely on review. The dependency risk is easy to regress and cheap to check.

## Risks / Trade-offs

- Spectral and phase-vocoder math is sensitive to FFT normalization and hop/window assumptions -> add focused tests from Smart Grid's `dsp_dft.cpp`, `dsp_spectralmodel.cpp`, and phase-vocoder docs before broad integration.
- Removing `FrequencyDependentParameter` changes API shape around spectral controls -> preserve the same per-index math with fixed-size arrays and explicit frequency-index helper functions, and document any index mapping differences in tests.
- OLA resynthesis may not be bit-identical to the old grain path -> pin continuity, latency, phase progression, and finite output rather than grain-scheduler implementation details.
- Large template buffers can increase compile time and stack pressure -> keep large workspaces as owned members or bounded arrays in stateful processors where needed, and avoid per-sample dynamic allocation.
- Filter transfer-function tests can become brittle -> assert stable endpoints, finite responses, crossover reconstruction behavior, and broad attenuation expectations rather than exact full curves.
