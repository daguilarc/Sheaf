# Standard Modulators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `StandardModulators<VoiceCount>` bundle for the fifteen-source MIN-16 topology, then adopt it in MiniApp and all three Braid4 parameter groups.

**Architecture:** A header-only, JUCE-free wrapper composes the existing fixed-polyphony ganged-random processors with runtime noise/constant processors, stable adapter rows, metadata, and portable visualizers. Registration is validated and one-shot; preparation, audio-rate processing, UI publication, and caller-owned group updates remain separate lifecycle operations. MiniApp retains one stereo bundle, while Braid4 retains independent stereo, quad, and mono bundles at its four-times-host internal rate.

**Tech Stack:** C++20, existing synth DSP/portable UI headers, `ParameterGroup`, custom Make-based C++ test binaries, OpenSpec change `add-standard-modulators`, native Codex implementer subagents, and Claude xagent reviewers.

## Global Constraints

- `StandardModulators<VoiceCount>` is opt-in, non-copyable, non-movable, constructed with a non-owning `ParameterGroup&`, and retained at an address-stable application lifetime.
- The bundle owns four random processors, four inputs, four stable output rows and pointer rows, runtime-sized noise and constant processors, four random visualizers, one noise visualizer, and one constant visualizer.
- Default indexes are random `0..3`, constant `11`, and noise `14`; polyphonic registration activates all six sources, while `VoiceCount == 1` omits constant completely and ignores its index for active collision checks.
- Registration requires a group with exactly `VoiceCount` voices and exactly fifteen modulators. It validates the complete active configuration before mutating the group, rejects duplicate/out-of-range indexes and invalid inputs/metadata/palettes, and rejects repeat registration.
- Default random timing is derived from waiting means `W = [0.5, 2, 6, 16]` seconds and target sigmas `[0.1, 0.3, 0.2, 0.1]`: waiting sigma `0.1W`, waiting internal sigma `0.1/W`, moving mean `W/2`, moving sigma `0.05W`, and moving internal sigma `0.2/W`.
- Default metadata is exactly `Random 500 ms`/`Rnd .5`/Cyan, `Random 2 s`/`Rnd 2`/Blue, `Random 6 s`/`Rnd 6`/Indigo, `Random 16 s`/`Rnd 16`/Orange, `Constant`/`Const`/Yellow, and `Noise`/`Noise`/White.
- The default random voice palette is Cyan, Orange, Green, Yellow truncated to `VoiceCount`; a specialization over four voices must receive an explicit exact-size palette before registration.
- Mutable configuration is available only before successful registration. Read-only configuration and bounded processor/input/output/visualizer inspection remain available for tests and application UI accessors.
- `Prepare(rate)` follows successful registration and requires a finite positive rate. `Process()` follows preparation, advances all four random processors and noise once, copies random outputs in voice order, does no constant work, and performs no allocation, lock, entropy request, UI publication, or `UpdateModValues()` call.
- `PublishUiState()` is explicitly block-controlled and publishes all four random snapshots without reconstructing visualizers. The application owns the exact `ParameterGroup::UpdateModValues()` timing.
- MiniApp has fifteen modulators, all sixteen physical positions, initial group capacity `192`, standard sources at `0..3/11/14`, and direct VCO/swapped VCO/LFO at `4/5/6`; its main random panel reads standard random source `0`.
- Braid4 has fifteen modulators in each group, independent `StandardModulators<2>/<4>/<1>`, application sources at `4/5`, preparation at `4 * hostRate`, and standard processing immediately before each internal group update. Its existing application-source one-internal-sample delay remains unchanged.
- No compatibility alias, persistence migration, serialized standard configuration, performer parameters, backend-specific implementation, or unrelated topology change is added.
- Production work follows TDD: each implementation unit records a focused RED run before implementation and a GREEN run after implementation.
- Every implementation task is committed by a fresh native Codex implementer and passes a task-scoped Claude xagent spec-and-quality review before its matching OpenSpec checkboxes are marked complete.

---

## File Structure

