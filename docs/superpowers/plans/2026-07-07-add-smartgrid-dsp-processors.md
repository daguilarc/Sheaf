# Add Smart Grid DSP Processors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Smart Grid-derived low-level DSP processors into Sheaf's JUCE-free synth DSP layer, excluding Partial Machine.

**Architecture:** Keep the DSP layer header-first and JUCE-free. Add focused headers for new processor families, extend `DspWavetable.hpp` only where Fourier/OLA users need existing primitives, and keep all tests in `projects/synth/tests/dsp_tests.cpp` unless a task explicitly creates a more focused DSP test file. Use Codex xagent implementers for implementation tasks and Claude Opus xagent reviewers for review gates.

**Tech Stack:** C++20, synth Makefile, header-only DSP classes, `make -C projects/synth build`, `make -C projects/synth build/dsp_tests`, `make -C projects/synth test`, xagent `codex` workers, xagent `claude_code --model opus` reviewers.

## Global Constraints

- Core DSP code SHALL remain JUCE-free and live under `projects/synth/include/synth` or `projects/synth/src`.
- Smart Grid product dependencies SHALL NOT be introduced: `TheoryOfTime`, `FrequencyDependentParameter`, `PhaseUtils::ExpParam`, Smart Grid encoder/module wrappers, movable write-head grain managers, `PartialMachine`, file IO, and JUCE UI classes are forbidden in new public DSP headers.
- Smart Grid's Partial Machine processor, `PartialMachine.hpp`, and effect-level Partial Machine synthesis graph are out of scope. Fourier "partial" helpers are allowed only as low-level harmonic/DFT utilities.
- Runtime processor values SHALL be supplied through named `Input` structs in DSP units such as cycles per sample, normalized phase, alphas, gains, and ratios.
- Sheaf's parameter system owns mapping, modulation, and smoothing; do not port Smart Grid `InputSetter` classes or extra parameter-slew layers.
- Templated Fourier and resynthesis code SHALL use `DspMath<Bits>` rather than hard-coded precision aliases such as `Math4096`.
- Tests come first: write failing tests, run them to confirm failure, then implement minimal production code.
- Do not pass `--thinking-level` to xagent Codex workers in this repository; the local Codex CLI rejects the forwarded flag. Use `plugins/xagent/scripts/xagent run --harness codex --subagent ...`.

---

## File Structure

- Modify `projects/synth/include/synth/DspWavetable.hpp`: add missing Fourier helpers needed by OLA, spectral model, and resynthesis while preserving existing wavetable APIs.
- Modify `projects/synth/include/synth/DspFilters.hpp`: add `BiquadSection`, `ButterworthFilter`, and `LinkwitzRileyCrossover`.
- Create `projects/synth/include/synth/DspBuffers.hpp`: bounded sample buffer, rolling buffer, section extrema, and resampling helpers.
- Create `projects/synth/include/synth/DspDegrade.hpp`: bit crusher and sample-rate reducer processors.
- Create `projects/synth/include/synth/DspMetering.hpp`: mono/n-channel meters and UI-readable meter snapshots.
- Create `projects/synth/include/synth/DspOla.hpp`: mono and n-channel OLA/DFT frame helpers.
- Create `projects/synth/include/synth/DspSpectral.hpp`: spectral atom model, residual model, and small low-level array/slew helpers if needed.
- Create `projects/synth/include/synth/DspResynthesis.hpp`: OLA-driven phase-vocoder resynthesizer.
- Modify `projects/synth/tests/dsp_tests.cpp`: include all new headers and add DSP tests for every OpenSpec requirement.
- Modify `projects/synth/Makefile`: add new DSP headers to `DSP_HEADERS` so build/test targets track them.
- Modify `openspec/changes/add-smartgrid-dsp-processors/tasks.md`: check boxes only after the corresponding implemented work passes review and verification.

---

### Task 1: Dependency-Clean Skeleton and Fourier Foundations

**Files:**
- Modify: `projects/synth/include/synth/DspWavetable.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`
- Modify: `projects/synth/Makefile`
- Create: `projects/synth/include/synth/DspBuffers.hpp`
- Create: `projects/synth/include/synth/DspDegrade.hpp`
- Create: `projects/synth/include/synth/DspMetering.hpp`
- Create: `projects/synth/include/synth/DspOla.hpp`
- Create: `projects/synth/include/synth/DspSpectral.hpp`
- Create: `projects/synth/include/synth/DspResynthesis.hpp`

