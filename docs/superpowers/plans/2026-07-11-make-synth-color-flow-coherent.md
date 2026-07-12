# Synth Color Flow Coherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one unit-safe, single-authority color flow from semantic synth objects through snapshots to portable drawing and hardware feedback, then migrate Braid 4 and MiniApp with no dead or competing color paths.

**Architecture:** A neutral `synth/Color.hpp` owns the only RGBA type and explicit HSV-unit APIs. Parameters own resolved base/indicator appearance and publish complete per-cell source/gesture colors; reusable encoder/scope drawing consumes that snapshot directly. Banks, sources, gestures, and scopes retain independent role-specific color owners, while Braid and MiniApp configure those roles without snapshot overrides or UI-side palette reconstruction.

**Tech Stack:** C++20, JUCE-free synth library, portable draw-command UI, JUCE adapter, Make-based tests, OpenSpec, xagent Claude Opus.

## Global Constraints

- Parameter groups own processing and storage topology only; no group color fields, methods, defaults, or fallbacks remain.
- Bank color, parameter base color, per-voice indicator color, modulation-source color, gesture color, and scope-trace color are independent semantic roles with one owner each.
- `DrawCommand::color` is retained only as a terminal RGBA payload; JUCE does not select semantic colors.
- Tune/Phase/Shape/Gain share the applicable full red or full green base color and carry four per-oscillator indicators.
- Audible and LFO oscillator shade arrays each contain four visibly/literally distinct family colors; scope assignment is independent even when values match.
- Portable Braid and MiniApp encoders use exactly the same reusable snapshot-to-draw code and accept no app palette injection.
- No compatibility aliases are retained for removed color types, HSV APIs, or semantic setters/getters.
- Every behavior change follows red-green-refactor; tests must fail for the intended missing contract before production edits.

---

### Task 1: Canonical RGBA and unit-explicit HSV

**Files:**
- Create: `projects/synth/include/synth/Color.hpp`
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/include/synth/PortableUI.hpp`
- Modify: `projects/synth/include/synth/EncoderDraw.hpp`
- Modify: `projects/synth/include/synth/PortableUIBuilders.hpp`
- Modify: portable browser/JUCE files returned by `rg 'synth::ui::Color|FromHSV|ToHSV|ToUiColor|BrighterUiColor' projects/synth`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Test: `projects/synth/tests/portable_ui_tests.cpp`
- Test: `projects/synth/tests/browser_command_buffer_tests.cpp`
- Test: `projects/synth/juce/PortableJuceBackendTests.cpp`

**Interfaces:**
- Produces: `synth::Color`, `synth::HsvColor { hueTurns, saturation, value }`, `Color::FromHsvTurns`, `Color::FromHsvDegrees`, `ToHsv`, and shared alpha/darken/brighten helpers.
- Removes: `synth::ui::Color`, `FromHSV`, `ToHSV`, semantic-to-UI conversion helpers, and duplicated local brighteners.

- [ ] **Step 1: Write failing literal and structural tests**

Add tests that compare 120-degree and one-third-turn green to literal RGB `(0,255,0)`, require `FromHsvTurns(120,...)` to throw, round-trip through `hueTurns`, verify shared alpha/brighten behavior, and compile draw commands with `synth::Color`. Add a structural assertion/script command for removed names.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/browser_command_buffer_tests`

Expected: compile/test failure because explicit APIs/shared type do not exist and the ambiguous APIs still exist.

- [ ] **Step 3: Implement the neutral color header and migrate consumers**

Move the existing packed RGBA implementation and named constants to `Color.hpp`; implement strict turn validation and finite degree wrapping; make portable structs use the parent `synth::Color`; centralize alpha/darken/brighten operations; update JUCE/browser conversions mechanically.

- [ ] **Step 4: Run focused tests and structural checks**

Run the three focused executables plus relevant JUCE backend tests. Run `rg 'synth::ui::Color|FromHSV|ToHSV|ToUiColor|BrighterUiColor' projects/synth -g '!**/build/**'` and expect no production matches.

- [ ] **Step 5: Commit task changes**

Commit message: `refactor(synth): make color units and type explicit`

### Task 2: Parameter-owned appearance and complete UI snapshots

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/EncoderDraw.hpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Test: `projects/synth/tests/portable_ui_tests.cpp`
- Test: relevant MIDI/controller tests found by `rg 'CellSnapshot|indicatorColors|brightness' projects/synth/tests`

**Interfaces:**
- Produces: `ParameterConfig::baseColor`, `ParameterConfig::indicatorColors`, resolved `Parameter::BaseColor/IndicatorColor`, role-specific source/gesture/bank fields, and complete bounded color arrays in `Parameter::UIState`.
- Changes: `EncoderDrawStateFromParameter(const Parameter::UIState&)` is the sole encoder snapshot converter.
- Removes: group palettes/default palette generation, app palette arguments, and parameter UI brightness.

