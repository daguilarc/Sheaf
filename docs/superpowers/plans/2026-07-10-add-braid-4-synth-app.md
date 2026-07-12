# Braid 4 Synth App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Sheaf Patch-only Braid 4 synth app, its reusable VCO/matrix/DSP infrastructure, and the launcher/runtime/UI integration described by OpenSpec change `add-braid-4-synth-app`.

**Architecture:** Implement the shared JUCE-free synth primitives first, then the Braid module graph, then the app core/UI, and finally the Sheaf Patch runtime integration. Each task is TDD-first, independently committed, and reviewed by Claude xagent before OpenSpec checkboxes are marked complete.

**Tech Stack:** C++20, existing `projects/synth` Makefile targets, JUCE only in runtime/launcher/backend targets, OpenSpec `add-braid-4-synth-app`, native Codex implementer subagents, Claude xagent review gates.

## Global Constraints

- Change name: `add-braid-4-synth-app`.
- All new library/module/app-core/UI model code must remain JUCE-free unless the task explicitly touches `projects/synth/juce`, `projects/synth/runtime`, or `projects/synth/apps/sheaf-patch`.
- Do not edit unrelated untracked `projects/synth/miniapp/`.
- Use TDD: write failing tests, run them to observe failure, implement, run focused tests, then broader tests.
- Use app id `braid-4`, display name `Braid 4`, author `Sheaf`, category `synth`, minimum encoders `16`.
- Braid has exactly three parameter groups: stereo 2 voices, quad 4 voices with one modulator, mono 1 voice shared by eight oscillator-detail controls and sixteen matrix gains.
- Every Braid group has exactly two scenes; scene endpoints/blend are manager-global and initialized to `0/1`.
- Braid bank slot count is one, with sixteen positions. Braid bank maps positions `0`, `1`, `4..15`; positions `2` and `3` are disconnected. Matrix bank maps all sixteen positions row-major.
- All Braid and matrix parameters use `Color::Red`.
- Matrix DSP is linear and unclamped; only the app's modulation-source adapter clamps raw matrix outputs to `[-1,1]` and maps them to `[0,1]` with `0.5 + 0.5 * clamp(m, -1, 1)`.
- Internal Braid processing rate is exactly `4 * negotiatedHostRate`; at preferred 48 kHz host rate, internal processing is 192 kHz.
- Parameter timing conversion uses `1 - pow(1 - a48, 48000 / internalRate)` and `max(1, round(16 * internalRate / 48000))`.
- Final downsampling is a persistent allocation-free stereo 4:1 FIR decimator with 287 symmetric Kaiser-windowed-sinc taps, beta `9`, unity DC, normalized cutoff `11/96`, passband edge `5/48`, stopband edge `1/8`, passband ripple <= `0.1 dB`, stopband rejection >= `90 dB`, and group delay `143` internal samples.
- The actual output-channel policy is: one channel writes `0.5 * (left + right)`; two or more channels write left/right to channels `0/1` and silence to channels above `1`.
- Scope writer capacity is `6'553'600` internal frames, four channels.
- No standalone Braid executable, `Main.cpp`, or app bundle target.
- Baseline before implementation: `make -C projects/synth test` exited `0` on 2026-07-10.

---

## File Structure