- Create `projects/synth/include/synth/StandardModulators.hpp`: complete reusable bundle configuration, ownership, registration, lifecycle, and inspection API.
- Modify `projects/synth/tests/dsp_tests.cpp`: default/configuration/registration/lifecycle/pointer/publication integration coverage for `<1>`, `<2>`, and `<4>`.
- Modify `projects/synth/Makefile`: make focused DSP, MiniApp, Braid4, portable UI, and browser command-buffer targets depend on the reusable header where included transitively.
- Modify `projects/synth/apps/miniapp/MiniAppCore.hpp`: replace direct generic source plumbing, expand topology/capacity/slot, move app-specific indexes, and preserve the main random panel accessor.
- Modify `projects/synth/tests/miniapp_system_tests.cpp`, `projects/synth/tests/portable_ui_tests.cpp`, and `projects/synth/tests/browser_command_buffer_tests.cpp`: MiniApp topology, lifecycle, materialization, persistence behavior, and portable rendering coverage.
- Modify `projects/synth/apps/braid-4/Braid4Core.hpp`: retain/register/prepare/process/publish three independent bundles and move existing sources.
- Modify `projects/synth/tests/braid4_system_tests.cpp`, `projects/synth/tests/braid4_deadline_tests.cpp`, and `projects/synth/tests/portable_ui_tests.cpp`: Braid4 topology, timing, visualizer, lifetime, signal-delay, and deadline coverage.
- Modify `projects/synth/docs/coverage.md`: map the new and modified requirement IDs to exact focused tests.
- Modify `openspec/changes/add-standard-modulators/tasks.md`: mark checkboxes only after the corresponding implementation and review gate pass.

---

### Task 1: Standard Bundle Configuration and Atomic Registration

