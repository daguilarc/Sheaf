All three named test files accurately and precisely back the coverage mappings. Here is my review.

## Task 4 Review Report

### Spec Compliance
- ✅ **Spec compliant** — The diff changes documentation/checklist files only (`openspec/changes/add-noise-modulator/tasks.md`, `projects/synth/docs/coverage.md`; diff package lines 6–9), and every binding requirement is met by evidence I verified against the real test sources.
- ⚠️ **Cannot verify from diff:** the runtime verification claims (full `make test`, UI-boundary check, `openspec validate --strict`, `12/12 all_done`) and that OpenSpec items `1.1`–`3.3` were genuinely completed/reviewed in prior commits — the controller must confirm these; only `4.1`–`4.3` and the coverage rows are in this diff.

### Strengths
- **Exactly one current mapping per required identifier.** The old generic `sdsp-33` row (`review-6ded5966..f15e6c69.diff:52`) is replaced, not duplicated, and single rows are added for `spv-6` (`:48`), modified `sdsp-13` (`:53`), modified `sdsp-33` (`:54`), `sdsp-34` (`:55`), and `sdsp-35` (`:56`).
- **The index 0/1/2 vs index 4 distinction is real, not asserted.** `miniapp_registers_distinct_scope_visualizers_for_modulators` verifies mod0/mod1/mod2 non-null, distinct, and visible, with mod4 distinct from all three (`miniapp_system_tests.cpp:641-665`); `miniapp_registers_noise_as_the_fifth_modulator` confirms `numModulators == 5`, `metadata[4]` connected `"Noise"`, distinct from indexes 0–2 (`:667-686`). The `sdsp-33` and `spv-6` coverage prose matches this exactly.
- **`sdsp-13` prose maps to concrete DSP tests.** deterministic seeded/strict-open (`dsp_tests.cpp:147-159`), one advance per voice (`:161-169`), distribution sanity (`:171-188`), stable pointers (`:190-202`), and direct `ParameterGroup` publication (`:204`).
- **`sdsp-35`/`spv-6` portable claims are backed.** model-free seeded monophonic geometry with per-column bounds inside a strict-open interval (`portable_ui_tests.cpp:260-290`), consecutive-redraw regeneration (`:293-306`), and base-contract coverage — visibility, invalid-bounds safety, non-copyable/non-movable, builder composition (`:308-393`).

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)
- `projects/synth/docs/coverage.md:54,48` — The binding requirement lists "five-slot topology" among behaviors the mappings must name a test for. The five-slot assertions (`numModulators == 5`, `metadata.size() == 5`) live in `miniapp_registers_noise_as_the_fifth_modulator`, which the `sdsp-33`/`spv-6` rows point at (the named file) but describe only as "retained index-4 noise visualizer" rather than the topology itself. Impact: purely descriptive; the owning file is correctly named and index-4 implies five slots. Fix (optional): add "five-slot two-voice group" to the `spv-6` MiniApp clause for explicitness.

### Assessment
**Task quality:** Approved

**Reasoning:** The diff is documentation/checklist-only with exactly one accurate, non-overstated mapping per required identifier, and independent inspection of the three named test files (`dsp_tests.cpp`, `miniapp_system_tests.cpp`, `portable_ui_tests.cpp`) confirms every claimed behavior — including the central 0/1/2-vs-4 visualizer distinction — is genuinely exercised. Remaining gates (full-suite/OpenSpec verification integrity and prior-task checkbox correctness) are cross-task facts outside this diff and left for the controller.