- Modify `projects/synth/include/synth/ParameterModulation.hpp` and `projects/synth/src/ParameterModulation.cpp` for timing helpers and `ParameterGroup` timing reconfiguration.
- Modify `projects/synth/include/synth/DspBuffers.hpp` for `FirDecimator`, 4:1 FIR coefficients, and `OversampledOutputStage`; add to `DSP_HEADERS` only if split to a new header.
- Modify `projects/synth/include/synth/Modules.hpp` for `BipolarMatrixMixerModule<Size>` and `Braid4VcoModule`.
- Modify `projects/synth/include/synth/PortableUIBuilders.hpp` for shared waveform-building helpers extracted from MiniApp.
- Modify `projects/synth/apps/miniapp/MiniAppDraw.hpp`, `projects/synth/apps/miniapp/MiniAppUiModel.hpp`, and `projects/synth/apps/miniapp/MiniAppUI.hpp` only as required for shared waveform extraction. The old JUCE waveform wrapper is retired; portable draw nodes are rendered through the backend.
- Create `projects/synth/apps/braid-4/Braid4Core.hpp`, `Braid4.hpp`, `Braid4UiModel.hpp`, `Braid4Draw.hpp`, `Braid4UI.hpp`, `Braid4Registration.hpp`, and `README.md`.
- Modify `projects/synth/Makefile` to add Braid JUCE-free system/UI/benchmark test targets and app-local include paths.
- Modify `projects/synth/runtime/Shell.hpp` for a type-erased runtime session owner.
- Modify `projects/synth/apps/sheaf-patch/Main.cpp`, `Makefile`, and `LauncherHarnessTests.cpp` for generic session ownership and Braid registration.
- Modify tests: `projects/synth/tests/parameter_modulation_tests.cpp`, `dsp_tests.cpp`, `module_tests.cpp`, `portable_ui_tests.cpp`, `miniapp_system_tests.cpp`, plus new `braid4_system_tests.cpp` and `braid4_deadline_tests.cpp`.
- Modify JUCE tests when runtime integration changes: `projects/synth/juce/RuntimeShellSessionTests.cpp` and `MiniAppJuceBackendParityTests.cpp` if shared waveform parity coverage needs JUCE confirmation.

---

### Task 1: Rate-Aware Parameter Timing

**OpenSpec Tasks Covered:** 3.7, 3.8

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify/Test: `projects/synth/tests/parameter_modulation_tests.cpp`

**Interfaces:**
- Produces:
  - `float ConvertOnePoleAlpha(float referenceAlpha, double referenceRate, double processingRate);`
  - `std::size_t ConvertSampleInterval(std::size_t referenceInterval, double referenceRate, double processingRate);`
  - `struct ParameterProcessingTiming { float processLiteAlpha; std::size_t targetComputeIntervalSamples; float uiDisplayCenterAlpha; float uiDisplaySpreadAlpha; };`
  - `void ParameterGroup::ConfigureProcessingTiming(const ParameterProcessingTiming& timing);`
- Later tasks use these from `Braid4Core::PrepareToPlay`.

- [ ] **Step 1: Write failing timing conversion tests**

Add tests named:

```cpp
void parameter_timing_alpha_conversion_preserves_wall_clock_response();
void parameter_timing_interval_conversion_preserves_cadence();
void parameter_timing_rejects_invalid_inputs_without_mutation();
void parameter_group_timing_reconfiguration_preserves_topology_values_and_pointers();
void parameter_group_timing_reconfiguration_is_non_compounding();
```

The 48 kHz to 192 kHz alpha test must compute:

```cpp
const float a192 = synth::ConvertOnePoleAlpha(synth::kDefaultProcessLiteAlpha, 48000.0, 192000.0);
float y = 0.0f;
for (int i = 0; i < 4; ++i) y += a192 * (1.0f - y);
Require(std::fabs(y - synth::kDefaultProcessLiteAlpha) < 1e-5f, "four 192k steps equal one 48k step");
```

- [ ] **Step 2: Verify red**

Run: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`

Expected: compile fails because the new timing helpers/API do not exist.

- [ ] **Step 3: Implement timing helpers and API**

Add the declarations above to `ParameterModulation.hpp`; implement in `ParameterModulation.cpp` with validation:

```cpp
if (!(std::isfinite(referenceRate) && referenceRate > 0.0 &&
      std::isfinite(processingRate) && processingRate > 0.0)) {
    throw std::invalid_argument("processing timing rates must be positive and finite");
}
if (!(referenceAlpha >= 0.0f && referenceAlpha <= 1.0f)) {
    throw std::invalid_argument("one-pole alpha must be in [0,1]");
}
```

`ConfigureProcessingTiming` must validate before mutation and update only `config_.processLiteAlpha`, `config_.targetComputeIntervalSamples`, `config_.uiDisplayCenterAlpha`, and `config_.uiDisplaySpreadAlpha`.

- [ ] **Step 4: Verify green**

Run: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`

