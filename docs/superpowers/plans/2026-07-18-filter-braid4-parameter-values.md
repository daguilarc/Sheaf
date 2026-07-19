# Filter Braid 4 Parameter Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-virtual two-phase parameter-processing seam and use it to one-pole filter all 80 oscillator-owned Braid 4 parameter caches, including cutoff controls and every audible/LFO matrix entry.

**Architecture:** `Parameter` and `ParameterGroup` split cache sampling from UI smoothing while preserving their combined convenience APIs. The existing `OnePoleLowPass` accepts a precomputed alpha, and Braid 4 owns eight compile-time oscillator bundles with ten independent states each; output matrix row determines oscillator ownership. Per internal sample, Braid runs phase 1, computes eight alphas from pre-Mod-LPF cutoff caches, replaces 80 caches, runs phase 2, then extracts module and matrix inputs.

**Tech Stack:** C++20, JUCE-free synth headers/core, repository test macros, GNU Make, OpenSpec.

## Global Constraints

- Preserve Braid 4's three parameter groups, fourteen parameters per Braid module, four banks, registration order, stable IDs, and one-internal-sample matrix feedback timing.
- Positions `8..11` become Mod LPF Cutoff 1..4 with normalized default `0` and exponential natural range `0.1..20000 Hz`; LFO frequency octave shifting never changes this range.
- Filter exactly ten independent values per oscillator: Tune/Phase/Shape/Gain voice `i`, Cutoff `i`, Frequency `i`, and matrix `[i][0..3]`; matrix row is output and supplies ownership/cutoff.
- Filter all 16 audible and all 16 LFO matrix entries. Filter cutoff caches themselves. Exclude only X/Y and recursively materialized modulation-depth parameters.
- Compute one alpha per oscillator per internal sample from the cutoff cache after ordinary parameter-state phase-1 slew but before the application Mod LPF, then reuse it across all ten states.
- Run phase 2 only after replacements so DSP mapping and UI smoothing consume the same filtered cache.
- Add no allocation, virtual dispatch, callback, runtime name lookup, or recursive local-parameter traversal to the audio hot path.
- Follow red-green-refactor TDD: each production behavior requires a focused failing test observed before implementation.
- Preserve the unrelated untracked `projects/synth/browser/package-lock.json` and `projects/synth/miniapp/` paths.

---

### Task 1: Two-Phase Parameter Processing Contract

**OpenSpec coverage:** 1.1, 1.2, 1.3.

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

**Interfaces:**
- Produces: `Parameter::ProcessLitePhase1()`, `Parameter::ReplaceCachedKnobValue(std::size_t, float)`, `Parameter::ProcessLitePhase2()`, `Parameter::ProcessSamplePhase1(std::uint64_t)`, `Parameter::ProcessSamplePhase2()`.
- Produces: `ParameterGroup::ProcessSamplePhase1(std::uint64_t)` and `ParameterGroup::ProcessSamplePhase2()`.
- Preserves: `ProcessLite()` and `ProcessSample()` as phase-1-then-phase-2 wrappers and `ParameterProcessingObserver::topLevelProcessLiteCalls` as one count per top-level phase-1 visit.

- [ ] **Step 1: Add focused phase tests before implementation**

Add test cases beside the existing `process_lite_*` and group traversal cases. The assertions must exercise the public API, including this core sequence:

```cpp
parameter.ProcessLitePhase1();
const float rawCached = parameter.CachedKnobValue(0);
const float centerBeforePhase2 = parameter.UIDisplayCenter(0);
parameter.ReplaceCachedKnobValue(0, 0.25f);
REQUIRE_NEAR(parameter.GetRaw(0), rawCached, 0.000001f);
REQUIRE_NEAR(parameter.UIDisplayCenter(0), centerBeforePhase2, 0.000001f);
parameter.ProcessLitePhase2();
REQUIRE_NEAR(parameter.CachedKnobValue(0), 0.25f, 0.000001f);
```

