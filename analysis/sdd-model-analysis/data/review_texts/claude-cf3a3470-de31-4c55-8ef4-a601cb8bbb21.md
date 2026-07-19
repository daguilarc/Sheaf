Good, I now have all the evidence needed to write the review.

### Spec Compliance PASS/FAIL

**PASS.** `Prepare`/`Process`/`PublishUiState`/`IsPrepared` (projects/synth/include/synth/StandardModulators.hpp:74-106) implement `ssm-5` (openspec/changes/add-standard-modulators/specs/synth-standard-modulators/spec.md:95-117) and design.md decision 4 (openspec/changes/add-standard-modulators/design.md:69-75) exactly:

- **Lifecycle ordering/errors**: `Prepare` throws `std::logic_error` before registration (StandardModulators.hpp:77-79), `std::invalid_argument` on non-finite/non-positive rate (:80-82) before touching any processor (atomic w.r.t. failure); `Process` throws `std::logic_error` before preparation (:90-92). Verified by `standard_modulators_lifecycle_requires_registration_and_finite_preparation` (dsp_tests.cpp:302-349), including re-prepare and failed-re-prepare preservation (:339-348).
- **Exactly four random advances + voice-order copies + one noise advance**: StandardModulators.hpp:93-99 — `kRandomCount` loop calling `Process`+copy, single `noiseProcessor_.Process()`; no constant call. Verified by `standard_modulators_process_advances_dynamic_sources_once_and_copies_voice_order` (dsp_tests.cpp:351-402).
- **Zero constant hot-path work**: no `constantProcessor_` reference anywhere in `Process()` (StandardModulators.hpp:89-100); constant values/pointers proven unchanged (dsp_tests.cpp:399-400).
- **Stable pointers/visualizers**: `randomPointerRows_` populated once at construction (StandardModulators.hpp:52-56) and never rewritten in `Process`/`PublishUiState`; addresses proven stable across two `Process()` + `PublishUiState()` cycles (dsp_tests.cpp:410-486).
- **Explicit, caller-owned `UpdateModValues`**: neither `Process()` nor `PublishUiState()` calls it (StandardModulators.hpp:89-106); `Modulators::UpdateModValues` only refreshes `connected` slots from source pointers (projects/synth/src/ParameterModulation.cpp:294-306), so an unregistered mono index `11` is never rewritten. Verified dsp_tests.cpp:436-465, 488-497.
- **Block-controlled publication of all four coherent snapshots**: `PublishUiState` (StandardModulators.hpp:102-106) only calls per-processor `PublishUiState` (revision-guarded, DspRandomLfo.hpp:351-373); snapshots proven unchanged across two `Process()` calls until publication (dsp_tests.cpp:443-451, 467-477).
- **Bounded accessors**: `.at()`-based bounds checks on `RandomProcessor/RandomInput/RandomOutputRow/RandomPointerRow` and a switch-with-`throw`-default for `RandomVisualizer` (StandardModulators.hpp:155-203); covered both const/non-const at index 4 in `standard_modulators_random_inspection_is_bounds_checked` (dsp_tests.cpp:500-516).
- **Mono constant disconnection**: unaffected by Task 2 (Process/Publish never touch constant regardless of `VoiceCount`); re-verified end-to-end at dsp_tests.cpp:488-497.
- **No wrapper allocation/lock/entropy/system-random call in `Process`**: confirmed by inspection — `GangedRandomLfoProcessor::Process` uses fixed-size arrays and a pre-seeded `mt19937` (DspRandomLfo.hpp:311-325, 409-448); `NoiseModulatorProcessor::Process` uses a locally pre-seeded `FastPcg32`, no per-call OS entropy (DspNoise.hpp:69-73). `std::random_device` is touched only at construction (DspNoise.hpp:42-46), outside `Process()`.
- **Task 1 cleanup fixes**: (1) unused `<span>` removed from StandardModulators.hpp — verified still transitively available via DspNoise.hpp/DspConstant.hpp, no compile risk. (2) `ParameterModulation.hpp` added to `STANDARD_MODULATOR_HEADERS` (Makefile:105) — correct, since StandardModulators.hpp:9 already depends on it. (3) `SetColor` added to `NoiseWaveformVisualizer` (NoiseWaveformVisualizer.hpp:22) and `ConstantBarVisualizer` (ConstantBarVisualizer.hpp:20), applied from frozen metadata during `Register()` (StandardModulators.hpp:131-132) — correctly lets pre-registration color overrides reach the owned visualizer; verified by `standard_modulators_metadata_color_overrides_reach_owned_visualizers` (dsp_tests.cpp:518-536).

### Strengths

- `Prepare()` validates lifecycle/rate before mutating any processor, giving true atomic failure semantics rather than partially preparing 4 processors then throwing.
- Tests directly exercise pointer/address stability (output row data pointers, pointer rows, visualizer addresses, metadata visualizer pointers) across two process+publish cycles rather than only checking values — this is the strongest possible proof against the "no reconstruction" requirement.
- Deterministic-config test (`muSeconds=0.01`, zero sigma) for the advancement test is a good way to get bit-exact Waiting→Moving assertions without redesigning `GangedRandomLfoProcessor`.
- Task 1 cleanup fixes are minimal, single-purpose, and each has a dedicated regression test rather than being asserted only in prose.

### Issues

**Critical:** None.

**Important:** None.

**Minor:**
- Re-preparing a bundle whose random processors are mid-round (i.e., calling `Prepare()` again after `Process()` has already advanced voices into `Moving`/`Done`) is untested — only prepare→prepare-before-any-`Process()` is covered (dsp_tests.cpp:333-348). Real applications only prepare once, so this is a coverage gap rather than a defect.
- `Register()` unconditionally calls `constantVisualizer_.SetColor(...)` (StandardModulators.hpp:132) even for `VoiceCount == 1`, where the constant visualizer is never installed on the group. Harmless (dead write on an otherwise-unused object) but slightly inconsistent with the mono "constant is entirely excluded" framing.

### Assessment

Task quality: **Approved**.