Expected: all parameter modulation tests pass.

- [ ] **Step 5: Commit**

```bash
git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/tests/parameter_modulation_tests.cpp
git commit -m "feat: add rate-aware parameter timing"
```

---

### Task 2: Fixed-Storage FIR Decimator and Oversampled Output Stage

**OpenSpec Tasks Covered:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

**Files:**
- Modify: `projects/synth/include/synth/DspBuffers.hpp`
- Modify/Test: `projects/synth/tests/dsp_tests.cpp`
- Modify: `projects/synth/Makefile` only if a new DSP header is split out.

**Interfaces:**
- Produces:
  - `template<std::size_t Factor, std::size_t Channels, std::size_t Taps> class FirDecimator`
  - `std::span<const double, 287> FourToOneDecimatorCoefficients()` or an equivalent `constexpr std::array<double, 287>`
  - `template<std::size_t Factor, std::size_t Channels, typename Decimator> class OversampledOutputStage`
- `FirDecimator::ProcessFrame(std::span<const float, Channels> input, std::span<float, Channels> output)` returns `true` only when one host output frame is ready.
- `OversampledOutputStage::ProcessHostFrame(std::uint64_t hostSampleIndex, Generator&& generator)` calls the generator for `Factor` internal subframes and returns `std::array<float, Channels>`.

- [ ] **Step 1: Write failing DSP tests**

Add tests named:

```cpp
void fir_decimator_factor_four_cadence_survives_block_splits();
void fir_decimator_stereo_history_is_independent_and_reset_deterministic();
void fir_decimator_four_to_one_coefficients_are_symmetric_with_expected_group_delay();
void fir_decimator_four_to_one_frequency_response_meets_spec();
void oversampled_output_stage_calls_generator_with_exact_internal_indices();
void oversampled_output_stage_preserves_decimator_state_across_host_blocks();
```

Frequency-response tests should measure normalized edges `5.0/48.0` and `1.0/8.0` using DFT of the coefficient table and require ripple <= `0.1 dB` and stopband <= `-90 dB`.

- [ ] **Step 2: Verify red**

Run: `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`

Expected: compile fails because the new templates/coefficient accessor do not exist.

- [ ] **Step 3: Implement the templates**

Implement fixed arrays only. `FirDecimator` owns:

```cpp
std::array<double, Taps> coefficients_;
std::array<std::array<float, Taps>, Channels> history_{};
std::size_t writeIndex_ = 0;
std::size_t phase_ = 0;
```

After each input frame, advance phase modulo `Factor`; when phase wraps, compute one convolution per channel from persistent history. Do not allocate, log, lock, or use whole-buffer copies in `ProcessFrame`.

- [ ] **Step 4: Add the 4:1 FIR coefficient table**

Use the reviewed design: 287 taps, Kaiser beta `9`, normalized cutoff `11/96`, unity DC. Generate coefficients before committing or embed a static immutable table. Tests must prove the declared passband/stopband, not trust comments.

- [ ] **Step 5: Verify green**

Run: `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`