Cover replacement clamping at `-1 -> 0` and `2 -> 1`, wrapper equivalence against explicit phases, recompute cadence in `ProcessSamplePhase1`, no phase-2 target recompute, and group traversal that visits only top-level roots even when nested depths exist.

- [ ] **Step 2: Run RED parameter tests**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
```

Expected: compilation fails because the phase/replacement APIs do not exist. Confirm the errors name the requested methods rather than test syntax mistakes.

- [ ] **Step 3: Declare the phase APIs**

Add these declarations without exposing cache storage:

```cpp
void ProcessLitePhase1();
void ReplaceCachedKnobValue(std::size_t voiceIx, float normalizedValue);
void ProcessLitePhase2();
void ProcessLite();
void ProcessSamplePhase1(std::uint64_t sampleIndex);
void ProcessSamplePhase2();
void ProcessSample(std::uint64_t sampleIndex);
```

Add the two matching group declarations before its existing `ProcessSample` declaration.

- [ ] **Step 4: Split implementation without changing wrapper behavior**

Move current/state/depth slew and `GetRaw()` cache sampling into phase 1. Implement replacement as bounds-checked, normalized clamping:

```cpp
void Parameter::ReplaceCachedKnobValue(std::size_t voiceIx, float normalizedValue) {
    if (voiceIx >= currentKnobValues_.size()) {
        throw std::out_of_range("parameter cached knob voice index out of range");
    }
    currentKnobValues_[voiceIx] = std::clamp(normalizedValue, 0.0f, 1.0f);
}
```

Move only UI display-center/spread EMA updates into phase 2. Make both convenience wrappers call their phases consecutively. Group phase 1 performs top-level cadence/phase-1 traversal and increments the existing observer counter; group phase 2 visits the same top-level list without touching the observer.

- [ ] **Step 5: Update simulation-oracle processing**

Split the simulator's cache sampling from UI smoothing using the same ordering, and keep its combined helper delegating to the two simulator phases. Extend randomized actions only as needed to compare the explicit phase path with the real implementation; do not model application-specific Braid filtering here.

- [ ] **Step 6: Run GREEN parameter tests**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected: exit `0`, including focused phase tests and all existing randomized parameter/persistence simulations.

- [ ] **Step 7: Commit Task 1**

```bash
git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/tests/parameter_modulation_tests.cpp
git commit -m "feat(synth): split parameter sample processing phases"
```

---

### Task 2: One-Pole Hot Path and Braid Module Control Migration

**OpenSpec coverage:** 2.1, 2.2, 3.1, 3.2, 3.3.

**Files:**
- Modify: `projects/synth/include/synth/DspFilters.hpp`
- Modify: `projects/synth/include/synth/Modules.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`
- Modify: `projects/synth/tests/module_tests.cpp`

**Interfaces:**
- Consumes: existing `OnePoleLowPass::AlphaFromNatFreq(float)` and existing module registration/mapping helpers.
- Produces: `OnePoleLowPass::ProcessWithAlpha(float value, float alpha)` and `OnePoleLowPass::Reset(float output)`.
- Produces: `Braid4VcoModule::ParameterIds::modulationCutoff`, replacing `pmIndex` at identical IDs/positions; cutoff constants `kMinModulationCutoffHz = 0.1f` and `kMaxModulationCutoffHz = 20000.0f` are public for Braid core/tests.
- Removes: `OscillatorInput::pmIndex`, PM mapped caches, and `phaseCycles * pmIndex`; phase offset becomes `phaseCycles`.

- [ ] **Step 1: Add DSP and module tests first**

Extend the one-pole test to compare both paths and reset:

```cpp
const float alpha = synth::OnePoleLowPass::AlphaFromNatFreq(1000.0f / 48000.0f);
synth::OnePoleLowPass cutoffPath;
synth::OnePoleLowPass alphaPath;
REQUIRE_NEAR(cutoffPath.Process({.value = 0.75f, .cutoff = 1000.0f / 48000.0f}),
             alphaPath.ProcessWithAlpha(0.75f, alpha), 0.000001f);
