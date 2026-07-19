`kVoiceCount = 2` confirms the two-voice processor. All constraints verified. Here is my review report.

---

## Task 3 Review: MiniApp Fifth-Modulator Integration

### Spec Compliance
✅ **Spec compliant** — all binding global constraints verified against the diff:

- **Five slots, noise only at index 4, index 3 untouched:** `.numModulators = 5` (`MiniAppCore.hpp:66`); exactly one `group.SetModulationSource(4, ...)` (`:102`); no `SetModulationSource(3, ...)` and no index-3 metadata write anywhere in the diff. Tests assert only indexes `0`, `1`, `2`, `4` and never read index-3 connection/color state (`miniapp_system_tests.cpp:735-739`, `757-760`).
- **Two-voice processor + one retained visualizer, address-stable:** `synth::NoiseModulatorProcessor noiseModulator_{kVoiceCount}` with `kVoiceCount = 2` (`MiniAppCore.hpp:278`, `:41`) and `synth::ui::NoiseWaveformVisualizer noiseVisualizer_{synth::Color::White}` (`:285`) are both value members — stable from registration through teardown. `SourcePointers()` and `&noiseVisualizer_` point into these members.
- **Scope topology unchanged — three distinct retained instances at 0/1/2:** `vcoVisualizer0_`, `vcoVisualizer1_`, `lfoVisualizer_` still assigned to Metadata 0/1/2 (`:315-317`); index-4 noise visualizer is separate and model-free (`:318`).
- **Noise processed once immediately before update:** `noiseModulator_.Process();` is the last modulator call, directly preceding `UpdateModValues(*group_)` (`:205-206`), after all signal modulators (`vco`/`filter`/`lfo`) have produced values.
- **Metadata at index 4:** `connected = true`, `name = "Noise"`, `shortName = "Noise"`, `sourceColor = Color::White` (`:102-107`).
- **No new parameters/banks/pages/scope channels/persistence/routing:** `.maxParameters = 24` retained (`:69`); scope stays `ScopeWriter{4, ...}` / `array<..., 4>` (unchanged); audio mix loop untouched.
- **Makefile:** only header-only deps `include/synth/DspNoise.hpp` and `include/synth/NoiseWaveformVisualizer.hpp` added to `$(MINIAPP_SYSTEM_TEST_BIN)`; no new compiled sources (`Makefile:107`).

### Strengths
- Tests were correctly refactored to keep index-3 out of scope: `miniapp_registers_distinct_scope_visualizers_for_modulators` extends 0/1/2 checks with a separate distinct-instance assertion for index 4 (`miniapp_system_tests.cpp:651-660`), and `miniapp_color_flow_keeps_semantic_roles_independent` moves from `== {Cyan,Orange,Green}` equality to per-index checks at 0/1/2/4 plus `size() == 5`, deliberately skipping index 3 (`:757-760`, `:775-779`).
- Process ordering and object lifetime are clean: members outlive Init/Process, and `SourcePointers()` addresses remain valid because the processor is a retained member, not a temporary.
- RED evidence in the report is specific and consistent with the diff (`numModulators == 5` fails, `modulator index out of range` for the value-publication test, `metadata.size() == 5` fails).

### Issues
#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)
- `miniapp_publishes_new_noise_values_before_each_modulation_update` asserts `first0 != second0 || first1 != second1` (`miniapp_system_tests.cpp:755`). This is a probabilistic non-repeat check; with a well-behaved PRNG the flake risk is negligible, but if the underlying noise ever seeds deterministically per-block it could false-fail. Impact: potential rare flake. Fix (optional): compare across more blocks or assert against a known-changing counter — not required given the Task 1 noise contract.

### Assessment
**Task quality:** Approved

**Reasoning:** The change makes exactly the five-slot / index-4-only edits the brief specifies with correct process ordering, retained address-stable members, and preserved scope/parameter/bank topology; tests were restructured to assert 0/1/2/4 while leaving index-3 state entirely unexamined, and the sole minor note is an optional test-robustness nit that does not block.