Expected: all DSP tests pass.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/include/synth/DspBuffers.hpp projects/synth/tests/dsp_tests.cpp projects/synth/Makefile
git commit -m "feat: add fixed-ratio oversampled decimation"
```

---

### Task 3: Reusable Matrix and Braid VCO Modules

**OpenSpec Tasks Covered:** 1.1, 1.2, 1.3, 2.1, 2.2, 2.3

**Files:**
- Modify: `projects/synth/include/synth/Modules.hpp`
- Modify/Test: `projects/synth/tests/module_tests.cpp`

**Interfaces:**
- Produces:
  - `template<std::size_t Size> class BipolarMatrixMixerModule`
  - `class Braid4VcoModule`
  - `struct Braid4VcoModule::ParameterIds { ParameterId x; ParameterId y; std::array<ParameterId,4> tune, phase, shape, gain, pmIndex, frequency; }` may be split by group if clearer.
  - `Braid4VcoModule::RegisterParameters(ParameterManager&, ParameterGroup& stereo, ParameterGroup& quad, ParameterGroup& mono, std::string_view prefix = "Braid 4")`
  - `Braid4VcoModule::RegisterToBank(Bank&)`
  - `Braid4VcoModule::SetInput(ParameterManager&)`, `Process()`, `OutputLeft()`, `OutputRight()`, `OscillatorOutput(i)`, `RawOutput(i)`, `PopulateUIState(...)`.

- [ ] **Step 1: Write failing matrix module tests**

Test row-major registration, identity defaults, bipolar anchors `-1/-0.25/0/0.25/1`, cross-routing, unclamped sums, pointer stability, compatible pre-populated mono group, repeat registration, capacity failure, incompatible group shape, and bank capacity failure.

- [ ] **Step 2: Write failing Braid VCO module tests**

Test three group shapes and two scenes, fourteen red parameters, sparse bank cells `2/3`, all mapping anchors/ranges, sample-rate validation, natural VCO input mapping, `phase * pmIndex`, post-gain outputs, equal-power XY corners/center, coherent-source gain, and four scope/UI-state connections.

- [ ] **Step 3: Verify red**

Run: `make -C projects/synth build/module_tests && projects/synth/build/module_tests`

Expected: compile fails because the two new modules do not exist.

- [ ] **Step 4: Implement `BipolarMatrixMixerModule<Size>`**

Follow existing header-only module style in `WavetableVcoModule`. Use member arrays:

```cpp
std::array<float, Size> inputs_{};
std::array<float, Size> outputs_{};
std::array<ParameterId, Size * Size> parameterIds_{};
```

`Process()` computes `outputs_[row] = sum(inputs_[column] * gain[row][column])` using `GetBipolarZeroBasedExponential(1.0f, 0.25f, 0, parameterId)`.

- [ ] **Step 5: Implement `Braid4VcoModule`**

Use four `DefaultWavetableVco` processors. Set VCO input:

```cpp
freq = (baseFrequencyHz * tuneMultiplier) / sampleRate_;
phaseOffset = phaseCycles * pmIndex;
wavetablePosition = shape;
maxFreq = 0.5f;
```

Apply bipolar post-gain to `oscillatorOutputs_`. Compute stereo with separable equal-power XY. Scope holders attach to underlying VCO processors so traces remain pre-gain.

- [ ] **Step 6: Verify green**

Run: `make -C projects/synth build/module_tests && projects/synth/build/module_tests`

Expected: all module tests pass.

- [ ] **Step 7: Commit**

```bash
git add projects/synth/include/synth/Modules.hpp projects/synth/tests/module_tests.cpp
git commit -m "feat: add Braid module primitives"
```

---

### Task 4: Shared Portable Waveform Drawing

**OpenSpec Tasks Covered:** 4.1, 4.2, 4.3, 4.4

**Files:**
- Modify: `projects/synth/include/synth/PortableUIBuilders.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppDraw.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppUiModel.hpp`
- Modify/Test: `projects/synth/tests/portable_ui_tests.cpp`
- Modify/Test: `projects/synth/juce/MiniAppJuceBackendParityTests.cpp` if snapshots currently exercise waveform draw behavior there.

**Interfaces:**
- Produces shared JUCE-free types in `synth::ui`:
  - `struct WaveformLayerDrawState`
  - `std::vector<DrawCommand> BuildScopeWaveformCommands(std::span<const WaveformLayerDrawState> layers, Bounds bounds, float minY, float maxY, std::size_t numSamples, bool drawMarkers);`
- MiniApp keeps `BuildVcoWaveformCommands`/`BuildLfoWaveformCommands` wrappers for compatibility, implemented by delegating to the shared helper.

- [ ] **Step 1: Write failing portable UI tests**

Add tests that feed fake scope data into two or four non-overlapping bounds and assert every generated polyline point remains inside its own bounds. Add a MiniApp parity test that compares old expected command counts/colors/clipping through the wrapper.

- [ ] **Step 2: Verify red**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: compile fails because the shared helper does not exist.

- [ ] **Step 3: Extract shared helper**

Move `ScopePathMath`, `WaveformLayerDrawState`, and `BuildWaveformCommands` logic out of `MiniAppDraw.hpp` into `PortableUIBuilders.hpp` under `namespace synth::ui`. Keep MiniApp's wrapper names by forwarding.

- [ ] **Step 4: Retire the old JUCE waveform component wrapper**

Remove the unused JUCE waveform component wrapper once MiniApp and Braid render waveform draw nodes through the portable backend.

- [ ] **Step 5: Verify green**

Run:

```bash
make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests
make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests
```

If JUCE parity changed, also run the relevant JUCE backend test target from `projects/synth/juce`.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/include/synth/PortableUIBuilders.hpp projects/synth/apps/miniapp/MiniAppDraw.hpp projects/synth/apps/miniapp/MiniAppUiModel.hpp projects/synth/apps/miniapp/MiniAppUI.hpp projects/synth/tests/portable_ui_tests.cpp projects/synth/juce/MiniAppJuceBackendParityTests.cpp
git commit -m "refactor: share scope waveform drawing"
```

