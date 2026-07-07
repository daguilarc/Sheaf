## 1. Source Audit and Port Skeleton

- [ ] 1.1 Inventory Smart Grid source headers and tests for `ButterworthFilter`, `LinkwitzRileyCrossover`, `BitCrush`, `BufferResampler`, `Metering`, `AudioBuffer`, `RollingBuffer`, `OLA`, `Resynthesis`, and `SpectralModel`, noting direct dependencies to keep, adapt, or exclude.
- [ ] 1.2 Create or extend Sheaf DSP headers for filters, buffers, meters, OLA/resynthesis, and spectral model while keeping public includes JUCE-free.
- [ ] 1.3 Add a compile/include dependency test that includes every new public DSP header and fails on accidental product dependencies such as `TheoryOfTime`, `FrequencyDependentParameter`, `ExpParam`, `SampleTimer`, JUCE symbols, `GrainManager`, `PartialMachine`, `PartialMachine.hpp`, or Smart Grid encoder/module wrappers.

## 2. Math and Fourier Foundations

- [ ] 2.1 Add DSP tests for FFT normalization, inverse reconstruction, finite partial writes, and templated precision usage.
- [ ] 2.2 Reconcile `DiscreteFourierTransform<Bits>` and related helpers with Smart Grid expectations, adding missing APIs needed by OLA, spectral model, and resynthesizer.
- [ ] 2.3 Audit templated math paths so code parameterized on `Bits` uses `DspMath<Bits>` rather than hard-coded aliases, then run focused math/Fourier tests.

## 3. Filters and Transfer Functions

- [ ] 3.1 Add DSP tests for biquad reset/history behavior, Butterworth attenuation, Linkwitz-Riley low/high outputs, finite transfer-function responses, and crossover reconstruction expectations.
- [ ] 3.2 Port the reusable biquad section to Sheaf style with owned state, coefficient setup, reset, process, and static transfer-function helpers.
- [ ] 3.3 Port the 8th-order Butterworth low-pass processor using four cascaded biquads and cutoff input in cycles per sample.
- [ ] 3.4 Port the 4th-order Linkwitz-Riley crossover using low/high biquad cascades and low/high response helpers.

## 4. Buffers, Resampling, Degradation, and Metering

- [ ] 4.1 Add DSP tests for fractional buffer reads, section extrema, rolling min/max, same-rate resampling, downsample anti-alias behavior, bit-crusher pass-through/quantization, sample-rate reducer hold behavior, meter snapshots, and meter saturating-path gain reduction.
- [ ] 4.2 Implement bounded audio buffer and rolling buffer utilities without WAV loading, directory-bank, async IO, `SampleTimer`, or UI snapshot dependencies.
- [ ] 4.3 Implement offline or streaming upsampler/downsampler utilities with linear interpolation and Butterworth anti-alias filtering for downsampling.
- [ ] 4.4 Port bit crusher and sample-rate reducer processors with Sheaf `Input` structs and finite-output behavior.
- [ ] 4.5 Port mono and n-channel metering using Sheaf n-ary number types, the meter-owned saturating process path with gain-reduction tracking, and UI-readable atomic snapshots where needed.

## 5. OLA and Spectral Model

- [ ] 5.1 Add DSP tests for OLA overlap-add continuity, quad OLA writes, local-maximum atom extraction, atom tracking alphas, synthetic harmonic generation, residual cancellation, and residual envelope queries.
- [ ] 5.2 Port OLA, DFT frame, and quad OLA helpers using Sheaf `BasicWavetable<Bits>`, `DiscreteFourierTransform<Bits>`, `NaryNumber`, and `DspMath<Bits>`.
- [ ] 5.3 Port the spectral model with fixed-size atom storage, caller-supplied DSP-unit input arrays, local-maximum extraction, tracking/merge behavior, optional synthetic harmonics, and residual envelope processing.
- [ ] 5.4 Remove Smart Grid `FrequencyDependentParameter`, `FixedAllocator`, `Array`, and `Slew` dependencies by either using Sheaf-native equivalents or adding small JUCE-free low-level helpers scoped to the DSP layer.

## 6. OLA Resynthesizer

- [ ] 6.1 Add DSP tests for finite phase-vocoder analysis state, OLA hop writes, pitch-ratio input behavior, unison/gain behavior, slew behavior, spectral distortion behavior, and absence of grain-manager scheduling.
- [ ] 6.2 Port reusable phase-vocoder analysis and oscillator synthesis math from `Resynthesis.hpp` into an OLA-driven Sheaf processor.
- [ ] 6.3 Replace old `Grain`/`GrainManager` launch behavior with an input-frame or streaming-hop API that writes synthesized DFT frames into OLA.
- [ ] 6.4 Ensure resynthesizer inputs use DSP units and ratios directly, without product-level switch mappings or Smart Grid parameter objects.

## 7. Verification and Cleanup

- [ ] 7.1 Run focused synth DSP tests after each processor group and fix any numeric or dependency regressions.
- [ ] 7.2 Run `make -C projects/synth test` and confirm the full synth test suite passes.
- [ ] 7.3 Run a repository search over new DSP files for forbidden dependencies, `PartialMachine` symbols, and hard-coded templated math aliases, then remove any accidental imports.
- [ ] 7.4 Review the OpenSpec delta against the implementation and update proposal, design, specs, or tasks if implementation reveals a contract mismatch.