**Files:**
- Create: `projects/synth/include/synth/StandardModulators.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify after review: `openspec/changes/add-standard-modulators/tasks.md` items `1.1` through `1.4`

**Required public surface:**
- `template<std::size_t VoiceCount> class StandardModulators` with deleted copy/move operations.
- Nested or adjacent `Configuration` containing `std::array<std::size_t, 4> randomIndexes`, `constantIndex`, `noiseIndex`, four random metadata records, constant/noise metadata, four `GangedRandomLfoInput` records, and a random voice-color collection.
- `explicit StandardModulators(ParameterGroup&)`, mutable pre-registration `Config()`, const `Config()`, `Register()`, `IsRegistered()`, and bounded const/non-const inspection needed by later tasks.

- [ ] **Step 1: Add failing default and ownership tests**

Add compile-time non-copy/move assertions for `<1>`, `<2>`, and `<4>`. Add focused tests named `standard_modulators_defaults_match_min16_contract` and `standard_modulators_owns_address_stable_source_and_visualizer_storage` that assert exact indexes, names, short names, colors, voice palettes, every derived timing field, owned processor voice counts, distinct visualizer addresses, stable output-row addresses, and the retained target group address.

Run `make -C projects/synth build/dsp_tests` and record the expected compile failure because `synth/StandardModulators.hpp` does not exist.

- [ ] **Step 2: Add failing override and rejection tests**

Add separate tests covering pre-registration index/metadata/input/palette overrides, post-registration mutable-config rejection, out-of-range and duplicate active indexes, invalid random timing, empty active names/short names, wrong voice palette size, wrong group voice count, wrong modulator count, mono constant-index collision exclusion, atomic failure with every metadata record still disconnected, and double registration. Use fresh groups/bundles for each rejection so assertions prove no partial mutation.

- [ ] **Step 3: Implement configuration, owned lifetime graph, and validation**

Implement exact defaults with a helper that derives timing from `W` and target sigma. Initialize four visualizers from the four owned processor UI states, the constant visualizer from the owned immutable value span, and noise visualizer independently. Keep processor/input/row/pointer/visualizer storage as direct members; vectors used for configuration or runtime-sized existing processors may allocate only during construction/pre-registration.

- [ ] **Step 4: Implement one-shot atomic registration**

Validate lifecycle, exact group shape, all active indexes, active metadata, all four timing records, and exact voice palette size before the first `SetModulationSource` call. Apply configured colors to each random processor, install wrapper-owned visualizer pointers in copied connected metadata, register four stable random pointer rows plus noise and (polyphonic only) constant pointers, and freeze mutable configuration after success.

- [ ] **Step 5: Verify and commit**

Run:

```bash
make -C projects/synth build/dsp_tests
projects/synth/build/dsp_tests
```

Expected: all DSP tests pass with no warning output. Commit with subject `feat(synth): add standard modulator registration bundle`, write the required implementation report including RED/GREEN evidence, and stop for Claude review.

---

### Task 2: Standard Bundle Processing and Publication

**Files:**
- Modify: `projects/synth/include/synth/StandardModulators.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`
- Modify after review: `openspec/changes/add-standard-modulators/tasks.md` items `2.1` through `2.3`

**Required public surface:**
- `void Prepare(double sampleRate)`, `void Process()`, `void PublishUiState()`, and `bool IsPrepared() const noexcept`.
- Bounded access by random index to the processor, configured input, stable output row, pointer row, and random visualizer; direct bounded access to noise/constant processors and visualizers.

- [ ] **Step 1: Add failing lifecycle and deterministic advancement tests**

Test prepare-before-register, invalid preparation rate, process-before-prepare, successful re-prepare, exact processor sample rates, one-call advancement of all four random processors and noise, voice-order output copies, unchanged constant values/pointers, and bounds checking. Seed/control tests through exposed processor inspection only if existing processor APIs make deterministic observation possible; do not redesign existing processors.

- [ ] **Step 2: Add failing explicit-update and UI-publication tests**

Prove `Process()` alone does not change cached `ParameterGroup` modulator values, caller `UpdateModValues()` then observes the latest standard values, all polyphonic constant values publish correctly, mono index `11` remains disconnected/null, registered source and visualizer addresses remain stable across processing/publication, and random snapshots change only after `PublishUiState()`.

- [ ] **Step 3: Implement lifecycle operations**

`Prepare()` prepares each random processor and records lifecycle state. `Process()` calls every random processor once with its retained input, copies each voice output into its stable row, and calls noise once. `PublishUiState()` publishes each random processor once. Do not process/copy constant or call group update. All hot-path loops are statically bounded by four sources and `VoiceCount` and contain no wrapper allocation or entropy call.

- [ ] **Step 4: Verify and commit**

Run:

```bash
make -C projects/synth build/dsp_tests
projects/synth/build/dsp_tests
```

Expected: all DSP tests pass. Commit with subject `feat(synth): process and publish standard modulators`, write the report with RED/GREEN evidence, and stop for Claude review.

---

### Task 3: MiniApp Adoption

**Files:**
- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/tests/browser_command_buffer_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify after review: `openspec/changes/add-standard-modulators/tasks.md` items `3.1` through `3.4`

- [ ] **Step 1: Update tests first for the fifteen-source topology**

Replace old six-source assertions with exact standard metadata/pointers/visualizers at `0..3`, `11`, and `14`; scope-backed direct/swapped VCO and LFO at `4/5/6`; disconnected `7..10` and `12..13`; group capacity `192`; sixteen physical positions following the existing MiniApp physical-ID convention; fifteen depth cells plus return; and unchanged top-level parameter/bank/page/scene topology. Add explicit assertions that saved old-index data receives no alias or translation.

- [ ] **Step 2: Replace direct generic source ownership**

Retain one address-stable `StandardModulators<2>` created only after the group exists. Remove MiniApp's direct random processor/input/output row/pointer helper, noise processor, constant processor, and their three generic visualizers. Register the bundle, move module source registration to `4/5/6`, and attach only the existing scope visualizers to those moved metadata records.

- [ ] **Step 3: Wire lifecycle and UI accessors**

Prepare the bundle at host rate, process it once per sample immediately before the existing group update, and publish once after each block. Rewire the main waveform panel and compatibility test/UI accessors to bundle random source `0`; do not retain duplicate direct generic-source accessors or ownership.

- [ ] **Step 4: Verify portable and browser rendering**

Prove the three-panel waveform row remains VCO/LFO/random-0, standard visualizers render beneath depth encoders, moved app-specific sources retain their scope underlays, hidden/bank-transition behavior remains correct, and all portable/browser command buffers stay JUCE-free.

- [ ] **Step 5: Verify and commit**

Run:

```bash
make -C projects/synth build/miniapp_system_tests build/portable_ui_tests build/browser_command_buffer_tests
projects/synth/build/miniapp_system_tests
projects/synth/build/portable_ui_tests
projects/synth/build/browser_command_buffer_tests
```

Expected: all focused tests pass. Commit with subject `feat(synth): adopt standard modulators in miniapp`, write the report with RED/GREEN evidence, and stop for Claude review.

---

### Task 4: Braid4 Adoption

**Files:**
- Modify: `projects/synth/apps/braid-4/Braid4Core.hpp`
- Modify: `projects/synth/tests/braid4_system_tests.cpp`
- Modify: `projects/synth/tests/braid4_deadline_tests.cpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify after review: `openspec/changes/add-standard-modulators/tasks.md` items `4.1` through `4.4`

- [ ] **Step 1: Update Braid4 tests first**