---

### Task 5: Braid 4 JUCE-Free Core and Audio Graph

**OpenSpec Tasks Covered:** 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8

**Files:**
- Create: `projects/synth/apps/braid-4/Braid4Core.hpp`
- Create: `projects/synth/apps/braid-4/Braid4.hpp`
- Create: `projects/synth/apps/braid-4/README.md`
- Create/Test: `projects/synth/tests/braid4_system_tests.cpp`
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Produces `namespace synth_braid4`.
- `class Braid4Core` has `Config()`, `Init(AppContext*)`, `PrepareToPlay(double,int)`, `ProcessBlock(AudioBlock&)`, and accessors for groups, banks, slot, scope/UI state, raw matrix outputs, normalized matrix sources, internal rate, and decimator latency.
- `class Braid4 : public Braid4Core` attaches the portable UI in Task 6; for Task 5 it may expose a placeholder surface only if tests require `SynthApplication`.

- [ ] **Step 1: Add failing Braid system test target**

Add `BRAID4_SYSTEM_TEST_BIN := $(BUILD_DIR)/braid4_system_tests` to `projects/synth/Makefile`, compile with `-Iapps/braid-4`, and add it to `test`.

- [ ] **Step 2: Write failing initialization tests**

Test exactly three groups, two scenes each, global endpoints `0/1`, one slot, two banks, mono group with 24 top-level params, native voice counts in slot state, red parameters, blank Braid cells `2/3`, and modulation-view materialization for four quad params.

- [ ] **Step 3: Write failing graph/rate tests**

Use `SynthRig` or direct `Braid4Core` to test host rates 44.1/48/96 kHz, internal rates 176.4/192/384 kHz, exact four internal subframes per host frame, sample indices `4 * hostSample + subframe`, one-internal-sample matrix feedback delay, normalized matrix source anchors, decimator continuity, and output channel policy.

- [ ] **Step 4: Verify red**

Run: `make -C projects/synth build/braid4_system_tests && projects/synth/build/braid4_system_tests`

Expected: compile fails because Braid app files do not exist.

- [ ] **Step 5: Implement `Braid4Core`**

Follow `MiniAppCore` structure, but create:

```cpp
static constexpr std::size_t kOscillatorCount = 4;
static constexpr std::size_t kScopeFrames = 6'553'600;
synth::Braid4VcoModule vcoModule_;
synth::BipolarMatrixMixerModule<4> matrixModule_;
synth::ScopeWriter scopeWriter_{4, kScopeFrames};
std::array<synth::ScopeWriterHolder, 4> scopeHolders_;
std::array<float, 4> normalizedMatrixSources_{};
```

