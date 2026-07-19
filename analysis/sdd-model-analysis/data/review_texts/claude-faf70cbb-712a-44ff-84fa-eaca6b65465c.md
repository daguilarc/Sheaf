## Task 2 Review — Ganged Random LFO (base `02339009` → head `e1e6235b`)

**Spec Compliance: PASS**
**Code Quality: PASS**

No Critical or Important findings.

### Verification method
Read `task-2-brief.md`, `task-2-report.md`, `task-2-review-package.md`, the reviewed plan (`docs/superpowers/plans/2026-07-15-ganged-random-lfo.md`), and the authoritative spec (`openspec/changes/add-ganged-random-lfo/specs/synth-dsp-classes/spec.md`, requirements `sdsp-35`/`sdsp-36`). Hand-traced both new tests (`ganged_random_lfo_samples_round_in_canonical_logical_order` and `ganged_random_lfo_slowest_voice_gates_round_turnover`) against `projects/synth/include/synth/DspRandomLfo.hpp` draw-by-draw to confirm the canonical RNG order and completed-output-preservation claims independently of the report's assertions. No code was edited and no tests were re-run.

### Audit results by category
- **Voice transitions / reset / output semantics** (`DspRandomLfo.hpp:92-119`, `84-90`): matches `sdsp-35` scenarios exactly — Waiting outputs source through the crossing call, Moving outputs `ShapedInterpolate` and clamps to target on crossing, Done holds target, `Reset` chains old target → new source. Confirmed via `ganged_random_lfo_voice_runs_wait_move_and_done_states`.
- **Double progress/increments**: `m_currentStateProgress`, `VoiceInput::waitingIncrement/movingIncrement` are `double`; only `ShapedInterpolate`'s float boundary narrows. Correct.
- **Canonical full RNG order**: hand-simulated both scripted-draw tests against `SampleAndResetRound` (`DspRandomLfo.hpp:243-282`) — draw sequence is exactly waiting-center → waiting-rates[0..N) → moving-center → moving-rates[0..N) → target-center → target-deviations[0..N) → shapes[0..N), matching `sdsp-36`'s "canonical logical draw order" scenario bit-for-bit.
- **Target/shape distributions and clamps**: target center via `Uniform01`, per-voice targets `Normal(center, targetInternalSigma)` clamped to `[0,1]` (`std::clamp(sampledTarget, 0.0, 1.0)`), shapes independently uniform `[0,1]`. Matches spec, including both clamp directions exercised in the canonical-order test (`-0.2 → 0.0`, `1.2 → 1.0`).
- **First-call seeding**: default-Done voices immediately satisfy `allDone` on call 1, so `SampleAndResetRound` runs inside that same call; because `Reset` sets `m_output = m_source` (= previous default target `0.0`), the call still *returns* the prior done output while the new round's increments become active starting the next call — satisfies the "boundary reuse" semantics in `sdsp-36` and design.md §2.
- **Process-all-before-slowest gate**: loop processes every voice before evaluating `allDone` (`DspRandomLfo.hpp:174-179`), never short-circuits. Confirmed via `ganged_random_lfo_slowest_voice_gates_round_turnover`.
- **Completed-output preservation**: hand-traced the full 5-call gating test — on the turnover call, `Reset`'s `m_output = m_source` (old target) exactly reproduces the just-finished round's value (`Output(0)==0.25`, `Output(1)==0.75`) before the new round's targets (`0.4`, `0.6`) take effect. Correct and elegant reuse of the same assignment for two purposes.
- **Round elapsed reset**: reset to `0.0` in `SampleAndResetRound`, incremented by `1.0` otherwise; matches assertions in both gang tests.
- **Fixed-seed production/injected draw paths**: three constructors (default entropy, `uint32_t` seed, injected `DrawSource`) are unambiguous (the `DrawSource` converting constructors are `explicit`, so no overload collision for `uint32_t` seed args). `ganged_random_lfo_fixed_seed_is_reproducible` is a legitimate reproducibility check.
- **Validation**: `ValidateInput` runs every `Process` call (not just on round turnover), which the `-0.1f` targetInternalSigma test after 10,000 prior calls requires and gets. Sample-rate/config checks fail loudly via `std::invalid_argument`.
- **Out-of-range accessors**: `Output(voice)` throws `std::out_of_range` for `voice >= VoiceCount` — see Minor finding below (untested).
- **One-hour floor**: `epsilonIncrement = 1.0/(sampleRate*3600.0)` applied identically to waiting and moving; `ganged_random_lfo_floors_heavy_tail_increments` confirms `ceil(1/increment) == ceil(sampleRate*3600)`.
- **Persistent distributions / zero-sigma**: `DefaultRandomDrawSource` holds `m_normal`/`m_uniform` as persistent members (no per-call construction) and special-cases `sigma == 0.0` by returning `mean` directly — correctly avoids UB, since `std::normal_distribution::param_type` requires `stddev > 0` per the standard.
- **Cos2Pi prewarm**: `Prepare()` calls `DefaultDspMath::Cos2Pi(0.0f)`, forcing the lazily-initialized `DspMath::Instance()` table build (magic static, thread-safe) before any audio-thread `Process` call can reach `Moving`/`ShapedInterpolate`. Correct fix for the real-time concern in design.md's risk list.
- **Real-time structural claims**: see Minor finding below — code itself is genuinely allocation-free (only `std::array`, persistent distribution members, no containers/`new`/locks/I-O in `Process`), but the "allocation guard" framing overstates what the test verifies.