- [ ] **Step 1: Write failing parameter appearance tests**

Cover empty/one/exact palette resolution, invalid cardinality atomicity, two parameters in one group with different palettes, modulation-depth base/source plus inherited target indicators, disconnected clearing, and UI-state source/gesture arrays.

- [ ] **Step 2: Run parameter tests and verify RED**

Run: `make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`

Expected: failures/compile errors for parameter-owned palette API and complete snapshots.

- [ ] **Step 3: Implement ownership and snapshot transaction**

Remove group color state. Canonicalize parameter palettes before committing registration. Extend UI-state construction with maximum modulator/gesture color capacities and publish/clear them under the revision counter. Copy parent indicators into generated modulation-depth configs. Rename semantic bank/source/gesture fields and remove brightness, deriving MIDI brightness from connected/blank state.

- [ ] **Step 4: Write and verify failing screen/hardware parity tests**

Construct one cell with distinct base/voice-zero colors, assert shared encoder state and WRLD.Bldr cell processing observe the same two values, and assert badge colors come from the cell snapshot without spans.

- [ ] **Step 5: Implement snapshot-only encoder conversion and run tests**

Remove color spans from `EncoderDrawStateFromParameter`; size cells to manager-wide maximum modulator/gesture capacities, publish and consume per-cell counts, clear unused entries, update callers/tests, and delete `EncoderGeometry::ColorForIndex` plus all invented badge fallbacks. Run parameter, portable UI, MIDI/controller, instrument, and randomized simulation tests.

- [ ] **Step 6: Run structural checks and commit**

Expect no production matches for `voiceIndicatorColors`, `VoiceIndicatorColor`, `DefaultVoiceColor`, UI `brightness`, or old generic semantic field names enumerated by the OpenSpec task. Commit message: `refactor(synth): make parameter color snapshots authoritative`.

### Task 3: Reusable module semantic color APIs

**Files:**
- Modify: `projects/synth/include/synth/DspOscillators.hpp`
- Modify: `projects/synth/include/synth/Modules.hpp`
- Modify: all in-repository module registration call sites identified by compiler/`rg`
- Test: `projects/synth/tests/module_tests.cpp`

**Interfaces:**
- Produces: `SetScopeColor`, scope UI-state `scopeColor`, matrix `SetParameterColors`, and Braid options separating shared parameter base from four indicator shades.
- Removes: generic processor/module/bank/matrix `SetColor`, matrix color getters, and ambiguous scope UI-state `color`.

- [ ] **Step 1: Write failing module tests**

Test X/Y shared base/broadcast indicators, quad shared base/four indicators, mono associated shade, scope-color independence, and matrix registered diagonal/off-diagonal base/indicator colors.

- [ ] **Step 2: Run module tests and verify RED**

Run: `make -C projects/synth build/module_tests && projects/synth/build/module_tests`

Expected: compile/assertion failure for the new role-specific API and old conflated options.

- [ ] **Step 3: Implement module migrations**

Rename DSP scope color state/setters, revise Braid registration options/assignments, add indicator-color options to the reusable wavetable VCO, classic filter, and basic LFO modules, rename the matrix parameter-color setter, remove unused getters, and migrate every module/app caller without compatibility aliases.

- [ ] **Step 4: Run module and dependent compile tests**

Run module tests and compile Braid/MiniApp system tests to expose every stale call site.

- [ ] **Step 5: Commit task changes**

Commit message: `refactor(synth): separate module color roles`

### Task 4: Braid 4 end-to-end palette migration

**Files:**
- Modify: `projects/synth/apps/braid-4/Braid4Core.hpp`
- Modify: `projects/synth/apps/braid-4/Braid4UiModel.hpp`
- Modify: `projects/synth/apps/braid-4/Braid4UI.hpp`
- Modify: `projects/synth/apps/braid-4/Braid4Draw.hpp`
- Test: `projects/synth/tests/braid4_system_tests.cpp`
- Test: `projects/synth/tests/portable_ui_tests.cpp`

**Interfaces:**
- Consumes: Tasks 1-3 explicit degree colors, parameter-owned palettes, complete snapshots, and role-specific scope/module APIs.
- Removes: `ApplyActiveBankIndicatorColors` and all Braid encoder palette reconstruction.

- [ ] **Step 1: Write failing literal Braid palette tests**

Assert pairwise-distinct red-family and green-family arrays using literal RGB/family predicates; verify full base plus four quad indicators, mono/stereo roles, both matrix palettes, independent bank/source colors, eight scope colors, correct stereo/quad/mono badge palettes, and screen/hardware parity.