Process order per internal sample: process all three groups, set/process VCO, copy post-gain outputs to matrix, set/process matrix gains, update normalized matrix sources, `UpdateModValues(quadGroup)`, advance scope, feed stereo into output stage. Publish scope and UI state once per host block.

- [ ] **Step 6: Implement `PrepareToPlay` and output policy**

Compute `internalRate = 4.0 * sampleRate`; configure parameter timing on all three groups from 48 kHz defaults; reset VCO sample rate, decimator/stage state, and counters. Host output write policy must match the Global Constraints.

- [ ] **Step 7: Verify green**

Run: `make -C projects/synth build/braid4_system_tests && projects/synth/build/braid4_system_tests`

Expected: all Braid system tests pass.

- [ ] **Step 8: Commit**

```bash
git add projects/synth/apps/braid-4/Braid4Core.hpp projects/synth/apps/braid-4/Braid4.hpp projects/synth/apps/braid-4/README.md projects/synth/tests/braid4_system_tests.cpp projects/synth/Makefile
git commit -m "feat: add Braid 4 core graph"
```

---

### Task 6: Braid 4 Portable Main Screen

**OpenSpec Tasks Covered:** 6.1, 6.2, 6.3

**Files:**
- Create: `projects/synth/apps/braid-4/Braid4Draw.hpp`
- Create: `projects/synth/apps/braid-4/Braid4UiModel.hpp`
- Create: `projects/synth/apps/braid-4/Braid4UI.hpp`
- Modify: `projects/synth/apps/braid-4/Braid4.hpp`
- Modify/Test: `projects/synth/tests/portable_ui_tests.cpp`
- Modify/Test: `projects/synth/tests/braid4_system_tests.cpp`
- Modify: `projects/synth/Makefile`

**Interfaces:**
- `class Braid4UiSurface final : public synth::ui::Surface`
- Stable IDs:
  - root `braid4.root`
  - waveform `braid4.scope.0..3`
  - encoder `braid4.encoder.0..15`
  - scene buttons `braid4.scene.0..1`
  - blend `braid4.scene.blend`
- Actions dispatch through existing `MessageIn` routes: encoder drag/push, bank select, scene select, scene blend.

- [ ] **Step 1: Write failing UI tests**

Test the built tree contains a 2x2 waveform grid, a 4x4 encoder grid bound to slot `0` positions `0..15`, a global two-scene strip, disconnected Braid cells `2/3`, matrix-bank reuse of the same encoder IDs, stable node IDs, and no scrolling at default size.

- [ ] **Step 2: Verify red**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: fails because Braid UI files do not exist.

- [ ] **Step 3: Implement layout/model/draw**

Use near-black background and red accents through portable `DrawCommand`s. Use the shared waveform helper from Task 4 with one scope layer per quadrant. Keep default `Config()` size large enough for complete grids without scrolling.

- [ ] **Step 4: Attach UI to `Braid4`**

`Braid4::Init` calls `Braid4Core::Init(context)` and `ui_.Attach(context, this)`. `PortableSurface()` returns `ui_`.

- [ ] **Step 5: Verify green**

Run:

```bash
make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests
make -C projects/synth build/braid4_system_tests && projects/synth/build/braid4_system_tests
```