**Interfaces:**
- Produces empty but compilable public headers with namespace `synth`.
- Produces test helpers in `dsp_tests.cpp`: `RequireNear(double,double,double,const char*)`, `RequireComplexNear(std::complex<float>, std::complex<float>, float, const char*)`, and `RequireFinite(float,const char*)`.
- Produces Fourier helper affordances on `DiscreteFourierTransform<Bits>`:
  - `static constexpr std::size_t kTableSize`
  - `static constexpr std::size_t kMaxComponents`
  - `void Init()`
  - `void Transform(const BasicWavetable<Bits>&)`
  - `void InverseTransform(BasicWavetable<Bits>&, std::size_t maxComponents) const`
  - `void WriteWindowedPartial(float phase, float magnitude, float exactFrequency)`

- [ ] **Step 1: Add failing include/dependency tests**

Add includes for all new headers to `projects/synth/tests/dsp_tests.cpp`:

```cpp
#include "synth/DspBuffers.hpp"
#include "synth/DspDegrade.hpp"
#include "synth/DspMetering.hpp"
#include "synth/DspOla.hpp"
#include "synth/DspResynthesis.hpp"
#include "synth/DspSpectral.hpp"
```

Add static checks:

```cpp
TEST_CASE(smartgrid_dsp_public_headers_are_dependency_clean) {
    #ifdef JUCE_MAJOR_VERSION
    throw std::runtime_error("DSP headers must not include JUCE");
    #endif
    REQUIRE_TRUE(std::is_default_constructible_v<synth::BoundedAudioBuffer>);
    REQUIRE_TRUE(std::is_default_constructible_v<synth::BitCrusher>);
    REQUIRE_TRUE(std::is_default_constructible_v<synth::Meter>);
    REQUIRE_TRUE(std::is_default_constructible_v<synth::Ola<12>>);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make -C projects/synth build/dsp_tests`

Expected: compile fails because the new headers/classes do not exist.

- [ ] **Step 3: Add minimal headers and Makefile tracking**

Create each new header with `#pragma once`, includes only from the C++ standard library and existing `synth/Dsp*.hpp` headers, namespace `synth`, and minimal default-constructible declarations:

```cpp
namespace synth {
struct BoundedAudioBuffer {};
struct BitCrusher {};
struct Meter {};
template<std::size_t Bits> struct Ola {};
template<std::size_t Bits> struct SpectralModel {};
template<std::size_t Bits> struct OlaResynthesizer {};
} // namespace synth
```

Only put each declaration in its correct header. Add the headers to `DSP_HEADERS` in `projects/synth/Makefile`.

- [ ] **Step 4: Add Fourier behavior tests**

Add tests for FFT normalization, inverse reconstruction, and windowed partial writes using `DiscreteFourierTransform<10>` and `DspMath<10>`. Use a cosine exactly aligned to bin 8 and assert magnitude `0.5f +/- 0.002f`.

- [ ] **Step 5: Run Fourier tests to verify current behavior**

Run: `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`

Expected: include skeleton passes; Fourier tests may pass with existing code or fail only for missing helper affordances.

- [ ] **Step 6: Implement minimal Fourier affordances**

Extend `DspWavetable.hpp` only for missing behavior. Do not duplicate the DFT implementation. Any new templated trig/root/window code must call `DspMath<Bits>`.

- [ ] **Step 7: Run dependency grep**

Run:

```bash
rg -n "TheoryOfTime|FrequencyDependentParameter|ExpParam|SampleTimer|GrainManager|PartialMachine|JUCE_|JUCE_MAJOR_VERSION|Math4096" projects/synth/include/synth/Dsp*.hpp
```

Expected: no matches except `JUCE_MAJOR_VERSION` in tests, not headers.

- [ ] **Step 8: Commit**

```bash
git add projects/synth/include/synth projects/synth/tests/dsp_tests.cpp projects/synth/Makefile
git commit -m "feat: add dsp port skeleton and fourier checks"
```

**OpenSpec tasks covered:** 1.2, 1.3, 2.1, 2.2, 2.3.

---

### Task 2: Biquad, Butterworth, and Linkwitz-Riley Filters

**Files:**
- Modify: `projects/synth/include/synth/DspFilters.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`

