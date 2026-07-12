# Braid4 Parallel LFO Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Braid 4 from one audible four-oscillator bank into parallel audible VCO and non-audible LFO Braid4VCO paths with matched XY/matrix modulation and distinct color/layout treatment.

**Architecture:** Keep `synth::Braid4VcoModule` reusable by adding a small registration/style/options contract for frequency octave shift and parameter colors. `Braid4Core` owns two module instances, two matrix mixers, four banks on the same 16-encoder slot, three parameter groups with two audio-rate modulators each, and eight scope holders. The portable UI keeps one 4x4 encoder grid and draws two stacked 2x2 scope grids: red VCOs above green LFOs.

**Tech Stack:** C++20, JUCE-free synth core/module tests, OpenSpec change `add-braid-4-synth-app`, existing `ParameterManager`, `BipolarMatrixMixerModule<4>`, `Braid4VcoModule`, `FirDecimator`, and portable UI draw builders.

## Global Constraints

- No standalone Braid 4 executable.
- Internal parameter/DSP/modulation clock remains exactly `4 * hostRate`.
- Audio-rate modulation sources published to the parameter system must be normalized to `[0, 1]` with `0.5 + 0.5 * clamp(raw, -1, 1)`.
- LFO Braid4VCO output is modulation-only; it is not summed into the audible final output.
- No compatibility aliases for pre-rename names.

---

### Task 1: Spec Delta

**Files:**
- Modify: `openspec/changes/add-braid-4-synth-app/specs/synth-braid-4/spec.md`
- Modify: `openspec/changes/add-braid-4-synth-app/specs/synth-modules/spec.md`
- Modify: `openspec/changes/add-braid-4-synth-app/specs/synth-runtime-ui/spec.md`
- Modify: `openspec/changes/add-braid-4-synth-app/design.md`
- Modify: `openspec/changes/add-braid-4-synth-app/tasks.md`

**Interfaces:**
- Produces: updated OpenSpec requirements for two Braid4VCO instances, four banks, two modulators per group, red/green/orange/yellow color semantics, and stacked VCO/LFO scope grids.

- [ ] Add the spec requirements and task checklist items.
- [ ] Run `openspec validate add-braid-4-synth-app --strict`.

### Task 2: Red Tests

**Files:**
- Modify: `projects/synth/tests/module_tests.cpp`
- Modify: `projects/synth/tests/braid4_system_tests.cpp`

**Interfaces:**
- Consumes: `synth::Braid4VcoModule`, `synth_braid4::Braid4Core`, and portable UI surface APIs.
- Produces: failing tests for frequency octave shift, group/bank/modulator counts, LFO XY modulators, LFO matrix quad modulator, colors, and stacked scope layout.

- [ ] Add module test `braid_vco_supports_frequency_octave_shift_and_parameter_colors`.
- [ ] Add Braid system tests for four banks, two modulators per group, VCO/LFO raw+normalized source values, and VCO/LFO scope nodes.
- [ ] Run `make -C projects/synth build/module_tests build/braid4_system_tests && projects/synth/build/module_tests && projects/synth/build/braid4_system_tests` and verify the new tests fail for missing behavior.

### Task 3: Core/Module Implementation

**Files:**
- Modify: `projects/synth/include/synth/Modules.hpp`
- Modify: `projects/synth/apps/braid-4/Braid4Core.hpp`

**Interfaces:**
- Produces: `Braid4VcoModule::Options`, per-parameter colors, octave-shifted frequency mapping, second LFO module/matrix, two normalized modulator slots per group, and additional accessors for tests/UI.

- [ ] Implement options and color hooks in `Braid4VcoModule`.
- [ ] Expand `Braid4Core` group capacities, modulator source arrays, banks, scopes, process order, prepare path, and debug/test helpers.
- [ ] Run focused module/system tests until green.

### Task 4: UI Implementation

**Files:**
- Modify: `projects/synth/apps/braid-4/Braid4Draw.hpp`
- Modify: `projects/synth/apps/braid-4/Braid4UiModel.hpp`
- Modify: `projects/synth/apps/braid-4/Braid4UI.hpp`

**Interfaces:**
- Produces: two stacked 2x2 scope layouts, red VCO panels, green LFO panels, four bank buttons, same one 4x4 encoder grid.

- [ ] Add node IDs and layout helpers for VCO/LFO scope layers.
- [ ] Build VCO scope draw state from `BraidModule()` and LFO scope draw state from `LfoModule()`.
- [ ] Add bank buttons for Braid, Matrix, LFO, and LFO Matrix.
- [ ] Run `make -C projects/synth build/braid4_system_tests build/portable_ui_tests && projects/synth/build/braid4_system_tests && projects/synth/build/portable_ui_tests`.

### Task 5: Integration Verification

**Files:**
- Modify if needed: `projects/synth/Makefile`
- Modify if needed: `projects/synth/apps/sheaf-patch/Makefile`

**Interfaces:**
- Produces: verified Braid4 refinement integrated with Sheaf Patch build/test.

- [ ] Run `make -C projects/synth build/braid4_system_tests build/braid4_deadline_tests build/module_tests build/portable_ui_tests`.
- [ ] Run the four focused binaries.
- [ ] Run `openspec validate add-braid-4-synth-app --strict`.
- [ ] Run `git diff --check`.