Expected: Braid UI and core tests pass with no JUCE include path.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/apps/braid-4/Braid4Draw.hpp projects/synth/apps/braid-4/Braid4UiModel.hpp projects/synth/apps/braid-4/Braid4UI.hpp projects/synth/apps/braid-4/Braid4.hpp projects/synth/tests/portable_ui_tests.cpp projects/synth/tests/braid4_system_tests.cpp projects/synth/Makefile
git commit -m "feat: add Braid 4 portable surface"
```

---

### Task 7: Generic Runtime Session Ownership

**OpenSpec Tasks Covered:** 7.1, 7.2, 7.3, 7.4

**Files:**
- Modify: `projects/synth/runtime/Shell.hpp`
- Modify: `projects/synth/apps/sheaf-patch/Main.cpp`
- Modify/Test: `projects/synth/juce/RuntimeShellSessionTests.cpp`
- Modify/Test: `projects/synth/apps/sheaf-patch/LauncherHarnessTests.cpp`

**Interfaces:**
- Produces:
  - `class RuntimeSessionOwner { public: virtual ~RuntimeSessionOwner() = default; virtual juce::Component& Component() = 0; };`
  - `template<synth::SynthApplication App> class RuntimeSessionOwnerFor final : public RuntimeSessionOwner`
  - `template<synth::SynthApplication App> std::unique_ptr<RuntimeSessionOwner> MakeRuntimeSessionOwner(synth::RuntimeDataPaths paths);`

- [ ] **Step 1: Write failing runtime tests**

Add coverage proving MiniApp can be constructed, displayed, and destroyed through `RuntimeSessionOwner` and that `Component()` returns the contained `RuntimeShellSession<MiniApp>` component.

- [ ] **Step 2: Write failing launcher ownership test**

Add test/harness seam proving `SheafPatchApplication` has one generic active session path and no MiniApp-specific launch method is required. If direct app introspection is hard, cover the exported factory/helper and registration path used by `Main.cpp`.

- [ ] **Step 3: Verify red**

Run the relevant runtime/sheaf-patch test targets:

```bash
make -C projects/synth/apps/sheaf-patch test
```

Expected: compile fails because the generic session owner does not exist.

- [ ] **Step 4: Implement the owner in `Shell.hpp`**

The holder owns `RuntimeShellSession<App> session_;` and returns `session_.Component()`. Preserve `RuntimeShellSession` destructor ordering unchanged.

- [ ] **Step 5: Migrate Sheaf Patch main**

Replace `std::unique_ptr<RuntimeShellSession<MiniApp>> miniappSession_` with `std::unique_ptr<RuntimeSessionOwner> activeSession_`. Registration lambdas call a generic launch helper that constructs the correct `RuntimeSessionOwnerFor<App>`.

- [ ] **Step 6: Verify green**

Run:

```bash
make -C projects/synth/apps/sheaf-patch test
```

Expected: launcher harness passes.

- [ ] **Step 7: Commit**

```bash
git add projects/synth/runtime/Shell.hpp projects/synth/apps/sheaf-patch/Main.cpp projects/synth/juce/RuntimeShellSessionTests.cpp projects/synth/apps/sheaf-patch/LauncherHarnessTests.cpp
git commit -m "feat: type erase runtime sessions"
```

---

### Task 8: Braid Registration and Sheaf Patch Integration

**OpenSpec Tasks Covered:** 8.1, 8.2, 8.3, 8.4

**Files:**
- Create: `projects/synth/apps/braid-4/Braid4Registration.hpp`
- Modify: `projects/synth/apps/sheaf-patch/Main.cpp`
- Modify: `projects/synth/apps/sheaf-patch/Makefile`
- Modify/Test: `projects/synth/apps/sheaf-patch/LauncherHarnessTests.cpp`
- Modify/Test: `projects/synth/tests/contract_tests.cpp`
- Modify: `projects/synth/README.md`

**Interfaces:**
- Produces:
  - `synth_braid4::Braid4Manifest()`
  - `template <typename LaunchFn> synth::SynthAppRegistration MakeBraid4Registration(LaunchFn&& launchFn)`

- [ ] **Step 1: Write failing registration tests**

Test manifest metadata exactly, sorted registry order with `braid-4`, `SheafPatchDataPathsForApp("braid-4")`, launcher row formatting, and launch invocation through the generic session factory.

- [ ] **Step 2: Verify red**

Run: `make -C projects/synth/apps/sheaf-patch test`

Expected: compile fails because Braid registration does not exist.

- [ ] **Step 3: Implement registration and launcher wiring**

Create `Braid4Registration.hpp` mirroring MiniApp registration but with the Braid manifest. Add it to Sheaf Patch `APP_HEADERS`. In `Main.cpp`, push both MiniApp and Braid registrations and call `SortSynthAppRegistrationsById` before constructing the launcher if the launcher does not already sort.

- [ ] **Step 4: Update docs**

Update `projects/synth/README.md` and `projects/synth/apps/braid-4/README.md` to state Braid is Sheaf Patch-only, no standalone target, uses 4x host-rate internal processing, and final 4:1 FIR decimation.

- [ ] **Step 5: Verify green**

Run:

```bash
make -C projects/synth/apps/sheaf-patch test
make -C projects/synth sheaf-patch
```

Expected: launcher harness passes and Sheaf Patch builds with Braid included.

- [ ] **Step 6: Commit**

```bash
git add projects/synth/apps/braid-4/Braid4Registration.hpp projects/synth/apps/sheaf-patch/Main.cpp projects/synth/apps/sheaf-patch/Makefile projects/synth/apps/sheaf-patch/LauncherHarnessTests.cpp projects/synth/tests/contract_tests.cpp projects/synth/README.md projects/synth/apps/braid-4/README.md
git commit -m "feat: register Braid 4 in Sheaf Patch"
```

---

### Task 9: Final Verification, Deadline Coverage, and OpenSpec Sync

**OpenSpec Tasks Covered:** 9.1, 9.2, 9.3, 9.4, 9.5 plus any previous OpenSpec tasks not yet checked off.

**Files:**
- Create/Test: `projects/synth/tests/braid4_deadline_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `openspec/changes/add-braid-4-synth-app/tasks.md`
- Modify/Create: `.superpowers/sdd/progress.md`