**Interfaces:**
- Produces `struct BiquadSection` with nested `Input { float value; }`, coefficient fields, state fields, `Process(float)`, `Process(const Input&)`, `Reset()`, `SetLowPassCoefficients(float cyclesPerSample, float q)`, `SetHighPassCoefficients(float cyclesPerSample, float q)`, and static `TransferFunction(...)`.
- Produces `struct ButterworthFilter` with `Input { float value; float cutoff; }`, `Process(const Input&)`, `SetCutoff(float cyclesPerSample)`, `Reset()`.
- Produces `struct LinkwitzRileyCrossover` with `Input { float value; float cutoff; }`, `Output { float lowPass; float highPass; }`, `ComplexOutput { std::complex<float> lowPass; std::complex<float> highPass; }`, `Process(const Input&)`, `SetCutoff(float)`, `Reset()`, and static `TransferFunction(float cutoff, float frequency)`.

- [ ] **Step 1: Write failing filter tests**

Add tests for:
- `BiquadSection::Reset()` clears delayed state.
- `ButterworthFilter` attenuates a `0.30` cycles/sample sine more than a `0.02` cycles/sample sine when cutoff is `0.08`.
- `LinkwitzRileyCrossover::TransferFunction(0.10f, f)` returns finite low/high values and `std::abs(low + high)` near `1.0f` for `f` in `{0.01f, 0.05f, 0.10f, 0.20f, 0.40f}`.

- [ ] **Step 2: Run test to verify failure**

Run: `make -C projects/synth build/dsp_tests`

Expected: compile fails because the filter classes do not exist or lack methods.

- [ ] **Step 3: Port Smart Grid filter math**

Use `/Users/joyo/theallelectricsmartgrid/private/src/ButterworthFilter.hpp` and `/Users/joyo/theallelectricsmartgrid/private/src/LinkwitzRileyCrossover.hpp` as source material. Replace `M_PI`, `std::sin`, and `std::cos` in transfer paths with `DefaultDspMath` where consistent with existing `DspFilters.hpp`; coefficient setup may use `DefaultDspMath::Sin2Pi` and `DefaultDspMath::Cos2Pi`.

- [ ] **Step 4: Run focused filter tests**

Run: `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`

Expected: new filter tests pass and existing one-pole/SVF tests still pass.

- [ ] **Step 5: Commit**

```bash
git add projects/synth/include/synth/DspFilters.hpp projects/synth/tests/dsp_tests.cpp
git commit -m "feat: port smartgrid biquad crossover filters"
```

**OpenSpec tasks covered:** 3.1, 3.2, 3.3, 3.4.

---

### Task 3: Buffers, Resampling, Degradation, and Metering

**Files:**
- Modify: `projects/synth/include/synth/DspBuffers.hpp`
- Modify: `projects/synth/include/synth/DspDegrade.hpp`
- Modify: `projects/synth/include/synth/DspMetering.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`

**Interfaces:**
- `struct BoundedAudioBuffer` stores `std::vector<float> samples`, section extrema arrays, `ReadRealTime(double)`, `ReadNormalized(double)`, `ComputeSectionExtrema()`, and `Clear()`.
- `template<std::size_t Size> struct RollingBuffer` provides `Write(float)`, `Min()`, and `Max()`.
- `struct BufferResampler` provides `OutputFrameCount(...)`, `AntiAliasLowpassInPlace(...)`, and `ResampleToRate(...)`.
- `struct BitCrusher` and `struct SampleRateReducer` each expose `Input` and `Process(const Input&)`.
- `struct Meter`, `struct MeterSnapshot`, `template<std::size_t Size> struct NaryMeter`, and `template<std::size_t Size> struct NaryMeterSnapshot`.

- [ ] **Step 1: Write failing buffer/resampler/degrade/meter tests**

Add tests for fractional midpoint reads, section extrema, rolling min/max, same-rate copy, downsample high-frequency attenuation, bit crusher zero pass-through and quantization, sample-rate reducer hold, meter RMS/peak snapshots, and `Meter::ProcessAndSaturate` gain reduction.

- [ ] **Step 2: Run test to verify failure**

Run: `make -C projects/synth build/dsp_tests`

Expected: compile fails or tests fail because implementations are absent.

- [ ] **Step 3: Implement buffers and resampler**

Use Smart Grid `AudioBuffer.hpp`, `RollingBuffer.hpp`, and `BufferResampler.hpp` as math sources. Do not port `LoadFromFile`, `WavReader`, directory banks, async IO, or `SampleTimer`. Anti-alias downsampling through the new `ButterworthFilter`.

- [ ] **Step 4: Implement degradation processors**