### Task 3 leak check
No `GangedRandomLfoVoiceSnapshot`, `GangedRandomLfoSnapshot`, `PublishUiState`, or `ReadSnapshot` symbols exist anywhere in the tree — confirmed via repo-wide grep. Diff is scoped exactly to the two files declared in the brief (`DspRandomLfo.hpp`, `dsp_tests.cpp`), 224/269 lines added, matching `task-2-review-package.md`. Clean.

### Task 1 API coherence
The diff only appends after the existing `SampleCorrelatedIncrements` closing brace; `ShapedInterpolate`, `RandomTimingConfig`, and `SampleCorrelatedIncrements` signatures are byte-identical to Task 1. No regression.

### Findings

**Critical:** none.

**Important:** none.

**Minor:**
1. `projects/synth/include/synth/DspRandomLfo.hpp:207-212` — `GangedRandomLfoProcessor::Output(voice)`'s `std::out_of_range` throw path has no test coverage anywhere in `dsp_tests.cpp` (grep confirms `.Output(` is only ever called with in-range indices). Not required by the task-2 brief's explicit test list, so not spec non-compliance, but it's an untested defensive branch. Fix: add one assertion in a Task 2/3 test, e.g. `gang.Output(2)` on a `GangedRandomLfoProcessor<2>` wrapped in a try/catch expecting `std::out_of_range`, mirroring the existing `rejectedSampleRate`/`rejectedTargetSigma` pattern in `ganged_random_lfo_validates_setup_and_uses_fixed_storage`.
2. `task-2-report.md:44-49` — the report labels the 10,000-iteration loop in `ganged_random_lfo_validates_setup_and_uses_fixed_storage` an "allocation guard," but there is no allocation-instrumentation utility anywhere in `projects/synth` (confirmed via repo-wide grep for allocator/interposition helpers) — the test is a soak/crash test plus two `static_assert`s on accessor return types, not an empirical no-allocation proof. I independently verified by reading `Process`/`SampleAndResetRound` that no heap allocation, container, lock, or I/O occurs, so the underlying claim holds — but the report's wording should describe this as "code-reviewed + soak-tested," not "allocation-guarded," since a future regression (e.g., an accidental `std::vector` or `new`) would not be caught by this test. No code fix required; if desired, tighten `task-2-report.md`'s wording only.