**Interfaces:**
- Produces final verified state, no new product API unless benchmark test harness needs an app-local helper.

- [ ] **Step 1: Add failing deadline/continuity test target**

Add `BRAID4_DEADLINE_TEST_BIN := $(BUILD_DIR)/braid4_deadline_tests` and tests for 256-frame blocks at 44.1, 48, and 96 kHz. The test must assert average callback CPU time <= 25% and p99 <= 50% of real-time block duration on the project baseline runner.

- [ ] **Step 2: Verify and tune implementation if needed**

Run: `make -C projects/synth build/braid4_deadline_tests && projects/synth/build/braid4_deadline_tests`

If the deadline test fails because implementation is inefficient, optimize within existing spec boundaries. Do not weaken thresholds without updating OpenSpec and rerunning Claude Opus spec review.

- [ ] **Step 3: Run full library and app verification**

Run:

```bash
make -C projects/synth build test
make -C projects/synth/apps/sheaf-patch test
make -C projects/synth sheaf-patch
openspec validate add-braid-4-synth-app --strict
```

Expected: all commands exit `0`.

- [ ] **Step 4: Smoke-test through Sheaf Patch**

Use the `smoke-test` skill if a live Conductor launch is required. Verify startup, Braid row activation, both banks, finite stereo processing, four scopes, sixteen encoders, patch save/load under `patches/braid-4`, device-rate switching, and clean shutdown. Record hardware-only gaps separately rather than blocking software verification.

- [ ] **Step 5: Sync OpenSpec checklist**

Only after the task's implementation, review, and verification evidence exists, update `openspec/changes/add-braid-4-synth-app/tasks.md` checkboxes for all covered items. Keep the OpenSpec change active; do not archive unless separately asked.

- [ ] **Step 6: Final Claude xagent branch review**

Generate a review package from branch base to `HEAD`, run a Claude xagent review, fix Critical/Important findings with one native Codex fix subagent, re-review, then proceed only when clean.

- [ ] **Step 7: Commit final verification sync**

```bash
git add projects/synth/tests/braid4_deadline_tests.cpp projects/synth/Makefile openspec/changes/add-braid-4-synth-app/tasks.md .superpowers/sdd/progress.md
git commit -m "test: verify Braid 4 integration"
```