Use Smart Grid `BitCrush.hpp` as source material. Clamp inputs to finite ranges and keep `Input` structs:

```cpp
struct BitCrusher::Input { float value = 0.0f; float amount = 0.0f; };
struct SampleRateReducer::Input { float value = 0.0f; float freq = 1.0f; };
```

- [ ] **Step 5: Implement metering**

Use Smart Grid `Metering.hpp` as source material. `Meter::Process(float)` tracks RMS/peak. `Meter::ProcessAndSaturate(float)` applies the atan saturator, tracks RMS/peak on output, and tracks reduction as `max(epsilon, abs(output)) / max(epsilon, abs(input))`.

- [ ] **Step 6: Run focused tests**

Run: `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`

Expected: new tests pass.

- [ ] **Step 7: Commit**

```bash
git add projects/synth/include/synth/DspBuffers.hpp projects/synth/include/synth/DspDegrade.hpp projects/synth/include/synth/DspMetering.hpp projects/synth/tests/dsp_tests.cpp
git commit -m "feat: port smartgrid buffers degradation metering"
```

**OpenSpec tasks covered:** 4.1, 4.2, 4.3, 4.4, 4.5.

---

### Task 4: OLA Helpers and Spectral Model

**Files:**
- Modify: `projects/synth/include/synth/DspOla.hpp`
- Modify: `projects/synth/include/synth/DspSpectral.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`

**Interfaces:**
- `template<std::size_t Bits> struct Ola` with `Process()`, `Write(DiscreteFourierTransform<Bits>&)`, `kHopDenom = 4`, `kTableSize`, and `kHopSize`.
- `template<std::size_t Bits, std::size_t Channels> struct NaryDftFrame` and `template<std::size_t Bits, std::size_t Channels> struct NaryOla`.
- `template<std::size_t Bits> struct SpectralModel` with `Input`, `AnalysisAtom`, `Atom`, `ResidualModel`, `ExtractAtoms(...)`, and `ExtractAtomsAndResidual(...)`.

- [ ] **Step 1: Write failing OLA and spectral tests**

Add tests for OLA finite overlap-add, quad OLA channel independence, local-maximum atom extraction, tracking alphas, synthetic harmonic generation, residual cancellation, and residual envelope queries.

- [ ] **Step 2: Run test to verify failure**

Run: `make -C projects/synth build/dsp_tests`

Expected: compile/test failure for missing OLA and spectral APIs.

- [ ] **Step 3: Implement OLA helpers**

Use Smart Grid `OLA.hpp` as source material and Sheaf `NaryNumber<float, Size>` for n-channel output. Use `DiscreteFourierTransform<Bits>` and `BasicWavetable<Bits>`.

- [ ] **Step 4: Implement spectral model**

Use Smart Grid `SpectralModel.hpp` as source material. Replace `FrequencyDependentParameter`, `FixedAllocator`, `Array`, and `Slew` with small local helpers or standard containers in `DspSpectral.hpp`. Inputs must be fixed-size arrays or simple scalar values in DSP units. No `PartialMachine` symbols.

- [ ] **Step 5: Run focused tests and dependency grep**

Run:

```bash
make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests
rg -n "TheoryOfTime|FrequencyDependentParameter|ExpParam|SampleTimer|GrainManager|PartialMachine|Math4096" projects/synth/include/synth/DspOla.hpp projects/synth/include/synth/DspSpectral.hpp
```