- [ ] **Step 2: Run Braid/portable tests and verify RED**

Run: `make -C projects/synth build/braid4_system_tests build/portable_ui_tests && projects/synth/build/braid4_system_tests`

Expected: current degree calls produce red LFO shades and snapshot/badge ownership assertions fail.

- [ ] **Step 3: Implement Braid migration**

Use `FromHsvDegrees`; configure shared red/green parameter bases and indicator arrays; assign independent scope colors; apply orange/yellow and green-yellow/yellow matrix parameter colors; remove group color config, snapshot override, and UI metadata palette gathering.

- [ ] **Step 4: Run focused and structural verification**

Run Braid, module, portable UI, and launcher harness tests. Search for `ApplyActiveBankIndicatorColors`, Braid calls to `GetModulators().Metadata()` for encoder building, and stale degree-to-turn usage; expect no production matches.

- [ ] **Step 5: Commit task changes**

Commit message: `fix(braid4): make oscillator color identity coherent`

### Task 5: MiniApp migration and reusable drawing cleanup

**Files:**
- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppUI.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppUiModel.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppDraw.hpp`
- Modify: `projects/synth/include/synth/PortableUIBuilders.hpp`
- Test: `projects/synth/tests/miniapp_system_tests.cpp`
- Test: `projects/synth/tests/portable_ui_tests.cpp`

**Interfaces:**
- Consumes: parameter-owned snapshots and shared color helpers.
- Preserves: cyan/orange parameter indicators, existing parameter base colors, cyan/orange and green/yellow scope traces, cyan/green banks, source colors, and orange gesture color.

- [ ] **Step 1: Write failing MiniApp color-flow regressions**

Assert every two-voice parameter resolves cyan/orange indicators, visible cells publish the right base/source/gesture colors, waveform layers publish independent trace colors, and the surface has no metadata palette inputs.

- [ ] **Step 2: Run MiniApp tests and verify RED**

Run: `make -C projects/synth build/miniapp_system_tests build/portable_ui_tests && projects/synth/build/miniapp_system_tests`

Expected: group-owned palette/app palette reconstruction API conflicts with the new contract.

- [ ] **Step 3: Implement MiniApp migration**

Attach the cyan/orange indicator palette through each reusable module's parameter option, use role-specific bank/scope/source/gesture fields, and build encoders from visible-cell snapshots only. Retain MiniApp's widget-specific VCO/LFO Y-range and sample-count adapter; remove only duplicated waveform draw/color logic beneath that adapter.

- [ ] **Step 4: Run focused tests and structural checks**

Run MiniApp, portable UI, module, and JUCE portable draw tests. Search MiniApp for live metadata color gathering and old color names; expect no production matches.

- [ ] **Step 5: Commit task changes**

Commit message: `refactor(miniapp): consume authoritative color snapshots`

### Task 6: Full validation and independent final audit

**Files:**
- Modify as needed from review findings only.
- Update: `openspec/changes/make-synth-color-flow-coherent/tasks.md`

**Interfaces:**
- Verifies all `scf-*`, modified `spm-*`, `sru-*`, and `smod-*` requirements.

- [ ] **Step 1: Run strict OpenSpec validation**

Run: `openspec validate make-synth-color-flow-coherent --strict`

Expected: pass.

- [ ] **Step 2: Run complete synth verification**

Run: `make -C projects/synth build test`

Expected: all targets pass with zero failures.

- [ ] **Step 3: Build the exact user launch artifact**

Run: `make -C projects/synth/apps/sheaf-patch`

Expected: `projects/synth/apps/sheaf-patch/build/SheafPatch.app` builds with no new warnings.

- [ ] **Step 4: Run repository-wide structural audit**

Use `rg` for every removed symbol/concept listed in `scf-8`, inspect every remaining `color` field/method, and map each to bank/base/indicator/source/gesture/scope/terminal-theme ownership. Resolve dead or unclear code before review.

- [ ] **Step 5: Dispatch xagent Claude Opus final audit**

Give Opus the OpenSpec artifacts, this plan, final diff, and the original audit questions. Require findings first by severity with file/line references, explicit coverage of library/Braid/MiniApp/JUCE/hardware paths, and a requirement-by-requirement verdict.

- [ ] **Step 6: Resolve findings and re-review**

Fix every Critical/Important finding through focused red-green tests, rerun affected and full tests, and repeat Opus review until no Critical/Important findings remain.

- [ ] **Step 7: Mark OpenSpec tasks complete and commit**

Update checkboxes only with evidence. Commit message: `test(synth): verify coherent color flow end to end`.
