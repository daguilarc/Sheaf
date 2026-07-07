## Why

Sheaf has the beginnings of the Smart Grid-derived DSP class layer, but many reusable low-level processors still only exist in `~/theallelectricsmartgrid`. Porting them now gives future synth modules a richer JUCE-free DSP toolbox without dragging over Smart Grid's older parameter, module, or Theory of Time coupling.

## What Changes

- Add Smart Grid-derived low-level DSP processors for biquad sections, Butterworth filters, Linkwitz-Riley crossovers, spectral modeling, OLA-based resynthesis, offline upsampling/downsampling, bit crushing, sample-rate reduction, and metering.
- Reconcile Smart Grid's Fourier, OLA, and buffer utilities with Sheaf's existing `DspMath`, `DspWavetable`, `DspNumbers`, and scope/buffer patterns.
- Keep already-ported behavior, such as `TanhSaturator`, in place and only extend it if tests reveal a missing contract.
- Port math directly where appropriate, but adapt APIs to Sheaf DSP processor style: stateful classes, `Input` structs, normalized DSP units such as cycles per sample, and no module-level `ExpParam`, `InputSetter`, or extra parameter slewing layers.
- Remove Smart Grid-only dependencies from the port, including `TheoryOfTime`, file IO, JUCE UI components, grain-manager scheduling, and Smart Grid encoder/module parameter wrappers.
- Exclude Smart Grid's Partial Machine processor and `PartialMachine.hpp`; this change only ports lower-level spectral/resynthesis primitives.
- For `Resynthesizer`, replace the movable write-head grain manager usage with an OLA processor path.
- Add focused DSP tests that pin the math and contracts of the imported processors.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-dsp-classes`: add Smart Grid-derived low-level DSP processors, Fourier/OLA/buffer utilities, spectral model, resynthesizer, resampling, degradation processors, and meters under the existing JUCE-free DSP class contract.

## Impact

- Affected code: `projects/synth/include/synth/DspMath.hpp`, `projects/synth/include/synth/DspWavetable.hpp`, `projects/synth/include/synth/DspFilters.hpp`, `projects/synth/include/synth/DspNumbers.hpp`, new DSP headers under `projects/synth/include/synth`, optional synth source files under `projects/synth/src`, and DSP tests under `projects/synth/tests`.
- Source material: Smart Grid headers under `/Users/joyo/theallelectricsmartgrid/private/src`, especially `ButterworthFilter.hpp`, `LinkwitzRileyCrossover.hpp`, `BitCrush.hpp`, `BufferResampler.hpp`, `Metering.hpp`, `AudioBuffer.hpp`, `RollingBuffer.hpp`, `OLA.hpp`, `Resynthesis.hpp`, and `SpectralModel.hpp`.
- APIs: new low-level processor types only; no new synth modules, no patch format changes, and no UI/runtime behavior changes.
- Dependencies: no new third-party dependencies; core DSP remains C++20 and JUCE-free. The port must not introduce a `TheoryOfTime` dependency.