Expected: tests pass and grep has no matches.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/include/synth/DspOla.hpp projects/synth/include/synth/DspSpectral.hpp projects/synth/tests/dsp_tests.cpp
git commit -m "feat: port smartgrid ola spectral model"
```

**OpenSpec tasks covered:** 5.1, 5.2, 5.3, 5.4.

---

### Task 5: OLA-Driven Resynthesizer

**Files:**
- Modify: `projects/synth/include/synth/DspResynthesis.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`

**Interfaces:**
- `template<std::size_t Bits> struct OlaResynthesizer`
- `OlaResynthesizer<Bits>::Input` contains DSP-unit fields for pitch ratios, unison detune/gain, slew alphas, and spectral distortion toggles/amounts.
- `void PrimeAnalysis(const BasicWavetable<Bits>& previousFrame)`
- `void ProcessHop(const BasicWavetable<Bits>& currentFrame, const Input& input)`
- `float Process()`

- [ ] **Step 1: Write failing resynth tests**

Add tests for finite analysis state, OLA hop writes, pitch ratio direct use, unison/gain finite output, slew magnitude motion, spectral distortion finite output, and absence of `Grain`/`GrainManager` in public APIs.

- [ ] **Step 2: Run test to verify failure**

Run: `make -C projects/synth build/dsp_tests`

Expected: compile/test failure for missing resynthesizer API.

- [ ] **Step 3: Implement OLA resynthesizer**

Use Smart Grid `Resynthesis.hpp` as source material for phase analysis and oscillator synthesis. Do not port `Grain`, `GrainManager`, movable write heads, delay-line read heads, or product switch mappings. Write synthesized DFT frames into `Ola<Bits>`.

- [ ] **Step 4: Run focused tests and dependency grep**

Run:

```bash
make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests
rg -n "TheoryOfTime|FrequencyDependentParameter|ExpParam|SampleTimer|GrainManager|PartialMachine|Math4096" projects/synth/include/synth/DspResynthesis.hpp
```

Expected: tests pass and grep has no matches.

- [ ] **Step 5: Commit**

```bash
git add projects/synth/include/synth/DspResynthesis.hpp projects/synth/tests/dsp_tests.cpp
git commit -m "feat: port ola resynthesizer"
```

**OpenSpec tasks covered:** 6.1, 6.2, 6.3, 6.4.

---

### Task 6: Full Verification and OpenSpec Synchronization

**Files:**
- Modify: `openspec/changes/add-smartgrid-dsp-processors/tasks.md`
- Modify if needed: `openspec/changes/add-smartgrid-dsp-processors/specs/synth-dsp-classes/spec.md`
- Modify if needed: `openspec/changes/add-smartgrid-dsp-processors/design.md`

**Interfaces:**
- Produces clean focused and full synth test results.
- Produces checked OpenSpec task boxes only for implemented, reviewed, verified work.

- [ ] **Step 1: Run full verification**

Run:

```bash
make -C projects/synth test
openspec validate add-smartgrid-dsp-processors --strict
rg -n "TheoryOfTime|FrequencyDependentParameter|ExpParam|SampleTimer|GrainManager|PartialMachine|Math4096" projects/synth/include/synth/Dsp*.hpp
```

Expected: synth tests pass, OpenSpec validates, forbidden grep has no matches except allowed test mentions if explicitly scoped outside headers.

- [ ] **Step 2: Review OpenSpec task mapping**

Mark every implemented OpenSpec checkbox complete in `openspec/changes/add-smartgrid-dsp-processors/tasks.md`. If implementation intentionally diverged from any proposal/design/spec wording, update the artifact before marking the task complete.

- [ ] **Step 3: Run final status**

Run:

```bash
openspec status --change "add-smartgrid-dsp-processors"
git status --short
```

Expected: OpenSpec reports task progress complete; git status shows only intended implementation and planning files.

- [ ] **Step 4: Commit**

```bash
git add openspec/changes/add-smartgrid-dsp-processors projects/synth
git commit -m "chore: verify smartgrid dsp processor port"
```

**OpenSpec tasks covered:** 1.1, 7.1, 7.2, 7.3, 7.4, plus any remaining unchecked tasks from earlier slices.

---

## Execution Notes for This Session

- Use Codex implementer subagents through `plugins/xagent/scripts/xagent run --harness codex --subagent "<prompt>"`. Do not include `--thinking-level`.
- Use Claude Opus reviewers through `plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<review prompt>"`.
- Each implementer must write tests first, report the red command and expected failure, implement, run green tests, run dependency grep where relevant, commit, and write a report file under `.superpowers/sdd/`.
- Each reviewer must review against the task brief, the OpenSpec requirements, and the produced diff. Review findings are blocking if they violate the OpenSpec contract, introduce forbidden dependencies, skip TDD evidence, or add out-of-scope module/UI behavior.

## Self-Review

- Spec coverage: sdsp-24 maps to Tasks 1 and 6; sdsp-25 maps to Task 1; sdsp-26 maps to Task 2; sdsp-27 and sdsp-28 map to Task 3; sdsp-29 maps to Task 4; sdsp-30 maps to Task 5.
- Placeholder scan: no TBD/TODO/fill-in placeholders remain. Each task has exact files, interfaces, commands, and expected outcomes.
- Type consistency: public names introduced by earlier tasks are reused by later tasks: `Ola<Bits>`, `SpectralModel<Bits>`, `OlaResynthesizer<Bits>`, `BoundedAudioBuffer`, `BitCrusher`, `SampleRateReducer`, and `Meter`.