Assert every group has fifteen modulators and one independent retained `<2>`, `<4>`, or `<1>` bundle; standard source metadata/pointers/visualizers occupy `0..3/11/14` for poly groups and `0..3/14` for mono; mono `11` is disconnected/null; application sources occupy `4/5`; remaining gaps are disconnected; visualizer and source addresses do not alias within or across bundles; and complete fifteen-cell modulation views fit each group.

- [ ] **Step 2: Adopt bundles and preserve source semantics**

Use capacities no smaller than stereo `19`, quad `23`, and mono `63` while retaining larger existing capacities when useful. Create three bundles after group construction, register them before application-specific sources, and move Audio XY/LFO XY, Matrix/LFO Matrix, and Audio Mid/LFO Mid source pairs from `0/1` to `4/5` without changing their normalization or pointer storage.

- [ ] **Step 3: Wire four-times-host lifecycle**

Prepare all bundles at `internalSampleRate_`, process each once at the start of every internal subframe immediately before the three `UpdateModValues()` calls, and publish all three once after each host block. Extend focused counters/tests only as needed to prove cadence. Preserve the existing matrix/VCO application-source consumption delay and scope/parameter ordering.

- [ ] **Step 4: Update Braid4 portable UI coverage**

Standard connected cells render their wrapper-owned underlays, indexes `4/5` remain encoder-only, mono `11` remains encoder-only/disconnected, and no visualizer pointer aliases another source or group.

- [ ] **Step 5: Verify and commit**

Run:

```bash
make -C projects/synth build/braid4_system_tests build/braid4_deadline_tests build/portable_ui_tests
projects/synth/build/braid4_system_tests
projects/synth/build/braid4_deadline_tests
projects/synth/build/portable_ui_tests
```

Expected: all focused tests pass and the 44.1/48/96 kHz release deadline checks remain within their existing callback budgets. Commit with subject `feat(synth): adopt standard modulators in braid4`, write the report with RED/GREEN evidence, and stop for Claude review.

---

### Task 5: Coverage, Regression, and OpenSpec Completion

**Files:**
- Modify: `projects/synth/docs/coverage.md`
- Modify: topology comments in changed source files only where stale
- Modify: `openspec/changes/add-standard-modulators/tasks.md` items `5.1` through `5.4`

- [ ] **Step 1: Update exact requirement coverage**

Add `ssm-1` through `ssm-5` mappings and revise `spm-71`, `sdsp-33`, `sdsp-38`, `sdsp-40`, `d4-1`, `d4-3`, `d4-8`, and `d4-9` to name the exact focused tests now proving each contract. Remove stale descriptions of MiniApp indexes `0..5` and Braid4 indexes `0/1` where they describe live topology.

- [ ] **Step 2: Run the complete synth regression suite**

Run `make -C projects/synth test`. Expected: exit `0`, all binaries pass, UI-boundary check passes, and no compiler warnings are introduced.

- [ ] **Step 3: Run application/browser smoke coverage**

Run the available MiniApp native and browser smoke targets defined by the repository without touching the existing untracked `projects/synth/miniapp/` build tree. Re-run `projects/synth/build/braid4_deadline_tests` and record the representative-rate timings. If an external browser/runtime prerequisite is unavailable, report the exact blocker and do not mark this step complete.

- [ ] **Step 4: Validate persistence and OpenSpec**

Run focused MiniApp and Braid4 persistence tests, confirm the live fifteen-index topology remains authoritative after old saved values load, then run:

```bash
openspec validate add-standard-modulators --strict
openspec status --change add-standard-modulators
```

Audit changed files for placeholders, contradictions, accidental migration code, unrelated edits, and the pre-existing untracked MiniApp build directory.

- [ ] **Step 5: Commit and stop for final review**

Mark only genuinely completed OpenSpec tasks, commit with subject `docs(synth): record standard modulator coverage`, and write the final implementation report. A whole-branch Claude Opus xagent review then checks the complete OpenSpec change, this plan, all reports, the full diff, lifecycle/realtime safety, pointer stability, application ordering, persistence choice, test strength, performance results, and merge readiness. Any Critical/Important finding returns to a native Codex fixer and a fresh review.

---

## Requirement-to-Task Map

- `ssm-1` through `ssm-4`: Task 1.
- `ssm-5`: Task 2.
- `spm-71`, `sdsp-33`, `sdsp-38`, and `sdsp-40`: Task 3.
- `d4-1`, `d4-3`, `d4-8`, and `d4-9`: Task 4.
- Cross-cutting verification, performance, persistence, and documentation: Task 5.