alphaPath.Reset(0.4f);
REQUIRE_NEAR(alphaPath.m_output, 0.4f, 0.000001f);
```

Update Braid module tests to require `modulationCutoff[0..3]` at IDs `6..9`, names/short names containing `Mod LPF`, defaults `0`, positions `8..11`, unchanged colors, and absence of PM multiplication:

```cpp
SetAndSettle(manager, ids.quad.phase, 0.75f);
module.SetInput(manager);
REQUIRE_NEAR(module.CurrentInput().oscillators[0].vco.phaseOffset,
             module.CurrentInput().oscillators[0].phaseCycles, 0.0001f);
```

Assert matrix `Parameters()[row * 4 + column]` names remain `R{row+1}C{column+1}` and document/test row as output ownership.

- [ ] **Step 2: Run RED DSP/module tests**

Run:

```bash
make -C projects/synth build/dsp_tests build/module_tests
```

Expected: compilation failures for `ProcessWithAlpha`, `Reset`, and `modulationCutoff` or assertion failures from remaining PM labels/phase multiplication.

- [ ] **Step 3: Extend the existing one-pole**

Implement one update equation and delegate the cutoff path:

```cpp
void Reset(float output = 0.0f) { m_output = output; }

float ProcessWithAlpha(float value, float alpha) {
    m_alpha = std::clamp(alpha, 0.0f, 1.0f);
    m_output += m_alpha * (value - m_output);
    return m_output;
}

float Process(const Input& input) {
    return ProcessWithAlpha(input.value, AlphaFromNatFreq(input.cutoff));
}
```

Do not add another filter class or dynamic dispatch.

- [ ] **Step 4: Migrate Braid module controls in place**

Rename the ID array, registration names, short names, cached fields, bank mappings, and test references from PM Index to Mod LPF Cutoff while preserving array position and parameter count. Remove PM natural-unit mapping from `SetInput`; keep cutoff IDs available for the application but do not derive filter alpha inside the module. Set:

```cpp
oscillator.vco.phaseOffset = oscillator.phaseCycles;
```

Keep `frequencyOctaveShift` applied only to oscillator Frequency. Matrix processing remains unchanged; clarify its `row`/`column` naming as output/input without changing row-major order.

- [ ] **Step 5: Run GREEN DSP/module tests**

Run:

```bash
make -C projects/synth build/dsp_tests build/module_tests && projects/synth/build/dsp_tests && projects/synth/build/module_tests
```

Expected: exit `0`; existing filter transfer/UI behavior, module registration, bank layout, mapping, colors, and matrix arithmetic remain green.

- [ ] **Step 6: Commit Task 2**

```bash
git add projects/synth/include/synth/DspFilters.hpp projects/synth/include/synth/Modules.hpp projects/synth/tests/dsp_tests.cpp projects/synth/tests/module_tests.cpp
git commit -m "feat(synth): replace braid pm depth with filter cutoff"
```

---

### Task 3: Braid 4 Oscillator-Owned Cache Filtering

**OpenSpec coverage:** 4.1 through 4.6.

**Files:**
- Modify: `projects/synth/apps/braid-4/Braid4Core.hpp`
- Modify: `projects/synth/tests/braid4_system_tests.cpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp` only if existing label assertions require the new Cutoff names.

**Interfaces:**
- Consumes: Task 1 phase/replacement APIs and Task 2 one-pole/module APIs.
- Produces: compile-time `OscillatorParameterFilters`/family storage owned by `Braid4Core`, with ten independent `OnePoleLowPass` states per oscillator.
- Produces: `ProcessParameterPhase1(internalIndex)`, `FilterParameterCaches()`, and `ProcessParameterPhase2()` private sequencing helpers (names may vary only if equally explicit).
- Produces: narrow bounds-checked test inspection for filter output/alpha only when behavior cannot be verified through public parameter/module state.

- [ ] **Step 1: Add system tests for ownership, response, ordering, and migration**

Update every `pmIndex` reference to `modulationCutoff`, bank labels, local-index assertions, and patch persistence values. Add focused tests that:

- set all owned caches to distinct values and prove each quad voice, cutoff, frequency, and each `[row][column]` matrix entry moves with output row's cutoff;
- prove same-column entries in different rows use different alphas and all four columns in one row use the same alpha but independent state;
- prove audible/LFO paths are independent and LFO cutoff is not shifted by `frequencyOctaveShift`;
- prove X/Y is unchanged by application filtering and a materialized nested depth adds no filter state/visit;
- prove phase 2/UI state and module/matrix extraction see the replaced cache;
- prove prepare/reset seeds state from current caches and matrix publication still reaches parameter phase 1 after exactly one internal sample.

Use a high normalized cutoff for short response tests. For expected alpha:

```cpp
const float cutoffHz = 0.1f * std::pow(20000.0f / 0.1f, preModLpfCutoff);
const float alpha = synth::OnePoleLowPass::AlphaFromNatFreq(
    cutoffHz / static_cast<float>(core.InternalSampleRate()));
const float expected = previous + alpha * (input - previous);
```

- [ ] **Step 2: Run RED Braid tests**

Run:

```bash
make -C projects/synth build/braid4_system_tests build/portable_ui_tests
```

Expected: compilation/assertion failures for renamed cutoff IDs and absent Braid filtering/inspection behavior.

- [ ] **Step 3: Add fixed filter storage and explicit ownership**

Include `synth/DspFilters.hpp` and add fixed storage shaped by oscillator ownership:

```cpp
struct OscillatorParameterFilters {
    std::array<synth::OnePoleLowPass, 4> quad;
    synth::OnePoleLowPass cutoff;
    synth::OnePoleLowPass frequency;
    std::array<synth::OnePoleLowPass, 4> matrixRow;
};

using ParameterFilterFamily = std::array<OscillatorParameterFilters, kOscillatorCount>;
ParameterFilterFamily braidParameterFilters_{};
ParameterFilterFamily lfoParameterFilters_{};
```

Index quad states consistently as Tune, Phase, Shape, Gain. Resolve ownership from module `ParameterIds` and matrix `Parameters()[row * kOscillatorCount + column]`; do not build a runtime registry or traverse group-local parameters.

- [ ] **Step 4: Implement seed and per-family filtering helpers**

For each oscillator, read the cutoff's phase-1 cache before replacing it, map `0..1` exponentially to `0.1..20000 Hz`, calculate one alpha, then advance and replace ten caches:

```cpp
const float normalizedCutoff = cutoffParameter.CachedKnobValue(0);
const float cutoffHz = VcoModule::kMinModulationCutoffHz *
    std::pow(VcoModule::kMaxModulationCutoffHz /
                 VcoModule::kMinModulationCutoffHz,
             normalizedCutoff);
const float alpha = synth::OnePoleLowPass::AlphaFromNatFreq(
    cutoffHz / static_cast<float>(internalSampleRate_));
```

Apply `ProcessWithAlpha` to four quad voices, cutoff, frequency, and four output-row matrix parameters, calling `ReplaceCachedKnobValue` after each. Seed the identical mapping with `Reset(parameter.CachedKnobValue(voice))` in initialization/prepare/reset; do not mutate parameter targets or raw state.

- [ ] **Step 5: Split Braid's internal parameter sequence**

Replace the combined group calls with this exact ordering after modulator refresh and before module `SetInput`:

```cpp
stereoGroup_->ProcessSamplePhase1(internalIndex);
quadGroup_->ProcessSamplePhase1(internalIndex);
monoGroup_->ProcessSamplePhase1(internalIndex);
FilterParameterCaches();
stereoGroup_->ProcessSamplePhase2();
quadGroup_->ProcessSamplePhase2();
monoGroup_->ProcessSamplePhase2();
```

Do not move standard-modulator processing, `UpdateModValues`, module/matrix processing, normalized-source publication, scope advancement, or decimation. This preserves the existing one-internal-sample matrix-source delay.

- [ ] **Step 6: Run GREEN Braid/UI tests**

Run:

```bash
make -C projects/synth build/braid4_system_tests build/portable_ui_tests && projects/synth/build/braid4_system_tests && projects/synth/build/portable_ui_tests
```

Expected: exit `0`, including all 80-state ownership/response tests, cutoff bank labels, persistence, UI/DSP agreement, sparse traversal, and matrix timing.

- [ ] **Step 7: Commit Task 3**

```bash
git add projects/synth/apps/braid-4/Braid4Core.hpp projects/synth/tests/braid4_system_tests.cpp projects/synth/tests/portable_ui_tests.cpp
git commit -m "feat(synth): filter braid4 oscillator parameter caches"
```

If `portable_ui_tests.cpp` is unchanged, omit it from `git add`.

---

### Task 4: Coverage, Full Verification, and OpenSpec Synchronization

**OpenSpec coverage:** 5.1, 5.2, 5.3, 5.4 and completion bookkeeping for 1.1 through 4.6 after reviewed implementation evidence exists.

**Files:**
- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/filter-braid4-parameter-values/tasks.md`
- Verify: all files changed by Tasks 1-3.

**Interfaces:**
- Consumes: reviewed commits from Tasks 1-3.
- Produces: current coverage mappings and an OpenSpec checklist whose boxes reflect reviewed, verified work only.

- [ ] **Step 1: Update coverage mappings**

Add/update rows and detailed sections for `sdsp-6`, `spm-11`, `spm-66`, `spm-72`, `smod-9`, `smod-10`, `smod-11`, `d4-1`, `d4-2`, `d4-7`, `d4-8`, and new `d4-10`. Name the exact focused tests added in Tasks 1-3; describe the 80-state count, output-row matrix ownership, cutoff self-filtering, phase ordering, UI/DSP cache agreement, and deadline coverage without duplicating normative spec prose.

- [ ] **Step 2: Run all focused binaries**

```bash
make -C projects/synth build/parameter_modulation_tests build/dsp_tests build/module_tests build/braid4_system_tests build/portable_ui_tests build/braid4_deadline_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/dsp_tests
projects/synth/build/module_tests
projects/synth/build/braid4_system_tests
projects/synth/build/portable_ui_tests
projects/synth/build/braid4_deadline_tests
```

Expected: every command exits `0`; deadline output reports 44.1, 48, and 96 kHz average `<= 60%` and p99 `<= 80%` of the 256-frame block duration.

- [ ] **Step 3: Run full synth and header verification**

```bash
make -C projects/synth test
```

Expected: exit `0` with no failed synth, portable, Braid, deadline, or public-header/JUCE-free checks. If the Makefile exposes a distinct public-header target not included by `test`, run that target too and record it.

- [ ] **Step 4: Validate OpenSpec and mark completed boxes**

Run strict validation before and after changing checkboxes:

```bash
openspec validate filter-braid4-parameter-values --type change --strict
```

Mark each of the 18 OpenSpec tasks complete only when the corresponding implementation, review, and verification evidence exists. Re-run `openspec status --change filter-braid4-parameter-values --json` and require `18/18` complete.

- [ ] **Step 5: Commit Task 4**

```bash
git add projects/synth/docs/coverage.md openspec/changes/filter-braid4-parameter-values/tasks.md
git commit -m "docs(synth): cover braid4 parameter filtering"
```
