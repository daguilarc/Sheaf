# Review package: 2a5a51f..cfd5fc03

## Commits
cfd5fc03 docs(synth): record sparse modulation cleanup
092a64d2 chore(synth): polish sparse modulation invariants
9d8dc8e0 docs(openspec): record sparse scaling verification
baf2c608 test(synth): guard sparse modulation scaling
5a1e9408 docs(synth): record sparse lifecycle integration
5d0bc6fb test(synth): cover sparse modulation lifecycle end to end
5115cdf9 docs(openspec): record local recycling task
dda1aeee perf(synth): recycle neutral modulation controls
0b42e995 docs(openspec): record active route task
159a0dd1 perf(synth): traverse only active modulation routes
f27ff53b docs(openspec): record sparse gestures task
b7537817 refactor(synth): narrow gesture selection access
3549f01b feat(synth): support sparse 64-bit gestures
94b2b700 docs(openspec): record sparse processing task 1
cc52c4c9 perf(synth): process only top-level parameters per sample

## Files changed
 .superpowers/sdd/progress.md                       |   18 +
 .../final-cleanup-report.md                        |   37 +
 .../scale-modulation-processing/task-1-brief.md    |  113 ++
 .../scale-modulation-processing/task-1-report.md   |   83 +
 .../task-1-review-package.md                       |  342 ++++
 .../scale-modulation-processing/task-2-brief.md    |  105 ++
 .../scale-modulation-processing/task-2-report.md   |   66 +
 .../task-2-review-package.md                       | 1490 +++++++++++++++++
 .../scale-modulation-processing/task-3-brief.md    |  103 ++
 .../scale-modulation-processing/task-3-report.md   |   68 +
 .../task-3-review-package.md                       | 1745 ++++++++++++++++++++
 .../scale-modulation-processing/task-4-brief.md    |   91 +
 .../scale-modulation-processing/task-4-report.md   |  131 ++
 .../task-4-review-package.md                       | 1265 ++++++++++++++
 .../scale-modulation-processing/task-5-brief.md    |   60 +
 .../scale-modulation-processing/task-5-report.md   |   55 +
 .../task-5-review-package.md                       | 1288 +++++++++++++++
 .../scale-modulation-processing/task-6-brief.md    |   68 +
 .../scale-modulation-processing/task-6-report.md   |   81 +
 .../task-6-review-package.md                       |  556 +++++++
 .../2026-07-15-scale-modulation-processing.md      |    4 +-
 .../changes/scale-modulation-processing/tasks.md   |   50 +-
 projects/synth/docs/coverage.md                    |  103 +-
 projects/synth/include/synth/EncoderDraw.hpp       |   20 +-
 .../synth/include/synth/ParameterModulation.hpp    |   91 +-
 projects/synth/src/ParameterModulation.cpp         |  683 ++++++--
 projects/synth/src/PatchPersistence.cpp            |    5 +-
 projects/synth/tests/braid4_deadline_tests.cpp     |   52 +-
 projects/synth/tests/braid4_system_tests.cpp       |  161 ++
 projects/synth/tests/instrument_tests.cpp          |   59 +
 projects/synth/tests/module_tests.cpp              |    6 +
 .../synth/tests/parameter_modulation_tests.cpp     | 1492 +++++++++++++++--
 projects/synth/tests/portable_ui_tests.cpp         |   22 +
 33 files changed, 10221 insertions(+), 292 deletions(-)

## Diff
diff --git a/.superpowers/sdd/progress.md b/.superpowers/sdd/progress.md
index 4b446683..fe6229ab 100644
--- a/.superpowers/sdd/progress.md
+++ b/.superpowers/sdd/progress.md
@@ -42,10 +42,28 @@ Workspace: managed linked worktree, detached HEAD
 - Plan review: native Codex plan corrected against actual paths/targets; xagent Claude Sonnet returned REVISE, valid findings were incorporated, one color-ownership inference was rejected against authoritative design text, and focused Claude re-review returned PASS.
 - Task 1: complete (commit `8b5b1b3c`; required missing-header RED observed; full DSP binary GREEN independently reconfirmed; Claude Sonnet spec and quality verdicts PASS with no Critical/Important findings; OpenSpec 1.1–1.4 checked). Minor cleanup ledger: rename local `outputT` for clarity and add an explicit infinite-`muSeconds` rejection case before final review.
 - Task 2: complete (commit `e1e6235b`; required missing-API RED observed; full DSP binary GREEN independently reconfirmed; Claude Sonnet spec and quality verdicts PASS with no Critical/Important findings; OpenSpec 2.1–2.5 checked). Minor cleanup ledger: cover the out-of-range `Output` accessor and describe the turnover test as structural/soak evidence rather than heap instrumentation.
 - Task 3: complete (commit `4ab1c319`; required missing-snapshot-API RED observed; full DSP binary GREEN independently reconfirmed; Claude Opus spec and quality verdicts PASS with no Critical/Important findings; OpenSpec 3.1–3.2 checked). Minor cleanup ledger: decide whether to enforce the shipped-target `std::atomic<double>::is_always_lock_free` assumption after browser/JUCE builds are known.
 - Task 4: complete (commit `0e44c997`; missing-header RED observed for portable/browser consumers and the inability to isolate the JUCE assertion RED was disclosed; portable geometry, browser command-buffer, JUCE MiniApp parity, and browser MiniApp GREEN were reported, with portable and browser command-buffer checks independently reconfirmed; Claude Sonnet spec and quality verdicts PASS with no Critical/Important correctness findings; OpenSpec 3.3–3.5 checked). Minor cleanup ledger: prevent the JUCE explicit-bounds fallback from expanding a present dot at pathologically tiny widget bounds.
 - Task 5: complete (commit `31f3536a`; missing MiniApp gang/visualizer API RED observed; all 26 MiniApp system tests GREEN independently reconfirmed and the JUCE MiniApp suite passed in the implementation report; Claude Sonnet spec and quality verdicts PASS with no Critical/Important findings; OpenSpec 4.1–4.2 checked). Minor cleanup ledger: add direct includes for random-LFO types and document the full worst-case `12 + 12 * 4 = 60` parameter-capacity formula before final review.
 - Task 6: complete (commit `c9058167`; missing third-panel builder/node RED observed across portable, system, JUCE, and browser consumers; portable and 27-case MiniApp system suites, browser command-buffer, UI boundary, and diff checks were independently reconfirmed, while JUCE and forced Emscripten builds passed in the implementation report; Claude Sonnet spec and quality verdicts PASS with no Critical/Important findings; OpenSpec 4.3–4.4 checked). Minor cleanup ledger: make the direct main-panel snapshot read fail closed explicitly and replace the duplicated literal voice count with the MiniApp snapshot alias.
 - Task 7: complete (commit `41e376c4`; stale native/JUCE/browser dependency discovery was demonstrated before exact Make wiring; focused DSP/portable/MiniApp/browser/boundary checks, JUCE and browser builds, the full synth suite, strict OpenSpec, placeholder scan, diff check, and untouched legacy-tree check all passed and were independently repeated by Claude Sonnet; spec and quality verdicts PASS with no Critical/Important findings; OpenSpec 5.1–5.3 checked). Minor cleanup ledger: align the two new JUCE coverage citations with the established binary-name/colon style.
 - Final cleanup: complete (commit `1629eb13`; resolved every accumulated per-task minor, added explicit lock-free target enforcement, tiny-widget and bounded-read fail-closed regressions, direct includes/capacity rationale, named snapshot alias, and coverage citation cleanup; DSP, portable, 28-case MiniApp system, JUCE, browser, command-buffer, boundary, and diff checks passed).
 - Final whole-change review: xagent Claude Opus reviewed `74b7fe4a..1629eb13` and returned PASS for spec compliance, architecture/correctness, realtime/concurrency safety, test adequacy, and overall merge readiness, with no Critical/Important findings. Optional notes: the proposed missing native `DspMath.hpp` edge was already empirically disproven because its `DSP_HEADERS` -> library dependency rebuilds all three consumers; the relaxed-field seqlock note is theory-only on fully atomic shipped targets; stronger segmentation/order/fail-closed assertions are nonblocking polish.
+
+# Scale Modulation Processing SDD Progress
+
+Plan: `docs/superpowers/plans/2026-07-15-scale-modulation-processing.md`
+OpenSpec change: `scale-modulation-processing`
+Implementation base: `562be16ff6a04ebd0fb450387433f549b37e70fb`
+Branch: `codex/scale-modulation-processing`
+
+- Spec review: xagent Claude Opus returned PASS with no blocking issue; all Important plan/spec tightenings were incorporated, including full 64-bit randomized UI masks, distinct gesture labels through 64, browser rendered-command scope, accepted local UI cadence, across-voice route union, and explicit recycled-slot accounting.
+- Baseline: `make -C projects/synth test` exited 0 before implementation. Braid4 deadline evidence: 48 kHz avg `1.25264 ms`, p99 `1.41017 ms`; 96 kHz avg `1.24633 ms`, p99 `1.38579 ms`.
+- Execution policy: fresh native Codex implementer for each task; exact base-to-head package and xagent Claude two-verdict review after every task; Sonnet for Tasks 1, 2, 5, 6, Opus for Tasks 3, 4 and final whole-change review.
+- Task 1: complete (commit `cc52c4c9`; required missing-observer RED observed; parameter modulation, Braid4 system, module, engine, and rig suites GREEN; xagent Claude Sonnet returned SPEC COMPLIANCE PASS and CODE QUALITY PASS with no Critical/Important findings; OpenSpec 1.1, 1.3, and 3.1-3.3 checked; 1.2 deliberately deferred to Task 3 where the full-scan oracle is implemented). Minor cleanup ledger: expose/use a direct top-level parameter count before the recycling phase instead of relying on a pre-materialization `ParameterCount()` snapshot in the Braid4 structural test.
+- Task 2: complete (commits `3549f01b` and review fix `b7537817`; strict RED covered 64-bit boundaries, sparse visits, bit-63 UI/controller/persistence, and narrow selected-mask access; 218 parameter cases plus portable UI and instrument suites GREEN; xagent Claude Sonnet final SPEC COMPLIANCE PASS and CODE QUALITY PASS with no Critical/Important findings; OpenSpec 2.1-2.4 checked). Minor cleanup ledger: Task 5 must expand the randomized state machine through gesture 63 and remove its vestigial 32-bit loop cap; optionally replace the side-effect-only `SceneGestureIndex` calls with a named validator.
+- Task 3: complete (commit `159a0dd1`; strict RED proved the active-route API absent; 222 parameter cases and 39 module cases GREEN; no production full-scan apply callers remain; xagent Claude Opus returned SPEC COMPLIANCE PASS and CODE QUALITY PASS with no Critical/Important findings; OpenSpec 1.2 and 4.1-4.5 checked). Minor cleanup ledger: restore alphabetical include order, centralize the repeated route-neutral tolerance, and consider a low-value constructor binding/identity-init helper only if final cleanup remains simple.
+- Task 4: complete (commit `dda1aeee`; strict RED proved collection/accounting APIs absent; parameter modulation, engine, and MiniApp system suites GREEN; xagent Claude Opus returned SPEC COMPLIANCE PASS and CODE QUALITY PASS with no Critical/Important findings; OpenSpec 5.1-5.6 checked). Minor cleanup ledger: batch reset-all collection once rather than once per top-level control, document the standard bipolar 0.5 recycle predicate, and add a direct multi-level nested-view pin-balance test.
+- Task 5: complete (commit `5d0bc6fb`; meaningful RED exposed the 2-vs-64 gesture topology mismatch; four prescribed integration binaries GREEN; deterministic parameter runs repeated with seeds `0x51A7`, `0xC0FFEE`, and `0xA11CE` over 250 steps; xagent Claude Sonnet returned SPEC COMPLIANCE PASS and CODE QUALITY PASS with no Critical/Important findings). Minor cleanup ledger: the deliberately symmetric source-to-slot and slot-to-source oracle loops are mildly redundant but valuable as belt-and-suspenders coverage.
+- Task 6: complete (commit `baf2c608`; fixture/API RED plus breadth-first materialization assertion RED observed; focused Braid4 suites and `make synth-test` GREEN; strict OpenSpec and zero browser diff passed; xagent Claude Sonnet returned SPEC COMPLIANCE PASS and CODE QUALITY PASS with no Critical/Important findings; OpenSpec 6.1-6.4 checked). Recorded Task 6 timings: 48/192 kHz baseline avg/p99 `1.03810/1.06567 ms`, sparse `1.04574/1.07104 ms`; 96/384 kHz baseline `1.02816/1.04525 ms`, sparse `1.04270/1.11071 ms`. Minor cleanup ledger: rename/comment the currently-materialized dense-route upper bound so it is not mistaken for a full-capacity dense bound.
+- Final cleanup: complete (commit `092a64d2`; direct top-level count, named gesture validation, shared neutral constants, once-per-group reset collection, bipolar recycle documentation, three-level pin/reuse coverage, and accurate dense-bound naming; compile/work-count REDs observed; focused and full synth suites plus strict OpenSpec GREEN). Deliberately retained the symmetric oracle checks and skipped the low-value constructor helper.
diff --git a/.superpowers/sdd/scale-modulation-processing/final-cleanup-report.md b/.superpowers/sdd/scale-modulation-processing/final-cleanup-report.md
new file mode 100644
index 00000000..a9f2dd9a
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/final-cleanup-report.md
@@ -0,0 +1,37 @@
+# Scale Modulation Processing Final Cleanup Report
+
+Commit: `092a64d2` (`chore(synth): polish sparse modulation invariants`)
+
+## Scope completed
+
+- Added `ParameterGroup::TopLevelParameterCount()` and changed the Braid4 structural test to compare the direct registered-root count against high-water storage after local materialization.
+- Replaced side-effect-only `SceneGestureIndex` casts with the explicitly named `ValidateSceneGestureIndices` helper while preserving the indexed accessor helper.
+- Restored standard-library include order and centralized the shared `1e-6` modulation-neutral tolerance.
+- Batched reset-bank collection: all unique mapped top-level parameters are reset first, then each distinct affected group is collected once. A work-count regression uses the existing processing observer boundary and also verifies all reset values.
+- Centralized and documented `0.5` as the normalized bipolar knob center representing zero modulation depth.
+- Added a three-level nested modulation-view regression proving pins retain the entire visible ancestry, deselection collapses the neutral subtree, and a later parent reuses one of those slots without growing high-water storage.
+- Renamed and documented Task 6's dense-route comparison as the currently materialized top-level dense-route upper bound, not a full-capacity bound.
+
+The deliberately excluded constructor binding helper was not added, and the symmetric oracle loops were retained unchanged.
+
+## TDD evidence
+
+1. Initial RED build failed because `ParameterProcessingObserver::neutralCollectionPasses` did not exist.
+2. Separate Braid4 RED build failed because `ParameterGroup::TopLevelParameterCount()` did not exist.
+3. After adding only the requested observability/API plumbing, the parameter suite ran and the new reset batching test failed specifically at `work.neutralCollectionPasses == 1`, demonstrating the old once-per-control collection behavior.
+4. After batching the collection boundary, both focused binaries passed. The nested-view regression was then added as direct coverage of already-intended pin/reuse behavior and passed without additional production behavior changes.
+
+## Verification
+
+- `make -C projects/synth build/parameter_modulation_tests build/braid4_system_tests`
+- `projects/synth/build/parameter_modulation_tests`
+- `projects/synth/build/braid4_system_tests`
+- `make synth-test`
+- `openspec validate scale-modulation-processing --strict`
+- `git diff --check`
+
+All commands completed successfully. Strict OpenSpec validation reported `Change 'scale-modulation-processing' is valid`.
+
+## Skips / risks
+
+No requested cleanup item was skipped as invasive. The cleanup does not alter patch JSON, browser/controller protocol, source or gesture identity, or audio-rate traversal behavior. Collection observability adds only a null-checked counter increment at the existing control-boundary collection entry point.
diff --git a/.superpowers/sdd/scale-modulation-processing/task-1-brief.md b/.superpowers/sdd/scale-modulation-processing/task-1-brief.md
new file mode 100644
index 00000000..597661d4
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-1-brief.md
@@ -0,0 +1,113 @@
+### Task 1: Test Observability and the Top-Level Processing Boundary
+
+**OpenSpec coverage:** tasks 1.1-1.3, 3.1-3.3; `spm-72` scenarios “Materialized local depth does not add ProcessLite work” and “Recursive compute still refreshes local depth state.”
+
+**Files:**
+- Modify: `projects/synth/include/synth/ParameterModulation.hpp` — `ParameterProcessingObserver`, `ParameterGroup`, `Parameter` test-observer hooks and root list.
+- Modify: `projects/synth/src/ParameterModulation.cpp` — registration, group processing, recursive local state seeding.
+- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — structural counters and recursive-display regression.
+- Modify: `projects/synth/tests/braid4_system_tests.cpp` — Braid4 root/local structural assertion.
+
+**Interfaces:**
+- Produces: `struct ParameterProcessingObserver { std::size_t topLevelProcessLiteCalls; std::size_t localRecursiveComputeCalls; std::size_t activeRouteVisits; std::size_t activeGestureVisits; };`
+- Produces: `void ParameterGroup::SetProcessingObserverForTests(ParameterProcessingObserver* observer)`; the caller owns the observer and may clear it with `nullptr`.
+- Produces: `void ParameterGroup::RegisterTopLevelParameter(Parameter&)` and dense `std::vector<Parameter*> topLevelParameters_`.
+- Consumes: existing `ParameterManager::RegisterParameter`, `ParameterGroup::ProcessSample`, `Parameter::ComputeAtDepth`, and `Parameter::SeedCachedKnobAndUiDisplayState`.
+
+- [ ] **Step 1: Write RED structural tests before changing group processing**
+
+Add a test that creates two roots, materializes a child and grandchild, attaches an observer, and processes both an ordinary sample and a compute-cadence sample:
+
+```cpp
+TEST_CASE(group_process_sample_visits_only_registered_roots) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2,
+                                       .numScenes = 1, .maxParameters = 8,
+                                       .targetComputeIntervalSamples = 16});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});
+    (void)manager.CreateParameter(group, {.name = "Tone"});
+    auto& depth = carrier.EnsureModulationDepth(0, {.name = "Carrier M1", .defaultValue = 0.5f});
+    (void)depth.EnsureModulationDepth(1, {.name = "Carrier M1 M2", .defaultValue = 0.5f});
+    synth::ParameterProcessingObserver work{};
+    group.SetProcessingObserverForTests(&work);
+
+    group.ProcessSample(1);
+    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 2);
+    REQUIRE_TRUE(work.localRecursiveComputeCalls == 0);
+
+    group.ProcessSample(16);
+    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 4);
+    REQUIRE_TRUE(work.localRecursiveComputeCalls == 2);
+}
+```
+
+Add a second test that gives the local depth a non-default scene center, calls the compute cadence, and asserts its cached/UI center equals `GetRaw(0)` and spread is zero. Extend Braid4's structural test to record the root count, materialize neutral local depths, run one internal subframe, and assert exactly that root count of `ProcessLite` visits.
+
+- [ ] **Step 2: Run the RED tests and capture the expected failure**
+
+Run:
+
+```bash
+make -C projects/synth build/parameter_modulation_tests build/braid4_system_tests
+projects/synth/build/parameter_modulation_tests
+projects/synth/build/braid4_system_tests
+```
+
+Expected: compilation fails because `ParameterProcessingObserver` and `SetProcessingObserverForTests` do not exist; after only adding the observer declarations, the structural test fails because the current group loop calls `ProcessSample` for every local index.
+
+- [ ] **Step 3: Add the observer and dense root-list contract**
+
+Add the observer next to `ParameterProcessingTiming`, and add these members to `ParameterGroup`:
+
+```cpp
+void SetProcessingObserverForTests(ParameterProcessingObserver* observer) { processingObserver_ = observer; }
+
+private:
+    void RegisterTopLevelParameter(Parameter& parameter);
+    std::vector<Parameter*> topLevelParameters_;
+    ParameterProcessingObserver* processingObserver_ = nullptr;
+```
+
+In `ParameterManager::RegisterParameter`, call `group.RegisterTopLevelParameter(created)` only after the new ID/name registration has succeeded. Do not call it from `EnsureModulationDepth` or `CreateLocalParameter`.
+
+- [ ] **Step 4: Replace the group hot loop and retain recursive compute**
+
+Implement the group loop as a root-only loop and count only actual root `ProcessLite` calls:
+
+```cpp
+void ParameterGroup::ProcessSample(std::uint64_t sampleIndex) {
+    for (Parameter* parameter : topLevelParameters_) {
+        parameter->ProcessSample(sampleIndex);
+        if (processingObserver_ != nullptr) {
+            ++processingObserver_->topLevelProcessLiteCalls;
+        }
+    }
+}
+```
+
+In `Parameter::ComputeAtDepth`, increment `localRecursiveComputeCalls` when `recursionDepth > 0`. Keep the existing recursion-before-parent-depth derivation order. For local nodes, keep `SeedCachedKnobAndUiDisplayState()` after copying targets to currents; this pins the intentional local display behavior: center is seeded from the recursive value and spread energy is reset to zero at each compute cadence.
+
+- [ ] **Step 5: Run focused and surrounding tests**
+
+Run the two commands from Step 2 plus:
+
+```bash
+make -C projects/synth build/module_tests build/engine_tests build/rig_tests
+projects/synth/build/module_tests
+projects/synth/build/engine_tests
+projects/synth/build/rig_tests
+```
+
+Expected: all five binaries exit 0; the new observer reports two root visits per sample regardless of the two materialized locals, while recursive local count changes only on cadence.
+
+- [ ] **Step 6: Commit and pass the global Claude gate**
+
+```bash
+git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/braid4_system_tests.cpp
+git commit -m "perf(synth): process only top-level parameters per sample"
+```
+
+Generate the review package from the task's starting commit through `HEAD`, run the global Sonnet gate, fix and re-review Critical/Important findings, and record both passing verdicts in `.superpowers/sdd/progress.md`.
+
+---
+
diff --git a/.superpowers/sdd/scale-modulation-processing/task-1-report.md b/.superpowers/sdd/scale-modulation-processing/task-1-report.md
new file mode 100644
index 00000000..977467d7
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-1-report.md
@@ -0,0 +1,83 @@
+# Task 1 Implementation Report
+
+## Revisions
+
+- Base SHA: `2a5a51f187fcc1bdc2995eb6172e7b6abb128b74`
+- Task commit SHA: `cc52c4c9384484a562d968d5a3d155ca977d7567`
+- Commit: `perf(synth): process only top-level parameters per sample`
+
+## Files Changed
+
+- `projects/synth/include/synth/ParameterModulation.hpp`
+  - Added `ParameterProcessingObserver` with the four plan-defined counters.
+  - Added the observer installation hook, private root registration method, dense root list, and observer pointer to `ParameterGroup`.
+- `projects/synth/src/ParameterModulation.cpp`
+  - Reserved root-list capacity with the group's initial parameter capacity.
+  - Registered manager-created parameters as top-level roots only after manager ID/name registration succeeded.
+  - Changed `ParameterGroup::ProcessSample` to visit only the dense root list and count those visits.
+  - Counted recursive local computes at `recursionDepth > 0`, while retaining the existing child-first target derivation and local cached/UI seeding.
+- `projects/synth/tests/parameter_modulation_tests.cpp`
+  - Added a two-root/child/grandchild structural work-count test.
+  - Added a recursive local display regression asserting center seeding from `GetRaw(0)` and zero spread at compute cadence.
+- `projects/synth/tests/braid4_system_tests.cpp`
+  - Added a Braid4 structural test that materializes a neutral local depth in each group and proves one parameter-processing step visits exactly the manager's 60 registered roots.
+
+## RED Evidence
+
+Tests were added before production changes. Command:
+
+```text
+make -C projects/synth build/parameter_modulation_tests build/braid4_system_tests
+```
+
+Result: exit code 2, as expected. Compilation failed because the wished-for API did not exist:
+
+```text
+error: no type named 'ParameterProcessingObserver' in namespace 'synth'
+error: no member named 'SetProcessingObserverForTests' in 'synth::ParameterGroup'
+```
+
+The failure was caused by the missing Task 1 observability/root-processing contract, not a test typo.
+
+## GREEN Evidence
+
+Focused build and execution:
+
+```text
+make -C projects/synth build/parameter_modulation_tests build/braid4_system_tests
+projects/synth/build/parameter_modulation_tests
+projects/synth/build/braid4_system_tests
+```
+
+Result: exit code 0. Both new parameter tests passed, the new Braid4 test passed, the complete parameter-modulation binary passed, and Braid4 reported `Braid 4 system tests passed`.
+
+Surrounding build and execution:
+
+```text
+make -C projects/synth build/module_tests build/engine_tests build/rig_tests
+projects/synth/build/module_tests
+projects/synth/build/engine_tests
+projects/synth/build/rig_tests
+```
+
+Result: exit code 0. All module, engine, and rig tests passed.
+
+Additional hygiene:
+
+```text
+git diff --check
+```
+
+Result: exit code 0 with no whitespace errors before commit.
+
+## Design Notes
+
+- The root list is populated only by `ParameterManager::RegisterParameter`; neither `CreateLocalParameter` nor `EnsureModulationDepth` registers a root.
+- `ParameterGroup::ProcessSample` no longer indexes high-water local storage, so its hot-loop cost is independent of materialized local depth nodes.
+- Recursive local computation remains rooted in a top-level parameter on compute-cadence samples. A local node still copies targets to currents and calls `SeedCachedKnobAndUiDisplayState`, preserving recursive audio derivation while intentionally resetting local display spread at that cadence.
+- Observer counters are passive diagnostics. A null observer leaves the production hot path with only the null checks associated with enabled counter sites.
+
+## Deviations
+
+- The plan describes the Braid4 assertion as running one internal subframe. `Braid4Core::ProcessInternalSubframe` is private, so the test invokes `ProcessSample(1)` once on each of Braid4's three parameter groups. This is exactly the parameter-processing portion of one internal subframe and avoids adding a new Braid4 test-only production hook or processing DSP that is unrelated to the assertion.
+- No OpenSpec task checkboxes or progress-ledger verdicts were updated; those remain controller-owned until Claude review approval, as required by the task brief.
diff --git a/.superpowers/sdd/scale-modulation-processing/task-1-review-package.md b/.superpowers/sdd/scale-modulation-processing/task-1-review-package.md
new file mode 100644
index 00000000..c9190958
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-1-review-package.md
@@ -0,0 +1,342 @@
+# Review package: 2a5a51f187fcc1bdc2995eb6172e7b6abb128b74..cc52c4c9384484a562d968d5a3d155ca977d7567
+
+## Commits
+cc52c4c9 perf(synth): process only top-level parameters per sample
+
+## Files changed
+ .../synth/include/synth/ParameterModulation.hpp    | 11 +++++
+ projects/synth/src/ParameterModulation.cpp         | 16 +++++++-
+ projects/synth/tests/braid4_system_tests.cpp       | 31 ++++++++++++++
+ .../synth/tests/parameter_modulation_tests.cpp     | 48 ++++++++++++++++++++++
+ 4 files changed, 104 insertions(+), 2 deletions(-)
+
+## Diff
+diff --git a/projects/synth/include/synth/ParameterModulation.hpp b/projects/synth/include/synth/ParameterModulation.hpp
+index b474352b..72054230 100644
+--- a/projects/synth/include/synth/ParameterModulation.hpp
++++ b/projects/synth/include/synth/ParameterModulation.hpp
+@@ -135,20 +135,27 @@ inline constexpr float kDefaultUiDisplaySpreadAlpha = 0.0013089969f;  // about 1
+ float ConvertOnePoleAlpha(float referenceAlpha, double referenceRate, double processingRate);
+ std::size_t ConvertSampleInterval(std::size_t referenceInterval, double referenceRate, double processingRate);
+
+ struct ParameterProcessingTiming {
+     float processLiteAlpha;
+     std::size_t targetComputeIntervalSamples;
+     float uiDisplayCenterAlpha;
+     float uiDisplaySpreadAlpha;
+ };
+
++struct ParameterProcessingObserver {
++    std::size_t topLevelProcessLiteCalls = 0;
++    std::size_t localRecursiveComputeCalls = 0;
++    std::size_t activeRouteVisits = 0;
++    std::size_t activeGestureVisits = 0;
++};
++
+ struct ParameterGroupConfig {
+     std::size_t numVoices = 0;
+     std::size_t numModulators = 0;
+     std::size_t numScenes = 0;
+     std::size_t maxParameters = 0;
+     float processLiteAlpha = kDefaultProcessLiteAlpha;
+     float targetCenterAlpha = kDefaultTargetCenterAlpha;
+     std::size_t targetComputeIntervalSamples = kDefaultTargetComputeIntervalSamples;
+     float uiDisplayCenterAlpha = kDefaultUiDisplayCenterAlpha;
+     float uiDisplaySpreadAlpha = kDefaultUiDisplaySpreadAlpha;
+@@ -294,38 +301,42 @@ public:
+                              ModulatorMetadata metadata);
+     void UpdateModValues();
+     void SelectGesture(std::size_t gestureIx);
+     void DeselectGesture(std::size_t gestureIx);
+     bool GestureSelected(std::size_t gestureIx) const;
+     void SetGestureValue(std::size_t gestureIx, float value);
+     float GestureValue(std::size_t gestureIx) const;
+     void ClearGestureActiveFlagsForActiveSceneSelection(const SceneState& scene, std::size_t gestureIx);
+     void ConfigureProcessingTiming(const ParameterProcessingTiming& timing);
+     void ProcessSample(std::uint64_t sampleIndex);
++    void SetProcessingObserverForTests(ParameterProcessingObserver* observer) { processingObserver_ = observer; }
+
+ private:
+     friend class Parameter;
+     friend class ParameterManager;
+     friend class Bank;
+
+     Parameter& CreateLocalParameter(ParameterConfig config, ParameterId id);
++    void RegisterTopLevelParameter(Parameter& parameter);
+     void RequestParameterStorageBatch(std::size_t minimumAdditionalParameters);
+     void RequestParameterStorageBatchIfLow();
+
+     // Groups own parameter objects and all same-shaped per-parameter arenas.
+     // Parameter instances hold spans into these arenas; callers must not move a
+     // group after handing out Parameter references.
+     ParameterGroupConfig config_;
+     ParameterManager* manager_ = nullptr;
+     std::size_t gestureCount_ = 0;
+     Modulators modulators_;
+     std::size_t parameterCount_ = 0;
++    std::vector<Parameter*> topLevelParameters_;
++    ParameterProcessingObserver* processingObserver_ = nullptr;
+     std::vector<std::unique_ptr<Parameter>> parameters_;
+     std::vector<std::unique_ptr<ParameterStorageBatch>> extraStorageBatches_;
+     bool storageRequestPending_ = false;
+     std::vector<float> currentCenterScaleArena_;
+     std::vector<float> targetCenterScaleArena_;
+     std::vector<float> currentNormalizationOffsetArena_;
+     std::vector<float> targetNormalizationOffsetArena_;
+     std::vector<float> currentMinValueArena_;
+     std::vector<float> targetMinValueArena_;
+     std::vector<float> currentMaxValueArena_;
+diff --git a/projects/synth/src/ParameterModulation.cpp b/projects/synth/src/ParameterModulation.cpp
+index 216cf708..926afb28 100644
+--- a/projects/synth/src/ParameterModulation.cpp
++++ b/projects/synth/src/ParameterModulation.cpp
+@@ -368,20 +368,21 @@ void Gestures::CheckIndex(std::size_t gestureIx) const {
+     }
+ }
+
+ ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount)
+     : config_(ValidateConfig(config)),
+       manager_(&manager),
+       gestureCount_(gestureCount),
+       modulators_(config.numVoices, config.numModulators),
+       parameterCount_(0) {
+     parameters_.reserve(config_.maxParameters);
++    topLevelParameters_.reserve(config_.maxParameters);
+     currentCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
+     targetCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
+     currentNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
+     targetNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
+     currentMinValueArena_.resize(config_.maxParameters * config_.numVoices);
+     targetMinValueArena_.resize(config_.maxParameters * config_.numVoices);
+     currentMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
+     targetMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
+     currentDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
+     targetDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
+@@ -443,20 +444,24 @@ Parameter& ParameterGroup::CreateLocalParameter(ParameterConfig config, Paramete
+         Parameter& result = *parameter;
+         batch->parameters.push_back(std::move(parameter));
+         ++parameterCount_;
+         RequestParameterStorageBatchIfLow();
+         return result;
+     }
+
+     throw std::length_error("parameter group capacity exhausted");
+ }
+
++void ParameterGroup::RegisterTopLevelParameter(Parameter& parameter) {
++    topLevelParameters_.push_back(&parameter);
++}
++
+ Parameter& ParameterGroup::ParameterByLocalIndex(std::size_t localIx) {
+     if (localIx < parameters_.size()) {
+         return *parameters_.at(localIx);
+     }
+     std::size_t remaining = localIx - parameters_.size();
+     for (const auto& batch : extraStorageBatches_) {
+         if (remaining < batch->parameters.size()) {
+             return *batch->parameters.at(remaining);
+         }
+         remaining -= batch->parameters.size();
+@@ -509,22 +514,25 @@ void ParameterGroup::UpdateModValues() {
+
+ void ParameterGroup::ConfigureProcessingTiming(const ParameterProcessingTiming& timing) {
+     ValidateProcessingTiming(timing);
+     config_.processLiteAlpha = timing.processLiteAlpha;
+     config_.targetComputeIntervalSamples = timing.targetComputeIntervalSamples;
+     config_.uiDisplayCenterAlpha = timing.uiDisplayCenterAlpha;
+     config_.uiDisplaySpreadAlpha = timing.uiDisplaySpreadAlpha;
+ }
+
+ void ParameterGroup::ProcessSample(std::uint64_t sampleIndex) {
+-    for (std::size_t localIx = 0; localIx < parameterCount_; ++localIx) {
+-        ParameterByLocalIndex(localIx).ProcessSample(sampleIndex);
++    for (Parameter* parameter : topLevelParameters_) {
++        parameter->ProcessSample(sampleIndex);
++        if (processingObserver_ != nullptr) {
++            ++processingObserver_->topLevelProcessLiteCalls;
++        }
+     }
+ }
+
+ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx)
+     : id_(id),
+       group_(group),
+       config_(std::move(config)),
+       slotIx_(slotIx),
+       currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
+       targetCenter_(currentCenter_),
+@@ -1396,20 +1404,23 @@ float Parameter::ComputeRawCenter(const SceneState& scene) const {
+     }
+
+     if (activeWeightSum == 0.0f) {
+         return base;
+     }
+     return weightedMixSum / activeWeightSum;
+ }
+
+ void Parameter::ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth, bool smoothTargetCenter) {
+     recursionDepth_ = recursionDepth;
++    if (recursionDepth > 0 && group_.processingObserver_ != nullptr) {
++        ++group_.processingObserver_->localRecursiveComputeCalls;
++    }
+     const float rawCenter = ClampToRange(ComputeRawCenter(scene), config_.range);
+     if (smoothTargetCenter && recursionDepth == 0) {
+         const float alpha = group_.Config().targetCenterAlpha;
+         targetCenter_ += alpha * (rawCenter - targetCenter_);
+         targetCenter_ = ClampToRange(targetCenter_, config_.range);
+     } else {
+         targetCenter_ = rawCenter;
+     }
+
+     for (Parameter* depthParameter : modulationDepths_) {
+@@ -2166,20 +2177,21 @@ ParameterId ParameterManager::RegisterParameter(ParameterGroup& group, Parameter
+     if (parameters_.size() >= static_cast<std::size_t>(kLocalParameterId)) {
+         throw std::overflow_error("parameter ID space exhausted");
+     }
+
+     const ParameterId id = static_cast<ParameterId>(parameters_.size());
+     const std::string name = config.name;
+     Parameter& created = group.CreateLocalParameter(std::move(config), id);
+     Parameter* result = &created;
+     parameters_.push_back(result);
+     parameterNames_.push_back(name);
++    group.RegisterTopLevelParameter(created);
+     return id;
+ }
+
+ Parameter& ParameterManager::CreateParameter(ParameterGroup& group, ParameterConfig config) {
+     return ParameterById(RegisterParameter(group, std::move(config)));
+ }
+
+ Parameter& ParameterManager::ParameterById(ParameterId id) {
+     return *parameters_.at(static_cast<std::size_t>(id));
+ }
+diff --git a/projects/synth/tests/braid4_system_tests.cpp b/projects/synth/tests/braid4_system_tests.cpp
+index 184b4e2a..3d62aa38 100644
+--- a/projects/synth/tests/braid4_system_tests.cpp
++++ b/projects/synth/tests/braid4_system_tests.cpp
+@@ -433,20 +433,51 @@ TEST_CASE(braid_and_matrix_banks_expose_required_encoder_cells) {
+     }
+
+     REQUIRE_TRUE(core.MatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(8).Id());
+     REQUIRE_TRUE(core.MatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(23).Id());
+     REQUIRE_TRUE(core.LfoModule().Parameters().pmIndex[0] == core.MonoGroup()->ParameterByLocalIndex(24).Id());
+     REQUIRE_TRUE(core.LfoModule().Parameters().frequency[3] == core.MonoGroup()->ParameterByLocalIndex(31).Id());
+     REQUIRE_TRUE(core.LfoMatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(32).Id());
+     REQUIRE_TRUE(core.LfoMatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(47).Id());
+ }
+
++TEST_CASE(braid4_parameter_processing_ignores_materialized_local_depths) {
++    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
++        64,
++        UseScratchRuntimeDataPaths("braid4_parameter_processing_ignores_materialized_local_depths"));
++    auto& core = rig.Engine().Application();
++    const std::array<synth::ParameterGroup*, 3> groups{
++        core.StereoGroup(),
++        core.QuadGroup(),
++        core.MonoGroup(),
++    };
++
++    std::size_t rootCount = 0;
++    std::array<synth::ParameterProcessingObserver, 3> work{};
++    for (std::size_t groupIx = 0; groupIx < groups.size(); ++groupIx) {
++        synth::ParameterGroup& group = *groups[groupIx];
++        rootCount += group.ParameterCount();
++        REQUIRE_TRUE(group.ParameterByLocalIndex(0).EnsureModulationDepth(0) != nullptr);
++        group.SetProcessingObserverForTests(&work[groupIx]);
++    }
++
++    REQUIRE_TRUE(rootCount == rig.Engine().Manager().ParameterCount());
++    for (synth::ParameterGroup* group : groups) {
++        group->ProcessSample(1);
++    }
++
++    const std::size_t visited = work[0].topLevelProcessLiteCalls +
++                                work[1].topLevelProcessLiteCalls +
++                                work[2].topLevelProcessLiteCalls;
++    REQUIRE_TRUE(visited == rootCount);
++}
++
+ TEST_CASE(braid_palette_roles_propagate_from_literal_configuration) {
+     synth::ParameterManager manager;
+     synth::MessageInBus uiBus(&manager);
+     synth::MidiInstrumentConfig instrument;
+     synth::RuntimeConfig config = synth_braid4::Braid4::Config();
+     synth::AppContext context;
+     context.parameterManager = &manager;
+     context.uiBus = &uiBus;
+     context.instrument = &instrument;
+     context.config = &config;
+diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
+index 9c7c98e9..597702eb 100644
+--- a/projects/synth/tests/parameter_modulation_tests.cpp
++++ b/projects/synth/tests/parameter_modulation_tests.cpp
+@@ -1696,20 +1696,68 @@ TEST_CASE(parameter_group_process_sample_covers_top_level_and_modulation_depth_t
+     depth->SceneCenter(0) = 0.75f;
+
+     group.ProcessSample(0);
+
+     REQUIRE_NEAR(carrier.TargetCenter(), 0.2f, 0.0001f);
+     REQUIRE_NEAR(sibling.TargetCenter(), 0.4f, 0.0001f);
+     REQUIRE_NEAR(depth->TargetCenter(), 0.75f, 0.0001f);
+     REQUIRE_NEAR(carrier.CurrentDepths(0)[0], 0.25f, 0.0001f);
+ }
+
++TEST_CASE(group_process_sample_visits_only_registered_roots) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({
++        .numVoices = 1,
++        .numModulators = 2,
++        .numScenes = 1,
++        .maxParameters = 8,
++        .targetComputeIntervalSamples = 16,
++    });
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});
++    (void)manager.CreateParameter(group, {.name = "Tone"});
++    auto& depth = carrier.EnsureModulationDepth(0, {.name = "Carrier M1", .defaultValue = 0.5f});
++    (void)depth.EnsureModulationDepth(1, {.name = "Carrier M1 M2", .defaultValue = 0.5f});
++    synth::ParameterProcessingObserver work{};
++    group.SetProcessingObserverForTests(&work);
++
++    group.ProcessSample(1);
++    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 2);
++    REQUIRE_TRUE(work.localRecursiveComputeCalls == 0);
++
++    group.ProcessSample(16);
++    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 4);
++    REQUIRE_TRUE(work.localRecursiveComputeCalls == 2);
++}
++
++TEST_CASE(recursive_local_compute_seeds_display_without_audio_rate_processing) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({
++        .numVoices = 1,
++        .numModulators = 1,
++        .numScenes = 1,
++        .maxParameters = 4,
++        .targetComputeIntervalSamples = 16,
++    });
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});
++    auto& depth = carrier.EnsureModulationDepth(0, {.name = "Carrier M1", .defaultValue = 0.5f});
++    depth.SceneCenter(0) = 0.75f;
++    synth::ParameterProcessingObserver work{};
++    group.SetProcessingObserverForTests(&work);
++
++    group.ProcessSample(16);
++
++    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 1);
++    REQUIRE_TRUE(work.localRecursiveComputeCalls == 1);
++    REQUIRE_NEAR(depth.UIDisplayCenter(0), depth.GetRaw(0), 0.000001f);
++    REQUIRE_NEAR(depth.UIDisplaySpread(0), 0.0f, 0.000001f);
++}
++
+ TEST_CASE(mapping_helpers_use_cached_process_lite_knob_value) {
+     synth::ParameterManager manager;
+     synth::ParameterGroupConfig config{
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 1,
+         .maxParameters = 4,
+         .processLiteAlpha = 1.0f,
+         .targetCenterAlpha = 1.0f,
+     };
diff --git a/.superpowers/sdd/scale-modulation-processing/task-2-brief.md b/.superpowers/sdd/scale-modulation-processing/task-2-brief.md
new file mode 100644
index 00000000..113c559b
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-2-brief.md
@@ -0,0 +1,105 @@
+### Task 2: 64-Bit Sparse Gesture Core and UI
+
+**OpenSpec coverage:** tasks 2.1-2.4; `spm-20`, `spm-25`, and all `spm-73` scenarios.
+
+**Files:**
+- Modify: `projects/synth/include/synth/ParameterModulation.hpp` — `Gestures`, gesture arenas, `Parameter::UIState`, mask-return types.
+- Modify: `projects/synth/src/ParameterModulation.cpp` — 0-64 validation, set-bit compute/edit iteration, snapshots.
+- Modify: `projects/synth/include/synth/EncoderDraw.hpp` — 64-bit draw snapshot and high-index badges.
+- Inspect: `projects/synth/src/MidiController.cpp` — confirm its existing 32-bit affecting mask selects banks, not gestures; change it only if a separate gesture-indexed selector is found.
+- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — boundaries, sparse visit counts, messages, persistence, randomized mask oracle.
+- Modify: `projects/synth/tests/portable_ui_tests.cpp` — bit-63 render and labels.
+- Modify: `projects/synth/tests/instrument_tests.cpp` — controller/UI mask boundary.
+
+**Interfaces:**
+- Produces: `using GestureMask = std::uint64_t;` in `synth` namespace.
+- Produces: `GestureMask Gestures::SelectedMask() const`, `GestureMask Parameter::GesturesAffectingMask() const`, and `GestureMask Bank::GesturesAffectingMask() const`.
+- Produces: one `GestureMask` active selector per parameter scene, replacing `gestureActiveArena_` bytes.
+- Consumes: Task 1's observer; increment `activeGestureVisits` only when a set bit is evaluated.
+
+- [ ] **Step 1: Write RED boundary, sparse-work, UI, and label tests**
+
+Cover counts 0, 1, 32, 33, 64, and rejected 65; indices 0, 31, 32, and 63; and preservation of the old topology after rejection. Add a sparse-work test with 64 configured gestures and no active bits:
+
+```cpp
+synth::ParameterProcessingObserver work{};
+group.SetProcessingObserverForTests(&work);
+parameter.Compute(manager.Scene());
+REQUIRE_TRUE(work.activeGestureVisits == 0);
+parameter.SetGestureActive(0, 63, true);
+manager.SetGestureValue(63, 0.75f);
+parameter.Compute(manager.Scene());
+REQUIRE_TRUE(work.activeGestureVisits == 1);
+REQUIRE_TRUE((parameter.GesturesAffectingMask() & (std::uint64_t{1} << 63)) != 0);
+```
+
+In portable UI tests, store `std::uint64_t{1} << 63`, build encoder draw commands, and assert a text command contains `"64"`. Also assert `BadgeText(false, 16) == "17"`, `BadgeText(false, 62) == "63"`, and `BadgeText(false, 63) == "64"`.
+
+- [ ] **Step 2: Run the RED suite**
+
+```bash
+make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/instrument_tests
+projects/synth/build/parameter_modulation_tests
+projects/synth/build/portable_ui_tests
+projects/synth/build/instrument_tests
+```
+
+Expected: compilation or assertions fail at the 32-bit mask fields, count 64, index 63, and collapsed badge label.
+
+- [ ] **Step 3: Introduce `GestureMask` and replace scan storage**
+
+Use one type everywhere the selector crosses parameter/UI/controller boundaries:
+
+```cpp
+using GestureMask = std::uint64_t;
+
+class Gestures {
+public:
+    GestureMask SelectedMask() const { return selectedMask_; }
+private:
+    GestureMask selectedMask_ = 0;
+};
+```
+
+Replace `std::vector<bool> selected_` with `selectedMask_`, replace the per-scene byte active arena with `std::vector<GestureMask> gestureActiveMaskArena_`, and bind each `Parameter` to `std::span<GestureMask> gestureActiveMasks_` of length `numScenes`. Change `Parameter::UIState::gesturesAffectingMask`, encoder draw snapshot masks, and all matching locals/returns to `std::uint64_t`. Leave `GestureManagerUIState::bankAffectingMask` as `std::uint32_t` because it selects banks, not gestures.
+
+- [ ] **Step 4: Add one checked set-bit iterator and migrate compute/edit paths**
+
+Define a local C++20 helper used by compute and edit distribution:
+
+```cpp
+template <class Fn>
+void ForEachGestureBit(GestureMask mask, Fn&& fn) {
+    while (mask != 0) {
+        const std::size_t ix = std::countr_zero(mask);
+        mask &= mask - 1;
+        fn(ix);
+    }
+}
+```
+
+Mask off bits above `GestureCount()` when forming scene unions. In `ComputeRawCenter`, iterate `gestureActiveMasks_[left] | gestureActiveMasks_[right]`; keep `EffectiveGestureWeight` and weighted-blend math unchanged. In arming use `Gestures::SelectedMask`; in edit distribution use the active scene union. Increment the observer once per evaluated set bit, not once per configured slot.
+
+- [ ] **Step 5: Validate count mutation and render high badges**
+
+In `SetGestureCount`, reject `count > 64` before constructing new gesture storage or touching groups. Update `EncoderGeometry::BadgeText` so the existing 0-15 branch remains intact and the final branch is:
+
+```cpp
+return std::to_string(index + 1);
+```
+
+Extend message-bus and patch round-trip fixtures to select, activate, serialize, reload, and publish gestures 32 and 63. Change the randomized UI oracle mask type and expected comparisons to `GestureMask`, exercising bit 63 deterministically.
+
+- [ ] **Step 6: Run tests, commit, and pass the global Claude gate**
+
+Run Step 2's commands; all three binaries must exit 0. Then:
+
+```bash
+git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/include/synth/EncoderDraw.hpp projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/portable_ui_tests.cpp projects/synth/tests/instrument_tests.cpp
+git commit -m "feat(synth): support sparse 64-bit gestures"
+```
+
+Run the global Sonnet gate and record both passing verdicts.
+
+---
+
diff --git a/.superpowers/sdd/scale-modulation-processing/task-2-report.md b/.superpowers/sdd/scale-modulation-processing/task-2-report.md
new file mode 100644
index 00000000..eca46f60
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-2-report.md
@@ -0,0 +1,66 @@
+# Task 2 Implementation Report
+
+## Scope
+
+Implemented Task 2 only: 64-bit sparse gesture selection/activation, 64-bit parameter and encoder masks, high-index gesture UI/controller/persistence behavior, and set-bit traversal for compute and editing. No OpenSpec checkboxes or progress files were edited.
+
+## RED evidence
+
+The tests were added before production changes and the prescribed binaries were built/run.
+
+- `manager_gesture_count_supports_zero_through_64_and_rejects_65_without_mutation` failed because `SetGestureCount(65)` returned true.
+- `gesture_masks_visit_only_active_bits_through_index_63` failed because `activeGestureVisits` remained zero.
+- `ui_state_reports_affecting_masks_through_gesture_index_63` failed because the UI field was still 32-bit.
+- `portable_ui_tests` aborted at `gesture 16 badge is one-based`; the bit-63 assignment also produced the expected 64-to-32-bit narrowing warning.
+- After adding the explicit manager UI aggregation boundary assertion, it failed at `bankAffectingCount[63] == 2` while the implementation still truncated the gesture selector/local iteration to 32 bits.
+- After adding direct `Gestures(65)` validation coverage, it failed because the public selector-owning type still accepted an unrepresentable topology.
+
+`instrument_tests` already preserved a `MessageIn::gestureIx` of 63 through JSON, confirming that its index field itself was not the truncation point.
+
+## GREEN implementation
+
+- Added `synth::GestureMask = std::uint64_t` and used it for manager selection, per-parameter/per-scene active masks, parameter snapshots, bank gesture unions, and encoder draw snapshots.
+- Replaced `Gestures::selected_` with `selectedMask_` and exposed `SelectedMask()`.
+- Replaced per-scene/per-gesture active byte arenas with one 64-bit active mask per parameter scene in both initial and extra storage batches.
+- Added a checked count-mask helper and one `std::countr_zero`/clear-low-bit iterator.
+- Migrated gesture compute, selected-gesture arming, and active edit distribution to set-bit iteration. `activeGestureVisits` increments exactly once for each active bit evaluated by compute.
+- Preserved selection-versus-activation and scene blend weighting semantics.
+- Rejected counts above 64 before manager topology mutation and rejected direct `Gestures` construction above 64.
+- Widened parameter/UI/bank/encoder gesture-affecting masks through bit 63.
+- Kept `GestureManagerUIState::bankAffectingMask` and MIDI controller reads at 32 bits because that mask selects banks, not gestures. Widened only the temporary gesture selector used to populate it and extended its gesture-index loop through 63.
+- Preserved gesture badges 0-15 and assigned one-based numeric labels 17-64 to indices 16-63.
+- Extended deterministic coverage for boundary indices, sparse visits, high-index arming/editing, scene-union UI masks, rendered badge 64, message input, parameter patch persistence, manager bank-affecting publication, and the randomized UI oracle mask type.
+
+## Files changed
+
+- `projects/synth/include/synth/ParameterModulation.hpp`
+- `projects/synth/src/ParameterModulation.cpp`
+- `projects/synth/include/synth/EncoderDraw.hpp`
+- `projects/synth/tests/parameter_modulation_tests.cpp`
+- `projects/synth/tests/portable_ui_tests.cpp`
+- `projects/synth/tests/instrument_tests.cpp`
+
+## GREEN verification
+
+Executed exactly:
+
+```text
+make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/instrument_tests
+projects/synth/build/parameter_modulation_tests
+projects/synth/build/portable_ui_tests
+projects/synth/build/instrument_tests
+```
+
+Final result: all builds and all three binaries exited 0 with no compiler warnings.
+
+Also ran `git diff --check`; it exited 0.
+
+## Claude review fix
+
+The first Claude code-quality review identified one Important encapsulation issue: `ParameterManager` granted all of `Parameter` friendship solely to read the selection mask. The fix added the narrow, const, O(1) `ParameterManager::SelectedGestureMask()` accessor, updated gesture arming to use it, and removed the broad friendship.
+
+Strict TDD evidence for the fix:
+
+- RED: the focused manager boundary assertion failed to compile with `no member named 'SelectedGestureMask' in 'synth::ParameterManager'`.
+- GREEN: after adding the accessor and removing friendship, the prescribed parameter modulation, portable UI, and instrument builds/binaries all exited 0 with no warnings.
+- `git diff --check` exited 0 after the review fix.
diff --git a/.superpowers/sdd/scale-modulation-processing/task-2-review-package.md b/.superpowers/sdd/scale-modulation-processing/task-2-review-package.md
new file mode 100644
index 00000000..ecb9785c
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-2-review-package.md
@@ -0,0 +1,1490 @@
+# Review package: 94b2b700..b7537817
+
+## Commits
+b7537817 refactor(synth): narrow gesture selection access
+3549f01b feat(synth): support sparse 64-bit gestures
+
+## Files changed
+ projects/synth/include/synth/EncoderDraw.hpp       |  20 ++-
+ .../synth/include/synth/ParameterModulation.hpp    |  17 ++-
+ projects/synth/src/ParameterModulation.cpp         | 152 +++++++++++--------
+ projects/synth/tests/instrument_tests.cpp          |  12 ++
+ .../synth/tests/parameter_modulation_tests.cpp     | 165 +++++++++++++++++----
+ projects/synth/tests/portable_ui_tests.cpp         |  14 ++
+ 6 files changed, 276 insertions(+), 104 deletions(-)
+
+## Diff
+diff --git a/projects/synth/include/synth/EncoderDraw.hpp b/projects/synth/include/synth/EncoderDraw.hpp
+index 67fa75f2..45c54471 100644
+--- a/projects/synth/include/synth/EncoderDraw.hpp
++++ b/projects/synth/include/synth/EncoderDraw.hpp
+@@ -210,21 +210,21 @@ inline void AppendArcWithSwitchGaps(std::vector<DrawCommand>& commands,
+         if (endAngle <= startAngle)
+         {
+             continue;
+         }
+
+         commands.push_back(DrawCommand::Arc(
+             ArcBoundsFor(centerX, centerY, radius), startAngle, endAngle, color, strokeWidth));
+     }
+ }
+
+-inline std::size_t CountMaskBits(std::uint32_t mask)
++inline std::size_t CountMaskBits(std::uint64_t mask)
+ {
+     std::size_t count = 0;
+     while (mask != 0)
+     {
+         count += mask & 1u;
+         mask >>= 1u;
+     }
+     return count;
+ }
+
+@@ -232,21 +232,25 @@ inline std::string BadgeText(bool modulator, std::size_t index)
+ {
+     if (modulator)
+     {
+         return "M" + std::to_string(index + 1);
+     }
+     if (index < 8)
+     {
+         return std::to_string(index + 1);
+     }
+     static constexpr const char* x_Symbols[] = {"U", "R", "D", "L", "UU", "RR", "DD", "LL"};
+-    return x_Symbols[std::min<std::size_t>(index - 8, 7)];
++    if (index < 16)
++    {
++        return x_Symbols[index - 8];
++    }
++    return std::to_string(index + 1);
+ }
+
+ inline void GetBadgePosition(float centerX,
+                              float centerY,
+                              float radius,
+                              std::size_t ix,
+                              std::size_t total,
+                              bool upper,
+                              float& badgeX,
+                              float& badgeY,
+@@ -282,21 +286,21 @@ struct EncoderVoiceDrawState
+     synth::Color indicatorColor = synth::Color::Grey;
+ };
+
+ struct EncoderDrawState
+ {
+     bool connected = false;
+     bool hasVisualizerUnderlay = false;
+     bool bipolar = false;
+     std::size_t switchValues = 0;
+     std::uint32_t modulatorsAffectingMask = 0;
+-    std::uint32_t gesturesAffectingMask = 0;
++    synth::GestureMask gesturesAffectingMask = 0;
+     synth::Color baseColor = synth::Color::Off;
+     std::string shortLabel;
+     std::size_t voiceCount = 0;
+     std::vector<EncoderVoiceDrawState> voices;
+     std::vector<synth::Color> modulatorColors;
+     std::vector<synth::Color> gestureColors;
+ };
+
+ inline EncoderDrawState EncoderDrawStateFromParameter(const synth::Parameter::UIState& state)
+ {
+@@ -679,32 +683,32 @@ inline std::vector<DrawCommand> BuildEncoderDrawCommands(const EncoderDrawState&
+             {body.x + inset, body.y + inset, body.width - inset * 2.0f, body.height - inset * 2.0f},
+             synth::ScaleAlpha(state.baseColor, state.hasVisualizerUnderlay ? 0.14f : 0.28f)));
+     }
+     commands.push_back(DrawCommand::StrokeEllipse(body, synth::ScaleAlpha(state.baseColor, 0.9f), 1.5f));
+     commands.push_back(DrawCommand::StrokeRoundedRect(
+         {bounds.x + 1.0f, bounds.y + 1.0f, bounds.width - 2.0f, bounds.height - 2.0f},
+         6.0f,
+         Color::Rgb(8, 9, 10),
+         1.0f));
+
+-    const auto drawBadges = [&](std::uint32_t mask, bool upper, bool modulator) {
++    const auto drawBadges = [&](std::uint64_t mask, bool upper, bool modulator) {
+         const std::vector<synth::Color>& colors = modulator ? state.modulatorColors : state.gestureColors;
+-        const std::uint32_t validMask = colors.size() >= 32
+-                                            ? std::numeric_limits<std::uint32_t>::max()
+-                                            : (colors.empty() ? 0u : (std::uint32_t{1} << colors.size()) - 1u);
++        const std::uint64_t validMask = colors.size() >= 64
++                                            ? std::numeric_limits<std::uint64_t>::max()
++                                            : (colors.empty() ? 0u : (std::uint64_t{1} << colors.size()) - 1u);
+         assert((mask & ~validMask) == 0u && "badge mask index exceeds published color count");
+         mask &= validMask;
+         const std::size_t total = EncoderGeometry::CountMaskBits(mask);
+         std::size_t badgeIndex = 0;
+         for (std::size_t bit = 0; bit < colors.size() && badgeIndex < total; ++bit)
+         {
+-            if ((mask & (1u << bit)) == 0)
++            if ((mask & (std::uint64_t{1} << bit)) == 0)
+             {
+                 continue;
+             }
+
+             float x = 0.0f;
+             float y = 0.0f;
+             float length = 0.0f;
+             EncoderGeometry::GetBadgePosition(
+                 centerX, centerY, baseRadius * 0.72f, badgeIndex, total, upper, x, y, length);
+             AppendBadge(commands, x, y, length, colors[bit], EncoderGeometry::BadgeText(modulator, bit));
+diff --git a/projects/synth/include/synth/ParameterModulation.hpp b/projects/synth/include/synth/ParameterModulation.hpp
+index 72054230..1a9a09c2 100644
+--- a/projects/synth/include/synth/ParameterModulation.hpp
++++ b/projects/synth/include/synth/ParameterModulation.hpp
+@@ -20,20 +20,21 @@
+
+ namespace synth::ui {
+ class Visualizer;
+ }
+
+ namespace synth {
+
+ using ParameterId = std::uint32_t;
+ using PhysicalEncoderId = std::uint32_t;
+ using PageOrdinal = std::uint32_t;
++using GestureMask = std::uint64_t;
+
+ struct AtomicColor {
+     AtomicColor() = default;
+     explicit AtomicColor(Color color) { Store(color); }
+     AtomicColor(const AtomicColor&) = delete;
+     AtomicColor& operator=(const AtomicColor&) = delete;
+
+     void Store(Color color, std::memory_order order = std::memory_order_relaxed) {
+         value.store(color.Packed(), order);
+     }
+@@ -186,21 +187,21 @@ struct ParameterStorageBatch {
+     std::vector<float> currentMaxValueArena;
+     std::vector<float> targetMaxValueArena;
+     std::vector<float> currentDepthArena;
+     std::vector<float> targetDepthArena;
+     std::vector<float> currentKnobValueArena;
+     std::vector<float> uiDisplayCenterArena;
+     std::vector<float> uiDisplaySpreadEnergyArena;
+     std::vector<Parameter*> modulationDepthArena;
+     std::vector<float> sceneCenterArena;
+     std::vector<float> gestureValueArena;
+-    std::vector<std::uint8_t> gestureActiveArena;
++    std::vector<GestureMask> gestureActiveMaskArena;
+ };
+
+ std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
+                                                                  std::size_t gestureCount,
+                                                                  std::size_t capacity);
+
+ struct ModulatorMetadata {
+     std::string name;
+     std::string shortName;
+     Color sourceColor;
+@@ -255,34 +256,35 @@ private:
+ };
+
+ class Gestures {
+ public:
+     explicit Gestures(std::size_t gestures = 0);
+
+     float& Value(std::size_t gestureIx);
+     float Value(std::size_t gestureIx) const;
+     void Select(std::size_t gestureIx, bool selected);
+     bool Selected(std::size_t gestureIx) const;
++    GestureMask SelectedMask() const { return selectedMask_; }
+     void ClearSelection();
+
+     std::size_t NumGestures() const { return values_.size(); }
+
+     GestureMetadata& Metadata(std::size_t gestureIx);
+     const GestureMetadata& Metadata(std::size_t gestureIx) const;
+     std::span<GestureMetadata> Metadata() { return metadata_; }
+     std::span<const GestureMetadata> Metadata() const { return metadata_; }
+
+ private:
+     void CheckIndex(std::size_t gestureIx) const;
+
+     std::vector<float> values_;
+-    std::vector<bool> selected_;
++    GestureMask selectedMask_ = 0;
+     std::vector<GestureMetadata> metadata_;
+ };
+
+ class ParameterGroup {
+ public:
+     ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount);
+     ~ParameterGroup();
+
+     const ParameterGroupConfig& Config() const { return config_; }
+     Modulators& GetModulators() { return modulators_; }
+@@ -342,21 +344,21 @@ private:
+     std::vector<float> currentMaxValueArena_;
+     std::vector<float> targetMaxValueArena_;
+     std::vector<float> currentDepthArena_;
+     std::vector<float> targetDepthArena_;
+     std::vector<float> currentKnobValueArena_;
+     std::vector<float> uiDisplayCenterArena_;
+     std::vector<float> uiDisplaySpreadEnergyArena_;
+     std::vector<Parameter*> modulationDepthArena_;
+     std::vector<float> sceneCenterArena_;
+     std::vector<float> gestureValueArena_;
+-    std::vector<std::uint8_t> gestureActiveArena_;
++    std::vector<GestureMask> gestureActiveMaskArena_;
+ };
+
+ class Parameter {
+ public:
+     Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx);
+     Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
+               ParameterStorageBatch& storageBatch, std::size_t slotIx);
+
+     struct UIState {
+         UIState() = default;
+@@ -369,21 +371,21 @@ public:
+
+         void Configure(std::size_t voiceCapacity, std::size_t modulatorColorCapacity = 0,
+                        std::size_t gestureColorCapacity = 0);
+         void SetDisconnected();
+
+         std::atomic<std::uint32_t> revision{0};
+         std::atomic<bool> connected{false};
+         std::atomic<bool> bipolar{false};
+         std::atomic<std::size_t> switchValues{0};
+         std::atomic<std::uint32_t> modulatorsAffectingMask{0};
+-        std::atomic<std::uint32_t> gesturesAffectingMask{0};
++        std::atomic<GestureMask> gesturesAffectingMask{0};
+         AtomicColor baseColor;
+         std::atomic<synth::ui::Visualizer*> visualizer{nullptr};
+         std::atomic<const char*> shortName{nullptr};
+         std::atomic<std::size_t> voiceCount{0};
+         std::size_t voiceCapacity = 0;
+         std::atomic<std::size_t> modulatorColorCount{0};
+         std::size_t modulatorColorCapacity = 0;
+         std::unique_ptr<AtomicColor[]> modulatorSourceColors;
+         std::atomic<std::size_t> gestureColorCount{0};
+         std::size_t gestureColorCapacity = 0;
+@@ -427,21 +429,21 @@ public:
+     Parameter& EnsureModulationDepth(std::size_t modIx, ParameterConfig config);
+     void ClearModulationDepths();
+     Parameter* ModulationDepthParameter(std::size_t modIx) const;
+
+     float& SceneCenter(std::size_t sceneIx);
+     float SceneCenter(std::size_t sceneIx) const;
+     float& GestureValue(std::size_t sceneIx, std::size_t gestureIx);
+     float GestureValue(std::size_t sceneIx, std::size_t gestureIx) const;
+     void SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active);
+     bool GestureActive(std::size_t sceneIx, std::size_t gestureIx) const;
+-    std::uint32_t GesturesAffectingMask() const;
++    GestureMask GesturesAffectingMask() const;
+
+     std::span<float> CurrentDepths(std::size_t voiceIx);
+     std::span<const float> CurrentDepths(std::size_t voiceIx) const;
+     std::span<float> TargetDepths(std::size_t voiceIx);
+     std::span<const float> TargetDepths(std::size_t voiceIx) const;
+
+     float CurrentCenter() const { return currentCenter_; }
+     float TargetCenter() const { return targetCenter_; }
+     float CurrentCenterScale(std::size_t voiceIx) const;
+     float TargetCenterScale(std::size_t voiceIx) const;
+@@ -487,21 +489,21 @@ private:
+     std::span<float> currentMaxValues_;
+     std::span<float> targetMaxValues_;
+     std::span<float> currentDepths_;
+     std::span<float> targetDepths_;
+     std::span<float> currentKnobValues_;
+     std::span<float> uiDisplayCenters_;
+     std::span<float> uiDisplaySpreadEnergies_;
+     std::span<Parameter*> modulationDepths_;
+     std::span<float> sceneCenters_;
+     std::span<float> gestureValues_;
+-    std::span<std::uint8_t> gestureActive_;
++    std::span<GestureMask> gestureActiveMasks_;
+ };
+
+ class Bank {
+ public:
+     explicit Bank(ParameterManager* manager = nullptr);
+
+     struct VisibleCell {
+         Parameter* parameter = nullptr;
+     };
+
+@@ -519,21 +521,21 @@ public:
+     void Deselect();
+     bool ShowingModulation() const;
+     void SetBankColor(Color color) { bankColor_ = color; }
+     Color BankColor() const { return bankColor_; }
+
+     std::size_t VisibleMappingCount() const;
+     Parameter* VisibleParameter(PhysicalEncoderId encoderId) const;
+     VisibleCell VisibleCellFor(PhysicalEncoderId encoderId) const;
+     Parameter* SelectedParameter() const { return selected_; }
+     Parameter* TargetParameter() const;
+-    std::uint32_t GesturesAffectingMask() const;
++    GestureMask GesturesAffectingMask() const;
+
+ private:
+     friend class BankSlot;
+
+     struct Cell {
+         PhysicalEncoderId encoderId = 0;
+         Parameter* parameter = nullptr;
+     };
+
+     void AssociateSlot(BankSlot& slot);
+@@ -751,20 +753,21 @@ public:
+     void SetRandomSource(ParameterRandomFloat valueSource, ParameterRandomFloat coinSource,
+                          ParameterRandomIndex indexSource);
+     float NextRandomValue();
+     float NextRandomCoin();
+     std::size_t NextRandomIndex(std::size_t exclusiveMax);
+
+     void SelectGesture(std::size_t gestureIx);
+     void DeselectGesture(std::size_t gestureIx);
+     void ToggleGestureSelected(std::size_t gestureIx);
+     bool GestureSelected(std::size_t gestureIx) const;
++    GestureMask SelectedGestureMask() const { return gestures_.SelectedMask(); }
+     void SetGestureValue(std::size_t gestureIx, float value);
+     float GestureValue(std::size_t gestureIx) const;
+     GestureMetadata& GestureMetadataAt(std::size_t gestureIx);
+     const GestureMetadata& GestureMetadataAt(std::size_t gestureIx) const;
+     void ClearGestureActiveFlagsForActiveSceneSelection(std::size_t gestureIx);
+
+     std::unique_ptr<UIState> CreateUIState() const;
+     void PopulateUIState(UIState& state) const;
+     void SetParameterMessageOutBus(ParameterMessageOutBus* bus) { parameterMessageOutBus_ = bus; }
+     bool RequestParameterStorageBatch(ParameterGroup& group, std::size_t minimumAdditionalParameters);
+diff --git a/projects/synth/src/ParameterModulation.cpp b/projects/synth/src/ParameterModulation.cpp
+index 926afb28..3322b5fc 100644
+--- a/projects/synth/src/ParameterModulation.cpp
++++ b/projects/synth/src/ParameterModulation.cpp
+@@ -1,27 +1,44 @@
+ #include "synth/ParameterModulation.hpp"
+
+ #include <algorithm>
+ #include <array>
++#include <bit>
+ #include <charconv>
+ #include <cmath>
+ #include <limits>
+ #include <stdexcept>
+ #include <utility>
+
+ namespace synth {
+
+ namespace {
+
+ // Local modulation-depth controls are intentionally not addressable through ParameterManager::ParameterById.
+ constexpr ParameterId kLocalParameterId = std::numeric_limits<ParameterId>::max();
+
++GestureMask GestureCountMask(std::size_t count) {
++    if (count >= std::numeric_limits<GestureMask>::digits) {
++        return std::numeric_limits<GestureMask>::max();
++    }
++    return count == 0 ? GestureMask{0} : (GestureMask{1} << count) - GestureMask{1};
++}
++
++template <class Fn>
++void ForEachGestureBit(GestureMask mask, Fn&& fn) {
++    while (mask != 0) {
++        const std::size_t gestureIx = std::countr_zero(mask);
++        mask &= mask - 1;
++        fn(gestureIx);
++    }
++}
++
+ void ValidateProcessingRates(double referenceRate, double processingRate) {
+     if (!(std::isfinite(referenceRate) && referenceRate > 0.0 && std::isfinite(processingRate) &&
+           processingRate > 0.0)) {
+         throw std::invalid_argument("processing timing rates must be positive and finite");
+     }
+ }
+
+ void ValidateOnePoleAlpha(float alpha) {
+     if (!(alpha >= 0.0f && alpha <= 1.0f)) {
+         throw std::invalid_argument("one-pole alpha must be in [0,1]");
+@@ -216,21 +233,21 @@ ParameterStorageBatch::ParameterStorageBatch(const ParameterGroupConfig& config,
+       currentMaxValueArena(capacity * config.numVoices),
+       targetMaxValueArena(capacity * config.numVoices),
+       currentDepthArena(capacity * config.numVoices * config.numModulators),
+       targetDepthArena(capacity * config.numVoices * config.numModulators),
+       currentKnobValueArena(capacity * config.numVoices),
+       uiDisplayCenterArena(capacity * config.numVoices),
+       uiDisplaySpreadEnergyArena(capacity * config.numVoices),
+       modulationDepthArena(capacity * config.numModulators, nullptr),
+       sceneCenterArena(capacity * config.numScenes),
+       gestureValueArena(capacity * config.numScenes * gestureCount),
+-      gestureActiveArena(capacity * config.numScenes * gestureCount, 0) {
++      gestureActiveMaskArena(capacity * config.numScenes, 0) {
+     parameters.reserve(capacity);
+ }
+
+ bool ParameterStorageBatch::Compatible(const ParameterGroupConfig& config, std::size_t liveGestureCount) const {
+     return numVoices == config.numVoices && numModulators == config.numModulators &&
+            numScenes == config.numScenes && gestureCount == liveGestureCount && capacity > 0;
+ }
+
+ std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
+                                                                  std::size_t gestureCount,
+@@ -318,45 +335,53 @@ std::size_t Modulators::Index(std::size_t voiceIx, std::size_t modIx) const {
+         throw std::out_of_range("modulator voice index out of range");
+     }
+     if (modIx >= numModulators_) {
+         throw std::out_of_range("modulator index out of range");
+     }
+     return voiceIx * numModulators_ + modIx;
+ }
+
+ Gestures::Gestures(std::size_t gestures)
+     : values_(gestures, 0.0f),
+-      selected_(gestures, false),
+-      metadata_(gestures) {}
++      metadata_(gestures) {
++    if (gestures > std::numeric_limits<GestureMask>::digits) {
++        throw std::invalid_argument("gesture count exceeds 64-bit selector capacity");
++    }
++}
+
+ float& Gestures::Value(std::size_t gestureIx) {
+     CheckIndex(gestureIx);
+     return values_[gestureIx];
+ }
+
+ float Gestures::Value(std::size_t gestureIx) const {
+     CheckIndex(gestureIx);
+     return values_[gestureIx];
+ }
+
+ void Gestures::Select(std::size_t gestureIx, bool selected) {
+     CheckIndex(gestureIx);
+-    selected_[gestureIx] = selected;
++    const GestureMask bit = GestureMask{1} << gestureIx;
++    if (selected) {
++        selectedMask_ |= bit;
++    } else {
++        selectedMask_ &= ~bit;
++    }
+ }
+
+ bool Gestures::Selected(std::size_t gestureIx) const {
+     CheckIndex(gestureIx);
+-    return selected_[gestureIx];
++    return (selectedMask_ & (GestureMask{1} << gestureIx)) != 0;
+ }
+
+ void Gestures::ClearSelection() {
+-    std::fill(selected_.begin(), selected_.end(), false);
++    selectedMask_ = 0;
+ }
+
+ GestureMetadata& Gestures::Metadata(std::size_t gestureIx) {
+     CheckIndex(gestureIx);
+     return metadata_[gestureIx];
+ }
+
+ const GestureMetadata& Gestures::Metadata(std::size_t gestureIx) const {
+     CheckIndex(gestureIx);
+     return metadata_[gestureIx];
+@@ -385,21 +410,21 @@ ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& ma
+     currentMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
+     targetMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
+     currentDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
+     targetDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
+     currentKnobValueArena_.resize(config_.maxParameters * config_.numVoices);
+     uiDisplayCenterArena_.resize(config_.maxParameters * config_.numVoices);
+     uiDisplaySpreadEnergyArena_.resize(config_.maxParameters * config_.numVoices);
+     modulationDepthArena_.resize(config_.maxParameters * config_.numModulators, nullptr);
+     sceneCenterArena_.resize(config_.maxParameters * config_.numScenes);
+     gestureValueArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_);
+-    gestureActiveArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_, 0);
++    gestureActiveMaskArena_.resize(config_.maxParameters * config_.numScenes, 0);
+ }
+
+ ParameterGroup::~ParameterGroup() = default;
+
+ bool ParameterGroup::CanAllocate() const {
+     return AvailableParameterSlots() > 0;
+ }
+
+ std::size_t ParameterGroup::AvailableParameterSlots() const {
+     const std::size_t initialAllocated = std::min(parameterCount_, config_.maxParameters);
+@@ -571,37 +596,37 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
+       uiDisplaySpreadEnergies_(ArenaSlice(group_.uiDisplaySpreadEnergyArena_,
+                                           slotIx_ * group_.Config().numVoices,
+                                           group_.Config().numVoices)),
+       modulationDepths_(ArenaSlice(group_.modulationDepthArena_, slotIx_ * group_.Config().numModulators,
+                                    group_.Config().numModulators)),
+       sceneCenters_(ArenaSlice(group_.sceneCenterArena_, slotIx_ * group_.Config().numScenes,
+                                group_.Config().numScenes)),
+       gestureValues_(ArenaSlice(group_.gestureValueArena_,
+                                 slotIx_ * group_.Config().numScenes * group_.GestureCount(),
+                                 group_.Config().numScenes * group_.GestureCount())),
+-      gestureActive_(ArenaSlice(group_.gestureActiveArena_,
+-                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
+-                                group_.Config().numScenes * group_.GestureCount())) {
++      gestureActiveMasks_(ArenaSlice(group_.gestureActiveMaskArena_,
++                                     slotIx_ * group_.Config().numScenes,
++                                     group_.Config().numScenes)) {
+     std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
+     std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
+     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
+     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
+     std::fill(currentMinValues_.begin(), currentMinValues_.end(), currentCenter_);
+     std::fill(targetMinValues_.begin(), targetMinValues_.end(), currentCenter_);
+     std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), currentCenter_);
+     std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), currentCenter_);
+     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
+     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
+     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
+     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
+-    std::fill(gestureActive_.begin(), gestureActive_.end(), 0);
++    std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
+     SeedCachedKnobAndUiDisplayState();
+ }
+
+ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
+                      ParameterStorageBatch& storageBatch, std::size_t slotIx)
+     : id_(id),
+       group_(group),
+       config_(std::move(config)),
+       slotIx_(slotIx),
+       currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
+@@ -641,37 +666,37 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
+       uiDisplaySpreadEnergies_(ArenaSlice(storageBatch.uiDisplaySpreadEnergyArena,
+                                           slotIx_ * group_.Config().numVoices,
+                                           group_.Config().numVoices)),
+       modulationDepths_(ArenaSlice(storageBatch.modulationDepthArena, slotIx_ * group_.Config().numModulators,
+                                    group_.Config().numModulators)),
+       sceneCenters_(ArenaSlice(storageBatch.sceneCenterArena, slotIx_ * group_.Config().numScenes,
+                                group_.Config().numScenes)),
+       gestureValues_(ArenaSlice(storageBatch.gestureValueArena,
+                                 slotIx_ * group_.Config().numScenes * group_.GestureCount(),
+                                 group_.Config().numScenes * group_.GestureCount())),
+-      gestureActive_(ArenaSlice(storageBatch.gestureActiveArena,
+-                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
+-                                group_.Config().numScenes * group_.GestureCount())) {
++      gestureActiveMasks_(ArenaSlice(storageBatch.gestureActiveMaskArena,
++                                     slotIx_ * group_.Config().numScenes,
++                                     group_.Config().numScenes)) {
+     std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
+     std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
+     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
+     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
+     std::fill(currentMinValues_.begin(), currentMinValues_.end(), currentCenter_);
+     std::fill(targetMinValues_.begin(), targetMinValues_.end(), currentCenter_);
+     std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), currentCenter_);
+     std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), currentCenter_);
+     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
+     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
+     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
+     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
+-    std::fill(gestureActive_.begin(), gestureActive_.end(), 0);
++    std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
+     SeedCachedKnobAndUiDisplayState();
+ }
+
+ ParameterStorageBatch::~ParameterStorageBatch() = default;
+
+ void Parameter::UIState::Configure(std::size_t newVoiceCapacity, std::size_t newModulatorColorCapacity,
+                                    std::size_t newGestureColorCapacity) {
+     voiceCapacity = newVoiceCapacity;
+     modulatorColorCapacity = newModulatorColorCapacity;
+     gestureColorCapacity = newGestureColorCapacity;
+@@ -992,70 +1017,70 @@ void Parameter::HandleIncDec(const SceneState& scene, float delta) {
+     auto armSelectedGesture = [&](std::size_t sceneIx, std::size_t gestureIx) {
+         if (GestureActive(sceneIx, gestureIx)) {
+             return false;
+         }
+         GestureValue(sceneIx, gestureIx) = SceneCenter(sceneIx);
+         SetGestureActive(sceneIx, gestureIx, true);
+         return true;
+     };
+
+     bool armedGesture = false;
+-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
+-        if (!group_.Manager().GestureSelected(gestureIx)) {
+-            continue;
+-        }
+-
++    ForEachGestureBit(group_.Manager().SelectedGestureMask() & GestureCountMask(group_.GestureCount()),
++                      [&](std::size_t gestureIx) {
+         if (blend <= 0.0f) {
+             armedGesture = armSelectedGesture(scene.leftScene, gestureIx) || armedGesture;
+         } else if (blend >= 1.0f) {
+             armedGesture = armSelectedGesture(scene.rightScene, gestureIx) || armedGesture;
+         } else {
+             armedGesture = armSelectedGesture(scene.leftScene, gestureIx) || armedGesture;
+             if (scene.rightScene != scene.leftScene) {
+                 armedGesture = armSelectedGesture(scene.rightScene, gestureIx) || armedGesture;
+             }
+         }
+-    }
++    });
+
+     if (armedGesture) {
+         return;
+     }
+
+     float activeEffectiveWeightSum = 0.0f;
+     float baseShareNumerator = 0.0f;
+-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
++    const GestureMask activeGestures =
++        (gestureActiveMasks_[scene.leftScene] | gestureActiveMasks_[scene.rightScene]) &
++        GestureCountMask(group_.GestureCount());
++    ForEachGestureBit(activeGestures, [&](std::size_t gestureIx) {
+         const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
+         if (effectiveWeight == 0.0f) {
+-            continue;
++            return;
+         }
+         activeEffectiveWeightSum += effectiveWeight;
+         baseShareNumerator += effectiveWeight * (1.0f - effectiveWeight);
+-    }
++    });
+
+     if (activeEffectiveWeightSum == 0.0f) {
+         ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend, delta, config_.range);
+         return;
+     }
+
+     ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend,
+                            delta * (baseShareNumerator / activeEffectiveWeightSum), config_.range);
+
+-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
++    ForEachGestureBit(activeGestures, [&](std::size_t gestureIx) {
+         const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
+         if (effectiveWeight == 0.0f) {
+-            continue;
++            return;
+         }
+
+         const float gestureDelta = delta * ((effectiveWeight * effectiveWeight) / activeEffectiveWeightSum);
+         ApplySceneDistribution(GestureValue(scene.leftScene, gestureIx), GestureValue(scene.rightScene, gestureIx),
+                                blend, gestureDelta, config_.range);
+-    }
++    });
+ }
+
+ void Parameter::RandomizeVisibleValue(const SceneState& scene, float normalized) {
+     ValidateSceneEndpoints(scene);
+     const float target = LinearMap(RangeMin(config_.range), RangeMax(config_.range),
+                                    std::clamp(normalized, 0.0f, 1.0f));
+     Compute(scene);
+     SnapCurrentToTarget();
+     const float delta = target - TargetValue(0);
+     HandleIncDec(scene, delta);
+@@ -1219,25 +1244,32 @@ float Parameter::SceneCenter(std::size_t sceneIx) const {
+
+ float& Parameter::GestureValue(std::size_t sceneIx, std::size_t gestureIx) {
+     return gestureValues_[SceneGestureIndex(sceneIx, gestureIx)];
+ }
+
+ float Parameter::GestureValue(std::size_t sceneIx, std::size_t gestureIx) const {
+     return gestureValues_[SceneGestureIndex(sceneIx, gestureIx)];
+ }
+
+ void Parameter::SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active) {
+-    gestureActive_[SceneGestureIndex(sceneIx, gestureIx)] = active ? 1 : 0;
++    (void)SceneGestureIndex(sceneIx, gestureIx);
++    const GestureMask bit = GestureMask{1} << gestureIx;
++    if (active) {
++        gestureActiveMasks_[sceneIx] |= bit;
++    } else {
++        gestureActiveMasks_[sceneIx] &= ~bit;
++    }
+ }
+
+ bool Parameter::GestureActive(std::size_t sceneIx, std::size_t gestureIx) const {
+-    return gestureActive_[SceneGestureIndex(sceneIx, gestureIx)] != 0;
++    (void)SceneGestureIndex(sceneIx, gestureIx);
++    return (gestureActiveMasks_[sceneIx] & (GestureMask{1} << gestureIx)) != 0;
+ }
+
+ std::span<float> Parameter::CurrentDepths(std::size_t voiceIx) {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     if (group_.Config().numModulators == 0) {
+         return {};
+     }
+     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
+@@ -1334,23 +1366,21 @@ void Parameter::ValidateSceneEndpoints(const SceneState& scene) const {
+ float Parameter::EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const {
+     const float clampedBlend = std::clamp(blend, 0.0f, 1.0f);
+     const float groupWeight = group_.Manager().GestureValue(gestureIx);
+     const float leftWeight = GestureActive(scene.leftScene, gestureIx) ? groupWeight * (1.0f - clampedBlend) : 0.0f;
+     const float rightWeight = GestureActive(scene.rightScene, gestureIx) ? groupWeight * clampedBlend : 0.0f;
+     return leftWeight + rightWeight;
+ }
+
+ void Parameter::ResetSceneToDefault(std::size_t sceneIx, float defaultValue) {
+     SceneCenter(sceneIx) = defaultValue;
+-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
+-        SetGestureActive(sceneIx, gestureIx, false);
+-    }
++    gestureActiveMasks_[sceneIx] = 0;
+ }
+
+ void Parameter::ResetModulationDepthToNeutral(const SceneState& scene) {
+     ValidateSceneEndpoints(scene);
+     for (Parameter* depthParameter : modulationDepths_) {
+         if (depthParameter != nullptr) {
+             depthParameter->ResetModulationDepthToNeutral(scene);
+         }
+     }
+
+@@ -1383,32 +1413,38 @@ void Parameter::ResetModulationDepthToNeutral(const SceneState& scene) {
+ }
+
+ float Parameter::ComputeRawCenter(const SceneState& scene) const {
+     ValidateSceneEndpoints(scene);
+     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
+     const float inverseBlend = 1.0f - blend;
+     const float base = SceneCenter(scene.leftScene) * inverseBlend + SceneCenter(scene.rightScene) * blend;
+
+     float weightedMixSum = 0.0f;
+     float activeWeightSum = 0.0f;
+-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
++    const GestureMask activeGestures =
++        (gestureActiveMasks_[scene.leftScene] | gestureActiveMasks_[scene.rightScene]) &
++        GestureCountMask(group_.GestureCount());
++    ForEachGestureBit(activeGestures, [&](std::size_t gestureIx) {
++        if (group_.processingObserver_ != nullptr) {
++            ++group_.processingObserver_->activeGestureVisits;
++        }
+         const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
+         if (effectiveWeight == 0.0f) {
+-            continue;
++            return;
+         }
+
+         const float gestureValue = GestureValue(scene.leftScene, gestureIx) * inverseBlend +
+                                    GestureValue(scene.rightScene, gestureIx) * blend;
+         const float mix = base * (1.0f - effectiveWeight) + gestureValue * effectiveWeight;
+         weightedMixSum += effectiveWeight * mix;
+         activeWeightSum += effectiveWeight;
+-    }
++    });
+
+     if (activeWeightSum == 0.0f) {
+         return base;
+     }
+     return weightedMixSum / activeWeightSum;
+ }
+
+ void Parameter::ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth, bool smoothTargetCenter) {
+     recursionDepth_ = recursionDepth;
+     if (recursionDepth > 0 && group_.processingObserver_ != nullptr) {
+@@ -1545,22 +1581,22 @@ bool Parameter::HasNonZeroState() const {
+
+     if (std::fabs(currentCenter_ - neutralDepthCenter) > tolerance ||
+         std::fabs(targetCenter_ - neutralDepthCenter) > tolerance) {
+         return true;
+     }
+     for (const float center : sceneCenters_) {
+         if (std::fabs(center - neutralDepthCenter) > tolerance) {
+             return true;
+         }
+     }
+-    for (const std::uint8_t active : gestureActive_) {
+-        if (active != 0) {
++    for (const GestureMask activeMask : gestureActiveMasks_) {
++        if (activeMask != 0) {
+             return true;
+         }
+     }
+     for (const float depth : currentDepths_) {
+         if (std::fabs(depth) > tolerance) {
+             return true;
+         }
+     }
+     for (const float depth : targetDepths_) {
+         if (std::fabs(depth) > tolerance) {
+@@ -1596,22 +1632,22 @@ bool Parameter::HasNonDefaultState() const {
+     for (const float center : sceneCenters_) {
+         if (std::fabs(center - defaultValue) > tolerance) {
+             return true;
+         }
+     }
+     for (const float value : gestureValues_) {
+         if (std::fabs(value - defaultValue) > tolerance) {
+             return true;
+         }
+     }
+-    for (const std::uint8_t active : gestureActive_) {
+-        if (active != 0) {
++    for (const GestureMask activeMask : gestureActiveMasks_) {
++        if (activeMask != 0) {
+             return true;
+         }
+     }
+     for (const float depth : currentDepths_) {
+         if (std::fabs(depth) > tolerance) {
+             return true;
+         }
+     }
+     for (const float depth : targetDepths_) {
+         if (std::fabs(depth) > tolerance) {
+@@ -1639,42 +1675,34 @@ bool Parameter::HasNonDefaultState() const {
+         }
+     }
+     for (const Parameter* depthParameter : modulationDepths_) {
+         if (depthParameter != nullptr && depthParameter->HasNonDefaultState()) {
+             return true;
+         }
+     }
+     return false;
+ }
+
+-std::uint32_t Parameter::GesturesAffectingMask() const {
+-    std::uint32_t mask = 0;
++GestureMask Parameter::GesturesAffectingMask() const {
+     const SceneState& scene = group_.Manager().Scene();
+     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
+-    const std::size_t count = std::min<std::size_t>(group_.GestureCount(), 32);
+     const bool leftSceneValid = scene.leftScene < group_.Config().numScenes;
+     const bool rightSceneValid = scene.rightScene < group_.Config().numScenes;
+-    for (std::size_t gestureIx = 0; gestureIx < count; ++gestureIx) {
+-        bool active = false;
+-        if (blend <= 0.0f) {
+-            active = leftSceneValid && GestureActive(scene.leftScene, gestureIx);
+-        } else if (blend >= 1.0f) {
+-            active = rightSceneValid && GestureActive(scene.rightScene, gestureIx);
+-        } else {
+-            active = (leftSceneValid && GestureActive(scene.leftScene, gestureIx)) ||
+-                     (rightSceneValid && GestureActive(scene.rightScene, gestureIx));
+-        }
+-        if (active) {
+-            mask |= (std::uint32_t{1} << gestureIx);
+-        }
++    if (blend <= 0.0f) {
++        return leftSceneValid ? gestureActiveMasks_[scene.leftScene] & GestureCountMask(group_.GestureCount()) : 0;
+     }
+-    return mask;
++    if (blend >= 1.0f) {
++        return rightSceneValid ? gestureActiveMasks_[scene.rightScene] & GestureCountMask(group_.GestureCount()) : 0;
++    }
++    const GestureMask leftMask = leftSceneValid ? gestureActiveMasks_[scene.leftScene] : 0;
++    const GestureMask rightMask = rightSceneValid ? gestureActiveMasks_[scene.rightScene] : 0;
++    return (leftMask | rightMask) & GestureCountMask(group_.GestureCount());
+ }
+
+ void ParameterGroup::SelectGesture(std::size_t gestureIx) {
+     manager_->SelectGesture(gestureIx);
+ }
+
+ void ParameterGroup::DeselectGesture(std::size_t gestureIx) {
+     manager_->DeselectGesture(gestureIx);
+ }
+
+@@ -1881,22 +1909,22 @@ Bank::VisibleCell Bank::VisibleCellFor(PhysicalEncoderId encoderId) const {
+     }
+     return {
+         .parameter = cell->parameter,
+     };
+ }
+
+ Parameter* Bank::TargetParameter() const {
+     return ShowingModulation() ? selected_ : nullptr;
+ }
+
+-std::uint32_t Bank::GesturesAffectingMask() const {
+-    std::uint32_t mask = 0;
++GestureMask Bank::GesturesAffectingMask() const {
++    GestureMask mask = 0;
+     for (const Cell& cell : topLevel_) {
+         if (cell.parameter != nullptr) {
+             mask |= cell.parameter->GesturesAffectingMask();
+         }
+     }
+     return mask;
+ }
+
+ void BankSlot::UIState::Configure(std::size_t newCellCapacity, std::size_t voiceCapacity,
+                                   std::size_t modulatorColorCapacity, std::size_t gestureColorCapacity) {
+@@ -2139,21 +2167,21 @@ bool ParameterMessageOutBus::Pop(ParameterMessageOut& message) {
+         return false;
+     }
+     const std::size_t head = head_.load(std::memory_order_relaxed);
+     message = queue_[head];
+     head_.store((head + 1) % queue_.size(), std::memory_order_release);
+     size_.fetch_sub(1, std::memory_order_release);
+     return true;
+ }
+
+ bool ParameterManager::SetGestureCount(std::size_t count) {
+-    if (!groups_.empty()) {
++    if (count > std::numeric_limits<GestureMask>::digits || !groups_.empty()) {
+         return false;
+     }
+     gestures_ = Gestures(count);
+     return true;
+ }
+
+ ParameterGroup& ParameterManager::CreateGroup(ParameterGroupConfig config) {
+     auto group = std::make_unique<ParameterGroup>(std::move(config), *this, gestures_.NumGestures());
+     ParameterGroup& result = *group;
+     groups_.push_back(std::move(group));
+@@ -2782,25 +2810,25 @@ void ParameterManager::PopulateUIState(UIState& state) const {
+             state.gestures.selected[gestureIx].store(false, std::memory_order_relaxed);
+             state.gestures.colors[gestureIx].Store(Color::Off);
+             continue;
+         }
+         state.gestures.values[gestureIx].store(gestures_.Value(gestureIx), std::memory_order_relaxed);
+         state.gestures.selected[gestureIx].store(gestures_.Selected(gestureIx), std::memory_order_relaxed);
+         state.gestures.colors[gestureIx].Store(gestures_.Metadata(gestureIx).gestureColor);
+     }
+     const std::size_t compactBankCount = std::min<std::size_t>({state.bankCapacity, banks_.size(), 32});
+     for (std::size_t bankIx = 0; bankIx < compactBankCount; ++bankIx) {
+-        const std::uint32_t affecting = banks_[bankIx]->GesturesAffectingMask();
++        const GestureMask affecting = banks_[bankIx]->GesturesAffectingMask();
+         for (std::size_t gestureIx = 0;
+-             gestureIx < std::min<std::size_t>(state.gestures.gestureCapacity, 32);
++             gestureIx < std::min<std::size_t>(state.gestures.gestureCapacity, 64);
+              ++gestureIx) {
+-            if ((affecting & (std::uint32_t{1} << gestureIx)) == 0) {
++            if ((affecting & (GestureMask{1} << gestureIx)) == 0) {
+                 continue;
+             }
+             std::uint32_t mask = state.gestures.bankAffectingMask[gestureIx].load(std::memory_order_relaxed);
+             mask |= (std::uint32_t{1} << bankIx);
+             state.gestures.bankAffectingMask[gestureIx].store(mask, std::memory_order_relaxed);
+             state.gestures.bankAffectingCount[gestureIx].fetch_add(1, std::memory_order_relaxed);
+         }
+     }
+ }
+
+diff --git a/projects/synth/tests/instrument_tests.cpp b/projects/synth/tests/instrument_tests.cpp
+index 3dbb6b3b..b9525422 100644
+--- a/projects/synth/tests/instrument_tests.cpp
++++ b/projects/synth/tests/instrument_tests.cpp
+@@ -110,20 +110,32 @@ TEST_CASE(KindNameRoundTrip) {
+     REQUIRE_TRUE(synth::MidiProfileKindFromName("wrldbldr", kind));
+     REQUIRE_TRUE(kind == MidiProfileKind::WrldBldr);
+     REQUIRE_TRUE(synth::MidiProfileKindFromName("twister", kind));
+     REQUIRE_TRUE(kind == MidiProfileKind::MfTwister);
+     REQUIRE_TRUE(synth::MidiProfileKindFromName("launchpad", kind));
+     REQUIRE_TRUE(kind == MidiProfileKind::Launchpad);
+     REQUIRE_TRUE(synth::MidiProfileKindFromName("generic", kind));
+     REQUIRE_TRUE(kind == MidiProfileKind::Generic);
+ }
+
++TEST_CASE(MessageInJsonRoundTripsHighGestureIndex) {
++    synth::JsonArena arena(4096);
++    const synth::MessageIn source = synth::MessageIn::SetGestureSelect(17, 63, true);
++    const synth::JSON json = synth::ToJSON(arena, source);
++    synth::MessageIn target;
++    REQUIRE_TRUE(synth::FromJSON(json, target));
++    REQUIRE_TRUE(target.type == synth::MessageIn::Type::SetGestureSelect);
++    REQUIRE_TRUE(target.gestureIx == 63);
++    REQUIRE_TRUE(target.boolValue);
++    REQUIRE_TRUE(target.hasBoolValue);
++}
++
+ TEST_CASE(KindNameFromUnknownRejected) {
+     MidiProfileKind kind = MidiProfileKind::Generic;
+     REQUIRE_TRUE(!synth::MidiProfileKindFromName("bogus", kind));
+     REQUIRE_TRUE(!synth::MidiProfileKindFromName("", kind));
+     REQUIRE_TRUE(!synth::MidiProfileKindFromName("WrldBldr", kind));
+ }
+
+ TEST_CASE(KindSupportMatrix) {
+     const MidiKindSupport wrldbldr = synth::KindSupport(MidiProfileKind::WrldBldr);
+     REQUIRE_TRUE(wrldbldr.encoders);
+diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
+index 597702eb..1133fe03 100644
+--- a/projects/synth/tests/parameter_modulation_tests.cpp
++++ b/projects/synth/tests/parameter_modulation_tests.cpp
+@@ -459,20 +459,77 @@ TEST_CASE(manager_gesture_count_is_fixed_before_groups) {
+     REQUIRE_TRUE(manager.SetGestureCount(2));
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numScenes = 1,
+         .maxParameters = 1,
+     });
+     REQUIRE_TRUE(group.GestureCount() == 2);
+     REQUIRE_TRUE(!manager.SetGestureCount(3));
+ }
+
++TEST_CASE(manager_gesture_count_supports_zero_through_64_and_rejects_65_without_mutation) {
++    for (const std::size_t count : {std::size_t{0}, std::size_t{1}, std::size_t{32},
++                                    std::size_t{33}, std::size_t{64}}) {
++        synth::ParameterManager manager;
++        REQUIRE_TRUE(manager.SetGestureCount(count));
++        REQUIRE_TRUE(manager.GestureCount() == count);
++        if (count != 0) {
++            manager.SelectGesture(count - 1);
++            REQUIRE_TRUE(manager.GestureSelected(count - 1));
++        }
++    }
++
++    synth::ParameterManager manager;
++    REQUIRE_TRUE(manager.SetGestureCount(64));
++    manager.SelectGesture(63);
++    REQUIRE_TRUE(manager.GestureSelected(63));
++    REQUIRE_TRUE(manager.SelectedGestureMask() == (synth::GestureMask{1} << 63));
++    REQUIRE_TRUE(!manager.SetGestureCount(65));
++    REQUIRE_TRUE(manager.GestureCount() == 64);
++    REQUIRE_TRUE(manager.GestureSelected(63));
++
++    bool threw = false;
++    try {
++        (void)synth::Gestures(65);
++    } catch (const std::invalid_argument&) {
++        threw = true;
++    }
++    REQUIRE_TRUE(threw);
++}
++
++TEST_CASE(gesture_masks_visit_only_active_bits_through_index_63) {
++    synth::ParameterManager manager;
++    REQUIRE_TRUE(manager.SetGestureCount(64));
++    auto& group = manager.CreateGroup({
++        .numVoices = 1,
++        .numScenes = 2,
++        .maxParameters = 1,
++        .processLiteAlpha = 1.0f,
++        .targetCenterAlpha = 1.0f,
++    });
++    auto& parameter = manager.CreateParameter(group, {.name = "Gesture sparse", .defaultValue = 0.25f});
++    synth::ParameterProcessingObserver work{};
++    group.SetProcessingObserverForTests(&work);
++
++    parameter.Compute(manager.Scene());
++    REQUIRE_TRUE(work.activeGestureVisits == 0);
++
++    parameter.SetGestureActive(0, 63, true);
++    parameter.GestureValue(0, 63) = 0.75f;
++    manager.SetGestureValue(63, 1.0f);
++    parameter.Compute(manager.Scene());
++    REQUIRE_TRUE(work.activeGestureVisits == 1);
++    REQUIRE_TRUE((parameter.GesturesAffectingMask() & (std::uint64_t{1} << 63)) != 0);
++    parameter.ProcessLite();
++    REQUIRE_NEAR(parameter.GetRaw(0), 0.75f, 0.000001f);
++}
++
+ TEST_CASE(validated_scene_endpoint_setter_preserves_state_on_reject) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(1);
+     (void)manager.CreateGroup({.numVoices = 1, .numScenes = 2, .maxParameters = 1});
+     (void)manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
+
+     REQUIRE_TRUE(manager.SetSceneEndpoints(0, 0));
+     manager.SetSceneBlend(0.25f);
+     REQUIRE_TRUE(!manager.SetSceneEndpoints(1, 0));
+     REQUIRE_TRUE(manager.Scene().leftScene == 0);
+@@ -2070,57 +2127,66 @@ TEST_CASE(parameter_ui_state_clears_semantic_colors_when_disconnected) {
+     state.SetDisconnected();
+     REQUIRE_TRUE(!state.connected.load(std::memory_order_relaxed));
+     REQUIRE_TRUE(state.baseColor.Load() == synth::Color::Off);
+     REQUIRE_TRUE(state.indicatorColors[0].Load() == synth::Color::Off);
+     REQUIRE_TRUE(state.modulatorColorCount.load() == 0);
+     REQUIRE_TRUE(state.gestureColorCount.load() == 0);
+     REQUIRE_TRUE(state.modulatorSourceColors[0].Load() == synth::Color::Off);
+     REQUIRE_TRUE(state.gestureColors[0].Load() == synth::Color::Off);
+ }
+
+-TEST_CASE(ui_state_reports_affecting_masks_for_first_32_indices) {
++TEST_CASE(ui_state_reports_affecting_masks_through_gesture_index_63) {
+     synth::ParameterManager manager;
+-    manager.SetGestureCount(33);
++    manager.SetGestureCount(64);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 33,
+         .numScenes = 2,
+         .maxParameters = 4,
+     });
+
+     auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
+     auto& depth31 = manager.CreateParameter(group, {.name = "Depth31", .defaultValue = 0.25f});
+     auto& depth32 = manager.CreateParameter(group, {.name = "Depth32", .defaultValue = 0.25f});
+     REQUIRE_TRUE(parameter.AssignModulationDepth(31, &depth31));
+     REQUIRE_TRUE(parameter.AssignModulationDepth(32, &depth32));
+     depth31.SceneCenter(0) = 0.75f;
+     parameter.SetGestureActive(0, 0, true);
+     parameter.SetGestureActive(0, 31, true);
+     parameter.SetGestureActive(0, 32, true);
++    parameter.SetGestureActive(0, 63, true);
+     parameter.SetGestureActive(1, 1, true);
+     parameter.SetGestureActive(1, 31, true);
++    parameter.SetGestureActive(1, 32, true);
+
+     synth::Parameter::UIState ui(1);
+     REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
+
+     manager.SetSceneBlend(0.0f);
+     parameter.PopulateUIState(ui);
+     REQUIRE_TRUE(ui.modulatorsAffectingMask.load() == (1u << 31));
+-    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 0) | (1u << 31)));
++    REQUIRE_TRUE(ui.gesturesAffectingMask.load() ==
++                 ((std::uint64_t{1} << 0) | (std::uint64_t{1} << 31) |
++                  (std::uint64_t{1} << 32) | (std::uint64_t{1} << 63)));
+
+     manager.SetSceneBlend(1.0f);
+     parameter.PopulateUIState(ui);
+-    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 1) | (1u << 31)));
++    REQUIRE_TRUE(ui.gesturesAffectingMask.load() ==
++                 ((std::uint64_t{1} << 1) | (std::uint64_t{1} << 31) |
++                  (std::uint64_t{1} << 32)));
+
+     manager.SetSceneBlend(0.5f);
+     parameter.PopulateUIState(ui);
+-    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 0) | (1u << 1) | (1u << 31)));
++    REQUIRE_TRUE(ui.gesturesAffectingMask.load() ==
++                 ((std::uint64_t{1} << 0) | (std::uint64_t{1} << 1) |
++                  (std::uint64_t{1} << 31) | (std::uint64_t{1} << 32) |
++                  (std::uint64_t{1} << 63)));
+ }
+
+ TEST_CASE(ui_state_ignores_inactive_depth_gesture_values_for_modulator_mask) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(1);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 1,
+         .maxParameters = 2,
+@@ -2638,41 +2704,41 @@ TEST_CASE(handle_inc_dec_saturation_solve_matches_smart_grid) {
+     parameter.HandleIncDec(scene, 0.2f);
+     parameter.Compute(scene);
+
+     REQUIRE_NEAR(parameter.SceneCenter(0), 1.0f, 0.0001f);
+     REQUIRE_NEAR(parameter.SceneCenter(1), 0.7f, 0.0001f);
+     REQUIRE_NEAR(parameter.TargetCenter(), 0.925f, 0.0001f);
+ }
+
+ TEST_CASE(selected_gesture_activation_snapshots_parent_value) {
+     synth::ParameterManager manager;
+-    manager.SetGestureCount(2);
++    manager.SetGestureCount(64);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 0,
+         .numScenes = 2,
+         .maxParameters = 1,
+         .targetCenterAlpha = 1.0f,
+     });
+     auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.1f});
+     parameter.SceneCenter(0) = 0.25f;
+     parameter.SceneCenter(1) = 0.75f;
+-    parameter.GestureValue(0, 0) = 0.9f;
+-    parameter.GestureValue(1, 0) = 0.9f;
+-    manager.SelectGesture(0);
++    parameter.GestureValue(0, 63) = 0.9f;
++    parameter.GestureValue(1, 63) = 0.9f;
++    manager.SelectGesture(63);
+
+     parameter.HandleIncDec({.leftScene = 0, .rightScene = 1, .blend = 0.0f}, 0.0f);
+
+-    REQUIRE_TRUE(parameter.GestureActive(0, 0));
+-    REQUIRE_TRUE(!parameter.GestureActive(1, 0));
+-    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.25f, 0.0001f);
+-    REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.9f, 0.0001f);
++    REQUIRE_TRUE(parameter.GestureActive(0, 63));
++    REQUIRE_TRUE(!parameter.GestureActive(1, 63));
++    REQUIRE_NEAR(parameter.GestureValue(0, 63), 0.25f, 0.0001f);
++    REQUIRE_NEAR(parameter.GestureValue(1, 63), 0.9f, 0.0001f);
+ }
+
+ TEST_CASE(selected_inactive_gesture_first_turn_arms_without_applying_delta) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(1);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 0,
+         .numScenes = 1,
+         .maxParameters = 1,
+@@ -2709,41 +2775,41 @@ TEST_CASE(selected_zero_weight_gesture_first_turn_arms_without_applying_delta) {
+     const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
+     parameter.HandleIncDec(scene, 0.2f);
+
+     REQUIRE_TRUE(parameter.GestureActive(0, 0));
+     REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
+     REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.25f, 0.0001f);
+ }
+
+ TEST_CASE(active_high_gesture_distributes_after_deselection) {
+     synth::ParameterManager manager;
+-    manager.SetGestureCount(1);
++    manager.SetGestureCount(64);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 0,
+         .numScenes = 1,
+         .maxParameters = 1,
+     });
+     auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.25f});
+     parameter.SceneCenter(0) = 0.25f;
+-    parameter.GestureValue(0, 0) = 0.9f;
+-    parameter.SetGestureActive(0, 0, true);
+-    manager.SetGestureValue(0, 1.0f);
+-    manager.DeselectGesture(0);
++    parameter.GestureValue(0, 63) = 0.9f;
++    parameter.SetGestureActive(0, 63, true);
++    manager.SetGestureValue(63, 1.0f);
++    manager.DeselectGesture(63);
+
+     const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
+     parameter.HandleIncDec(scene, 0.2f);
+
+-    REQUIRE_TRUE(parameter.GestureActive(0, 0));
+-    REQUIRE_TRUE(!manager.GestureSelected(0));
++    REQUIRE_TRUE(parameter.GestureActive(0, 63));
++    REQUIRE_TRUE(!manager.GestureSelected(63));
+     REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
+-    REQUIRE_NEAR(parameter.GestureValue(0, 0), 1.0f, 0.0001f);
++    REQUIRE_NEAR(parameter.GestureValue(0, 63), 1.0f, 0.0001f);
+ }
+
+ TEST_CASE(selected_gesture_weight_one_edits_gesture_without_moving_base) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(2);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 0,
+         .numScenes = 1,
+         .maxParameters = 1,
+@@ -4084,20 +4150,62 @@ TEST_CASE(message_bus_set_reset_and_set_gesture_select_are_idempotent) {
+     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetReset(0, true)));
+     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetReset(0, true)));
+     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, true)));
+     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, false)));
+     bus.Process(0);
+
+     REQUIRE_TRUE(manager.ResetHeld());
+     REQUIRE_TRUE(!manager.GestureSelected(1));
+ }
+
++TEST_CASE(message_bus_and_patch_round_trip_gesture_indices_32_and_63) {
++    synth::ParameterManager source;
++    REQUIRE_TRUE(source.SetGestureCount(64));
++    auto& sourceGroup = source.CreateGroup({
++        .numVoices = 1,
++        .numScenes = 1,
++        .maxParameters = 1,
++        .targetCenterAlpha = 1.0f,
++    });
++    auto& sourceParameter = source.CreateParameter(sourceGroup, {.name = "High gestures", .defaultValue = 0.25f});
++    synth::MessageInBus bus(&source, 8);
++    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 32, true)));
++    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 63, true)));
++    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(0, 32, 0.4f)));
++    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(0, 63, 0.8f)));
++    bus.Process(0);
++    REQUIRE_TRUE(source.GestureSelected(32));
++    REQUIRE_TRUE(source.GestureSelected(63));
++
++    sourceParameter.GestureValue(0, 32) = 0.45f;
++    sourceParameter.GestureValue(0, 63) = 0.85f;
++    sourceParameter.SetGestureActive(0, 32, true);
++    sourceParameter.SetGestureActive(0, 63, true);
++
++    synth::JsonArena arena(65536);
++    const synth::JSON saved = source.ParameterValuesToJSON(arena);
++    synth::ParameterManager target;
++    REQUIRE_TRUE(target.SetGestureCount(64));
++    auto& targetGroup = target.CreateGroup({
++        .numVoices = 1,
++        .numScenes = 1,
++        .maxParameters = 1,
++        .targetCenterAlpha = 1.0f,
++    });
++    auto& targetParameter = target.CreateParameter(targetGroup, {.name = "High gestures", .defaultValue = 0.25f});
++    REQUIRE_TRUE(target.LoadParameterValuesFromJSON(saved));
++    REQUIRE_NEAR(targetParameter.GestureValue(0, 32), 0.45f, 0.000001f);
++    REQUIRE_NEAR(targetParameter.GestureValue(0, 63), 0.85f, 0.000001f);
++    REQUIRE_TRUE(targetParameter.GestureActive(0, 32));
++    REQUIRE_TRUE(targetParameter.GestureActive(0, 63));
++}
++
+ TEST_CASE(manager_tracks_reset_random_and_random_mod_precedence) {
+     synth::ParameterManager manager;
+     REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::None);
+
+     manager.SetResetHeld(true);
+     REQUIRE_TRUE(manager.ResetHeld());
+     REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::Reset);
+
+     manager.SetRandomHeld(true);
+     REQUIRE_TRUE(manager.RandomHeld());
+@@ -4161,30 +4269,31 @@ TEST_CASE(manager_random_source_hooks_are_deterministic_and_bounded) {
+     REQUIRE_NEAR(manager.NextRandomValue(), 0.4f, 0.0001f);
+     REQUIRE_NEAR(manager.NextRandomCoin(), 0.8f, 0.0001f);
+     REQUIRE_NEAR(manager.NextRandomCoin(), 0.2f, 0.0001f);
+     REQUIRE_TRUE(manager.NextRandomIndex(5) == 2);
+     REQUIRE_TRUE(manager.NextRandomIndex(5) == 2);
+     REQUIRE_TRUE(manager.NextRandomIndex(0) == 0);
+ }
+
+ TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting) {
+     synth::ParameterManager manager;
+-    manager.SetGestureCount(4);
++    manager.SetGestureCount(64);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numScenes = 2,
+         .maxParameters = 4,
+     });
+     auto& affected = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.25f});
+     auto& unaffected = manager.CreateParameter(group, {.name = "B", .defaultValue = 0.5f});
+     auto& drillHidden = manager.CreateParameter(group, {.name = "C", .defaultValue = 0.75f});
+     affected.SetGestureActive(0, 0, true);
++    affected.SetGestureActive(0, 63, true);
+     unaffected.SetGestureActive(0, 1, true);
+     drillHidden.SetGestureActive(0, 2, true);
+
+     auto& bankA = manager.CreateBank();
+     bankA.SetBankColor(synth::Color::Green);
+     bankA.AddMapping(10, affected);
+     bankA.AddMapping(13, drillHidden);
+     auto& bankB = manager.CreateBank();
+     bankB.SetBankColor(synth::Color::Blue);
+     bankB.AddMapping(11, unaffected);
+@@ -4193,21 +4302,21 @@ TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting)
+     bankC.AddMapping(12, affected);
+
+     auto& slot = manager.CreateBankSlot();
+     slot.AddPhysicalEncoder(10);
+     slot.AddPhysicalEncoder(13);
+     slot.SelectBank(&bankA);
+     manager.HandlePress(0, 0);
+     REQUIRE_TRUE(bankA.ShowingModulation());
+
+     synth::ParameterManager::UIState ui;
+-    ui.Configure(1, 2, 1, 0, 4, 4);
++    ui.Configure(1, 2, 1, 0, 64, 4);
+     manager.PopulateUIState(ui);
+
+     REQUIRE_TRUE(ui.bankCapacity == 4);
+     REQUIRE_TRUE(ui.banks[0].connected.load());
+     REQUIRE_TRUE(ui.banks[0].selected.load());
+     REQUIRE_TRUE(ui.banks[0].bankColor.Load() == synth::Color::Green);
+     REQUIRE_TRUE(ui.banks[1].connected.load());
+     REQUIRE_TRUE(!ui.banks[1].selected.load());
+     REQUIRE_TRUE(ui.banks[1].bankColor.Load() == synth::Color::Blue);
+     REQUIRE_TRUE(ui.banks[2].connected.load());
+@@ -4217,20 +4326,22 @@ TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting)
+     REQUIRE_TRUE(!ui.banks[3].selected.load());
+     REQUIRE_TRUE(ui.banks[3].bankColor.Load() == synth::Color::Off);
+     REQUIRE_TRUE(ui.gestures.bankAffectingCount[0].load() == 2);
+     REQUIRE_TRUE(ui.gestures.bankAffectingMask[0].load() == ((1u << 0u) | (1u << 2u)));
+     REQUIRE_TRUE(ui.gestures.bankAffectingCount[1].load() == 1);
+     REQUIRE_TRUE(ui.gestures.bankAffectingMask[1].load() == (1u << 1u));
+     REQUIRE_TRUE(ui.gestures.bankAffectingCount[2].load() == 1);
+     REQUIRE_TRUE(ui.gestures.bankAffectingMask[2].load() == (1u << 0u));
+     REQUIRE_TRUE(ui.gestures.bankAffectingCount[3].load() == 0);
+     REQUIRE_TRUE(ui.gestures.bankAffectingMask[3].load() == 0);
++    REQUIRE_TRUE(ui.gestures.bankAffectingCount[63].load() == 2);
++    REQUIRE_TRUE(ui.gestures.bankAffectingMask[63].load() == ((1u << 0u) | (1u << 2u)));
+ }
+
+ TEST_CASE(message_bus_routes_modulation_target_position_to_visible_parameter) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(1);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 1,
+         .maxParameters = 2,
+@@ -6326,35 +6437,35 @@ std::uint32_t SimModulatorsAffectingMask(const SimOracle& oracle, const SimParam
+     std::uint32_t mask = 0;
+     for (std::size_t modIx = 0; modIx < std::min<std::size_t>(kSimMods, 32); ++modIx) {
+         const int route = parameter.route[modIx];
+         if (route >= 0 && SimHasNonNeutralDepthState(oracle, oracle.params[static_cast<std::size_t>(route)])) {
+             mask |= (std::uint32_t{1} << modIx);
+         }
+     }
+     return mask;
+ }
+
+-std::uint32_t SimGesturesAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
+-    std::uint32_t mask = 0;
++synth::GestureMask SimGesturesAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
++    synth::GestureMask mask = 0;
+     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
+     for (std::size_t gestureIx = 0; gestureIx < std::min<std::size_t>(kSimGestures, 32); ++gestureIx) {
+         bool active = false;
+         if (blend <= 0.0f) {
+             active = parameter.gestureActive[oracle.scene.leftScene][gestureIx];
+         } else if (blend >= 1.0f) {
+             active = parameter.gestureActive[oracle.scene.rightScene][gestureIx];
+         } else {
+             active = parameter.gestureActive[oracle.scene.leftScene][gestureIx] ||
+                      parameter.gestureActive[oracle.scene.rightScene][gestureIx];
+         }
+         if (active) {
+-            mask |= (std::uint32_t{1} << gestureIx);
++            mask |= (synth::GestureMask{1} << gestureIx);
+         }
+     }
+     return mask;
+ }
+
+ void SimSeedDisplayState(SimOracle& oracle, std::size_t paramIx);
+
+ void SimComputeAtDepth(SimOracle& oracle, std::size_t paramIx, std::size_t recursionDepth) {
+     SimParam& parameter = oracle.params[paramIx];
+     parameter.targetCenter = SimClamp(SimRawCenter(oracle, parameter), parameter.range);
+@@ -7035,21 +7146,21 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
+             const std::size_t paramIx = static_cast<std::size_t>(cell->parameter);
+             const SimParam& expected = oracle.params[paramIx];
+             if (actual.bipolar.load() != (expected.range == synth::RangeKind::Bipolar)) {
+                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " bipolar");
+             }
+             if (actual.baseColor.Load() != synth::Color::Grey) {
+                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " color");
+             }
+             const std::size_t expectedSwitchValues = expected.switchValues;
+             const std::uint32_t expectedModulatorMask = SimModulatorsAffectingMask(oracle, expected);
+-            const std::uint32_t expectedGestureMask = SimGesturesAffectingMask(oracle, expected);
++            const synth::GestureMask expectedGestureMask = SimGesturesAffectingMask(oracle, expected);
+             if (actual.switchValues.load() != expectedSwitchValues) {
+                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " switch values");
+             }
+             if (actual.modulatorsAffectingMask.load() != expectedModulatorMask) {
+                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " modulator mask");
+             }
+             if (actual.gesturesAffectingMask.load() != expectedGestureMask) {
+                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " gesture mask");
+             }
+             for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+diff --git a/projects/synth/tests/portable_ui_tests.cpp b/projects/synth/tests/portable_ui_tests.cpp
+index eace7945..485fbd4f 100644
+--- a/projects/synth/tests/portable_ui_tests.cpp
++++ b/projects/synth/tests/portable_ui_tests.cpp
+@@ -429,20 +429,34 @@ int main()
+     const synth::ui::EncoderDrawState snapshotEncoder =
+         synth::ui::EncoderDrawStateFromParameter(parameterState);
+     Require(snapshotEncoder.baseColor == synth::Color::Red, "encoder uses snapshot base color");
+     Require(snapshotEncoder.voices[0].indicatorColor == synth::Color::Blue,
+             "encoder uses snapshot voice-zero indicator color");
+     Require(snapshotEncoder.modulatorColors == std::vector<synth::Color>{synth::Color::Cyan},
+             "encoder uses snapshot source badge colors");
+     Require(snapshotEncoder.gestureColors == std::vector<synth::Color>{synth::Color::Orange},
+             "encoder uses snapshot gesture badge colors");
+
++    Require(synth::ui::EncoderGeometry::BadgeText(false, 16) == "17", "gesture 16 badge is one-based");
++    Require(synth::ui::EncoderGeometry::BadgeText(false, 62) == "63", "gesture 62 badge is one-based");
++    Require(synth::ui::EncoderGeometry::BadgeText(false, 63) == "64", "gesture 63 badge is one-based");
++    synth::ui::EncoderDrawState highGestureEncoder;
++    highGestureEncoder.connected = true;
++    highGestureEncoder.gesturesAffectingMask = std::uint64_t{1} << 63;
++    highGestureEncoder.gestureColors.resize(64, synth::Color::Orange);
++    const auto highGestureCommands = synth::ui::BuildEncoderDrawCommands(
++        highGestureEncoder, {0.0f, 0.0f, 128.0f, 128.0f});
++    Require(std::any_of(highGestureCommands.begin(), highGestureCommands.end(), [](const auto& command) {
++                return command.kind == synth::ui::DrawCommand::Kind::Text && command.text == "64";
++            }),
++            "encoder renders gesture 63 as badge 64");
++
+     static_assert(synth::SynthApplication<TestApp>);
+     static_assert(!synth::ui::kPortableUiUsesJuce);
+     static_assert(std::is_same_v<decltype(synth::ui::WaveformLayerDrawState::scope), const synth::ScopeWriter*>);
+     static_assert(!std::is_copy_constructible_v<synth::ui::Visualizer>);
+     static_assert(!std::is_copy_assignable_v<synth::ui::Visualizer>);
+     static_assert(!std::is_move_constructible_v<synth::ui::Visualizer>);
+     static_assert(!std::is_move_assignable_v<synth::ui::Visualizer>);
+     TestVisualizer visualizer;
+     Require(visualizer.Visible(), "visualizer is visible by default");
+     visualizer.SetBounds({11.0f, 12.0f, 44.0f, 45.0f});
diff --git a/.superpowers/sdd/scale-modulation-processing/task-3-brief.md b/.superpowers/sdd/scale-modulation-processing/task-3-brief.md
new file mode 100644
index 00000000..f9c42e13
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-3-brief.md
@@ -0,0 +1,103 @@
+### Task 3: Stable-Identity Active Modulation Route Prefixes
+
+**OpenSpec coverage:** tasks 1.2 and 4.1-4.5; remaining `spm-72` active-prefix scenarios. Task 1.2's full-scan oracle is implemented and closed here.
+
+**Files:**
+- Modify: `projects/synth/include/synth/ParameterModulation.hpp` — compact apply API, route permutation arenas/accessors.
+- Modify: `projects/synth/src/ParameterModulation.cpp` — activation, swap-removal, compact slew/application, invariants.
+- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — full-scan oracle and zero/sparse/dense/settling/randomized cases.
+- Modify: `projects/synth/tests/module_tests.cpp` — module-level audio equivalence.
+
+**Interfaces:**
+- Produces: `float Modulators::ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths, std::span<const std::size_t> sourceIndices) const`.
+- Produces: `std::size_t Parameter::ActiveRouteCount() const`, `std::span<const std::size_t> Parameter::ActiveRouteSourceIndices() const`, and `std::size_t Parameter::RoutePositionForSource(std::size_t sourceIx) const` for tests/debugging.
+- Produces: fixed-capacity per-parameter `routeSourceIndices_`, `sourceRoutePositions_`, and `activeRouteCount_`; internal current/target depths are voice-major by route slot. Replace tests/callers that assumed the public `CurrentDepths`/`TargetDepths` spans were source-ordered with explicit `CurrentDepthForSource`/`TargetDepthForSource` accessors, and name any remaining slot-ordered spans `CurrentDepthSlots`/`TargetDepthSlots` so their semantics cannot be mistaken for stable source order.
+- Consumes: Task 1's `activeRouteVisits` observer field.
+
+- [ ] **Step 1: Add a source-indexed full-scan oracle and RED equivalence tests**
+
+Keep the oracle test-only and independent of production permutations:
+
+```cpp
+float FullScanApply(const synth::Modulators& modulators, std::size_t voiceIx,
+                    std::span<const float> depthsBySource) {
+    float sum = 0.0f;
+    for (std::size_t sourceIx = 0; sourceIx < depthsBySource.size(); ++sourceIx) {
+        sum += modulators.Value(voiceIx, sourceIx) * depthsBySource[sourceIx];
+    }
+    return sum;
+}
+```
+
+Add tests for no routes, sources `{0, 3}`, all sources, activation order `{3, 0, 2}`, swap-removal of source 0, two voices where only voice 1 is nonzero, a nested depth route, scene return-to-zero, and exact source metadata/JSON keys after swaps. At every sample reconstruct `depthsBySource[routeSourceIndices[slot]]` and compare `GetRaw`, current/target depths, and cached values with the oracle.
+
+- [ ] **Step 2: Run RED route tests**
+
+```bash
+make -C projects/synth build/parameter_modulation_tests build/module_tests
+projects/synth/build/parameter_modulation_tests
+projects/synth/build/module_tests
+```
+
+Expected: compilation fails for the new active-route API/accessors; after declarations only, zero-depth allocated routes still produce full-width visit counts.
+
+- [ ] **Step 3: Add fixed route permutation storage and invariants**
+
+Add two `std::size_t` arenas sized `maxParameters * numModulators`, bind spans in both `Parameter` constructors, and initialize each slot to identity. Maintain this bijection:
+
+```cpp
+for (std::size_t slot = 0; slot < group_.Config().numModulators; ++slot) {
+    assert(sourceRoutePositions_[routeSourceIndices_[slot]] == slot);
+}
+```
+
+`EnsureRouteActive(sourceIx)` swaps the source's slot with `activeRouteCount_`, swaps current and target depth values for that pair in every voice, fixes both inverse positions, then increments the count. `RemoveActiveRoute(slot)` swaps with `activeRouteCount_ - 1`, fixes all voice depths and inverse positions, then decrements. Source-indexed editing, `modulationDepths_`, metadata, affecting masks, and JSON remain unchanged. Keep stable-source accessors for assertions and indexed control code; never expose a route-slot span under a source-indexed name.
+
+- [ ] **Step 4: Build the per-parameter across-voice active union at compute cadence**
+
+For each stable source index, recursively compute its child first, derive the target for every voice, activate the source if any target is non-neutral or its existing current slot is still non-neutral, and write targets into its route slot. Normalize center scale/offset/min/max by iterating `[0, activeRouteCount_)`. After targets are written, scan the active prefix backward; snap and swap-remove a route only when all voices have `abs(current) <= 1e-6` and `abs(target) <= 1e-6`.
+
+Use a backward loop so swap-removal cannot skip the moved slot:
+
+```cpp
+for (std::size_t slot = activeRouteCount_; slot-- > 0;) {
+    if (RouteNeutralAcrossVoices(slot)) {
+        SnapRouteToZero(slot);
+        RemoveActiveRoute(slot);
+    }
+}
+```
+
+- [ ] **Step 5: Migrate the hot paths to compact spans**
+
+Implement `ApplyActive` with equal-length validation and stable source lookup:
+
+```cpp
+float Modulators::ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths,
+                              std::span<const std::size_t> sourceIndices) const {
+    if (activeDepths.size() != sourceIndices.size()) {
+        throw std::invalid_argument("active depth and source index counts differ");
+    }
+    float result = 0.0f;
+    for (std::size_t slot = 0; slot < activeDepths.size(); ++slot) {
+        result += Value(voiceIx, sourceIndices[slot]) * activeDepths[slot];
+    }
+    return result;
+}
+```
+
+Change `GetRaw`, `TargetValue`, and `ProcessLite` to pass only the active prefix and its source-index prefix. Slew only active route slots and increment `activeRouteVisits` once per route slot per voice actually visited. Keep the old source-indexed full scan only in test code; no production caller may use `Modulators::Apply` afterward.
+
+- [ ] **Step 6: Extend the randomized oracle, run tests, commit, and pass Opus**
+
+Add route/source and source/route arrays to the existing deterministic oracle. After every generated edit, compute, process, reset, and patch action, assert the bijection, active prefix, current/target state by stable source, cached output, and masks. Run Step 2's commands; both binaries must exit 0. Then:
+
+```bash
+git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/module_tests.cpp
+git commit -m "perf(synth): traverse only active modulation routes"
+```
+
+Run the global Opus gate. The review prompt must explicitly audit source identity through swaps, across-voice union semantics, normalization, and settling-tail removal. Record both passing verdicts.
+
+---
+
diff --git a/.superpowers/sdd/scale-modulation-processing/task-3-report.md b/.superpowers/sdd/scale-modulation-processing/task-3-report.md
new file mode 100644
index 00000000..9de8f64f
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-3-report.md
@@ -0,0 +1,68 @@
+# Task 3 Report: Stable-Identity Active Modulation Route Prefixes
+
+## Scope completed
+
+- Added fixed-capacity route-source and source-route permutation arenas to both initial group storage and reinforced storage batches.
+- Added a per-parameter across-voice active prefix with activation swaps, inverse-map maintenance, backward neutral swap-removal, and debug bijection assertions.
+- Added `Modulators::ApplyActive` and migrated `GetRaw`, `TargetValue`, and `ProcessLite` to the compact route/source spans. No production caller uses the full-width `Modulators::Apply` path.
+- Kept indexed topology, modulation-depth pointers, metadata/colors, affecting masks, and JSON source keys stable while current/target depth storage moves by route slot.
+- Kept returning-to-zero routes active during one-pole settling and pruned them only at compute boundaries after every voice's current and target depth is within `1e-6`.
+- Renamed slot-ordered spans to `CurrentDepthSlots`/`TargetDepthSlots` and added read-only source-indexed accessors so inspection cannot activate a route.
+- Extended the existing deterministic randomized oracle to assert the full permutation bijection, active-prefix membership/count, source-indexed current/target depths, normalized output, cached state, and masks after every action.
+- Added module-level exact work-count assertions for a three-source group with one active route.
+
+## RED evidence
+
+After adding the independent source-indexed `FullScanApply` oracle and wished-for active APIs/tests, this command failed as expected:
+
+```text
+make -C projects/synth build/parameter_modulation_tests build/module_tests
+```
+
+The clean failure was the missing Task 3 surface:
+
+```text
+error: no member named 'ActiveRouteSourceIndices' in 'synth::Parameter'
+error: no member named 'ActiveRouteCount' in 'synth::Parameter'
+error: no member named 'RoutePositionForSource' in 'synth::Parameter'
+error: no member named 'CurrentDepthForSource' in 'synth::Parameter'
+error: no member named 'ApplyActive' in 'synth::Modulators'
+```
+
+## GREEN evidence
+
+Final command:
+
+```text
+make -C projects/synth build/parameter_modulation_tests build/module_tests
+projects/synth/build/parameter_modulation_tests
+projects/synth/build/module_tests
+```
+
+Results:
+
+- Both test binaries compiled with `-std=c++20 -Wall -Wextra -Wpedantic -O2` and no warnings.
+- `parameter_modulation_tests`: exit 0; all cases passed, including the existing randomized parameter, message-bus, patch-lifecycle, recursive persistence, normalization, nested modulation, scene, UI-mask, and JSON suites plus the new sparse-route cases.
+- `module_tests`: exit 0; all cases passed, including exact sparse route visits in `demo_modulation_process_parameters_applies_direct_vco_modulation`.
+- `git diff --check`: exit 0.
+- Production full-scan caller search: no `GetModulators().Apply(...)` or other production `.Apply(...)` caller remains under `projects/synth/src` or `projects/synth/include`.
+
+## Cases pinned
+
+- zero allocated-active routes despite four materialized neutral depth nodes;
+- sparse sources and dense/all-source activation;
+- incremental activation order `3, 0, 2`;
+- backward removal of source 0 with moved-source identity preserved;
+- route union where voice 0 is neutral and only voice 1 is non-neutral;
+- nested modulation-depth route computation;
+- scene/blend edits and return-to-zero settling;
+- source names, source colors, modulation-depth pointers, and exact JSON keys after route swaps;
+- sample-by-sample full-scan output equivalence and exact `activeRouteCount * voiceCount` work;
+- active permutation/inverse-map invariants inside the pre-existing randomized state-machine oracle.
+
+## Implementation decisions
+
+- Current and target depths remain voice-major, but the second dimension is explicitly a route slot. Stable source access is always mediated by the inverse map.
+- Mutable slot spans remain available for low-level state tests and are named as slot-ordered. Source-indexed accessors are read-only to avoid an inspection side effect.
+- The active prefix is maintained at recursive target-compute boundaries using preallocated storage; per-sample processing performs no allocation, locking, graph traversal, or removal.
+- The legacy full-width `Modulators::Apply` API remains for existing direct unit coverage, but it is not called by production parameter processing. The independent Task 3 oracle uses `Modulators::Value` directly and does not depend on either production apply implementation.
diff --git a/.superpowers/sdd/scale-modulation-processing/task-3-review-package.md b/.superpowers/sdd/scale-modulation-processing/task-3-review-package.md
new file mode 100644
index 00000000..9acff8fc
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-3-review-package.md
@@ -0,0 +1,1745 @@
+# Review package: f27ff53b..159a0dd1
+
+## Commits
+159a0dd1 perf(synth): traverse only active modulation routes
+
+## Files changed
+ .../synth/include/synth/ParameterModulation.hpp    |  32 +-
+ projects/synth/src/ParameterModulation.cpp         | 242 +++++++++++++--
+ projects/synth/tests/module_tests.cpp              |   6 +
+ .../synth/tests/parameter_modulation_tests.cpp     | 325 ++++++++++++++++++---
+ 4 files changed, 542 insertions(+), 63 deletions(-)
+
+## Diff
+diff --git a/projects/synth/include/synth/ParameterModulation.hpp b/projects/synth/include/synth/ParameterModulation.hpp
+index 1a9a09c2..9e83531e 100644
+--- a/projects/synth/include/synth/ParameterModulation.hpp
++++ b/projects/synth/include/synth/ParameterModulation.hpp
+@@ -181,20 +181,22 @@ struct ParameterStorageBatch {
+     std::vector<float> currentCenterScaleArena;
+     std::vector<float> targetCenterScaleArena;
+     std::vector<float> currentNormalizationOffsetArena;
+     std::vector<float> targetNormalizationOffsetArena;
+     std::vector<float> currentMinValueArena;
+     std::vector<float> targetMinValueArena;
+     std::vector<float> currentMaxValueArena;
+     std::vector<float> targetMaxValueArena;
+     std::vector<float> currentDepthArena;
+     std::vector<float> targetDepthArena;
++    std::vector<std::size_t> routeSourceIndexArena;
++    std::vector<std::size_t> sourceRoutePositionArena;
+     std::vector<float> currentKnobValueArena;
+     std::vector<float> uiDisplayCenterArena;
+     std::vector<float> uiDisplaySpreadEnergyArena;
+     std::vector<Parameter*> modulationDepthArena;
+     std::vector<float> sceneCenterArena;
+     std::vector<float> gestureValueArena;
+     std::vector<GestureMask> gestureActiveMaskArena;
+ };
+
+ std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
+@@ -225,20 +227,22 @@ struct ParameterConfig {
+     std::vector<Color> indicatorColors;
+ };
+
+ class Modulators {
+ public:
+     explicit Modulators(std::size_t voices = 0, std::size_t modulators = 0);
+
+     float& Value(std::size_t voiceIx, std::size_t modIx);
+     float Value(std::size_t voiceIx, std::size_t modIx) const;
+     float Apply(std::size_t voiceIx, std::span<const float> depths) const;
++    float ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths,
++                      std::span<const std::size_t> sourceIndices) const;
+     // Source pointers are caller-owned and must remain address-stable while registered.
+     void SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
+                              ModulatorMetadata metadata);
+     void UpdateModValues();
+
+     std::size_t NumVoices() const { return numVoices_; }
+     std::size_t NumModulators() const { return numModulators_; }
+
+     ModulatorMetadata& Metadata(std::size_t modIx);
+     const ModulatorMetadata& Metadata(std::size_t modIx) const;
+@@ -338,20 +342,22 @@ private:
+     std::vector<float> currentCenterScaleArena_;
+     std::vector<float> targetCenterScaleArena_;
+     std::vector<float> currentNormalizationOffsetArena_;
+     std::vector<float> targetNormalizationOffsetArena_;
+     std::vector<float> currentMinValueArena_;
+     std::vector<float> targetMinValueArena_;
+     std::vector<float> currentMaxValueArena_;
+     std::vector<float> targetMaxValueArena_;
+     std::vector<float> currentDepthArena_;
+     std::vector<float> targetDepthArena_;
++    std::vector<std::size_t> routeSourceIndexArena_;
++    std::vector<std::size_t> sourceRoutePositionArena_;
+     std::vector<float> currentKnobValueArena_;
+     std::vector<float> uiDisplayCenterArena_;
+     std::vector<float> uiDisplaySpreadEnergyArena_;
+     std::vector<Parameter*> modulationDepthArena_;
+     std::vector<float> sceneCenterArena_;
+     std::vector<float> gestureValueArena_;
+     std::vector<GestureMask> gestureActiveMaskArena_;
+ };
+
+ class Parameter {
+@@ -431,51 +437,64 @@ public:
+     Parameter* ModulationDepthParameter(std::size_t modIx) const;
+
+     float& SceneCenter(std::size_t sceneIx);
+     float SceneCenter(std::size_t sceneIx) const;
+     float& GestureValue(std::size_t sceneIx, std::size_t gestureIx);
+     float GestureValue(std::size_t sceneIx, std::size_t gestureIx) const;
+     void SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active);
+     bool GestureActive(std::size_t sceneIx, std::size_t gestureIx) const;
+     GestureMask GesturesAffectingMask() const;
+
+-    std::span<float> CurrentDepths(std::size_t voiceIx);
+-    std::span<const float> CurrentDepths(std::size_t voiceIx) const;
+-    std::span<float> TargetDepths(std::size_t voiceIx);
+-    std::span<const float> TargetDepths(std::size_t voiceIx) const;
++    std::span<float> CurrentDepthSlots(std::size_t voiceIx);
++    std::span<const float> CurrentDepthSlots(std::size_t voiceIx) const;
++    std::span<float> TargetDepthSlots(std::size_t voiceIx);
++    std::span<const float> TargetDepthSlots(std::size_t voiceIx) const;
++    float CurrentDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const;
++    float TargetDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const;
++    std::size_t ActiveRouteCount() const { return activeRouteCount_; }
++    std::span<const std::size_t> ActiveRouteSourceIndices() const {
++        return routeSourceIndices_.first(activeRouteCount_);
++    }
++    std::size_t RouteSourceIndex(std::size_t slot) const;
++    std::size_t RoutePositionForSource(std::size_t sourceIx) const;
+
+     float CurrentCenter() const { return currentCenter_; }
+     float TargetCenter() const { return targetCenter_; }
+     float CurrentCenterScale(std::size_t voiceIx) const;
+     float TargetCenterScale(std::size_t voiceIx) const;
+     float CurrentNormalizationOffset(std::size_t voiceIx) const;
+     float TargetNormalizationOffset(std::size_t voiceIx) const;
+     std::size_t RecursionDepth() const { return recursionDepth_; }
+     JSON ToValueJSON(JsonArena& arena) const;
+     bool LoadValuesFromJSON(JSON json);
+
+ private:
+     friend class ParameterManager;
+
+-    std::size_t VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const;
+     std::size_t SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const;
+     void ValidateSceneEndpoints(const SceneState& scene) const;
+     float EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const;
+     void ResetSceneToDefault(std::size_t sceneIx, float defaultValue);
+     void ResetModulationDepthToNeutral(const SceneState& scene);
+     float ComputeRawCenter(const SceneState& scene) const;
+     void ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth, bool smoothTargetCenter);
+     void SnapCurrentToTarget();
+     void SeedCachedKnobAndUiDisplayState();
+     bool WouldCreateCycle(const Parameter* candidate) const;
+     ParameterConfig ModulationDepthConfig(std::size_t modIx) const;
+     float TargetValue(std::size_t voiceIx) const;
++    std::size_t VoiceRouteIndex(std::size_t voiceIx, std::size_t routeSlot) const;
++    void EnsureRouteActive(std::size_t sourceIx);
++    void RemoveActiveRoute(std::size_t routeSlot);
++    bool RouteNeutralAcrossVoices(std::size_t routeSlot) const;
++    void PruneNeutralActiveRoutes();
++    void AssertRouteBijection() const;
+     std::uint32_t ModulatorsAffectingMask() const;
+     bool HasNonDefaultState() const;
+     bool HasNonZeroState() const;
+
+     ParameterId id_;
+     ParameterGroup& group_;
+     ParameterConfig config_;
+     std::size_t slotIx_ = 0;
+     std::size_t recursionDepth_ = 0;
+     float currentCenter_ = 0.0f;
+@@ -483,20 +502,23 @@ private:
+     std::span<float> currentCenterScales_;
+     std::span<float> targetCenterScales_;
+     std::span<float> currentNormalizationOffsets_;
+     std::span<float> targetNormalizationOffsets_;
+     std::span<float> currentMinValues_;
+     std::span<float> targetMinValues_;
+     std::span<float> currentMaxValues_;
+     std::span<float> targetMaxValues_;
+     std::span<float> currentDepths_;
+     std::span<float> targetDepths_;
++    std::span<std::size_t> routeSourceIndices_;
++    std::span<std::size_t> sourceRoutePositions_;
++    std::size_t activeRouteCount_ = 0;
+     std::span<float> currentKnobValues_;
+     std::span<float> uiDisplayCenters_;
+     std::span<float> uiDisplaySpreadEnergies_;
+     std::span<Parameter*> modulationDepths_;
+     std::span<float> sceneCenters_;
+     std::span<float> gestureValues_;
+     std::span<GestureMask> gestureActiveMasks_;
+ };
+
+ class Bank {
+diff --git a/projects/synth/src/ParameterModulation.cpp b/projects/synth/src/ParameterModulation.cpp
+index 3322b5fc..daaac76e 100644
+--- a/projects/synth/src/ParameterModulation.cpp
++++ b/projects/synth/src/ParameterModulation.cpp
+@@ -1,14 +1,15 @@
+ #include "synth/ParameterModulation.hpp"
+
+ #include <algorithm>
+ #include <array>
++#include <cassert>
+ #include <bit>
+ #include <charconv>
+ #include <cmath>
+ #include <limits>
+ #include <stdexcept>
+ #include <utility>
+
+ namespace synth {
+
+ namespace {
+@@ -227,20 +228,22 @@ ParameterStorageBatch::ParameterStorageBatch(const ParameterGroupConfig& config,
+       currentCenterScaleArena(capacity * config.numVoices),
+       targetCenterScaleArena(capacity * config.numVoices),
+       currentNormalizationOffsetArena(capacity * config.numVoices),
+       targetNormalizationOffsetArena(capacity * config.numVoices),
+       currentMinValueArena(capacity * config.numVoices),
+       targetMinValueArena(capacity * config.numVoices),
+       currentMaxValueArena(capacity * config.numVoices),
+       targetMaxValueArena(capacity * config.numVoices),
+       currentDepthArena(capacity * config.numVoices * config.numModulators),
+       targetDepthArena(capacity * config.numVoices * config.numModulators),
++      routeSourceIndexArena(capacity * config.numModulators),
++      sourceRoutePositionArena(capacity * config.numModulators),
+       currentKnobValueArena(capacity * config.numVoices),
+       uiDisplayCenterArena(capacity * config.numVoices),
+       uiDisplaySpreadEnergyArena(capacity * config.numVoices),
+       modulationDepthArena(capacity * config.numModulators, nullptr),
+       sceneCenterArena(capacity * config.numScenes),
+       gestureValueArena(capacity * config.numScenes * gestureCount),
+       gestureActiveMaskArena(capacity * config.numScenes, 0) {
+     parameters.reserve(capacity);
+ }
+
+@@ -279,20 +282,40 @@ float Modulators::Apply(std::size_t voiceIx, std::span<const float> depths) cons
+     }
+
+     const std::size_t rowStart = voiceIx * numModulators_;
+     float result = 0.0f;
+     for (std::size_t modIx = 0; modIx < numModulators_; ++modIx) {
+         result += values_[rowStart + modIx] * depths[modIx];
+     }
+     return result;
+ }
+
++float Modulators::ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths,
++                              std::span<const std::size_t> sourceIndices) const {
++    if (voiceIx >= numVoices_) {
++        throw std::out_of_range("modulator voice index out of range");
++    }
++    if (activeDepths.size() != sourceIndices.size()) {
++        throw std::invalid_argument("active depth and source index counts differ");
++    }
++
++    const std::size_t rowStart = voiceIx * numModulators_;
++    float result = 0.0f;
++    for (std::size_t slot = 0; slot < activeDepths.size(); ++slot) {
++        if (sourceIndices[slot] >= numModulators_) {
++            throw std::out_of_range("modulator source index out of range");
++        }
++        result += values_[rowStart + sourceIndices[slot]] * activeDepths[slot];
++    }
++    return result;
++}
++
+ void Modulators::SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
+                                      ModulatorMetadata metadata) {
+     if (modIx >= numModulators_) {
+         throw std::out_of_range("modulator index out of range");
+     }
+     if (sourcePointers.size() != numVoices_) {
+         throw std::invalid_argument("modulation source pointer count does not match voice count");
+     }
+     if (metadata.connected) {
+         for (float* sourcePointer : sourcePointers) {
+@@ -404,20 +427,22 @@ ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& ma
+     currentCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
+     targetCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
+     currentNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
+     targetNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
+     currentMinValueArena_.resize(config_.maxParameters * config_.numVoices);
+     targetMinValueArena_.resize(config_.maxParameters * config_.numVoices);
+     currentMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
+     targetMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
+     currentDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
+     targetDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
++    routeSourceIndexArena_.resize(config_.maxParameters * config_.numModulators);
++    sourceRoutePositionArena_.resize(config_.maxParameters * config_.numModulators);
+     currentKnobValueArena_.resize(config_.maxParameters * config_.numVoices);
+     uiDisplayCenterArena_.resize(config_.maxParameters * config_.numVoices);
+     uiDisplaySpreadEnergyArena_.resize(config_.maxParameters * config_.numVoices);
+     modulationDepthArena_.resize(config_.maxParameters * config_.numModulators, nullptr);
+     sceneCenterArena_.resize(config_.maxParameters * config_.numScenes);
+     gestureValueArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_);
+     gestureActiveMaskArena_.resize(config_.maxParameters * config_.numScenes, 0);
+ }
+
+ ParameterGroup::~ParameterGroup() = default;
+@@ -582,20 +607,26 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
+                                    group_.Config().numVoices)),
+       targetMaxValues_(ArenaSlice(group_.targetMaxValueArena_,
+                                   slotIx_ * group_.Config().numVoices,
+                                   group_.Config().numVoices)),
+       currentDepths_(ArenaSlice(group_.currentDepthArena_,
+                                 slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
+                                 group_.Config().numVoices * group_.Config().numModulators)),
+       targetDepths_(ArenaSlice(group_.targetDepthArena_,
+                                slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
+                                group_.Config().numVoices * group_.Config().numModulators)),
++      routeSourceIndices_(ArenaSlice(group_.routeSourceIndexArena_,
++                                     slotIx_ * group_.Config().numModulators,
++                                     group_.Config().numModulators)),
++      sourceRoutePositions_(ArenaSlice(group_.sourceRoutePositionArena_,
++                                       slotIx_ * group_.Config().numModulators,
++                                       group_.Config().numModulators)),
+       currentKnobValues_(ArenaSlice(group_.currentKnobValueArena_, slotIx_ * group_.Config().numVoices,
+                                     group_.Config().numVoices)),
+       uiDisplayCenters_(ArenaSlice(group_.uiDisplayCenterArena_, slotIx_ * group_.Config().numVoices,
+                                    group_.Config().numVoices)),
+       uiDisplaySpreadEnergies_(ArenaSlice(group_.uiDisplaySpreadEnergyArena_,
+                                           slotIx_ * group_.Config().numVoices,
+                                           group_.Config().numVoices)),
+       modulationDepths_(ArenaSlice(group_.modulationDepthArena_, slotIx_ * group_.Config().numModulators,
+                                    group_.Config().numModulators)),
+       sceneCenters_(ArenaSlice(group_.sceneCenterArena_, slotIx_ * group_.Config().numScenes,
+@@ -609,20 +640,24 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
+     std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
+     std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
+     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
+     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
+     std::fill(currentMinValues_.begin(), currentMinValues_.end(), currentCenter_);
+     std::fill(targetMinValues_.begin(), targetMinValues_.end(), currentCenter_);
+     std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), currentCenter_);
+     std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), currentCenter_);
+     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
+     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
++    for (std::size_t sourceIx = 0; sourceIx < routeSourceIndices_.size(); ++sourceIx) {
++        routeSourceIndices_[sourceIx] = sourceIx;
++        sourceRoutePositions_[sourceIx] = sourceIx;
++    }
+     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
+     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
+     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
+     std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
+     SeedCachedKnobAndUiDisplayState();
+ }
+
+ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
+                      ParameterStorageBatch& storageBatch, std::size_t slotIx)
+     : id_(id),
+@@ -652,20 +687,26 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
+                                    group_.Config().numVoices)),
+       targetMaxValues_(ArenaSlice(storageBatch.targetMaxValueArena,
+                                   slotIx_ * group_.Config().numVoices,
+                                   group_.Config().numVoices)),
+       currentDepths_(ArenaSlice(storageBatch.currentDepthArena,
+                                 slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
+                                 group_.Config().numVoices * group_.Config().numModulators)),
+       targetDepths_(ArenaSlice(storageBatch.targetDepthArena,
+                                slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
+                                group_.Config().numVoices * group_.Config().numModulators)),
++      routeSourceIndices_(ArenaSlice(storageBatch.routeSourceIndexArena,
++                                     slotIx_ * group_.Config().numModulators,
++                                     group_.Config().numModulators)),
++      sourceRoutePositions_(ArenaSlice(storageBatch.sourceRoutePositionArena,
++                                       slotIx_ * group_.Config().numModulators,
++                                       group_.Config().numModulators)),
+       currentKnobValues_(ArenaSlice(storageBatch.currentKnobValueArena, slotIx_ * group_.Config().numVoices,
+                                     group_.Config().numVoices)),
+       uiDisplayCenters_(ArenaSlice(storageBatch.uiDisplayCenterArena, slotIx_ * group_.Config().numVoices,
+                                    group_.Config().numVoices)),
+       uiDisplaySpreadEnergies_(ArenaSlice(storageBatch.uiDisplaySpreadEnergyArena,
+                                           slotIx_ * group_.Config().numVoices,
+                                           group_.Config().numVoices)),
+       modulationDepths_(ArenaSlice(storageBatch.modulationDepthArena, slotIx_ * group_.Config().numModulators,
+                                    group_.Config().numModulators)),
+       sceneCenters_(ArenaSlice(storageBatch.sceneCenterArena, slotIx_ * group_.Config().numScenes,
+@@ -679,20 +720,24 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
+     std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
+     std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
+     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
+     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
+     std::fill(currentMinValues_.begin(), currentMinValues_.end(), currentCenter_);
+     std::fill(targetMinValues_.begin(), targetMinValues_.end(), currentCenter_);
+     std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), currentCenter_);
+     std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), currentCenter_);
+     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
+     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
++    for (std::size_t sourceIx = 0; sourceIx < routeSourceIndices_.size(); ++sourceIx) {
++        routeSourceIndices_[sourceIx] = sourceIx;
++        sourceRoutePositions_[sourceIx] = sourceIx;
++    }
+     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
+     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
+     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
+     std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
+     SeedCachedKnobAndUiDisplayState();
+ }
+
+ ParameterStorageBatch::~ParameterStorageBatch() = default;
+
+ void Parameter::UIState::Configure(std::size_t newVoiceCapacity, std::size_t newModulatorColorCapacity,
+@@ -754,21 +799,23 @@ Color Parameter::IndicatorColor(std::size_t voiceIx) const {
+         throw std::out_of_range("parameter indicator color index out of range");
+     }
+     return config_.indicatorColors[voiceIx];
+ }
+
+ float Parameter::GetRaw(std::size_t voiceIx) const {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     return ClampToRange(currentCenter_ * currentCenterScales_[voiceIx] + currentNormalizationOffsets_[voiceIx] +
+-                            group_.GetModulators().Apply(voiceIx, CurrentDepths(voiceIx)),
++                            group_.GetModulators().ApplyActive(
++                                voiceIx, CurrentDepthSlots(voiceIx).first(activeRouteCount_),
++                                ActiveRouteSourceIndices()),
+                         config_.range);
+ }
+
+ float Parameter::CachedKnobValue(std::size_t voiceIx) const {
+     if (voiceIx >= currentKnobValues_.size()) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     return currentKnobValues_[voiceIx];
+ }
+
+@@ -983,22 +1030,28 @@ void Parameter::ProcessLite() {
+     const float alpha = group_.Config().processLiteAlpha;
+     currentCenter_ += alpha * (targetCenter_ - currentCenter_);
+     for (std::size_t voiceIx = 0; voiceIx < currentCenterScales_.size(); ++voiceIx) {
+         currentCenterScales_[voiceIx] +=
+             alpha * (targetCenterScales_[voiceIx] - currentCenterScales_[voiceIx]);
+         currentNormalizationOffsets_[voiceIx] +=
+             alpha * (targetNormalizationOffsets_[voiceIx] - currentNormalizationOffsets_[voiceIx]);
+         currentMinValues_[voiceIx] += alpha * (targetMinValues_[voiceIx] - currentMinValues_[voiceIx]);
+         currentMaxValues_[voiceIx] += alpha * (targetMaxValues_[voiceIx] - currentMaxValues_[voiceIx]);
+     }
+-    for (std::size_t ix = 0; ix < currentDepths_.size(); ++ix) {
+-        currentDepths_[ix] += alpha * (targetDepths_[ix] - currentDepths_[ix]);
++    for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
++        for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
++            const std::size_t ix = VoiceRouteIndex(voiceIx, routeSlot);
++            currentDepths_[ix] += alpha * (targetDepths_[ix] - currentDepths_[ix]);
++            if (group_.processingObserver_ != nullptr) {
++                ++group_.processingObserver_->activeRouteVisits;
++            }
++        }
+     }
+     for (std::size_t voiceIx = 0; voiceIx < currentKnobValues_.size(); ++voiceIx) {
+         const float knob = GetRaw(voiceIx);
+         currentKnobValues_[voiceIx] = knob;
+         uiDisplayCenters_[voiceIx] += group_.Config().uiDisplayCenterAlpha * (knob - uiDisplayCenters_[voiceIx]);
+         const float residual = knob - uiDisplayCenters_[voiceIx];
+         uiDisplaySpreadEnergies_[voiceIx] +=
+             group_.Config().uiDisplaySpreadAlpha * ((residual * residual) - uiDisplaySpreadEnergies_[voiceIx]);
+     }
+ }
+@@ -1090,20 +1143,21 @@ void Parameter::RandomizeVisibleValue(const SceneState& scene, float normalized)
+
+ void Parameter::RevertToDefault(const SceneState& scene) {
+     ValidateSceneEndpoints(scene);
+     for (Parameter* depthParameter : modulationDepths_) {
+         if (depthParameter != nullptr) {
+             depthParameter->ResetModulationDepthToNeutral(scene);
+         }
+     }
+     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
+     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
++    activeRouteCount_ = 0;
+     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
+     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
+
+     const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
+     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
+     if (blend <= 0.0f) {
+         ResetSceneToDefault(scene.leftScene, defaultValue);
+     } else if (blend >= 1.0f) {
+         ResetSceneToDefault(scene.rightScene, defaultValue);
+     } else {
+@@ -1125,20 +1179,21 @@ void Parameter::RevertToDefault(const SceneState& scene) {
+ }
+
+ void Parameter::RevertAllToDefault() {
+     for (Parameter* depthParameter : modulationDepths_) {
+         if (depthParameter != nullptr) {
+             depthParameter->RevertAllToDefault();
+         }
+     }
+     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
+     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
++    activeRouteCount_ = 0;
+     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
+     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
+
+     const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
+     for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
+         ResetSceneToDefault(sceneIx, defaultValue);
+         for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
+             GestureValue(sceneIx, gestureIx) = defaultValue;
+         }
+     }
+@@ -1258,64 +1313,86 @@ void Parameter::SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, boo
+     } else {
+         gestureActiveMasks_[sceneIx] &= ~bit;
+     }
+ }
+
+ bool Parameter::GestureActive(std::size_t sceneIx, std::size_t gestureIx) const {
+     (void)SceneGestureIndex(sceneIx, gestureIx);
+     return (gestureActiveMasks_[sceneIx] & (GestureMask{1} << gestureIx)) != 0;
+ }
+
+-std::span<float> Parameter::CurrentDepths(std::size_t voiceIx) {
++std::span<float> Parameter::CurrentDepthSlots(std::size_t voiceIx) {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     if (group_.Config().numModulators == 0) {
+         return {};
+     }
+     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
+     return std::span<float>(currentDepths_.data() + rowStart, group_.Config().numModulators);
+ }
+
+-std::span<const float> Parameter::CurrentDepths(std::size_t voiceIx) const {
++std::span<const float> Parameter::CurrentDepthSlots(std::size_t voiceIx) const {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     if (group_.Config().numModulators == 0) {
+         return {};
+     }
+     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
+     return std::span<const float>(currentDepths_.data() + rowStart, group_.Config().numModulators);
+ }
+
+-std::span<float> Parameter::TargetDepths(std::size_t voiceIx) {
++std::span<float> Parameter::TargetDepthSlots(std::size_t voiceIx) {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     if (group_.Config().numModulators == 0) {
+         return {};
+     }
+     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
+     return std::span<float>(targetDepths_.data() + rowStart, group_.Config().numModulators);
+ }
+
+-std::span<const float> Parameter::TargetDepths(std::size_t voiceIx) const {
++std::span<const float> Parameter::TargetDepthSlots(std::size_t voiceIx) const {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     if (group_.Config().numModulators == 0) {
+         return {};
+     }
+     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
+     return std::span<const float>(targetDepths_.data() + rowStart, group_.Config().numModulators);
+ }
+
++float Parameter::CurrentDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const {
++    return currentDepths_[VoiceRouteIndex(voiceIx, RoutePositionForSource(sourceIx))];
++}
++
++float Parameter::TargetDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const {
++    return targetDepths_[VoiceRouteIndex(voiceIx, RoutePositionForSource(sourceIx))];
++}
++
++std::size_t Parameter::RouteSourceIndex(std::size_t slot) const {
++    if (slot >= routeSourceIndices_.size()) {
++        throw std::out_of_range("parameter route slot out of range");
++    }
++    return routeSourceIndices_[slot];
++}
++
++std::size_t Parameter::RoutePositionForSource(std::size_t sourceIx) const {
++    if (sourceIx >= sourceRoutePositions_.size()) {
++        throw std::out_of_range("parameter modulator index out of range");
++    }
++    return sourceRoutePositions_[sourceIx];
++}
++
+ float Parameter::CurrentCenterScale(std::size_t voiceIx) const {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     return currentCenterScales_[voiceIx];
+ }
+
+ float Parameter::TargetCenterScale(std::size_t voiceIx) const {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+@@ -1330,28 +1407,110 @@ float Parameter::CurrentNormalizationOffset(std::size_t voiceIx) const {
+     return currentNormalizationOffsets_[voiceIx];
+ }
+
+ float Parameter::TargetNormalizationOffset(std::size_t voiceIx) const {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     return targetNormalizationOffsets_[voiceIx];
+ }
+
+-std::size_t Parameter::VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const {
++std::size_t Parameter::VoiceRouteIndex(std::size_t voiceIx, std::size_t routeSlot) const {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+-    if (modIx >= group_.Config().numModulators) {
++    if (routeSlot >= group_.Config().numModulators) {
++        throw std::out_of_range("parameter route slot out of range");
++    }
++    return voiceIx * group_.Config().numModulators + routeSlot;
++}
++
++void Parameter::AssertRouteBijection() const {
++#ifndef NDEBUG
++    assert(activeRouteCount_ <= routeSourceIndices_.size());
++    for (std::size_t slot = 0; slot < routeSourceIndices_.size(); ++slot) {
++        assert(routeSourceIndices_[slot] < sourceRoutePositions_.size());
++        assert(sourceRoutePositions_[routeSourceIndices_[slot]] == slot);
++    }
++#endif
++}
++
++void Parameter::EnsureRouteActive(std::size_t sourceIx) {
++    if (sourceIx >= sourceRoutePositions_.size()) {
+         throw std::out_of_range("parameter modulator index out of range");
+     }
+-    return voiceIx * group_.Config().numModulators + modIx;
++    const std::size_t routeSlot = sourceRoutePositions_[sourceIx];
++    if (routeSlot < activeRouteCount_) {
++        return;
++    }
++
++    const std::size_t destination = activeRouteCount_;
++    if (routeSlot != destination) {
++        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
++            std::swap(currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
++                      currentDepths_[VoiceRouteIndex(voiceIx, destination)]);
++            std::swap(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
++                      targetDepths_[VoiceRouteIndex(voiceIx, destination)]);
++        }
++        const std::size_t displacedSource = routeSourceIndices_[destination];
++        std::swap(routeSourceIndices_[routeSlot], routeSourceIndices_[destination]);
++        sourceRoutePositions_[sourceIx] = destination;
++        sourceRoutePositions_[displacedSource] = routeSlot;
++    }
++    ++activeRouteCount_;
++    AssertRouteBijection();
++}
++
++void Parameter::RemoveActiveRoute(std::size_t routeSlot) {
++    if (routeSlot >= activeRouteCount_) {
++        throw std::out_of_range("active parameter route slot out of range");
++    }
++    const std::size_t lastActive = activeRouteCount_ - 1;
++    if (routeSlot != lastActive) {
++        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
++            std::swap(currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
++                      currentDepths_[VoiceRouteIndex(voiceIx, lastActive)]);
++            std::swap(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
++                      targetDepths_[VoiceRouteIndex(voiceIx, lastActive)]);
++        }
++        const std::size_t removedSource = routeSourceIndices_[routeSlot];
++        const std::size_t movedSource = routeSourceIndices_[lastActive];
++        std::swap(routeSourceIndices_[routeSlot], routeSourceIndices_[lastActive]);
++        sourceRoutePositions_[movedSource] = routeSlot;
++        sourceRoutePositions_[removedSource] = lastActive;
++    }
++    --activeRouteCount_;
++    AssertRouteBijection();
++}
++
++bool Parameter::RouteNeutralAcrossVoices(std::size_t routeSlot) const {
++    constexpr float tolerance = 0.000001f;
++    for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
++        if (std::fabs(currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)]) > tolerance ||
++            std::fabs(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)]) > tolerance) {
++            return false;
++        }
++    }
++    return true;
++}
++
++void Parameter::PruneNeutralActiveRoutes() {
++    for (std::size_t routeSlot = activeRouteCount_; routeSlot-- > 0;) {
++        if (!RouteNeutralAcrossVoices(routeSlot)) {
++            continue;
++        }
++        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
++            currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)] = 0.0f;
++            targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)] = 0.0f;
++        }
++        RemoveActiveRoute(routeSlot);
++    }
+ }
+
+ std::size_t Parameter::SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const {
+     if (sceneIx >= group_.Config().numScenes) {
+         throw std::out_of_range("parameter scene index out of range");
+     }
+     if (gestureIx >= group_.GestureCount()) {
+         throw std::out_of_range("parameter gesture index out of range");
+     }
+     return sceneIx * group_.GestureCount() + gestureIx;
+@@ -1402,20 +1561,21 @@ void Parameter::ResetModulationDepthToNeutral(const SceneState& scene) {
+     std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
+     std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
+     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
+     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
+     std::fill(currentMinValues_.begin(), currentMinValues_.end(), neutralDepth);
+     std::fill(targetMinValues_.begin(), targetMinValues_.end(), neutralDepth);
+     std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), neutralDepth);
+     std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), neutralDepth);
+     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
+     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
++    activeRouteCount_ = 0;
+     SeedCachedKnobAndUiDisplayState();
+ }
+
+ float Parameter::ComputeRawCenter(const SceneState& scene) const {
+     ValidateSceneEndpoints(scene);
+     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
+     const float inverseBlend = 1.0f - blend;
+     const float base = SceneCenter(scene.leftScene) * inverseBlend + SceneCenter(scene.rightScene) * blend;
+
+     float weightedMixSum = 0.0f;
+@@ -1458,81 +1618,115 @@ void Parameter::ComputeAtDepth(const SceneState& scene, std::size_t recursionDep
+     } else {
+         targetCenter_ = rawCenter;
+     }
+
+     for (Parameter* depthParameter : modulationDepths_) {
+         if (depthParameter != nullptr) {
+             depthParameter->ComputeAtDepth(scene, recursionDepth_ + 1, smoothTargetCenter);
+         }
+     }
+
++    constexpr float neutralTolerance = 0.000001f;
++    for (std::size_t sourceIx = 0; sourceIx < group_.Config().numModulators; ++sourceIx) {
++        const Parameter* depthParameter = modulationDepths_[sourceIx];
++        bool targetNonNeutral = false;
++        if (depthParameter != nullptr) {
++            for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
++                if (std::fabs(ModulationDepthTargetFromKnob(depthParameter->GetRaw(voiceIx))) >
++                    neutralTolerance) {
++                    targetNonNeutral = true;
++                    break;
++                }
++            }
++        }
++
++        const std::size_t oldRouteSlot = sourceRoutePositions_[sourceIx];
++        bool currentNonNeutral = false;
++        if (oldRouteSlot < activeRouteCount_) {
++            for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
++                if (std::fabs(currentDepths_[VoiceRouteIndex(voiceIx, oldRouteSlot)]) > neutralTolerance) {
++                    currentNonNeutral = true;
++                    break;
++                }
++            }
++        }
++        if (targetNonNeutral || currentNonNeutral) {
++            EnsureRouteActive(sourceIx);
++        }
++
++        const std::size_t routeSlot = sourceRoutePositions_[sourceIx];
++        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
++            targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)] =
++                depthParameter == nullptr ? 0.0f
++                                          : ModulationDepthTargetFromKnob(depthParameter->GetRaw(voiceIx));
++        }
++    }
++
+     for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+         float weightSum = 0.0f;
+-        for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
+-            const Parameter* depthParameter = modulationDepths_[modIx];
+-            const float depth =
+-                depthParameter == nullptr ? 0.0f : ModulationDepthTargetFromKnob(depthParameter->GetRaw(voiceIx));
+-            targetDepths_[VoiceModIndex(voiceIx, modIx)] = depth;
+-            weightSum += std::fabs(depth);
++        for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
++            weightSum += std::fabs(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)]);
+         }
+
+         if (weightSum < 1.0f) {
+             targetCenterScales_[voiceIx] = 1.0f - weightSum;
+         } else {
+             targetCenterScales_[voiceIx] = 0.0f;
+-            for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
+-                targetDepths_[VoiceModIndex(voiceIx, modIx)] /= weightSum;
++            for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
++                targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)] /= weightSum;
+             }
+         }
+
+         float normalizationOffset = 0.0f;
+-        for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
+-            normalizationOffset -= std::min(0.0f, targetDepths_[VoiceModIndex(voiceIx, modIx)]);
++        for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
++            normalizationOffset -= std::min(0.0f, targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)]);
+         }
+         targetNormalizationOffsets_[voiceIx] = normalizationOffset;
+
+         if (weightSum > 1.0f) {
+             targetMinValues_[voiceIx] = RangeMin(config_.range);
+             targetMaxValues_[voiceIx] = RangeMax(config_.range);
+         } else {
+             float minContribution = 0.0f;
+             float maxContribution = 0.0f;
+-            for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
+-                const float depth = targetDepths_[VoiceModIndex(voiceIx, modIx)];
++            for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
++                const float depth = targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)];
+                 minContribution += std::min(0.0f, depth);
+                 maxContribution += std::max(0.0f, depth);
+             }
+             const float base = targetCenter_ * targetCenterScales_[voiceIx] + targetNormalizationOffsets_[voiceIx];
+             targetMinValues_[voiceIx] = ClampToRange(base + minContribution, config_.range);
+             targetMaxValues_[voiceIx] = ClampToRange(base + maxContribution, config_.range);
+         }
+     }
+
+     if (recursionDepth_ > 0) {
+         currentCenter_ = targetCenter_;
+         std::copy(targetCenterScales_.begin(), targetCenterScales_.end(), currentCenterScales_.begin());
+         std::copy(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(),
+                   currentNormalizationOffsets_.begin());
+         std::copy(targetMinValues_.begin(), targetMinValues_.end(), currentMinValues_.begin());
+         std::copy(targetMaxValues_.begin(), targetMaxValues_.end(), currentMaxValues_.begin());
+         std::copy(targetDepths_.begin(), targetDepths_.end(), currentDepths_.begin());
+         SeedCachedKnobAndUiDisplayState();
+     }
++    PruneNeutralActiveRoutes();
+ }
+
+ void Parameter::SnapCurrentToTarget() {
+     currentCenter_ = targetCenter_;
+     std::copy(targetCenterScales_.begin(), targetCenterScales_.end(), currentCenterScales_.begin());
+     std::copy(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), currentNormalizationOffsets_.begin());
+     std::copy(targetMinValues_.begin(), targetMinValues_.end(), currentMinValues_.begin());
+     std::copy(targetMaxValues_.begin(), targetMaxValues_.end(), currentMaxValues_.begin());
+     std::copy(targetDepths_.begin(), targetDepths_.end(), currentDepths_.begin());
++    PruneNeutralActiveRoutes();
+     SeedCachedKnobAndUiDisplayState();
+     for (Parameter* depthParameter : modulationDepths_) {
+         if (depthParameter != nullptr) {
+             depthParameter->SnapCurrentToTarget();
+         }
+     }
+ }
+
+ void Parameter::SeedCachedKnobAndUiDisplayState() {
+     for (std::size_t voiceIx = 0; voiceIx < currentKnobValues_.size(); ++voiceIx) {
+@@ -1553,21 +1747,23 @@ bool Parameter::WouldCreateCycle(const Parameter* candidate) const {
+         }
+     }
+     return false;
+ }
+
+ float Parameter::TargetValue(std::size_t voiceIx) const {
+     if (voiceIx >= group_.Config().numVoices) {
+         throw std::out_of_range("parameter voice index out of range");
+     }
+     return ClampToRange(targetCenter_ * targetCenterScales_[voiceIx] + targetNormalizationOffsets_[voiceIx] +
+-                            group_.GetModulators().Apply(voiceIx, TargetDepths(voiceIx)),
++                            group_.GetModulators().ApplyActive(
++                                voiceIx, TargetDepthSlots(voiceIx).first(activeRouteCount_),
++                                ActiveRouteSourceIndices()),
+                         config_.range);
+ }
+
+ std::uint32_t Parameter::ModulatorsAffectingMask() const {
+     std::uint32_t mask = 0;
+     const std::size_t count = std::min<std::size_t>(modulationDepths_.size(), 32);
+     for (std::size_t modIx = 0; modIx < count; ++modIx) {
+         if (modulationDepths_[modIx] != nullptr && modulationDepths_[modIx]->HasNonZeroState()) {
+             mask |= (std::uint32_t{1} << modIx);
+         }
+diff --git a/projects/synth/tests/module_tests.cpp b/projects/synth/tests/module_tests.cpp
+index e6a73de1..4295c7bc 100644
+--- a/projects/synth/tests/module_tests.cpp
++++ b/projects/synth/tests/module_tests.cpp
+@@ -1467,40 +1467,46 @@ TEST_CASE(demo_modulation_process_parameters_applies_direct_vco_modulation) {
+     constexpr float tolerance = 0.0001f;
+
+     synth::ParameterManager manager;
+     auto& group = manager.CreateGroup({
+         .numVoices = 2,
+         .numModulators = 3,
+         .numScenes = 1,
+         .maxParameters = 4,
+         .processLiteAlpha = 1.0f,
+     });
++    synth::ParameterProcessingObserver work;
++    group.SetProcessingObserverForTests(&work);
+     auto& phase = manager.CreateParameter(group, {.name = "Phase", .defaultValue = 0.0f});
+     auto& directDepth = manager.CreateParameter(group, {
+         .name = "Phase Direct Depth",
+         .defaultValue = 1.0f,
+     });
+     REQUIRE_TRUE(phase.AssignModulationDepth(0, &directDepth));
+     phase.Compute(manager.Scene());
+     directDepth.Compute(manager.Scene());
+
+     group.GetModulators().Value(0, 0) = 0.0f;
+     group.GetModulators().Value(1, 0) = 1.0f;
+     synth_miniapp::ProcessParameters(group, /*sampleIndex=*/0);
+     REQUIRE_NEAR(phase.GetRaw(0), 0.0f, tolerance);
+     REQUIRE_NEAR(phase.GetRaw(1), 1.0f, tolerance);
++    REQUIRE_TRUE(phase.ActiveRouteCount() == 1);
++    REQUIRE_TRUE(phase.ActiveRouteSourceIndices()[0] == 0);
++    REQUIRE_TRUE(work.activeRouteVisits == 2);
+
+     group.GetModulators().Value(0, 0) = 1.0f;
+     group.GetModulators().Value(1, 0) = 0.0f;
+     synth_miniapp::ProcessParameters(group, /*sampleIndex=*/1);
+     REQUIRE_NEAR(phase.GetRaw(0), 1.0f, tolerance);
+     REQUIRE_NEAR(phase.GetRaw(1), 0.0f, tolerance);
++    REQUIRE_TRUE(work.activeRouteVisits == 4);
+ }
+
+ int main() {
+     int failed = 0;
+     for (const auto& test : Registry()) {
+         try {
+             test.fn();
+             std::cout << "[PASS] " << test.name << "\n";
+         } catch (const std::exception& ex) {
+             ++failed;
+diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
+index 1133fe03..c5aac2c8 100644
+--- a/projects/synth/tests/parameter_modulation_tests.cpp
++++ b/projects/synth/tests/parameter_modulation_tests.cpp
+@@ -79,20 +79,22 @@ struct TestVisualizer final : synth::ui::Visualizer {
+ };
+
+ std::string JsonToString(synth::JSON json) {
+     char* dumped = json.Dumps(JSON_ENCODE_ANY);
+     REQUIRE_TRUE(dumped != nullptr);
+     std::string text(dumped);
+     std::free(dumped);
+     return text;
+ }
+
++void RequireRouteBijection(const synth::Parameter& parameter, std::size_t sourceCount);
++
+ // Wraps a single WrldBldr-kind MidiControllerProfileConfig (as produced by
+ // WrldBldrDefaultProfileConfig, whose system-message associations always
+ // carry both a control address and a wrldBldrPosition -- see
+ // SlotValidForKind's WrldBldr branch) plus a pair of endpoint identifiers
+ // into a one-controller MidiInstrumentConfig, for patch-persistence tests
+ // that used to build a bare MidiControllerProfileConfig + MidiEndpointState
+ // pair directly. Named "controller" to match MidiControllerSlot's default
+ // name so assertions reading loaded.controllers[0] read naturally.
+ synth::MidiInstrumentConfig MakeInstrumentFromProfile(const synth::MidiControllerProfileConfig& profile,
+                                                        std::string_view inputIdentifier = "",
+@@ -326,41 +328,41 @@ TEST_CASE(parameter_group_timing_reconfiguration_preserves_topology_values_and_p
+     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.25f});
+     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
+     REQUIRE_TRUE(depth != nullptr);
+     carrier.SceneCenter(1) = 0.75f;
+     depth->SceneCenter(0) = 0.5f;
+     manager.ComputeAllTargets();
+     carrier.ProcessLite();
+
+     synth::Parameter* const carrierPointer = &carrier;
+     synth::Parameter* const depthPointer = depth;
+-    float* const currentDepthPointer = carrier.CurrentDepths(0).data();
++    float* const currentDepthPointer = carrier.CurrentDepthSlots(0).data();
+     const float currentCenter = carrier.CurrentCenter();
+-    const float currentDepth = carrier.CurrentDepths(0)[0];
++    const float currentDepth = carrier.CurrentDepthForSource(0, 0);
+     const float sceneValue = carrier.SceneCenter(1);
+
+     group.ConfigureProcessingTiming({
+         .processLiteAlpha = 0.125f,
+         .targetComputeIntervalSamples = 64,
+         .uiDisplayCenterAlpha = 0.25f,
+         .uiDisplaySpreadAlpha = 0.5f,
+     });
+
+     REQUIRE_TRUE(&group.ParameterByLocalIndex(0) == carrierPointer);
+     REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depthPointer);
+-    REQUIRE_TRUE(carrier.CurrentDepths(0).data() == currentDepthPointer);
++    REQUIRE_TRUE(carrier.CurrentDepthSlots(0).data() == currentDepthPointer);
+     REQUIRE_TRUE(group.Config().numVoices == 2);
+     REQUIRE_TRUE(group.Config().numModulators == 1);
+     REQUIRE_TRUE(group.Config().numScenes == 2);
+     REQUIRE_TRUE(group.Config().maxParameters == 4);
+     REQUIRE_NEAR(carrier.CurrentCenter(), currentCenter, 0.0001f);
+-    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], currentDepth, 0.0001f);
++    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), currentDepth, 0.0001f);
+     REQUIRE_NEAR(carrier.SceneCenter(1), sceneValue, 0.0001f);
+     REQUIRE_NEAR(group.Config().processLiteAlpha, 0.125f, 0.0001f);
+     REQUIRE_TRUE(group.Config().targetComputeIntervalSamples == 64);
+     REQUIRE_NEAR(group.Config().uiDisplayCenterAlpha, 0.25f, 0.0001f);
+     REQUIRE_NEAR(group.Config().uiDisplaySpreadAlpha, 0.5f, 0.0001f);
+ }
+
+ TEST_CASE(parameter_group_timing_reconfiguration_is_non_compounding) {
+     synth::ParameterManager manager;
+     auto& group = manager.CreateGroup({
+@@ -1046,22 +1048,22 @@ TEST_CASE(parameter_default_state) {
+     REQUIRE_TRUE(&parameter.Group() == &group);
+     REQUIRE_NEAR(parameter.SceneCenter(0), 0.3f, 0.0001f);
+     REQUIRE_NEAR(parameter.SceneCenter(1), 0.3f, 0.0001f);
+     REQUIRE_NEAR(parameter.CurrentCenter(), 0.3f, 0.0001f);
+     REQUIRE_NEAR(parameter.TargetCenter(), 0.3f, 0.0001f);
+     REQUIRE_NEAR(parameter.CurrentCenterScale(0), 1.0f, 0.0001f);
+     REQUIRE_NEAR(parameter.TargetCenterScale(1), 1.0f, 0.0001f);
+     REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == nullptr);
+     REQUIRE_TRUE(!parameter.GestureActive(0, 0));
+     REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.3f, 0.0001f);
+-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.0f, 0.0001f);
+-    REQUIRE_NEAR(parameter.TargetDepths(1)[1], 0.0f, 0.0001f);
++    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), 0.0f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(1, 1), 0.0f, 0.0001f);
+ }
+
+ TEST_CASE(bipolar_parameter_core_stores_normalized_center) {
+     synth::ParameterManager manager;
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 0,
+         .numScenes = 2,
+         .maxParameters = 1,
+         .processLiteAlpha = 1.0f,
+@@ -1240,21 +1242,21 @@ TEST_CASE(modulation_normalization_under_one) {
+         .maxParameters = 2,
+     });
+
+     auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
+     auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.75f});
+     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
+
+     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
+
+     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.75f, 0.0001f);
+-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.25f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.25f, 0.0001f);
+ }
+
+ TEST_CASE(modulation_normalization_over_one_preserves_sign) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(2);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 2,
+         .numScenes = 1,
+         .maxParameters = 3,
+@@ -1270,22 +1272,22 @@ TEST_CASE(modulation_normalization_over_one_preserves_sign) {
+         .name = "Negative",
+         .defaultValue = 0.0f,
+         .range = synth::RangeKind::Bipolar,
+     });
+     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
+     REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));
+
+     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
+
+     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.0f, 0.0001f);
+-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.5f, 0.0001f);
+-    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.5f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.5f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 1), -0.5f, 0.0001f);
+ }
+
+ TEST_CASE(negative_modulation_depths_add_normalization_offset) {
+     synth::ParameterManager manager;
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 2,
+         .numScenes = 1,
+         .maxParameters = 3,
+         .processLiteAlpha = 1.0f,
+@@ -1304,22 +1306,22 @@ TEST_CASE(negative_modulation_depths_add_normalization_offset) {
+         .range = synth::RangeKind::Bipolar,
+     });
+     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
+     REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));
+
+     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
+     parameter.ProcessLite();
+
+     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.5f, 0.0001f);
+     REQUIRE_NEAR(parameter.TargetNormalizationOffset(0), 0.25f, 0.0001f);
+-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.25f, 0.0001f);
+-    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.25f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.25f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 1), -0.25f, 0.0001f);
+
+     group.GetModulators().Value(0, 0) = 0.0f;
+     group.GetModulators().Value(0, 1) = 0.0f;
+     REQUIRE_NEAR(parameter.GetRaw(0), 0.5f, 0.0001f);
+
+     group.GetModulators().Value(0, 0) = 1.0f;
+     group.GetModulators().Value(0, 1) = 0.0f;
+     REQUIRE_NEAR(parameter.GetRaw(0), 0.75f, 0.0001f);
+
+     group.GetModulators().Value(0, 0) = 0.0f;
+@@ -1350,22 +1352,22 @@ TEST_CASE(overfull_negative_modulation_offset_uses_normalized_depths) {
+         .range = synth::RangeKind::Bipolar,
+     });
+     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
+     REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));
+
+     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
+     parameter.ProcessLite();
+
+     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.0f, 0.0001f);
+     REQUIRE_NEAR(parameter.TargetNormalizationOffset(0), 0.5f, 0.0001f);
+-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.5f, 0.0001f);
+-    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.5f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.5f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 1), -0.5f, 0.0001f);
+
+     group.GetModulators().Value(0, 0) = 0.0f;
+     group.GetModulators().Value(0, 1) = 0.0f;
+     REQUIRE_NEAR(parameter.GetRaw(0), 0.5f, 0.0001f);
+
+     group.GetModulators().Value(0, 0) = 1.0f;
+     group.GetModulators().Value(0, 1) = 0.0f;
+     REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 0.0001f);
+
+     group.GetModulators().Value(0, 0) = 0.0f;
+@@ -1395,21 +1397,21 @@ TEST_CASE(recursive_modulation_depth_targets_use_bipolar_zero_based_exponential_
+         {.knob = 0.25f, .expectedDepth = -0.25f},
+         {.knob = 0.5f, .expectedDepth = 0.0f},
+         {.knob = 0.75f, .expectedDepth = 0.25f},
+         {.knob = 1.0f, .expectedDepth = 1.0f},
+     }};
+
+     for (const Case& testCase : cases) {
+         depth->SceneCenter(0) = testCase.knob;
+         carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
+         REQUIRE_NEAR(depth->GetRaw(0), testCase.knob, 0.0001f);
+-        REQUIRE_NEAR(carrier.TargetDepths(0)[0], testCase.expectedDepth, 0.0001f);
++        REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), testCase.expectedDepth, 0.0001f);
+     }
+ }
+
+ TEST_CASE(recursive_modulation_depth_compute_ignores_target_center_smoothing_for_parent_reads) {
+     synth::ParameterManager manager;
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 1,
+         .maxParameters = 2,
+@@ -1419,40 +1421,40 @@ TEST_CASE(recursive_modulation_depth_compute_ignores_target_center_smoothing_for
+     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
+     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
+     REQUIRE_TRUE(depth != nullptr);
+
+     depth->SceneCenter(0) = 1.0f;
+     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
+
+     REQUIRE_NEAR(depth->TargetCenter(), 1.0f, 0.0001f);
+     REQUIRE_NEAR(depth->CurrentCenter(), 1.0f, 0.0001f);
+     REQUIRE_NEAR(depth->GetRaw(0), 1.0f, 0.0001f);
+-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 1.0f, 0.0001f);
++    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 1.0f, 0.0001f);
+ }
+
+ TEST_CASE(recursive_modulation_depth_three_quarter_turn_sets_quarter_raw_depth_before_normalization) {
+     synth::ParameterManager manager;
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 1,
+         .maxParameters = 2,
+     });
+
+     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
+     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
+     REQUIRE_TRUE(depth != nullptr);
+     depth->SceneCenter(0) = 0.75f;
+
+     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
+
+-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.25f, 0.0001f);
++    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.25f, 0.0001f);
+     REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.75f, 0.0001f);
+     REQUIRE_NEAR(carrier.TargetNormalizationOffset(0), 0.0f, 0.0001f);
+ }
+
+ TEST_CASE(curved_modulation_depth_targets_still_use_signed_normalization) {
+     synth::ParameterManager manager;
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 2,
+         .numScenes = 1,
+@@ -1467,22 +1469,22 @@ TEST_CASE(curved_modulation_depth_targets_still_use_signed_normalization) {
+     REQUIRE_TRUE(positive != nullptr);
+     REQUIRE_TRUE(negative != nullptr);
+     positive->SceneCenter(0) = 1.0f;
+     negative->SceneCenter(0) = 0.0f;
+
+     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
+     carrier.ProcessLite();
+
+     REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.0f, 0.0001f);
+     REQUIRE_NEAR(carrier.TargetNormalizationOffset(0), 0.5f, 0.0001f);
+-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.5f, 0.0001f);
+-    REQUIRE_NEAR(carrier.TargetDepths(0)[1], -0.5f, 0.0001f);
++    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.5f, 0.0001f);
++    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 1), -0.5f, 0.0001f);
+ }
+
+ TEST_CASE(curved_modulation_depth_targets_keep_modulator_dot_product_linear) {
+     synth::ParameterManager manager;
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 1,
+         .maxParameters = 2,
+         .processLiteAlpha = 1.0f,
+@@ -1491,21 +1493,21 @@ TEST_CASE(curved_modulation_depth_targets_keep_modulator_dot_product_linear) {
+
+     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.0f});
+     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
+     REQUIRE_TRUE(depth != nullptr);
+     depth->SceneCenter(0) = 0.75f;
+
+     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
+     carrier.ProcessLite();
+
+     group.GetModulators().Value(0, 0) = 0.8f;
+-    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], 0.25f, 0.0001f);
++    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), 0.25f, 0.0001f);
+     REQUIRE_NEAR(carrier.GetRaw(0), 0.2f, 0.0001f);
+ }
+
+ TEST_CASE(parameter_get_raw_includes_normalization_offset) {
+     synth::ParameterManager manager;
+     synth::ParameterGroupConfig config{
+         .numVoices = 1,
+         .numModulators = 2,
+         .numScenes = 1,
+         .maxParameters = 8,
+@@ -1617,21 +1619,21 @@ TEST_CASE(nested_depth_route_reads_get_and_bypasses_slew) {
+     auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.0f});
+     depth.SceneCenter(0) = 0.8f;
+     depth.SceneCenter(1) = 0.8f;
+     REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depth));
+
+     carrier.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.0f});
+
+     REQUIRE_TRUE(depth.RecursionDepth() == 1);
+     REQUIRE_NEAR(depth.CurrentCenter(), 0.8f, 0.0001f);
+     REQUIRE_NEAR(depth.GetRaw(0), 0.8f, 0.0001f);
+-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.3421493f, 0.0001f);
++    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.3421493f, 0.0001f);
+     REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.6578507f, 0.0001f);
+ }
+
+ TEST_CASE(process_lite_slews_center_scale_offset_and_depths) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(2);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 2,
+@@ -1649,21 +1651,21 @@ TEST_CASE(process_lite_slews_center_scale_offset_and_depths) {
+     parameter.SceneCenter(0) = 1.0f;
+     parameter.SceneCenter(1) = 1.0f;
+     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
+
+     parameter.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.0f});
+     parameter.ProcessLite();
+
+     REQUIRE_NEAR(parameter.CurrentCenter(), 0.25f, 0.0001f);
+     REQUIRE_NEAR(parameter.CurrentCenterScale(0), 0.9375f, 0.0001f);
+     REQUIRE_NEAR(parameter.CurrentNormalizationOffset(0), 0.0625f, 0.0001f);
+-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], -0.0625f, 0.0001f);
++    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), -0.0625f, 0.0001f);
+
+     synth::Parameter::UIState ui(1);
+     parameter.PopulateUIState(ui);
+     REQUIRE_NEAR(ui.minValues[0].load(), 0.1875f, 0.0001f);
+     REQUIRE_NEAR(ui.maxValues[0].load(), 0.25f, 0.0001f);
+ }
+
+ TEST_CASE(process_lite_samples_cached_knob_after_slew) {
+     synth::ParameterManager manager;
+     synth::ParameterGroupConfig config{
+@@ -1750,21 +1752,21 @@ TEST_CASE(parameter_group_process_sample_covers_top_level_and_modulation_depth_t
+
+     carrier.SceneCenter(0) = 0.2f;
+     sibling.SceneCenter(0) = 0.4f;
+     depth->SceneCenter(0) = 0.75f;
+
+     group.ProcessSample(0);
+
+     REQUIRE_NEAR(carrier.TargetCenter(), 0.2f, 0.0001f);
+     REQUIRE_NEAR(sibling.TargetCenter(), 0.4f, 0.0001f);
+     REQUIRE_NEAR(depth->TargetCenter(), 0.75f, 0.0001f);
+-    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], 0.25f, 0.0001f);
++    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), 0.25f, 0.0001f);
+ }
+
+ TEST_CASE(group_process_sample_visits_only_registered_roots) {
+     synth::ParameterManager manager;
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 2,
+         .numScenes = 1,
+         .maxParameters = 8,
+         .targetComputeIntervalSamples = 16,
+@@ -2254,26 +2256,28 @@ TEST_CASE(modulation_depth_assignment_rejects_cross_group_routes) {
+     REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+ }
+
+ TEST_CASE(get_clamps_and_rejects_out_of_range_voice) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(2);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 1,
+-        .maxParameters = 1,
++        .maxParameters = 2,
+     });
+     auto& parameter = manager.CreateParameter(group, {.name = "Clamp", .defaultValue = 1.0f});
++    auto* depth = parameter.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    depth->SceneCenter(0) = 1.0f;
+     group.GetModulators().Value(0, 0) = 1.0f;
+-    parameter.TargetDepths(0)[0] = 1.0f;
+-    parameter.ProcessLite();
++    manager.ComputeAllParameters();
+
+     REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 0.0001f);
+
+     bool threw = false;
+     try {
+         (void)parameter.GetRaw(1);
+     } catch (const std::out_of_range&) {
+         threw = true;
+     }
+     REQUIRE_TRUE(threw);
+@@ -3008,22 +3012,22 @@ TEST_CASE(revert_to_default_clears_modulation_and_gestures) {
+     parameter.Compute(scene);
+     parameter.ProcessLite();
+
+     REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == &depth);
+     REQUIRE_NEAR(depth.SceneCenter(0), 0.5f, 0.0001f);
+     REQUIRE_NEAR(depth.SceneCenter(1), 0.5f, 0.0001f);
+     REQUIRE_NEAR(parameter.SceneCenter(0), 0.4f, 0.0001f);
+     REQUIRE_NEAR(parameter.SceneCenter(1), 0.4f, 0.0001f);
+     REQUIRE_TRUE(!parameter.GestureActive(0, 0));
+     REQUIRE_TRUE(!parameter.GestureActive(1, 0));
+-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.0f, 0.0001f);
+-    REQUIRE_NEAR(parameter.TargetDepths(1)[0], 0.0f, 0.0001f);
++    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), 0.0f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(1, 0), 0.0f, 0.0001f);
+     REQUIRE_NEAR(parameter.CurrentCenter(), 0.4f, 0.0001f);
+     REQUIRE_NEAR(parameter.TargetCenter(), 0.4f, 0.0001f);
+     REQUIRE_NEAR(parameter.CurrentCenterScale(0), 1.0f, 0.0001f);
+     REQUIRE_NEAR(parameter.TargetCenterScale(1), 1.0f, 0.0001f);
+     REQUIRE_NEAR(parameter.GetRaw(0), 0.4f, 0.0001f);
+     REQUIRE_NEAR(parameter.GetRaw(1), 0.4f, 0.0001f);
+ }
+
+ TEST_CASE(revert_to_default_rejects_invalid_scene_without_mutation) {
+     synth::ParameterManager manager;
+@@ -3032,36 +3036,39 @@ TEST_CASE(revert_to_default_rejects_invalid_scene_without_mutation) {
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 1,
+         .maxParameters = 2,
+     });
+     auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+     auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.5f});
+     parameter.SceneCenter(0) = 0.9f;
+     parameter.SetGestureActive(0, 0, true);
+     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
+-    parameter.TargetDepths(0)[0] = 0.75f;
+-    parameter.CurrentDepths(0)[0] = 0.5f;
++    depth.SceneCenter(0) = 0.75f;
++    manager.ComputeAllParameters();
++    const std::size_t routeSlot = parameter.RoutePositionForSource(0);
++    parameter.TargetDepthSlots(0)[routeSlot] = 0.75f;
++    parameter.CurrentDepthSlots(0)[routeSlot] = 0.5f;
+
+     bool threw = false;
+     try {
+         parameter.RevertToDefault({.leftScene = 3, .rightScene = 0, .blend = 0.0f});
+     } catch (const std::out_of_range&) {
+         threw = true;
+     }
+
+     REQUIRE_TRUE(threw);
+     REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == &depth);
+     REQUIRE_NEAR(parameter.SceneCenter(0), 0.9f, 0.0001f);
+     REQUIRE_TRUE(parameter.GestureActive(0, 0));
+-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.75f, 0.0001f);
+-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.5f, 0.0001f);
++    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.75f, 0.0001f);
++    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), 0.5f, 0.0001f);
+ }
+
+ TEST_CASE(page_routing_changes_without_mutating_parameter_state) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(2);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 2,
+         .maxParameters = 2,
+@@ -7044,42 +7051,67 @@ void SimCheck(const SimOracle& oracle, const std::array<synth::Parameter*, kSimP
+             const synth::Parameter* expectedRoute = route < 0 ? nullptr : params[static_cast<std::size_t>(route)];
+             if (actual.ModulationDepthParameter(modIx) != expectedRoute) {
+                 SimFailBool(seed, step, action,
+                             SimParamField(actual, paramIx, "modIx=" + std::to_string(modIx) + " route"));
+             }
+         }
+         SimCheckNear(seed, step, action, SimParamField(actual, paramIx, "target center"), expected.targetCenter,
+                      actual.TargetCenter());
+         SimCheckNear(seed, step, action, SimParamField(actual, paramIx, "current center"), expected.currentCenter,
+                      actual.CurrentCenter());
++        RequireRouteBijection(actual, kSimMods);
++        std::array<bool, kSimMods> expectedActiveRoutes{};
++        std::size_t expectedActiveRouteCount = 0;
++        for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
++            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
++                if (std::fabs(expected.targetDepth[voiceIx][modIx]) > 0.000001f ||
++                    std::fabs(expected.currentDepth[voiceIx][modIx]) > 0.000001f) {
++                    expectedActiveRoutes[modIx] = true;
++                    break;
++                }
++            }
++            expectedActiveRouteCount += expectedActiveRoutes[modIx] ? 1 : 0;
++        }
++        if (actual.ActiveRouteCount() != expectedActiveRouteCount) {
++            SimFail(seed, step, action, SimParamField(actual, paramIx, "active route count"),
++                    static_cast<float>(expectedActiveRouteCount), static_cast<float>(actual.ActiveRouteCount()));
++        }
++        for (std::size_t routeSlot = 0; routeSlot < actual.ActiveRouteCount(); ++routeSlot) {
++            const std::size_t sourceIx = actual.RouteSourceIndex(routeSlot);
++            if (!expectedActiveRoutes[sourceIx]) {
++                SimFailBool(seed, step, action,
++                            SimParamField(actual, paramIx,
++                                          "active route prefix sourceIx=" + std::to_string(sourceIx)));
++            }
++        }
+         for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+             const std::string voiceField = "voiceIx=" + std::to_string(voiceIx);
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " target center scale"),
+                          expected.targetCenterScale[voiceIx],
+                          actual.TargetCenterScale(voiceIx));
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " current center scale"),
+                          expected.currentCenterScale[voiceIx],
+                          actual.CurrentCenterScale(voiceIx));
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " target normalization offset"),
+                          expected.targetNormalizationOffset[voiceIx],
+                          actual.TargetNormalizationOffset(voiceIx));
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " current normalization offset"),
+                          expected.currentNormalizationOffset[voiceIx],
+                          actual.CurrentNormalizationOffset(voiceIx));
+             for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
+                 const std::string modField = voiceField + " modIx=" + std::to_string(modIx);
+                 SimCheckNear(seed, step, action, SimParamField(actual, paramIx, modField + " target depth"),
+                              expected.targetDepth[voiceIx][modIx],
+-                             actual.TargetDepths(voiceIx)[modIx]);
++                             actual.TargetDepthForSource(voiceIx, modIx));
+                 SimCheckNear(seed, step, action, SimParamField(actual, paramIx, modField + " current depth"),
+                              expected.currentDepth[voiceIx][modIx],
+-                             actual.CurrentDepths(voiceIx)[modIx]);
++                             actual.CurrentDepthForSource(voiceIx, modIx));
+             }
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " raw"),
+                          SimGetRaw(oracle, paramIx, voiceIx), actual.GetRaw(voiceIx));
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " cached knob"),
+                          expected.cachedKnob[voiceIx], actual.CachedKnobValue(voiceIx));
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " ui display center"),
+                          expected.uiDisplayCenter[voiceIx], actual.UIDisplayCenter(voiceIx));
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " ui display spread"),
+                          std::sqrt(std::max(0.0f, expected.uiDisplaySpreadEnergy[voiceIx])),
+                          actual.UIDisplaySpread(voiceIx));
+@@ -8625,26 +8657,26 @@ TEST_CASE(randomized_recursive_modulation_ui_tree_round_trips_into_fresh_initial
+                 return true;
+             }
+             for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
+                 if (std::fabs(parameter.GestureValue(sceneIx, gestureIx) - defaultValue) > tolerance ||
+                     parameter.GestureActive(sceneIx, gestureIx)) {
+                     return true;
+                 }
+             }
+         }
+         for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+-            for (const float depth : parameter.CurrentDepths(voiceIx)) {
++            for (const float depth : parameter.CurrentDepthSlots(voiceIx)) {
+                 if (std::fabs(depth) > tolerance) {
+                     return true;
+                 }
+             }
+-            for (const float depth : parameter.TargetDepths(voiceIx)) {
++            for (const float depth : parameter.TargetDepthSlots(voiceIx)) {
+                 if (std::fabs(depth) > tolerance) {
+                     return true;
+                 }
+             }
+             if (std::fabs(parameter.CurrentCenterScale(voiceIx) - 1.0f) > tolerance ||
+                 std::fabs(parameter.TargetCenterScale(voiceIx) - 1.0f) > tolerance ||
+                 std::fabs(parameter.CurrentNormalizationOffset(voiceIx)) > tolerance ||
+                 std::fabs(parameter.TargetNormalizationOffset(voiceIx)) > tolerance) {
+                 return true;
+             }
+@@ -10750,20 +10782,243 @@ TEST_CASE(compute_all_targets_preserves_process_lite_slew) {
+     const float afterOneSlew = parameter.GetRaw(0);
+     REQUIRE_TRUE(afterOneSlew > 0.0f);
+     REQUIRE_TRUE(afterOneSlew < 1.0f);        // approaching, not jumped
+
+     manager.ComputeAllParameters();           // existing API still snaps
+     REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 1e-4f);
+ }
+
+ namespace {
+
++float FullScanApply(const synth::Modulators& modulators, std::size_t voiceIx,
++                    std::span<const float> depthsBySource) {
++    float sum = 0.0f;
++    for (std::size_t sourceIx = 0; sourceIx < depthsBySource.size(); ++sourceIx) {
++        sum += modulators.Value(voiceIx, sourceIx) * depthsBySource[sourceIx];
++    }
++    return sum;
++}
++
++void RequireRouteBijection(const synth::Parameter& parameter, std::size_t sourceCount) {
++    const auto sources = parameter.ActiveRouteSourceIndices();
++    REQUIRE_TRUE(sources.size() == parameter.ActiveRouteCount());
++    std::vector<bool> seen(sourceCount, false);
++    for (std::size_t slot = 0; slot < sourceCount; ++slot) {
++        const std::size_t sourceIx = parameter.RouteSourceIndex(slot);
++        REQUIRE_TRUE(sourceIx < sourceCount);
++        REQUIRE_TRUE(!seen[sourceIx]);
++        seen[sourceIx] = true;
++        REQUIRE_TRUE(parameter.RoutePositionForSource(sourceIx) == slot);
++    }
++}
++
++void RequireFullScanCurrentMatch(const synth::Parameter& parameter) {
++    const std::size_t sourceCount = parameter.Group().Config().numModulators;
++    RequireRouteBijection(parameter, sourceCount);
++    std::vector<float> depthsBySource(sourceCount, 0.0f);
++    for (std::size_t voiceIx = 0; voiceIx < parameter.Group().Config().numVoices; ++voiceIx) {
++        for (std::size_t sourceIx = 0; sourceIx < sourceCount; ++sourceIx) {
++            depthsBySource[sourceIx] = parameter.CurrentDepthForSource(voiceIx, sourceIx);
++        }
++        const float expected = synth::ClampToRange(
++            parameter.CurrentCenter() * parameter.CurrentCenterScale(voiceIx) +
++                parameter.CurrentNormalizationOffset(voiceIx) +
++                FullScanApply(parameter.Group().GetModulators(), voiceIx, depthsBySource),
++            parameter.Range());
++        REQUIRE_NEAR(parameter.GetRaw(voiceIx), expected, 0.000001f);
++    }
++}
++
++}  // namespace
++
++TEST_CASE(modulators_apply_active_uses_explicit_stable_source_indices) {
++    synth::Modulators modulators(1, 4);
++    modulators.Value(0, 0) = 0.2f;
++    modulators.Value(0, 1) = -0.4f;
++    modulators.Value(0, 2) = 0.7f;
++    modulators.Value(0, 3) = 0.9f;
++    const std::array<float, 2> depths = {0.5f, -0.25f};
++    const std::array<std::size_t, 2> sources = {3, 0};
++    const std::array<float, 4> fullDepths = {-0.25f, 0.0f, 0.0f, 0.5f};
++
++    REQUIRE_NEAR(modulators.ApplyActive(0, depths, sources),
++                 FullScanApply(modulators, 0, fullDepths), 0.000001f);
++
++    bool threw = false;
++    try {
++        (void)modulators.ApplyActive(0, depths, std::span<const std::size_t>(sources).first(1));
++    } catch (const std::invalid_argument&) {
++        threw = true;
++    }
++    REQUIRE_TRUE(threw);
++}
++
++TEST_CASE(active_modulation_routes_preserve_identity_and_settling_tail) {
++    synth::ParameterManager manager;
++    manager.SetGestureCount(1);
++    auto& group = manager.CreateGroup({.numVoices = 2,
++                                       .numModulators = 4,
++                                       .numScenes = 2,
++                                       .maxParameters = 16,
++                                       .processLiteAlpha = 1.0f,
++                                       .targetCenterAlpha = 1.0f});
++    group.GetModulators().Metadata(0) = {.name = "Zero", .shortName = "Z", .sourceColor = synth::Color::Red};
++    group.GetModulators().Metadata(1) = {.name = "One", .shortName = "O", .sourceColor = synth::Color::Orange};
++    group.GetModulators().Metadata(2) = {.name = "Two", .shortName = "T", .sourceColor = synth::Color::Green};
++    group.GetModulators().Metadata(3) = {.name = "Three", .shortName = "H", .sourceColor = synth::Color::Cyan};
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto* depth3 = carrier.EnsureModulationDepth(3);
++    auto* depth0 = carrier.EnsureModulationDepth(0);
++    auto* depth2 = carrier.EnsureModulationDepth(2);
++    auto* depth1 = carrier.EnsureModulationDepth(1);
++    REQUIRE_TRUE(depth3 != nullptr);
++    REQUIRE_TRUE(depth0 != nullptr);
++    REQUIRE_TRUE(depth2 != nullptr);
++    REQUIRE_TRUE(depth1 != nullptr);
++    group.GetModulators().Value(0, 0) = -0.25f;
++    group.GetModulators().Value(0, 2) = 0.5f;
++    group.GetModulators().Value(0, 3) = 0.75f;
++    group.GetModulators().Value(1, 0) = 0.4f;
++    group.GetModulators().Value(1, 2) = -0.6f;
++    group.GetModulators().Value(1, 3) = 0.1f;
++
++    depth3->SceneCenter(0) = 0.75f;
++    depth3->SceneCenter(1) = 0.75f;
++    manager.ComputeAllParameters();
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
++    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 3);
++    RequireFullScanCurrentMatch(carrier);
++
++    depth0->SceneCenter(0) = 0.7f;
++    depth0->SceneCenter(1) = 0.7f;
++    manager.ComputeAllParameters();
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 2);
++    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 3);
++    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[1] == 0);
++
++    depth2->SceneCenter(0) = 0.8f;
++    depth2->SceneCenter(1) = 0.8f;
++    manager.ComputeAllParameters();
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 3);
++    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[2] == 2);
++    RequireFullScanCurrentMatch(carrier);
++
++    depth1->SceneCenter(0) = 0.65f;
++    depth1->SceneCenter(1) = 0.65f;
++    manager.ComputeAllParameters();
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 4);
++    RequireFullScanCurrentMatch(carrier);
++
++    depth0->SceneCenter(0) = 0.5f;
++    depth0->SceneCenter(1) = 0.5f;
++    depth0->GestureValue(0, 0) = 0.6f;  // latent persisted state must retain source key 0
++    depth1->SceneCenter(0) = 0.5f;
++    depth1->SceneCenter(1) = 0.5f;
++    manager.ComputeAllTargets();
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 4);
++    carrier.ProcessLite();
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 4);
++    manager.ComputeAllTargets();
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 2);
++    REQUIRE_TRUE(carrier.RoutePositionForSource(0) >= carrier.ActiveRouteCount());
++    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 3);
++    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[1] == 2);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth0);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(2) == depth2);
++    REQUIRE_TRUE(depth0->Name() == "Carrier Zero");
++    REQUIRE_TRUE(depth2->Name() == "Carrier Two");
++    synth::Parameter::UIState ui(2, 4, 1);
++    carrier.PopulateUIState(ui);
++    REQUIRE_TRUE(ui.modulatorSourceColors[0].Load() == synth::Color::Red);
++    REQUIRE_TRUE(ui.modulatorSourceColors[2].Load() == synth::Color::Green);
++    synth::JsonArena arena(16384);
++    const synth::JSON values = carrier.ToValueJSON(arena);
++    REQUIRE_TRUE(!values.Get("modDepths").Get("0").IsNull());
++    REQUIRE_TRUE(values.Get("modDepths").Get("1").IsNull());
++    REQUIRE_TRUE(!values.Get("modDepths").Get("2").IsNull());
++    REQUIRE_TRUE(!values.Get("modDepths").Get("3").IsNull());
++    RequireFullScanCurrentMatch(carrier);
++}
++
++TEST_CASE(active_modulation_route_union_keeps_source_with_only_voice_one_nonzero) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 2,
++                                       .numModulators = 3,
++                                       .numScenes = 1,
++                                       .maxParameters = 12,
++                                       .processLiteAlpha = 1.0f,
++                                       .targetCenterAlpha = 1.0f});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
++    auto* depth = carrier.EnsureModulationDepth(2);
++    REQUIRE_TRUE(depth != nullptr);
++    auto* nested = depth->EnsureModulationDepth(0);
++    REQUIRE_TRUE(nested != nullptr);
++    nested->SceneCenter(0) = 0.75f;
++    group.GetModulators().Value(0, 0) = 0.5f;
++    group.GetModulators().Value(1, 0) = 1.0f;
++    group.GetModulators().Value(0, 2) = -0.8f;
++    group.GetModulators().Value(1, 2) = 0.6f;
++
++    manager.ComputeAllParameters();
++
++    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 2), 0.0f, 0.000001f);
++    REQUIRE_TRUE(std::fabs(carrier.CurrentDepthForSource(1, 2)) > 0.000001f);
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
++    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 2);
++    RequireFullScanCurrentMatch(carrier);
++}
++
++TEST_CASE(active_modulation_routes_randomized_full_scan_oracle_and_work_bound) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 2,
++                                       .numModulators = 4,
++                                       .numScenes = 2,
++                                       .maxParameters = 16,
++                                       .processLiteAlpha = 0.25f,
++                                       .targetCenterAlpha = 1.0f});
++    synth::ParameterProcessingObserver work;
++    group.SetProcessingObserverForTests(&work);
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.35f});
++    std::array<synth::Parameter*, 4> depths{};
++    for (std::size_t sourceIx = 0; sourceIx < depths.size(); ++sourceIx) {
++        depths[sourceIx] = carrier.EnsureModulationDepth(sourceIx);
++        REQUIRE_TRUE(depths[sourceIx] != nullptr);
++    }
++    std::mt19937 random(0x5a17eU);
++    std::uniform_int_distribution<int> sourceDistribution(0, 3);
++    std::uniform_int_distribution<int> valueDistribution(0, 4);
++    std::uniform_real_distribution<float> modulatorDistribution(-1.0f, 1.0f);
++
++    manager.ComputeAllParameters();
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 0);
++    for (std::size_t step = 0; step < 128; ++step) {
++        const std::size_t sourceIx = static_cast<std::size_t>(sourceDistribution(random));
++        const float knob = 0.5f + 0.1f * static_cast<float>(valueDistribution(random) - 2);
++        depths[sourceIx]->SceneCenter(step & 1U) = knob;
++        for (std::size_t voiceIx = 0; voiceIx < 2; ++voiceIx) {
++            for (std::size_t modIx = 0; modIx < 4; ++modIx) {
++                group.GetModulators().Value(voiceIx, modIx) = modulatorDistribution(random);
++            }
++        }
++
++        REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
++        manager.SetSceneBlend(static_cast<float>(step % 5) * 0.25f);
++        manager.ComputeAllTargets();
++        const std::size_t visitsBefore = work.activeRouteVisits;
++        carrier.ProcessLite();
++        REQUIRE_TRUE(work.activeRouteVisits - visitsBefore == carrier.ActiveRouteCount() * 2);
++        RequireFullScanCurrentMatch(carrier);
++    }
++}
++
++namespace {
++
+ // Regression for slog-2: MidiSender's worker thread (Run()) must tag itself
+ // with ThreadId::MidiSender so log messages produced while sending (and any
+ // future thread-identity-sensitive code on that thread) observe the correct
+ // identity. This sink records synth::GetCurrentThreadId() as observed from
+ // inside Send(), which runs on the sender's worker thread.
+ struct RecordingMidiOutputSink final : synth::IMidiOutputSink {
+     std::mutex mutex;
+     std::optional<synth::ThreadId> observedThreadId;
+
+     void Send(const synth::BasicMidi&) override {
diff --git a/.superpowers/sdd/scale-modulation-processing/task-4-brief.md b/.superpowers/sdd/scale-modulation-processing/task-4-brief.md
new file mode 100644
index 00000000..c890d945
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-4-brief.md
@@ -0,0 +1,91 @@
+### Task 4: Safe Bottom-Up Local Node Collection and Slot Reuse
+
+**OpenSpec coverage:** tasks 5.1-5.6; all `spm-74` scenarios.
+
+**Files:**
+- Modify: `projects/synth/include/synth/ParameterModulation.hpp` — collection, pin, reuse, and capacity APIs.
+- Modify: `projects/synth/src/ParameterModulation.cpp` — eligibility, bottom-up detach, free-list accounting, in-place reset, safe-boundary calls.
+- Modify: `projects/synth/src/PatchPersistence.cpp` — patch-load collection boundary.
+- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — lifecycle, pointer safety, capacity, semantic JSON, randomized collection.
+
+**Interfaces:**
+- Produces: `std::size_t ParameterGroup::CollectNeutralLocalParameters()`, `LiveLocalParameterCount() const`, and `FreeLocalParameterSlotCount() const`.
+- Produces: private `Parameter::PinLocalForView()`, `UnpinLocalForView()`, `CanRecycleLocal() const`, `CollectNeutralChildren()`, and `ResetLocalForReuse(ParameterId, ParameterConfig)`; `Bank` is a friend for view pinning.
+- Produces: `RecycledLocalSlot { Parameter* parameter; ParameterStorageBatch* batch; std::size_t slotIx; std::size_t storageLocalIx; }` entries owned by the group.
+- Consumes: Task 1's root list and Task 3's active/settling route state.
+
+- [ ] **Step 1: Write RED eligibility, pinning, and capacity tests**
+
+Create one test per retention reason: non-default scene center, non-default latent gesture value even when inactive, active gesture, nonzero current/target/normalization state, non-collectible child, and an open modulation view pin. Add a recursive neutral-subtree test, then this reuse shape:
+
+```cpp
+const std::size_t highWater = group.ParameterCount();
+const std::size_t availableBefore = group.AvailableParameterSlots();
+bank.Deselect();
+REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 2);
+REQUIRE_TRUE(group.ParameterCount() == highWater);
+REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 2);
+REQUIRE_TRUE(group.AvailableParameterSlots() == availableBefore + 2);
+auto* reused = otherRoot.EnsureModulationDepth(1);
+REQUIRE_TRUE(reused != nullptr);
+REQUIRE_TRUE(group.ParameterCount() == highWater);
+REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
+```
+
+Keep an old local pointer only while its bank view is open and prove collection retains it. After close, do not dereference it once collection succeeds; locate reused topology through the new parent instead.
+
+- [ ] **Step 2: Run RED collection tests**
+
+```bash
+make -C projects/synth build/parameter_modulation_tests
+projects/synth/build/parameter_modulation_tests
+```
+
+Expected: compilation fails because collection/count APIs do not exist.
+
+- [ ] **Step 3: Pin visible locals and collect children bottom-up**
+
+When `Bank::OpenModulationView` installs local depth parameters in `visible_`, increment each local's pin count. `Bank::Deselect` first removes the visible mapping and decrements exactly those pins, clears `selected_`, then asks the affected group to collect. Never pin the top-level target.
+
+Implement recursive collection from every `topLevelParameters_` root. Visit a child's children first; detach `modulationDepths_[sourceIx]` only if the child is unpinned, has no remaining children, every scene/gesture value and active bit is default, and all current/target center, scale, normalization, depth, and UI-affecting state is neutral. A current nonzero route settling to zero is not collectible.
+
+- [ ] **Step 4: Add keyed free slots and central in-place reinitialization**
+
+Store the original backing batch pointer and backing `slotIx` with each recycled object. Keep `parameterCount_` unchanged as the high-water object count and keep `ParameterByLocalIndex` enumerating the same storage objects. Track `liveLocalParameterCount_` separately and define:
+
+```cpp
+std::size_t ParameterGroup::AvailableParameterSlots() const {
+    return unallocatedInitialSlots + unallocatedBatchSlots + recycledLocalSlots_.size();
+}
+```
+
+Before allocating initial or batch storage, `CreateLocalParameter` pops a compatible recycled slot, calls `ResetLocalForReuse`, increments the live-local count, and returns the same object address. `ResetLocalForReuse` replaces ID/config and resets every scalar/span: centers to the clamped default, scale to one, offsets/depths/spread/masks/pins to zero, gesture values to the new clamped default, current/target min and max to that same unmodulated default center, child pointers to null, route permutations to identity, active route count to zero, and cached/UI center from the default. Do not allocate inside reset.
+
+- [ ] **Step 5: Invoke collection only at safe boundaries and verify persistence**
+
+Call collection after bank modulation view close/deselect, reset/revert completion, and successful patch load after all values/topology are applied. Do not call it from `ProcessSample`, `ProcessLite`, `GetRaw`, `ComputeAtDepth`, or modulation application.
+
+Serialize semantic JSON before and after eligible collection and compare parsed values, not string key order. Round-trip a non-default nested route plus gestures 32 and 63 and assert it is retained; round-trip a default omitted child and assert lazy rematerialization produces identical audio and fully reset metadata/state. Repeat edit/collect/reuse for more iterations than `maxParameters` and assert high-water capacity remains bounded.
+
+- [ ] **Step 6: Run tests, commit, and pass Opus**
+
+Run:
+
+```bash
+make -C projects/synth build/parameter_modulation_tests build/engine_tests build/miniapp_system_tests
+projects/synth/build/parameter_modulation_tests
+projects/synth/build/engine_tests
+projects/synth/build/miniapp_system_tests
+```
+
+Expected: all binaries exit 0, semantic JSON is unchanged by eligible collection, visible pointers remain pinned, and repeated cycles stop growing high-water storage. Then:
+
+```bash
+git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/src/PatchPersistence.cpp projects/synth/tests/parameter_modulation_tests.cpp
+git commit -m "perf(synth): recycle neutral modulation controls"
+```
+
+Run the global Opus gate. Require explicit review of raw-pointer lifetime, detach ordering, every stale-state field, backing-slot compatibility, high-water/index semantics, and absence of collection from the audio path. Record both passing verdicts.
+
+---
+
diff --git a/.superpowers/sdd/scale-modulation-processing/task-4-report.md b/.superpowers/sdd/scale-modulation-processing/task-4-report.md
new file mode 100644
index 00000000..31701792
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-4-report.md
@@ -0,0 +1,131 @@
+# Task 4 Report: Safe Bottom-Up Local Node Collection and Slot Reuse
+
+## Scope
+
+Implemented Task 4 only. The change adds explicit control-boundary collection of neutral local modulation-depth nodes, storage-slot reuse, view pinning, live/free/high-water accounting, and patch/revert integration. No OpenSpec checkboxes or progress files were edited.
+
+## TDD Evidence
+
+### RED
+
+Lifecycle tests were added before production APIs. The required RED command was:
+
+```text
+make -C projects/synth build/parameter_modulation_tests
+```
+
+It failed at compile time because `ParameterGroup::CollectNeutralLocalParameters`, `LiveLocalParameterCount`, and `FreeLocalParameterSlotCount` did not exist. This was the expected missing-feature failure.
+
+### GREEN and refactor
+
+The minimal group collection/free-list APIs were implemented, followed by pinning, complete reset, safe-boundary wiring, persistence coverage, and lifecycle hardening. After each failure, production or contract-obsolete tests were corrected and the complete parameter suite was rerun. The final parameter suite is green.
+
+Two existing tests intentionally changed to honor the new local-pointer lifetime contract:
+
+- A closed neutral modulation view may no longer assume its lazy local pointer remains attached; the test reopens the view and validates metadata after storage reuse.
+- The randomized recursive patch lifecycle no longer retains raw local pointers across load/revert collection boundaries; it reacquires omitted/default lazy topology through its parents before inspecting it.
+
+No test dereferences a collected pointer.
+
+## Implementation
+
+### Ownership and accounting
+
+- `ParameterGroup::parameterCount_` remains the constructed-storage high-water mark.
+- `ParameterByLocalIndex` continues to enumerate the same storage objects after collection and reuse.
+- `liveLocalParameterCount_` counts currently attached local-ID objects.
+- `recycledLocalSlots_` stores each detached object's pointer, backing `ParameterStorageBatch*`, backing slot index, and stable storage-local index.
+- `AvailableParameterSlots` includes never-used initial slots, never-used batch slots, and recycled local slots.
+- Only local-ID creation consumes recycled slots; later manager top-level registration cannot accidentally turn a recycled local into a root.
+- Reuse validates backing batch, slot, storage-local identity, and batch/group compatibility before reset.
+
+### Eligibility and bottom-up detach
+
+`CollectNeutralLocalParameters` starts from the dense top-level roots and visits children bottom-up. A child is detached only when it is a local parameter and all of the following are true:
+
+- no live view pin;
+- no child route remains;
+- all scenes and latent gesture values are at the config default;
+- no gesture is active;
+- current/target center is both config-default and bipolar modulation-neutral;
+- current/target center-scale, normalization, min/max, and depth state is neutral;
+- no active route remains;
+- cached knob, UI center, and UI spread state is neutral.
+
+The parent source pointer is cleared before the child is placed on the reusable list. Parent active-route state is not cleared by collection, so a current nonzero route can continue its one-pole tail after its neutral child is detached.
+
+### Pinning and raw-pointer lifetime
+
+- Opening a modulation view pins each visible local depth control.
+- A selected local target in a nested modulation view is pinned once; a manager top-level target's pin operation is a no-op.
+- Nested view transitions release old pins and establish new pins without collecting between the two operations.
+- Deselect removes/restores visible mappings, releases pins, clears `selected_`, and only then invokes collection.
+- Local pointers are topology-lifetime references. Tests reacquire topology through the parent after a collection boundary.
+
+### Central reset and reuse
+
+`ResetLocalForReuse` performs an in-place reset without changing the backing spans or storage identity. It replaces the ID/config and resets:
+
+- recursion and view-pin scalars;
+- current/target centers;
+- center scales and normalization offsets;
+- current/target min and max values;
+- current/target depth spans;
+- route source permutation, inverse map, and active count;
+- cached knob, UI center, and UI spread spans;
+- child pointers;
+- scene centers;
+- all gesture values and active masks.
+
+Metadata is resolved before entering reset and moved into the recycled object. Tests reuse a deliberately different old config under a distinct parent/source and verify name, short name, color, switch metadata, gestures 32/63, route identity, UI values/masks, and all exposed numeric state.
+
+### Safe boundaries
+
+Collection is invoked only from control paths:
+
+- bank modulation-view close/deselect;
+- bank reset operation completion;
+- manager-wide revert completion;
+- successful patch load after values/topology are applied.
+
+An audit of all call sites confirms there is no collection call from `ProcessSample`, `ProcessLite`, `GetRaw`, `ComputeAtDepth`, modulation application, or any per-sample path.
+
+## Test Coverage Added or Updated
+
+- neutral leaf collection and live/free/high-water accounting;
+- stable root addresses and stable `ParameterByLocalIndex` identity through reuse;
+- every retention reason: non-default scene, inactive latent gesture, active gesture, unsnapped center state, nonzero normalization, non-collectible child, and open-view pin;
+- recursive bottom-up subtree collapse;
+- child detach while the parent active route finishes settling;
+- nested-view and close/reopen pointer lifetime behavior;
+- manager revert boundary collection;
+- repeated edit/collect/reuse beyond `maxParameters`, including extra-batch backing;
+- deterministic randomized collection/reuse across distinct parents and sources;
+- semantic (key-order-independent) JSON equality before/after eligible collection;
+- patch load retaining nested gestures 32 and 63 while collecting an omitted/default branch;
+- lazy rematerialization of the omitted branch with identical output and fully reset state/metadata;
+- randomized patch lifecycle reacquiring topology rather than retaining stale pointers.
+
+## Verification
+
+Build command:
+
+```text
+make -C projects/synth build/parameter_modulation_tests build/engine_tests build/miniapp_system_tests
+```
+
+Result: exit 0.
+
+Test binaries:
+
+```text
+projects/synth/build/parameter_modulation_tests  # exit 0
+projects/synth/build/engine_tests                # exit 0
+projects/synth/build/miniapp_system_tests        # exit 0
+```
+
+`git diff --check` also exits 0.
+
+## Commit
+
+Commit hash: `dda1aeee` (`perf(synth): recycle neutral modulation controls`).
diff --git a/.superpowers/sdd/scale-modulation-processing/task-4-review-package.md b/.superpowers/sdd/scale-modulation-processing/task-4-review-package.md
new file mode 100644
index 00000000..89a094ff
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-4-review-package.md
@@ -0,0 +1,1265 @@
+# Review package: 0b42e995..dda1aeee
+
+## Commits
+dda1aeee perf(synth): recycle neutral modulation controls
+
+## Files changed
+ .../synth/include/synth/ParameterModulation.hpp    |  24 ++
+ projects/synth/src/ParameterModulation.cpp         | 193 ++++++++-
+ projects/synth/src/PatchPersistence.cpp            |   5 +-
+ .../synth/tests/parameter_modulation_tests.cpp     | 469 ++++++++++++++++++++-
+ 4 files changed, 683 insertions(+), 8 deletions(-)
+
+## Diff
+diff --git a/projects/synth/include/synth/ParameterModulation.hpp b/projects/synth/include/synth/ParameterModulation.hpp
+index 9e83531e..66bbe893 100644
+--- a/projects/synth/include/synth/ParameterModulation.hpp
++++ b/projects/synth/include/synth/ParameterModulation.hpp
+@@ -111,20 +111,21 @@ struct SceneState {
+     float blend = 0.0f;
+ };
+
+ struct PageDescriptor {
+     PageOrdinal ordinal = 0;
+     std::string name;
+ };
+
+ class Parameter;
+ class ParameterManager;
++class Bank;
+ class BankSlot;
+ struct ParameterStorageBatch;
+
+ struct Page {
+     PageOrdinal ordinal = 0;
+     std::string name;
+     std::vector<Parameter*> parameters;
+ };
+
+ inline constexpr float kDefaultProcessLiteAlpha = 0.1226942309f;  // 1 kHz one-pole cutoff at 48 kHz
+@@ -293,20 +294,23 @@ public:
+     const ParameterGroupConfig& Config() const { return config_; }
+     Modulators& GetModulators() { return modulators_; }
+     const Modulators& GetModulators() const { return modulators_; }
+     ParameterManager& Manager() { return *manager_; }
+     const ParameterManager& Manager() const { return *manager_; }
+
+     bool CanAllocate() const;
+     std::size_t AvailableParameterSlots() const;
+     void AddParameterStorageBatch(std::unique_ptr<ParameterStorageBatch> batch);
+     std::size_t ParameterCount() const { return parameterCount_; }
++    std::size_t LiveLocalParameterCount() const { return liveLocalParameterCount_; }
++    std::size_t FreeLocalParameterSlotCount() const { return recycledLocalSlots_.size(); }
++    std::size_t CollectNeutralLocalParameters();
+     Parameter& ParameterByLocalIndex(std::size_t localIx);
+     const Parameter& ParameterByLocalIndex(std::size_t localIx) const;
+     std::size_t GestureCount() const { return gestureCount_; }
+     void SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
+                              ModulatorMetadata metadata);
+     void UpdateModValues();
+     void SelectGesture(std::size_t gestureIx);
+     void DeselectGesture(std::size_t gestureIx);
+     bool GestureSelected(std::size_t gestureIx) const;
+     void SetGestureValue(std::size_t gestureIx, float value);
+@@ -315,36 +319,45 @@ public:
+     void ConfigureProcessingTiming(const ParameterProcessingTiming& timing);
+     void ProcessSample(std::uint64_t sampleIndex);
+     void SetProcessingObserverForTests(ParameterProcessingObserver* observer) { processingObserver_ = observer; }
+
+ private:
+     friend class Parameter;
+     friend class ParameterManager;
+     friend class Bank;
+
+     Parameter& CreateLocalParameter(ParameterConfig config, ParameterId id);
++    void RecycleLocalParameter(Parameter& parameter);
+     void RegisterTopLevelParameter(Parameter& parameter);
+     void RequestParameterStorageBatch(std::size_t minimumAdditionalParameters);
+     void RequestParameterStorageBatchIfLow();
+
+     // Groups own parameter objects and all same-shaped per-parameter arenas.
+     // Parameter instances hold spans into these arenas; callers must not move a
+     // group after handing out Parameter references.
+     ParameterGroupConfig config_;
+     ParameterManager* manager_ = nullptr;
+     std::size_t gestureCount_ = 0;
+     Modulators modulators_;
+     std::size_t parameterCount_ = 0;
++    std::size_t liveLocalParameterCount_ = 0;
+     std::vector<Parameter*> topLevelParameters_;
+     ParameterProcessingObserver* processingObserver_ = nullptr;
+     std::vector<std::unique_ptr<Parameter>> parameters_;
+     std::vector<std::unique_ptr<ParameterStorageBatch>> extraStorageBatches_;
++    struct RecycledLocalSlot {
++        Parameter* parameter = nullptr;
++        ParameterStorageBatch* batch = nullptr;
++        std::size_t slotIx = 0;
++        std::size_t storageLocalIx = 0;
++    };
++    std::vector<RecycledLocalSlot> recycledLocalSlots_;
+     bool storageRequestPending_ = false;
+     std::vector<float> currentCenterScaleArena_;
+     std::vector<float> targetCenterScaleArena_;
+     std::vector<float> currentNormalizationOffsetArena_;
+     std::vector<float> targetNormalizationOffsetArena_;
+     std::vector<float> currentMinValueArena_;
+     std::vector<float> targetMinValueArena_;
+     std::vector<float> currentMaxValueArena_;
+     std::vector<float> targetMaxValueArena_;
+     std::vector<float> currentDepthArena_;
+@@ -462,47 +475,57 @@ public:
+     float CurrentCenterScale(std::size_t voiceIx) const;
+     float TargetCenterScale(std::size_t voiceIx) const;
+     float CurrentNormalizationOffset(std::size_t voiceIx) const;
+     float TargetNormalizationOffset(std::size_t voiceIx) const;
+     std::size_t RecursionDepth() const { return recursionDepth_; }
+     JSON ToValueJSON(JsonArena& arena) const;
+     bool LoadValuesFromJSON(JSON json);
+
+ private:
+     friend class ParameterManager;
++    friend class ParameterGroup;
++    friend class Bank;
+
+     std::size_t SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const;
+     void ValidateSceneEndpoints(const SceneState& scene) const;
+     float EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const;
+     void ResetSceneToDefault(std::size_t sceneIx, float defaultValue);
+     void ResetModulationDepthToNeutral(const SceneState& scene);
+     float ComputeRawCenter(const SceneState& scene) const;
+     void ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth, bool smoothTargetCenter);
+     void SnapCurrentToTarget();
+     void SeedCachedKnobAndUiDisplayState();
+     bool WouldCreateCycle(const Parameter* candidate) const;
+     ParameterConfig ModulationDepthConfig(std::size_t modIx) const;
+     float TargetValue(std::size_t voiceIx) const;
+     std::size_t VoiceRouteIndex(std::size_t voiceIx, std::size_t routeSlot) const;
+     void EnsureRouteActive(std::size_t sourceIx);
+     void RemoveActiveRoute(std::size_t routeSlot);
+     bool RouteNeutralAcrossVoices(std::size_t routeSlot) const;
+     void PruneNeutralActiveRoutes();
+     void AssertRouteBijection() const;
++    void PinLocalForView();
++    void UnpinLocalForView();
++    bool CanRecycleLocal() const;
++    std::size_t CollectNeutralChildren();
++    void ResetLocalForReuse(ParameterId id, ParameterConfig config);
+     std::uint32_t ModulatorsAffectingMask() const;
+     bool HasNonDefaultState() const;
+     bool HasNonZeroState() const;
+
+     ParameterId id_;
+     ParameterGroup& group_;
+     ParameterConfig config_;
++    ParameterStorageBatch* storageBatch_ = nullptr;
+     std::size_t slotIx_ = 0;
++    std::size_t storageLocalIx_ = 0;
++    std::size_t localViewPinCount_ = 0;
+     std::size_t recursionDepth_ = 0;
+     float currentCenter_ = 0.0f;
+     float targetCenter_ = 0.0f;
+     std::span<float> currentCenterScales_;
+     std::span<float> targetCenterScales_;
+     std::span<float> currentNormalizationOffsets_;
+     std::span<float> targetNormalizationOffsets_;
+     std::span<float> currentMinValues_;
+     std::span<float> targetMinValues_;
+     std::span<float> currentMaxValues_;
+@@ -703,20 +726,21 @@ public:
+     ParameterGroup& CreateGroup(ParameterGroupConfig config);
+     ParameterId RegisterParameter(ParameterGroup& group, ParameterConfig config);
+     Parameter& CreateParameter(ParameterGroup& group, ParameterConfig config);
+     Parameter& ParameterById(ParameterId id);
+     const Parameter& ParameterById(ParameterId id) const;
+     std::size_t ParameterCount() const { return parameters_.size(); }
+     Parameter* FindParameterByName(std::string_view name);
+     const Parameter* FindParameterByName(std::string_view name) const;
+     JSON ParameterValuesToJSON(JsonArena& arena) const;
+     bool LoadParameterValuesFromJSON(JSON json);
++    std::size_t CollectNeutralLocalParameters();
+     void ComputeAllParameters();
+     // Control-rate target computation for the steady-state audio pump:
+     // Compute() every parameter without snapping current values, so
+     // ProcessLite() slewing stays audible (sar-6). Use ComputeAllParameters()
+     // only for non-steady-state moments (init, patch load, revert).
+     void ComputeAllTargets();
+     void CaptureDefaultControlState();
+     void RevertAllToDefaults();
+
+     float GetLinear(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const;
+diff --git a/projects/synth/src/ParameterModulation.cpp b/projects/synth/src/ParameterModulation.cpp
+index daaac76e..9382e9c1 100644
+--- a/projects/synth/src/ParameterModulation.cpp
++++ b/projects/synth/src/ParameterModulation.cpp
+@@ -417,20 +417,21 @@ void Gestures::CheckIndex(std::size_t gestureIx) const {
+ }
+
+ ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount)
+     : config_(ValidateConfig(config)),
+       manager_(&manager),
+       gestureCount_(gestureCount),
+       modulators_(config.numVoices, config.numModulators),
+       parameterCount_(0) {
+     parameters_.reserve(config_.maxParameters);
+     topLevelParameters_.reserve(config_.maxParameters);
++    recycledLocalSlots_.reserve(config_.maxParameters);
+     currentCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
+     targetCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
+     currentNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
+     targetNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
+     currentMinValueArena_.resize(config_.maxParameters * config_.numVoices);
+     targetMinValueArena_.resize(config_.maxParameters * config_.numVoices);
+     currentMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
+     targetMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
+     currentDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
+     targetDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
+@@ -450,64 +451,114 @@ ParameterGroup::~ParameterGroup() = default;
+ bool ParameterGroup::CanAllocate() const {
+     return AvailableParameterSlots() > 0;
+ }
+
+ std::size_t ParameterGroup::AvailableParameterSlots() const {
+     const std::size_t initialAllocated = std::min(parameterCount_, config_.maxParameters);
+     std::size_t available = config_.maxParameters - initialAllocated;
+     for (const auto& batch : extraStorageBatches_) {
+         available += batch->Available();
+     }
+-    return available;
++    return available + recycledLocalSlots_.size();
+ }
+
+ void ParameterGroup::AddParameterStorageBatch(std::unique_ptr<ParameterStorageBatch> batch) {
+     if (batch == nullptr || !batch->Compatible(config_, gestureCount_)) {
+         throw std::invalid_argument("parameter storage batch does not match group shape");
+     }
+     storageRequestPending_ = false;
+     extraStorageBatches_.push_back(std::move(batch));
+ }
+
+ Parameter& ParameterGroup::CreateLocalParameter(ParameterConfig config, ParameterId id) {
+     if (config.name.empty()) {
+         throw std::logic_error("parameter name must not be empty");
+     }
+     if (!CanAllocate()) {
+         throw std::length_error("parameter group capacity exhausted");
+     }
+
++    if (id == kLocalParameterId && !recycledLocalSlots_.empty()) {
++        RecycledLocalSlot recycled = recycledLocalSlots_.back();
++        recycledLocalSlots_.pop_back();
++        if (recycled.parameter == nullptr || recycled.parameter->storageBatch_ != recycled.batch ||
++            recycled.parameter->slotIx_ != recycled.slotIx ||
++            recycled.parameter->storageLocalIx_ != recycled.storageLocalIx ||
++            &ParameterByLocalIndex(recycled.storageLocalIx) != recycled.parameter ||
++            (recycled.batch != nullptr && !recycled.batch->Compatible(config_, gestureCount_))) {
++            throw std::logic_error("recycled local parameter slot identity is invalid");
++        }
++        recycled.parameter->ResetLocalForReuse(id, std::move(config));
++        ++liveLocalParameterCount_;
++        RequestParameterStorageBatchIfLow();
++        return *recycled.parameter;
++    }
++
+     if (parameterCount_ < config_.maxParameters) {
+         auto parameter = std::make_unique<Parameter>(id, *this, std::move(config), parameterCount_);
+         Parameter& result = *parameter;
+         parameters_.push_back(std::move(parameter));
+         ++parameterCount_;
++        if (id == kLocalParameterId) {
++            ++liveLocalParameterCount_;
++        }
+         RequestParameterStorageBatchIfLow();
+         return result;
+     }
+
+     for (const auto& batch : extraStorageBatches_) {
+         if (batch->Available() == 0) {
+             continue;
+         }
+         const std::size_t slotIx = batch->allocated++;
+         auto parameter = std::make_unique<Parameter>(id, *this, std::move(config), *batch, slotIx);
+         Parameter& result = *parameter;
+         batch->parameters.push_back(std::move(parameter));
+         ++parameterCount_;
++        if (id == kLocalParameterId) {
++            ++liveLocalParameterCount_;
++        }
+         RequestParameterStorageBatchIfLow();
+         return result;
+     }
+
+     throw std::length_error("parameter group capacity exhausted");
+ }
+
++void ParameterGroup::RecycleLocalParameter(Parameter& parameter) {
++    if (parameter.id_ != kLocalParameterId || parameter.localViewPinCount_ != 0) {
++        throw std::logic_error("only unpinned local parameters can be recycled");
++    }
++    if (liveLocalParameterCount_ == 0) {
++        throw std::logic_error("local parameter accounting underflow");
++    }
++    if (parameter.storageLocalIx_ >= parameterCount_ ||
++        &ParameterByLocalIndex(parameter.storageLocalIx_) != &parameter) {
++        throw std::logic_error("local parameter storage identity is invalid");
++    }
++    recycledLocalSlots_.push_back({
++        .parameter = &parameter,
++        .batch = parameter.storageBatch_,
++        .slotIx = parameter.slotIx_,
++        .storageLocalIx = parameter.storageLocalIx_,
++    });
++    --liveLocalParameterCount_;
++}
++
++std::size_t ParameterGroup::CollectNeutralLocalParameters() {
++    std::size_t collected = 0;
++    for (Parameter* root : topLevelParameters_) {
++        collected += root->CollectNeutralChildren();
++    }
++    return collected;
++}
++
+ void ParameterGroup::RegisterTopLevelParameter(Parameter& parameter) {
+     topLevelParameters_.push_back(&parameter);
+ }
+
+ Parameter& ParameterGroup::ParameterByLocalIndex(std::size_t localIx) {
+     if (localIx < parameters_.size()) {
+         return *parameters_.at(localIx);
+     }
+     std::size_t remaining = localIx - parameters_.size();
+     for (const auto& batch : extraStorageBatches_) {
+@@ -577,20 +628,21 @@ void ParameterGroup::ProcessSample(std::uint64_t sampleIndex) {
+             ++processingObserver_->topLevelProcessLiteCalls;
+         }
+     }
+ }
+
+ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx)
+     : id_(id),
+       group_(group),
+       config_(std::move(config)),
+       slotIx_(slotIx),
++      storageLocalIx_(group.parameterCount_),
+       currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
+       targetCenter_(currentCenter_),
+       currentCenterScales_(ArenaSlice(group_.currentCenterScaleArena_, slotIx_ * group_.Config().numVoices,
+                                       group_.Config().numVoices)),
+       targetCenterScales_(ArenaSlice(group_.targetCenterScaleArena_, slotIx_ * group_.Config().numVoices,
+                                      group_.Config().numVoices)),
+       currentNormalizationOffsets_(ArenaSlice(group_.currentNormalizationOffsetArena_,
+                                              slotIx_ * group_.Config().numVoices,
+                                              group_.Config().numVoices)),
+       targetNormalizationOffsets_(ArenaSlice(group_.targetNormalizationOffsetArena_,
+@@ -656,21 +708,23 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
+     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
+     std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
+     SeedCachedKnobAndUiDisplayState();
+ }
+
+ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
+                      ParameterStorageBatch& storageBatch, std::size_t slotIx)
+     : id_(id),
+       group_(group),
+       config_(std::move(config)),
++      storageBatch_(&storageBatch),
+       slotIx_(slotIx),
++      storageLocalIx_(group.parameterCount_),
+       currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
+       targetCenter_(currentCenter_),
+       currentCenterScales_(ArenaSlice(storageBatch.currentCenterScaleArena, slotIx_ * group_.Config().numVoices,
+                                       group_.Config().numVoices)),
+       targetCenterScales_(ArenaSlice(storageBatch.targetCenterScaleArena, slotIx_ * group_.Config().numVoices,
+                                      group_.Config().numVoices)),
+       currentNormalizationOffsets_(ArenaSlice(storageBatch.currentNormalizationOffsetArena,
+                                              slotIx_ * group_.Config().numVoices,
+                                              group_.Config().numVoices)),
+       targetNormalizationOffsets_(ArenaSlice(storageBatch.targetNormalizationOffsetArena,
+@@ -733,20 +787,114 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
+     }
+     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
+     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
+     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
+     std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
+     SeedCachedKnobAndUiDisplayState();
+ }
+
+ ParameterStorageBatch::~ParameterStorageBatch() = default;
+
++void Parameter::PinLocalForView() {
++    if (id_ == kLocalParameterId) {
++        ++localViewPinCount_;
++    }
++}
++
++void Parameter::UnpinLocalForView() {
++    if (id_ != kLocalParameterId) {
++        return;
++    }
++    if (localViewPinCount_ == 0) {
++        throw std::logic_error("local parameter view pin underflow");
++    }
++    --localViewPinCount_;
++}
++
++bool Parameter::CanRecycleLocal() const {
++    constexpr float tolerance = 0.000001f;
++    if (id_ != kLocalParameterId || localViewPinCount_ != 0 || activeRouteCount_ != 0 ||
++        HasNonDefaultState() || HasNonZeroState()) {
++        return false;
++    }
++    if (std::any_of(modulationDepths_.begin(), modulationDepths_.end(),
++                    [](const Parameter* child) { return child != nullptr; })) {
++        return false;
++    }
++
++    const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
++    const auto allNear = [&](std::span<const float> values, float expected) {
++        return std::all_of(values.begin(), values.end(), [&](float value) {
++            return std::fabs(value - expected) <= tolerance;
++        });
++    };
++    return allNear(currentMinValues_, defaultValue) && allNear(targetMinValues_, defaultValue) &&
++           allNear(currentMaxValues_, defaultValue) && allNear(targetMaxValues_, defaultValue) &&
++           allNear(currentKnobValues_, defaultValue) && allNear(uiDisplayCenters_, defaultValue) &&
++           allNear(uiDisplaySpreadEnergies_, 0.0f);
++}
++
++std::size_t Parameter::CollectNeutralChildren() {
++    std::size_t collected = 0;
++    for (std::size_t sourceIx = 0; sourceIx < modulationDepths_.size(); ++sourceIx) {
++        Parameter* child = modulationDepths_[sourceIx];
++        if (child == nullptr) {
++            continue;
++        }
++        collected += child->CollectNeutralChildren();
++        if (!child->CanRecycleLocal()) {
++            continue;
++        }
++
++        modulationDepths_[sourceIx] = nullptr;
++        group_.RecycleLocalParameter(*child);
++        ++collected;
++    }
++    return collected;
++}
++
++void Parameter::ResetLocalForReuse(ParameterId id, ParameterConfig config) {
++    if (id != kLocalParameterId) {
++        throw std::logic_error("recycled parameter slots are local-only");
++    }
++    id_ = id;
++    config_ = std::move(config);
++    recursionDepth_ = 0;
++    localViewPinCount_ = 0;
++    const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
++    currentCenter_ = defaultValue;
++    targetCenter_ = defaultValue;
++    std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
++    std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
++    std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
++    std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
++    std::fill(currentMinValues_.begin(), currentMinValues_.end(), defaultValue);
++    std::fill(targetMinValues_.begin(), targetMinValues_.end(), defaultValue);
++    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), defaultValue);
++    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), defaultValue);
++    std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
++    std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
++    for (std::size_t sourceIx = 0; sourceIx < routeSourceIndices_.size(); ++sourceIx) {
++        routeSourceIndices_[sourceIx] = sourceIx;
++        sourceRoutePositions_[sourceIx] = sourceIx;
++    }
++    activeRouteCount_ = 0;
++    std::fill(currentKnobValues_.begin(), currentKnobValues_.end(), defaultValue);
++    std::fill(uiDisplayCenters_.begin(), uiDisplayCenters_.end(), defaultValue);
++    std::fill(uiDisplaySpreadEnergies_.begin(), uiDisplaySpreadEnergies_.end(), 0.0f);
++    std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
++    std::fill(sceneCenters_.begin(), sceneCenters_.end(), defaultValue);
++    std::fill(gestureValues_.begin(), gestureValues_.end(), defaultValue);
++    std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
++    AssertRouteBijection();
++}
++
+ void Parameter::UIState::Configure(std::size_t newVoiceCapacity, std::size_t newModulatorColorCapacity,
+                                    std::size_t newGestureColorCapacity) {
+     voiceCapacity = newVoiceCapacity;
+     modulatorColorCapacity = newModulatorColorCapacity;
+     gestureColorCapacity = newGestureColorCapacity;
+     values = std::make_unique<std::atomic<float>[]>(voiceCapacity);
+     spreadValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
+     minValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
+     maxValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
+     switchValue = std::make_unique<std::atomic<std::size_t>[]>(voiceCapacity);
+@@ -2074,22 +2222,34 @@ void Bank::ApplyModifierToTopLevel(Modifier modifier, const SceneState& scene) {
+         }
+         if (std::find(visited.begin(), visited.end(), cell.parameter) != visited.end()) {
+             continue;
+         }
+         visited.push_back(cell.parameter);
+         ApplyModifierToParameter(*cell.parameter, modifier, scene);
+     }
+ }
+
+ void Bank::Deselect() {
+-    selected_ = nullptr;
++    ParameterGroup* affectedGroup = selected_ == nullptr ? nullptr : &selected_->Group();
++    if (selected_ != nullptr) {
++        for (const Cell& cell : visible_) {
++            if (cell.parameter != nullptr && cell.parameter != selected_) {
++                cell.parameter->UnpinLocalForView();
++            }
++        }
++        selected_->UnpinLocalForView();
++    }
+     visible_ = topLevel_;
++    selected_ = nullptr;
++    if (affectedGroup != nullptr) {
++        affectedGroup->CollectNeutralLocalParameters();
++    }
+ }
+
+ bool Bank::ShowingModulation() const {
+     return selected_ != nullptr;
+ }
+
+ std::size_t Bank::VisibleMappingCount() const {
+     return visible_.size();
+ }
+
+@@ -2194,55 +2354,73 @@ void Bank::OpenModulationView(Parameter& parameter, std::span<const PhysicalEnco
+         throw std::logic_error("modulation view has more modulators than slot depth positions");
+     }
+
+     const std::size_t missing = MissingModulationDepthCount(parameter);
+     const std::size_t available = parameter.Group().AvailableParameterSlots();
+     if (available < missing) {
+         parameter.Group().RequestParameterStorageBatch(missing - available);
+         return;
+     }
+
++    if (selected_ != nullptr) {
++        for (const Cell& cell : visible_) {
++            if (cell.parameter != nullptr && cell.parameter != selected_) {
++                cell.parameter->UnpinLocalForView();
++            }
++        }
++        selected_->UnpinLocalForView();
++    }
++
+     selected_ = &parameter;
++    selected_->PinLocalForView();
+     visible_.clear();
+
+     for (std::size_t cellIx = 0; cellIx < modulatorCount; ++cellIx) {
++        Parameter* depthParameter = EnsureModulationDepthParameter(parameter, cellIx);
++        if (depthParameter != nullptr) {
++            depthParameter->PinLocalForView();
++        }
+         visible_.push_back({
+             .encoderId = physicalLayout[cellIx],
+-            .parameter = EnsureModulationDepthParameter(parameter, cellIx),
++            .parameter = depthParameter,
+         });
+     }
+
+     visible_.push_back({
+         .encoderId = physicalLayout.back(),
+         .parameter = &parameter,
+     });
+     parameter.Group().RequestParameterStorageBatchIfLow();
+ }
+
+ void Bank::ApplyModifierToParameter(Parameter& parameter, Modifier modifier, const SceneState& scene) {
+     if (manager_ == nullptr) {
+         return;
+     }
+
++    ParameterGroup* affectedGroup = &parameter.Group();
+     switch (modifier) {
+     case Modifier::None:
+         break;
+     case Modifier::Reset:
+         parameter.RevertToDefault(scene);
+         break;
+     case Modifier::Random:
+         parameter.RandomizeVisibleValue(scene, manager_->NextRandomValue());
+         break;
+     case Modifier::RandomMod:
+         RandomizeModulationDepths(parameter, scene);
+         break;
+     }
++    if (modifier == Modifier::Reset) {
++        affectedGroup->CollectNeutralLocalParameters();
++    }
+ }
+
+ void Bank::RandomizeModulationDepths(Parameter& parameter, const SceneState& scene) {
+     if (manager_ == nullptr) {
+         return;
+     }
+
+     const std::size_t modulatorCount = parameter.Group().Config().numModulators;
+     if (modulatorCount == 0) {
+         return;
+@@ -2473,20 +2651,28 @@ bool ParameterManager::LoadParameterValuesFromJSON(JSON json) {
+         if (parameter == nullptr) {
+             continue;
+         }
+         parameter->LoadValuesFromJSON(JSON(members[ix].m_value));
+     }
+
+     ComputeAllParameters();
+     return true;
+ }
+
++std::size_t ParameterManager::CollectNeutralLocalParameters() {
++    std::size_t collected = 0;
++    for (const auto& group : groups_) {
++        collected += group->CollectNeutralLocalParameters();
++    }
++    return collected;
++}
++
+ void ParameterManager::ComputeAllParameters() {
+     for (Parameter* parameter : parameters_) {
+         if (parameter == nullptr) {
+             continue;
+         }
+         parameter->ComputeAtDepth(scene_, 0, false);
+         parameter->SnapCurrentToTarget();
+     }
+ }
+
+@@ -2544,20 +2730,21 @@ void ParameterManager::RevertAllToDefaults() {
+         const bool selected = gestureIx < defaultControlState_.gestureSelected.size() &&
+                               defaultControlState_.gestureSelected[gestureIx];
+         if (selected) {
+             SelectGesture(gestureIx);
+         } else {
+             DeselectGesture(gestureIx);
+         }
+     }
+
+     ComputeAllParameters();
++    CollectNeutralLocalParameters();
+ }
+
+ float ParameterManager::GetLinear(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const {
+     const float normalized = std::clamp(ParameterById(id).CachedKnobValue(voiceIx), 0.0f, 1.0f);
+     return LinearMap(minValue, maxValue, normalized);
+ }
+
+ float ParameterManager::GetExponential(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const {
+     const float normalized = std::clamp(ParameterById(id).CachedKnobValue(voiceIx), 0.0f, 1.0f);
+     return ExponentialMap(minValue, maxValue, normalized);
+diff --git a/projects/synth/src/PatchPersistence.cpp b/projects/synth/src/PatchPersistence.cpp
+index e0f76629..ea3d7bbf 100644
+--- a/projects/synth/src/PatchPersistence.cpp
++++ b/projects/synth/src/PatchPersistence.cpp
+@@ -283,21 +283,24 @@ bool LoadPatchJSON(JSON root, ParameterManager& manager,
+     (void)audioDevice;
+     if (!ValidPatchRoot(root) || !IsString(root.Get("patchName"))) {
+         return false;
+     }
+
+     const JSON parameterValues = root.Get("parameterValues");
+     if (!IsObject(parameterValues)) {
+         return false;
+     }
+
+-    manager.LoadParameterValuesFromJSON(parameterValues);
++    if (!manager.LoadParameterValuesFromJSON(parameterValues)) {
++        return false;
++    }
++    manager.CollectNeutralLocalParameters();
+     return true;
+ }
+
+ bool ValidatePatchJSON(JSON root) {
+     return ValidPatchRoot(root) && IsString(root.Get("patchName")) && IsObject(root.Get("parameterValues"));
+ }
+
+ std::string TimestampPatchFilename(std::chrono::system_clock::time_point now) {
+     const std::time_t time = std::chrono::system_clock::to_time_t(now);
+     std::tm tm{};
+diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
+index c5aac2c8..98326aeb 100644
+--- a/projects/synth/tests/parameter_modulation_tests.cpp
++++ b/projects/synth/tests/parameter_modulation_tests.cpp
+@@ -79,20 +79,73 @@ struct TestVisualizer final : synth::ui::Visualizer {
+ };
+
+ std::string JsonToString(synth::JSON json) {
+     char* dumped = json.Dumps(JSON_ENCODE_ANY);
+     REQUIRE_TRUE(dumped != nullptr);
+     std::string text(dumped);
+     std::free(dumped);
+     return text;
+ }
+
++bool JsonSemanticallyEqual(synth::JSON left, synth::JSON right) {
++    if (left.IsNull() || right.IsNull()) {
++        return left.IsNull() && right.IsNull();
++    }
++    const synth::JsonType leftType = left.m_node->m_type;
++    const synth::JsonType rightType = right.m_node->m_type;
++    const bool leftNumber = leftType == synth::JsonType::Integer || leftType == synth::JsonType::Real;
++    const bool rightNumber = rightType == synth::JsonType::Integer || rightType == synth::JsonType::Real;
++    if (leftNumber || rightNumber) {
++        return leftNumber && rightNumber && left.NumberValue() == right.NumberValue();
++    }
++    if (leftType != rightType) {
++        return false;
++    }
++
++    switch (leftType) {
++    case synth::JsonType::Null:
++        return true;
++    case synth::JsonType::Object: {
++        if (left.Size() != right.Size()) {
++            return false;
++        }
++        const synth::JsonMember* members =
++            static_cast<const synth::JsonMember*>(left.m_node->m_container.m_entries);
++        for (std::size_t ix = 0; ix < left.Size(); ++ix) {
++            if (members[ix].m_key == nullptr ||
++                !JsonSemanticallyEqual(synth::JSON(members[ix].m_value), right.Get(members[ix].m_key))) {
++                return false;
++            }
++        }
++        return true;
++    }
++    case synth::JsonType::Array:
++        if (left.Size() != right.Size()) {
++            return false;
++        }
++        for (std::size_t ix = 0; ix < left.Size(); ++ix) {
++            if (!JsonSemanticallyEqual(left.GetAt(ix), right.GetAt(ix))) {
++                return false;
++            }
++        }
++        return true;
++    case synth::JsonType::String:
++        return std::string(left.StringValue()) == std::string(right.StringValue());
++    case synth::JsonType::Boolean:
++        return left.BooleanValue() == right.BooleanValue();
++    case synth::JsonType::Integer:
++    case synth::JsonType::Real:
++        return false;
++    }
++    return false;
++}
++
+ void RequireRouteBijection(const synth::Parameter& parameter, std::size_t sourceCount);
+
+ // Wraps a single WrldBldr-kind MidiControllerProfileConfig (as produced by
+ // WrldBldrDefaultProfileConfig, whose system-message associations always
+ // carry both a control address and a wrldBldrPosition -- see
+ // SlotValidForKind's WrldBldr branch) plus a pair of endpoint identifiers
+ // into a one-controller MidiInstrumentConfig, for patch-persistence tests
+ // that used to build a bare MidiControllerProfileConfig + MidiEndpointState
+ // pair directly. Named "controller" to match MidiControllerSlot's default
+ // name so assertions reading loaded.controllers[0] read naturally.
+@@ -3629,27 +3682,33 @@ TEST_CASE(modulation_view_lazy_depth_names_include_target_parameter_for_duplicat
+     slot.AddPhysicalEncoder(1);
+     slot.AddPhysicalEncoder(2);
+     slot.SelectBank(&bank);
+
+     slot.HandlePress(1);
+     slot.HandlePress(2);
+     slot.HandlePress(2);
+
+     synth::Parameter* firstDepth = first.ModulationDepthParameter(0);
+     synth::Parameter* secondDepth = second.ModulationDepthParameter(0);
+-    REQUIRE_TRUE(firstDepth != nullptr);
++    REQUIRE_TRUE(firstDepth == nullptr);
+     REQUIRE_TRUE(secondDepth != nullptr);
+-    REQUIRE_TRUE(firstDepth->Name() == "Carrier A Filter Env");
+     REQUIRE_TRUE(secondDepth->Name() == "Carrier B Filter Env");
+-    REQUIRE_TRUE(firstDepth->ShortName() == "Env");
+     REQUIRE_TRUE(secondDepth->ShortName() == "Env");
+-    REQUIRE_TRUE(group.ParameterCount() == 4);
++    const std::size_t highWater = group.ParameterCount();
++
++    bank.Deselect();
++    slot.HandlePress(1);
++    firstDepth = first.ModulationDepthParameter(0);
++    REQUIRE_TRUE(firstDepth != nullptr);
++    REQUIRE_TRUE(firstDepth->Name() == "Carrier A Filter Env");
++    REQUIRE_TRUE(firstDepth->ShortName() == "Env");
++    REQUIRE_TRUE(group.ParameterCount() == highWater);
+     REQUIRE_TRUE(manager.ParameterCount() == 2);
+ }
+
+ TEST_CASE(pressing_modulation_cell_opens_nested_modulation_view) {
+     synth::ParameterManager manager;
+     manager.SetGestureCount(2);
+     auto& group = manager.CreateGroup({
+         .numVoices = 1,
+         .numModulators = 1,
+         .numScenes = 1,
+@@ -8427,20 +8486,31 @@ TEST_CASE(randomized_patch_lifecycle_preserves_recursive_local_modulation_depths
+             1, {.name = "Cutoff Env", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});
+         auto& lfoCurve = cutoffLfo.EnsureModulationDepth(
+             2, {.name = "Cutoff LFO Curve", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});
+         auto& resonanceLfo = resonance.EnsureModulationDepth(
+             0, {.name = "Resonance LFO", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});
+         REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
+         manager.SetSceneBlend(0.25f);
+         manager.CaptureDefaultControlState();
+
+         std::vector<synth::Parameter*> tracked{&cutoff, &resonance, &cutoffLfo, &cutoffEnv, &lfoCurve, &resonanceLfo};
++        auto refreshTrackedTopology = [&] {
++            synth::Parameter* liveCutoffLfo = cutoff.EnsureModulationDepth(0);
++            synth::Parameter* liveCutoffEnv = cutoff.EnsureModulationDepth(1);
++            synth::Parameter* liveResonanceLfo = resonance.EnsureModulationDepth(0);
++            REQUIRE_TRUE(liveCutoffLfo != nullptr);
++            REQUIRE_TRUE(liveCutoffEnv != nullptr);
++            REQUIRE_TRUE(liveResonanceLfo != nullptr);
++            synth::Parameter* liveLfoCurve = liveCutoffLfo->EnsureModulationDepth(2);
++            REQUIRE_TRUE(liveLfoCurve != nullptr);
++            tracked = {&cutoff, &resonance, liveCutoffLfo, liveCutoffEnv, liveLfoCurve, liveResonanceLfo};
++        };
+         RecursivePatchSnapshot expected = captureValues(tracked);
+         const RecursivePatchSnapshot defaultExpected = expected;
+
+         synth::WrldBldrDefaultProfileOptions midiOptions;
+         midiOptions.visibleEncoderCount = 5;
+         midiOptions.sceneCount = kSimScenes;
+         midiOptions.bankButtonCount = 2;
+         midiOptions.gestureSelectorCount = kSimGestures;
+         const synth::MidiControllerProfileConfig defaultProfile = synth::WrldBldrDefaultProfileConfig(midiOptions);
+         const synth::MidiInstrumentConfig defaultInstrument = MakeInstrumentFromProfile(defaultProfile);
+@@ -8460,20 +8530,21 @@ TEST_CASE(randomized_patch_lifecycle_preserves_recursive_local_modulation_depths
+         auto processPatchMessages = [&] {
+             synth::PatchMessageIn message;
+             while (inputBus.Pop(message)) {
+                 const synth::PatchApplyStatus status =
+                     synth::ApplyPatchMessage(message, manager, instrument, defaultInstrument,
+                                              audioDevice, defaultAudioDevice, outputBus);
+                 REQUIRE_TRUE(status == synth::PatchApplyStatus::Applied ||
+                              status == synth::PatchApplyStatus::Reverted ||
+                              status == synth::PatchApplyStatus::Serialized);
+             }
++            refreshTrackedTopology();
+         };
+
+         auto completePendingSave = [&](const RecursivePatchSnapshot& snapshot) {
+             processPatchMessages();
+             const auto now = std::chrono::system_clock::from_time_t(1700005000 + writeCounter++);
+             const synth::PatchCommandResult completion = patchManager.ProcessResponses(now);
+             REQUIRE_TRUE(completion.status == synth::PatchCommandStatus::Written);
+             savedVersions.push_back({completion.path, snapshot});
+             expectedCurrentPatchDir = completion.path.parent_path();
+         };
+@@ -11003,20 +11074,410 @@ TEST_CASE(active_modulation_routes_randomized_full_scan_oracle_and_work_bound) {
+         REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
+         manager.SetSceneBlend(static_cast<float>(step % 5) * 0.25f);
+         manager.ComputeAllTargets();
+         const std::size_t visitsBefore = work.activeRouteVisits;
+         carrier.ProcessLite();
+         REQUIRE_TRUE(work.activeRouteVisits - visitsBefore == carrier.ActiveRouteCount() * 2);
+         RequireFullScanCurrentMatch(carrier);
+     }
+ }
+
++TEST_CASE(neutral_local_collection_reclaims_leaf_and_preserves_high_water_accounting) {
++    synth::ParameterManager manager;
++    manager.SetGestureCount(64);
++    auto& group = manager.CreateGroup({.numVoices = 1,
++                                       .numModulators = 2,
++                                       .numScenes = 1,
++                                       .maxParameters = 5});
++    group.GetModulators().Metadata(0) = {.name = "Old", .shortName = "Old", .sourceColor = synth::Color::Red};
++    group.GetModulators().Metadata(1) = {.name = "New", .shortName = "New", .sourceColor = synth::Color::Cyan};
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .shortName = "Car", .defaultValue = 0.4f});
++    auto& other = manager.CreateParameter(group, {.name = "Other", .shortName = "Oth", .defaultValue = 0.6f});
++    synth::Parameter* oldLocal = &carrier.EnsureModulationDepth(
++        0, {.name = "Old Local",
++            .shortName = "Old",
++            .defaultValue = 0.5f,
++            .range = synth::RangeKind::Bipolar,
++            .switchValues = 7,
++            .baseColor = synth::Color::Red,
++            .indicatorColors = {synth::Color::Orange}});
++    REQUIRE_TRUE(oldLocal != nullptr);
++    const synth::Parameter* carrierAddress = &carrier;
++    const synth::Parameter* otherAddress = &other;
++    const std::size_t recycledStorageIx = group.ParameterCount() - 1;
++    REQUIRE_TRUE(&group.ParameterByLocalIndex(recycledStorageIx) == oldLocal);
++
++    const std::size_t highWater = group.ParameterCount();
++    const std::size_t availableBefore = group.AvailableParameterSlots();
++    REQUIRE_TRUE(group.LiveLocalParameterCount() == 1);
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
++    REQUIRE_TRUE(group.ParameterCount() == highWater);
++    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
++    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
++    REQUIRE_TRUE(group.AvailableParameterSlots() == availableBefore + 1);
++
++    synth::Parameter* reused = other.EnsureModulationDepth(1);
++    REQUIRE_TRUE(reused != nullptr);
++    REQUIRE_TRUE(group.ParameterCount() == highWater);
++    REQUIRE_TRUE(group.LiveLocalParameterCount() == 1);
++    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 0);
++    REQUIRE_TRUE(&carrier == carrierAddress);
++    REQUIRE_TRUE(&other == otherAddress);
++    REQUIRE_TRUE(&group.ParameterByLocalIndex(recycledStorageIx) == reused);
++    REQUIRE_TRUE(reused->Name() == "Other New");
++    REQUIRE_TRUE(reused->ShortName() == "New");
++    REQUIRE_TRUE(reused->BaseColor() == synth::Color::Cyan);
++    REQUIRE_TRUE(reused->Range() == synth::RangeKind::Bipolar);
++    REQUIRE_TRUE(reused->SwitchValues() == 0);
++    REQUIRE_NEAR(reused->SceneCenter(0), 0.5f, 0.000001f);
++    REQUIRE_NEAR(reused->CurrentCenter(), 0.5f, 0.000001f);
++    REQUIRE_NEAR(reused->TargetCenter(), 0.5f, 0.000001f);
++    REQUIRE_NEAR(reused->CurrentCenterScale(0), 1.0f, 0.000001f);
++    REQUIRE_NEAR(reused->TargetCenterScale(0), 1.0f, 0.000001f);
++    REQUIRE_NEAR(reused->CurrentNormalizationOffset(0), 0.0f, 0.000001f);
++    REQUIRE_NEAR(reused->TargetNormalizationOffset(0), 0.0f, 0.000001f);
++    REQUIRE_TRUE(reused->ActiveRouteCount() == 0);
++    REQUIRE_TRUE(reused->RouteSourceIndex(0) == 0);
++    REQUIRE_TRUE(reused->RouteSourceIndex(1) == 1);
++    REQUIRE_TRUE(reused->ModulationDepthParameter(0) == nullptr);
++    REQUIRE_TRUE(reused->ModulationDepthParameter(1) == nullptr);
++    REQUIRE_NEAR(reused->GestureValue(0, 32), 0.5f, 0.000001f);
++    REQUIRE_NEAR(reused->GestureValue(0, 63), 0.5f, 0.000001f);
++    REQUIRE_TRUE(!reused->GestureActive(0, 32));
++    REQUIRE_TRUE(!reused->GestureActive(0, 63));
++    synth::Parameter::UIState ui(1, 2, 64);
++    reused->PopulateUIState(ui);
++    REQUIRE_NEAR(ui.values[0].load(), 0.0f, 0.000001f);
++    REQUIRE_NEAR(ui.spreadValues[0].load(), 0.0f, 0.000001f);
++    REQUIRE_NEAR(ui.minValues[0].load(), 0.0f, 0.000001f);
++    REQUIRE_NEAR(ui.maxValues[0].load(), 0.0f, 0.000001f);
++    REQUIRE_TRUE(ui.modulatorsAffectingMask.load() == 0);
++    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == 0);
++}
++
++TEST_CASE(neutral_local_collection_retains_non_default_scene_state) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 2, .maxParameters = 2});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto* depth = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    depth->SceneCenter(1) = 0.6f;
++
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
++}
++
++TEST_CASE(neutral_local_collection_retains_inactive_latent_gesture_value) {
++    synth::ParameterManager manager;
++    manager.SetGestureCount(64);
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto* depth = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    depth->GestureValue(0, 63) = 0.6f;
++    REQUIRE_TRUE(!depth->GestureActive(0, 63));
++
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
++}
++
++TEST_CASE(neutral_local_collection_retains_active_gesture_at_default_value) {
++    synth::ParameterManager manager;
++    manager.SetGestureCount(64);
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto* depth = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    depth->SetGestureActive(0, 32, true);
++
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
++}
++
++TEST_CASE(neutral_local_collection_retains_unsnapped_runtime_state) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 1,
++                                       .numModulators = 1,
++                                       .numScenes = 1,
++                                       .maxParameters = 2,
++                                       .targetCenterAlpha = 1.0f});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto* depth = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    depth->SceneCenter(0) = 0.75f;
++    manager.ComputeAllParameters();
++    depth->SceneCenter(0) = 0.5f;
++
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
++}
++
++TEST_CASE(neutral_local_collection_retains_nonzero_normalization_state) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 1,
++                                       .numModulators = 1,
++                                       .numScenes = 1,
++                                       .maxParameters = 3,
++                                       .targetCenterAlpha = 1.0f});
++    group.GetModulators().Value(0, 0) = 1.0f;
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto* depth = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    auto* nested = depth->EnsureModulationDepth(0);
++    REQUIRE_TRUE(nested != nullptr);
++    nested->SceneCenter(0) = 0.25f;
++    manager.ComputeAllParameters();
++    REQUIRE_TRUE(depth->CurrentNormalizationOffset(0) > 0.0f);
++    REQUIRE_TRUE(depth->TargetNormalizationOffset(0) > 0.0f);
++
++    depth->ClearModulationDepths();
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
++
++    REQUIRE_TRUE(depth->AssignModulationDepth(0, nested));
++    depth->RevertAllToDefault();
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 2);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
++}
++
++TEST_CASE(neutral_local_collection_retains_parent_with_non_collectible_child) {
++    synth::ParameterManager manager;
++    manager.SetGestureCount(1);
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 3});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto* depth = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    auto* nested = depth->EnsureModulationDepth(1);
++    REQUIRE_TRUE(nested != nullptr);
++    nested->GestureValue(0, 0) = 0.6f;
++
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
++    REQUIRE_TRUE(depth->ModulationDepthParameter(1) == nested);
++}
++
++TEST_CASE(neutral_local_collection_collapses_recursive_subtree_bottom_up) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 3});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto* depth = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    REQUIRE_TRUE(depth->EnsureModulationDepth(1) != nullptr);
++    const std::size_t highWater = group.ParameterCount();
++
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 2);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
++    REQUIRE_TRUE(group.ParameterCount() == highWater);
++    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
++    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 2);
++}
++
++TEST_CASE(neutral_local_collection_detaches_child_while_parent_route_finishes_settling) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 1,
++                                       .numModulators = 1,
++                                       .numScenes = 1,
++                                       .maxParameters = 2,
++                                       .processLiteAlpha = 0.5f,
++                                       .targetCenterAlpha = 1.0f});
++    group.GetModulators().Value(0, 0) = 1.0f;
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto* depth = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    depth->SceneCenter(0) = 0.75f;
++    manager.ComputeAllParameters();
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
++    REQUIRE_TRUE(std::fabs(carrier.CurrentDepthForSource(0, 0)) > 0.000001f);
++
++    depth->SceneCenter(0) = 0.5f;
++    manager.ComputeAllTargets();
++    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.0f, 0.000001f);
++    REQUIRE_TRUE(std::fabs(carrier.CurrentDepthForSource(0, 0)) > 0.000001f);
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
++
++    for (std::size_t step = 0; step < 32 && carrier.ActiveRouteCount() != 0; ++step) {
++        carrier.ProcessLite();
++        manager.ComputeAllTargets();
++    }
++    REQUIRE_TRUE(carrier.ActiveRouteCount() == 0);
++    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), 0.0f, 0.000001f);
++}
++
++TEST_CASE(modulation_view_pins_visible_locals_until_deselect_boundary) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 3});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    auto& bank = manager.CreateBank();
++    bank.AddMapping(10, carrier);
++    auto& slot = manager.CreateBankSlot();
++    slot.AddPhysicalEncoder(10);
++    slot.AddPhysicalEncoder(11);
++    slot.AddPhysicalEncoder(12);
++    slot.SelectBank(&bank);
++
++    slot.HandlePress(10);
++    REQUIRE_TRUE(bank.ShowingModulation());
++    REQUIRE_TRUE(group.LiveLocalParameterCount() == 2);
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == bank.VisibleParameter(10));
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(1) == bank.VisibleParameter(11));
++
++    bank.Deselect();
++    REQUIRE_TRUE(!bank.ShowingModulation());
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(1) == nullptr);
++    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
++    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 2);
++}
++
++TEST_CASE(revert_all_collects_neutral_local_topology_at_control_boundary) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
++    manager.CaptureDefaultControlState();
++    auto* depth = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    depth->SceneCenter(0) = 0.75f;
++
++    manager.RevertAllToDefaults();
++
++    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
++    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
++    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
++}
++
++TEST_CASE(neutral_local_reuse_stays_bounded_beyond_configured_capacity) {
++    synth::ParameterManager manager;
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
++    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.25f});
++    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.75f});
++    group.AddParameterStorageBatch(synth::MakeParameterStorageBatch(group.Config(), group.GestureCount(), 1));
++
++    for (std::size_t iteration = 0; iteration < group.Config().maxParameters * 4; ++iteration) {
++        synth::Parameter& parent = (iteration & 1U) == 0 ? first : second;
++        REQUIRE_TRUE(parent.EnsureModulationDepth(0) != nullptr);
++        REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
++        REQUIRE_TRUE(parent.ModulationDepthParameter(0) == nullptr);
++    }
++    REQUIRE_TRUE(group.ParameterCount() == 3);
++    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
++    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
++}
++
++TEST_CASE(randomized_neutral_local_collection_reuses_slots_without_stale_topology) {
++    synth::ParameterManager manager;
++    manager.SetGestureCount(64);
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 2, .maxParameters = 5});
++    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.25f});
++    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.75f});
++    auto& third = manager.CreateParameter(group, {.name = "Third", .defaultValue = 0.5f});
++    std::array<synth::Parameter*, 3> parents = {&first, &second, &third};
++    std::mt19937 random(0x74c011ecU);
++
++    for (std::size_t step = 0; step < 128; ++step) {
++        synth::Parameter& parent = *parents[random() % parents.size()];
++        const std::size_t sourceIx = random() % 2;
++        synth::Parameter* local = parent.EnsureModulationDepth(sourceIx);
++        REQUIRE_TRUE(local != nullptr);
++        if ((random() & 3U) == 0) {
++            local->GestureValue(1, 63) = 0.75f;
++            REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
++            REQUIRE_TRUE(parent.ModulationDepthParameter(sourceIx) == local);
++            local->RevertAllToDefault();
++        }
++        REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
++        REQUIRE_TRUE(parent.ModulationDepthParameter(sourceIx) == nullptr);
++        REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
++        REQUIRE_TRUE(group.ParameterCount() <= 4);
++    }
++    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
++}
++
++TEST_CASE(patch_load_collection_preserves_high_gesture_nested_state_and_collects_default_omissions) {
++    synth::ParameterManager source;
++    source.SetGestureCount(64);
++    auto& sourceGroup = source.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 4});
++    auto& sourceCarrier = source.CreateParameter(sourceGroup, {.name = "Carrier", .defaultValue = 0.25f});
++    auto* sourceDepth = sourceCarrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(sourceDepth != nullptr);
++    auto* sourceNested = sourceDepth->EnsureModulationDepth(1);
++    REQUIRE_TRUE(sourceNested != nullptr);
++    sourceDepth->GestureValue(0, 32) = 0.7f;
++    sourceDepth->SetGestureActive(0, 32, true);
++    sourceNested->GestureValue(0, 63) = 0.8f;
++    sourceNested->SetGestureActive(0, 63, true);
++
++    synth::JsonArena patchArena(262144);
++    synth::MidiInstrumentConfig instrument;
++    synth::AudioDeviceState audio;
++    synth::JSON patch = synth::BuildPatchJSON(patchArena, "GC", source, instrument, audio);
++    REQUIRE_TRUE(!patchArena.Failed());
++
++    synth::ParameterManager target;
++    target.SetGestureCount(64);
++    auto& targetGroup = target.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 5});
++    auto& targetCarrier = target.CreateParameter(targetGroup, {.name = "Carrier", .defaultValue = 0.25f});
++    REQUIRE_TRUE(targetCarrier.EnsureModulationDepth(1) != nullptr);  // absent/default dirty topology
++    REQUIRE_TRUE(synth::LoadPatchJSON(patch, target, instrument, &audio));
++
++    auto* targetDepth = targetCarrier.ModulationDepthParameter(0);
++    REQUIRE_TRUE(targetDepth != nullptr);
++    auto* targetNested = targetDepth->ModulationDepthParameter(1);
++    REQUIRE_TRUE(targetNested != nullptr);
++    REQUIRE_NEAR(targetDepth->GestureValue(0, 32), 0.7f, 0.000001f);
++    REQUIRE_TRUE(targetDepth->GestureActive(0, 32));
++    REQUIRE_NEAR(targetNested->GestureValue(0, 63), 0.8f, 0.000001f);
++    REQUIRE_TRUE(targetNested->GestureActive(0, 63));
++    REQUIRE_TRUE(targetCarrier.ModulationDepthParameter(1) == nullptr);
++    REQUIRE_TRUE(targetGroup.LiveLocalParameterCount() == 2);
++
++    const float outputBeforeRematerialization = targetCarrier.GetRaw(0);
++    synth::Parameter* rematerialized = targetCarrier.EnsureModulationDepth(1);
++    REQUIRE_TRUE(rematerialized != nullptr);
++    target.ComputeAllParameters();
++    REQUIRE_NEAR(targetCarrier.GetRaw(0), outputBeforeRematerialization, 0.000001f);
++    REQUIRE_TRUE(rematerialized->Name() == "Carrier Mod Depth 2");
++    REQUIRE_NEAR(rematerialized->SceneCenter(0), 0.5f, 0.000001f);
++    REQUIRE_NEAR(rematerialized->GestureValue(0, 32), 0.5f, 0.000001f);
++    REQUIRE_NEAR(rematerialized->GestureValue(0, 63), 0.5f, 0.000001f);
++    REQUIRE_TRUE(!rematerialized->GestureActive(0, 32));
++    REQUIRE_TRUE(!rematerialized->GestureActive(0, 63));
++    REQUIRE_TRUE(rematerialized->ActiveRouteCount() == 0);
++    REQUIRE_TRUE(targetGroup.CollectNeutralLocalParameters() == 1);
++    REQUIRE_TRUE(targetCarrier.ModulationDepthParameter(1) == nullptr);
++    REQUIRE_TRUE(targetGroup.LiveLocalParameterCount() == 2);
++}
++
++TEST_CASE(eligible_collection_preserves_semantic_parameter_json) {
++    synth::ParameterManager manager;
++    manager.SetGestureCount(1);
++    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 4});
++    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.25f});
++    auto* neutral = carrier.EnsureModulationDepth(0);
++    REQUIRE_TRUE(neutral != nullptr);
++    auto* retained = carrier.EnsureModulationDepth(1);
++    REQUIRE_TRUE(retained != nullptr);
++    retained->GestureValue(0, 0) = 0.75f;
++
++    synth::JsonArena beforeArena(65536);
++    const synth::JSON before = manager.ParameterValuesToJSON(beforeArena);
++    REQUIRE_TRUE(!beforeArena.Failed());
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
++    synth::JsonArena afterArena(65536);
++    const synth::JSON after = manager.ParameterValuesToJSON(afterArena);
++    REQUIRE_TRUE(!afterArena.Failed());
++    REQUIRE_TRUE(JsonSemanticallyEqual(before, after));
++}
++
+ namespace {
+
+ // Regression for slog-2: MidiSender's worker thread (Run()) must tag itself
+ // with ThreadId::MidiSender so log messages produced while sending (and any
+ // future thread-identity-sensitive code on that thread) observe the correct
+ // identity. This sink records synth::GetCurrentThreadId() as observed from
+ // inside Send(), which runs on the sender's worker thread.
+ struct RecordingMidiOutputSink final : synth::IMidiOutputSink {
+     std::mutex mutex;
+     std::optional<synth::ThreadId> observedThreadId;
diff --git a/.superpowers/sdd/scale-modulation-processing/task-5-brief.md b/.superpowers/sdd/scale-modulation-processing/task-5-brief.md
new file mode 100644
index 00000000..64daa06a
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-5-brief.md
@@ -0,0 +1,60 @@
+### Task 5: Randomized, Persistence, UI, and Controller Integration
+
+**OpenSpec coverage:** tasks 2.4, 4.5, 5.5-5.6, and modified `spm-25` as an integrated state-machine requirement.
+
+**Files:**
+- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — manager-owned 64-gesture oracle, permutations, collection/reuse actions, failure diagnostics.
+- Modify: `projects/synth/tests/portable_ui_tests.cpp` — full snapshot-to-render bit-63 path.
+- Modify: `projects/synth/tests/instrument_tests.cpp` — gesture/controller integration.
+- Modify: `projects/synth/tests/browser_command_buffer_tests.cpp` only if an existing draw-command expectation changes because badge text changes; do not add mask fields or versions.
+
+**Interfaces:**
+- Consumes: all Tasks 1-4 production APIs.
+- Produces: deterministic reference-model coverage for stable route identity, 64-bit masks, slot collection/reuse, and semantic JSON.
+
+- [ ] **Step 1: Extend the randomized model before its production-action wiring**
+
+Change simulated gesture selectors and expected affecting masks to `std::uint64_t`. Store `routeSourceIndices`, inverse positions, `activeRouteCount`, live/free slot identity, and pin state in `SimParam`/`SimOracle`. Add deterministic operations for gesture indices 32/63, route activation/removal, bank open/close, reset/revert, collect, reuse under a distinct parent, and patch load.
+
+After every action validate both models with an error payload containing seed, step, action/message, random samples consumed, stable source index, route slot, expected/actual mask, and expected/actual current/target value.
+
+- [ ] **Step 2: Run the oracle and observe RED model/production mismatches**
+
+```bash
+make -C projects/synth build/parameter_modulation_tests
+projects/synth/build/parameter_modulation_tests
+```
+
+Expected: the newly modeled actions fail until their message/view/collection wiring and comparison extraction are complete; failures print the deterministic seed and step.
+
+- [ ] **Step 3: Wire all existing external operations through the extended oracle**
+
+Drive edits only through `MessageInBus` where a message exists, including normal and modified bank selection. Preserve the production random-source consumption order by drawing exactly the same samples in the oracle. Populate UI periodically and compare connected cells' centers, spreads, switch buckets, bipolar/min/max metadata, colors, all visible modulator bits, gesture bits `0..63`, manager gesture state, scenes/blend, modifiers, and selected bank/view state.
+
+For GC-only control-boundary operations with no message type, invoke the same public manager/bank API used by production and mirror it in the oracle; do not invent a browser or patch wire command.
+
+- [ ] **Step 4: Finish cross-surface integration assertions**
+
+In portable UI, pass a real `Parameter::UIState` carrying bit 63 through snapshot and renderer and assert the distinct `64` badge command. In instrument/controller tests, verify controller gesture index 63 selects/edits the same manager gesture and that bank-affecting masks remain 32-bit bank selectors. Run browser command-buffer tests only to prove rendered command output remains valid; make no serialization/layout change.
+
+- [ ] **Step 5: Run integration tests, commit, and pass the global Claude gate**
+
+```bash
+make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/instrument_tests build/browser_command_buffer_tests
+projects/synth/build/parameter_modulation_tests
+projects/synth/build/portable_ui_tests
+projects/synth/build/instrument_tests
+projects/synth/build/browser_command_buffer_tests
+```
+
+Expected: all four binaries exit 0 and repeated runs use the same seeds and consume identical samples. Then:
+
+```bash
+git add projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/portable_ui_tests.cpp projects/synth/tests/instrument_tests.cpp projects/synth/tests/browser_command_buffer_tests.cpp
+git commit -m "test(synth): cover sparse modulation lifecycle end to end"
+```
+
+If `browser_command_buffer_tests.cpp` is unchanged, omit it from `git add`. Run the global Sonnet gate and record both passing verdicts.
+
+---
+
diff --git a/.superpowers/sdd/scale-modulation-processing/task-5-report.md b/.superpowers/sdd/scale-modulation-processing/task-5-report.md
new file mode 100644
index 00000000..ba541d7c
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-5-report.md
@@ -0,0 +1,55 @@
+# Task 5 Report: Randomized, Persistence, UI, and Controller Integration
+
+## Outcome
+
+Implemented Task 5 as a test-only change. No production defect was found and no production or browser protocol/layout file was changed.
+
+## Test changes
+
+- Migrated the shared randomized parameter oracle from two gestures and per-gesture booleans to 64 gesture values, 64-bit per-scene active masks, and a 64-bit manager selection mask.
+- Added exact reference-model route state: stable route-source permutation, inverse source positions, and active-prefix count. The randomized checks now compare every route slot and inverse position, as well as every source-indexed current/target depth and output value.
+- Added deterministic MessageInBus coverage for gesture indices 32 and 63, including selection, values, edit arming, and visible UI mask bits.
+- Added seed/step/action/random-consumption diagnostics to every message-bus randomized action. The random-value, coin, and index streams still enforce exact drain order.
+- Extended periodic UI comparison to include selected bank/view state, all 64 gesture selected/value entries, all visible modulator and gesture mask bits, source and gesture colors/counts, centers, spreads, switch buckets, bipolar/min/max values, and manager modifiers/scenes.
+- Added a MessageInBus/public-manager lifecycle model covering open, reset while pinned, explicit collect, close, exact storage-identity reuse under a distinct parent, gesture-63 persistence, revert, and patch-load rematerialization. It compares live/free counts at every boundary.
+- Replaced the portable UI's manually constructed high-gesture draw state with a real `Parameter::UIState` carrying bit 63 through `EncoderDrawStateFromParameter` and renderer output, asserting badge `64`.
+- Added controller integration using real system-button and analog MIDI processors through `MessageInBus`; gesture 63 selects, receives a value, arms, and edits the same manager gesture. The test also statically and dynamically verifies that `bankAffectingMask` remains a 32-bit bank selector.
+- Left `browser_command_buffer_tests.cpp` unchanged because rendered command expectations and wire layout did not change; the existing binary was rebuilt and run.
+
+## TDD evidence
+
+RED was observed after widening the oracle to 64 gestures but before wiring every simulation manager:
+
+```text
+[FAIL] randomized_parameter_modulation_simulation: gesture index out of range
+```
+
+All unrelated tests in that run passed. Wiring the simulation manager to the 64-gesture topology made the seeded run green. A later lifecycle assertion initially failed because the gesture weight was still zero; the test was corrected to drive the existing `SetGestureValue` message before editing, then passed without a production change.
+
+## Verification
+
+The prescribed build and binaries all exited 0:
+
+```text
+make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/instrument_tests build/browser_command_buffer_tests
+projects/synth/build/parameter_modulation_tests
+projects/synth/build/portable_ui_tests
+projects/synth/build/instrument_tests
+projects/synth/build/browser_command_buffer_tests
+```
+
+The parameter binary was then repeated twice with identical explicit inputs; both runs exited 0 and used the same seed/step schedule:
+
+```text
+SYNTH_RANDOM_SEEDS=0x51A7,0xC0FFEE,0xA11CE SYNTH_RANDOM_STEPS=250 projects/synth/build/parameter_modulation_tests
+```
+
+`git diff --check` passed. Builds emitted no warnings after the final edits.
+
+## Files intended for the Task 5 commit
+
+- `projects/synth/tests/parameter_modulation_tests.cpp`
+- `projects/synth/tests/portable_ui_tests.cpp`
+- `projects/synth/tests/instrument_tests.cpp`
+
+The Task 5 brief and this report remain uncommitted as requested.
diff --git a/.superpowers/sdd/scale-modulation-processing/task-5-review-package.md b/.superpowers/sdd/scale-modulation-processing/task-5-review-package.md
new file mode 100644
index 00000000..e2d148b4
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-5-review-package.md
@@ -0,0 +1,1288 @@
+# Review package: 5115cdf9..5d0bc6fb
+
+## Commits
+5d0bc6fb test(synth): cover sparse modulation lifecycle end to end
+
+## Files changed
+ projects/synth/tests/instrument_tests.cpp          |  47 +++
+ .../synth/tests/parameter_modulation_tests.cpp     | 452 ++++++++++++++++++---
+ projects/synth/tests/portable_ui_tests.cpp         |  16 +-
+ 3 files changed, 449 insertions(+), 66 deletions(-)
+
+## Diff
+diff --git a/projects/synth/tests/instrument_tests.cpp b/projects/synth/tests/instrument_tests.cpp
+index b9525422..c13dc797 100644
+--- a/projects/synth/tests/instrument_tests.cpp
++++ b/projects/synth/tests/instrument_tests.cpp
+@@ -1,20 +1,21 @@
+ #include "synth/MidiController.hpp"
+
+ #ifdef JUCE_MAJOR_VERSION
+ #error "synth module tests must not see JUCE headers"
+ #endif
+
+ #include <iostream>
+ #include <sstream>
+ #include <stdexcept>
+ #include <string>
++#include <type_traits>
+ #include <vector>
+
+ namespace {
+
+ struct TestCase {
+     const char* name;
+     void (*fn)();
+ };
+
+ std::vector<TestCase>& Registry() {
+@@ -122,20 +123,66 @@ TEST_CASE(MessageInJsonRoundTripsHighGestureIndex) {
+     const synth::MessageIn source = synth::MessageIn::SetGestureSelect(17, 63, true);
+     const synth::JSON json = synth::ToJSON(arena, source);
+     synth::MessageIn target;
+     REQUIRE_TRUE(synth::FromJSON(json, target));
+     REQUIRE_TRUE(target.type == synth::MessageIn::Type::SetGestureSelect);
+     REQUIRE_TRUE(target.gestureIx == 63);
+     REQUIRE_TRUE(target.boolValue);
+     REQUIRE_TRUE(target.hasBoolValue);
+ }
+
++TEST_CASE(ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit) {
++    synth::ParameterManager manager;
++    REQUIRE_TRUE(manager.SetGestureCount(64));
++    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
++    auto& parameter = manager.CreateParameter(group, {.name = "High Gesture", .defaultValue = 0.25f});
++    auto& bank = manager.CreateBank();
++    bank.AddMapping(77, parameter);
++    auto& slot = manager.CreateBankSlot();
++    slot.AddPhysicalEncoder(77);
++    slot.SelectBank(&bank);
++
++    synth::MessageInBus bus(&manager, 16);
++    synth::SystemButtonMidiInConfig buttonConfig;
++    buttonConfig.associations.push_back({
++        .control = synth::MidiControlAddress{.channel = 2, .cc = 9},
++        .press = synth::MessageIn::SetGestureSelect(0, 63, true),
++        .release = synth::MessageIn::SetGestureSelect(0, 63, false),
++    });
++    synth::SystemButtonMidiInProcessor buttons(buttonConfig, &bus);
++    buttons.SetTimestampProvider([] { return 41; });
++    buttons.Process(synth::BasicMidi::CC(0, 2, 9, 127));
++    bus.Process(41);
++    REQUIRE_TRUE(manager.GestureSelected(63));
++
++    synth::AnalogMidiInConfig analogConfig;
++    analogConfig.gestures.push_back({.control = {.channel = 2, .cc = 10}, .gestureIx = 63});
++    synth::AnalogMidiInProcessor analog(analogConfig, &bus);
++    analog.SetTimestampProvider([] { return 42; });
++    analog.Process(synth::BasicMidi::CC(0, 2, 10, 127));
++    bus.Process(42);
++    REQUIRE_TRUE(manager.GestureValue(63) == 1.0f);
++
++    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(43, 0, 0, 0.1f)));
++    bus.Process(43); // first turn arms the selected gesture
++    REQUIRE_TRUE(parameter.GestureActive(0, 63));
++    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(44, 0, 0, 0.1f)));
++    bus.Process(44); // second turn edits that same active manager gesture
++    REQUIRE_TRUE(parameter.GestureValue(0, 63) > 0.25f);
++
++    auto ui = manager.CreateUIState();
++    manager.PopulateUIState(*ui);
++    static_assert(std::is_same_v<decltype(ui->gestures.bankAffectingMask[0].load()), std::uint32_t>);
++    REQUIRE_TRUE(ui->gestures.bankAffectingMask[63].load() == 1u);
++    REQUIRE_TRUE(ui->gestures.bankAffectingCount[63].load() == 1);
++}
++
+ TEST_CASE(KindNameFromUnknownRejected) {
+     MidiProfileKind kind = MidiProfileKind::Generic;
+     REQUIRE_TRUE(!synth::MidiProfileKindFromName("bogus", kind));
+     REQUIRE_TRUE(!synth::MidiProfileKindFromName("", kind));
+     REQUIRE_TRUE(!synth::MidiProfileKindFromName("WrldBldr", kind));
+ }
+
+ TEST_CASE(KindSupportMatrix) {
+     const MidiKindSupport wrldbldr = synth::KindSupport(MidiProfileKind::WrldBldr);
+     REQUIRE_TRUE(wrldbldr.encoders);
+diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
+index 98326aeb..d0e6fdda 100644
+--- a/projects/synth/tests/parameter_modulation_tests.cpp
++++ b/projects/synth/tests/parameter_modulation_tests.cpp
+@@ -6175,72 +6175,87 @@ TEST_CASE(clear_gesture_active_flags_for_active_scene_selection) {
+     REQUIRE_TRUE(first.GestureActive(2, 0));
+     REQUIRE_TRUE(!second.GestureActive(0, 0));
+     REQUIRE_TRUE(!second.GestureActive(1, 0));
+ }
+
+ namespace {
+
+ constexpr std::size_t kSimParams = 3;
+ constexpr std::size_t kSimVoices = 4;
+ constexpr std::size_t kSimMods = 3;
+-constexpr std::size_t kSimGestures = 2;
++constexpr std::size_t kSimGestures = 64;
+ constexpr std::size_t kSimScenes = 3;
+ constexpr std::array<synth::PhysicalEncoderId, 5> kSimSlotEncoders{10, 11, 12, 20, 21};
+
+ struct SimCell {
+     synth::PhysicalEncoderId encoder = 0;
+     int parameter = -1;
+ };
+
+ struct SimBank {
+     std::vector<SimCell> top;
+     std::vector<SimCell> visible;
+     int selectedParameter = -1;
+ };
+
+ struct SimParam {
+     synth::RangeKind range = synth::RangeKind::Unipolar;
+     float defaultValue = 0.0f;
+     std::size_t switchValues = 0;
+     std::array<float, kSimScenes> sceneCenter{};
+     std::array<std::array<float, kSimGestures>, kSimScenes> gestureValue{};
+-    std::array<std::array<bool, kSimGestures>, kSimScenes> gestureActive{};
++    std::array<synth::GestureMask, kSimScenes> gestureActiveMasks{};
+     std::array<int, kSimMods> route{};
++    std::array<std::size_t, kSimMods> routeSourceIndices{};
++    std::array<std::size_t, kSimMods> sourceRoutePositions{};
++    std::size_t activeRouteCount = 0;
+     float currentCenter = 0.0f;
+     float targetCenter = 0.0f;
+     std::array<float, kSimVoices> currentCenterScale{};
+     std::array<float, kSimVoices> targetCenterScale{};
+     std::array<float, kSimVoices> currentNormalizationOffset{};
+     std::array<float, kSimVoices> targetNormalizationOffset{};
+     std::array<float, kSimVoices> currentMinValue{};
+     std::array<float, kSimVoices> targetMinValue{};
+     std::array<float, kSimVoices> currentMaxValue{};
+     std::array<float, kSimVoices> targetMaxValue{};
+     std::array<std::array<float, kSimMods>, kSimVoices> currentDepth{};
+     std::array<std::array<float, kSimMods>, kSimVoices> targetDepth{};
+     std::array<float, kSimVoices> cachedKnob{};
+     std::array<float, kSimVoices> uiDisplayCenter{};
+     std::array<float, kSimVoices> uiDisplaySpreadEnergy{};
+ };
+
++struct SimLocalSlot {
++    std::size_t storageIdentity = 0;
++    int parentParameter = -1;
++    std::size_t sourceIx = 0;
++    bool live = false;
++    bool free = false;
++    bool pinned = false;
++};
++
+ struct SimOracle {
+     synth::SceneState scene{.leftScene = 0, .rightScene = 1, .blend = 0.25f};
+     std::optional<synth::PageOrdinal> activePage = 0;
+     int selectedBank = 0;
+     bool resetHeld = false;
+     bool randomHeld = false;
+     bool randomModHeld = false;
+     std::array<SimBank, 2> banks;
+     std::array<float, kSimGestures> gestureWeight{};
+-    std::array<bool, kSimGestures> gestureSelected{};
++    synth::GestureMask gestureSelectedMask = 0;
+     std::array<std::array<float, kSimMods>, kSimVoices> modulatorValue{};
+     std::array<SimParam, kSimParams> params;
++    std::array<SimLocalSlot, kSimMods> localSlots{};
++    std::size_t liveLocalCount = 0;
++    std::size_t freeLocalCount = 0;
+ };
+
+ struct SimRandomSamples {
+     std::vector<float> values;
+     std::vector<float> coins;
+     std::vector<std::size_t> indices;
+     std::size_t valueIx = 0;
+     std::size_t coinIx = 0;
+     std::size_t indexIx = 0;
+
+@@ -6277,22 +6292,103 @@ struct SimRandomSamples {
+     void RequireDrained(unsigned seed, int step, const std::string& action) const {
+         if (valueIx != values.size() || coinIx != coins.size() || indexIx != indices.size()) {
+             std::ostringstream oss;
+             oss << "seed " << seed << " step " << step << " action " << action
+                 << " random samples not fully consumed values=" << valueIx << "/" << values.size()
+                 << " coins=" << coinIx << "/" << coins.size()
+                 << " indices=" << indexIx << "/" << indices.size();
+             throw std::runtime_error(oss.str());
+         }
+     }
++
++    std::string ConsumptionSummary() const {
++        std::ostringstream oss;
++        oss << "values=" << valueIx << "/" << values.size()
++            << ",coins=" << coinIx << "/" << coins.size()
++            << ",indices=" << indexIx << "/" << indices.size();
++        return oss.str();
++    }
+ };
+
++bool SimGestureActive(const SimParam& parameter, std::size_t sceneIx, std::size_t gestureIx) {
++    return (parameter.gestureActiveMasks[sceneIx] & (synth::GestureMask{1} << gestureIx)) != 0;
++}
++
++void SimSetGestureActive(SimParam& parameter, std::size_t sceneIx, std::size_t gestureIx, bool active) {
++    const synth::GestureMask bit = synth::GestureMask{1} << gestureIx;
++    if (active) {
++        parameter.gestureActiveMasks[sceneIx] |= bit;
++    } else {
++        parameter.gestureActiveMasks[sceneIx] &= ~bit;
++    }
++}
++
++bool SimGestureSelected(const SimOracle& oracle, std::size_t gestureIx) {
++    return (oracle.gestureSelectedMask & (synth::GestureMask{1} << gestureIx)) != 0;
++}
++
++void SimSetGestureSelected(SimOracle& oracle, std::size_t gestureIx, bool selected) {
++    const synth::GestureMask bit = synth::GestureMask{1} << gestureIx;
++    if (selected) {
++        oracle.gestureSelectedMask |= bit;
++    } else {
++        oracle.gestureSelectedMask &= ~bit;
++    }
++}
++
++void SimEnsureRouteActive(SimParam& parameter, std::size_t sourceIx) {
++    const std::size_t routeSlot = parameter.sourceRoutePositions[sourceIx];
++    if (routeSlot < parameter.activeRouteCount) {
++        return;
++    }
++    const std::size_t destination = parameter.activeRouteCount;
++    if (routeSlot != destination) {
++        const std::size_t displacedSource = parameter.routeSourceIndices[destination];
++        std::swap(parameter.routeSourceIndices[routeSlot], parameter.routeSourceIndices[destination]);
++        parameter.sourceRoutePositions[sourceIx] = destination;
++        parameter.sourceRoutePositions[displacedSource] = routeSlot;
++    }
++    ++parameter.activeRouteCount;
++}
++
++void SimRemoveActiveRoute(SimParam& parameter, std::size_t routeSlot) {
++    const std::size_t lastActive = parameter.activeRouteCount - 1;
++    if (routeSlot != lastActive) {
++        const std::size_t removedSource = parameter.routeSourceIndices[routeSlot];
++        const std::size_t movedSource = parameter.routeSourceIndices[lastActive];
++        std::swap(parameter.routeSourceIndices[routeSlot], parameter.routeSourceIndices[lastActive]);
++        parameter.sourceRoutePositions[movedSource] = routeSlot;
++        parameter.sourceRoutePositions[removedSource] = lastActive;
++    }
++    --parameter.activeRouteCount;
++}
++
++bool SimRouteNeutralAcrossVoices(const SimParam& parameter, std::size_t sourceIx) {
++    constexpr float tolerance = 0.000001f;
++    for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
++        if (std::fabs(parameter.currentDepth[voiceIx][sourceIx]) > tolerance ||
++            std::fabs(parameter.targetDepth[voiceIx][sourceIx]) > tolerance) {
++            return false;
++        }
++    }
++    return true;
++}
++
++void SimPruneNeutralActiveRoutes(SimParam& parameter) {
++    for (std::size_t routeSlot = parameter.activeRouteCount; routeSlot-- > 0;) {
++        const std::size_t sourceIx = parameter.routeSourceIndices[routeSlot];
++        if (SimRouteNeutralAcrossVoices(parameter, sourceIx)) {
++            SimRemoveActiveRoute(parameter, routeSlot);
++        }
++    }
++}
++
+ synth::Modifier SimCurrentModifier(const SimOracle& oracle) {
+     if (oracle.randomModHeld) {
+         return synth::Modifier::RandomMod;
+     }
+     if (oracle.randomHeld) {
+         return synth::Modifier::Random;
+     }
+     if (oracle.resetHeld) {
+         return synth::Modifier::Reset;
+     }
+@@ -6390,24 +6486,26 @@ const SimCell* SimFindCell(const SimBank& bank, synth::PhysicalEncoderId encoder
+         if (cell.encoder == encoder) {
+             return &cell;
+         }
+     }
+     return nullptr;
+ }
+
+ float SimEffectiveGestureWeight(const SimOracle& oracle, const SimParam& parameter, std::size_t gestureIx) {
+     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
+     const float leftWeight =
+-        parameter.gestureActive[oracle.scene.leftScene][gestureIx] ? oracle.gestureWeight[gestureIx] * (1.0f - blend)
+-                                                                   : 0.0f;
++        SimGestureActive(parameter, oracle.scene.leftScene, gestureIx)
++            ? oracle.gestureWeight[gestureIx] * (1.0f - blend)
++            : 0.0f;
+     const float rightWeight =
+-        parameter.gestureActive[oracle.scene.rightScene][gestureIx] ? oracle.gestureWeight[gestureIx] * blend : 0.0f;
++        SimGestureActive(parameter, oracle.scene.rightScene, gestureIx) ? oracle.gestureWeight[gestureIx] * blend
++                                                                        : 0.0f;
+     return leftWeight + rightWeight;
+ }
+
+ float SimRawCenter(const SimOracle& oracle, const SimParam& parameter) {
+     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
+     const float inverseBlend = 1.0f - blend;
+     const float base =
+         parameter.sceneCenter[oracle.scene.leftScene] * inverseBlend + parameter.sceneCenter[oracle.scene.rightScene] * blend;
+
+     float weightedMixSum = 0.0f;
+@@ -6463,25 +6561,23 @@ bool SimHasNonNeutralDepthState(const SimOracle& oracle, const SimParam& paramet
+     constexpr float neutralDepthCenter = 0.5f;
+     if (std::fabs(parameter.currentCenter - neutralDepthCenter) > tolerance ||
+         std::fabs(parameter.targetCenter - neutralDepthCenter) > tolerance) {
+         return true;
+     }
+     for (const float center : parameter.sceneCenter) {
+         if (std::fabs(center - neutralDepthCenter) > tolerance) {
+             return true;
+         }
+     }
+-    for (const auto& row : parameter.gestureActive) {
+-        for (const bool active : row) {
+-            if (active) {
+-                return true;
+-            }
++    for (const synth::GestureMask mask : parameter.gestureActiveMasks) {
++        if (mask != 0) {
++            return true;
+         }
+     }
+     for (const auto& row : parameter.currentDepth) {
+         for (const float depth : row) {
+             if (std::fabs(depth) > tolerance) {
+                 return true;
+             }
+         }
+     }
+     for (const auto& row : parameter.targetDepth) {
+@@ -6506,49 +6602,76 @@ std::uint32_t SimModulatorsAffectingMask(const SimOracle& oracle, const SimParam
+         if (route >= 0 && SimHasNonNeutralDepthState(oracle, oracle.params[static_cast<std::size_t>(route)])) {
+             mask |= (std::uint32_t{1} << modIx);
+         }
+     }
+     return mask;
+ }
+
+ synth::GestureMask SimGesturesAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
+     synth::GestureMask mask = 0;
+     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
+-    for (std::size_t gestureIx = 0; gestureIx < std::min<std::size_t>(kSimGestures, 32); ++gestureIx) {
++    for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
+         bool active = false;
+         if (blend <= 0.0f) {
+-            active = parameter.gestureActive[oracle.scene.leftScene][gestureIx];
++            active = SimGestureActive(parameter, oracle.scene.leftScene, gestureIx);
+         } else if (blend >= 1.0f) {
+-            active = parameter.gestureActive[oracle.scene.rightScene][gestureIx];
++            active = SimGestureActive(parameter, oracle.scene.rightScene, gestureIx);
+         } else {
+-            active = parameter.gestureActive[oracle.scene.leftScene][gestureIx] ||
+-                     parameter.gestureActive[oracle.scene.rightScene][gestureIx];
++            active = SimGestureActive(parameter, oracle.scene.leftScene, gestureIx) ||
++                     SimGestureActive(parameter, oracle.scene.rightScene, gestureIx);
+         }
+         if (active) {
+             mask |= (synth::GestureMask{1} << gestureIx);
+         }
+     }
+     return mask;
+ }
+
+ void SimSeedDisplayState(SimOracle& oracle, std::size_t paramIx);
+
+ void SimComputeAtDepth(SimOracle& oracle, std::size_t paramIx, std::size_t recursionDepth) {
+     SimParam& parameter = oracle.params[paramIx];
+     parameter.targetCenter = SimClamp(SimRawCenter(oracle, parameter), parameter.range);
+
+     for (const int route : parameter.route) {
+         if (route >= 0) {
+             SimComputeAtDepth(oracle, static_cast<std::size_t>(route), recursionDepth + 1);
+         }
+     }
+
++    constexpr float neutralTolerance = 0.000001f;
++    for (std::size_t sourceIx = 0; sourceIx < kSimMods; ++sourceIx) {
++        const int route = parameter.route[sourceIx];
++        bool targetNonNeutral = false;
++        if (route >= 0) {
++            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
++                if (std::fabs(synth::ModulationDepthTargetFromKnob(
++                                  SimGetRaw(oracle, static_cast<std::size_t>(route), voiceIx))) > neutralTolerance) {
++                    targetNonNeutral = true;
++                    break;
++                }
++            }
++        }
++        bool currentNonNeutral = false;
++        if (parameter.sourceRoutePositions[sourceIx] < parameter.activeRouteCount) {
++            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
++                if (std::fabs(parameter.currentDepth[voiceIx][sourceIx]) > neutralTolerance) {
++                    currentNonNeutral = true;
++                    break;
++                }
++            }
++        }
++        if (targetNonNeutral || currentNonNeutral) {
++            SimEnsureRouteActive(parameter, sourceIx);
++        }
++    }
++
+     for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+         float weightSum = 0.0f;
+         for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
+             const int route = parameter.route[modIx];
+             const float depth =
+                 route < 0 ? 0.0f
+                           : synth::ModulationDepthTargetFromKnob(
+                                 SimGetRaw(oracle, static_cast<std::size_t>(route), voiceIx));
+             parameter.targetDepth[voiceIx][modIx] = depth;
+             weightSum += std::fabs(depth);
+@@ -6588,20 +6711,21 @@ void SimComputeAtDepth(SimOracle& oracle, std::size_t paramIx, std::size_t recur
+
+     if (recursionDepth > 0) {
+         parameter.currentCenter = parameter.targetCenter;
+         parameter.currentCenterScale = parameter.targetCenterScale;
+         parameter.currentNormalizationOffset = parameter.targetNormalizationOffset;
+         parameter.currentMinValue = parameter.targetMinValue;
+         parameter.currentMaxValue = parameter.targetMaxValue;
+         parameter.currentDepth = parameter.targetDepth;
+         SimSeedDisplayState(oracle, paramIx);
+     }
++    SimPruneNeutralActiveRoutes(parameter);
+ }
+
+ void SimComputeAll(SimOracle& oracle) {
+     for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
+         SimComputeAtDepth(oracle, paramIx, 0);
+     }
+ }
+
+ std::size_t SimParamIndex(const SimOracle& oracle, const SimParam& parameter) {
+     const SimParam* begin = oracle.params.data();
+@@ -6625,20 +6749,21 @@ void SimSeedDisplayState(SimOracle& oracle, SimParam& parameter) {
+     SimSeedDisplayState(oracle, SimParamIndex(oracle, parameter));
+ }
+
+ void SimSnapParameterToTarget(SimOracle& oracle, SimParam& parameter) {
+     parameter.currentCenter = parameter.targetCenter;
+     parameter.currentCenterScale = parameter.targetCenterScale;
+     parameter.currentNormalizationOffset = parameter.targetNormalizationOffset;
+     parameter.currentMinValue = parameter.targetMinValue;
+     parameter.currentMaxValue = parameter.targetMaxValue;
+     parameter.currentDepth = parameter.targetDepth;
++    SimPruneNeutralActiveRoutes(parameter);
+     SimSeedDisplayState(oracle, parameter);
+     for (const int route : parameter.route) {
+         if (route >= 0) {
+             SimSnapParameterToTarget(oracle, oracle.params[static_cast<std::size_t>(route)]);
+         }
+     }
+ }
+
+ void SimProcessLiteAll(SimOracle& oracle) {
+     constexpr float alpha = 0.25f;
+@@ -6693,31 +6818,31 @@ void SimOpenModulationView(SimOracle& oracle, SimBank& bank, int paramIx) {
+     }
+     bank.visible.push_back({
+         .encoder = kSimSlotEncoders.back(),
+         .parameter = paramIx,
+     });
+ }
+
+ void SimHandleIncDec(SimOracle& oracle, SimParam& parameter, float delta) {
+     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
+     auto armSelectedGesture = [&](std::size_t sceneIx, std::size_t gestureIx) {
+-        if (parameter.gestureActive[sceneIx][gestureIx]) {
++        if (SimGestureActive(parameter, sceneIx, gestureIx)) {
+             return false;
+         }
+         parameter.gestureValue[sceneIx][gestureIx] = parameter.sceneCenter[sceneIx];
+-        parameter.gestureActive[sceneIx][gestureIx] = true;
++        SimSetGestureActive(parameter, sceneIx, gestureIx, true);
+         return true;
+     };
+
+     bool armedGesture = false;
+     for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
+-        if (!oracle.gestureSelected[gestureIx]) {
++        if (!SimGestureSelected(oracle, gestureIx)) {
+             continue;
+         }
+         if (blend <= 0.0f) {
+             armedGesture = armSelectedGesture(oracle.scene.leftScene, gestureIx) || armedGesture;
+         } else if (blend >= 1.0f) {
+             armedGesture = armSelectedGesture(oracle.scene.rightScene, gestureIx) || armedGesture;
+         } else {
+             armedGesture = armSelectedGesture(oracle.scene.leftScene, gestureIx) || armedGesture;
+             if (oracle.scene.rightScene != oracle.scene.leftScene) {
+                 armedGesture = armSelectedGesture(oracle.scene.rightScene, gestureIx) || armedGesture;
+@@ -6809,25 +6934,26 @@ void SimResetDepthToNeutral(SimOracle& oracle, SimParam& parameter) {
+             SimResetDepthToNeutral(oracle, oracle.params[static_cast<std::size_t>(route)]);
+         }
+     }
+
+     for (auto& row : parameter.currentDepth) {
+         row.fill(0.0f);
+     }
+     for (auto& row : parameter.targetDepth) {
+         row.fill(0.0f);
+     }
++    parameter.activeRouteCount = 0;
+
+     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
+     auto resetScene = [&](std::size_t sceneIx) {
+         parameter.sceneCenter[sceneIx] = 0.5f;
+-        parameter.gestureActive[sceneIx].fill(false);
++        parameter.gestureActiveMasks[sceneIx] = 0;
+     };
+
+     if (blend <= 0.0f) {
+         resetScene(oracle.scene.leftScene);
+     } else if (blend >= 1.0f) {
+         resetScene(oracle.scene.rightScene);
+     } else {
+         resetScene(oracle.scene.leftScene);
+         if (oracle.scene.rightScene != oracle.scene.leftScene) {
+             resetScene(oracle.scene.rightScene);
+@@ -6853,26 +6979,27 @@ void SimRevertToDefault(SimOracle& oracle, SimParam& parameter) {
+             SimResetDepthToNeutral(oracle, oracle.params[static_cast<std::size_t>(route)]);
+         }
+     }
+
+     for (auto& row : parameter.currentDepth) {
+         row.fill(0.0f);
+     }
+     for (auto& row : parameter.targetDepth) {
+         row.fill(0.0f);
+     }
++    parameter.activeRouteCount = 0;
+
+     const float defaultValue = SimClamp(parameter.defaultValue, parameter.range);
+     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
+     auto resetScene = [&](std::size_t sceneIx) {
+         parameter.sceneCenter[sceneIx] = defaultValue;
+-        parameter.gestureActive[sceneIx].fill(false);
++        parameter.gestureActiveMasks[sceneIx] = 0;
+     };
+
+     if (blend <= 0.0f) {
+         resetScene(oracle.scene.leftScene);
+     } else if (blend >= 1.0f) {
+         resetScene(oracle.scene.rightScene);
+     } else {
+         resetScene(oracle.scene.leftScene);
+         if (oracle.scene.rightScene != oracle.scene.leftScene) {
+             resetScene(oracle.scene.rightScene);
+@@ -7066,24 +7193,24 @@ void SimCheck(const SimOracle& oracle, const std::array<synth::Parameter*, kSimP
+     if (manager.RandomHeld() != oracle.randomHeld) {
+         SimFailBool(seed, step, action, "manager random held");
+     }
+     if (manager.RandomModHeld() != oracle.randomModHeld) {
+         SimFailBool(seed, step, action, "manager random-mod held");
+     }
+     if (manager.GetCurrentModifier() != SimCurrentModifier(oracle)) {
+         SimFailBool(seed, step, action, "manager current modifier");
+     }
+     for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
+-        if (group.GestureSelected(gestureIx) != oracle.gestureSelected[gestureIx]) {
++        if (group.GestureSelected(gestureIx) != SimGestureSelected(oracle, gestureIx)) {
+             std::ostringstream oss;
+             oss << "seed " << seed << " step " << step << " action " << action << " group gestureIx=" << gestureIx
+-                << " selected expected " << oracle.gestureSelected[gestureIx] << " got "
++                << " selected expected " << SimGestureSelected(oracle, gestureIx) << " got "
+                 << group.GestureSelected(gestureIx);
+             throw std::runtime_error(oss.str());
+         }
+         SimCheckNear(seed, step, action, "group gestureIx=" + std::to_string(gestureIx) + " weight",
+                      oracle.gestureWeight[gestureIx], manager.GestureValue(gestureIx));
+     }
+     if (slot.SelectedBank() != banks[static_cast<std::size_t>(oracle.selectedBank)]) {
+         SimFailBool(seed, step, action, "slot selectedBank=" + std::to_string(oracle.selectedBank));
+     }
+
+@@ -7093,60 +7220,60 @@ void SimCheck(const SimOracle& oracle, const std::array<synth::Parameter*, kSimP
+         for (std::size_t sceneIx = 0; sceneIx < kSimScenes; ++sceneIx) {
+             SimCheckNear(seed, step, action,
+                          SimParamField(actual, paramIx, "sceneIx=" + std::to_string(sceneIx) + " center"),
+                          expected.sceneCenter[sceneIx], actual.SceneCenter(sceneIx));
+             for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
+                 const std::string gestureField = "sceneIx=" + std::to_string(sceneIx) +
+                                                  " gestureIx=" + std::to_string(gestureIx);
+                 SimCheckNear(seed, step, action, SimParamField(actual, paramIx, gestureField + " value"),
+                              expected.gestureValue[sceneIx][gestureIx],
+                              actual.GestureValue(sceneIx, gestureIx));
+-                if (expected.gestureActive[sceneIx][gestureIx] != actual.GestureActive(sceneIx, gestureIx)) {
++                if (SimGestureActive(expected, sceneIx, gestureIx) != actual.GestureActive(sceneIx, gestureIx)) {
+                     SimFailBool(seed, step, action, SimParamField(actual, paramIx, gestureField + " active"));
+                 }
+             }
+         }
+         for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
+             const int route = expected.route[modIx];
+             const synth::Parameter* expectedRoute = route < 0 ? nullptr : params[static_cast<std::size_t>(route)];
+             if (actual.ModulationDepthParameter(modIx) != expectedRoute) {
+                 SimFailBool(seed, step, action,
+                             SimParamField(actual, paramIx, "modIx=" + std::to_string(modIx) + " route"));
+             }
+         }
+         SimCheckNear(seed, step, action, SimParamField(actual, paramIx, "target center"), expected.targetCenter,
+                      actual.TargetCenter());
+         SimCheckNear(seed, step, action, SimParamField(actual, paramIx, "current center"), expected.currentCenter,
+                      actual.CurrentCenter());
+         RequireRouteBijection(actual, kSimMods);
+-        std::array<bool, kSimMods> expectedActiveRoutes{};
+-        std::size_t expectedActiveRouteCount = 0;
+-        for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
+-            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+-                if (std::fabs(expected.targetDepth[voiceIx][modIx]) > 0.000001f ||
+-                    std::fabs(expected.currentDepth[voiceIx][modIx]) > 0.000001f) {
+-                    expectedActiveRoutes[modIx] = true;
+-                    break;
+-                }
+-            }
+-            expectedActiveRouteCount += expectedActiveRoutes[modIx] ? 1 : 0;
+-        }
+-        if (actual.ActiveRouteCount() != expectedActiveRouteCount) {
++        if (actual.ActiveRouteCount() != expected.activeRouteCount) {
+             SimFail(seed, step, action, SimParamField(actual, paramIx, "active route count"),
+-                    static_cast<float>(expectedActiveRouteCount), static_cast<float>(actual.ActiveRouteCount()));
++                    static_cast<float>(expected.activeRouteCount), static_cast<float>(actual.ActiveRouteCount()));
+         }
+-        for (std::size_t routeSlot = 0; routeSlot < actual.ActiveRouteCount(); ++routeSlot) {
+-            const std::size_t sourceIx = actual.RouteSourceIndex(routeSlot);
+-            if (!expectedActiveRoutes[sourceIx]) {
++        for (std::size_t routeSlot = 0; routeSlot < kSimMods; ++routeSlot) {
++            const std::size_t expectedSourceIx = expected.routeSourceIndices[routeSlot];
++            const std::size_t actualSourceIx = actual.RouteSourceIndex(routeSlot);
++            if (actualSourceIx != expectedSourceIx) {
++                SimFailBool(seed, step, action,
++                            SimParamField(actual, paramIx,
++                                          "routeSlot=" + std::to_string(routeSlot) +
++                                              " expected stable source=" + std::to_string(expectedSourceIx) +
++                                              " actual stable source=" + std::to_string(actualSourceIx)));
++            }
++            const std::size_t actualRouteSlot = actual.RoutePositionForSource(expectedSourceIx);
++            if (actualRouteSlot != expected.sourceRoutePositions[expectedSourceIx]) {
+                 SimFailBool(seed, step, action,
+                             SimParamField(actual, paramIx,
+-                                          "active route prefix sourceIx=" + std::to_string(sourceIx)));
++                                          "stable source=" + std::to_string(expectedSourceIx) +
++                                              " expected route slot=" +
++                                              std::to_string(expected.sourceRoutePositions[expectedSourceIx]) +
++                                              " actual route slot=" + std::to_string(actualRouteSlot)));
+             }
+         }
+         for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+             const std::string voiceField = "voiceIx=" + std::to_string(voiceIx);
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " target center scale"),
+                          expected.targetCenterScale[voiceIx],
+                          actual.TargetCenterScale(voiceIx));
+             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " current center scale"),
+                          expected.currentCenterScale[voiceIx],
+                          actual.CurrentCenterScale(voiceIx));
+@@ -7211,20 +7338,30 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
+         SimFailBool(seed, step, action, "ui reset held");
+     }
+     if (ui.randomHeld.load(std::memory_order_relaxed) != oracle.randomHeld) {
+         SimFailBool(seed, step, action, "ui random held");
+     }
+     if (ui.randomModHeld.load(std::memory_order_relaxed) != oracle.randomModHeld) {
+         SimFailBool(seed, step, action, "ui random-mod held");
+     }
+
+     const SimBank& bank = oracle.banks[static_cast<std::size_t>(oracle.selectedBank)];
++    if (!ui.slots[0].connected.load() ||
++        ui.slots[0].showingModulationView.load() != (bank.selectedParameter >= 0)) {
++        SimFailBool(seed, step, action, "ui selected bank/view state");
++    }
++    for (std::size_t bankIx = 0; bankIx < ui.bankCapacity; ++bankIx) {
++        if (!ui.banks[bankIx].connected.load() ||
++            ui.banks[bankIx].selected.load() != (bankIx == static_cast<std::size_t>(oracle.selectedBank))) {
++            SimFailBool(seed, step, action, "ui bankIx=" + std::to_string(bankIx) + " selected state");
++        }
++    }
+     const std::array<synth::Color, 4> defaultIndicators{
+         synth::Color::Grey, synth::Color::Grey, synth::Color::Grey, synth::Color::Grey};
+     for (std::size_t position = 0; position < kSimSlotEncoders.size(); ++position) {
+         const SimCell* cell = SimFindCell(bank, kSimSlotEncoders[position]);
+         const synth::Parameter::UIState& actual = ui.slots[0].cells[position];
+         const bool expectedConnected = cell != nullptr && cell->parameter >= 0;
+         if (actual.connected.load() != expectedConnected) {
+             SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " connected");
+         }
+         if (!expectedConnected) {
+@@ -7247,20 +7384,37 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
+             const synth::GestureMask expectedGestureMask = SimGesturesAffectingMask(oracle, expected);
+             if (actual.switchValues.load() != expectedSwitchValues) {
+                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " switch values");
+             }
+             if (actual.modulatorsAffectingMask.load() != expectedModulatorMask) {
+                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " modulator mask");
+             }
+             if (actual.gesturesAffectingMask.load() != expectedGestureMask) {
+                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " gesture mask");
+             }
++            if (actual.modulatorColorCount.load() != kSimMods || actual.gestureColorCount.load() != kSimGestures) {
++                SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " color counts");
++            }
++            for (std::size_t sourceIx = 0; sourceIx < kSimMods; ++sourceIx) {
++                if (actual.modulatorSourceColors[sourceIx].Load() != synth::Color::Off) {
++                    SimFailBool(seed, step, action,
++                                "ui position=" + std::to_string(position) +
++                                    " source color=" + std::to_string(sourceIx));
++                }
++            }
++            for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
++                if (actual.gestureColors[gestureIx].Load() != synth::Color::Off) {
++                    SimFailBool(seed, step, action,
++                                "ui position=" + std::to_string(position) +
++                                    " gesture color=" + std::to_string(gestureIx));
++                }
++            }
+             for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+                 SimCheckNear(seed, step, action,
+                              "ui position=" + std::to_string(position) + " voice=" + std::to_string(voiceIx),
+                              SimToUIPresentation(expected.uiDisplayCenter[voiceIx], expected.range),
+                              actual.values[voiceIx].load());
+                 const float expectedSpread = expected.switchValues > 1
+                                                  ? 0.0f
+                                                  : SimToUISpreadPresentation(
+                                                        std::sqrt(std::max(0.0f, expected.uiDisplaySpreadEnergy[voiceIx])),
+                                                        expected.range);
+@@ -7285,21 +7439,21 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
+                     SimFailBool(seed, step, action,
+                                 "ui position=" + std::to_string(position) + " indicator=" + std::to_string(voiceIx));
+                 }
+             }
+         }
+     }
+     if (ui.gestures.gestureCapacity != kSimGestures) {
+         SimFailBool(seed, step, action, "ui gesture capacity");
+     }
+     for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
+-        if (ui.gestures.selected[gestureIx].load() != oracle.gestureSelected[gestureIx]) {
++        if (ui.gestures.selected[gestureIx].load() != SimGestureSelected(oracle, gestureIx)) {
+             SimFailBool(seed, step, action, "ui gesture selected");
+         }
+         SimCheckNear(seed, step, action, "ui gesture value", oracle.gestureWeight[gestureIx],
+                      ui.gestures.values[gestureIx].load());
+     }
+ }
+
+ void SimInitializeOracle(SimOracle& oracle) {
+     oracle.selectedBank = 0;
+     oracle.resetHeld = false;
+@@ -7316,24 +7470,27 @@ void SimInitializeOracle(SimOracle& oracle) {
+     for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
+         SimParam& parameter = oracle.params[paramIx];
+         parameter.defaultValue = defaults[paramIx];
+         parameter.range = ranges[paramIx];
+         parameter.switchValues = switchValues[paramIx];
+         const float defaultValue = SimClamp(defaults[paramIx], ranges[paramIx]);
+         parameter.sceneCenter.fill(defaultValue);
+         for (auto& row : parameter.gestureValue) {
+             row.fill(defaultValue);
+         }
+-        for (auto& row : parameter.gestureActive) {
+-            row.fill(false);
+-        }
++        parameter.gestureActiveMasks.fill(0);
+         parameter.route.fill(-1);
++        for (std::size_t sourceIx = 0; sourceIx < kSimMods; ++sourceIx) {
++            parameter.routeSourceIndices[sourceIx] = sourceIx;
++            parameter.sourceRoutePositions[sourceIx] = sourceIx;
++        }
++        parameter.activeRouteCount = 0;
+         parameter.currentCenter = defaultValue;
+         parameter.targetCenter = defaultValue;
+         parameter.currentCenterScale.fill(1.0f);
+         parameter.targetCenterScale.fill(1.0f);
+         parameter.currentNormalizationOffset.fill(0.0f);
+         parameter.targetNormalizationOffset.fill(0.0f);
+         parameter.currentMinValue.fill(defaultValue);
+         parameter.targetMinValue.fill(defaultValue);
+         parameter.currentMaxValue.fill(defaultValue);
+         parameter.targetMaxValue.fill(defaultValue);
+@@ -7394,37 +7551,37 @@ struct SimPatchSnapshot {
+ SimPatchSnapshot SimCapturePatchSnapshot(const SimOracle& oracle) {
+     return {.params = oracle.params};
+ }
+
+ void SimApplyPatchSnapshot(SimOracle& oracle, const SimPatchSnapshot& snapshot) {
+     for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
+         SimParam& target = oracle.params[paramIx];
+         const SimParam& saved = snapshot.params[paramIx];
+         target.sceneCenter = saved.sceneCenter;
+         target.gestureValue = saved.gestureValue;
+-        target.gestureActive = saved.gestureActive;
++        target.gestureActiveMasks = saved.gestureActiveMasks;
+     }
+     SimComputeAllAndSnap(oracle);
+ }
+
+ void SimApplyNewPatch(SimOracle& oracle) {
+     const auto banks = oracle.banks;
+     const int selectedBank = oracle.selectedBank;
+     const auto modulatorValue = oracle.modulatorValue;
+     SimInitializeOracle(oracle);
+     oracle.banks = banks;
+     oracle.selectedBank = selectedBank;
+     oracle.modulatorValue = modulatorValue;
+     oracle.scene = {.leftScene = 0, .rightScene = 1, .blend = 0.25f};
+     oracle.activePage = 0;
+     oracle.gestureWeight.fill(0.0f);
+-    oracle.gestureSelected.fill(false);
++    oracle.gestureSelectedMask = 0;
+     SimComputeAllAndSnap(oracle);
+ }
+
+ std::size_t SimFindLatestPatchInDirectory(
+     const std::vector<std::pair<std::filesystem::path, SimPatchSnapshot>>& versions,
+     const std::filesystem::path& patchDir) {
+     for (std::size_t reverseIx = versions.size(); reverseIx > 0; --reverseIx) {
+         const std::size_t ix = reverseIx - 1;
+         if (versions[ix].first.parent_path() == patchDir) {
+             return ix;
+@@ -7434,21 +7591,21 @@ std::size_t SimFindLatestPatchInDirectory(
+ }
+
+ } // namespace
+
+ TEST_CASE(randomized_parameter_modulation_simulation) {
+     const std::vector<unsigned> seeds = SimSeedsFromEnvironment();
+     const int steps = SimStepsFromEnvironment();
+
+     for (const unsigned seed : seeds) {
+         synth::ParameterManager manager;
+-        manager.SetGestureCount(2);
++        manager.SetGestureCount(kSimGestures);
+         auto& group = manager.CreateGroup({
+             .numVoices = kSimVoices,
+             .numModulators = kSimMods,
+             .numScenes = kSimScenes,
+             .maxParameters = kSimParams,
+             .processLiteAlpha = 0.25f,
+             .targetCenterAlpha = 1.0f,
+         });
+         auto& carrier = manager.CreateParameter(group, {
+             .name = "Carrier",
+@@ -7620,28 +7777,28 @@ TEST_CASE(randomized_parameter_modulation_simulation) {
+                 const bool held = (rng() % 2) == 0;
+                 action = std::string("set random-mod held ") + (held ? "true" : "false");
+                 manager.SetRandomModHeld(held);
+                 oracle.randomModHeld = held;
+                 break;
+             }
+             case 8: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 action = "select gesture " + std::to_string(gestureIx);
+                 manager.SelectGesture(gestureIx);
+-                oracle.gestureSelected[gestureIx] = true;
++                SimSetGestureSelected(oracle, gestureIx, true);
+                 break;
+             }
+             case 9: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 action = "deselect gesture " + std::to_string(gestureIx);
+                 manager.DeselectGesture(gestureIx);
+-                oracle.gestureSelected[gestureIx] = false;
++                SimSetGestureSelected(oracle, gestureIx, false);
+                 break;
+             }
+             case 10: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 const float value = unipolarDist(rng);
+                 action = "set gesture value " + std::to_string(gestureIx);
+                 manager.SetGestureValue(gestureIx, value);
+                 oracle.gestureWeight[gestureIx] = value;
+                 break;
+             }
+@@ -7707,27 +7864,27 @@ TEST_CASE(randomized_parameter_modulation_simulation) {
+                 }
+                 SimProcessLiteAll(oracle);
+                 break;
+             default: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 action = "clear active gesture " + std::to_string(gestureIx);
+                 manager.ClearGestureActiveFlagsForActiveSceneSelection(gestureIx);
+                 const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
+                 for (auto& parameter : oracle.params) {
+                     if (blend <= 0.0f) {
+-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
++                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
+                     } else if (blend >= 1.0f) {
+-                        parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
++                        SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
+                     } else {
+-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
++                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
+                         if (oracle.scene.rightScene != oracle.scene.leftScene) {
+-                            parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
++                            SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
+                         }
+                     }
+                 }
+                 break;
+             }
+             }
+
+             SimCheck(oracle, params, banks, group, slot, manager, seed, step, action);
+         }
+     }
+@@ -7810,22 +7967,42 @@ TEST_CASE(randomized_message_bus_ui_state_simulation) {
+         std::mt19937 randomRng(seed ^ 0xBADC0DEu);
+         manager.SetRandomSource(
+             [&randomSamples]() { return randomSamples.PopValue(); },
+             [&randomSamples]() { return randomSamples.PopCoin(); },
+             [&randomSamples](std::size_t max) { return randomSamples.PopIndex(max); });
+
+         SimCheck(oracle, params, banks, group, slot, manager, seed, -1, "initial bus");
+         manager.PopulateUIState(*ui);
+         SimCheckUIState(oracle, *ui, seed, -1, "initial bus ui");
+
++        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(timestamp, 32, true)));
++        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, 32, 0.4f)));
++        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(timestamp, 63, true)));
++        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, 63, 0.8f)));
++        REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(timestamp, 0, 0, 0.05f)));
++        bus.Process(timestamp++);
++        SimSetGestureSelected(oracle, 32, true);
++        oracle.gestureWeight[32] = 0.4f;
++        SimSetGestureSelected(oracle, 63, true);
++        oracle.gestureWeight[63] = 0.8f;
++        SimHandleTick(oracle, encoders[0], 0.05f);
++        SimCheck(oracle, params, banks, group, slot, manager, seed, -1,
++                 "deterministic gestures=32,63 random-consumption(values=0/0,coins=0/0,indices=0/0)");
++        manager.PopulateUIState(*ui);
++        SimCheckUIState(oracle, *ui, seed, -1,
++                        "deterministic gestures=32,63 ui random-consumption(values=0/0,coins=0/0,indices=0/0)");
++        REQUIRE_TRUE((ui->slots[0].cells[0].gesturesAffectingMask.load() & (synth::GestureMask{1} << 32)) != 0);
++        REQUIRE_TRUE((ui->slots[0].cells[0].gesturesAffectingMask.load() & (synth::GestureMask{1} << 63)) != 0);
++
+         for (int step = 0; step < steps; ++step) {
+             std::string action;
++            randomSamples.Clear();
+             auto modifierName = [](synth::Modifier modifier) {
+                 switch (modifier) {
+                 case synth::Modifier::None:
+                     return "none";
+                 case synth::Modifier::Reset:
+                     return "reset";
+                 case synth::Modifier::Random:
+                     return "random";
+                 case synth::Modifier::RandomMod:
+                     return "random-mod";
+@@ -7973,21 +8150,21 @@ TEST_CASE(randomized_message_bus_ui_state_simulation) {
+                 REQUIRE_TRUE(bus.Push(synth::MessageIn::SetRandomMod(timestamp, held)));
+                 bus.Process(timestamp);
+                 oracle.randomModHeld = held;
+                 break;
+             }
+             case 11: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 action = "bus toggle gesture " + std::to_string(gestureIx);
+                 REQUIRE_TRUE(bus.Push(synth::MessageIn::ToggleGestureSelect(timestamp, gestureIx)));
+                 bus.Process(timestamp);
+-                oracle.gestureSelected[gestureIx] = !oracle.gestureSelected[gestureIx];
++                SimSetGestureSelected(oracle, gestureIx, !SimGestureSelected(oracle, gestureIx));
+                 break;
+             }
+             case 12: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 const float value = unipolarDist(rng);
+                 action = "bus set gesture value " + std::to_string(gestureIx);
+                 REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, gestureIx, value)));
+                 bus.Process(timestamp);
+                 oracle.gestureWeight[gestureIx] = value;
+                 break;
+@@ -8061,29 +8238,180 @@ TEST_CASE(randomized_message_bus_ui_state_simulation) {
+                 const std::size_t previousLeft = manager.Scene().leftScene;
+                 const std::size_t previousRight = manager.Scene().rightScene;
+                 REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(timestamp, kSimScenes + 1)));
+                 bus.Process(timestamp);
+                 REQUIRE_TRUE(manager.Scene().leftScene == previousLeft);
+                 REQUIRE_TRUE(manager.Scene().rightScene == previousRight);
+                 break;
+             }
+             }
+             ++timestamp;
++            action += " random-consumption(" + randomSamples.ConsumptionSummary() + ")";
+             SimCheck(oracle, params, banks, group, slot, manager, seed, step, action);
+             if (step % 11 == 0) {
+                 manager.PopulateUIState(*ui);
+                 SimCheckUIState(oracle, *ui, seed, step, action);
+             }
+         }
+     }
+ }
+
++TEST_CASE(message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load) {
++    constexpr unsigned seed = 0x5A17C0DEu;
++    synth::ParameterManager manager;
++    REQUIRE_TRUE(manager.SetGestureCount(64));
++    auto& group = manager.CreateGroup({.numVoices = 1,
++                                       .numModulators = 2,
++                                       .numScenes = 2,
++                                       .maxParameters = 2,
++                                       .targetCenterAlpha = 1.0f});
++    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.25f});
++    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.75f});
++    group.AddParameterStorageBatch(synth::MakeParameterStorageBatch(group.Config(), group.GestureCount(), 2));
++    REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
++    manager.SetSceneBlend(0.25f);
++
++    auto& bank = manager.CreateBank();
++    bank.AddMapping(10, first);
++    bank.AddMapping(20, second);
++    auto& slot = manager.CreateBankSlot();
++    for (const synth::PhysicalEncoderId encoder : {10u, 11u, 12u, 20u}) {
++        slot.AddPhysicalEncoder(encoder);
++    }
++    slot.SelectBank(&bank);
++    synth::MessageInBus bus(&manager, 64);
++
++    SimOracle oracle;
++    auto fail = [&](int step, const std::string& action, const std::string& field,
++                    std::size_t expected, std::size_t actual) {
++        std::ostringstream oss;
++        oss << "seed " << seed << " step " << step << " action " << action
++            << " random-consumption(values=0/0,coins=0/0,indices=0/0) " << field
++            << " expected " << expected << " got " << actual;
++        throw std::runtime_error(oss.str());
++    };
++    auto checkCounts = [&](int step, const std::string& action) {
++        if (group.LiveLocalParameterCount() != oracle.liveLocalCount) {
++            fail(step, action, "live local count", oracle.liveLocalCount, group.LiveLocalParameterCount());
++        }
++        if (group.FreeLocalParameterSlotCount() != oracle.freeLocalCount) {
++            fail(step, action, "free local count", oracle.freeLocalCount, group.FreeLocalParameterSlotCount());
++        }
++    };
++    std::uint64_t timestamp = 1;
++    auto push = [&](const synth::MessageIn& message) {
++        REQUIRE_TRUE(bus.Push(message));
++        bus.Process(timestamp);
++        ++timestamp;
++    };
++
++    push(synth::MessageIn::ParamPush(timestamp, 0, 0)); // open First
++    oracle.liveLocalCount = 2;
++    for (std::size_t sourceIx = 0; sourceIx < 2; ++sourceIx) {
++        oracle.localSlots[sourceIx] = {
++            .storageIdentity = 2 + sourceIx,
++            .parentParameter = 0,
++            .sourceIx = sourceIx,
++            .live = true,
++            .free = false,
++            .pinned = true,
++        };
++    }
++    checkCounts(0, "open first modulation view");
++    REQUIRE_TRUE(bank.ShowingModulation());
++    synth::Parameter* firstSource0 = bank.VisibleParameter(10);
++    synth::Parameter* firstSource1 = bank.VisibleParameter(11);
++    REQUIRE_TRUE(firstSource0 == &group.ParameterByLocalIndex(oracle.localSlots[0].storageIdentity));
++    REQUIRE_TRUE(firstSource1 == &group.ParameterByLocalIndex(oracle.localSlots[1].storageIdentity));
++
++    push(synth::MessageIn::SetReset(timestamp, true));
++    push(synth::MessageIn::ParamPush(timestamp, 0, 0)); // reset visible local through the bus
++    push(synth::MessageIn::SetReset(timestamp, false));
++    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0); // the model's pinned guard is observable
++    checkCounts(1, "reset pinned local and collect");
++
++    push(synth::MessageIn::ParamPush(timestamp, 0, 3)); // close First view
++    oracle.liveLocalCount = 0;
++    oracle.freeLocalCount = 2;
++    for (SimLocalSlot& local : oracle.localSlots) {
++        local.live = false;
++        local.free = true;
++        local.pinned = false;
++        local.parentParameter = -1;
++    }
++    checkCounts(2, "close first view and collect neutral locals");
++    REQUIRE_TRUE(!bank.ShowingModulation());
++
++    push(synth::MessageIn::ParamPush(timestamp, 0, 3)); // open Second using recycled slots
++    oracle.liveLocalCount = 2;
++    oracle.freeLocalCount = 0;
++    oracle.localSlots[1].parentParameter = 1;
++    oracle.localSlots[1].sourceIx = 0;
++    oracle.localSlots[1].live = true;
++    oracle.localSlots[1].free = false;
++    oracle.localSlots[1].pinned = true;
++    oracle.localSlots[0].parentParameter = 1;
++    oracle.localSlots[0].sourceIx = 1;
++    oracle.localSlots[0].live = true;
++    oracle.localSlots[0].free = false;
++    oracle.localSlots[0].pinned = true;
++    checkCounts(3, "open second view with distinct-parent reuse");
++    REQUIRE_TRUE(bank.VisibleParameter(10) == firstSource1);
++    REQUIRE_TRUE(bank.VisibleParameter(11) == firstSource0);
++
++    push(synth::MessageIn::SetGestureSelect(timestamp, 63, true));
++    push(synth::MessageIn::SetGestureValue(timestamp, 63, 1.0f));
++    push(synth::MessageIn::ParamIncDec(timestamp, 0, 0, 0.1f)); // arm gesture 63
++    push(synth::MessageIn::ParamIncDec(timestamp, 0, 0, 0.1f)); // edit the armed gesture
++    synth::Parameter* retained = bank.VisibleParameter(10);
++    REQUIRE_TRUE(retained != nullptr);
++    REQUIRE_TRUE(retained->GestureActive(0, 63));
++    REQUIRE_TRUE(retained->GestureActive(1, 63));
++    REQUIRE_TRUE(retained->GestureValue(0, 63) != 0.5f || retained->GestureValue(1, 63) != 0.5f);
++    const float savedGesture0 = retained->GestureValue(0, 63);
++    const float savedGesture1 = retained->GestureValue(1, 63);
++
++    push(synth::MessageIn::ParamPush(timestamp, 0, 3)); // close Second view
++    oracle.liveLocalCount = 1;
++    oracle.freeLocalCount = 1;
++    oracle.localSlots[1].pinned = false;
++    oracle.localSlots[0].live = false;
++    oracle.localSlots[0].free = true;
++    oracle.localSlots[0].pinned = false;
++    oracle.localSlots[0].parentParameter = -1;
++    checkCounts(4, "close second view and retain non-default gesture route");
++    REQUIRE_TRUE(second.ModulationDepthParameter(0) == retained);
++    REQUIRE_TRUE(second.ModulationDepthParameter(1) == nullptr);
++
++    synth::JsonArena patchArena(262144);
++    synth::MidiInstrumentConfig instrument;
++    synth::AudioDeviceState audio;
++    const synth::JSON patch = synth::BuildPatchJSON(patchArena, "Lifecycle", manager, instrument, audio);
++    REQUIRE_TRUE(!patchArena.Failed());
++    manager.RevertAllToDefaults();
++    oracle.liveLocalCount = 0;
++    oracle.freeLocalCount = 2;
++    checkCounts(5, "revert all and collect");
++    REQUIRE_TRUE(second.ModulationDepthParameter(0) == nullptr);
++
++    REQUIRE_TRUE(synth::LoadPatchJSON(patch, manager, instrument, &audio));
++    oracle.liveLocalCount = 1;
++    oracle.freeLocalCount = 1;
++    checkCounts(6, "patch load rematerializes retained route and collects omissions");
++    synth::Parameter* loaded = second.ModulationDepthParameter(0);
++    REQUIRE_TRUE(loaded != nullptr);
++    REQUIRE_TRUE(loaded->GestureActive(0, 63));
++    REQUIRE_TRUE(loaded->GestureActive(1, 63));
++    REQUIRE_NEAR(loaded->GestureValue(0, 63), savedGesture0, 0.000001f);
++    REQUIRE_NEAR(loaded->GestureValue(1, 63), savedGesture1, 0.000001f);
++}
++
+ TEST_CASE(randomized_patch_lifecycle_simulation) {
+     const std::vector<unsigned> seeds = SimSeedsFromEnvironment();
+     const int steps = SimStepsFromEnvironmentOrDefault(260);
+
+     for (const unsigned seed : seeds) {
+         const std::filesystem::path tempRoot =
+             std::filesystem::temp_directory_path() / ("sheaf-synth-patch-random-" + std::to_string(seed));
+         std::filesystem::remove_all(tempRoot);
+         std::filesystem::create_directories(tempRoot);
+
+@@ -8252,28 +8580,28 @@ TEST_CASE(randomized_patch_lifecycle_simulation) {
+                 manager.HandlePress(encoder);
+                 resetSamples.RequireDrained(seed, step, action);
+                 manager.SetResetHeld(false);
+                 oracle.resetHeld = false;
+                 break;
+             }
+             case 5: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 action = "patch select gesture " + std::to_string(gestureIx);
+                 manager.SelectGesture(gestureIx);
+-                oracle.gestureSelected[gestureIx] = true;
++                SimSetGestureSelected(oracle, gestureIx, true);
+                 break;
+             }
+             case 6: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 action = "patch deselect gesture " + std::to_string(gestureIx);
+                 manager.DeselectGesture(gestureIx);
+-                oracle.gestureSelected[gestureIx] = false;
++                SimSetGestureSelected(oracle, gestureIx, false);
+                 break;
+             }
+             case 7: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 const float value = unipolarDist(rng);
+                 action = "patch set gesture value " + std::to_string(gestureIx);
+                 manager.SetGestureValue(gestureIx, value);
+                 oracle.gestureWeight[gestureIx] = value;
+                 break;
+             }
+@@ -8321,27 +8649,27 @@ TEST_CASE(randomized_patch_lifecycle_simulation) {
+                 }
+                 SimProcessLiteAll(oracle);
+                 break;
+             case 14: {
+                 const std::size_t gestureIx = rng() % kSimGestures;
+                 action = "patch clear active gesture " + std::to_string(gestureIx);
+                 manager.ClearGestureActiveFlagsForActiveSceneSelection(gestureIx);
+                 const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
+                 for (auto& parameter : oracle.params) {
+                     if (blend <= 0.0f) {
+-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
++                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
+                     } else if (blend >= 1.0f) {
+-                        parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
++                        SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
+                     } else {
+-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
++                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
+                         if (oracle.scene.rightScene != oracle.scene.leftScene) {
+-                            parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
++                            SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
+                         }
+                     }
+                 }
+                 break;
+             }
+             case 15:
+             case 16:
+                 action = "patch save";
+                 saveCurrentOracle();
+                 break;
+diff --git a/projects/synth/tests/portable_ui_tests.cpp b/projects/synth/tests/portable_ui_tests.cpp
+index 485fbd4f..179226f5 100644
+--- a/projects/synth/tests/portable_ui_tests.cpp
++++ b/projects/synth/tests/portable_ui_tests.cpp
+@@ -432,24 +432,32 @@ int main()
+     Require(snapshotEncoder.voices[0].indicatorColor == synth::Color::Blue,
+             "encoder uses snapshot voice-zero indicator color");
+     Require(snapshotEncoder.modulatorColors == std::vector<synth::Color>{synth::Color::Cyan},
+             "encoder uses snapshot source badge colors");
+     Require(snapshotEncoder.gestureColors == std::vector<synth::Color>{synth::Color::Orange},
+             "encoder uses snapshot gesture badge colors");
+
+     Require(synth::ui::EncoderGeometry::BadgeText(false, 16) == "17", "gesture 16 badge is one-based");
+     Require(synth::ui::EncoderGeometry::BadgeText(false, 62) == "63", "gesture 62 badge is one-based");
+     Require(synth::ui::EncoderGeometry::BadgeText(false, 63) == "64", "gesture 63 badge is one-based");
+-    synth::ui::EncoderDrawState highGestureEncoder;
+-    highGestureEncoder.connected = true;
+-    highGestureEncoder.gesturesAffectingMask = std::uint64_t{1} << 63;
+-    highGestureEncoder.gestureColors.resize(64, synth::Color::Orange);
++    synth::Parameter::UIState highGestureState(1, 0, 64);
++    highGestureState.connected.store(true);
++    highGestureState.voiceCount.store(1);
++    highGestureState.gesturesAffectingMask.store(std::uint64_t{1} << 63);
++    highGestureState.gestureColorCount.store(64);
++    for (std::size_t gestureIx = 0; gestureIx < 64; ++gestureIx) {
++        highGestureState.gestureColors[gestureIx].Store(synth::Color::Orange);
++    }
++    const synth::ui::EncoderDrawState highGestureEncoder =
++        synth::ui::EncoderDrawStateFromParameter(highGestureState);
++    Require(highGestureEncoder.gesturesAffectingMask == (std::uint64_t{1} << 63),
++            "encoder snapshot preserves gesture bit 63");
+     const auto highGestureCommands = synth::ui::BuildEncoderDrawCommands(
+         highGestureEncoder, {0.0f, 0.0f, 128.0f, 128.0f});
+     Require(std::any_of(highGestureCommands.begin(), highGestureCommands.end(), [](const auto& command) {
+                 return command.kind == synth::ui::DrawCommand::Kind::Text && command.text == "64";
+             }),
+             "encoder renders gesture 63 as badge 64");
+
+     static_assert(synth::SynthApplication<TestApp>);
+     static_assert(!synth::ui::kPortableUiUsesJuce);
+     static_assert(std::is_same_v<decltype(synth::ui::WaveformLayerDrawState::scope), const synth::ScopeWriter*>);
diff --git a/.superpowers/sdd/scale-modulation-processing/task-6-brief.md b/.superpowers/sdd/scale-modulation-processing/task-6-brief.md
new file mode 100644
index 00000000..55425228
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-6-brief.md
@@ -0,0 +1,68 @@
+### Task 6: Braid4 Structural/Deadline Regression and Coverage Closure
+
+**OpenSpec coverage:** tasks 6.1-6.4; coverage rows for `spm-20`, `spm-72`, `spm-73`, `spm-74`, and modified `spm-25`.
+
+**Files:**
+- Modify: `projects/synth/tests/braid4_deadline_tests.cpp` — baseline/materialized-neutral/sparse-active/64-inactive cases at two host rates.
+- Modify: `projects/synth/tests/braid4_system_tests.cpp` — authoritative work-count assertions.
+- Modify: `projects/synth/docs/coverage.md` — requirements/scenarios and timing limitations.
+
+**Interfaces:**
+- Consumes: `ParameterProcessingObserver` counters from Task 1 and sparse visit counts from Tasks 2-3.
+- Produces: deterministic complexity guards plus secondary average/p99 timing evidence.
+
+- [ ] **Step 1: Add RED Braid4 scenario accounting**
+
+Create four rig configurations: baseline; all available local depth nodes materialized but neutral; a sparse active set; and 64 configured but inactive gestures. For the 64-gesture case, call `context.parameterManager->SetGestureCount(64)` before `Engine::Initialize` invokes `Braid4Core::Init` and creates any groups; do not add a shipping Braid4 mode. For the same processed internal-subframe count, assert:
+
+```cpp
+REQUIRE_TRUE(neutral.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
+REQUIRE_TRUE(inactive64.activeGestureVisits == 0);
+REQUIRE_TRUE(sparse.activeRouteVisits > 0);
+REQUIRE_TRUE(sparse.activeRouteVisits < denseConfiguredRouteVisits);
+```
+
+Run measured deadline cases at 48 kHz host/192 kHz internal and 96 kHz host/384 kHz internal. Record average and p99 for baseline and sparse-active, retaining generous platform-appropriate ceilings already used by the test instead of asserting a fragile speedup ratio.
+
+- [ ] **Step 2: Run the Braid4 tests**
+
+```bash
+make -C projects/synth build/braid4_system_tests build/braid4_deadline_tests
+projects/synth/build/braid4_system_tests
+projects/synth/build/braid4_deadline_tests
+```
+
+Expected before final fixture wiring: structural scenario assertions fail or do not compile; after wiring, both binaries exit 0 and print timing lines for both rates.
+
+- [ ] **Step 3: Update requirement coverage precisely**
+
+Add a new `spm-20` row, update `spm-25` for 64-bit randomized masks, and add `spm-72`, `spm-73`, and `spm-74` rows. Each row must name the exact test cases introduced by Tasks 1-6. State that deterministic visit counters are the complexity contract and deadline measurements are secondary, platform-sensitive smoke evidence.
+
+- [ ] **Step 4: Run the complete synth verification matrix**
+
+```bash
+make synth-test
+openspec validate scale-modulation-processing --strict
+```
+
+Expected: every synth test target, including parameter modulation, modules, persistence/engine, portable UI, browser command buffer, MIDI/controller, Braid4 system, Braid4 deadline, and randomized oracles, exits 0; OpenSpec reports the change valid. No browser format/version diff should exist.
+
+- [ ] **Step 5: Commit and pass the final task gate**
+
+```bash
+git add projects/synth/tests/braid4_deadline_tests.cpp projects/synth/tests/braid4_system_tests.cpp projects/synth/docs/coverage.md
+git commit -m "test(synth): guard sparse modulation scaling"
+```
+
+Run the global Sonnet gate and record both passing verdicts.
+
+- [ ] **Step 6: Run final cross-task Opus review and synchronize OpenSpec tasks**
+
+Generate one exact review package from the pre-Task-1 base through `HEAD`. Run xagent Claude Opus with the proposal, design, delta spec, implementation plan, test results, and review package. Require separate final `SPEC COMPLIANCE` and `CODE QUALITY` verdicts and explicit audit of audio equivalence, source identity, settling tails, 64-bit boundaries, pointer lifetime, capacity accounting, and audio-thread safety. Fix/re-run/re-review any Critical/Important finding.
+
+Every mapped checkbox must already have been synchronized after its owning task review. Only after the final Opus verdicts and Step 4 verification pass, confirm no checkbox was closed without its evidence, re-run strict validation, and commit any final evidence-only correction to the artifact:
+
+```bash
+git add openspec/changes/scale-modulation-processing/tasks.md
+git commit -m "docs(openspec): complete sparse modulation processing change"
+```
diff --git a/.superpowers/sdd/scale-modulation-processing/task-6-report.md b/.superpowers/sdd/scale-modulation-processing/task-6-report.md
new file mode 100644
index 00000000..55156614
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-6-report.md
@@ -0,0 +1,81 @@
+# Task 6 Report: Braid4 Structural/Deadline Regression and Coverage Closure
+
+## Scope
+
+- Added one authoritative Braid4 work-counter case covering baseline,
+  capacity-filled neutral local trees, one sparse active route, and 64
+  configured inactive gestures for the same 32 host frames / 128 internal
+  subframes.
+- Added sparse-active deadline cases alongside the existing baseline cases at
+  48 kHz host / 192 kHz internal and 96 kHz host / 384 kHz internal.
+- Added precise `spm-20`, `spm-25`, `spm-72`, `spm-73`, and `spm-74` coverage
+  mappings and documented deterministic counters as authoritative while timing
+  remains platform-sensitive smoke evidence.
+
+## TDD Evidence
+
+RED was observed before fixture implementation:
+
+```text
+tests/braid4_system_tests.cpp:475:11: error: unknown type name 'Braid4WorkResult'
+tests/braid4_system_tests.cpp:475:57: error: use of undeclared identifier 'Braid4WorkScenario'
+...
+8 errors generated.
+make: *** [build/braid4_system_tests] Error 1
+```
+
+The first fixture implementation then produced a meaningful assertion RED:
+
+```text
+[FAIL] braid4_sparse_work_counters_bound_inactive_capacity:
+requirement failed: materialized == availableBefore
+```
+
+That exposed that a first-level-only traversal could not fill every available
+local slot in each Braid4 group. The fixture was corrected to traverse the real
+materialized local tree breadth-first, after which all focused tests passed.
+
+## Deterministic Work Contract
+
+`braid4_sparse_work_counters_bound_inactive_capacity` verifies:
+
+- all four scenarios process equal internal-subframe counts;
+- all four scenarios make equal top-level `ProcessLite` calls;
+- filling every materializable local slot with neutral nodes leaves zero active
+  route visits;
+- 64 configured inactive gestures produce zero active gesture visits;
+- the sparse route case produces nonzero route visits below the dense configured
+  theoretical visit count.
+
+The 64-gesture fixture calls `SetGestureCount(64)` before `Engine::Initialize()`
+creates Braid4's groups.
+
+## Deadline Evidence
+
+Focused run measurements (256-frame blocks, generous existing ceilings):
+
+| Scenario | Host/internal rate | Average | p99 |
+|---|---:|---:|---:|
+| baseline | 48/192 kHz | 1.03810 ms | 1.06567 ms |
+| sparse-active | 48/192 kHz | 1.04574 ms | 1.07104 ms |
+| baseline | 96/384 kHz | 1.02816 ms | 1.04525 ms |
+| sparse-active | 96/384 kHz | 1.04270 ms | 1.11071 ms |
+
+No speedup ratio is asserted.
+
+## Verification
+
+- `make -C projects/synth build/braid4_system_tests build/braid4_deadline_tests`: PASS
+- `projects/synth/build/braid4_system_tests`: PASS
+- `projects/synth/build/braid4_deadline_tests`: PASS
+- `make synth-test`: PASS (exit 0)
+- `openspec validate scale-modulation-processing --strict`: PASS
+- `git diff --check`: PASS
+- `git diff --exit-code 5a1e9408 -- projects/synth/browser projects/synth/tests/browser_command_buffer_tests.cpp`: PASS; no browser format, version, payload, or command-buffer test change
+
+## Commit
+
+`baf2c608` — `test(synth): guard sparse modulation scaling`
+
+The task brief and this report remain uncommitted. OpenSpec checkboxes and SDD
+progress were intentionally not edited; the root agent owns Step 6 closure.
diff --git a/.superpowers/sdd/scale-modulation-processing/task-6-review-package.md b/.superpowers/sdd/scale-modulation-processing/task-6-review-package.md
new file mode 100644
index 00000000..83ea4823
--- /dev/null
+++ b/.superpowers/sdd/scale-modulation-processing/task-6-review-package.md
@@ -0,0 +1,556 @@
+# Review package: 5a1e9408..baf2c608
+
+## Commits
+baf2c608 test(synth): guard sparse modulation scaling
+
+## Files changed
+ projects/synth/docs/coverage.md                | 103 +++++++++++++++++++-
+ projects/synth/tests/braid4_deadline_tests.cpp |  52 ++++++++--
+ projects/synth/tests/braid4_system_tests.cpp   | 126 +++++++++++++++++++++++++
+ 3 files changed, 273 insertions(+), 8 deletions(-)
+
+## Diff
+diff --git a/projects/synth/docs/coverage.md b/projects/synth/docs/coverage.md
+index a6d0d1b7..87545b8f 100644
+--- a/projects/synth/docs/coverage.md
++++ b/projects/synth/docs/coverage.md
+@@ -1,13 +1,13 @@
+ # Spec Coverage
+
+-Last audit: ganged random LFO, 2026-07-15
++Last audit: sparse modulation processing, 2026-07-15
+
+ | Requirement | Status | Primary exact coverage |
+ |---|---|---|
+ | `sprs-1` | covered | `runtime_main_component_tests`, `browser_runtime_contract_tests`, `runtime_shell_session_tests`, fake-app/miniapp Playwright, generic-runtime scan |
+ | `sprs-2` | covered | component validation/geometry tests, JUCE nested-root tests, browser layout tests, desktop/narrow Playwright |
+ | `sprs-3` | covered | browser service/audio/MIDI contract tests, retained JUCE runtime-page executables, browser page Playwright |
+ | `sprs-4` | covered | browser pointer backend tests, fake-app and miniapp real-mouse Playwright, JUCE parity executable |
+ | `sprs-5` | covered | browser isolated rounded-arc test, encoder geometry executable, real-miniapp Canvas/screenshots |
+ | `sprs-6` | covered | browser resolved-layout tests plus fake-app and miniapp desktop/narrow Playwright |
+ | `sprs-7` | covered | C++, JUCE, TypeScript/Chromium, real-WASM audio/MIDI/gesture/static-site acceptance |
+@@ -21,20 +21,25 @@ Last audit: ganged random LFO, 2026-07-15
+ | `spm-70` | covered | `projects/synth/tests/parameter_modulation_tests.cpp` visualizer topology flows metadata -> depth config -> UI state, clears on disconnect, and stays out of JSON |
+ | `sru-24` | covered | `projects/synth/tests/miniapp_system_tests.cpp` visualizer node shares encoder bounds, precedes encoder, and encoder actions remain; top-level/bank-transition no-visualizer regressions; null/hidden paths in portable/Braid tests |
+ | `sru-25` | covered | `projects/synth/tests/portable_ui_tests.cpp` shared encoder underlay body alpha and preserved non-body commands; `projects/synth/tests/miniapp_system_tests.cpp` visible and hidden visualizer underlay wiring |
+ | `sdsp-33` | covered | `projects/synth/tests/miniapp_system_tests.cpp` MiniApp constructs visible distinct VCO visualizers and one LFO visualizer |
+ | `sdsp-34` | covered | `dsp_tests` shaped interpolation, reciprocal-time correlated increments, Hz-domain voice spread, validation, precision, and one-hour increment floor cases |
+ | `sdsp-35` | covered | `dsp_tests` deterministic voice wait/move/done transitions, exact and overshot boundaries, reset semantics, and double progress cases |
+ | `sdsp-36` | covered | `dsp_tests` canonical random draw order, correlated gang turnover, fixed storage/seed, bounded coherent snapshots, complete live fields, and assigned voice colors |
+ | `spv-6` | covered | `portable_ui_tests` predictive round geometry and invalid-snapshot fallback; `miniapp_juce_backend_parity_tests` and `browser_command_buffer_tests` existing-backend command parity |
+ | `spm-71` | covered | `miniapp_system_tests` source registration/configuration, audio-block processing/publishing, retained address-stable visualizer, and three-panel/underlay UI topology; JUCE/browser parity tests cover the same portable draw commands |
+ | `d4-9` | covered | `projects/synth/tests/braid4_system_tests.cpp` all Braid 4 modulator visualizers are null and modulation view is encoder-only |
++| `spm-20` (modified) | covered | `parameter_ui_snapshot_owns_parameter_source_and_gesture_colors`, `ui_state_reports_affecting_masks_through_gesture_index_63`, `randomized_message_bus_ui_state_simulation`, and portable encoder snapshot/render assertions through bit 63 |
++| `spm-25` (modified) | covered | `randomized_message_bus_ui_state_simulation` plus `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load` validate 64-bit UI masks and sparse lifecycle state against deterministic manager-owned oracles |
++| `spm-72` | covered | `group_process_sample_visits_only_registered_roots`, `recursive_local_compute_seeds_display_without_audio_rate_processing`, active-route full-scan cases, and `braid4_sparse_work_counters_bound_inactive_capacity` |
++| `spm-73` | covered | 0--64 gesture boundary/sparse-mask tests, `ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit`, portable bit-63 badge rendering, and randomized UI-state coverage |
++| `spm-74` | covered | neutral-leaf guard, bottom-up collapse, pin, settling/detach, bounded-reuse, patch-load, semantic-JSON, and randomized lifecycle cases in `parameter_modulation_tests` |
+
+ ## Requirement Mappings
+
+ ### `sprs-1` - Shared Portable Composition
+
+ - [`runtime_main_component_tests.cpp`](../tests/runtime_main_component_tests.cpp):
+   `TestSidebarOpensEachPageAndBackRestoresApp`,
+   `TestAppActionsRouteOnlyToAppSurface`, and
+   `TestRuntimeActionsRouteOnlyToOwningPageOrServices`.
+ - [`browser_runtime_contract_tests.cpp`](../tests/browser_runtime_contract_tests.cpp):
+@@ -262,20 +267,116 @@ Last audit: ganged random LFO, 2026-07-15
+   `miniapp_modulation_view_draws_visualizer_beneath_encoder`, and the top-level,
+   hidden, and bank-transition visualizer cases in that executable cover three
+   distinct waveform panels, a separate retained address-stable modulator
+   underlay, and unchanged performer controls, parameters, banks, and persistence.
+ - [`MiniAppJuceBackendParityTests.cpp`](../juce/MiniAppJuceBackendParityTests.cpp):
+   `miniapp_juce_backend_parity_tests` and
+   `TestMiniAppThreePanelCommandsUseExistingBrowserSchema` in
+   [`browser_command_buffer_tests.cpp`](../tests/browser_command_buffer_tests.cpp)
+   cover the three-panel commands in both production backends.
+
++### `spm-20` (modified) - 64-Bit Parameter UI Snapshots
++
++- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
++  `parameter_ui_snapshot_owns_parameter_source_and_gesture_colors`,
++  `ui_state_reports_affecting_masks_through_gesture_index_63`, and
++  `randomized_message_bus_ui_state_simulation` cover atomic parameter snapshots,
++  source/gesture colors, visible cells, signed and unipolar ranges, and 64-bit
++  gesture-affecting masks through index 63.
++- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp): the exact
++  `encoder snapshot preserves gesture bit 63` and
++  `encoder renders gesture 63 as badge 64` assertions pass a real
++  `Parameter::UIState` through `EncoderDrawStateFromParameter` and the portable
++  renderer.
++
++### `spm-25` (modified) - Message-Driven Randomized UI State
++
++- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
++  `randomized_message_bus_ui_state_simulation` is the deterministic
++  manager-owned gesture/UI oracle, including 64-bit masks, stable route source
++  identities, inverse positions, current/target values, selected bank/view
++  state, and reproducible seed/step/action/sample diagnostics.
++- `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load`
++  covers message-driven bank open/close, reset, collection, compatible slot
++  reuse under a distinct parent, and patch-load boundaries.
++
++### `spm-72` - Sparse Top-Level And Active-Route Traversal
++
++- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
++  `group_process_sample_visits_only_registered_roots` and
++  `recursive_local_compute_seeds_display_without_audio_rate_processing` cover
++  the top-level `ProcessLite` boundary and recursive local-state refresh.
++  `modulators_apply_active_uses_explicit_stable_source_indices`,
++  `active_modulation_routes_preserve_identity_and_settling_tail`,
++  `active_modulation_route_union_keeps_source_with_only_voice_one_nonzero`, and
++  `active_modulation_routes_randomized_full_scan_oracle_and_work_bound` cover
++  compact application, stable source identity, swap/removal, across-voice
++  route union, settling tails, and sample-by-sample full-scan equivalence.
++- [`braid4_system_tests.cpp`](../tests/braid4_system_tests.cpp):
++  `braid4_parameter_processing_ignores_materialized_local_depths` and
++  `braid4_sparse_work_counters_bound_inactive_capacity` compare equal internal
++  subframe counts across baseline, all materializable neutral locals, sparse
++  active routes, and 64 configured inactive gestures. Observer visit counts are
++  the authoritative complexity contract.
++
++### `spm-73` - Sparse 64-Bit Gestures
++
++- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
++  `manager_gesture_count_supports_zero_through_64_and_rejects_65_without_mutation`,
++  `gesture_masks_visit_only_active_bits_through_index_63`,
++  `ui_state_reports_affecting_masks_through_gesture_index_63`, and
++  `message_bus_and_patch_round_trip_gesture_indices_32_and_63` cover counts 0,
++  1, 32, 33, and 64, rejected 65, sparse set-bit evaluation, UI masks,
++  messaging, and persistence.
++- [`instrument_tests.cpp`](../tests/instrument_tests.cpp):
++  `MessageInJsonRoundTripsHighGestureIndex` and
++  `ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit`
++  cover controller index 63 while preserving the separate 32-bit bank selector.
++- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp): exact badge assertions
++  retain legacy labels through gesture 15 and distinguish gestures 16--63 with
++  one-based labels 17--64.
++
++### `spm-74` - Neutral Local-Node Reclamation
++
++- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
++  `neutral_local_collection_reclaims_leaf_and_preserves_high_water_accounting`,
++  `neutral_local_collection_retains_non_default_scene_state`,
++  `neutral_local_collection_retains_inactive_latent_gesture_value`,
++  `neutral_local_collection_retains_active_gesture_at_default_value`,
++  `neutral_local_collection_retains_unsnapped_runtime_state`, and
++  `neutral_local_collection_retains_nonzero_normalization_state` cover the
++  complete neutral/default eligibility guards and high-water accounting.
++- `neutral_local_collection_retains_parent_with_non_collectible_child`,
++  `neutral_local_collection_collapses_recursive_subtree_bottom_up`,
++  `neutral_local_collection_detaches_child_while_parent_route_finishes_settling`,
++  and `modulation_view_pins_visible_locals_until_deselect_boundary` cover
++  bottom-up ownership, detach ordering, settling, and live-view pinning.
++- `neutral_local_reuse_stays_bounded_beyond_configured_capacity`,
++  `randomized_neutral_local_collection_reuses_slots_without_stale_topology`,
++  `patch_load_collection_preserves_high_gesture_nested_state_and_collects_default_omissions`,
++  `eligible_collection_preserves_semantic_parameter_json`, and
++  `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load`
++  cover bounded reuse, complete reset, persistence, semantic JSON, and
++  lifecycle integration.
++
++### Sparse-Modulation Timing Evidence
++
++- [`braid4_deadline_tests.cpp`](../tests/braid4_deadline_tests.cpp):
++  `braid4_meets_48000hz_256_frame_deadline_and_continuity`,
++  `braid4_meets_96000hz_256_frame_deadline_and_continuity`,
++  `braid4_sparse_modulation_meets_48000hz_256_frame_deadline`, and
++  `braid4_sparse_modulation_meets_96000hz_256_frame_deadline` print baseline and
++  sparse-active average/p99 measurements at 48 kHz host/192 kHz internal and
++  96 kHz host/384 kHz internal. These generous deadline ceilings are
++  platform-sensitive smoke evidence; they do not assert a speedup ratio and do
++  not replace the deterministic work-count contract above.
++
+ ## Known Gaps
+
+ - Browser realtime audio underrun safety is intentionally not claimed by these
+   mappings. The current deterministic scheduler deficit and the deferred
+   render-ahead design are recorded in
+   [`browser-audio-underrun-diagnosis.md`](browser-audio-underrun-diagnosis.md).
+ - Audio input remains outside the browser runtime scope.
+ - Browser MIDI is bidirectional and covers SysEx, multiple selected devices,
+   polling, disconnect, reconnect, and a low-latency output drain cadence.
+   Overflow signaling for bursts beyond the bridge's bounded output queue should
+diff --git a/projects/synth/tests/braid4_deadline_tests.cpp b/projects/synth/tests/braid4_deadline_tests.cpp
+index 3e4de797..b8a29e6b 100644
+--- a/projects/synth/tests/braid4_deadline_tests.cpp
++++ b/projects/synth/tests/braid4_deadline_tests.cpp
+@@ -55,21 +55,44 @@ struct Register {
+ void RequireNear(double actual, double expected, double tolerance, const char* expr) {
+     if (std::fabs(actual - expected) > tolerance) {
+         std::ostringstream oss;
+         oss << expr << " expected " << expected << " got " << actual;
+         throw std::runtime_error(oss.str());
+     }
+ }
+
+ #define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)
+
++enum class DeadlineScenario {
++    Baseline,
++    SparseActive,
++};
++
++const char* DeadlineScenarioName(DeadlineScenario scenario) {
++    return scenario == DeadlineScenario::Baseline ? "baseline" : "sparse-active";
++}
++
++void ConfigureDeadlineScenario(synth::Engine<synth_braid4::Braid4Core>& engine,
++                               DeadlineScenario scenario) {
++    if (scenario != DeadlineScenario::SparseActive) {
++        return;
++    }
++    synth::Parameter& parameter = engine.Manager().ParameterById(0);
++    synth::Parameter* depth = parameter.EnsureModulationDepth(0);
++    REQUIRE_TRUE(depth != nullptr);
++    depth->SceneCenter(0) = 0.75f;
++    depth->SceneCenter(1) = 0.75f;
++    engine.Manager().ComputeAllParameters();
++}
++
+ struct DeadlineStats {
++    DeadlineScenario scenario = DeadlineScenario::Baseline;
+     double sampleRate = 0.0;
+     double averageSeconds = 0.0;
+     double p99Seconds = 0.0;
+     double blockSeconds = 0.0;
+     synth_braid4::Braid4Core::DebugCounterState counters;
+     std::vector<float> contiguousLeft;
+     std::vector<float> contiguousRight;
+     std::vector<float> splitLeft;
+     std::vector<float> splitRight;
+ };
+@@ -82,25 +105,28 @@ void AssertFiniteStereo(const std::array<std::vector<float>, 2>& channels) {
+     bool heardSignal = false;
+     for (const auto& channel : channels) {
+         for (const float sample : channel) {
+             REQUIRE_TRUE(std::isfinite(sample));
+             heardSignal = heardSignal || std::fabs(sample) > 0.000001f;
+         }
+     }
+     REQUIRE_TRUE(heardSignal);
+ }
+
+-std::array<std::vector<float>, 2> RunSegments(double sampleRate, const std::vector<std::size_t>& segmentFrames) {
++std::array<std::vector<float>, 2> RunSegments(double sampleRate,
++                                              const std::vector<std::size_t>& segmentFrames,
++                                              DeadlineScenario scenario) {
+     std::uint64_t timestamp = 0;
+     synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
+     engine.Initialize();
+     engine.Prepare(sampleRate, 256);
++    ConfigureDeadlineScenario(engine, scenario);
+
+     std::array<std::vector<float>, 2> captured;
+     for (const std::size_t frames : segmentFrames) {
+         std::array<std::vector<float>, 2> blockStorage{{
+             std::vector<float>(frames, 12345.0f),
+             std::vector<float>(frames, 12345.0f),
+         }};
+         std::vector<float*> outputs = PointersFor(blockStorage);
+         synth::AudioBlock block{
+             .outputs = outputs.data(),
+@@ -108,29 +134,30 @@ std::array<std::vector<float>, 2> RunSegments(double sampleRate, const std::vect
+             .numFrames = frames,
+         };
+         engine.ProcessBlock(block, timestamp++);
+
+         captured[0].insert(captured[0].end(), blockStorage[0].begin(), blockStorage[0].end());
+         captured[1].insert(captured[1].end(), blockStorage[1].begin(), blockStorage[1].end());
+     }
+     return captured;
+ }
+
+-DeadlineStats MeasureDeadline(double sampleRate) {
++DeadlineStats MeasureDeadline(double sampleRate, DeadlineScenario scenario) {
+     constexpr std::size_t kBlockFrames = 256;
+     constexpr std::size_t kWarmupBlocks = 64;
+     constexpr std::size_t kMeasuredBlocks = 512;
+
+     std::uint64_t timestamp = 0;
+     synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
+     engine.Initialize();
+     engine.Prepare(sampleRate, static_cast<int>(kBlockFrames));
++    ConfigureDeadlineScenario(engine, scenario);
+
+     std::array<std::vector<float>, 2> blockStorage{{
+         std::vector<float>(kBlockFrames, 0.0f),
+         std::vector<float>(kBlockFrames, 0.0f),
+     }};
+     std::vector<float*> outputs = PointersFor(blockStorage);
+     synth::AudioBlock block{
+         .outputs = outputs.data(),
+         .numOutputChannels = 2,
+         .numFrames = kBlockFrames,
+@@ -147,41 +174,43 @@ DeadlineStats MeasureDeadline(double sampleRate) {
+         engine.ProcessBlock(block, timestamp++);
+         const auto end = std::chrono::steady_clock::now();
+         durations.push_back(std::chrono::duration<double>(end - start).count());
+     }
+
+     std::vector<double> sorted = durations;
+     std::sort(sorted.begin(), sorted.end());
+     const std::size_t p99Index = static_cast<std::size_t>(
+         std::ceil(static_cast<double>(sorted.size()) * 0.99)) - 1;
+
+-    const auto contiguous = RunSegments(sampleRate, {kBlockFrames * 2});
+-    const auto split = RunSegments(sampleRate, {kBlockFrames, kBlockFrames});
++    const auto contiguous = RunSegments(sampleRate, {kBlockFrames * 2}, scenario);
++    const auto split = RunSegments(sampleRate, {kBlockFrames, kBlockFrames}, scenario);
+     AssertFiniteStereo(contiguous);
+     AssertFiniteStereo(split);
+
+     return {
++        .scenario = scenario,
+         .sampleRate = sampleRate,
+         .averageSeconds = std::accumulate(durations.begin(), durations.end(), 0.0) /
+                           static_cast<double>(durations.size()),
+         .p99Seconds = sorted.at(std::min(p99Index, sorted.size() - 1)),
+         .blockSeconds = static_cast<double>(kBlockFrames) / sampleRate,
+         .counters = engine.Application().DebugCounters(),
+         .contiguousLeft = contiguous[0],
+         .contiguousRight = contiguous[1],
+         .splitLeft = split[0],
+         .splitRight = split[1],
+     };
+ }
+
+-void AssertDeadlineAndContinuity(double sampleRate) {
+-    const DeadlineStats stats = MeasureDeadline(sampleRate);
++void AssertDeadlineAndContinuity(double sampleRate,
++                                 DeadlineScenario scenario = DeadlineScenario::Baseline) {
++    const DeadlineStats stats = MeasureDeadline(sampleRate, scenario);
+
+     constexpr std::size_t kBlockFrames = 256;
+     constexpr std::size_t kMeasuredBlocks = 512;
+     constexpr std::size_t kWarmupBlocks = 64;
+     const std::size_t expectedProcessedHostFrames = (kWarmupBlocks + kMeasuredBlocks) * kBlockFrames;
+
+     REQUIRE_TRUE(stats.counters.hostFramesProcessed == expectedProcessedHostFrames);
+     REQUIRE_TRUE(stats.counters.internalSubframesProcessed == expectedProcessedHostFrames * 4);
+     REQUIRE_TRUE(stats.counters.lastInternalSampleIndex == expectedProcessedHostFrames * 4 - 1);
+     REQUIRE_TRUE(stats.contiguousLeft.size() == kBlockFrames * 2);
+@@ -189,40 +218,49 @@ void AssertDeadlineAndContinuity(double sampleRate) {
+     REQUIRE_TRUE(stats.splitRight.size() == stats.contiguousRight.size());
+
+     for (std::size_t frame = 0; frame < stats.contiguousLeft.size(); ++frame) {
+         REQUIRE_NEAR(stats.splitLeft[frame], stats.contiguousLeft[frame], 0.000001);
+         REQUIRE_NEAR(stats.splitRight[frame], stats.contiguousRight[frame], 0.000001);
+     }
+
+     REQUIRE_TRUE(stats.averageSeconds <= stats.blockSeconds * 0.60);
+     REQUIRE_TRUE(stats.p99Seconds <= stats.blockSeconds * 0.80);
+
+-    std::cout << "[deadline] " << stats.sampleRate << "Hz avg="
++    std::cout << "[deadline] " << DeadlineScenarioName(stats.scenario) << " "
++              << stats.sampleRate << "Hz/" << (stats.sampleRate * 4.0) << "Hz-internal avg="
+               << (stats.averageSeconds * 1000.0) << "ms p99="
+               << (stats.p99Seconds * 1000.0) << "ms block="
+               << (stats.blockSeconds * 1000.0) << "ms\n";
+ }
+
+ } // namespace
+
+ TEST_CASE(braid4_meets_44100hz_256_frame_deadline_and_continuity) {
+     AssertDeadlineAndContinuity(44100.0);
+ }
+
+ TEST_CASE(braid4_meets_48000hz_256_frame_deadline_and_continuity) {
+     AssertDeadlineAndContinuity(48000.0);
+ }
+
+ TEST_CASE(braid4_meets_96000hz_256_frame_deadline_and_continuity) {
+     AssertDeadlineAndContinuity(96000.0);
+ }
+
++TEST_CASE(braid4_sparse_modulation_meets_48000hz_256_frame_deadline) {
++    AssertDeadlineAndContinuity(48000.0, DeadlineScenario::SparseActive);
++}
++
++TEST_CASE(braid4_sparse_modulation_meets_96000hz_256_frame_deadline) {
++    AssertDeadlineAndContinuity(96000.0, DeadlineScenario::SparseActive);
++}
++
+ int main() {
+     int failures = 0;
+     for (const auto& test : Registry()) {
+         try {
+             test.fn();
+             std::cout << "[PASS] " << test.name << "\n";
+         } catch (const std::exception& e) {
+             ++failures;
+             std::cerr << "[FAIL] " << test.name << ": " << e.what() << "\n";
+         } catch (...) {
+diff --git a/projects/synth/tests/braid4_system_tests.cpp b/projects/synth/tests/braid4_system_tests.cpp
+index 3d62aa38..c7bb1dc6 100644
+--- a/projects/synth/tests/braid4_system_tests.cpp
++++ b/projects/synth/tests/braid4_system_tests.cpp
+@@ -99,20 +99,126 @@ bool HasPolyline(const std::vector<synth::ui::DrawCommand>& commands) {
+     return std::any_of(commands.begin(), commands.end(), [](const synth::ui::DrawCommand& command) {
+         return command.kind == synth::ui::DrawCommand::Kind::Polyline;
+     });
+ }
+
+ struct EngineRunResult {
+     std::vector<std::vector<float>> channels;
+     synth_braid4::Braid4Core::DebugCounterState counters;
+ };
+
++enum class Braid4WorkScenario {
++    Baseline,
++    MaterializedNeutral,
++    SparseActive,
++    Inactive64Gestures,
++};
++
++struct Braid4WorkResult {
++    std::size_t topLevelProcessLiteCalls = 0;
++    std::size_t activeRouteVisits = 0;
++    std::size_t activeGestureVisits = 0;
++    std::size_t internalSubframesProcessed = 0;
++    std::size_t materializedLocalCount = 0;
++    std::size_t remainingMaterializableSlots = 0;
++    std::size_t denseConfiguredRouteVisits = 0;
++};
++
++Braid4WorkResult MeasureBraid4Work(Braid4WorkScenario scenario) {
++    constexpr std::size_t kHostFrames = 32;
++    std::uint64_t timestamp = 0;
++    synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
++    if (scenario == Braid4WorkScenario::Inactive64Gestures) {
++        REQUIRE_TRUE(engine.Manager().SetGestureCount(64));
++    }
++    engine.SetRuntimeDataPaths(UseScratchRuntimeDataPaths("braid4_sparse_work_counters"));
++    engine.Initialize();
++    engine.Prepare(48000.0, static_cast<int>(kHostFrames));
++
++    auto& core = engine.Application();
++    synth::ParameterManager& manager = engine.Manager();
++    const std::array<synth::ParameterGroup*, 3> groups{
++        core.StereoGroup(),
++        core.QuadGroup(),
++        core.MonoGroup(),
++    };
++
++    Braid4WorkResult result;
++    if (scenario == Braid4WorkScenario::MaterializedNeutral) {
++        for (synth::ParameterGroup* group : groups) {
++            const std::size_t availableBefore = group->AvailableParameterSlots();
++            std::size_t materialized = 0;
++            std::vector<synth::Parameter*> frontier;
++            for (std::size_t parameterIx = 0; parameterIx < manager.ParameterCount(); ++parameterIx) {
++                synth::Parameter& parameter = manager.ParameterById(static_cast<synth::ParameterId>(parameterIx));
++                if (&parameter.Group() == group) {
++                    frontier.push_back(&parameter);
++                }
++            }
++            for (std::size_t parameterIx = 0;
++                 parameterIx < frontier.size() && group->AvailableParameterSlots() != 0;
++                 ++parameterIx) {
++                for (std::size_t sourceIx = 0;
++                     sourceIx < group->Config().numModulators && group->AvailableParameterSlots() != 0;
++                     ++sourceIx) {
++                    synth::Parameter* depth = frontier[parameterIx]->EnsureModulationDepth(sourceIx);
++                    REQUIRE_TRUE(depth != nullptr);
++                    frontier.push_back(depth);
++                    ++materialized;
++                }
++            }
++            REQUIRE_TRUE(materialized == availableBefore);
++            result.materializedLocalCount += materialized;
++            result.remainingMaterializableSlots += group->AvailableParameterSlots();
++        }
++    } else if (scenario == Braid4WorkScenario::SparseActive) {
++        synth::Parameter& parameter = manager.ParameterById(0);
++        synth::Parameter* depth = parameter.EnsureModulationDepth(0);
++        REQUIRE_TRUE(depth != nullptr);
++        depth->SceneCenter(0) = 0.75f;
++        depth->SceneCenter(1) = 0.75f;
++        manager.ComputeAllParameters();
++    }
++
++    std::array<synth::ParameterProcessingObserver, 3> work{};
++    for (std::size_t groupIx = 0; groupIx < groups.size(); ++groupIx) {
++        groups[groupIx]->SetProcessingObserverForTests(&work[groupIx]);
++    }
++
++    std::array<std::vector<float>, 2> blockStorage{{
++        std::vector<float>(kHostFrames, 0.0f),
++        std::vector<float>(kHostFrames, 0.0f),
++    }};
++    std::vector<float*> outputs{blockStorage[0].data(), blockStorage[1].data()};
++    synth::AudioBlock block{
++        .outputs = outputs.data(),
++        .numOutputChannels = 2,
++        .numFrames = kHostFrames,
++    };
++    engine.ProcessBlock(block, timestamp++);
++
++    result.internalSubframesProcessed = core.DebugCounters().internalSubframesProcessed;
++    for (const synth::ParameterProcessingObserver& observer : work) {
++        result.topLevelProcessLiteCalls += observer.topLevelProcessLiteCalls;
++        result.activeRouteVisits += observer.activeRouteVisits;
++        result.activeGestureVisits += observer.activeGestureVisits;
++    }
++    std::size_t denseVisitsPerSubframe = 0;
++    for (std::size_t parameterIx = 0; parameterIx < manager.ParameterCount(); ++parameterIx) {
++        const synth::Parameter& parameter = manager.ParameterById(static_cast<synth::ParameterId>(parameterIx));
++        denseVisitsPerSubframe += parameter.Group().Config().numVoices *
++                                  parameter.Group().Config().numModulators;
++    }
++    result.denseConfiguredRouteVisits = result.internalSubframesProcessed * denseVisitsPerSubframe;
++    return result;
++}
++
+ EngineRunResult RunFreshEngineSegments(int outputChannels, const std::vector<std::size_t>& segmentFrames) {
+     std::uint64_t timestamp = 0;
+     synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
+     engine.Initialize();
+     engine.Prepare(synth_braid4::Braid4Core::Config().preferredSampleRate,
+                    synth_braid4::Braid4Core::Config().preferredBlockSize);
+
+     std::vector<std::vector<float>> captured(static_cast<std::size_t>(std::max(outputChannels, 0)));
+     for (const std::size_t frames : segmentFrames) {
+         std::vector<std::vector<float>> blockStorage(static_cast<std::size_t>(std::max(outputChannels, 0)),
+@@ -464,20 +570,40 @@ TEST_CASE(braid4_parameter_processing_ignores_materialized_local_depths) {
+     for (synth::ParameterGroup* group : groups) {
+         group->ProcessSample(1);
+     }
+
+     const std::size_t visited = work[0].topLevelProcessLiteCalls +
+                                 work[1].topLevelProcessLiteCalls +
+                                 work[2].topLevelProcessLiteCalls;
+     REQUIRE_TRUE(visited == rootCount);
+ }
+
++TEST_CASE(braid4_sparse_work_counters_bound_inactive_capacity) {
++    const Braid4WorkResult baseline = MeasureBraid4Work(Braid4WorkScenario::Baseline);
++    const Braid4WorkResult neutral = MeasureBraid4Work(Braid4WorkScenario::MaterializedNeutral);
++    const Braid4WorkResult sparse = MeasureBraid4Work(Braid4WorkScenario::SparseActive);
++    const Braid4WorkResult inactive64 = MeasureBraid4Work(Braid4WorkScenario::Inactive64Gestures);
++
++    REQUIRE_TRUE(neutral.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
++    REQUIRE_TRUE(sparse.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
++    REQUIRE_TRUE(inactive64.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
++    REQUIRE_TRUE(neutral.internalSubframesProcessed == baseline.internalSubframesProcessed);
++    REQUIRE_TRUE(sparse.internalSubframesProcessed == baseline.internalSubframesProcessed);
++    REQUIRE_TRUE(inactive64.internalSubframesProcessed == baseline.internalSubframesProcessed);
++    REQUIRE_TRUE(neutral.materializedLocalCount > 0);
++    REQUIRE_TRUE(neutral.remainingMaterializableSlots == 0);
++    REQUIRE_TRUE(neutral.activeRouteVisits == 0);
++    REQUIRE_TRUE(inactive64.activeGestureVisits == 0);
++    REQUIRE_TRUE(sparse.activeRouteVisits > 0);
++    REQUIRE_TRUE(sparse.activeRouteVisits < sparse.denseConfiguredRouteVisits);
++}
++
+ TEST_CASE(braid_palette_roles_propagate_from_literal_configuration) {
+     synth::ParameterManager manager;
+     synth::MessageInBus uiBus(&manager);
+     synth::MidiInstrumentConfig instrument;
+     synth::RuntimeConfig config = synth_braid4::Braid4::Config();
+     synth::AppContext context;
+     context.parameterManager = &manager;
+     context.uiBus = &uiBus;
+     context.instrument = &instrument;
+     context.config = &config;
diff --git a/docs/superpowers/plans/2026-07-15-scale-modulation-processing.md b/docs/superpowers/plans/2026-07-15-scale-modulation-processing.md
index 75d97428..85748cc8 100644
--- a/docs/superpowers/plans/2026-07-15-scale-modulation-processing.md
+++ b/docs/superpowers/plans/2026-07-15-scale-modulation-processing.md
@@ -17,21 +17,21 @@
 - Keep settling routes active until every voice's current and target depth is within the existing `1e-6` neutral tolerance, then snap and remove only at a control boundary.
 - Keep `parameterCount_` and `ParameterByLocalIndex` as high-water storage inspection; expose separate live-local and free-slot counts.
 - Gestures 0-7 retain numeric labels, 8-15 retain directional labels, and 16-63 use distinct one-based numeric labels `17` through `64`.
 - Browser command buffers contain rendered draw commands, not gesture masks: do not add compatibility, versioning, serialization, or wire-layout work.
 - After every task, generate an exact base-to-head review package and run an xagent Claude review. The prompt must request separate `SPEC COMPLIANCE` and `CODE QUALITY` verdicts plus Critical/Important/Minor findings with file:line evidence. Use Sonnet for Tasks 1, 2, 5, and 6; use Opus for Tasks 3 and 4. Do not begin the next task until both verdicts pass and all Critical/Important findings are fixed and re-reviewed. Immediately after approval, mark only that task's mapped OpenSpec checkboxes complete, re-run strict validation, and include that synchronized artifact in the task commit or a small follow-up commit before starting the next task.

 ---

 ### Task 1: Test Observability and the Top-Level Processing Boundary

-**OpenSpec coverage:** tasks 1.1-1.3, 3.1-3.3; `spm-72` scenarios “Materialized local depth does not add ProcessLite work” and “Recursive compute still refreshes local depth state.”
+**OpenSpec coverage:** tasks 1.1, 1.3, and 3.1-3.3; `spm-72` scenarios “Materialized local depth does not add ProcessLite work” and “Recursive compute still refreshes local depth state.” Task 1.2 is implemented and closed with Task 3, where the oracle is first consumed.

 **Files:**
 - Modify: `projects/synth/include/synth/ParameterModulation.hpp` — `ParameterProcessingObserver`, `ParameterGroup`, `Parameter` test-observer hooks and root list.
 - Modify: `projects/synth/src/ParameterModulation.cpp` — registration, group processing, recursive local state seeding.
 - Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — structural counters and recursive-display regression.
 - Modify: `projects/synth/tests/braid4_system_tests.cpp` — Braid4 root/local structural assertion.

 **Interfaces:**
 - Produces: `struct ParameterProcessingObserver { std::size_t topLevelProcessLiteCalls; std::size_t localRecursiveComputeCalls; std::size_t activeRouteVisits; std::size_t activeGestureVisits; };`
 - Produces: `void ParameterGroup::SetProcessingObserverForTests(ParameterProcessingObserver* observer)`; the caller owns the observer and may clear it with `nullptr`.
@@ -235,21 +235,21 @@ Run Step 2's commands; all three binaries must exit 0. Then:
 git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/include/synth/EncoderDraw.hpp projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/portable_ui_tests.cpp projects/synth/tests/instrument_tests.cpp
 git commit -m "feat(synth): support sparse 64-bit gestures"
 ```

 Run the global Sonnet gate and record both passing verdicts.

 ---

 ### Task 3: Stable-Identity Active Modulation Route Prefixes

-**OpenSpec coverage:** tasks 4.1-4.5; remaining `spm-72` active-prefix scenarios. Task 1.2's full-scan oracle is consumed here but is not closed twice.
+**OpenSpec coverage:** tasks 1.2 and 4.1-4.5; remaining `spm-72` active-prefix scenarios. Task 1.2's full-scan oracle is implemented and closed here.

 **Files:**
 - Modify: `projects/synth/include/synth/ParameterModulation.hpp` — compact apply API, route permutation arenas/accessors.
 - Modify: `projects/synth/src/ParameterModulation.cpp` — activation, swap-removal, compact slew/application, invariants.
 - Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — full-scan oracle and zero/sparse/dense/settling/randomized cases.
 - Modify: `projects/synth/tests/module_tests.cpp` — module-level audio equivalence.

 **Interfaces:**
 - Produces: `float Modulators::ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths, std::span<const std::size_t> sourceIndices) const`.
 - Produces: `std::size_t Parameter::ActiveRouteCount() const`, `std::span<const std::size_t> Parameter::ActiveRouteSourceIndices() const`, and `std::size_t Parameter::RoutePositionForSource(std::size_t sourceIx) const` for tests/debugging.
diff --git a/openspec/changes/scale-modulation-processing/tasks.md b/openspec/changes/scale-modulation-processing/tasks.md
index e7c8b10d..3b2e1588 100644
--- a/openspec/changes/scale-modulation-processing/tasks.md
+++ b/openspec/changes/scale-modulation-processing/tasks.md
@@ -1,42 +1,42 @@
 ## 1. Establish Sparse-Work Test Infrastructure

-- [ ] 1.1 Add test-only processing counters or observers for top-level `ProcessLite` calls, local recursive computes, active route visits, and active gesture visits without adding production audio-thread allocation.
-- [ ] 1.2 Add a deliberately source-indexed full-scan modulation/gesture oracle that can be compared sample-by-sample with the future sparse implementation.
-- [ ] 1.3 Add failing regression tests proving that materializing local modulation-depth nodes must not increase group-level `ProcessLite` call count and that nested local targets still recompute on cadence.
+- [x] 1.1 Add test-only processing counters or observers for top-level `ProcessLite` calls, local recursive computes, active route visits, and active gesture visits without adding production audio-thread allocation.
+- [x] 1.2 Add a deliberately source-indexed full-scan modulation/gesture oracle that can be compared sample-by-sample with the future sparse implementation.
+- [x] 1.3 Add failing regression tests proving that materializing local modulation-depth nodes must not increase group-level `ProcessLite` call count and that nested local targets still recompute on cadence.

 ## 2. Implement 64-Bit Sparse Gestures

-- [ ] 2.1 Add boundary tests for gesture counts 0, 1, 32, 33, 64, and rejected 65, including indices 0, 31, 32, and 63.
-- [ ] 2.2 Replace manager gesture selection and per-parameter/per-scene gesture-active byte scans with `std::uint64_t` selectors and set-bit iteration while preserving selection-versus-activation and scene-blend semantics.
-- [ ] 2.3 Widen parameter snapshots, encoder/portable draw state, and controller gesture-affecting selectors to 64 bits; give gestures 16–63 distinct one-based numeric badge labels and add bit-63 snapshot/render tests. Browser command buffers need no layout/version work because they contain rendered commands, not masks.
-- [ ] 2.4 Extend gesture edit-distribution, message-bus, UI snapshot, and patch round-trip tests through gesture 63, including deterministic assertions that inactive configured gestures are not visited.
+- [x] 2.1 Add boundary tests for gesture counts 0, 1, 32, 33, 64, and rejected 65, including indices 0, 31, 32, and 63.
+- [x] 2.2 Replace manager gesture selection and per-parameter/per-scene gesture-active byte scans with `std::uint64_t` selectors and set-bit iteration while preserving selection-versus-activation and scene-blend semantics.
+- [x] 2.3 Widen parameter snapshots, encoder/portable draw state, and controller gesture-affecting selectors to 64 bits; give gestures 16–63 distinct one-based numeric badge labels and add bit-63 snapshot/render tests. Browser command buffers need no layout/version work because they contain rendered commands, not masks.
+- [x] 2.4 Extend gesture edit-distribution, message-bus, UI snapshot, and patch round-trip tests through gesture 63, including deterministic assertions that inactive configured gestures are not visited.

 ## 3. Restore the Top-Level Audio Processing Boundary

-- [ ] 3.1 Add an explicit dense top-level processing list to `ParameterGroup` and register only manager-owned top-level parameters in it.
-- [ ] 3.2 Change group per-sample processing to iterate the top-level list while retaining recursive control-rate compute; seed local cached/UI center state and reset local display spread at compute cadence, with tests pinning that intentional display-only behavior.
-- [ ] 3.3 Update parameter-group and Braid4 structural tests to prove that local materialization no longer changes per-sample parameter count or audio output semantics.
+- [x] 3.1 Add an explicit dense top-level processing list to `ParameterGroup` and register only manager-owned top-level parameters in it.
+- [x] 3.2 Change group per-sample processing to iterate the top-level list while retaining recursive control-rate compute; seed local cached/UI center state and reset local display spread at compute cadence, with tests pinning that intentional display-only behavior.
+- [x] 3.3 Update parameter-group and Braid4 structural tests to prove that local materialization no longer changes per-sample parameter count or audio output semantics.

 ## 4. Implement Active Modulation Route Prefixes

-- [ ] 4.1 Add fixed-capacity route permutation, inverse-position, source-index, and active-count storage with debug/test invariants proving a valid stable-source bijection.
-- [ ] 4.2 Update recursive target compute to activate/reorder each parameter's across-voice route union and maintain contiguous current/target depth state while preserving indexed editing, metadata, masks, and JSON keys.
-- [ ] 4.3 Add an explicit `Modulators::ApplyActive(voiceIx, activeDepths, sourceIndices)` compact/source-index API and update `ProcessLite`, `GetRaw`, and production modulation application to visit only the active prefix, retaining routes whose current depth is still settling on any voice and removing them only after neutral snap at a control boundary.
-- [ ] 4.4 Add zero/sparse/dense, swap-removal, scene-change, nested-route, and return-to-zero tests that compare every step with the full-scan oracle.
-- [ ] 4.5 Extend the randomized parameter oracle with active permutations and assert source identity, inverse-map integrity, current/target depths, cached values, and UI masks after every action.
+- [x] 4.1 Add fixed-capacity route permutation, inverse-position, source-index, and active-count storage with debug/test invariants proving a valid stable-source bijection.
+- [x] 4.2 Update recursive target compute to activate/reorder each parameter's across-voice route union and maintain contiguous current/target depth state while preserving indexed editing, metadata, masks, and JSON keys.
+- [x] 4.3 Add an explicit `Modulators::ApplyActive(voiceIx, activeDepths, sourceIndices)` compact/source-index API and update `ProcessLite`, `GetRaw`, and production modulation application to visit only the active prefix, retaining routes whose current depth is still settling on any voice and removing them only after neutral snap at a control boundary.
+- [x] 4.4 Add zero/sparse/dense, swap-removal, scene-change, nested-route, and return-to-zero tests that compare every step with the full-scan oracle.
+- [x] 4.5 Extend the randomized parameter oracle with active permutations and assert source identity, inverse-map integrity, current/target depths, cached values, and UI masks after every action.

 ## 5. Recycle Neutral Local Modulation Nodes

-- [ ] 5.1 Define and test the local-node collection boundary/pinning API so open modulation views and active control operations cannot retain recycled pointers.
-- [ ] 5.2 Implement bottom-up eligibility checks covering all scenes, latent/default gesture state, active gestures, current/target/normalization state, child routes, and visibility pins.
-- [ ] 5.3 Add a group-owned free list keyed by backing store and slot index, include recycled slots in `AvailableParameterSlots`/`CanAllocate`, and centralize full in-place local reinitialization; make local creation reuse a compatible recycled slot before requesting another asynchronous storage batch while retaining high-water `parameterCount_`/storage-index semantics.
-- [ ] 5.4 Invoke collection after safe view-close/deselect, reset/revert, and patch-load boundaries without adding allocation, deallocation, locking, or collection traversal to the per-sample path.
-- [ ] 5.5 Add lifecycle tests for retained non-neutral/child/visible nodes, recursive neutral-subtree collapse, parent detachment with route settling, distinct-parent slot reuse, and bounded capacity across repeated edit/collect cycles.
-- [ ] 5.6 Add semantic JSON comparisons before/after collection and patch round trips proving that non-default nested topology is preserved and eligible neutral nodes remain omitted.
+- [x] 5.1 Define and test the local-node collection boundary/pinning API so open modulation views and active control operations cannot retain recycled pointers.
+- [x] 5.2 Implement bottom-up eligibility checks covering all scenes, latent/default gesture state, active gestures, current/target/normalization state, child routes, and visibility pins.
+- [x] 5.3 Add a group-owned free list keyed by backing store and slot index, include recycled slots in `AvailableParameterSlots`/`CanAllocate`, and centralize full in-place local reinitialization; make local creation reuse a compatible recycled slot before requesting another asynchronous storage batch while retaining high-water `parameterCount_`/storage-index semantics.
+- [x] 5.4 Invoke collection after safe view-close/deselect, reset/revert, and patch-load boundaries without adding allocation, deallocation, locking, or collection traversal to the per-sample path.
+- [x] 5.5 Add lifecycle tests for retained non-neutral/child/visible nodes, recursive neutral-subtree collapse, parent detachment with route settling, distinct-parent slot reuse, and bounded capacity across repeated edit/collect cycles.
+- [x] 5.6 Add semantic JSON comparisons before/after collection and patch round trips proving that non-default nested topology is preserved and eligible neutral nodes remain omitted.

 ## 6. Performance Regression and Verification

-- [ ] 6.1 Extend the Braid4 rig/deadline tests with structural work assertions for baseline, materialized-neutral, sparse-active, and 64-inactive-gesture configurations.
-- [ ] 6.2 Run Braid4 deadline smoke measurements at 48 kHz host/192 kHz internal and 96 kHz host/384 kHz internal with generous platform-appropriate ceilings, recording before/after average and p99 results.
-- [ ] 6.3 Run parameter modulation, module, persistence, portable UI, browser command-buffer, MIDI/controller, Braid4 system, Braid4 deadline, randomized oracle, and full synth test targets.
-- [ ] 6.4 Add `spm-20`, `spm-72`, `spm-73`, `spm-74`, and modified `spm-25` rows/scenarios to `projects/synth/docs/coverage.md`, including deterministic complexity guards, 64-bit randomized UI-mask coverage, and timing-test limitations.
+- [x] 6.1 Extend the Braid4 rig/deadline tests with structural work assertions for baseline, materialized-neutral, sparse-active, and 64-inactive-gesture configurations.
+- [x] 6.2 Run Braid4 deadline smoke measurements at 48 kHz host/192 kHz internal and 96 kHz host/384 kHz internal with generous platform-appropriate ceilings, recording before/after average and p99 results.
+- [x] 6.3 Run parameter modulation, module, persistence, portable UI, browser command-buffer, MIDI/controller, Braid4 system, Braid4 deadline, randomized oracle, and full synth test targets.
+- [x] 6.4 Add `spm-20`, `spm-72`, `spm-73`, `spm-74`, and modified `spm-25` rows/scenarios to `projects/synth/docs/coverage.md`, including deterministic complexity guards, 64-bit randomized UI-mask coverage, and timing-test limitations.
diff --git a/projects/synth/docs/coverage.md b/projects/synth/docs/coverage.md
index a6d0d1b7..87545b8f 100644
--- a/projects/synth/docs/coverage.md
+++ b/projects/synth/docs/coverage.md
@@ -1,13 +1,13 @@
 # Spec Coverage

-Last audit: ganged random LFO, 2026-07-15
+Last audit: sparse modulation processing, 2026-07-15

 | Requirement | Status | Primary exact coverage |
 |---|---|---|
 | `sprs-1` | covered | `runtime_main_component_tests`, `browser_runtime_contract_tests`, `runtime_shell_session_tests`, fake-app/miniapp Playwright, generic-runtime scan |
 | `sprs-2` | covered | component validation/geometry tests, JUCE nested-root tests, browser layout tests, desktop/narrow Playwright |
 | `sprs-3` | covered | browser service/audio/MIDI contract tests, retained JUCE runtime-page executables, browser page Playwright |
 | `sprs-4` | covered | browser pointer backend tests, fake-app and miniapp real-mouse Playwright, JUCE parity executable |
 | `sprs-5` | covered | browser isolated rounded-arc test, encoder geometry executable, real-miniapp Canvas/screenshots |
 | `sprs-6` | covered | browser resolved-layout tests plus fake-app and miniapp desktop/narrow Playwright |
 | `sprs-7` | covered | C++, JUCE, TypeScript/Chromium, real-WASM audio/MIDI/gesture/static-site acceptance |
@@ -21,20 +21,25 @@ Last audit: ganged random LFO, 2026-07-15
 | `spm-70` | covered | `projects/synth/tests/parameter_modulation_tests.cpp` visualizer topology flows metadata -> depth config -> UI state, clears on disconnect, and stays out of JSON |
 | `sru-24` | covered | `projects/synth/tests/miniapp_system_tests.cpp` visualizer node shares encoder bounds, precedes encoder, and encoder actions remain; top-level/bank-transition no-visualizer regressions; null/hidden paths in portable/Braid tests |
 | `sru-25` | covered | `projects/synth/tests/portable_ui_tests.cpp` shared encoder underlay body alpha and preserved non-body commands; `projects/synth/tests/miniapp_system_tests.cpp` visible and hidden visualizer underlay wiring |
 | `sdsp-33` | covered | `projects/synth/tests/miniapp_system_tests.cpp` MiniApp constructs visible distinct VCO visualizers and one LFO visualizer |
 | `sdsp-34` | covered | `dsp_tests` shaped interpolation, reciprocal-time correlated increments, Hz-domain voice spread, validation, precision, and one-hour increment floor cases |
 | `sdsp-35` | covered | `dsp_tests` deterministic voice wait/move/done transitions, exact and overshot boundaries, reset semantics, and double progress cases |
 | `sdsp-36` | covered | `dsp_tests` canonical random draw order, correlated gang turnover, fixed storage/seed, bounded coherent snapshots, complete live fields, and assigned voice colors |
 | `spv-6` | covered | `portable_ui_tests` predictive round geometry and invalid-snapshot fallback; `miniapp_juce_backend_parity_tests` and `browser_command_buffer_tests` existing-backend command parity |
 | `spm-71` | covered | `miniapp_system_tests` source registration/configuration, audio-block processing/publishing, retained address-stable visualizer, and three-panel/underlay UI topology; JUCE/browser parity tests cover the same portable draw commands |
 | `d4-9` | covered | `projects/synth/tests/braid4_system_tests.cpp` all Braid 4 modulator visualizers are null and modulation view is encoder-only |
+| `spm-20` (modified) | covered | `parameter_ui_snapshot_owns_parameter_source_and_gesture_colors`, `ui_state_reports_affecting_masks_through_gesture_index_63`, `randomized_message_bus_ui_state_simulation`, and portable encoder snapshot/render assertions through bit 63 |
+| `spm-25` (modified) | covered | `randomized_message_bus_ui_state_simulation` plus `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load` validate 64-bit UI masks and sparse lifecycle state against deterministic manager-owned oracles |
+| `spm-72` | covered | `group_process_sample_visits_only_registered_roots`, `recursive_local_compute_seeds_display_without_audio_rate_processing`, active-route full-scan cases, and `braid4_sparse_work_counters_bound_inactive_capacity` |
+| `spm-73` | covered | 0--64 gesture boundary/sparse-mask tests, `ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit`, portable bit-63 badge rendering, and randomized UI-state coverage |
+| `spm-74` | covered | neutral-leaf guard, bottom-up collapse, pin, settling/detach, bounded-reuse, patch-load, semantic-JSON, and randomized lifecycle cases in `parameter_modulation_tests` |

 ## Requirement Mappings

 ### `sprs-1` - Shared Portable Composition

 - [`runtime_main_component_tests.cpp`](../tests/runtime_main_component_tests.cpp):
   `TestSidebarOpensEachPageAndBackRestoresApp`,
   `TestAppActionsRouteOnlyToAppSurface`, and
   `TestRuntimeActionsRouteOnlyToOwningPageOrServices`.
 - [`browser_runtime_contract_tests.cpp`](../tests/browser_runtime_contract_tests.cpp):
@@ -262,20 +267,116 @@ Last audit: ganged random LFO, 2026-07-15
   `miniapp_modulation_view_draws_visualizer_beneath_encoder`, and the top-level,
   hidden, and bank-transition visualizer cases in that executable cover three
   distinct waveform panels, a separate retained address-stable modulator
   underlay, and unchanged performer controls, parameters, banks, and persistence.
 - [`MiniAppJuceBackendParityTests.cpp`](../juce/MiniAppJuceBackendParityTests.cpp):
   `miniapp_juce_backend_parity_tests` and
   `TestMiniAppThreePanelCommandsUseExistingBrowserSchema` in
   [`browser_command_buffer_tests.cpp`](../tests/browser_command_buffer_tests.cpp)
   cover the three-panel commands in both production backends.

+### `spm-20` (modified) - 64-Bit Parameter UI Snapshots
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `parameter_ui_snapshot_owns_parameter_source_and_gesture_colors`,
+  `ui_state_reports_affecting_masks_through_gesture_index_63`, and
+  `randomized_message_bus_ui_state_simulation` cover atomic parameter snapshots,
+  source/gesture colors, visible cells, signed and unipolar ranges, and 64-bit
+  gesture-affecting masks through index 63.
+- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp): the exact
+  `encoder snapshot preserves gesture bit 63` and
+  `encoder renders gesture 63 as badge 64` assertions pass a real
+  `Parameter::UIState` through `EncoderDrawStateFromParameter` and the portable
+  renderer.
+
+### `spm-25` (modified) - Message-Driven Randomized UI State
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `randomized_message_bus_ui_state_simulation` is the deterministic
+  manager-owned gesture/UI oracle, including 64-bit masks, stable route source
+  identities, inverse positions, current/target values, selected bank/view
+  state, and reproducible seed/step/action/sample diagnostics.
+- `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load`
+  covers message-driven bank open/close, reset, collection, compatible slot
+  reuse under a distinct parent, and patch-load boundaries.
+
+### `spm-72` - Sparse Top-Level And Active-Route Traversal
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `group_process_sample_visits_only_registered_roots` and
+  `recursive_local_compute_seeds_display_without_audio_rate_processing` cover
+  the top-level `ProcessLite` boundary and recursive local-state refresh.
+  `modulators_apply_active_uses_explicit_stable_source_indices`,
+  `active_modulation_routes_preserve_identity_and_settling_tail`,
+  `active_modulation_route_union_keeps_source_with_only_voice_one_nonzero`, and
+  `active_modulation_routes_randomized_full_scan_oracle_and_work_bound` cover
+  compact application, stable source identity, swap/removal, across-voice
+  route union, settling tails, and sample-by-sample full-scan equivalence.
+- [`braid4_system_tests.cpp`](../tests/braid4_system_tests.cpp):
+  `braid4_parameter_processing_ignores_materialized_local_depths` and
+  `braid4_sparse_work_counters_bound_inactive_capacity` compare equal internal
+  subframe counts across baseline, all materializable neutral locals, sparse
+  active routes, and 64 configured inactive gestures. Observer visit counts are
+  the authoritative complexity contract.
+
+### `spm-73` - Sparse 64-Bit Gestures
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `manager_gesture_count_supports_zero_through_64_and_rejects_65_without_mutation`,
+  `gesture_masks_visit_only_active_bits_through_index_63`,
+  `ui_state_reports_affecting_masks_through_gesture_index_63`, and
+  `message_bus_and_patch_round_trip_gesture_indices_32_and_63` cover counts 0,
+  1, 32, 33, and 64, rejected 65, sparse set-bit evaluation, UI masks,
+  messaging, and persistence.
+- [`instrument_tests.cpp`](../tests/instrument_tests.cpp):
+  `MessageInJsonRoundTripsHighGestureIndex` and
+  `ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit`
+  cover controller index 63 while preserving the separate 32-bit bank selector.
+- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp): exact badge assertions
+  retain legacy labels through gesture 15 and distinguish gestures 16--63 with
+  one-based labels 17--64.
+
+### `spm-74` - Neutral Local-Node Reclamation
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `neutral_local_collection_reclaims_leaf_and_preserves_high_water_accounting`,
+  `neutral_local_collection_retains_non_default_scene_state`,
+  `neutral_local_collection_retains_inactive_latent_gesture_value`,
+  `neutral_local_collection_retains_active_gesture_at_default_value`,
+  `neutral_local_collection_retains_unsnapped_runtime_state`, and
+  `neutral_local_collection_retains_nonzero_normalization_state` cover the
+  complete neutral/default eligibility guards and high-water accounting.
+- `neutral_local_collection_retains_parent_with_non_collectible_child`,
+  `neutral_local_collection_collapses_recursive_subtree_bottom_up`,
+  `neutral_local_collection_detaches_child_while_parent_route_finishes_settling`,
+  and `modulation_view_pins_visible_locals_until_deselect_boundary` cover
+  bottom-up ownership, detach ordering, settling, and live-view pinning.
+- `neutral_local_reuse_stays_bounded_beyond_configured_capacity`,
+  `randomized_neutral_local_collection_reuses_slots_without_stale_topology`,
+  `patch_load_collection_preserves_high_gesture_nested_state_and_collects_default_omissions`,
+  `eligible_collection_preserves_semantic_parameter_json`, and
+  `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load`
+  cover bounded reuse, complete reset, persistence, semantic JSON, and
+  lifecycle integration.
+
+### Sparse-Modulation Timing Evidence
+
+- [`braid4_deadline_tests.cpp`](../tests/braid4_deadline_tests.cpp):
+  `braid4_meets_48000hz_256_frame_deadline_and_continuity`,
+  `braid4_meets_96000hz_256_frame_deadline_and_continuity`,
+  `braid4_sparse_modulation_meets_48000hz_256_frame_deadline`, and
+  `braid4_sparse_modulation_meets_96000hz_256_frame_deadline` print baseline and
+  sparse-active average/p99 measurements at 48 kHz host/192 kHz internal and
+  96 kHz host/384 kHz internal. These generous deadline ceilings are
+  platform-sensitive smoke evidence; they do not assert a speedup ratio and do
+  not replace the deterministic work-count contract above.
+
 ## Known Gaps

 - Browser realtime audio underrun safety is intentionally not claimed by these
   mappings. The current deterministic scheduler deficit and the deferred
   render-ahead design are recorded in
   [`browser-audio-underrun-diagnosis.md`](browser-audio-underrun-diagnosis.md).
 - Audio input remains outside the browser runtime scope.
 - Browser MIDI is bidirectional and covers SysEx, multiple selected devices,
   polling, disconnect, reconnect, and a low-latency output drain cadence.
   Overflow signaling for bursts beyond the bridge's bounded output queue should
diff --git a/projects/synth/include/synth/EncoderDraw.hpp b/projects/synth/include/synth/EncoderDraw.hpp
index 67fa75f2..45c54471 100644
--- a/projects/synth/include/synth/EncoderDraw.hpp
+++ b/projects/synth/include/synth/EncoderDraw.hpp
@@ -210,21 +210,21 @@ inline void AppendArcWithSwitchGaps(std::vector<DrawCommand>& commands,
         if (endAngle <= startAngle)
         {
             continue;
         }

         commands.push_back(DrawCommand::Arc(
             ArcBoundsFor(centerX, centerY, radius), startAngle, endAngle, color, strokeWidth));
     }
 }

-inline std::size_t CountMaskBits(std::uint32_t mask)
+inline std::size_t CountMaskBits(std::uint64_t mask)
 {
     std::size_t count = 0;
     while (mask != 0)
     {
         count += mask & 1u;
         mask >>= 1u;
     }
     return count;
 }

@@ -232,21 +232,25 @@ inline std::string BadgeText(bool modulator, std::size_t index)
 {
     if (modulator)
     {
         return "M" + std::to_string(index + 1);
     }
     if (index < 8)
     {
         return std::to_string(index + 1);
     }
     static constexpr const char* x_Symbols[] = {"U", "R", "D", "L", "UU", "RR", "DD", "LL"};
-    return x_Symbols[std::min<std::size_t>(index - 8, 7)];
+    if (index < 16)
+    {
+        return x_Symbols[index - 8];
+    }
+    return std::to_string(index + 1);
 }

 inline void GetBadgePosition(float centerX,
                              float centerY,
                              float radius,
                              std::size_t ix,
                              std::size_t total,
                              bool upper,
                              float& badgeX,
                              float& badgeY,
@@ -282,21 +286,21 @@ struct EncoderVoiceDrawState
     synth::Color indicatorColor = synth::Color::Grey;
 };

 struct EncoderDrawState
 {
     bool connected = false;
     bool hasVisualizerUnderlay = false;
     bool bipolar = false;
     std::size_t switchValues = 0;
     std::uint32_t modulatorsAffectingMask = 0;
-    std::uint32_t gesturesAffectingMask = 0;
+    synth::GestureMask gesturesAffectingMask = 0;
     synth::Color baseColor = synth::Color::Off;
     std::string shortLabel;
     std::size_t voiceCount = 0;
     std::vector<EncoderVoiceDrawState> voices;
     std::vector<synth::Color> modulatorColors;
     std::vector<synth::Color> gestureColors;
 };

 inline EncoderDrawState EncoderDrawStateFromParameter(const synth::Parameter::UIState& state)
 {
@@ -679,32 +683,32 @@ inline std::vector<DrawCommand> BuildEncoderDrawCommands(const EncoderDrawState&
             {body.x + inset, body.y + inset, body.width - inset * 2.0f, body.height - inset * 2.0f},
             synth::ScaleAlpha(state.baseColor, state.hasVisualizerUnderlay ? 0.14f : 0.28f)));
     }
     commands.push_back(DrawCommand::StrokeEllipse(body, synth::ScaleAlpha(state.baseColor, 0.9f), 1.5f));
     commands.push_back(DrawCommand::StrokeRoundedRect(
         {bounds.x + 1.0f, bounds.y + 1.0f, bounds.width - 2.0f, bounds.height - 2.0f},
         6.0f,
         Color::Rgb(8, 9, 10),
         1.0f));

-    const auto drawBadges = [&](std::uint32_t mask, bool upper, bool modulator) {
+    const auto drawBadges = [&](std::uint64_t mask, bool upper, bool modulator) {
         const std::vector<synth::Color>& colors = modulator ? state.modulatorColors : state.gestureColors;
-        const std::uint32_t validMask = colors.size() >= 32
-                                            ? std::numeric_limits<std::uint32_t>::max()
-                                            : (colors.empty() ? 0u : (std::uint32_t{1} << colors.size()) - 1u);
+        const std::uint64_t validMask = colors.size() >= 64
+                                            ? std::numeric_limits<std::uint64_t>::max()
+                                            : (colors.empty() ? 0u : (std::uint64_t{1} << colors.size()) - 1u);
         assert((mask & ~validMask) == 0u && "badge mask index exceeds published color count");
         mask &= validMask;
         const std::size_t total = EncoderGeometry::CountMaskBits(mask);
         std::size_t badgeIndex = 0;
         for (std::size_t bit = 0; bit < colors.size() && badgeIndex < total; ++bit)
         {
-            if ((mask & (1u << bit)) == 0)
+            if ((mask & (std::uint64_t{1} << bit)) == 0)
             {
                 continue;
             }

             float x = 0.0f;
             float y = 0.0f;
             float length = 0.0f;
             EncoderGeometry::GetBadgePosition(
                 centerX, centerY, baseRadius * 0.72f, badgeIndex, total, upper, x, y, length);
             AppendBadge(commands, x, y, length, colors[bit], EncoderGeometry::BadgeText(modulator, bit));
diff --git a/projects/synth/include/synth/ParameterModulation.hpp b/projects/synth/include/synth/ParameterModulation.hpp
index b474352b..269137e1 100644
--- a/projects/synth/include/synth/ParameterModulation.hpp
+++ b/projects/synth/include/synth/ParameterModulation.hpp
@@ -1,16 +1,16 @@
 #pragma once

 #include <algorithm>
+#include <atomic>
 #include <cstddef>
 #include <cstdint>
-#include <atomic>
 #include <cmath>
 #include <functional>
 #include <memory>
 #include <optional>
 #include <random>
 #include <span>
 #include <stdexcept>
 #include <string>
 #include <string_view>
 #include <vector>
@@ -20,20 +20,21 @@

 namespace synth::ui {
 class Visualizer;
 }

 namespace synth {

 using ParameterId = std::uint32_t;
 using PhysicalEncoderId = std::uint32_t;
 using PageOrdinal = std::uint32_t;
+using GestureMask = std::uint64_t;

 struct AtomicColor {
     AtomicColor() = default;
     explicit AtomicColor(Color color) { Store(color); }
     AtomicColor(const AtomicColor&) = delete;
     AtomicColor& operator=(const AtomicColor&) = delete;

     void Store(Color color, std::memory_order order = std::memory_order_relaxed) {
         value.store(color.Packed(), order);
     }
@@ -110,20 +111,21 @@ struct SceneState {
     float blend = 0.0f;
 };

 struct PageDescriptor {
     PageOrdinal ordinal = 0;
     std::string name;
 };

 class Parameter;
 class ParameterManager;
+class Bank;
 class BankSlot;
 struct ParameterStorageBatch;

 struct Page {
     PageOrdinal ordinal = 0;
     std::string name;
     std::vector<Parameter*> parameters;
 };

 inline constexpr float kDefaultProcessLiteAlpha = 0.1226942309f;  // 1 kHz one-pole cutoff at 48 kHz
@@ -135,20 +137,28 @@ inline constexpr float kDefaultUiDisplaySpreadAlpha = 0.0013089969f;  // about 1
 float ConvertOnePoleAlpha(float referenceAlpha, double referenceRate, double processingRate);
 std::size_t ConvertSampleInterval(std::size_t referenceInterval, double referenceRate, double processingRate);

 struct ParameterProcessingTiming {
     float processLiteAlpha;
     std::size_t targetComputeIntervalSamples;
     float uiDisplayCenterAlpha;
     float uiDisplaySpreadAlpha;
 };

+struct ParameterProcessingObserver {
+    std::size_t topLevelProcessLiteCalls = 0;
+    std::size_t localRecursiveComputeCalls = 0;
+    std::size_t activeRouteVisits = 0;
+    std::size_t activeGestureVisits = 0;
+    std::size_t neutralCollectionPasses = 0;
+};
+
 struct ParameterGroupConfig {
     std::size_t numVoices = 0;
     std::size_t numModulators = 0;
     std::size_t numScenes = 0;
     std::size_t maxParameters = 0;
     float processLiteAlpha = kDefaultProcessLiteAlpha;
     float targetCenterAlpha = kDefaultTargetCenterAlpha;
     std::size_t targetComputeIntervalSamples = kDefaultTargetComputeIntervalSamples;
     float uiDisplayCenterAlpha = kDefaultUiDisplayCenterAlpha;
     float uiDisplaySpreadAlpha = kDefaultUiDisplaySpreadAlpha;
@@ -173,27 +183,29 @@ struct ParameterStorageBatch {
     std::vector<float> currentCenterScaleArena;
     std::vector<float> targetCenterScaleArena;
     std::vector<float> currentNormalizationOffsetArena;
     std::vector<float> targetNormalizationOffsetArena;
     std::vector<float> currentMinValueArena;
     std::vector<float> targetMinValueArena;
     std::vector<float> currentMaxValueArena;
     std::vector<float> targetMaxValueArena;
     std::vector<float> currentDepthArena;
     std::vector<float> targetDepthArena;
+    std::vector<std::size_t> routeSourceIndexArena;
+    std::vector<std::size_t> sourceRoutePositionArena;
     std::vector<float> currentKnobValueArena;
     std::vector<float> uiDisplayCenterArena;
     std::vector<float> uiDisplaySpreadEnergyArena;
     std::vector<Parameter*> modulationDepthArena;
     std::vector<float> sceneCenterArena;
     std::vector<float> gestureValueArena;
-    std::vector<std::uint8_t> gestureActiveArena;
+    std::vector<GestureMask> gestureActiveMaskArena;
 };

 std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
                                                                  std::size_t gestureCount,
                                                                  std::size_t capacity);

 struct ModulatorMetadata {
     std::string name;
     std::string shortName;
     Color sourceColor;
@@ -217,20 +229,22 @@ struct ParameterConfig {
     std::vector<Color> indicatorColors;
 };

 class Modulators {
 public:
     explicit Modulators(std::size_t voices = 0, std::size_t modulators = 0);

     float& Value(std::size_t voiceIx, std::size_t modIx);
     float Value(std::size_t voiceIx, std::size_t modIx) const;
     float Apply(std::size_t voiceIx, std::span<const float> depths) const;
+    float ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths,
+                      std::span<const std::size_t> sourceIndices) const;
     // Source pointers are caller-owned and must remain address-stable while registered.
     void SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
                              ModulatorMetadata metadata);
     void UpdateModValues();

     std::size_t NumVoices() const { return numVoices_; }
     std::size_t NumModulators() const { return numModulators_; }

     ModulatorMetadata& Metadata(std::size_t modIx);
     const ModulatorMetadata& Metadata(std::size_t modIx) const;
@@ -248,104 +262,124 @@ private:
 };

 class Gestures {
 public:
     explicit Gestures(std::size_t gestures = 0);

     float& Value(std::size_t gestureIx);
     float Value(std::size_t gestureIx) const;
     void Select(std::size_t gestureIx, bool selected);
     bool Selected(std::size_t gestureIx) const;
+    GestureMask SelectedMask() const { return selectedMask_; }
     void ClearSelection();

     std::size_t NumGestures() const { return values_.size(); }

     GestureMetadata& Metadata(std::size_t gestureIx);
     const GestureMetadata& Metadata(std::size_t gestureIx) const;
     std::span<GestureMetadata> Metadata() { return metadata_; }
     std::span<const GestureMetadata> Metadata() const { return metadata_; }

 private:
     void CheckIndex(std::size_t gestureIx) const;

     std::vector<float> values_;
-    std::vector<bool> selected_;
+    GestureMask selectedMask_ = 0;
     std::vector<GestureMetadata> metadata_;
 };

 class ParameterGroup {
 public:
     ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount);
     ~ParameterGroup();

     const ParameterGroupConfig& Config() const { return config_; }
     Modulators& GetModulators() { return modulators_; }
     const Modulators& GetModulators() const { return modulators_; }
     ParameterManager& Manager() { return *manager_; }
     const ParameterManager& Manager() const { return *manager_; }

     bool CanAllocate() const;
     std::size_t AvailableParameterSlots() const;
     void AddParameterStorageBatch(std::unique_ptr<ParameterStorageBatch> batch);
     std::size_t ParameterCount() const { return parameterCount_; }
+    std::size_t TopLevelParameterCount() const { return topLevelParameters_.size(); }
+    std::size_t LiveLocalParameterCount() const { return liveLocalParameterCount_; }
+    std::size_t FreeLocalParameterSlotCount() const { return recycledLocalSlots_.size(); }
+    std::size_t CollectNeutralLocalParameters();
     Parameter& ParameterByLocalIndex(std::size_t localIx);
     const Parameter& ParameterByLocalIndex(std::size_t localIx) const;
     std::size_t GestureCount() const { return gestureCount_; }
     void SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
                              ModulatorMetadata metadata);
     void UpdateModValues();
     void SelectGesture(std::size_t gestureIx);
     void DeselectGesture(std::size_t gestureIx);
     bool GestureSelected(std::size_t gestureIx) const;
     void SetGestureValue(std::size_t gestureIx, float value);
     float GestureValue(std::size_t gestureIx) const;
     void ClearGestureActiveFlagsForActiveSceneSelection(const SceneState& scene, std::size_t gestureIx);
     void ConfigureProcessingTiming(const ParameterProcessingTiming& timing);
     void ProcessSample(std::uint64_t sampleIndex);
+    void SetProcessingObserverForTests(ParameterProcessingObserver* observer) { processingObserver_ = observer; }

 private:
     friend class Parameter;
     friend class ParameterManager;
     friend class Bank;

     Parameter& CreateLocalParameter(ParameterConfig config, ParameterId id);
+    void RecycleLocalParameter(Parameter& parameter);
+    void RegisterTopLevelParameter(Parameter& parameter);
     void RequestParameterStorageBatch(std::size_t minimumAdditionalParameters);
     void RequestParameterStorageBatchIfLow();

     // Groups own parameter objects and all same-shaped per-parameter arenas.
     // Parameter instances hold spans into these arenas; callers must not move a
     // group after handing out Parameter references.
     ParameterGroupConfig config_;
     ParameterManager* manager_ = nullptr;
     std::size_t gestureCount_ = 0;
     Modulators modulators_;
     std::size_t parameterCount_ = 0;
+    std::size_t liveLocalParameterCount_ = 0;
+    std::vector<Parameter*> topLevelParameters_;
+    ParameterProcessingObserver* processingObserver_ = nullptr;
     std::vector<std::unique_ptr<Parameter>> parameters_;
     std::vector<std::unique_ptr<ParameterStorageBatch>> extraStorageBatches_;
+    struct RecycledLocalSlot {
+        Parameter* parameter = nullptr;
+        ParameterStorageBatch* batch = nullptr;
+        std::size_t slotIx = 0;
+        std::size_t storageLocalIx = 0;
+    };
+    std::vector<RecycledLocalSlot> recycledLocalSlots_;
     bool storageRequestPending_ = false;
     std::vector<float> currentCenterScaleArena_;
     std::vector<float> targetCenterScaleArena_;
     std::vector<float> currentNormalizationOffsetArena_;
     std::vector<float> targetNormalizationOffsetArena_;
     std::vector<float> currentMinValueArena_;
     std::vector<float> targetMinValueArena_;
     std::vector<float> currentMaxValueArena_;
     std::vector<float> targetMaxValueArena_;
     std::vector<float> currentDepthArena_;
     std::vector<float> targetDepthArena_;
+    std::vector<std::size_t> routeSourceIndexArena_;
+    std::vector<std::size_t> sourceRoutePositionArena_;
     std::vector<float> currentKnobValueArena_;
     std::vector<float> uiDisplayCenterArena_;
     std::vector<float> uiDisplaySpreadEnergyArena_;
     std::vector<Parameter*> modulationDepthArena_;
     std::vector<float> sceneCenterArena_;
     std::vector<float> gestureValueArena_;
-    std::vector<std::uint8_t> gestureActiveArena_;
+    std::vector<GestureMask> gestureActiveMaskArena_;
 };

 class Parameter {
 public:
     Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx);
     Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
               ParameterStorageBatch& storageBatch, std::size_t slotIx);

     struct UIState {
         UIState() = default;
@@ -358,21 +392,21 @@ public:

         void Configure(std::size_t voiceCapacity, std::size_t modulatorColorCapacity = 0,
                        std::size_t gestureColorCapacity = 0);
         void SetDisconnected();

         std::atomic<std::uint32_t> revision{0};
         std::atomic<bool> connected{false};
         std::atomic<bool> bipolar{false};
         std::atomic<std::size_t> switchValues{0};
         std::atomic<std::uint32_t> modulatorsAffectingMask{0};
-        std::atomic<std::uint32_t> gesturesAffectingMask{0};
+        std::atomic<GestureMask> gesturesAffectingMask{0};
         AtomicColor baseColor;
         std::atomic<synth::ui::Visualizer*> visualizer{nullptr};
         std::atomic<const char*> shortName{nullptr};
         std::atomic<std::size_t> voiceCount{0};
         std::size_t voiceCapacity = 0;
         std::atomic<std::size_t> modulatorColorCount{0};
         std::size_t modulatorColorCapacity = 0;
         std::unique_ptr<AtomicColor[]> modulatorSourceColors;
         std::atomic<std::size_t> gestureColorCount{0};
         std::size_t gestureColorCapacity = 0;
@@ -416,81 +450,108 @@ public:
     Parameter& EnsureModulationDepth(std::size_t modIx, ParameterConfig config);
     void ClearModulationDepths();
     Parameter* ModulationDepthParameter(std::size_t modIx) const;

     float& SceneCenter(std::size_t sceneIx);
     float SceneCenter(std::size_t sceneIx) const;
     float& GestureValue(std::size_t sceneIx, std::size_t gestureIx);
     float GestureValue(std::size_t sceneIx, std::size_t gestureIx) const;
     void SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active);
     bool GestureActive(std::size_t sceneIx, std::size_t gestureIx) const;
-    std::uint32_t GesturesAffectingMask() const;
-
-    std::span<float> CurrentDepths(std::size_t voiceIx);
-    std::span<const float> CurrentDepths(std::size_t voiceIx) const;
-    std::span<float> TargetDepths(std::size_t voiceIx);
-    std::span<const float> TargetDepths(std::size_t voiceIx) const;
+    GestureMask GesturesAffectingMask() const;
+
+    std::span<float> CurrentDepthSlots(std::size_t voiceIx);
+    std::span<const float> CurrentDepthSlots(std::size_t voiceIx) const;
+    std::span<float> TargetDepthSlots(std::size_t voiceIx);
+    std::span<const float> TargetDepthSlots(std::size_t voiceIx) const;
+    float CurrentDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const;
+    float TargetDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const;
+    std::size_t ActiveRouteCount() const { return activeRouteCount_; }
+    std::span<const std::size_t> ActiveRouteSourceIndices() const {
+        return routeSourceIndices_.first(activeRouteCount_);
+    }
+    std::size_t RouteSourceIndex(std::size_t slot) const;
+    std::size_t RoutePositionForSource(std::size_t sourceIx) const;

     float CurrentCenter() const { return currentCenter_; }
     float TargetCenter() const { return targetCenter_; }
     float CurrentCenterScale(std::size_t voiceIx) const;
     float TargetCenterScale(std::size_t voiceIx) const;
     float CurrentNormalizationOffset(std::size_t voiceIx) const;
     float TargetNormalizationOffset(std::size_t voiceIx) const;
     std::size_t RecursionDepth() const { return recursionDepth_; }
     JSON ToValueJSON(JsonArena& arena) const;
     bool LoadValuesFromJSON(JSON json);

 private:
     friend class ParameterManager;
+    friend class ParameterGroup;
+    friend class Bank;

-    std::size_t VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const;
     std::size_t SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const;
+    void ValidateSceneGestureIndices(std::size_t sceneIx, std::size_t gestureIx) const;
     void ValidateSceneEndpoints(const SceneState& scene) const;
     float EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const;
     void ResetSceneToDefault(std::size_t sceneIx, float defaultValue);
     void ResetModulationDepthToNeutral(const SceneState& scene);
     float ComputeRawCenter(const SceneState& scene) const;
     void ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth, bool smoothTargetCenter);
     void SnapCurrentToTarget();
     void SeedCachedKnobAndUiDisplayState();
     bool WouldCreateCycle(const Parameter* candidate) const;
     ParameterConfig ModulationDepthConfig(std::size_t modIx) const;
     float TargetValue(std::size_t voiceIx) const;
+    std::size_t VoiceRouteIndex(std::size_t voiceIx, std::size_t routeSlot) const;
+    void EnsureRouteActive(std::size_t sourceIx);
+    void RemoveActiveRoute(std::size_t routeSlot);
+    bool RouteNeutralAcrossVoices(std::size_t routeSlot) const;
+    void PruneNeutralActiveRoutes();
+    void AssertRouteBijection() const;
+    void PinLocalForView();
+    void UnpinLocalForView();
+    bool CanRecycleLocal() const;
+    std::size_t CollectNeutralChildren();
+    void ResetLocalForReuse(ParameterId id, ParameterConfig config);
     std::uint32_t ModulatorsAffectingMask() const;
     bool HasNonDefaultState() const;
     bool HasNonZeroState() const;

     ParameterId id_;
     ParameterGroup& group_;
     ParameterConfig config_;
+    ParameterStorageBatch* storageBatch_ = nullptr;
     std::size_t slotIx_ = 0;
+    std::size_t storageLocalIx_ = 0;
+    std::size_t localViewPinCount_ = 0;
     std::size_t recursionDepth_ = 0;
     float currentCenter_ = 0.0f;
     float targetCenter_ = 0.0f;
     std::span<float> currentCenterScales_;
     std::span<float> targetCenterScales_;
     std::span<float> currentNormalizationOffsets_;
     std::span<float> targetNormalizationOffsets_;
     std::span<float> currentMinValues_;
     std::span<float> targetMinValues_;
     std::span<float> currentMaxValues_;
     std::span<float> targetMaxValues_;
     std::span<float> currentDepths_;
     std::span<float> targetDepths_;
+    std::span<std::size_t> routeSourceIndices_;
+    std::span<std::size_t> sourceRoutePositions_;
+    std::size_t activeRouteCount_ = 0;
     std::span<float> currentKnobValues_;
     std::span<float> uiDisplayCenters_;
     std::span<float> uiDisplaySpreadEnergies_;
     std::span<Parameter*> modulationDepths_;
     std::span<float> sceneCenters_;
     std::span<float> gestureValues_;
-    std::span<std::uint8_t> gestureActive_;
+    std::span<GestureMask> gestureActiveMasks_;
 };

 class Bank {
 public:
     explicit Bank(ParameterManager* manager = nullptr);

     struct VisibleCell {
         Parameter* parameter = nullptr;
     };

@@ -508,21 +569,21 @@ public:
     void Deselect();
     bool ShowingModulation() const;
     void SetBankColor(Color color) { bankColor_ = color; }
     Color BankColor() const { return bankColor_; }

     std::size_t VisibleMappingCount() const;
     Parameter* VisibleParameter(PhysicalEncoderId encoderId) const;
     VisibleCell VisibleCellFor(PhysicalEncoderId encoderId) const;
     Parameter* SelectedParameter() const { return selected_; }
     Parameter* TargetParameter() const;
-    std::uint32_t GesturesAffectingMask() const;
+    GestureMask GesturesAffectingMask() const;

 private:
     friend class BankSlot;

     struct Cell {
         PhysicalEncoderId encoderId = 0;
         Parameter* parameter = nullptr;
     };

     void AssociateSlot(BankSlot& slot);
@@ -668,20 +729,21 @@ public:
     ParameterGroup& CreateGroup(ParameterGroupConfig config);
     ParameterId RegisterParameter(ParameterGroup& group, ParameterConfig config);
     Parameter& CreateParameter(ParameterGroup& group, ParameterConfig config);
     Parameter& ParameterById(ParameterId id);
     const Parameter& ParameterById(ParameterId id) const;
     std::size_t ParameterCount() const { return parameters_.size(); }
     Parameter* FindParameterByName(std::string_view name);
     const Parameter* FindParameterByName(std::string_view name) const;
     JSON ParameterValuesToJSON(JsonArena& arena) const;
     bool LoadParameterValuesFromJSON(JSON json);
+    std::size_t CollectNeutralLocalParameters();
     void ComputeAllParameters();
     // Control-rate target computation for the steady-state audio pump:
     // Compute() every parameter without snapping current values, so
     // ProcessLite() slewing stays audible (sar-6). Use ComputeAllParameters()
     // only for non-steady-state moments (init, patch load, revert).
     void ComputeAllTargets();
     void CaptureDefaultControlState();
     void RevertAllToDefaults();

     float GetLinear(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const;
@@ -740,20 +802,21 @@ public:
     void SetRandomSource(ParameterRandomFloat valueSource, ParameterRandomFloat coinSource,
                          ParameterRandomIndex indexSource);
     float NextRandomValue();
     float NextRandomCoin();
     std::size_t NextRandomIndex(std::size_t exclusiveMax);

     void SelectGesture(std::size_t gestureIx);
     void DeselectGesture(std::size_t gestureIx);
     void ToggleGestureSelected(std::size_t gestureIx);
     bool GestureSelected(std::size_t gestureIx) const;
+    GestureMask SelectedGestureMask() const { return gestures_.SelectedMask(); }
     void SetGestureValue(std::size_t gestureIx, float value);
     float GestureValue(std::size_t gestureIx) const;
     GestureMetadata& GestureMetadataAt(std::size_t gestureIx);
     const GestureMetadata& GestureMetadataAt(std::size_t gestureIx) const;
     void ClearGestureActiveFlagsForActiveSceneSelection(std::size_t gestureIx);

     std::unique_ptr<UIState> CreateUIState() const;
     void PopulateUIState(UIState& state) const;
     void SetParameterMessageOutBus(ParameterMessageOutBus* bus) { parameterMessageOutBus_ = bus; }
     bool RequestParameterStorageBatch(ParameterGroup& group, std::size_t minimumAdditionalParameters);
diff --git a/projects/synth/src/ParameterModulation.cpp b/projects/synth/src/ParameterModulation.cpp
index 216cf708..fa895e7f 100644
--- a/projects/synth/src/ParameterModulation.cpp
+++ b/projects/synth/src/ParameterModulation.cpp
@@ -1,26 +1,47 @@
 #include "synth/ParameterModulation.hpp"

 #include <algorithm>
 #include <array>
+#include <cassert>
+#include <bit>
 #include <charconv>
 #include <cmath>
 #include <limits>
 #include <stdexcept>
 #include <utility>

 namespace synth {

 namespace {

 // Local modulation-depth controls are intentionally not addressable through ParameterManager::ParameterById.
 constexpr ParameterId kLocalParameterId = std::numeric_limits<ParameterId>::max();
+constexpr float kModulationNeutralTolerance = 0.000001f;
+// A local depth is a normalized bipolar control, so its standard zero-depth value is the knob center.
+constexpr float kNeutralModulationDepthCenter = 0.5f;
+
+GestureMask GestureCountMask(std::size_t count) {
+    if (count >= std::numeric_limits<GestureMask>::digits) {
+        return std::numeric_limits<GestureMask>::max();
+    }
+    return count == 0 ? GestureMask{0} : (GestureMask{1} << count) - GestureMask{1};
+}
+
+template <class Fn>
+void ForEachGestureBit(GestureMask mask, Fn&& fn) {
+    while (mask != 0) {
+        const std::size_t gestureIx = std::countr_zero(mask);
+        mask &= mask - 1;
+        fn(gestureIx);
+    }
+}

 void ValidateProcessingRates(double referenceRate, double processingRate) {
     if (!(std::isfinite(referenceRate) && referenceRate > 0.0 && std::isfinite(processingRate) &&
           processingRate > 0.0)) {
         throw std::invalid_argument("processing timing rates must be positive and finite");
     }
 }

 void ValidateOnePoleAlpha(float alpha) {
     if (!(alpha >= 0.0f && alpha <= 1.0f)) {
@@ -210,27 +231,29 @@ ParameterStorageBatch::ParameterStorageBatch(const ParameterGroupConfig& config,
       currentCenterScaleArena(capacity * config.numVoices),
       targetCenterScaleArena(capacity * config.numVoices),
       currentNormalizationOffsetArena(capacity * config.numVoices),
       targetNormalizationOffsetArena(capacity * config.numVoices),
       currentMinValueArena(capacity * config.numVoices),
       targetMinValueArena(capacity * config.numVoices),
       currentMaxValueArena(capacity * config.numVoices),
       targetMaxValueArena(capacity * config.numVoices),
       currentDepthArena(capacity * config.numVoices * config.numModulators),
       targetDepthArena(capacity * config.numVoices * config.numModulators),
+      routeSourceIndexArena(capacity * config.numModulators),
+      sourceRoutePositionArena(capacity * config.numModulators),
       currentKnobValueArena(capacity * config.numVoices),
       uiDisplayCenterArena(capacity * config.numVoices),
       uiDisplaySpreadEnergyArena(capacity * config.numVoices),
       modulationDepthArena(capacity * config.numModulators, nullptr),
       sceneCenterArena(capacity * config.numScenes),
       gestureValueArena(capacity * config.numScenes * gestureCount),
-      gestureActiveArena(capacity * config.numScenes * gestureCount, 0) {
+      gestureActiveMaskArena(capacity * config.numScenes, 0) {
     parameters.reserve(capacity);
 }

 bool ParameterStorageBatch::Compatible(const ParameterGroupConfig& config, std::size_t liveGestureCount) const {
     return numVoices == config.numVoices && numModulators == config.numModulators &&
            numScenes == config.numScenes && gestureCount == liveGestureCount && capacity > 0;
 }

 std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
                                                                  std::size_t gestureCount,
@@ -262,20 +285,40 @@ float Modulators::Apply(std::size_t voiceIx, std::span<const float> depths) cons
     }

     const std::size_t rowStart = voiceIx * numModulators_;
     float result = 0.0f;
     for (std::size_t modIx = 0; modIx < numModulators_; ++modIx) {
         result += values_[rowStart + modIx] * depths[modIx];
     }
     return result;
 }

+float Modulators::ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths,
+                              std::span<const std::size_t> sourceIndices) const {
+    if (voiceIx >= numVoices_) {
+        throw std::out_of_range("modulator voice index out of range");
+    }
+    if (activeDepths.size() != sourceIndices.size()) {
+        throw std::invalid_argument("active depth and source index counts differ");
+    }
+
+    const std::size_t rowStart = voiceIx * numModulators_;
+    float result = 0.0f;
+    for (std::size_t slot = 0; slot < activeDepths.size(); ++slot) {
+        if (sourceIndices[slot] >= numModulators_) {
+            throw std::out_of_range("modulator source index out of range");
+        }
+        result += values_[rowStart + sourceIndices[slot]] * activeDepths[slot];
+    }
+    return result;
+}
+
 void Modulators::SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
                                      ModulatorMetadata metadata) {
     if (modIx >= numModulators_) {
         throw std::out_of_range("modulator index out of range");
     }
     if (sourcePointers.size() != numVoices_) {
         throw std::invalid_argument("modulation source pointer count does not match voice count");
     }
     if (metadata.connected) {
         for (float* sourcePointer : sourcePointers) {
@@ -318,45 +361,53 @@ std::size_t Modulators::Index(std::size_t voiceIx, std::size_t modIx) const {
         throw std::out_of_range("modulator voice index out of range");
     }
     if (modIx >= numModulators_) {
         throw std::out_of_range("modulator index out of range");
     }
     return voiceIx * numModulators_ + modIx;
 }

 Gestures::Gestures(std::size_t gestures)
     : values_(gestures, 0.0f),
-      selected_(gestures, false),
-      metadata_(gestures) {}
+      metadata_(gestures) {
+    if (gestures > std::numeric_limits<GestureMask>::digits) {
+        throw std::invalid_argument("gesture count exceeds 64-bit selector capacity");
+    }
+}

 float& Gestures::Value(std::size_t gestureIx) {
     CheckIndex(gestureIx);
     return values_[gestureIx];
 }

 float Gestures::Value(std::size_t gestureIx) const {
     CheckIndex(gestureIx);
     return values_[gestureIx];
 }

 void Gestures::Select(std::size_t gestureIx, bool selected) {
     CheckIndex(gestureIx);
-    selected_[gestureIx] = selected;
+    const GestureMask bit = GestureMask{1} << gestureIx;
+    if (selected) {
+        selectedMask_ |= bit;
+    } else {
+        selectedMask_ &= ~bit;
+    }
 }

 bool Gestures::Selected(std::size_t gestureIx) const {
     CheckIndex(gestureIx);
-    return selected_[gestureIx];
+    return (selectedMask_ & (GestureMask{1} << gestureIx)) != 0;
 }

 void Gestures::ClearSelection() {
-    std::fill(selected_.begin(), selected_.end(), false);
+    selectedMask_ = 0;
 }

 GestureMetadata& Gestures::Metadata(std::size_t gestureIx) {
     CheckIndex(gestureIx);
     return metadata_[gestureIx];
 }

 const GestureMetadata& Gestures::Metadata(std::size_t gestureIx) const {
     CheckIndex(gestureIx);
     return metadata_[gestureIx];
@@ -368,95 +419,156 @@ void Gestures::CheckIndex(std::size_t gestureIx) const {
     }
 }

 ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount)
     : config_(ValidateConfig(config)),
       manager_(&manager),
       gestureCount_(gestureCount),
       modulators_(config.numVoices, config.numModulators),
       parameterCount_(0) {
     parameters_.reserve(config_.maxParameters);
+    topLevelParameters_.reserve(config_.maxParameters);
+    recycledLocalSlots_.reserve(config_.maxParameters);
     currentCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
     targetCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
     currentNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
     targetNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
     currentMinValueArena_.resize(config_.maxParameters * config_.numVoices);
     targetMinValueArena_.resize(config_.maxParameters * config_.numVoices);
     currentMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
     targetMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
     currentDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
     targetDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
+    routeSourceIndexArena_.resize(config_.maxParameters * config_.numModulators);
+    sourceRoutePositionArena_.resize(config_.maxParameters * config_.numModulators);
     currentKnobValueArena_.resize(config_.maxParameters * config_.numVoices);
     uiDisplayCenterArena_.resize(config_.maxParameters * config_.numVoices);
     uiDisplaySpreadEnergyArena_.resize(config_.maxParameters * config_.numVoices);
     modulationDepthArena_.resize(config_.maxParameters * config_.numModulators, nullptr);
     sceneCenterArena_.resize(config_.maxParameters * config_.numScenes);
     gestureValueArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_);
-    gestureActiveArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_, 0);
+    gestureActiveMaskArena_.resize(config_.maxParameters * config_.numScenes, 0);
 }

 ParameterGroup::~ParameterGroup() = default;

 bool ParameterGroup::CanAllocate() const {
     return AvailableParameterSlots() > 0;
 }

 std::size_t ParameterGroup::AvailableParameterSlots() const {
     const std::size_t initialAllocated = std::min(parameterCount_, config_.maxParameters);
     std::size_t available = config_.maxParameters - initialAllocated;
     for (const auto& batch : extraStorageBatches_) {
         available += batch->Available();
     }
-    return available;
+    return available + recycledLocalSlots_.size();
 }

 void ParameterGroup::AddParameterStorageBatch(std::unique_ptr<ParameterStorageBatch> batch) {
     if (batch == nullptr || !batch->Compatible(config_, gestureCount_)) {
         throw std::invalid_argument("parameter storage batch does not match group shape");
     }
     storageRequestPending_ = false;
     extraStorageBatches_.push_back(std::move(batch));
 }

 Parameter& ParameterGroup::CreateLocalParameter(ParameterConfig config, ParameterId id) {
     if (config.name.empty()) {
         throw std::logic_error("parameter name must not be empty");
     }
     if (!CanAllocate()) {
         throw std::length_error("parameter group capacity exhausted");
     }

+    if (id == kLocalParameterId && !recycledLocalSlots_.empty()) {
+        RecycledLocalSlot recycled = recycledLocalSlots_.back();
+        recycledLocalSlots_.pop_back();
+        if (recycled.parameter == nullptr || recycled.parameter->storageBatch_ != recycled.batch ||
+            recycled.parameter->slotIx_ != recycled.slotIx ||
+            recycled.parameter->storageLocalIx_ != recycled.storageLocalIx ||
+            &ParameterByLocalIndex(recycled.storageLocalIx) != recycled.parameter ||
+            (recycled.batch != nullptr && !recycled.batch->Compatible(config_, gestureCount_))) {
+            throw std::logic_error("recycled local parameter slot identity is invalid");
+        }
+        recycled.parameter->ResetLocalForReuse(id, std::move(config));
+        ++liveLocalParameterCount_;
+        RequestParameterStorageBatchIfLow();
+        return *recycled.parameter;
+    }
+
     if (parameterCount_ < config_.maxParameters) {
         auto parameter = std::make_unique<Parameter>(id, *this, std::move(config), parameterCount_);
         Parameter& result = *parameter;
         parameters_.push_back(std::move(parameter));
         ++parameterCount_;
+        if (id == kLocalParameterId) {
+            ++liveLocalParameterCount_;
+        }
         RequestParameterStorageBatchIfLow();
         return result;
     }

     for (const auto& batch : extraStorageBatches_) {
         if (batch->Available() == 0) {
             continue;
         }
         const std::size_t slotIx = batch->allocated++;
         auto parameter = std::make_unique<Parameter>(id, *this, std::move(config), *batch, slotIx);
         Parameter& result = *parameter;
         batch->parameters.push_back(std::move(parameter));
         ++parameterCount_;
+        if (id == kLocalParameterId) {
+            ++liveLocalParameterCount_;
+        }
         RequestParameterStorageBatchIfLow();
         return result;
     }

     throw std::length_error("parameter group capacity exhausted");
 }

+void ParameterGroup::RecycleLocalParameter(Parameter& parameter) {
+    if (parameter.id_ != kLocalParameterId || parameter.localViewPinCount_ != 0) {
+        throw std::logic_error("only unpinned local parameters can be recycled");
+    }
+    if (liveLocalParameterCount_ == 0) {
+        throw std::logic_error("local parameter accounting underflow");
+    }
+    if (parameter.storageLocalIx_ >= parameterCount_ ||
+        &ParameterByLocalIndex(parameter.storageLocalIx_) != &parameter) {
+        throw std::logic_error("local parameter storage identity is invalid");
+    }
+    recycledLocalSlots_.push_back({
+        .parameter = &parameter,
+        .batch = parameter.storageBatch_,
+        .slotIx = parameter.slotIx_,
+        .storageLocalIx = parameter.storageLocalIx_,
+    });
+    --liveLocalParameterCount_;
+}
+
+std::size_t ParameterGroup::CollectNeutralLocalParameters() {
+    if (processingObserver_ != nullptr) {
+        ++processingObserver_->neutralCollectionPasses;
+    }
+    std::size_t collected = 0;
+    for (Parameter* root : topLevelParameters_) {
+        collected += root->CollectNeutralChildren();
+    }
+    return collected;
+}
+
+void ParameterGroup::RegisterTopLevelParameter(Parameter& parameter) {
+    topLevelParameters_.push_back(&parameter);
+}
+
 Parameter& ParameterGroup::ParameterByLocalIndex(std::size_t localIx) {
     if (localIx < parameters_.size()) {
         return *parameters_.at(localIx);
     }
     std::size_t remaining = localIx - parameters_.size();
     for (const auto& batch : extraStorageBatches_) {
         if (remaining < batch->parameters.size()) {
             return *batch->parameters.at(remaining);
         }
         remaining -= batch->parameters.size();
@@ -509,30 +621,34 @@ void ParameterGroup::UpdateModValues() {

 void ParameterGroup::ConfigureProcessingTiming(const ParameterProcessingTiming& timing) {
     ValidateProcessingTiming(timing);
     config_.processLiteAlpha = timing.processLiteAlpha;
     config_.targetComputeIntervalSamples = timing.targetComputeIntervalSamples;
     config_.uiDisplayCenterAlpha = timing.uiDisplayCenterAlpha;
     config_.uiDisplaySpreadAlpha = timing.uiDisplaySpreadAlpha;
 }

 void ParameterGroup::ProcessSample(std::uint64_t sampleIndex) {
-    for (std::size_t localIx = 0; localIx < parameterCount_; ++localIx) {
-        ParameterByLocalIndex(localIx).ProcessSample(sampleIndex);
+    for (Parameter* parameter : topLevelParameters_) {
+        parameter->ProcessSample(sampleIndex);
+        if (processingObserver_ != nullptr) {
+            ++processingObserver_->topLevelProcessLiteCalls;
+        }
     }
 }

 Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx)
     : id_(id),
       group_(group),
       config_(std::move(config)),
       slotIx_(slotIx),
+      storageLocalIx_(group.parameterCount_),
       currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
       targetCenter_(currentCenter_),
       currentCenterScales_(ArenaSlice(group_.currentCenterScaleArena_, slotIx_ * group_.Config().numVoices,
                                       group_.Config().numVoices)),
       targetCenterScales_(ArenaSlice(group_.targetCenterScaleArena_, slotIx_ * group_.Config().numVoices,
                                      group_.Config().numVoices)),
       currentNormalizationOffsets_(ArenaSlice(group_.currentNormalizationOffsetArena_,
                                              slotIx_ * group_.Config().numVoices,
                                              group_.Config().numVoices)),
       targetNormalizationOffsets_(ArenaSlice(group_.targetNormalizationOffsetArena_,
@@ -549,60 +665,72 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
                                    group_.Config().numVoices)),
       targetMaxValues_(ArenaSlice(group_.targetMaxValueArena_,
                                   slotIx_ * group_.Config().numVoices,
                                   group_.Config().numVoices)),
       currentDepths_(ArenaSlice(group_.currentDepthArena_,
                                 slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
                                 group_.Config().numVoices * group_.Config().numModulators)),
       targetDepths_(ArenaSlice(group_.targetDepthArena_,
                                slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
                                group_.Config().numVoices * group_.Config().numModulators)),
+      routeSourceIndices_(ArenaSlice(group_.routeSourceIndexArena_,
+                                     slotIx_ * group_.Config().numModulators,
+                                     group_.Config().numModulators)),
+      sourceRoutePositions_(ArenaSlice(group_.sourceRoutePositionArena_,
+                                       slotIx_ * group_.Config().numModulators,
+                                       group_.Config().numModulators)),
       currentKnobValues_(ArenaSlice(group_.currentKnobValueArena_, slotIx_ * group_.Config().numVoices,
                                     group_.Config().numVoices)),
       uiDisplayCenters_(ArenaSlice(group_.uiDisplayCenterArena_, slotIx_ * group_.Config().numVoices,
                                    group_.Config().numVoices)),
       uiDisplaySpreadEnergies_(ArenaSlice(group_.uiDisplaySpreadEnergyArena_,
                                           slotIx_ * group_.Config().numVoices,
                                           group_.Config().numVoices)),
       modulationDepths_(ArenaSlice(group_.modulationDepthArena_, slotIx_ * group_.Config().numModulators,
                                    group_.Config().numModulators)),
       sceneCenters_(ArenaSlice(group_.sceneCenterArena_, slotIx_ * group_.Config().numScenes,
                                group_.Config().numScenes)),
       gestureValues_(ArenaSlice(group_.gestureValueArena_,
                                 slotIx_ * group_.Config().numScenes * group_.GestureCount(),
                                 group_.Config().numScenes * group_.GestureCount())),
-      gestureActive_(ArenaSlice(group_.gestureActiveArena_,
-                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
-                                group_.Config().numScenes * group_.GestureCount())) {
+      gestureActiveMasks_(ArenaSlice(group_.gestureActiveMaskArena_,
+                                     slotIx_ * group_.Config().numScenes,
+                                     group_.Config().numScenes)) {
     std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
     std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
     std::fill(currentMinValues_.begin(), currentMinValues_.end(), currentCenter_);
     std::fill(targetMinValues_.begin(), targetMinValues_.end(), currentCenter_);
     std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), currentCenter_);
     std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), currentCenter_);
     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    for (std::size_t sourceIx = 0; sourceIx < routeSourceIndices_.size(); ++sourceIx) {
+        routeSourceIndices_[sourceIx] = sourceIx;
+        sourceRoutePositions_[sourceIx] = sourceIx;
+    }
     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
-    std::fill(gestureActive_.begin(), gestureActive_.end(), 0);
+    std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
     SeedCachedKnobAndUiDisplayState();
 }

 Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
                      ParameterStorageBatch& storageBatch, std::size_t slotIx)
     : id_(id),
       group_(group),
       config_(std::move(config)),
+      storageBatch_(&storageBatch),
       slotIx_(slotIx),
+      storageLocalIx_(group.parameterCount_),
       currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
       targetCenter_(currentCenter_),
       currentCenterScales_(ArenaSlice(storageBatch.currentCenterScaleArena, slotIx_ * group_.Config().numVoices,
                                       group_.Config().numVoices)),
       targetCenterScales_(ArenaSlice(storageBatch.targetCenterScaleArena, slotIx_ * group_.Config().numVoices,
                                      group_.Config().numVoices)),
       currentNormalizationOffsets_(ArenaSlice(storageBatch.currentNormalizationOffsetArena,
                                              slotIx_ * group_.Config().numVoices,
                                              group_.Config().numVoices)),
       targetNormalizationOffsets_(ArenaSlice(storageBatch.targetNormalizationOffsetArena,
@@ -619,56 +747,159 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
                                    group_.Config().numVoices)),
       targetMaxValues_(ArenaSlice(storageBatch.targetMaxValueArena,
                                   slotIx_ * group_.Config().numVoices,
                                   group_.Config().numVoices)),
       currentDepths_(ArenaSlice(storageBatch.currentDepthArena,
                                 slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
                                 group_.Config().numVoices * group_.Config().numModulators)),
       targetDepths_(ArenaSlice(storageBatch.targetDepthArena,
                                slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
                                group_.Config().numVoices * group_.Config().numModulators)),
+      routeSourceIndices_(ArenaSlice(storageBatch.routeSourceIndexArena,
+                                     slotIx_ * group_.Config().numModulators,
+                                     group_.Config().numModulators)),
+      sourceRoutePositions_(ArenaSlice(storageBatch.sourceRoutePositionArena,
+                                       slotIx_ * group_.Config().numModulators,
+                                       group_.Config().numModulators)),
       currentKnobValues_(ArenaSlice(storageBatch.currentKnobValueArena, slotIx_ * group_.Config().numVoices,
                                     group_.Config().numVoices)),
       uiDisplayCenters_(ArenaSlice(storageBatch.uiDisplayCenterArena, slotIx_ * group_.Config().numVoices,
                                    group_.Config().numVoices)),
       uiDisplaySpreadEnergies_(ArenaSlice(storageBatch.uiDisplaySpreadEnergyArena,
                                           slotIx_ * group_.Config().numVoices,
                                           group_.Config().numVoices)),
       modulationDepths_(ArenaSlice(storageBatch.modulationDepthArena, slotIx_ * group_.Config().numModulators,
                                    group_.Config().numModulators)),
       sceneCenters_(ArenaSlice(storageBatch.sceneCenterArena, slotIx_ * group_.Config().numScenes,
                                group_.Config().numScenes)),
       gestureValues_(ArenaSlice(storageBatch.gestureValueArena,
                                 slotIx_ * group_.Config().numScenes * group_.GestureCount(),
                                 group_.Config().numScenes * group_.GestureCount())),
-      gestureActive_(ArenaSlice(storageBatch.gestureActiveArena,
-                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
-                                group_.Config().numScenes * group_.GestureCount())) {
+      gestureActiveMasks_(ArenaSlice(storageBatch.gestureActiveMaskArena,
+                                     slotIx_ * group_.Config().numScenes,
+                                     group_.Config().numScenes)) {
     std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
     std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
     std::fill(currentMinValues_.begin(), currentMinValues_.end(), currentCenter_);
     std::fill(targetMinValues_.begin(), targetMinValues_.end(), currentCenter_);
     std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), currentCenter_);
     std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), currentCenter_);
     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    for (std::size_t sourceIx = 0; sourceIx < routeSourceIndices_.size(); ++sourceIx) {
+        routeSourceIndices_[sourceIx] = sourceIx;
+        sourceRoutePositions_[sourceIx] = sourceIx;
+    }
     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
-    std::fill(gestureActive_.begin(), gestureActive_.end(), 0);
+    std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
     SeedCachedKnobAndUiDisplayState();
 }

 ParameterStorageBatch::~ParameterStorageBatch() = default;

+void Parameter::PinLocalForView() {
+    if (id_ == kLocalParameterId) {
+        ++localViewPinCount_;
+    }
+}
+
+void Parameter::UnpinLocalForView() {
+    if (id_ != kLocalParameterId) {
+        return;
+    }
+    if (localViewPinCount_ == 0) {
+        throw std::logic_error("local parameter view pin underflow");
+    }
+    --localViewPinCount_;
+}
+
+bool Parameter::CanRecycleLocal() const {
+    if (id_ != kLocalParameterId || localViewPinCount_ != 0 || activeRouteCount_ != 0 ||
+        HasNonDefaultState() || HasNonZeroState()) {
+        return false;
+    }
+    if (std::any_of(modulationDepths_.begin(), modulationDepths_.end(),
+                    [](const Parameter* child) { return child != nullptr; })) {
+        return false;
+    }
+
+    const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
+    const auto allNear = [&](std::span<const float> values, float expected) {
+        return std::all_of(values.begin(), values.end(), [&](float value) {
+            return std::fabs(value - expected) <= kModulationNeutralTolerance;
+        });
+    };
+    return allNear(currentMinValues_, defaultValue) && allNear(targetMinValues_, defaultValue) &&
+           allNear(currentMaxValues_, defaultValue) && allNear(targetMaxValues_, defaultValue) &&
+           allNear(currentKnobValues_, defaultValue) && allNear(uiDisplayCenters_, defaultValue) &&
+           allNear(uiDisplaySpreadEnergies_, 0.0f);
+}
+
+std::size_t Parameter::CollectNeutralChildren() {
+    std::size_t collected = 0;
+    for (std::size_t sourceIx = 0; sourceIx < modulationDepths_.size(); ++sourceIx) {
+        Parameter* child = modulationDepths_[sourceIx];
+        if (child == nullptr) {
+            continue;
+        }
+        collected += child->CollectNeutralChildren();
+        if (!child->CanRecycleLocal()) {
+            continue;
+        }
+
+        modulationDepths_[sourceIx] = nullptr;
+        group_.RecycleLocalParameter(*child);
+        ++collected;
+    }
+    return collected;
+}
+
+void Parameter::ResetLocalForReuse(ParameterId id, ParameterConfig config) {
+    if (id != kLocalParameterId) {
+        throw std::logic_error("recycled parameter slots are local-only");
+    }
+    id_ = id;
+    config_ = std::move(config);
+    recursionDepth_ = 0;
+    localViewPinCount_ = 0;
+    const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
+    currentCenter_ = defaultValue;
+    targetCenter_ = defaultValue;
+    std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
+    std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
+    std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
+    std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
+    std::fill(currentMinValues_.begin(), currentMinValues_.end(), defaultValue);
+    std::fill(targetMinValues_.begin(), targetMinValues_.end(), defaultValue);
+    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), defaultValue);
+    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), defaultValue);
+    std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
+    std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    for (std::size_t sourceIx = 0; sourceIx < routeSourceIndices_.size(); ++sourceIx) {
+        routeSourceIndices_[sourceIx] = sourceIx;
+        sourceRoutePositions_[sourceIx] = sourceIx;
+    }
+    activeRouteCount_ = 0;
+    std::fill(currentKnobValues_.begin(), currentKnobValues_.end(), defaultValue);
+    std::fill(uiDisplayCenters_.begin(), uiDisplayCenters_.end(), defaultValue);
+    std::fill(uiDisplaySpreadEnergies_.begin(), uiDisplaySpreadEnergies_.end(), 0.0f);
+    std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
+    std::fill(sceneCenters_.begin(), sceneCenters_.end(), defaultValue);
+    std::fill(gestureValues_.begin(), gestureValues_.end(), defaultValue);
+    std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
+    AssertRouteBijection();
+}
+
 void Parameter::UIState::Configure(std::size_t newVoiceCapacity, std::size_t newModulatorColorCapacity,
                                    std::size_t newGestureColorCapacity) {
     voiceCapacity = newVoiceCapacity;
     modulatorColorCapacity = newModulatorColorCapacity;
     gestureColorCapacity = newGestureColorCapacity;
     values = std::make_unique<std::atomic<float>[]>(voiceCapacity);
     spreadValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
     minValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
     maxValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
     switchValue = std::make_unique<std::atomic<std::size_t>[]>(voiceCapacity);
@@ -721,21 +952,23 @@ Color Parameter::IndicatorColor(std::size_t voiceIx) const {
         throw std::out_of_range("parameter indicator color index out of range");
     }
     return config_.indicatorColors[voiceIx];
 }

 float Parameter::GetRaw(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return ClampToRange(currentCenter_ * currentCenterScales_[voiceIx] + currentNormalizationOffsets_[voiceIx] +
-                            group_.GetModulators().Apply(voiceIx, CurrentDepths(voiceIx)),
+                            group_.GetModulators().ApplyActive(
+                                voiceIx, CurrentDepthSlots(voiceIx).first(activeRouteCount_),
+                                ActiveRouteSourceIndices()),
                         config_.range);
 }

 float Parameter::CachedKnobValue(std::size_t voiceIx) const {
     if (voiceIx >= currentKnobValues_.size()) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return currentKnobValues_[voiceIx];
 }

@@ -950,22 +1183,28 @@ void Parameter::ProcessLite() {
     const float alpha = group_.Config().processLiteAlpha;
     currentCenter_ += alpha * (targetCenter_ - currentCenter_);
     for (std::size_t voiceIx = 0; voiceIx < currentCenterScales_.size(); ++voiceIx) {
         currentCenterScales_[voiceIx] +=
             alpha * (targetCenterScales_[voiceIx] - currentCenterScales_[voiceIx]);
         currentNormalizationOffsets_[voiceIx] +=
             alpha * (targetNormalizationOffsets_[voiceIx] - currentNormalizationOffsets_[voiceIx]);
         currentMinValues_[voiceIx] += alpha * (targetMinValues_[voiceIx] - currentMinValues_[voiceIx]);
         currentMaxValues_[voiceIx] += alpha * (targetMaxValues_[voiceIx] - currentMaxValues_[voiceIx]);
     }
-    for (std::size_t ix = 0; ix < currentDepths_.size(); ++ix) {
-        currentDepths_[ix] += alpha * (targetDepths_[ix] - currentDepths_[ix]);
+    for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+        for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+            const std::size_t ix = VoiceRouteIndex(voiceIx, routeSlot);
+            currentDepths_[ix] += alpha * (targetDepths_[ix] - currentDepths_[ix]);
+            if (group_.processingObserver_ != nullptr) {
+                ++group_.processingObserver_->activeRouteVisits;
+            }
+        }
     }
     for (std::size_t voiceIx = 0; voiceIx < currentKnobValues_.size(); ++voiceIx) {
         const float knob = GetRaw(voiceIx);
         currentKnobValues_[voiceIx] = knob;
         uiDisplayCenters_[voiceIx] += group_.Config().uiDisplayCenterAlpha * (knob - uiDisplayCenters_[voiceIx]);
         const float residual = knob - uiDisplayCenters_[voiceIx];
         uiDisplaySpreadEnergies_[voiceIx] +=
             group_.Config().uiDisplaySpreadAlpha * ((residual * residual) - uiDisplaySpreadEnergies_[voiceIx]);
     }
 }
@@ -984,70 +1223,70 @@ void Parameter::HandleIncDec(const SceneState& scene, float delta) {
     auto armSelectedGesture = [&](std::size_t sceneIx, std::size_t gestureIx) {
         if (GestureActive(sceneIx, gestureIx)) {
             return false;
         }
         GestureValue(sceneIx, gestureIx) = SceneCenter(sceneIx);
         SetGestureActive(sceneIx, gestureIx, true);
         return true;
     };

     bool armedGesture = false;
-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
-        if (!group_.Manager().GestureSelected(gestureIx)) {
-            continue;
-        }
-
+    ForEachGestureBit(group_.Manager().SelectedGestureMask() & GestureCountMask(group_.GestureCount()),
+                      [&](std::size_t gestureIx) {
         if (blend <= 0.0f) {
             armedGesture = armSelectedGesture(scene.leftScene, gestureIx) || armedGesture;
         } else if (blend >= 1.0f) {
             armedGesture = armSelectedGesture(scene.rightScene, gestureIx) || armedGesture;
         } else {
             armedGesture = armSelectedGesture(scene.leftScene, gestureIx) || armedGesture;
             if (scene.rightScene != scene.leftScene) {
                 armedGesture = armSelectedGesture(scene.rightScene, gestureIx) || armedGesture;
             }
         }
-    }
+    });

     if (armedGesture) {
         return;
     }

     float activeEffectiveWeightSum = 0.0f;
     float baseShareNumerator = 0.0f;
-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
+    const GestureMask activeGestures =
+        (gestureActiveMasks_[scene.leftScene] | gestureActiveMasks_[scene.rightScene]) &
+        GestureCountMask(group_.GestureCount());
+    ForEachGestureBit(activeGestures, [&](std::size_t gestureIx) {
         const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
         if (effectiveWeight == 0.0f) {
-            continue;
+            return;
         }
         activeEffectiveWeightSum += effectiveWeight;
         baseShareNumerator += effectiveWeight * (1.0f - effectiveWeight);
-    }
+    });

     if (activeEffectiveWeightSum == 0.0f) {
         ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend, delta, config_.range);
         return;
     }

     ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend,
                            delta * (baseShareNumerator / activeEffectiveWeightSum), config_.range);

-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
+    ForEachGestureBit(activeGestures, [&](std::size_t gestureIx) {
         const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
         if (effectiveWeight == 0.0f) {
-            continue;
+            return;
         }

         const float gestureDelta = delta * ((effectiveWeight * effectiveWeight) / activeEffectiveWeightSum);
         ApplySceneDistribution(GestureValue(scene.leftScene, gestureIx), GestureValue(scene.rightScene, gestureIx),
                                blend, gestureDelta, config_.range);
-    }
+    });
 }

 void Parameter::RandomizeVisibleValue(const SceneState& scene, float normalized) {
     ValidateSceneEndpoints(scene);
     const float target = LinearMap(RangeMin(config_.range), RangeMax(config_.range),
                                    std::clamp(normalized, 0.0f, 1.0f));
     Compute(scene);
     SnapCurrentToTarget();
     const float delta = target - TargetValue(0);
     HandleIncDec(scene, delta);
@@ -1057,20 +1296,21 @@ void Parameter::RandomizeVisibleValue(const SceneState& scene, float normalized)

 void Parameter::RevertToDefault(const SceneState& scene) {
     ValidateSceneEndpoints(scene);
     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->ResetModulationDepthToNeutral(scene);
         }
     }
     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    activeRouteCount_ = 0;
     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);

     const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
     if (blend <= 0.0f) {
         ResetSceneToDefault(scene.leftScene, defaultValue);
     } else if (blend >= 1.0f) {
         ResetSceneToDefault(scene.rightScene, defaultValue);
     } else {
@@ -1092,20 +1332,21 @@ void Parameter::RevertToDefault(const SceneState& scene) {
 }

 void Parameter::RevertAllToDefault() {
     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->RevertAllToDefault();
         }
     }
     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    activeRouteCount_ = 0;
     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);

     const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
     for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
         ResetSceneToDefault(sceneIx, defaultValue);
         for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
             GestureValue(sceneIx, gestureIx) = defaultValue;
         }
     }
@@ -1180,21 +1421,21 @@ Parameter* Parameter::ModulationDepthParameter(std::size_t modIx) const {
 ParameterConfig Parameter::ModulationDepthConfig(std::size_t modIx) const {
     if (modIx >= modulationDepths_.size()) {
         throw std::out_of_range("modulation depth index out of range");
     }
     const ModulatorMetadata& modulator = group_.GetModulators().Metadata(modIx);
     return {
         .name = modulator.name.empty()
                     ? Name() + " Mod Depth " + std::to_string(modIx + 1)
                     : Name() + " " + modulator.name,
         .shortName = modulator.shortName.empty() ? ShortName() : modulator.shortName,
-        .defaultValue = 0.5f,
+        .defaultValue = kNeutralModulationDepthCenter,
         .range = RangeKind::Bipolar,
         .baseColor = modulator.sourceColor,
         .visualizer = modulator.visualizer,
         .indicatorColors = config_.indicatorColors,
     };
 }

 float& Parameter::SceneCenter(std::size_t sceneIx) {
     if (sceneIx >= group_.Config().numScenes) {
         throw std::out_of_range("parameter scene index out of range");
@@ -1211,71 +1452,100 @@ float Parameter::SceneCenter(std::size_t sceneIx) const {

 float& Parameter::GestureValue(std::size_t sceneIx, std::size_t gestureIx) {
     return gestureValues_[SceneGestureIndex(sceneIx, gestureIx)];
 }

 float Parameter::GestureValue(std::size_t sceneIx, std::size_t gestureIx) const {
     return gestureValues_[SceneGestureIndex(sceneIx, gestureIx)];
 }

 void Parameter::SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active) {
-    gestureActive_[SceneGestureIndex(sceneIx, gestureIx)] = active ? 1 : 0;
+    ValidateSceneGestureIndices(sceneIx, gestureIx);
+    const GestureMask bit = GestureMask{1} << gestureIx;
+    if (active) {
+        gestureActiveMasks_[sceneIx] |= bit;
+    } else {
+        gestureActiveMasks_[sceneIx] &= ~bit;
+    }
 }

 bool Parameter::GestureActive(std::size_t sceneIx, std::size_t gestureIx) const {
-    return gestureActive_[SceneGestureIndex(sceneIx, gestureIx)] != 0;
+    ValidateSceneGestureIndices(sceneIx, gestureIx);
+    return (gestureActiveMasks_[sceneIx] & (GestureMask{1} << gestureIx)) != 0;
 }

-std::span<float> Parameter::CurrentDepths(std::size_t voiceIx) {
+std::span<float> Parameter::CurrentDepthSlots(std::size_t voiceIx) {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     if (group_.Config().numModulators == 0) {
         return {};
     }
     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
     return std::span<float>(currentDepths_.data() + rowStart, group_.Config().numModulators);
 }

-std::span<const float> Parameter::CurrentDepths(std::size_t voiceIx) const {
+std::span<const float> Parameter::CurrentDepthSlots(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     if (group_.Config().numModulators == 0) {
         return {};
     }
     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
     return std::span<const float>(currentDepths_.data() + rowStart, group_.Config().numModulators);
 }

-std::span<float> Parameter::TargetDepths(std::size_t voiceIx) {
+std::span<float> Parameter::TargetDepthSlots(std::size_t voiceIx) {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     if (group_.Config().numModulators == 0) {
         return {};
     }
     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
     return std::span<float>(targetDepths_.data() + rowStart, group_.Config().numModulators);
 }

-std::span<const float> Parameter::TargetDepths(std::size_t voiceIx) const {
+std::span<const float> Parameter::TargetDepthSlots(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     if (group_.Config().numModulators == 0) {
         return {};
     }
     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
     return std::span<const float>(targetDepths_.data() + rowStart, group_.Config().numModulators);
 }

+float Parameter::CurrentDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const {
+    return currentDepths_[VoiceRouteIndex(voiceIx, RoutePositionForSource(sourceIx))];
+}
+
+float Parameter::TargetDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const {
+    return targetDepths_[VoiceRouteIndex(voiceIx, RoutePositionForSource(sourceIx))];
+}
+
+std::size_t Parameter::RouteSourceIndex(std::size_t slot) const {
+    if (slot >= routeSourceIndices_.size()) {
+        throw std::out_of_range("parameter route slot out of range");
+    }
+    return routeSourceIndices_[slot];
+}
+
+std::size_t Parameter::RoutePositionForSource(std::size_t sourceIx) const {
+    if (sourceIx >= sourceRoutePositions_.size()) {
+        throw std::out_of_range("parameter modulator index out of range");
+    }
+    return sourceRoutePositions_[sourceIx];
+}
+
 float Parameter::CurrentCenterScale(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return currentCenterScales_[voiceIx];
 }

 float Parameter::TargetCenterScale(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
@@ -1290,202 +1560,328 @@ float Parameter::CurrentNormalizationOffset(std::size_t voiceIx) const {
     return currentNormalizationOffsets_[voiceIx];
 }

 float Parameter::TargetNormalizationOffset(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return targetNormalizationOffsets_[voiceIx];
 }

-std::size_t Parameter::VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const {
+std::size_t Parameter::VoiceRouteIndex(std::size_t voiceIx, std::size_t routeSlot) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
-    if (modIx >= group_.Config().numModulators) {
+    if (routeSlot >= group_.Config().numModulators) {
+        throw std::out_of_range("parameter route slot out of range");
+    }
+    return voiceIx * group_.Config().numModulators + routeSlot;
+}
+
+void Parameter::AssertRouteBijection() const {
+#ifndef NDEBUG
+    assert(activeRouteCount_ <= routeSourceIndices_.size());
+    for (std::size_t slot = 0; slot < routeSourceIndices_.size(); ++slot) {
+        assert(routeSourceIndices_[slot] < sourceRoutePositions_.size());
+        assert(sourceRoutePositions_[routeSourceIndices_[slot]] == slot);
+    }
+#endif
+}
+
+void Parameter::EnsureRouteActive(std::size_t sourceIx) {
+    if (sourceIx >= sourceRoutePositions_.size()) {
         throw std::out_of_range("parameter modulator index out of range");
     }
-    return voiceIx * group_.Config().numModulators + modIx;
+    const std::size_t routeSlot = sourceRoutePositions_[sourceIx];
+    if (routeSlot < activeRouteCount_) {
+        return;
+    }
+
+    const std::size_t destination = activeRouteCount_;
+    if (routeSlot != destination) {
+        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+            std::swap(currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
+                      currentDepths_[VoiceRouteIndex(voiceIx, destination)]);
+            std::swap(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
+                      targetDepths_[VoiceRouteIndex(voiceIx, destination)]);
+        }
+        const std::size_t displacedSource = routeSourceIndices_[destination];
+        std::swap(routeSourceIndices_[routeSlot], routeSourceIndices_[destination]);
+        sourceRoutePositions_[sourceIx] = destination;
+        sourceRoutePositions_[displacedSource] = routeSlot;
+    }
+    ++activeRouteCount_;
+    AssertRouteBijection();
+}
+
+void Parameter::RemoveActiveRoute(std::size_t routeSlot) {
+    if (routeSlot >= activeRouteCount_) {
+        throw std::out_of_range("active parameter route slot out of range");
+    }
+    const std::size_t lastActive = activeRouteCount_ - 1;
+    if (routeSlot != lastActive) {
+        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+            std::swap(currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
+                      currentDepths_[VoiceRouteIndex(voiceIx, lastActive)]);
+            std::swap(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
+                      targetDepths_[VoiceRouteIndex(voiceIx, lastActive)]);
+        }
+        const std::size_t removedSource = routeSourceIndices_[routeSlot];
+        const std::size_t movedSource = routeSourceIndices_[lastActive];
+        std::swap(routeSourceIndices_[routeSlot], routeSourceIndices_[lastActive]);
+        sourceRoutePositions_[movedSource] = routeSlot;
+        sourceRoutePositions_[removedSource] = lastActive;
+    }
+    --activeRouteCount_;
+    AssertRouteBijection();
+}
+
+bool Parameter::RouteNeutralAcrossVoices(std::size_t routeSlot) const {
+    for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+        if (std::fabs(currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)]) > kModulationNeutralTolerance ||
+            std::fabs(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)]) > kModulationNeutralTolerance) {
+            return false;
+        }
+    }
+    return true;
+}
+
+void Parameter::PruneNeutralActiveRoutes() {
+    for (std::size_t routeSlot = activeRouteCount_; routeSlot-- > 0;) {
+        if (!RouteNeutralAcrossVoices(routeSlot)) {
+            continue;
+        }
+        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+            currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)] = 0.0f;
+            targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)] = 0.0f;
+        }
+        RemoveActiveRoute(routeSlot);
+    }
 }

 std::size_t Parameter::SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const {
+    ValidateSceneGestureIndices(sceneIx, gestureIx);
+    return sceneIx * group_.GestureCount() + gestureIx;
+}
+
+void Parameter::ValidateSceneGestureIndices(std::size_t sceneIx, std::size_t gestureIx) const {
     if (sceneIx >= group_.Config().numScenes) {
         throw std::out_of_range("parameter scene index out of range");
     }
     if (gestureIx >= group_.GestureCount()) {
         throw std::out_of_range("parameter gesture index out of range");
     }
-    return sceneIx * group_.GestureCount() + gestureIx;
 }

 void Parameter::ValidateSceneEndpoints(const SceneState& scene) const {
     if (scene.leftScene >= group_.Config().numScenes || scene.rightScene >= group_.Config().numScenes) {
         throw std::out_of_range("parameter scene index out of range");
     }
 }

 float Parameter::EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const {
     const float clampedBlend = std::clamp(blend, 0.0f, 1.0f);
     const float groupWeight = group_.Manager().GestureValue(gestureIx);
     const float leftWeight = GestureActive(scene.leftScene, gestureIx) ? groupWeight * (1.0f - clampedBlend) : 0.0f;
     const float rightWeight = GestureActive(scene.rightScene, gestureIx) ? groupWeight * clampedBlend : 0.0f;
     return leftWeight + rightWeight;
 }

 void Parameter::ResetSceneToDefault(std::size_t sceneIx, float defaultValue) {
     SceneCenter(sceneIx) = defaultValue;
-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
-        SetGestureActive(sceneIx, gestureIx, false);
-    }
+    gestureActiveMasks_[sceneIx] = 0;
 }

 void Parameter::ResetModulationDepthToNeutral(const SceneState& scene) {
     ValidateSceneEndpoints(scene);
     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->ResetModulationDepthToNeutral(scene);
         }
     }

-    constexpr float neutralDepth = 0.5f;
     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
     if (blend <= 0.0f) {
-        ResetSceneToDefault(scene.leftScene, neutralDepth);
+        ResetSceneToDefault(scene.leftScene, kNeutralModulationDepthCenter);
     } else if (blend >= 1.0f) {
-        ResetSceneToDefault(scene.rightScene, neutralDepth);
+        ResetSceneToDefault(scene.rightScene, kNeutralModulationDepthCenter);
     } else {
-        ResetSceneToDefault(scene.leftScene, neutralDepth);
+        ResetSceneToDefault(scene.leftScene, kNeutralModulationDepthCenter);
         if (scene.rightScene != scene.leftScene) {
-            ResetSceneToDefault(scene.rightScene, neutralDepth);
+            ResetSceneToDefault(scene.rightScene, kNeutralModulationDepthCenter);
         }
     }

-    currentCenter_ = neutralDepth;
-    targetCenter_ = neutralDepth;
+    currentCenter_ = kNeutralModulationDepthCenter;
+    targetCenter_ = kNeutralModulationDepthCenter;
     std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
     std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
-    std::fill(currentMinValues_.begin(), currentMinValues_.end(), neutralDepth);
-    std::fill(targetMinValues_.begin(), targetMinValues_.end(), neutralDepth);
-    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), neutralDepth);
-    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), neutralDepth);
+    std::fill(currentMinValues_.begin(), currentMinValues_.end(), kNeutralModulationDepthCenter);
+    std::fill(targetMinValues_.begin(), targetMinValues_.end(), kNeutralModulationDepthCenter);
+    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), kNeutralModulationDepthCenter);
+    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), kNeutralModulationDepthCenter);
     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    activeRouteCount_ = 0;
     SeedCachedKnobAndUiDisplayState();
 }

 float Parameter::ComputeRawCenter(const SceneState& scene) const {
     ValidateSceneEndpoints(scene);
     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
     const float inverseBlend = 1.0f - blend;
     const float base = SceneCenter(scene.leftScene) * inverseBlend + SceneCenter(scene.rightScene) * blend;

     float weightedMixSum = 0.0f;
     float activeWeightSum = 0.0f;
-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
+    const GestureMask activeGestures =
+        (gestureActiveMasks_[scene.leftScene] | gestureActiveMasks_[scene.rightScene]) &
+        GestureCountMask(group_.GestureCount());
+    ForEachGestureBit(activeGestures, [&](std::size_t gestureIx) {
+        if (group_.processingObserver_ != nullptr) {
+            ++group_.processingObserver_->activeGestureVisits;
+        }
         const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
         if (effectiveWeight == 0.0f) {
-            continue;
+            return;
         }

         const float gestureValue = GestureValue(scene.leftScene, gestureIx) * inverseBlend +
                                    GestureValue(scene.rightScene, gestureIx) * blend;
         const float mix = base * (1.0f - effectiveWeight) + gestureValue * effectiveWeight;
         weightedMixSum += effectiveWeight * mix;
         activeWeightSum += effectiveWeight;
-    }
+    });

     if (activeWeightSum == 0.0f) {
         return base;
     }
     return weightedMixSum / activeWeightSum;
 }

 void Parameter::ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth, bool smoothTargetCenter) {
     recursionDepth_ = recursionDepth;
+    if (recursionDepth > 0 && group_.processingObserver_ != nullptr) {
+        ++group_.processingObserver_->localRecursiveComputeCalls;
+    }
     const float rawCenter = ClampToRange(ComputeRawCenter(scene), config_.range);
     if (smoothTargetCenter && recursionDepth == 0) {
         const float alpha = group_.Config().targetCenterAlpha;
         targetCenter_ += alpha * (rawCenter - targetCenter_);
         targetCenter_ = ClampToRange(targetCenter_, config_.range);
     } else {
         targetCenter_ = rawCenter;
     }

     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->ComputeAtDepth(scene, recursionDepth_ + 1, smoothTargetCenter);
         }
     }

+    for (std::size_t sourceIx = 0; sourceIx < group_.Config().numModulators; ++sourceIx) {
+        const Parameter* depthParameter = modulationDepths_[sourceIx];
+        bool targetNonNeutral = false;
+        if (depthParameter != nullptr) {
+            for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+                if (std::fabs(ModulationDepthTargetFromKnob(depthParameter->GetRaw(voiceIx))) >
+                    kModulationNeutralTolerance) {
+                    targetNonNeutral = true;
+                    break;
+                }
+            }
+        }
+
+        const std::size_t oldRouteSlot = sourceRoutePositions_[sourceIx];
+        bool currentNonNeutral = false;
+        if (oldRouteSlot < activeRouteCount_) {
+            for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+                if (std::fabs(currentDepths_[VoiceRouteIndex(voiceIx, oldRouteSlot)]) >
+                    kModulationNeutralTolerance) {
+                    currentNonNeutral = true;
+                    break;
+                }
+            }
+        }
+        if (targetNonNeutral || currentNonNeutral) {
+            EnsureRouteActive(sourceIx);
+        }
+
+        const std::size_t routeSlot = sourceRoutePositions_[sourceIx];
+        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+            targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)] =
+                depthParameter == nullptr ? 0.0f
+                                          : ModulationDepthTargetFromKnob(depthParameter->GetRaw(voiceIx));
+        }
+    }
+
     for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
         float weightSum = 0.0f;
-        for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
-            const Parameter* depthParameter = modulationDepths_[modIx];
-            const float depth =
-                depthParameter == nullptr ? 0.0f : ModulationDepthTargetFromKnob(depthParameter->GetRaw(voiceIx));
-            targetDepths_[VoiceModIndex(voiceIx, modIx)] = depth;
-            weightSum += std::fabs(depth);
+        for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+            weightSum += std::fabs(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)]);
         }

         if (weightSum < 1.0f) {
             targetCenterScales_[voiceIx] = 1.0f - weightSum;
         } else {
             targetCenterScales_[voiceIx] = 0.0f;
-            for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
-                targetDepths_[VoiceModIndex(voiceIx, modIx)] /= weightSum;
+            for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+                targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)] /= weightSum;
             }
         }

         float normalizationOffset = 0.0f;
-        for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
-            normalizationOffset -= std::min(0.0f, targetDepths_[VoiceModIndex(voiceIx, modIx)]);
+        for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+            normalizationOffset -= std::min(0.0f, targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)]);
         }
         targetNormalizationOffsets_[voiceIx] = normalizationOffset;

         if (weightSum > 1.0f) {
             targetMinValues_[voiceIx] = RangeMin(config_.range);
             targetMaxValues_[voiceIx] = RangeMax(config_.range);
         } else {
             float minContribution = 0.0f;
             float maxContribution = 0.0f;
-            for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
-                const float depth = targetDepths_[VoiceModIndex(voiceIx, modIx)];
+            for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+                const float depth = targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)];
                 minContribution += std::min(0.0f, depth);
                 maxContribution += std::max(0.0f, depth);
             }
             const float base = targetCenter_ * targetCenterScales_[voiceIx] + targetNormalizationOffsets_[voiceIx];
             targetMinValues_[voiceIx] = ClampToRange(base + minContribution, config_.range);
             targetMaxValues_[voiceIx] = ClampToRange(base + maxContribution, config_.range);
         }
     }

     if (recursionDepth_ > 0) {
         currentCenter_ = targetCenter_;
         std::copy(targetCenterScales_.begin(), targetCenterScales_.end(), currentCenterScales_.begin());
         std::copy(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(),
                   currentNormalizationOffsets_.begin());
         std::copy(targetMinValues_.begin(), targetMinValues_.end(), currentMinValues_.begin());
         std::copy(targetMaxValues_.begin(), targetMaxValues_.end(), currentMaxValues_.begin());
         std::copy(targetDepths_.begin(), targetDepths_.end(), currentDepths_.begin());
         SeedCachedKnobAndUiDisplayState();
     }
+    PruneNeutralActiveRoutes();
 }

 void Parameter::SnapCurrentToTarget() {
     currentCenter_ = targetCenter_;
     std::copy(targetCenterScales_.begin(), targetCenterScales_.end(), currentCenterScales_.begin());
     std::copy(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), currentNormalizationOffsets_.begin());
     std::copy(targetMinValues_.begin(), targetMinValues_.end(), currentMinValues_.begin());
     std::copy(targetMaxValues_.begin(), targetMaxValues_.end(), currentMaxValues_.begin());
     std::copy(targetDepths_.begin(), targetDepths_.end(), currentDepths_.begin());
+    PruneNeutralActiveRoutes();
     SeedCachedKnobAndUiDisplayState();
     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->SnapCurrentToTarget();
         }
     }
 }

 void Parameter::SeedCachedKnobAndUiDisplayState() {
     for (std::size_t voiceIx = 0; voiceIx < currentKnobValues_.size(); ++voiceIx) {
@@ -1506,164 +1902,154 @@ bool Parameter::WouldCreateCycle(const Parameter* candidate) const {
         }
     }
     return false;
 }

 float Parameter::TargetValue(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return ClampToRange(targetCenter_ * targetCenterScales_[voiceIx] + targetNormalizationOffsets_[voiceIx] +
-                            group_.GetModulators().Apply(voiceIx, TargetDepths(voiceIx)),
+                            group_.GetModulators().ApplyActive(
+                                voiceIx, TargetDepthSlots(voiceIx).first(activeRouteCount_),
+                                ActiveRouteSourceIndices()),
                         config_.range);
 }

 std::uint32_t Parameter::ModulatorsAffectingMask() const {
     std::uint32_t mask = 0;
     const std::size_t count = std::min<std::size_t>(modulationDepths_.size(), 32);
     for (std::size_t modIx = 0; modIx < count; ++modIx) {
         if (modulationDepths_[modIx] != nullptr && modulationDepths_[modIx]->HasNonZeroState()) {
             mask |= (std::uint32_t{1} << modIx);
         }
     }
     return mask;
 }

 bool Parameter::HasNonZeroState() const {
-    constexpr float tolerance = 0.000001f;
-    constexpr float neutralDepthCenter = 0.5f;
-
-    if (std::fabs(currentCenter_ - neutralDepthCenter) > tolerance ||
-        std::fabs(targetCenter_ - neutralDepthCenter) > tolerance) {
+    if (std::fabs(currentCenter_ - kNeutralModulationDepthCenter) > kModulationNeutralTolerance ||
+        std::fabs(targetCenter_ - kNeutralModulationDepthCenter) > kModulationNeutralTolerance) {
         return true;
     }
     for (const float center : sceneCenters_) {
-        if (std::fabs(center - neutralDepthCenter) > tolerance) {
+        if (std::fabs(center - kNeutralModulationDepthCenter) > kModulationNeutralTolerance) {
             return true;
         }
     }
-    for (const std::uint8_t active : gestureActive_) {
-        if (active != 0) {
+    for (const GestureMask activeMask : gestureActiveMasks_) {
+        if (activeMask != 0) {
             return true;
         }
     }
     for (const float depth : currentDepths_) {
-        if (std::fabs(depth) > tolerance) {
+        if (std::fabs(depth) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const float depth : targetDepths_) {
-        if (std::fabs(depth) > tolerance) {
+        if (std::fabs(depth) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const float offset : currentNormalizationOffsets_) {
-        if (std::fabs(offset) > tolerance) {
+        if (std::fabs(offset) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const float offset : targetNormalizationOffsets_) {
-        if (std::fabs(offset) > tolerance) {
+        if (std::fabs(offset) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr && depthParameter->HasNonZeroState()) {
             return true;
         }
     }
     return false;
 }

 bool Parameter::HasNonDefaultState() const {
-    constexpr float tolerance = 0.000001f;
     const float defaultValue = ClampToRange(config_.defaultValue, config_.range);

-    if (std::fabs(currentCenter_ - defaultValue) > tolerance ||
-        std::fabs(targetCenter_ - defaultValue) > tolerance) {
+    if (std::fabs(currentCenter_ - defaultValue) > kModulationNeutralTolerance ||
+        std::fabs(targetCenter_ - defaultValue) > kModulationNeutralTolerance) {
         return true;
     }
     for (const float center : sceneCenters_) {
-        if (std::fabs(center - defaultValue) > tolerance) {
+        if (std::fabs(center - defaultValue) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const float value : gestureValues_) {
-        if (std::fabs(value - defaultValue) > tolerance) {
+        if (std::fabs(value - defaultValue) > kModulationNeutralTolerance) {
             return true;
         }
     }
-    for (const std::uint8_t active : gestureActive_) {
-        if (active != 0) {
+    for (const GestureMask activeMask : gestureActiveMasks_) {
+        if (activeMask != 0) {
             return true;
         }
     }
     for (const float depth : currentDepths_) {
-        if (std::fabs(depth) > tolerance) {
+        if (std::fabs(depth) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const float depth : targetDepths_) {
-        if (std::fabs(depth) > tolerance) {
+        if (std::fabs(depth) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const float scale : currentCenterScales_) {
-        if (std::fabs(scale - 1.0f) > tolerance) {
+        if (std::fabs(scale - 1.0f) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const float scale : targetCenterScales_) {
-        if (std::fabs(scale - 1.0f) > tolerance) {
+        if (std::fabs(scale - 1.0f) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const float offset : currentNormalizationOffsets_) {
-        if (std::fabs(offset) > tolerance) {
+        if (std::fabs(offset) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const float offset : targetNormalizationOffsets_) {
-        if (std::fabs(offset) > tolerance) {
+        if (std::fabs(offset) > kModulationNeutralTolerance) {
             return true;
         }
     }
     for (const Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr && depthParameter->HasNonDefaultState()) {
             return true;
         }
     }
     return false;
 }

-std::uint32_t Parameter::GesturesAffectingMask() const {
-    std::uint32_t mask = 0;
+GestureMask Parameter::GesturesAffectingMask() const {
     const SceneState& scene = group_.Manager().Scene();
     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
-    const std::size_t count = std::min<std::size_t>(group_.GestureCount(), 32);
     const bool leftSceneValid = scene.leftScene < group_.Config().numScenes;
     const bool rightSceneValid = scene.rightScene < group_.Config().numScenes;
-    for (std::size_t gestureIx = 0; gestureIx < count; ++gestureIx) {
-        bool active = false;
-        if (blend <= 0.0f) {
-            active = leftSceneValid && GestureActive(scene.leftScene, gestureIx);
-        } else if (blend >= 1.0f) {
-            active = rightSceneValid && GestureActive(scene.rightScene, gestureIx);
-        } else {
-            active = (leftSceneValid && GestureActive(scene.leftScene, gestureIx)) ||
-                     (rightSceneValid && GestureActive(scene.rightScene, gestureIx));
-        }
-        if (active) {
-            mask |= (std::uint32_t{1} << gestureIx);
-        }
+    if (blend <= 0.0f) {
+        return leftSceneValid ? gestureActiveMasks_[scene.leftScene] & GestureCountMask(group_.GestureCount()) : 0;
     }
-    return mask;
+    if (blend >= 1.0f) {
+        return rightSceneValid ? gestureActiveMasks_[scene.rightScene] & GestureCountMask(group_.GestureCount()) : 0;
+    }
+    const GestureMask leftMask = leftSceneValid ? gestureActiveMasks_[scene.leftScene] : 0;
+    const GestureMask rightMask = rightSceneValid ? gestureActiveMasks_[scene.rightScene] : 0;
+    return (leftMask | rightMask) & GestureCountMask(group_.GestureCount());
 }

 void ParameterGroup::SelectGesture(std::size_t gestureIx) {
     manager_->SelectGesture(gestureIx);
 }

 void ParameterGroup::DeselectGesture(std::size_t gestureIx) {
     manager_->DeselectGesture(gestureIx);
 }

@@ -1803,20 +2189,23 @@ void Bank::HandlePress(PhysicalEncoderId encoderId) {

 void Bank::HandlePress(PhysicalEncoderId encoderId, std::span<const PhysicalEncoderId> physicalLayout) {
     Cell* cell = FindVisibleCell(encoderId);
     if (cell == nullptr) {
         return;
     }
     const Modifier modifier = manager_ == nullptr ? Modifier::None : manager_->GetCurrentModifier();
     if (modifier != Modifier::None) {
         if (cell->parameter != nullptr) {
             ApplyModifierToParameter(*cell->parameter, modifier, manager_->Scene());
+            if (modifier == Modifier::Reset) {
+                cell->parameter->Group().CollectNeutralLocalParameters();
+            }
         }
         return;
     }
     if (ShowingModulation() && cell->parameter == selected_) {
         Deselect();
         return;
     }
     if (cell->parameter != nullptr) {
         OpenModulationView(*cell->parameter, physicalLayout);
     }
@@ -1826,35 +2215,57 @@ void Bank::HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, floa
     Cell* cell = FindVisibleCell(encoderId);
     if (cell == nullptr || cell->parameter == nullptr) {
         return;
     }
     cell->parameter->HandleIncDec(scene, delta);
 }

 void Bank::ApplyModifierToTopLevel(Modifier modifier, const SceneState& scene) {
     std::vector<Parameter*> visited;
     visited.reserve(topLevel_.size());
+    std::vector<ParameterGroup*> affectedGroups;
+    affectedGroups.reserve(topLevel_.size());
     for (Cell& cell : topLevel_) {
         if (cell.parameter == nullptr) {
             continue;
         }
         if (std::find(visited.begin(), visited.end(), cell.parameter) != visited.end()) {
             continue;
         }
         visited.push_back(cell.parameter);
         ApplyModifierToParameter(*cell.parameter, modifier, scene);
+        if (modifier == Modifier::Reset &&
+            std::find(affectedGroups.begin(), affectedGroups.end(), &cell.parameter->Group()) ==
+                affectedGroups.end()) {
+            affectedGroups.push_back(&cell.parameter->Group());
+        }
+    }
+    for (ParameterGroup* group : affectedGroups) {
+        group->CollectNeutralLocalParameters();
     }
 }

 void Bank::Deselect() {
-    selected_ = nullptr;
+    ParameterGroup* affectedGroup = selected_ == nullptr ? nullptr : &selected_->Group();
+    if (selected_ != nullptr) {
+        for (const Cell& cell : visible_) {
+            if (cell.parameter != nullptr && cell.parameter != selected_) {
+                cell.parameter->UnpinLocalForView();
+            }
+        }
+        selected_->UnpinLocalForView();
+    }
     visible_ = topLevel_;
+    selected_ = nullptr;
+    if (affectedGroup != nullptr) {
+        affectedGroup->CollectNeutralLocalParameters();
+    }
 }

 bool Bank::ShowingModulation() const {
     return selected_ != nullptr;
 }

 std::size_t Bank::VisibleMappingCount() const {
     return visible_.size();
 }

@@ -1870,22 +2281,22 @@ Bank::VisibleCell Bank::VisibleCellFor(PhysicalEncoderId encoderId) const {
     }
     return {
         .parameter = cell->parameter,
     };
 }

 Parameter* Bank::TargetParameter() const {
     return ShowingModulation() ? selected_ : nullptr;
 }

-std::uint32_t Bank::GesturesAffectingMask() const {
-    std::uint32_t mask = 0;
+GestureMask Bank::GesturesAffectingMask() const {
+    GestureMask mask = 0;
     for (const Cell& cell : topLevel_) {
         if (cell.parameter != nullptr) {
             mask |= cell.parameter->GesturesAffectingMask();
         }
     }
     return mask;
 }

 void BankSlot::UIState::Configure(std::size_t newCellCapacity, std::size_t voiceCapacity,
                                   std::size_t modulatorColorCapacity, std::size_t gestureColorCapacity) {
@@ -1959,27 +2370,41 @@ void Bank::OpenModulationView(Parameter& parameter, std::span<const PhysicalEnco
         throw std::logic_error("modulation view has more modulators than slot depth positions");
     }

     const std::size_t missing = MissingModulationDepthCount(parameter);
     const std::size_t available = parameter.Group().AvailableParameterSlots();
     if (available < missing) {
         parameter.Group().RequestParameterStorageBatch(missing - available);
         return;
     }

+    if (selected_ != nullptr) {
+        for (const Cell& cell : visible_) {
+            if (cell.parameter != nullptr && cell.parameter != selected_) {
+                cell.parameter->UnpinLocalForView();
+            }
+        }
+        selected_->UnpinLocalForView();
+    }
+
     selected_ = &parameter;
+    selected_->PinLocalForView();
     visible_.clear();

     for (std::size_t cellIx = 0; cellIx < modulatorCount; ++cellIx) {
+        Parameter* depthParameter = EnsureModulationDepthParameter(parameter, cellIx);
+        if (depthParameter != nullptr) {
+            depthParameter->PinLocalForView();
+        }
         visible_.push_back({
             .encoderId = physicalLayout[cellIx],
-            .parameter = EnsureModulationDepthParameter(parameter, cellIx),
+            .parameter = depthParameter,
         });
     }

     visible_.push_back({
         .encoderId = physicalLayout.back(),
         .parameter = &parameter,
     });
     parameter.Group().RequestParameterStorageBatchIfLow();
 }

@@ -2128,21 +2553,21 @@ bool ParameterMessageOutBus::Pop(ParameterMessageOut& message) {
         return false;
     }
     const std::size_t head = head_.load(std::memory_order_relaxed);
     message = queue_[head];
     head_.store((head + 1) % queue_.size(), std::memory_order_release);
     size_.fetch_sub(1, std::memory_order_release);
     return true;
 }

 bool ParameterManager::SetGestureCount(std::size_t count) {
-    if (!groups_.empty()) {
+    if (count > std::numeric_limits<GestureMask>::digits || !groups_.empty()) {
         return false;
     }
     gestures_ = Gestures(count);
     return true;
 }

 ParameterGroup& ParameterManager::CreateGroup(ParameterGroupConfig config) {
     auto group = std::make_unique<ParameterGroup>(std::move(config), *this, gestures_.NumGestures());
     ParameterGroup& result = *group;
     groups_.push_back(std::move(group));
@@ -2166,20 +2591,21 @@ ParameterId ParameterManager::RegisterParameter(ParameterGroup& group, Parameter
     if (parameters_.size() >= static_cast<std::size_t>(kLocalParameterId)) {
         throw std::overflow_error("parameter ID space exhausted");
     }

     const ParameterId id = static_cast<ParameterId>(parameters_.size());
     const std::string name = config.name;
     Parameter& created = group.CreateLocalParameter(std::move(config), id);
     Parameter* result = &created;
     parameters_.push_back(result);
     parameterNames_.push_back(name);
+    group.RegisterTopLevelParameter(created);
     return id;
 }

 Parameter& ParameterManager::CreateParameter(ParameterGroup& group, ParameterConfig config) {
     return ParameterById(RegisterParameter(group, std::move(config)));
 }

 Parameter& ParameterManager::ParameterById(ParameterId id) {
     return *parameters_.at(static_cast<std::size_t>(id));
 }
@@ -2237,20 +2663,28 @@ bool ParameterManager::LoadParameterValuesFromJSON(JSON json) {
         if (parameter == nullptr) {
             continue;
         }
         parameter->LoadValuesFromJSON(JSON(members[ix].m_value));
     }

     ComputeAllParameters();
     return true;
 }

+std::size_t ParameterManager::CollectNeutralLocalParameters() {
+    std::size_t collected = 0;
+    for (const auto& group : groups_) {
+        collected += group->CollectNeutralLocalParameters();
+    }
+    return collected;
+}
+
 void ParameterManager::ComputeAllParameters() {
     for (Parameter* parameter : parameters_) {
         if (parameter == nullptr) {
             continue;
         }
         parameter->ComputeAtDepth(scene_, 0, false);
         parameter->SnapCurrentToTarget();
     }
 }

@@ -2308,20 +2742,21 @@ void ParameterManager::RevertAllToDefaults() {
         const bool selected = gestureIx < defaultControlState_.gestureSelected.size() &&
                               defaultControlState_.gestureSelected[gestureIx];
         if (selected) {
             SelectGesture(gestureIx);
         } else {
             DeselectGesture(gestureIx);
         }
     }

     ComputeAllParameters();
+    CollectNeutralLocalParameters();
 }

 float ParameterManager::GetLinear(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const {
     const float normalized = std::clamp(ParameterById(id).CachedKnobValue(voiceIx), 0.0f, 1.0f);
     return LinearMap(minValue, maxValue, normalized);
 }

 float ParameterManager::GetExponential(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const {
     const float normalized = std::clamp(ParameterById(id).CachedKnobValue(voiceIx), 0.0f, 1.0f);
     return ExponentialMap(minValue, maxValue, normalized);
@@ -2770,25 +3205,25 @@ void ParameterManager::PopulateUIState(UIState& state) const {
             state.gestures.selected[gestureIx].store(false, std::memory_order_relaxed);
             state.gestures.colors[gestureIx].Store(Color::Off);
             continue;
         }
         state.gestures.values[gestureIx].store(gestures_.Value(gestureIx), std::memory_order_relaxed);
         state.gestures.selected[gestureIx].store(gestures_.Selected(gestureIx), std::memory_order_relaxed);
         state.gestures.colors[gestureIx].Store(gestures_.Metadata(gestureIx).gestureColor);
     }
     const std::size_t compactBankCount = std::min<std::size_t>({state.bankCapacity, banks_.size(), 32});
     for (std::size_t bankIx = 0; bankIx < compactBankCount; ++bankIx) {
-        const std::uint32_t affecting = banks_[bankIx]->GesturesAffectingMask();
+        const GestureMask affecting = banks_[bankIx]->GesturesAffectingMask();
         for (std::size_t gestureIx = 0;
-             gestureIx < std::min<std::size_t>(state.gestures.gestureCapacity, 32);
+             gestureIx < std::min<std::size_t>(state.gestures.gestureCapacity, 64);
              ++gestureIx) {
-            if ((affecting & (std::uint32_t{1} << gestureIx)) == 0) {
+            if ((affecting & (GestureMask{1} << gestureIx)) == 0) {
                 continue;
             }
             std::uint32_t mask = state.gestures.bankAffectingMask[gestureIx].load(std::memory_order_relaxed);
             mask |= (std::uint32_t{1} << bankIx);
             state.gestures.bankAffectingMask[gestureIx].store(mask, std::memory_order_relaxed);
             state.gestures.bankAffectingCount[gestureIx].fetch_add(1, std::memory_order_relaxed);
         }
     }
 }

diff --git a/projects/synth/src/PatchPersistence.cpp b/projects/synth/src/PatchPersistence.cpp
index e0f76629..ea3d7bbf 100644
--- a/projects/synth/src/PatchPersistence.cpp
+++ b/projects/synth/src/PatchPersistence.cpp
@@ -283,21 +283,24 @@ bool LoadPatchJSON(JSON root, ParameterManager& manager,
     (void)audioDevice;
     if (!ValidPatchRoot(root) || !IsString(root.Get("patchName"))) {
         return false;
     }

     const JSON parameterValues = root.Get("parameterValues");
     if (!IsObject(parameterValues)) {
         return false;
     }

-    manager.LoadParameterValuesFromJSON(parameterValues);
+    if (!manager.LoadParameterValuesFromJSON(parameterValues)) {
+        return false;
+    }
+    manager.CollectNeutralLocalParameters();
     return true;
 }

 bool ValidatePatchJSON(JSON root) {
     return ValidPatchRoot(root) && IsString(root.Get("patchName")) && IsObject(root.Get("parameterValues"));
 }

 std::string TimestampPatchFilename(std::chrono::system_clock::time_point now) {
     const std::time_t time = std::chrono::system_clock::to_time_t(now);
     std::tm tm{};
diff --git a/projects/synth/tests/braid4_deadline_tests.cpp b/projects/synth/tests/braid4_deadline_tests.cpp
index 3e4de797..b8a29e6b 100644
--- a/projects/synth/tests/braid4_deadline_tests.cpp
+++ b/projects/synth/tests/braid4_deadline_tests.cpp
@@ -55,21 +55,44 @@ struct Register {
 void RequireNear(double actual, double expected, double tolerance, const char* expr) {
     if (std::fabs(actual - expected) > tolerance) {
         std::ostringstream oss;
         oss << expr << " expected " << expected << " got " << actual;
         throw std::runtime_error(oss.str());
     }
 }

 #define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

+enum class DeadlineScenario {
+    Baseline,
+    SparseActive,
+};
+
+const char* DeadlineScenarioName(DeadlineScenario scenario) {
+    return scenario == DeadlineScenario::Baseline ? "baseline" : "sparse-active";
+}
+
+void ConfigureDeadlineScenario(synth::Engine<synth_braid4::Braid4Core>& engine,
+                               DeadlineScenario scenario) {
+    if (scenario != DeadlineScenario::SparseActive) {
+        return;
+    }
+    synth::Parameter& parameter = engine.Manager().ParameterById(0);
+    synth::Parameter* depth = parameter.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 0.75f;
+    depth->SceneCenter(1) = 0.75f;
+    engine.Manager().ComputeAllParameters();
+}
+
 struct DeadlineStats {
+    DeadlineScenario scenario = DeadlineScenario::Baseline;
     double sampleRate = 0.0;
     double averageSeconds = 0.0;
     double p99Seconds = 0.0;
     double blockSeconds = 0.0;
     synth_braid4::Braid4Core::DebugCounterState counters;
     std::vector<float> contiguousLeft;
     std::vector<float> contiguousRight;
     std::vector<float> splitLeft;
     std::vector<float> splitRight;
 };
@@ -82,25 +105,28 @@ void AssertFiniteStereo(const std::array<std::vector<float>, 2>& channels) {
     bool heardSignal = false;
     for (const auto& channel : channels) {
         for (const float sample : channel) {
             REQUIRE_TRUE(std::isfinite(sample));
             heardSignal = heardSignal || std::fabs(sample) > 0.000001f;
         }
     }
     REQUIRE_TRUE(heardSignal);
 }

-std::array<std::vector<float>, 2> RunSegments(double sampleRate, const std::vector<std::size_t>& segmentFrames) {
+std::array<std::vector<float>, 2> RunSegments(double sampleRate,
+                                              const std::vector<std::size_t>& segmentFrames,
+                                              DeadlineScenario scenario) {
     std::uint64_t timestamp = 0;
     synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
     engine.Initialize();
     engine.Prepare(sampleRate, 256);
+    ConfigureDeadlineScenario(engine, scenario);

     std::array<std::vector<float>, 2> captured;
     for (const std::size_t frames : segmentFrames) {
         std::array<std::vector<float>, 2> blockStorage{{
             std::vector<float>(frames, 12345.0f),
             std::vector<float>(frames, 12345.0f),
         }};
         std::vector<float*> outputs = PointersFor(blockStorage);
         synth::AudioBlock block{
             .outputs = outputs.data(),
@@ -108,29 +134,30 @@ std::array<std::vector<float>, 2> RunSegments(double sampleRate, const std::vect
             .numFrames = frames,
         };
         engine.ProcessBlock(block, timestamp++);

         captured[0].insert(captured[0].end(), blockStorage[0].begin(), blockStorage[0].end());
         captured[1].insert(captured[1].end(), blockStorage[1].begin(), blockStorage[1].end());
     }
     return captured;
 }

-DeadlineStats MeasureDeadline(double sampleRate) {
+DeadlineStats MeasureDeadline(double sampleRate, DeadlineScenario scenario) {
     constexpr std::size_t kBlockFrames = 256;
     constexpr std::size_t kWarmupBlocks = 64;
     constexpr std::size_t kMeasuredBlocks = 512;

     std::uint64_t timestamp = 0;
     synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
     engine.Initialize();
     engine.Prepare(sampleRate, static_cast<int>(kBlockFrames));
+    ConfigureDeadlineScenario(engine, scenario);

     std::array<std::vector<float>, 2> blockStorage{{
         std::vector<float>(kBlockFrames, 0.0f),
         std::vector<float>(kBlockFrames, 0.0f),
     }};
     std::vector<float*> outputs = PointersFor(blockStorage);
     synth::AudioBlock block{
         .outputs = outputs.data(),
         .numOutputChannels = 2,
         .numFrames = kBlockFrames,
@@ -147,41 +174,43 @@ DeadlineStats MeasureDeadline(double sampleRate) {
         engine.ProcessBlock(block, timestamp++);
         const auto end = std::chrono::steady_clock::now();
         durations.push_back(std::chrono::duration<double>(end - start).count());
     }

     std::vector<double> sorted = durations;
     std::sort(sorted.begin(), sorted.end());
     const std::size_t p99Index = static_cast<std::size_t>(
         std::ceil(static_cast<double>(sorted.size()) * 0.99)) - 1;

-    const auto contiguous = RunSegments(sampleRate, {kBlockFrames * 2});
-    const auto split = RunSegments(sampleRate, {kBlockFrames, kBlockFrames});
+    const auto contiguous = RunSegments(sampleRate, {kBlockFrames * 2}, scenario);
+    const auto split = RunSegments(sampleRate, {kBlockFrames, kBlockFrames}, scenario);
     AssertFiniteStereo(contiguous);
     AssertFiniteStereo(split);

     return {
+        .scenario = scenario,
         .sampleRate = sampleRate,
         .averageSeconds = std::accumulate(durations.begin(), durations.end(), 0.0) /
                           static_cast<double>(durations.size()),
         .p99Seconds = sorted.at(std::min(p99Index, sorted.size() - 1)),
         .blockSeconds = static_cast<double>(kBlockFrames) / sampleRate,
         .counters = engine.Application().DebugCounters(),
         .contiguousLeft = contiguous[0],
         .contiguousRight = contiguous[1],
         .splitLeft = split[0],
         .splitRight = split[1],
     };
 }

-void AssertDeadlineAndContinuity(double sampleRate) {
-    const DeadlineStats stats = MeasureDeadline(sampleRate);
+void AssertDeadlineAndContinuity(double sampleRate,
+                                 DeadlineScenario scenario = DeadlineScenario::Baseline) {
+    const DeadlineStats stats = MeasureDeadline(sampleRate, scenario);

     constexpr std::size_t kBlockFrames = 256;
     constexpr std::size_t kMeasuredBlocks = 512;
     constexpr std::size_t kWarmupBlocks = 64;
     const std::size_t expectedProcessedHostFrames = (kWarmupBlocks + kMeasuredBlocks) * kBlockFrames;

     REQUIRE_TRUE(stats.counters.hostFramesProcessed == expectedProcessedHostFrames);
     REQUIRE_TRUE(stats.counters.internalSubframesProcessed == expectedProcessedHostFrames * 4);
     REQUIRE_TRUE(stats.counters.lastInternalSampleIndex == expectedProcessedHostFrames * 4 - 1);
     REQUIRE_TRUE(stats.contiguousLeft.size() == kBlockFrames * 2);
@@ -189,40 +218,49 @@ void AssertDeadlineAndContinuity(double sampleRate) {
     REQUIRE_TRUE(stats.splitRight.size() == stats.contiguousRight.size());

     for (std::size_t frame = 0; frame < stats.contiguousLeft.size(); ++frame) {
         REQUIRE_NEAR(stats.splitLeft[frame], stats.contiguousLeft[frame], 0.000001);
         REQUIRE_NEAR(stats.splitRight[frame], stats.contiguousRight[frame], 0.000001);
     }

     REQUIRE_TRUE(stats.averageSeconds <= stats.blockSeconds * 0.60);
     REQUIRE_TRUE(stats.p99Seconds <= stats.blockSeconds * 0.80);

-    std::cout << "[deadline] " << stats.sampleRate << "Hz avg="
+    std::cout << "[deadline] " << DeadlineScenarioName(stats.scenario) << " "
+              << stats.sampleRate << "Hz/" << (stats.sampleRate * 4.0) << "Hz-internal avg="
               << (stats.averageSeconds * 1000.0) << "ms p99="
               << (stats.p99Seconds * 1000.0) << "ms block="
               << (stats.blockSeconds * 1000.0) << "ms\n";
 }

 } // namespace

 TEST_CASE(braid4_meets_44100hz_256_frame_deadline_and_continuity) {
     AssertDeadlineAndContinuity(44100.0);
 }

 TEST_CASE(braid4_meets_48000hz_256_frame_deadline_and_continuity) {
     AssertDeadlineAndContinuity(48000.0);
 }

 TEST_CASE(braid4_meets_96000hz_256_frame_deadline_and_continuity) {
     AssertDeadlineAndContinuity(96000.0);
 }

+TEST_CASE(braid4_sparse_modulation_meets_48000hz_256_frame_deadline) {
+    AssertDeadlineAndContinuity(48000.0, DeadlineScenario::SparseActive);
+}
+
+TEST_CASE(braid4_sparse_modulation_meets_96000hz_256_frame_deadline) {
+    AssertDeadlineAndContinuity(96000.0, DeadlineScenario::SparseActive);
+}
+
 int main() {
     int failures = 0;
     for (const auto& test : Registry()) {
         try {
             test.fn();
             std::cout << "[PASS] " << test.name << "\n";
         } catch (const std::exception& e) {
             ++failures;
             std::cerr << "[FAIL] " << test.name << ": " << e.what() << "\n";
         } catch (...) {
diff --git a/projects/synth/tests/braid4_system_tests.cpp b/projects/synth/tests/braid4_system_tests.cpp
index 184b4e2a..bf44485b 100644
--- a/projects/synth/tests/braid4_system_tests.cpp
+++ b/projects/synth/tests/braid4_system_tests.cpp
@@ -99,20 +99,129 @@ bool HasPolyline(const std::vector<synth::ui::DrawCommand>& commands) {
     return std::any_of(commands.begin(), commands.end(), [](const synth::ui::DrawCommand& command) {
         return command.kind == synth::ui::DrawCommand::Kind::Polyline;
     });
 }

 struct EngineRunResult {
     std::vector<std::vector<float>> channels;
     synth_braid4::Braid4Core::DebugCounterState counters;
 };

+enum class Braid4WorkScenario {
+    Baseline,
+    MaterializedNeutral,
+    SparseActive,
+    Inactive64Gestures,
+};
+
+struct Braid4WorkResult {
+    std::size_t topLevelProcessLiteCalls = 0;
+    std::size_t activeRouteVisits = 0;
+    std::size_t activeGestureVisits = 0;
+    std::size_t internalSubframesProcessed = 0;
+    std::size_t materializedLocalCount = 0;
+    std::size_t remainingMaterializableSlots = 0;
+    // This is the dense upper bound for the currently materialized top-level Braid4 topology,
+    // not the group's full maxParameters capacity.
+    std::size_t materializedTopLevelDenseRouteVisitUpperBound = 0;
+};
+
+Braid4WorkResult MeasureBraid4Work(Braid4WorkScenario scenario) {
+    constexpr std::size_t kHostFrames = 32;
+    std::uint64_t timestamp = 0;
+    synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
+    if (scenario == Braid4WorkScenario::Inactive64Gestures) {
+        REQUIRE_TRUE(engine.Manager().SetGestureCount(64));
+    }
+    engine.SetRuntimeDataPaths(UseScratchRuntimeDataPaths("braid4_sparse_work_counters"));
+    engine.Initialize();
+    engine.Prepare(48000.0, static_cast<int>(kHostFrames));
+
+    auto& core = engine.Application();
+    synth::ParameterManager& manager = engine.Manager();
+    const std::array<synth::ParameterGroup*, 3> groups{
+        core.StereoGroup(),
+        core.QuadGroup(),
+        core.MonoGroup(),
+    };
+
+    Braid4WorkResult result;
+    if (scenario == Braid4WorkScenario::MaterializedNeutral) {
+        for (synth::ParameterGroup* group : groups) {
+            const std::size_t availableBefore = group->AvailableParameterSlots();
+            std::size_t materialized = 0;
+            std::vector<synth::Parameter*> frontier;
+            for (std::size_t parameterIx = 0; parameterIx < manager.ParameterCount(); ++parameterIx) {
+                synth::Parameter& parameter = manager.ParameterById(static_cast<synth::ParameterId>(parameterIx));
+                if (&parameter.Group() == group) {
+                    frontier.push_back(&parameter);
+                }
+            }
+            for (std::size_t parameterIx = 0;
+                 parameterIx < frontier.size() && group->AvailableParameterSlots() != 0;
+                 ++parameterIx) {
+                for (std::size_t sourceIx = 0;
+                     sourceIx < group->Config().numModulators && group->AvailableParameterSlots() != 0;
+                     ++sourceIx) {
+                    synth::Parameter* depth = frontier[parameterIx]->EnsureModulationDepth(sourceIx);
+                    REQUIRE_TRUE(depth != nullptr);
+                    frontier.push_back(depth);
+                    ++materialized;
+                }
+            }
+            REQUIRE_TRUE(materialized == availableBefore);
+            result.materializedLocalCount += materialized;
+            result.remainingMaterializableSlots += group->AvailableParameterSlots();
+        }
+    } else if (scenario == Braid4WorkScenario::SparseActive) {
+        synth::Parameter& parameter = manager.ParameterById(0);
+        synth::Parameter* depth = parameter.EnsureModulationDepth(0);
+        REQUIRE_TRUE(depth != nullptr);
+        depth->SceneCenter(0) = 0.75f;
+        depth->SceneCenter(1) = 0.75f;
+        manager.ComputeAllParameters();
+    }
+
+    std::array<synth::ParameterProcessingObserver, 3> work{};
+    for (std::size_t groupIx = 0; groupIx < groups.size(); ++groupIx) {
+        groups[groupIx]->SetProcessingObserverForTests(&work[groupIx]);
+    }
+
+    std::array<std::vector<float>, 2> blockStorage{{
+        std::vector<float>(kHostFrames, 0.0f),
+        std::vector<float>(kHostFrames, 0.0f),
+    }};
+    std::vector<float*> outputs{blockStorage[0].data(), blockStorage[1].data()};
+    synth::AudioBlock block{
+        .outputs = outputs.data(),
+        .numOutputChannels = 2,
+        .numFrames = kHostFrames,
+    };
+    engine.ProcessBlock(block, timestamp++);
+
+    result.internalSubframesProcessed = core.DebugCounters().internalSubframesProcessed;
+    for (const synth::ParameterProcessingObserver& observer : work) {
+        result.topLevelProcessLiteCalls += observer.topLevelProcessLiteCalls;
+        result.activeRouteVisits += observer.activeRouteVisits;
+        result.activeGestureVisits += observer.activeGestureVisits;
+    }
+    std::size_t denseVisitsPerSubframe = 0;
+    for (std::size_t parameterIx = 0; parameterIx < manager.ParameterCount(); ++parameterIx) {
+        const synth::Parameter& parameter = manager.ParameterById(static_cast<synth::ParameterId>(parameterIx));
+        denseVisitsPerSubframe += parameter.Group().Config().numVoices *
+                                  parameter.Group().Config().numModulators;
+    }
+    result.materializedTopLevelDenseRouteVisitUpperBound =
+        result.internalSubframesProcessed * denseVisitsPerSubframe;
+    return result;
+}
+
 EngineRunResult RunFreshEngineSegments(int outputChannels, const std::vector<std::size_t>& segmentFrames) {
     std::uint64_t timestamp = 0;
     synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
     engine.Initialize();
     engine.Prepare(synth_braid4::Braid4Core::Config().preferredSampleRate,
                    synth_braid4::Braid4Core::Config().preferredBlockSize);

     std::vector<std::vector<float>> captured(static_cast<std::size_t>(std::max(outputChannels, 0)));
     for (const std::size_t frames : segmentFrames) {
         std::vector<std::vector<float>> blockStorage(static_cast<std::size_t>(std::max(outputChannels, 0)),
@@ -433,20 +542,72 @@ TEST_CASE(braid_and_matrix_banks_expose_required_encoder_cells) {
     }

     REQUIRE_TRUE(core.MatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(8).Id());
     REQUIRE_TRUE(core.MatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(23).Id());
     REQUIRE_TRUE(core.LfoModule().Parameters().pmIndex[0] == core.MonoGroup()->ParameterByLocalIndex(24).Id());
     REQUIRE_TRUE(core.LfoModule().Parameters().frequency[3] == core.MonoGroup()->ParameterByLocalIndex(31).Id());
     REQUIRE_TRUE(core.LfoMatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(32).Id());
     REQUIRE_TRUE(core.LfoMatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(47).Id());
 }

+TEST_CASE(braid4_parameter_processing_ignores_materialized_local_depths) {
+    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
+        64,
+        UseScratchRuntimeDataPaths("braid4_parameter_processing_ignores_materialized_local_depths"));
+    auto& core = rig.Engine().Application();
+    const std::array<synth::ParameterGroup*, 3> groups{
+        core.StereoGroup(),
+        core.QuadGroup(),
+        core.MonoGroup(),
+    };
+
+    std::size_t rootCount = 0;
+    std::array<synth::ParameterProcessingObserver, 3> work{};
+    for (std::size_t groupIx = 0; groupIx < groups.size(); ++groupIx) {
+        synth::ParameterGroup& group = *groups[groupIx];
+        rootCount += group.TopLevelParameterCount();
+        REQUIRE_TRUE(group.ParameterByLocalIndex(0).EnsureModulationDepth(0) != nullptr);
+        REQUIRE_TRUE(group.TopLevelParameterCount() < group.ParameterCount());
+        group.SetProcessingObserverForTests(&work[groupIx]);
+    }
+
+    REQUIRE_TRUE(rootCount == rig.Engine().Manager().ParameterCount());
+    for (synth::ParameterGroup* group : groups) {
+        group->ProcessSample(1);
+    }
+
+    const std::size_t visited = work[0].topLevelProcessLiteCalls +
+                                work[1].topLevelProcessLiteCalls +
+                                work[2].topLevelProcessLiteCalls;
+    REQUIRE_TRUE(visited == rootCount);
+}
+
+TEST_CASE(braid4_sparse_work_counters_bound_inactive_capacity) {
+    const Braid4WorkResult baseline = MeasureBraid4Work(Braid4WorkScenario::Baseline);
+    const Braid4WorkResult neutral = MeasureBraid4Work(Braid4WorkScenario::MaterializedNeutral);
+    const Braid4WorkResult sparse = MeasureBraid4Work(Braid4WorkScenario::SparseActive);
+    const Braid4WorkResult inactive64 = MeasureBraid4Work(Braid4WorkScenario::Inactive64Gestures);
+
+    REQUIRE_TRUE(neutral.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
+    REQUIRE_TRUE(sparse.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
+    REQUIRE_TRUE(inactive64.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
+    REQUIRE_TRUE(neutral.internalSubframesProcessed == baseline.internalSubframesProcessed);
+    REQUIRE_TRUE(sparse.internalSubframesProcessed == baseline.internalSubframesProcessed);
+    REQUIRE_TRUE(inactive64.internalSubframesProcessed == baseline.internalSubframesProcessed);
+    REQUIRE_TRUE(neutral.materializedLocalCount > 0);
+    REQUIRE_TRUE(neutral.remainingMaterializableSlots == 0);
+    REQUIRE_TRUE(neutral.activeRouteVisits == 0);
+    REQUIRE_TRUE(inactive64.activeGestureVisits == 0);
+    REQUIRE_TRUE(sparse.activeRouteVisits > 0);
+    REQUIRE_TRUE(sparse.activeRouteVisits < sparse.materializedTopLevelDenseRouteVisitUpperBound);
+}
+
 TEST_CASE(braid_palette_roles_propagate_from_literal_configuration) {
     synth::ParameterManager manager;
     synth::MessageInBus uiBus(&manager);
     synth::MidiInstrumentConfig instrument;
     synth::RuntimeConfig config = synth_braid4::Braid4::Config();
     synth::AppContext context;
     context.parameterManager = &manager;
     context.uiBus = &uiBus;
     context.instrument = &instrument;
     context.config = &config;
diff --git a/projects/synth/tests/instrument_tests.cpp b/projects/synth/tests/instrument_tests.cpp
index 3dbb6b3b..c13dc797 100644
--- a/projects/synth/tests/instrument_tests.cpp
+++ b/projects/synth/tests/instrument_tests.cpp
@@ -1,20 +1,21 @@
 #include "synth/MidiController.hpp"

 #ifdef JUCE_MAJOR_VERSION
 #error "synth module tests must not see JUCE headers"
 #endif

 #include <iostream>
 #include <sstream>
 #include <stdexcept>
 #include <string>
+#include <type_traits>
 #include <vector>

 namespace {

 struct TestCase {
     const char* name;
     void (*fn)();
 };

 std::vector<TestCase>& Registry() {
@@ -110,20 +111,78 @@ TEST_CASE(KindNameRoundTrip) {
     REQUIRE_TRUE(synth::MidiProfileKindFromName("wrldbldr", kind));
     REQUIRE_TRUE(kind == MidiProfileKind::WrldBldr);
     REQUIRE_TRUE(synth::MidiProfileKindFromName("twister", kind));
     REQUIRE_TRUE(kind == MidiProfileKind::MfTwister);
     REQUIRE_TRUE(synth::MidiProfileKindFromName("launchpad", kind));
     REQUIRE_TRUE(kind == MidiProfileKind::Launchpad);
     REQUIRE_TRUE(synth::MidiProfileKindFromName("generic", kind));
     REQUIRE_TRUE(kind == MidiProfileKind::Generic);
 }

+TEST_CASE(MessageInJsonRoundTripsHighGestureIndex) {
+    synth::JsonArena arena(4096);
+    const synth::MessageIn source = synth::MessageIn::SetGestureSelect(17, 63, true);
+    const synth::JSON json = synth::ToJSON(arena, source);
+    synth::MessageIn target;
+    REQUIRE_TRUE(synth::FromJSON(json, target));
+    REQUIRE_TRUE(target.type == synth::MessageIn::Type::SetGestureSelect);
+    REQUIRE_TRUE(target.gestureIx == 63);
+    REQUIRE_TRUE(target.boolValue);
+    REQUIRE_TRUE(target.hasBoolValue);
+}
+
+TEST_CASE(ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit) {
+    synth::ParameterManager manager;
+    REQUIRE_TRUE(manager.SetGestureCount(64));
+    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
+    auto& parameter = manager.CreateParameter(group, {.name = "High Gesture", .defaultValue = 0.25f});
+    auto& bank = manager.CreateBank();
+    bank.AddMapping(77, parameter);
+    auto& slot = manager.CreateBankSlot();
+    slot.AddPhysicalEncoder(77);
+    slot.SelectBank(&bank);
+
+    synth::MessageInBus bus(&manager, 16);
+    synth::SystemButtonMidiInConfig buttonConfig;
+    buttonConfig.associations.push_back({
+        .control = synth::MidiControlAddress{.channel = 2, .cc = 9},
+        .press = synth::MessageIn::SetGestureSelect(0, 63, true),
+        .release = synth::MessageIn::SetGestureSelect(0, 63, false),
+    });
+    synth::SystemButtonMidiInProcessor buttons(buttonConfig, &bus);
+    buttons.SetTimestampProvider([] { return 41; });
+    buttons.Process(synth::BasicMidi::CC(0, 2, 9, 127));
+    bus.Process(41);
+    REQUIRE_TRUE(manager.GestureSelected(63));
+
+    synth::AnalogMidiInConfig analogConfig;
+    analogConfig.gestures.push_back({.control = {.channel = 2, .cc = 10}, .gestureIx = 63});
+    synth::AnalogMidiInProcessor analog(analogConfig, &bus);
+    analog.SetTimestampProvider([] { return 42; });
+    analog.Process(synth::BasicMidi::CC(0, 2, 10, 127));
+    bus.Process(42);
+    REQUIRE_TRUE(manager.GestureValue(63) == 1.0f);
+
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(43, 0, 0, 0.1f)));
+    bus.Process(43); // first turn arms the selected gesture
+    REQUIRE_TRUE(parameter.GestureActive(0, 63));
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(44, 0, 0, 0.1f)));
+    bus.Process(44); // second turn edits that same active manager gesture
+    REQUIRE_TRUE(parameter.GestureValue(0, 63) > 0.25f);
+
+    auto ui = manager.CreateUIState();
+    manager.PopulateUIState(*ui);
+    static_assert(std::is_same_v<decltype(ui->gestures.bankAffectingMask[0].load()), std::uint32_t>);
+    REQUIRE_TRUE(ui->gestures.bankAffectingMask[63].load() == 1u);
+    REQUIRE_TRUE(ui->gestures.bankAffectingCount[63].load() == 1);
+}
+
 TEST_CASE(KindNameFromUnknownRejected) {
     MidiProfileKind kind = MidiProfileKind::Generic;
     REQUIRE_TRUE(!synth::MidiProfileKindFromName("bogus", kind));
     REQUIRE_TRUE(!synth::MidiProfileKindFromName("", kind));
     REQUIRE_TRUE(!synth::MidiProfileKindFromName("WrldBldr", kind));
 }

 TEST_CASE(KindSupportMatrix) {
     const MidiKindSupport wrldbldr = synth::KindSupport(MidiProfileKind::WrldBldr);
     REQUIRE_TRUE(wrldbldr.encoders);
diff --git a/projects/synth/tests/module_tests.cpp b/projects/synth/tests/module_tests.cpp
index e6a73de1..4295c7bc 100644
--- a/projects/synth/tests/module_tests.cpp
+++ b/projects/synth/tests/module_tests.cpp
@@ -1467,40 +1467,46 @@ TEST_CASE(demo_modulation_process_parameters_applies_direct_vco_modulation) {
     constexpr float tolerance = 0.0001f;

     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 2,
         .numModulators = 3,
         .numScenes = 1,
         .maxParameters = 4,
         .processLiteAlpha = 1.0f,
     });
+    synth::ParameterProcessingObserver work;
+    group.SetProcessingObserverForTests(&work);
     auto& phase = manager.CreateParameter(group, {.name = "Phase", .defaultValue = 0.0f});
     auto& directDepth = manager.CreateParameter(group, {
         .name = "Phase Direct Depth",
         .defaultValue = 1.0f,
     });
     REQUIRE_TRUE(phase.AssignModulationDepth(0, &directDepth));
     phase.Compute(manager.Scene());
     directDepth.Compute(manager.Scene());

     group.GetModulators().Value(0, 0) = 0.0f;
     group.GetModulators().Value(1, 0) = 1.0f;
     synth_miniapp::ProcessParameters(group, /*sampleIndex=*/0);
     REQUIRE_NEAR(phase.GetRaw(0), 0.0f, tolerance);
     REQUIRE_NEAR(phase.GetRaw(1), 1.0f, tolerance);
+    REQUIRE_TRUE(phase.ActiveRouteCount() == 1);
+    REQUIRE_TRUE(phase.ActiveRouteSourceIndices()[0] == 0);
+    REQUIRE_TRUE(work.activeRouteVisits == 2);

     group.GetModulators().Value(0, 0) = 1.0f;
     group.GetModulators().Value(1, 0) = 0.0f;
     synth_miniapp::ProcessParameters(group, /*sampleIndex=*/1);
     REQUIRE_NEAR(phase.GetRaw(0), 1.0f, tolerance);
     REQUIRE_NEAR(phase.GetRaw(1), 0.0f, tolerance);
+    REQUIRE_TRUE(work.activeRouteVisits == 4);
 }

 int main() {
     int failed = 0;
     for (const auto& test : Registry()) {
         try {
             test.fn();
             std::cout << "[PASS] " << test.name << "\n";
         } catch (const std::exception& ex) {
             ++failed;
diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
index 9c7c98e9..d1b8b7c5 100644
--- a/projects/synth/tests/parameter_modulation_tests.cpp
+++ b/projects/synth/tests/parameter_modulation_tests.cpp
@@ -79,20 +79,75 @@ struct TestVisualizer final : synth::ui::Visualizer {
 };

 std::string JsonToString(synth::JSON json) {
     char* dumped = json.Dumps(JSON_ENCODE_ANY);
     REQUIRE_TRUE(dumped != nullptr);
     std::string text(dumped);
     std::free(dumped);
     return text;
 }

+bool JsonSemanticallyEqual(synth::JSON left, synth::JSON right) {
+    if (left.IsNull() || right.IsNull()) {
+        return left.IsNull() && right.IsNull();
+    }
+    const synth::JsonType leftType = left.m_node->m_type;
+    const synth::JsonType rightType = right.m_node->m_type;
+    const bool leftNumber = leftType == synth::JsonType::Integer || leftType == synth::JsonType::Real;
+    const bool rightNumber = rightType == synth::JsonType::Integer || rightType == synth::JsonType::Real;
+    if (leftNumber || rightNumber) {
+        return leftNumber && rightNumber && left.NumberValue() == right.NumberValue();
+    }
+    if (leftType != rightType) {
+        return false;
+    }
+
+    switch (leftType) {
+    case synth::JsonType::Null:
+        return true;
+    case synth::JsonType::Object: {
+        if (left.Size() != right.Size()) {
+            return false;
+        }
+        const synth::JsonMember* members =
+            static_cast<const synth::JsonMember*>(left.m_node->m_container.m_entries);
+        for (std::size_t ix = 0; ix < left.Size(); ++ix) {
+            if (members[ix].m_key == nullptr ||
+                !JsonSemanticallyEqual(synth::JSON(members[ix].m_value), right.Get(members[ix].m_key))) {
+                return false;
+            }
+        }
+        return true;
+    }
+    case synth::JsonType::Array:
+        if (left.Size() != right.Size()) {
+            return false;
+        }
+        for (std::size_t ix = 0; ix < left.Size(); ++ix) {
+            if (!JsonSemanticallyEqual(left.GetAt(ix), right.GetAt(ix))) {
+                return false;
+            }
+        }
+        return true;
+    case synth::JsonType::String:
+        return std::string(left.StringValue()) == std::string(right.StringValue());
+    case synth::JsonType::Boolean:
+        return left.BooleanValue() == right.BooleanValue();
+    case synth::JsonType::Integer:
+    case synth::JsonType::Real:
+        return false;
+    }
+    return false;
+}
+
+void RequireRouteBijection(const synth::Parameter& parameter, std::size_t sourceCount);
+
 // Wraps a single WrldBldr-kind MidiControllerProfileConfig (as produced by
 // WrldBldrDefaultProfileConfig, whose system-message associations always
 // carry both a control address and a wrldBldrPosition -- see
 // SlotValidForKind's WrldBldr branch) plus a pair of endpoint identifiers
 // into a one-controller MidiInstrumentConfig, for patch-persistence tests
 // that used to build a bare MidiControllerProfileConfig + MidiEndpointState
 // pair directly. Named "controller" to match MidiControllerSlot's default
 // name so assertions reading loaded.controllers[0] read naturally.
 synth::MidiInstrumentConfig MakeInstrumentFromProfile(const synth::MidiControllerProfileConfig& profile,
                                                        std::string_view inputIdentifier = "",
@@ -326,41 +381,41 @@ TEST_CASE(parameter_group_timing_reconfiguration_preserves_topology_values_and_p
     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.25f});
     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
     REQUIRE_TRUE(depth != nullptr);
     carrier.SceneCenter(1) = 0.75f;
     depth->SceneCenter(0) = 0.5f;
     manager.ComputeAllTargets();
     carrier.ProcessLite();

     synth::Parameter* const carrierPointer = &carrier;
     synth::Parameter* const depthPointer = depth;
-    float* const currentDepthPointer = carrier.CurrentDepths(0).data();
+    float* const currentDepthPointer = carrier.CurrentDepthSlots(0).data();
     const float currentCenter = carrier.CurrentCenter();
-    const float currentDepth = carrier.CurrentDepths(0)[0];
+    const float currentDepth = carrier.CurrentDepthForSource(0, 0);
     const float sceneValue = carrier.SceneCenter(1);

     group.ConfigureProcessingTiming({
         .processLiteAlpha = 0.125f,
         .targetComputeIntervalSamples = 64,
         .uiDisplayCenterAlpha = 0.25f,
         .uiDisplaySpreadAlpha = 0.5f,
     });

     REQUIRE_TRUE(&group.ParameterByLocalIndex(0) == carrierPointer);
     REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depthPointer);
-    REQUIRE_TRUE(carrier.CurrentDepths(0).data() == currentDepthPointer);
+    REQUIRE_TRUE(carrier.CurrentDepthSlots(0).data() == currentDepthPointer);
     REQUIRE_TRUE(group.Config().numVoices == 2);
     REQUIRE_TRUE(group.Config().numModulators == 1);
     REQUIRE_TRUE(group.Config().numScenes == 2);
     REQUIRE_TRUE(group.Config().maxParameters == 4);
     REQUIRE_NEAR(carrier.CurrentCenter(), currentCenter, 0.0001f);
-    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], currentDepth, 0.0001f);
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), currentDepth, 0.0001f);
     REQUIRE_NEAR(carrier.SceneCenter(1), sceneValue, 0.0001f);
     REQUIRE_NEAR(group.Config().processLiteAlpha, 0.125f, 0.0001f);
     REQUIRE_TRUE(group.Config().targetComputeIntervalSamples == 64);
     REQUIRE_NEAR(group.Config().uiDisplayCenterAlpha, 0.25f, 0.0001f);
     REQUIRE_NEAR(group.Config().uiDisplaySpreadAlpha, 0.5f, 0.0001f);
 }

 TEST_CASE(parameter_group_timing_reconfiguration_is_non_compounding) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
@@ -459,20 +514,77 @@ TEST_CASE(manager_gesture_count_is_fixed_before_groups) {
     REQUIRE_TRUE(manager.SetGestureCount(2));
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numScenes = 1,
         .maxParameters = 1,
     });
     REQUIRE_TRUE(group.GestureCount() == 2);
     REQUIRE_TRUE(!manager.SetGestureCount(3));
 }

+TEST_CASE(manager_gesture_count_supports_zero_through_64_and_rejects_65_without_mutation) {
+    for (const std::size_t count : {std::size_t{0}, std::size_t{1}, std::size_t{32},
+                                    std::size_t{33}, std::size_t{64}}) {
+        synth::ParameterManager manager;
+        REQUIRE_TRUE(manager.SetGestureCount(count));
+        REQUIRE_TRUE(manager.GestureCount() == count);
+        if (count != 0) {
+            manager.SelectGesture(count - 1);
+            REQUIRE_TRUE(manager.GestureSelected(count - 1));
+        }
+    }
+
+    synth::ParameterManager manager;
+    REQUIRE_TRUE(manager.SetGestureCount(64));
+    manager.SelectGesture(63);
+    REQUIRE_TRUE(manager.GestureSelected(63));
+    REQUIRE_TRUE(manager.SelectedGestureMask() == (synth::GestureMask{1} << 63));
+    REQUIRE_TRUE(!manager.SetGestureCount(65));
+    REQUIRE_TRUE(manager.GestureCount() == 64);
+    REQUIRE_TRUE(manager.GestureSelected(63));
+
+    bool threw = false;
+    try {
+        (void)synth::Gestures(65);
+    } catch (const std::invalid_argument&) {
+        threw = true;
+    }
+    REQUIRE_TRUE(threw);
+}
+
+TEST_CASE(gesture_masks_visit_only_active_bits_through_index_63) {
+    synth::ParameterManager manager;
+    REQUIRE_TRUE(manager.SetGestureCount(64));
+    auto& group = manager.CreateGroup({
+        .numVoices = 1,
+        .numScenes = 2,
+        .maxParameters = 1,
+        .processLiteAlpha = 1.0f,
+        .targetCenterAlpha = 1.0f,
+    });
+    auto& parameter = manager.CreateParameter(group, {.name = "Gesture sparse", .defaultValue = 0.25f});
+    synth::ParameterProcessingObserver work{};
+    group.SetProcessingObserverForTests(&work);
+
+    parameter.Compute(manager.Scene());
+    REQUIRE_TRUE(work.activeGestureVisits == 0);
+
+    parameter.SetGestureActive(0, 63, true);
+    parameter.GestureValue(0, 63) = 0.75f;
+    manager.SetGestureValue(63, 1.0f);
+    parameter.Compute(manager.Scene());
+    REQUIRE_TRUE(work.activeGestureVisits == 1);
+    REQUIRE_TRUE((parameter.GesturesAffectingMask() & (std::uint64_t{1} << 63)) != 0);
+    parameter.ProcessLite();
+    REQUIRE_NEAR(parameter.GetRaw(0), 0.75f, 0.000001f);
+}
+
 TEST_CASE(validated_scene_endpoint_setter_preserves_state_on_reject) {
     synth::ParameterManager manager;
     manager.SetGestureCount(1);
     (void)manager.CreateGroup({.numVoices = 1, .numScenes = 2, .maxParameters = 1});
     (void)manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});

     REQUIRE_TRUE(manager.SetSceneEndpoints(0, 0));
     manager.SetSceneBlend(0.25f);
     REQUIRE_TRUE(!manager.SetSceneEndpoints(1, 0));
     REQUIRE_TRUE(manager.Scene().leftScene == 0);
@@ -989,22 +1101,22 @@ TEST_CASE(parameter_default_state) {
     REQUIRE_TRUE(&parameter.Group() == &group);
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.3f, 0.0001f);
     REQUIRE_NEAR(parameter.SceneCenter(1), 0.3f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenter(), 0.3f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenter(), 0.3f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenterScale(0), 1.0f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenterScale(1), 1.0f, 0.0001f);
     REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == nullptr);
     REQUIRE_TRUE(!parameter.GestureActive(0, 0));
     REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.3f, 0.0001f);
-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.0f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(1)[1], 0.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), 0.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(1, 1), 0.0f, 0.0001f);
 }

 TEST_CASE(bipolar_parameter_core_stores_normalized_center) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 2,
         .maxParameters = 1,
         .processLiteAlpha = 1.0f,
@@ -1183,21 +1295,21 @@ TEST_CASE(modulation_normalization_under_one) {
         .maxParameters = 2,
     });

     auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
     auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.75f});
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));

     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.75f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.25f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.25f, 0.0001f);
 }

 TEST_CASE(modulation_normalization_over_one_preserves_sign) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 2,
         .numScenes = 1,
         .maxParameters = 3,
@@ -1213,22 +1325,22 @@ TEST_CASE(modulation_normalization_over_one_preserves_sign) {
         .name = "Negative",
         .defaultValue = 0.0f,
         .range = synth::RangeKind::Bipolar,
     });
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
     REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));

     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.0f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.5f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 1), -0.5f, 0.0001f);
 }

 TEST_CASE(negative_modulation_depths_add_normalization_offset) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 2,
         .numScenes = 1,
         .maxParameters = 3,
         .processLiteAlpha = 1.0f,
@@ -1247,22 +1359,22 @@ TEST_CASE(negative_modulation_depths_add_normalization_offset) {
         .range = synth::RangeKind::Bipolar,
     });
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
     REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));

     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
     parameter.ProcessLite();

     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.5f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetNormalizationOffset(0), 0.25f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.25f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.25f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.25f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 1), -0.25f, 0.0001f);

     group.GetModulators().Value(0, 0) = 0.0f;
     group.GetModulators().Value(0, 1) = 0.0f;
     REQUIRE_NEAR(parameter.GetRaw(0), 0.5f, 0.0001f);

     group.GetModulators().Value(0, 0) = 1.0f;
     group.GetModulators().Value(0, 1) = 0.0f;
     REQUIRE_NEAR(parameter.GetRaw(0), 0.75f, 0.0001f);

     group.GetModulators().Value(0, 0) = 0.0f;
@@ -1293,22 +1405,22 @@ TEST_CASE(overfull_negative_modulation_offset_uses_normalized_depths) {
         .range = synth::RangeKind::Bipolar,
     });
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
     REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));

     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
     parameter.ProcessLite();

     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.0f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetNormalizationOffset(0), 0.5f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.5f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 1), -0.5f, 0.0001f);

     group.GetModulators().Value(0, 0) = 0.0f;
     group.GetModulators().Value(0, 1) = 0.0f;
     REQUIRE_NEAR(parameter.GetRaw(0), 0.5f, 0.0001f);

     group.GetModulators().Value(0, 0) = 1.0f;
     group.GetModulators().Value(0, 1) = 0.0f;
     REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 0.0001f);

     group.GetModulators().Value(0, 0) = 0.0f;
@@ -1338,21 +1450,21 @@ TEST_CASE(recursive_modulation_depth_targets_use_bipolar_zero_based_exponential_
         {.knob = 0.25f, .expectedDepth = -0.25f},
         {.knob = 0.5f, .expectedDepth = 0.0f},
         {.knob = 0.75f, .expectedDepth = 0.25f},
         {.knob = 1.0f, .expectedDepth = 1.0f},
     }};

     for (const Case& testCase : cases) {
         depth->SceneCenter(0) = testCase.knob;
         carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
         REQUIRE_NEAR(depth->GetRaw(0), testCase.knob, 0.0001f);
-        REQUIRE_NEAR(carrier.TargetDepths(0)[0], testCase.expectedDepth, 0.0001f);
+        REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), testCase.expectedDepth, 0.0001f);
     }
 }

 TEST_CASE(recursive_modulation_depth_compute_ignores_target_center_smoothing_for_parent_reads) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
@@ -1362,40 +1474,40 @@ TEST_CASE(recursive_modulation_depth_compute_ignores_target_center_smoothing_for
     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
     REQUIRE_TRUE(depth != nullptr);

     depth->SceneCenter(0) = 1.0f;
     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

     REQUIRE_NEAR(depth->TargetCenter(), 1.0f, 0.0001f);
     REQUIRE_NEAR(depth->CurrentCenter(), 1.0f, 0.0001f);
     REQUIRE_NEAR(depth->GetRaw(0), 1.0f, 0.0001f);
-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 1.0f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 1.0f, 0.0001f);
 }

 TEST_CASE(recursive_modulation_depth_three_quarter_turn_sets_quarter_raw_depth_before_normalization) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
     });

     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
     REQUIRE_TRUE(depth != nullptr);
     depth->SceneCenter(0) = 0.75f;

     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.25f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.25f, 0.0001f);
     REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.75f, 0.0001f);
     REQUIRE_NEAR(carrier.TargetNormalizationOffset(0), 0.0f, 0.0001f);
 }

 TEST_CASE(curved_modulation_depth_targets_still_use_signed_normalization) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 2,
         .numScenes = 1,
@@ -1410,22 +1522,22 @@ TEST_CASE(curved_modulation_depth_targets_still_use_signed_normalization) {
     REQUIRE_TRUE(positive != nullptr);
     REQUIRE_TRUE(negative != nullptr);
     positive->SceneCenter(0) = 1.0f;
     negative->SceneCenter(0) = 0.0f;

     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
     carrier.ProcessLite();

     REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.0f, 0.0001f);
     REQUIRE_NEAR(carrier.TargetNormalizationOffset(0), 0.5f, 0.0001f);
-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.5f, 0.0001f);
-    REQUIRE_NEAR(carrier.TargetDepths(0)[1], -0.5f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.5f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 1), -0.5f, 0.0001f);
 }

 TEST_CASE(curved_modulation_depth_targets_keep_modulator_dot_product_linear) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
         .processLiteAlpha = 1.0f,
@@ -1434,21 +1546,21 @@ TEST_CASE(curved_modulation_depth_targets_keep_modulator_dot_product_linear) {

     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.0f});
     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
     REQUIRE_TRUE(depth != nullptr);
     depth->SceneCenter(0) = 0.75f;

     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
     carrier.ProcessLite();

     group.GetModulators().Value(0, 0) = 0.8f;
-    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], 0.25f, 0.0001f);
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), 0.25f, 0.0001f);
     REQUIRE_NEAR(carrier.GetRaw(0), 0.2f, 0.0001f);
 }

 TEST_CASE(parameter_get_raw_includes_normalization_offset) {
     synth::ParameterManager manager;
     synth::ParameterGroupConfig config{
         .numVoices = 1,
         .numModulators = 2,
         .numScenes = 1,
         .maxParameters = 8,
@@ -1560,21 +1672,21 @@ TEST_CASE(nested_depth_route_reads_get_and_bypasses_slew) {
     auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.0f});
     depth.SceneCenter(0) = 0.8f;
     depth.SceneCenter(1) = 0.8f;
     REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depth));

     carrier.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.0f});

     REQUIRE_TRUE(depth.RecursionDepth() == 1);
     REQUIRE_NEAR(depth.CurrentCenter(), 0.8f, 0.0001f);
     REQUIRE_NEAR(depth.GetRaw(0), 0.8f, 0.0001f);
-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.3421493f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.3421493f, 0.0001f);
     REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.6578507f, 0.0001f);
 }

 TEST_CASE(process_lite_slews_center_scale_offset_and_depths) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 2,
@@ -1592,21 +1704,21 @@ TEST_CASE(process_lite_slews_center_scale_offset_and_depths) {
     parameter.SceneCenter(0) = 1.0f;
     parameter.SceneCenter(1) = 1.0f;
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));

     parameter.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.0f});
     parameter.ProcessLite();

     REQUIRE_NEAR(parameter.CurrentCenter(), 0.25f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenterScale(0), 0.9375f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentNormalizationOffset(0), 0.0625f, 0.0001f);
-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], -0.0625f, 0.0001f);
+    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), -0.0625f, 0.0001f);

     synth::Parameter::UIState ui(1);
     parameter.PopulateUIState(ui);
     REQUIRE_NEAR(ui.minValues[0].load(), 0.1875f, 0.0001f);
     REQUIRE_NEAR(ui.maxValues[0].load(), 0.25f, 0.0001f);
 }

 TEST_CASE(process_lite_samples_cached_knob_after_slew) {
     synth::ParameterManager manager;
     synth::ParameterGroupConfig config{
@@ -1693,21 +1805,69 @@ TEST_CASE(parameter_group_process_sample_covers_top_level_and_modulation_depth_t

     carrier.SceneCenter(0) = 0.2f;
     sibling.SceneCenter(0) = 0.4f;
     depth->SceneCenter(0) = 0.75f;

     group.ProcessSample(0);

     REQUIRE_NEAR(carrier.TargetCenter(), 0.2f, 0.0001f);
     REQUIRE_NEAR(sibling.TargetCenter(), 0.4f, 0.0001f);
     REQUIRE_NEAR(depth->TargetCenter(), 0.75f, 0.0001f);
-    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], 0.25f, 0.0001f);
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), 0.25f, 0.0001f);
+}
+
+TEST_CASE(group_process_sample_visits_only_registered_roots) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({
+        .numVoices = 1,
+        .numModulators = 2,
+        .numScenes = 1,
+        .maxParameters = 8,
+        .targetComputeIntervalSamples = 16,
+    });
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});
+    (void)manager.CreateParameter(group, {.name = "Tone"});
+    auto& depth = carrier.EnsureModulationDepth(0, {.name = "Carrier M1", .defaultValue = 0.5f});
+    (void)depth.EnsureModulationDepth(1, {.name = "Carrier M1 M2", .defaultValue = 0.5f});
+    synth::ParameterProcessingObserver work{};
+    group.SetProcessingObserverForTests(&work);
+
+    group.ProcessSample(1);
+    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 2);
+    REQUIRE_TRUE(work.localRecursiveComputeCalls == 0);
+
+    group.ProcessSample(16);
+    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 4);
+    REQUIRE_TRUE(work.localRecursiveComputeCalls == 2);
+}
+
+TEST_CASE(recursive_local_compute_seeds_display_without_audio_rate_processing) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({
+        .numVoices = 1,
+        .numModulators = 1,
+        .numScenes = 1,
+        .maxParameters = 4,
+        .targetComputeIntervalSamples = 16,
+    });
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});
+    auto& depth = carrier.EnsureModulationDepth(0, {.name = "Carrier M1", .defaultValue = 0.5f});
+    depth.SceneCenter(0) = 0.75f;
+    synth::ParameterProcessingObserver work{};
+    group.SetProcessingObserverForTests(&work);
+
+    group.ProcessSample(16);
+
+    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 1);
+    REQUIRE_TRUE(work.localRecursiveComputeCalls == 1);
+    REQUIRE_NEAR(depth.UIDisplayCenter(0), depth.GetRaw(0), 0.000001f);
+    REQUIRE_NEAR(depth.UIDisplaySpread(0), 0.0f, 0.000001f);
 }

 TEST_CASE(mapping_helpers_use_cached_process_lite_knob_value) {
     synth::ParameterManager manager;
     synth::ParameterGroupConfig config{
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 4,
         .processLiteAlpha = 1.0f,
@@ -2022,57 +2182,66 @@ TEST_CASE(parameter_ui_state_clears_semantic_colors_when_disconnected) {
     state.SetDisconnected();
     REQUIRE_TRUE(!state.connected.load(std::memory_order_relaxed));
     REQUIRE_TRUE(state.baseColor.Load() == synth::Color::Off);
     REQUIRE_TRUE(state.indicatorColors[0].Load() == synth::Color::Off);
     REQUIRE_TRUE(state.modulatorColorCount.load() == 0);
     REQUIRE_TRUE(state.gestureColorCount.load() == 0);
     REQUIRE_TRUE(state.modulatorSourceColors[0].Load() == synth::Color::Off);
     REQUIRE_TRUE(state.gestureColors[0].Load() == synth::Color::Off);
 }

-TEST_CASE(ui_state_reports_affecting_masks_for_first_32_indices) {
+TEST_CASE(ui_state_reports_affecting_masks_through_gesture_index_63) {
     synth::ParameterManager manager;
-    manager.SetGestureCount(33);
+    manager.SetGestureCount(64);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 33,
         .numScenes = 2,
         .maxParameters = 4,
     });

     auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
     auto& depth31 = manager.CreateParameter(group, {.name = "Depth31", .defaultValue = 0.25f});
     auto& depth32 = manager.CreateParameter(group, {.name = "Depth32", .defaultValue = 0.25f});
     REQUIRE_TRUE(parameter.AssignModulationDepth(31, &depth31));
     REQUIRE_TRUE(parameter.AssignModulationDepth(32, &depth32));
     depth31.SceneCenter(0) = 0.75f;
     parameter.SetGestureActive(0, 0, true);
     parameter.SetGestureActive(0, 31, true);
     parameter.SetGestureActive(0, 32, true);
+    parameter.SetGestureActive(0, 63, true);
     parameter.SetGestureActive(1, 1, true);
     parameter.SetGestureActive(1, 31, true);
+    parameter.SetGestureActive(1, 32, true);

     synth::Parameter::UIState ui(1);
     REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));

     manager.SetSceneBlend(0.0f);
     parameter.PopulateUIState(ui);
     REQUIRE_TRUE(ui.modulatorsAffectingMask.load() == (1u << 31));
-    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 0) | (1u << 31)));
+    REQUIRE_TRUE(ui.gesturesAffectingMask.load() ==
+                 ((std::uint64_t{1} << 0) | (std::uint64_t{1} << 31) |
+                  (std::uint64_t{1} << 32) | (std::uint64_t{1} << 63)));

     manager.SetSceneBlend(1.0f);
     parameter.PopulateUIState(ui);
-    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 1) | (1u << 31)));
+    REQUIRE_TRUE(ui.gesturesAffectingMask.load() ==
+                 ((std::uint64_t{1} << 1) | (std::uint64_t{1} << 31) |
+                  (std::uint64_t{1} << 32)));

     manager.SetSceneBlend(0.5f);
     parameter.PopulateUIState(ui);
-    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 0) | (1u << 1) | (1u << 31)));
+    REQUIRE_TRUE(ui.gesturesAffectingMask.load() ==
+                 ((std::uint64_t{1} << 0) | (std::uint64_t{1} << 1) |
+                  (std::uint64_t{1} << 31) | (std::uint64_t{1} << 32) |
+                  (std::uint64_t{1} << 63)));
 }

 TEST_CASE(ui_state_ignores_inactive_depth_gesture_values_for_modulator_mask) {
     synth::ParameterManager manager;
     manager.SetGestureCount(1);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
@@ -2140,26 +2309,28 @@ TEST_CASE(modulation_depth_assignment_rejects_cross_group_routes) {
     REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
 }

 TEST_CASE(get_clamps_and_rejects_out_of_range_voice) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
-        .maxParameters = 1,
+        .maxParameters = 2,
     });
     auto& parameter = manager.CreateParameter(group, {.name = "Clamp", .defaultValue = 1.0f});
+    auto* depth = parameter.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 1.0f;
     group.GetModulators().Value(0, 0) = 1.0f;
-    parameter.TargetDepths(0)[0] = 1.0f;
-    parameter.ProcessLite();
+    manager.ComputeAllParameters();

     REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 0.0001f);

     bool threw = false;
     try {
         (void)parameter.GetRaw(1);
     } catch (const std::out_of_range&) {
         threw = true;
     }
     REQUIRE_TRUE(threw);
@@ -2590,41 +2761,41 @@ TEST_CASE(handle_inc_dec_saturation_solve_matches_smart_grid) {
     parameter.HandleIncDec(scene, 0.2f);
     parameter.Compute(scene);

     REQUIRE_NEAR(parameter.SceneCenter(0), 1.0f, 0.0001f);
     REQUIRE_NEAR(parameter.SceneCenter(1), 0.7f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenter(), 0.925f, 0.0001f);
 }

 TEST_CASE(selected_gesture_activation_snapshots_parent_value) {
     synth::ParameterManager manager;
-    manager.SetGestureCount(2);
+    manager.SetGestureCount(64);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 2,
         .maxParameters = 1,
         .targetCenterAlpha = 1.0f,
     });
     auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.1f});
     parameter.SceneCenter(0) = 0.25f;
     parameter.SceneCenter(1) = 0.75f;
-    parameter.GestureValue(0, 0) = 0.9f;
-    parameter.GestureValue(1, 0) = 0.9f;
-    manager.SelectGesture(0);
+    parameter.GestureValue(0, 63) = 0.9f;
+    parameter.GestureValue(1, 63) = 0.9f;
+    manager.SelectGesture(63);

     parameter.HandleIncDec({.leftScene = 0, .rightScene = 1, .blend = 0.0f}, 0.0f);

-    REQUIRE_TRUE(parameter.GestureActive(0, 0));
-    REQUIRE_TRUE(!parameter.GestureActive(1, 0));
-    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.25f, 0.0001f);
-    REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.9f, 0.0001f);
+    REQUIRE_TRUE(parameter.GestureActive(0, 63));
+    REQUIRE_TRUE(!parameter.GestureActive(1, 63));
+    REQUIRE_NEAR(parameter.GestureValue(0, 63), 0.25f, 0.0001f);
+    REQUIRE_NEAR(parameter.GestureValue(1, 63), 0.9f, 0.0001f);
 }

 TEST_CASE(selected_inactive_gesture_first_turn_arms_without_applying_delta) {
     synth::ParameterManager manager;
     manager.SetGestureCount(1);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 1,
         .maxParameters = 1,
@@ -2661,41 +2832,41 @@ TEST_CASE(selected_zero_weight_gesture_first_turn_arms_without_applying_delta) {
     const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
     parameter.HandleIncDec(scene, 0.2f);

     REQUIRE_TRUE(parameter.GestureActive(0, 0));
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
     REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.25f, 0.0001f);
 }

 TEST_CASE(active_high_gesture_distributes_after_deselection) {
     synth::ParameterManager manager;
-    manager.SetGestureCount(1);
+    manager.SetGestureCount(64);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 1,
         .maxParameters = 1,
     });
     auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.25f});
     parameter.SceneCenter(0) = 0.25f;
-    parameter.GestureValue(0, 0) = 0.9f;
-    parameter.SetGestureActive(0, 0, true);
-    manager.SetGestureValue(0, 1.0f);
-    manager.DeselectGesture(0);
+    parameter.GestureValue(0, 63) = 0.9f;
+    parameter.SetGestureActive(0, 63, true);
+    manager.SetGestureValue(63, 1.0f);
+    manager.DeselectGesture(63);

     const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
     parameter.HandleIncDec(scene, 0.2f);

-    REQUIRE_TRUE(parameter.GestureActive(0, 0));
-    REQUIRE_TRUE(!manager.GestureSelected(0));
+    REQUIRE_TRUE(parameter.GestureActive(0, 63));
+    REQUIRE_TRUE(!manager.GestureSelected(63));
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
-    REQUIRE_NEAR(parameter.GestureValue(0, 0), 1.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.GestureValue(0, 63), 1.0f, 0.0001f);
 }

 TEST_CASE(selected_gesture_weight_one_edits_gesture_without_moving_base) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 1,
         .maxParameters = 1,
@@ -2894,22 +3065,22 @@ TEST_CASE(revert_to_default_clears_modulation_and_gestures) {
     parameter.Compute(scene);
     parameter.ProcessLite();

     REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == &depth);
     REQUIRE_NEAR(depth.SceneCenter(0), 0.5f, 0.0001f);
     REQUIRE_NEAR(depth.SceneCenter(1), 0.5f, 0.0001f);
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.4f, 0.0001f);
     REQUIRE_NEAR(parameter.SceneCenter(1), 0.4f, 0.0001f);
     REQUIRE_TRUE(!parameter.GestureActive(0, 0));
     REQUIRE_TRUE(!parameter.GestureActive(1, 0));
-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.0f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(1)[0], 0.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), 0.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(1, 0), 0.0f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenter(), 0.4f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenter(), 0.4f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenterScale(0), 1.0f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenterScale(1), 1.0f, 0.0001f);
     REQUIRE_NEAR(parameter.GetRaw(0), 0.4f, 0.0001f);
     REQUIRE_NEAR(parameter.GetRaw(1), 0.4f, 0.0001f);
 }

 TEST_CASE(revert_to_default_rejects_invalid_scene_without_mutation) {
     synth::ParameterManager manager;
@@ -2918,36 +3089,39 @@ TEST_CASE(revert_to_default_rejects_invalid_scene_without_mutation) {
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
     });
     auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
     auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.5f});
     parameter.SceneCenter(0) = 0.9f;
     parameter.SetGestureActive(0, 0, true);
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
-    parameter.TargetDepths(0)[0] = 0.75f;
-    parameter.CurrentDepths(0)[0] = 0.5f;
+    depth.SceneCenter(0) = 0.75f;
+    manager.ComputeAllParameters();
+    const std::size_t routeSlot = parameter.RoutePositionForSource(0);
+    parameter.TargetDepthSlots(0)[routeSlot] = 0.75f;
+    parameter.CurrentDepthSlots(0)[routeSlot] = 0.5f;

     bool threw = false;
     try {
         parameter.RevertToDefault({.leftScene = 3, .rightScene = 0, .blend = 0.0f});
     } catch (const std::out_of_range&) {
         threw = true;
     }

     REQUIRE_TRUE(threw);
     REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == &depth);
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.9f, 0.0001f);
     REQUIRE_TRUE(parameter.GestureActive(0, 0));
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.75f, 0.0001f);
-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.75f, 0.0001f);
+    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), 0.5f, 0.0001f);
 }

 TEST_CASE(page_routing_changes_without_mutating_parameter_state) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 2,
         .maxParameters = 2,
@@ -3508,27 +3682,33 @@ TEST_CASE(modulation_view_lazy_depth_names_include_target_parameter_for_duplicat
     slot.AddPhysicalEncoder(1);
     slot.AddPhysicalEncoder(2);
     slot.SelectBank(&bank);

     slot.HandlePress(1);
     slot.HandlePress(2);
     slot.HandlePress(2);

     synth::Parameter* firstDepth = first.ModulationDepthParameter(0);
     synth::Parameter* secondDepth = second.ModulationDepthParameter(0);
-    REQUIRE_TRUE(firstDepth != nullptr);
+    REQUIRE_TRUE(firstDepth == nullptr);
     REQUIRE_TRUE(secondDepth != nullptr);
-    REQUIRE_TRUE(firstDepth->Name() == "Carrier A Filter Env");
     REQUIRE_TRUE(secondDepth->Name() == "Carrier B Filter Env");
-    REQUIRE_TRUE(firstDepth->ShortName() == "Env");
     REQUIRE_TRUE(secondDepth->ShortName() == "Env");
-    REQUIRE_TRUE(group.ParameterCount() == 4);
+    const std::size_t highWater = group.ParameterCount();
+
+    bank.Deselect();
+    slot.HandlePress(1);
+    firstDepth = first.ModulationDepthParameter(0);
+    REQUIRE_TRUE(firstDepth != nullptr);
+    REQUIRE_TRUE(firstDepth->Name() == "Carrier A Filter Env");
+    REQUIRE_TRUE(firstDepth->ShortName() == "Env");
+    REQUIRE_TRUE(group.ParameterCount() == highWater);
     REQUIRE_TRUE(manager.ParameterCount() == 2);
 }

 TEST_CASE(pressing_modulation_cell_opens_nested_modulation_view) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
@@ -3772,20 +3952,50 @@ TEST_CASE(modified_bank_selection_applies_modifier_to_target_bank_without_switch
     synth::Parameter* randomModDepth = randomModTarget.ModulationDepthParameter(0);
     REQUIRE_TRUE(slot.SelectedBank() == &selectedBank);
     REQUIRE_TRUE(resetDepth != nullptr);
     REQUIRE_TRUE(randomDepth != nullptr);
     REQUIRE_TRUE(randomModDepth != nullptr);
     REQUIRE_NEAR(resetDepth->SceneCenter(0), 1.0f, 0.0001f);
     REQUIRE_NEAR(randomDepth->SceneCenter(0), 0.75f, 0.0001f);
     REQUIRE_NEAR(randomModDepth->SceneCenter(0), 0.5f, 0.0001f);
 }

+TEST_CASE(reset_modifier_collects_each_affected_group_once_after_resetting_the_bank) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({
+        .numVoices = 1,
+        .numModulators = 1,
+        .numScenes = 1,
+        .maxParameters = 6,
+    });
+    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.1f});
+    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.2f});
+    auto& third = manager.CreateParameter(group, {.name = "Third", .defaultValue = 0.3f});
+    first.SceneCenter(0) = 0.9f;
+    second.SceneCenter(0) = 0.8f;
+    third.SceneCenter(0) = 0.7f;
+
+    auto& bank = manager.CreateBank();
+    bank.AddMapping(10, first);
+    bank.AddMapping(11, second);
+    bank.AddMapping(12, third);
+    synth::ParameterProcessingObserver work{};
+    group.SetProcessingObserverForTests(&work);
+
+    bank.ApplyModifierToTopLevel(synth::Modifier::Reset, manager.Scene());
+
+    REQUIRE_NEAR(first.SceneCenter(0), 0.1f, 0.000001f);
+    REQUIRE_NEAR(second.SceneCenter(0), 0.2f, 0.000001f);
+    REQUIRE_NEAR(third.SceneCenter(0), 0.3f, 0.000001f);
+    REQUIRE_TRUE(work.neutralCollectionPasses == 1);
+}
+
 TEST_CASE(message_bus_param_inc_dec_ignores_ticks_while_any_modifier_is_active) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
     auto& parameter = manager.CreateParameter(group, {.name = "Stable", .defaultValue = 0.25f});
     auto& bank = manager.CreateBank();
     bank.AddMapping(10, parameter);
     auto& slot = manager.CreateBankSlot();
     slot.AddPhysicalEncoder(10);
     slot.SelectBank(&bank);
     synth::MessageInBus bus(&manager, 8);
@@ -4036,20 +4246,62 @@ TEST_CASE(message_bus_set_reset_and_set_gesture_select_are_idempotent) {
     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetReset(0, true)));
     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetReset(0, true)));
     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, true)));
     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, false)));
     bus.Process(0);

     REQUIRE_TRUE(manager.ResetHeld());
     REQUIRE_TRUE(!manager.GestureSelected(1));
 }

+TEST_CASE(message_bus_and_patch_round_trip_gesture_indices_32_and_63) {
+    synth::ParameterManager source;
+    REQUIRE_TRUE(source.SetGestureCount(64));
+    auto& sourceGroup = source.CreateGroup({
+        .numVoices = 1,
+        .numScenes = 1,
+        .maxParameters = 1,
+        .targetCenterAlpha = 1.0f,
+    });
+    auto& sourceParameter = source.CreateParameter(sourceGroup, {.name = "High gestures", .defaultValue = 0.25f});
+    synth::MessageInBus bus(&source, 8);
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 32, true)));
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 63, true)));
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(0, 32, 0.4f)));
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(0, 63, 0.8f)));
+    bus.Process(0);
+    REQUIRE_TRUE(source.GestureSelected(32));
+    REQUIRE_TRUE(source.GestureSelected(63));
+
+    sourceParameter.GestureValue(0, 32) = 0.45f;
+    sourceParameter.GestureValue(0, 63) = 0.85f;
+    sourceParameter.SetGestureActive(0, 32, true);
+    sourceParameter.SetGestureActive(0, 63, true);
+
+    synth::JsonArena arena(65536);
+    const synth::JSON saved = source.ParameterValuesToJSON(arena);
+    synth::ParameterManager target;
+    REQUIRE_TRUE(target.SetGestureCount(64));
+    auto& targetGroup = target.CreateGroup({
+        .numVoices = 1,
+        .numScenes = 1,
+        .maxParameters = 1,
+        .targetCenterAlpha = 1.0f,
+    });
+    auto& targetParameter = target.CreateParameter(targetGroup, {.name = "High gestures", .defaultValue = 0.25f});
+    REQUIRE_TRUE(target.LoadParameterValuesFromJSON(saved));
+    REQUIRE_NEAR(targetParameter.GestureValue(0, 32), 0.45f, 0.000001f);
+    REQUIRE_NEAR(targetParameter.GestureValue(0, 63), 0.85f, 0.000001f);
+    REQUIRE_TRUE(targetParameter.GestureActive(0, 32));
+    REQUIRE_TRUE(targetParameter.GestureActive(0, 63));
+}
+
 TEST_CASE(manager_tracks_reset_random_and_random_mod_precedence) {
     synth::ParameterManager manager;
     REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::None);

     manager.SetResetHeld(true);
     REQUIRE_TRUE(manager.ResetHeld());
     REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::Reset);

     manager.SetRandomHeld(true);
     REQUIRE_TRUE(manager.RandomHeld());
@@ -4113,30 +4365,31 @@ TEST_CASE(manager_random_source_hooks_are_deterministic_and_bounded) {
     REQUIRE_NEAR(manager.NextRandomValue(), 0.4f, 0.0001f);
     REQUIRE_NEAR(manager.NextRandomCoin(), 0.8f, 0.0001f);
     REQUIRE_NEAR(manager.NextRandomCoin(), 0.2f, 0.0001f);
     REQUIRE_TRUE(manager.NextRandomIndex(5) == 2);
     REQUIRE_TRUE(manager.NextRandomIndex(5) == 2);
     REQUIRE_TRUE(manager.NextRandomIndex(0) == 0);
 }

 TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting) {
     synth::ParameterManager manager;
-    manager.SetGestureCount(4);
+    manager.SetGestureCount(64);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numScenes = 2,
         .maxParameters = 4,
     });
     auto& affected = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.25f});
     auto& unaffected = manager.CreateParameter(group, {.name = "B", .defaultValue = 0.5f});
     auto& drillHidden = manager.CreateParameter(group, {.name = "C", .defaultValue = 0.75f});
     affected.SetGestureActive(0, 0, true);
+    affected.SetGestureActive(0, 63, true);
     unaffected.SetGestureActive(0, 1, true);
     drillHidden.SetGestureActive(0, 2, true);

     auto& bankA = manager.CreateBank();
     bankA.SetBankColor(synth::Color::Green);
     bankA.AddMapping(10, affected);
     bankA.AddMapping(13, drillHidden);
     auto& bankB = manager.CreateBank();
     bankB.SetBankColor(synth::Color::Blue);
     bankB.AddMapping(11, unaffected);
@@ -4145,21 +4398,21 @@ TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting)
     bankC.AddMapping(12, affected);

     auto& slot = manager.CreateBankSlot();
     slot.AddPhysicalEncoder(10);
     slot.AddPhysicalEncoder(13);
     slot.SelectBank(&bankA);
     manager.HandlePress(0, 0);
     REQUIRE_TRUE(bankA.ShowingModulation());

     synth::ParameterManager::UIState ui;
-    ui.Configure(1, 2, 1, 0, 4, 4);
+    ui.Configure(1, 2, 1, 0, 64, 4);
     manager.PopulateUIState(ui);

     REQUIRE_TRUE(ui.bankCapacity == 4);
     REQUIRE_TRUE(ui.banks[0].connected.load());
     REQUIRE_TRUE(ui.banks[0].selected.load());
     REQUIRE_TRUE(ui.banks[0].bankColor.Load() == synth::Color::Green);
     REQUIRE_TRUE(ui.banks[1].connected.load());
     REQUIRE_TRUE(!ui.banks[1].selected.load());
     REQUIRE_TRUE(ui.banks[1].bankColor.Load() == synth::Color::Blue);
     REQUIRE_TRUE(ui.banks[2].connected.load());
@@ -4169,20 +4422,22 @@ TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting)
     REQUIRE_TRUE(!ui.banks[3].selected.load());
     REQUIRE_TRUE(ui.banks[3].bankColor.Load() == synth::Color::Off);
     REQUIRE_TRUE(ui.gestures.bankAffectingCount[0].load() == 2);
     REQUIRE_TRUE(ui.gestures.bankAffectingMask[0].load() == ((1u << 0u) | (1u << 2u)));
     REQUIRE_TRUE(ui.gestures.bankAffectingCount[1].load() == 1);
     REQUIRE_TRUE(ui.gestures.bankAffectingMask[1].load() == (1u << 1u));
     REQUIRE_TRUE(ui.gestures.bankAffectingCount[2].load() == 1);
     REQUIRE_TRUE(ui.gestures.bankAffectingMask[2].load() == (1u << 0u));
     REQUIRE_TRUE(ui.gestures.bankAffectingCount[3].load() == 0);
     REQUIRE_TRUE(ui.gestures.bankAffectingMask[3].load() == 0);
+    REQUIRE_TRUE(ui.gestures.bankAffectingCount[63].load() == 2);
+    REQUIRE_TRUE(ui.gestures.bankAffectingMask[63].load() == ((1u << 0u) | (1u << 2u)));
 }

 TEST_CASE(message_bus_routes_modulation_target_position_to_visible_parameter) {
     synth::ParameterManager manager;
     manager.SetGestureCount(1);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
@@ -5950,72 +6205,87 @@ TEST_CASE(clear_gesture_active_flags_for_active_scene_selection) {
     REQUIRE_TRUE(first.GestureActive(2, 0));
     REQUIRE_TRUE(!second.GestureActive(0, 0));
     REQUIRE_TRUE(!second.GestureActive(1, 0));
 }

 namespace {

 constexpr std::size_t kSimParams = 3;
 constexpr std::size_t kSimVoices = 4;
 constexpr std::size_t kSimMods = 3;
-constexpr std::size_t kSimGestures = 2;
+constexpr std::size_t kSimGestures = 64;
 constexpr std::size_t kSimScenes = 3;
 constexpr std::array<synth::PhysicalEncoderId, 5> kSimSlotEncoders{10, 11, 12, 20, 21};

 struct SimCell {
     synth::PhysicalEncoderId encoder = 0;
     int parameter = -1;
 };

 struct SimBank {
     std::vector<SimCell> top;
     std::vector<SimCell> visible;
     int selectedParameter = -1;
 };

 struct SimParam {
     synth::RangeKind range = synth::RangeKind::Unipolar;
     float defaultValue = 0.0f;
     std::size_t switchValues = 0;
     std::array<float, kSimScenes> sceneCenter{};
     std::array<std::array<float, kSimGestures>, kSimScenes> gestureValue{};
-    std::array<std::array<bool, kSimGestures>, kSimScenes> gestureActive{};
+    std::array<synth::GestureMask, kSimScenes> gestureActiveMasks{};
     std::array<int, kSimMods> route{};
+    std::array<std::size_t, kSimMods> routeSourceIndices{};
+    std::array<std::size_t, kSimMods> sourceRoutePositions{};
+    std::size_t activeRouteCount = 0;
     float currentCenter = 0.0f;
     float targetCenter = 0.0f;
     std::array<float, kSimVoices> currentCenterScale{};
     std::array<float, kSimVoices> targetCenterScale{};
     std::array<float, kSimVoices> currentNormalizationOffset{};
     std::array<float, kSimVoices> targetNormalizationOffset{};
     std::array<float, kSimVoices> currentMinValue{};
     std::array<float, kSimVoices> targetMinValue{};
     std::array<float, kSimVoices> currentMaxValue{};
     std::array<float, kSimVoices> targetMaxValue{};
     std::array<std::array<float, kSimMods>, kSimVoices> currentDepth{};
     std::array<std::array<float, kSimMods>, kSimVoices> targetDepth{};
     std::array<float, kSimVoices> cachedKnob{};
     std::array<float, kSimVoices> uiDisplayCenter{};
     std::array<float, kSimVoices> uiDisplaySpreadEnergy{};
 };

+struct SimLocalSlot {
+    std::size_t storageIdentity = 0;
+    int parentParameter = -1;
+    std::size_t sourceIx = 0;
+    bool live = false;
+    bool free = false;
+    bool pinned = false;
+};
+
 struct SimOracle {
     synth::SceneState scene{.leftScene = 0, .rightScene = 1, .blend = 0.25f};
     std::optional<synth::PageOrdinal> activePage = 0;
     int selectedBank = 0;
     bool resetHeld = false;
     bool randomHeld = false;
     bool randomModHeld = false;
     std::array<SimBank, 2> banks;
     std::array<float, kSimGestures> gestureWeight{};
-    std::array<bool, kSimGestures> gestureSelected{};
+    synth::GestureMask gestureSelectedMask = 0;
     std::array<std::array<float, kSimMods>, kSimVoices> modulatorValue{};
     std::array<SimParam, kSimParams> params;
+    std::array<SimLocalSlot, kSimMods> localSlots{};
+    std::size_t liveLocalCount = 0;
+    std::size_t freeLocalCount = 0;
 };

 struct SimRandomSamples {
     std::vector<float> values;
     std::vector<float> coins;
     std::vector<std::size_t> indices;
     std::size_t valueIx = 0;
     std::size_t coinIx = 0;
     std::size_t indexIx = 0;

@@ -6052,22 +6322,103 @@ struct SimRandomSamples {
     void RequireDrained(unsigned seed, int step, const std::string& action) const {
         if (valueIx != values.size() || coinIx != coins.size() || indexIx != indices.size()) {
             std::ostringstream oss;
             oss << "seed " << seed << " step " << step << " action " << action
                 << " random samples not fully consumed values=" << valueIx << "/" << values.size()
                 << " coins=" << coinIx << "/" << coins.size()
                 << " indices=" << indexIx << "/" << indices.size();
             throw std::runtime_error(oss.str());
         }
     }
+
+    std::string ConsumptionSummary() const {
+        std::ostringstream oss;
+        oss << "values=" << valueIx << "/" << values.size()
+            << ",coins=" << coinIx << "/" << coins.size()
+            << ",indices=" << indexIx << "/" << indices.size();
+        return oss.str();
+    }
 };

+bool SimGestureActive(const SimParam& parameter, std::size_t sceneIx, std::size_t gestureIx) {
+    return (parameter.gestureActiveMasks[sceneIx] & (synth::GestureMask{1} << gestureIx)) != 0;
+}
+
+void SimSetGestureActive(SimParam& parameter, std::size_t sceneIx, std::size_t gestureIx, bool active) {
+    const synth::GestureMask bit = synth::GestureMask{1} << gestureIx;
+    if (active) {
+        parameter.gestureActiveMasks[sceneIx] |= bit;
+    } else {
+        parameter.gestureActiveMasks[sceneIx] &= ~bit;
+    }
+}
+
+bool SimGestureSelected(const SimOracle& oracle, std::size_t gestureIx) {
+    return (oracle.gestureSelectedMask & (synth::GestureMask{1} << gestureIx)) != 0;
+}
+
+void SimSetGestureSelected(SimOracle& oracle, std::size_t gestureIx, bool selected) {
+    const synth::GestureMask bit = synth::GestureMask{1} << gestureIx;
+    if (selected) {
+        oracle.gestureSelectedMask |= bit;
+    } else {
+        oracle.gestureSelectedMask &= ~bit;
+    }
+}
+
+void SimEnsureRouteActive(SimParam& parameter, std::size_t sourceIx) {
+    const std::size_t routeSlot = parameter.sourceRoutePositions[sourceIx];
+    if (routeSlot < parameter.activeRouteCount) {
+        return;
+    }
+    const std::size_t destination = parameter.activeRouteCount;
+    if (routeSlot != destination) {
+        const std::size_t displacedSource = parameter.routeSourceIndices[destination];
+        std::swap(parameter.routeSourceIndices[routeSlot], parameter.routeSourceIndices[destination]);
+        parameter.sourceRoutePositions[sourceIx] = destination;
+        parameter.sourceRoutePositions[displacedSource] = routeSlot;
+    }
+    ++parameter.activeRouteCount;
+}
+
+void SimRemoveActiveRoute(SimParam& parameter, std::size_t routeSlot) {
+    const std::size_t lastActive = parameter.activeRouteCount - 1;
+    if (routeSlot != lastActive) {
+        const std::size_t removedSource = parameter.routeSourceIndices[routeSlot];
+        const std::size_t movedSource = parameter.routeSourceIndices[lastActive];
+        std::swap(parameter.routeSourceIndices[routeSlot], parameter.routeSourceIndices[lastActive]);
+        parameter.sourceRoutePositions[movedSource] = routeSlot;
+        parameter.sourceRoutePositions[removedSource] = lastActive;
+    }
+    --parameter.activeRouteCount;
+}
+
+bool SimRouteNeutralAcrossVoices(const SimParam& parameter, std::size_t sourceIx) {
+    constexpr float tolerance = 0.000001f;
+    for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+        if (std::fabs(parameter.currentDepth[voiceIx][sourceIx]) > tolerance ||
+            std::fabs(parameter.targetDepth[voiceIx][sourceIx]) > tolerance) {
+            return false;
+        }
+    }
+    return true;
+}
+
+void SimPruneNeutralActiveRoutes(SimParam& parameter) {
+    for (std::size_t routeSlot = parameter.activeRouteCount; routeSlot-- > 0;) {
+        const std::size_t sourceIx = parameter.routeSourceIndices[routeSlot];
+        if (SimRouteNeutralAcrossVoices(parameter, sourceIx)) {
+            SimRemoveActiveRoute(parameter, routeSlot);
+        }
+    }
+}
+
 synth::Modifier SimCurrentModifier(const SimOracle& oracle) {
     if (oracle.randomModHeld) {
         return synth::Modifier::RandomMod;
     }
     if (oracle.randomHeld) {
         return synth::Modifier::Random;
     }
     if (oracle.resetHeld) {
         return synth::Modifier::Reset;
     }
@@ -6165,24 +6516,26 @@ const SimCell* SimFindCell(const SimBank& bank, synth::PhysicalEncoderId encoder
         if (cell.encoder == encoder) {
             return &cell;
         }
     }
     return nullptr;
 }

 float SimEffectiveGestureWeight(const SimOracle& oracle, const SimParam& parameter, std::size_t gestureIx) {
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     const float leftWeight =
-        parameter.gestureActive[oracle.scene.leftScene][gestureIx] ? oracle.gestureWeight[gestureIx] * (1.0f - blend)
-                                                                   : 0.0f;
+        SimGestureActive(parameter, oracle.scene.leftScene, gestureIx)
+            ? oracle.gestureWeight[gestureIx] * (1.0f - blend)
+            : 0.0f;
     const float rightWeight =
-        parameter.gestureActive[oracle.scene.rightScene][gestureIx] ? oracle.gestureWeight[gestureIx] * blend : 0.0f;
+        SimGestureActive(parameter, oracle.scene.rightScene, gestureIx) ? oracle.gestureWeight[gestureIx] * blend
+                                                                        : 0.0f;
     return leftWeight + rightWeight;
 }

 float SimRawCenter(const SimOracle& oracle, const SimParam& parameter) {
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     const float inverseBlend = 1.0f - blend;
     const float base =
         parameter.sceneCenter[oracle.scene.leftScene] * inverseBlend + parameter.sceneCenter[oracle.scene.rightScene] * blend;

     float weightedMixSum = 0.0f;
@@ -6238,25 +6591,23 @@ bool SimHasNonNeutralDepthState(const SimOracle& oracle, const SimParam& paramet
     constexpr float neutralDepthCenter = 0.5f;
     if (std::fabs(parameter.currentCenter - neutralDepthCenter) > tolerance ||
         std::fabs(parameter.targetCenter - neutralDepthCenter) > tolerance) {
         return true;
     }
     for (const float center : parameter.sceneCenter) {
         if (std::fabs(center - neutralDepthCenter) > tolerance) {
             return true;
         }
     }
-    for (const auto& row : parameter.gestureActive) {
-        for (const bool active : row) {
-            if (active) {
-                return true;
-            }
+    for (const synth::GestureMask mask : parameter.gestureActiveMasks) {
+        if (mask != 0) {
+            return true;
         }
     }
     for (const auto& row : parameter.currentDepth) {
         for (const float depth : row) {
             if (std::fabs(depth) > tolerance) {
                 return true;
             }
         }
     }
     for (const auto& row : parameter.targetDepth) {
@@ -6278,52 +6629,79 @@ std::uint32_t SimModulatorsAffectingMask(const SimOracle& oracle, const SimParam
     std::uint32_t mask = 0;
     for (std::size_t modIx = 0; modIx < std::min<std::size_t>(kSimMods, 32); ++modIx) {
         const int route = parameter.route[modIx];
         if (route >= 0 && SimHasNonNeutralDepthState(oracle, oracle.params[static_cast<std::size_t>(route)])) {
             mask |= (std::uint32_t{1} << modIx);
         }
     }
     return mask;
 }

-std::uint32_t SimGesturesAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
-    std::uint32_t mask = 0;
+synth::GestureMask SimGesturesAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
+    synth::GestureMask mask = 0;
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
-    for (std::size_t gestureIx = 0; gestureIx < std::min<std::size_t>(kSimGestures, 32); ++gestureIx) {
+    for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
         bool active = false;
         if (blend <= 0.0f) {
-            active = parameter.gestureActive[oracle.scene.leftScene][gestureIx];
+            active = SimGestureActive(parameter, oracle.scene.leftScene, gestureIx);
         } else if (blend >= 1.0f) {
-            active = parameter.gestureActive[oracle.scene.rightScene][gestureIx];
+            active = SimGestureActive(parameter, oracle.scene.rightScene, gestureIx);
         } else {
-            active = parameter.gestureActive[oracle.scene.leftScene][gestureIx] ||
-                     parameter.gestureActive[oracle.scene.rightScene][gestureIx];
+            active = SimGestureActive(parameter, oracle.scene.leftScene, gestureIx) ||
+                     SimGestureActive(parameter, oracle.scene.rightScene, gestureIx);
         }
         if (active) {
-            mask |= (std::uint32_t{1} << gestureIx);
+            mask |= (synth::GestureMask{1} << gestureIx);
         }
     }
     return mask;
 }

 void SimSeedDisplayState(SimOracle& oracle, std::size_t paramIx);

 void SimComputeAtDepth(SimOracle& oracle, std::size_t paramIx, std::size_t recursionDepth) {
     SimParam& parameter = oracle.params[paramIx];
     parameter.targetCenter = SimClamp(SimRawCenter(oracle, parameter), parameter.range);

     for (const int route : parameter.route) {
         if (route >= 0) {
             SimComputeAtDepth(oracle, static_cast<std::size_t>(route), recursionDepth + 1);
         }
     }

+    constexpr float neutralTolerance = 0.000001f;
+    for (std::size_t sourceIx = 0; sourceIx < kSimMods; ++sourceIx) {
+        const int route = parameter.route[sourceIx];
+        bool targetNonNeutral = false;
+        if (route >= 0) {
+            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+                if (std::fabs(synth::ModulationDepthTargetFromKnob(
+                                  SimGetRaw(oracle, static_cast<std::size_t>(route), voiceIx))) > neutralTolerance) {
+                    targetNonNeutral = true;
+                    break;
+                }
+            }
+        }
+        bool currentNonNeutral = false;
+        if (parameter.sourceRoutePositions[sourceIx] < parameter.activeRouteCount) {
+            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+                if (std::fabs(parameter.currentDepth[voiceIx][sourceIx]) > neutralTolerance) {
+                    currentNonNeutral = true;
+                    break;
+                }
+            }
+        }
+        if (targetNonNeutral || currentNonNeutral) {
+            SimEnsureRouteActive(parameter, sourceIx);
+        }
+    }
+
     for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
         float weightSum = 0.0f;
         for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
             const int route = parameter.route[modIx];
             const float depth =
                 route < 0 ? 0.0f
                           : synth::ModulationDepthTargetFromKnob(
                                 SimGetRaw(oracle, static_cast<std::size_t>(route), voiceIx));
             parameter.targetDepth[voiceIx][modIx] = depth;
             weightSum += std::fabs(depth);
@@ -6363,20 +6741,21 @@ void SimComputeAtDepth(SimOracle& oracle, std::size_t paramIx, std::size_t recur

     if (recursionDepth > 0) {
         parameter.currentCenter = parameter.targetCenter;
         parameter.currentCenterScale = parameter.targetCenterScale;
         parameter.currentNormalizationOffset = parameter.targetNormalizationOffset;
         parameter.currentMinValue = parameter.targetMinValue;
         parameter.currentMaxValue = parameter.targetMaxValue;
         parameter.currentDepth = parameter.targetDepth;
         SimSeedDisplayState(oracle, paramIx);
     }
+    SimPruneNeutralActiveRoutes(parameter);
 }

 void SimComputeAll(SimOracle& oracle) {
     for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
         SimComputeAtDepth(oracle, paramIx, 0);
     }
 }

 std::size_t SimParamIndex(const SimOracle& oracle, const SimParam& parameter) {
     const SimParam* begin = oracle.params.data();
@@ -6400,20 +6779,21 @@ void SimSeedDisplayState(SimOracle& oracle, SimParam& parameter) {
     SimSeedDisplayState(oracle, SimParamIndex(oracle, parameter));
 }

 void SimSnapParameterToTarget(SimOracle& oracle, SimParam& parameter) {
     parameter.currentCenter = parameter.targetCenter;
     parameter.currentCenterScale = parameter.targetCenterScale;
     parameter.currentNormalizationOffset = parameter.targetNormalizationOffset;
     parameter.currentMinValue = parameter.targetMinValue;
     parameter.currentMaxValue = parameter.targetMaxValue;
     parameter.currentDepth = parameter.targetDepth;
+    SimPruneNeutralActiveRoutes(parameter);
     SimSeedDisplayState(oracle, parameter);
     for (const int route : parameter.route) {
         if (route >= 0) {
             SimSnapParameterToTarget(oracle, oracle.params[static_cast<std::size_t>(route)]);
         }
     }
 }

 void SimProcessLiteAll(SimOracle& oracle) {
     constexpr float alpha = 0.25f;
@@ -6468,31 +6848,31 @@ void SimOpenModulationView(SimOracle& oracle, SimBank& bank, int paramIx) {
     }
     bank.visible.push_back({
         .encoder = kSimSlotEncoders.back(),
         .parameter = paramIx,
     });
 }

 void SimHandleIncDec(SimOracle& oracle, SimParam& parameter, float delta) {
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     auto armSelectedGesture = [&](std::size_t sceneIx, std::size_t gestureIx) {
-        if (parameter.gestureActive[sceneIx][gestureIx]) {
+        if (SimGestureActive(parameter, sceneIx, gestureIx)) {
             return false;
         }
         parameter.gestureValue[sceneIx][gestureIx] = parameter.sceneCenter[sceneIx];
-        parameter.gestureActive[sceneIx][gestureIx] = true;
+        SimSetGestureActive(parameter, sceneIx, gestureIx, true);
         return true;
     };

     bool armedGesture = false;
     for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
-        if (!oracle.gestureSelected[gestureIx]) {
+        if (!SimGestureSelected(oracle, gestureIx)) {
             continue;
         }
         if (blend <= 0.0f) {
             armedGesture = armSelectedGesture(oracle.scene.leftScene, gestureIx) || armedGesture;
         } else if (blend >= 1.0f) {
             armedGesture = armSelectedGesture(oracle.scene.rightScene, gestureIx) || armedGesture;
         } else {
             armedGesture = armSelectedGesture(oracle.scene.leftScene, gestureIx) || armedGesture;
             if (oracle.scene.rightScene != oracle.scene.leftScene) {
                 armedGesture = armSelectedGesture(oracle.scene.rightScene, gestureIx) || armedGesture;
@@ -6584,25 +6964,26 @@ void SimResetDepthToNeutral(SimOracle& oracle, SimParam& parameter) {
             SimResetDepthToNeutral(oracle, oracle.params[static_cast<std::size_t>(route)]);
         }
     }

     for (auto& row : parameter.currentDepth) {
         row.fill(0.0f);
     }
     for (auto& row : parameter.targetDepth) {
         row.fill(0.0f);
     }
+    parameter.activeRouteCount = 0;

     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     auto resetScene = [&](std::size_t sceneIx) {
         parameter.sceneCenter[sceneIx] = 0.5f;
-        parameter.gestureActive[sceneIx].fill(false);
+        parameter.gestureActiveMasks[sceneIx] = 0;
     };

     if (blend <= 0.0f) {
         resetScene(oracle.scene.leftScene);
     } else if (blend >= 1.0f) {
         resetScene(oracle.scene.rightScene);
     } else {
         resetScene(oracle.scene.leftScene);
         if (oracle.scene.rightScene != oracle.scene.leftScene) {
             resetScene(oracle.scene.rightScene);
@@ -6628,26 +7009,27 @@ void SimRevertToDefault(SimOracle& oracle, SimParam& parameter) {
             SimResetDepthToNeutral(oracle, oracle.params[static_cast<std::size_t>(route)]);
         }
     }

     for (auto& row : parameter.currentDepth) {
         row.fill(0.0f);
     }
     for (auto& row : parameter.targetDepth) {
         row.fill(0.0f);
     }
+    parameter.activeRouteCount = 0;

     const float defaultValue = SimClamp(parameter.defaultValue, parameter.range);
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     auto resetScene = [&](std::size_t sceneIx) {
         parameter.sceneCenter[sceneIx] = defaultValue;
-        parameter.gestureActive[sceneIx].fill(false);
+        parameter.gestureActiveMasks[sceneIx] = 0;
     };

     if (blend <= 0.0f) {
         resetScene(oracle.scene.leftScene);
     } else if (blend >= 1.0f) {
         resetScene(oracle.scene.rightScene);
     } else {
         resetScene(oracle.scene.leftScene);
         if (oracle.scene.rightScene != oracle.scene.leftScene) {
             resetScene(oracle.scene.rightScene);
@@ -6841,24 +7223,24 @@ void SimCheck(const SimOracle& oracle, const std::array<synth::Parameter*, kSimP
     if (manager.RandomHeld() != oracle.randomHeld) {
         SimFailBool(seed, step, action, "manager random held");
     }
     if (manager.RandomModHeld() != oracle.randomModHeld) {
         SimFailBool(seed, step, action, "manager random-mod held");
     }
     if (manager.GetCurrentModifier() != SimCurrentModifier(oracle)) {
         SimFailBool(seed, step, action, "manager current modifier");
     }
     for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
-        if (group.GestureSelected(gestureIx) != oracle.gestureSelected[gestureIx]) {
+        if (group.GestureSelected(gestureIx) != SimGestureSelected(oracle, gestureIx)) {
             std::ostringstream oss;
             oss << "seed " << seed << " step " << step << " action " << action << " group gestureIx=" << gestureIx
-                << " selected expected " << oracle.gestureSelected[gestureIx] << " got "
+                << " selected expected " << SimGestureSelected(oracle, gestureIx) << " got "
                 << group.GestureSelected(gestureIx);
             throw std::runtime_error(oss.str());
         }
         SimCheckNear(seed, step, action, "group gestureIx=" + std::to_string(gestureIx) + " weight",
                      oracle.gestureWeight[gestureIx], manager.GestureValue(gestureIx));
     }
     if (slot.SelectedBank() != banks[static_cast<std::size_t>(oracle.selectedBank)]) {
         SimFailBool(seed, step, action, "slot selectedBank=" + std::to_string(oracle.selectedBank));
     }

@@ -6868,59 +7250,84 @@ void SimCheck(const SimOracle& oracle, const std::array<synth::Parameter*, kSimP
         for (std::size_t sceneIx = 0; sceneIx < kSimScenes; ++sceneIx) {
             SimCheckNear(seed, step, action,
                          SimParamField(actual, paramIx, "sceneIx=" + std::to_string(sceneIx) + " center"),
                          expected.sceneCenter[sceneIx], actual.SceneCenter(sceneIx));
             for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
                 const std::string gestureField = "sceneIx=" + std::to_string(sceneIx) +
                                                  " gestureIx=" + std::to_string(gestureIx);
                 SimCheckNear(seed, step, action, SimParamField(actual, paramIx, gestureField + " value"),
                              expected.gestureValue[sceneIx][gestureIx],
                              actual.GestureValue(sceneIx, gestureIx));
-                if (expected.gestureActive[sceneIx][gestureIx] != actual.GestureActive(sceneIx, gestureIx)) {
+                if (SimGestureActive(expected, sceneIx, gestureIx) != actual.GestureActive(sceneIx, gestureIx)) {
                     SimFailBool(seed, step, action, SimParamField(actual, paramIx, gestureField + " active"));
                 }
             }
         }
         for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
             const int route = expected.route[modIx];
             const synth::Parameter* expectedRoute = route < 0 ? nullptr : params[static_cast<std::size_t>(route)];
             if (actual.ModulationDepthParameter(modIx) != expectedRoute) {
                 SimFailBool(seed, step, action,
                             SimParamField(actual, paramIx, "modIx=" + std::to_string(modIx) + " route"));
             }
         }
         SimCheckNear(seed, step, action, SimParamField(actual, paramIx, "target center"), expected.targetCenter,
                      actual.TargetCenter());
         SimCheckNear(seed, step, action, SimParamField(actual, paramIx, "current center"), expected.currentCenter,
                      actual.CurrentCenter());
+        RequireRouteBijection(actual, kSimMods);
+        if (actual.ActiveRouteCount() != expected.activeRouteCount) {
+            SimFail(seed, step, action, SimParamField(actual, paramIx, "active route count"),
+                    static_cast<float>(expected.activeRouteCount), static_cast<float>(actual.ActiveRouteCount()));
+        }
+        for (std::size_t routeSlot = 0; routeSlot < kSimMods; ++routeSlot) {
+            const std::size_t expectedSourceIx = expected.routeSourceIndices[routeSlot];
+            const std::size_t actualSourceIx = actual.RouteSourceIndex(routeSlot);
+            if (actualSourceIx != expectedSourceIx) {
+                SimFailBool(seed, step, action,
+                            SimParamField(actual, paramIx,
+                                          "routeSlot=" + std::to_string(routeSlot) +
+                                              " expected stable source=" + std::to_string(expectedSourceIx) +
+                                              " actual stable source=" + std::to_string(actualSourceIx)));
+            }
+            const std::size_t actualRouteSlot = actual.RoutePositionForSource(expectedSourceIx);
+            if (actualRouteSlot != expected.sourceRoutePositions[expectedSourceIx]) {
+                SimFailBool(seed, step, action,
+                            SimParamField(actual, paramIx,
+                                          "stable source=" + std::to_string(expectedSourceIx) +
+                                              " expected route slot=" +
+                                              std::to_string(expected.sourceRoutePositions[expectedSourceIx]) +
+                                              " actual route slot=" + std::to_string(actualRouteSlot)));
+            }
+        }
         for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
             const std::string voiceField = "voiceIx=" + std::to_string(voiceIx);
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " target center scale"),
                          expected.targetCenterScale[voiceIx],
                          actual.TargetCenterScale(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " current center scale"),
                          expected.currentCenterScale[voiceIx],
                          actual.CurrentCenterScale(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " target normalization offset"),
                          expected.targetNormalizationOffset[voiceIx],
                          actual.TargetNormalizationOffset(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " current normalization offset"),
                          expected.currentNormalizationOffset[voiceIx],
                          actual.CurrentNormalizationOffset(voiceIx));
             for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
                 const std::string modField = voiceField + " modIx=" + std::to_string(modIx);
                 SimCheckNear(seed, step, action, SimParamField(actual, paramIx, modField + " target depth"),
                              expected.targetDepth[voiceIx][modIx],
-                             actual.TargetDepths(voiceIx)[modIx]);
+                             actual.TargetDepthForSource(voiceIx, modIx));
                 SimCheckNear(seed, step, action, SimParamField(actual, paramIx, modField + " current depth"),
                              expected.currentDepth[voiceIx][modIx],
-                             actual.CurrentDepths(voiceIx)[modIx]);
+                             actual.CurrentDepthForSource(voiceIx, modIx));
             }
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " raw"),
                          SimGetRaw(oracle, paramIx, voiceIx), actual.GetRaw(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " cached knob"),
                          expected.cachedKnob[voiceIx], actual.CachedKnobValue(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " ui display center"),
                          expected.uiDisplayCenter[voiceIx], actual.UIDisplayCenter(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " ui display spread"),
                          std::sqrt(std::max(0.0f, expected.uiDisplaySpreadEnergy[voiceIx])),
                          actual.UIDisplaySpread(voiceIx));
@@ -6961,20 +7368,30 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
         SimFailBool(seed, step, action, "ui reset held");
     }
     if (ui.randomHeld.load(std::memory_order_relaxed) != oracle.randomHeld) {
         SimFailBool(seed, step, action, "ui random held");
     }
     if (ui.randomModHeld.load(std::memory_order_relaxed) != oracle.randomModHeld) {
         SimFailBool(seed, step, action, "ui random-mod held");
     }

     const SimBank& bank = oracle.banks[static_cast<std::size_t>(oracle.selectedBank)];
+    if (!ui.slots[0].connected.load() ||
+        ui.slots[0].showingModulationView.load() != (bank.selectedParameter >= 0)) {
+        SimFailBool(seed, step, action, "ui selected bank/view state");
+    }
+    for (std::size_t bankIx = 0; bankIx < ui.bankCapacity; ++bankIx) {
+        if (!ui.banks[bankIx].connected.load() ||
+            ui.banks[bankIx].selected.load() != (bankIx == static_cast<std::size_t>(oracle.selectedBank))) {
+            SimFailBool(seed, step, action, "ui bankIx=" + std::to_string(bankIx) + " selected state");
+        }
+    }
     const std::array<synth::Color, 4> defaultIndicators{
         synth::Color::Grey, synth::Color::Grey, synth::Color::Grey, synth::Color::Grey};
     for (std::size_t position = 0; position < kSimSlotEncoders.size(); ++position) {
         const SimCell* cell = SimFindCell(bank, kSimSlotEncoders[position]);
         const synth::Parameter::UIState& actual = ui.slots[0].cells[position];
         const bool expectedConnected = cell != nullptr && cell->parameter >= 0;
         if (actual.connected.load() != expectedConnected) {
             SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " connected");
         }
         if (!expectedConnected) {
@@ -6987,30 +7404,47 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
             const std::size_t paramIx = static_cast<std::size_t>(cell->parameter);
             const SimParam& expected = oracle.params[paramIx];
             if (actual.bipolar.load() != (expected.range == synth::RangeKind::Bipolar)) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " bipolar");
             }
             if (actual.baseColor.Load() != synth::Color::Grey) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " color");
             }
             const std::size_t expectedSwitchValues = expected.switchValues;
             const std::uint32_t expectedModulatorMask = SimModulatorsAffectingMask(oracle, expected);
-            const std::uint32_t expectedGestureMask = SimGesturesAffectingMask(oracle, expected);
+            const synth::GestureMask expectedGestureMask = SimGesturesAffectingMask(oracle, expected);
             if (actual.switchValues.load() != expectedSwitchValues) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " switch values");
             }
             if (actual.modulatorsAffectingMask.load() != expectedModulatorMask) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " modulator mask");
             }
             if (actual.gesturesAffectingMask.load() != expectedGestureMask) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " gesture mask");
             }
+            if (actual.modulatorColorCount.load() != kSimMods || actual.gestureColorCount.load() != kSimGestures) {
+                SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " color counts");
+            }
+            for (std::size_t sourceIx = 0; sourceIx < kSimMods; ++sourceIx) {
+                if (actual.modulatorSourceColors[sourceIx].Load() != synth::Color::Off) {
+                    SimFailBool(seed, step, action,
+                                "ui position=" + std::to_string(position) +
+                                    " source color=" + std::to_string(sourceIx));
+                }
+            }
+            for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
+                if (actual.gestureColors[gestureIx].Load() != synth::Color::Off) {
+                    SimFailBool(seed, step, action,
+                                "ui position=" + std::to_string(position) +
+                                    " gesture color=" + std::to_string(gestureIx));
+                }
+            }
             for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
                 SimCheckNear(seed, step, action,
                              "ui position=" + std::to_string(position) + " voice=" + std::to_string(voiceIx),
                              SimToUIPresentation(expected.uiDisplayCenter[voiceIx], expected.range),
                              actual.values[voiceIx].load());
                 const float expectedSpread = expected.switchValues > 1
                                                  ? 0.0f
                                                  : SimToUISpreadPresentation(
                                                        std::sqrt(std::max(0.0f, expected.uiDisplaySpreadEnergy[voiceIx])),
                                                        expected.range);
@@ -7035,21 +7469,21 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
                     SimFailBool(seed, step, action,
                                 "ui position=" + std::to_string(position) + " indicator=" + std::to_string(voiceIx));
                 }
             }
         }
     }
     if (ui.gestures.gestureCapacity != kSimGestures) {
         SimFailBool(seed, step, action, "ui gesture capacity");
     }
     for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
-        if (ui.gestures.selected[gestureIx].load() != oracle.gestureSelected[gestureIx]) {
+        if (ui.gestures.selected[gestureIx].load() != SimGestureSelected(oracle, gestureIx)) {
             SimFailBool(seed, step, action, "ui gesture selected");
         }
         SimCheckNear(seed, step, action, "ui gesture value", oracle.gestureWeight[gestureIx],
                      ui.gestures.values[gestureIx].load());
     }
 }

 void SimInitializeOracle(SimOracle& oracle) {
     oracle.selectedBank = 0;
     oracle.resetHeld = false;
@@ -7066,24 +7500,27 @@ void SimInitializeOracle(SimOracle& oracle) {
     for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
         SimParam& parameter = oracle.params[paramIx];
         parameter.defaultValue = defaults[paramIx];
         parameter.range = ranges[paramIx];
         parameter.switchValues = switchValues[paramIx];
         const float defaultValue = SimClamp(defaults[paramIx], ranges[paramIx]);
         parameter.sceneCenter.fill(defaultValue);
         for (auto& row : parameter.gestureValue) {
             row.fill(defaultValue);
         }
-        for (auto& row : parameter.gestureActive) {
-            row.fill(false);
-        }
+        parameter.gestureActiveMasks.fill(0);
         parameter.route.fill(-1);
+        for (std::size_t sourceIx = 0; sourceIx < kSimMods; ++sourceIx) {
+            parameter.routeSourceIndices[sourceIx] = sourceIx;
+            parameter.sourceRoutePositions[sourceIx] = sourceIx;
+        }
+        parameter.activeRouteCount = 0;
         parameter.currentCenter = defaultValue;
         parameter.targetCenter = defaultValue;
         parameter.currentCenterScale.fill(1.0f);
         parameter.targetCenterScale.fill(1.0f);
         parameter.currentNormalizationOffset.fill(0.0f);
         parameter.targetNormalizationOffset.fill(0.0f);
         parameter.currentMinValue.fill(defaultValue);
         parameter.targetMinValue.fill(defaultValue);
         parameter.currentMaxValue.fill(defaultValue);
         parameter.targetMaxValue.fill(defaultValue);
@@ -7144,37 +7581,37 @@ struct SimPatchSnapshot {
 SimPatchSnapshot SimCapturePatchSnapshot(const SimOracle& oracle) {
     return {.params = oracle.params};
 }

 void SimApplyPatchSnapshot(SimOracle& oracle, const SimPatchSnapshot& snapshot) {
     for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
         SimParam& target = oracle.params[paramIx];
         const SimParam& saved = snapshot.params[paramIx];
         target.sceneCenter = saved.sceneCenter;
         target.gestureValue = saved.gestureValue;
-        target.gestureActive = saved.gestureActive;
+        target.gestureActiveMasks = saved.gestureActiveMasks;
     }
     SimComputeAllAndSnap(oracle);
 }

 void SimApplyNewPatch(SimOracle& oracle) {
     const auto banks = oracle.banks;
     const int selectedBank = oracle.selectedBank;
     const auto modulatorValue = oracle.modulatorValue;
     SimInitializeOracle(oracle);
     oracle.banks = banks;
     oracle.selectedBank = selectedBank;
     oracle.modulatorValue = modulatorValue;
     oracle.scene = {.leftScene = 0, .rightScene = 1, .blend = 0.25f};
     oracle.activePage = 0;
     oracle.gestureWeight.fill(0.0f);
-    oracle.gestureSelected.fill(false);
+    oracle.gestureSelectedMask = 0;
     SimComputeAllAndSnap(oracle);
 }

 std::size_t SimFindLatestPatchInDirectory(
     const std::vector<std::pair<std::filesystem::path, SimPatchSnapshot>>& versions,
     const std::filesystem::path& patchDir) {
     for (std::size_t reverseIx = versions.size(); reverseIx > 0; --reverseIx) {
         const std::size_t ix = reverseIx - 1;
         if (versions[ix].first.parent_path() == patchDir) {
             return ix;
@@ -7184,21 +7621,21 @@ std::size_t SimFindLatestPatchInDirectory(
 }

 } // namespace

 TEST_CASE(randomized_parameter_modulation_simulation) {
     const std::vector<unsigned> seeds = SimSeedsFromEnvironment();
     const int steps = SimStepsFromEnvironment();

     for (const unsigned seed : seeds) {
         synth::ParameterManager manager;
-        manager.SetGestureCount(2);
+        manager.SetGestureCount(kSimGestures);
         auto& group = manager.CreateGroup({
             .numVoices = kSimVoices,
             .numModulators = kSimMods,
             .numScenes = kSimScenes,
             .maxParameters = kSimParams,
             .processLiteAlpha = 0.25f,
             .targetCenterAlpha = 1.0f,
         });
         auto& carrier = manager.CreateParameter(group, {
             .name = "Carrier",
@@ -7370,28 +7807,28 @@ TEST_CASE(randomized_parameter_modulation_simulation) {
                 const bool held = (rng() % 2) == 0;
                 action = std::string("set random-mod held ") + (held ? "true" : "false");
                 manager.SetRandomModHeld(held);
                 oracle.randomModHeld = held;
                 break;
             }
             case 8: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "select gesture " + std::to_string(gestureIx);
                 manager.SelectGesture(gestureIx);
-                oracle.gestureSelected[gestureIx] = true;
+                SimSetGestureSelected(oracle, gestureIx, true);
                 break;
             }
             case 9: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "deselect gesture " + std::to_string(gestureIx);
                 manager.DeselectGesture(gestureIx);
-                oracle.gestureSelected[gestureIx] = false;
+                SimSetGestureSelected(oracle, gestureIx, false);
                 break;
             }
             case 10: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 const float value = unipolarDist(rng);
                 action = "set gesture value " + std::to_string(gestureIx);
                 manager.SetGestureValue(gestureIx, value);
                 oracle.gestureWeight[gestureIx] = value;
                 break;
             }
@@ -7457,27 +7894,27 @@ TEST_CASE(randomized_parameter_modulation_simulation) {
                 }
                 SimProcessLiteAll(oracle);
                 break;
             default: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "clear active gesture " + std::to_string(gestureIx);
                 manager.ClearGestureActiveFlagsForActiveSceneSelection(gestureIx);
                 const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
                 for (auto& parameter : oracle.params) {
                     if (blend <= 0.0f) {
-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
                     } else if (blend >= 1.0f) {
-                        parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
                     } else {
-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
                         if (oracle.scene.rightScene != oracle.scene.leftScene) {
-                            parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
+                            SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
                         }
                     }
                 }
                 break;
             }
             }

             SimCheck(oracle, params, banks, group, slot, manager, seed, step, action);
         }
     }
@@ -7560,22 +7997,42 @@ TEST_CASE(randomized_message_bus_ui_state_simulation) {
         std::mt19937 randomRng(seed ^ 0xBADC0DEu);
         manager.SetRandomSource(
             [&randomSamples]() { return randomSamples.PopValue(); },
             [&randomSamples]() { return randomSamples.PopCoin(); },
             [&randomSamples](std::size_t max) { return randomSamples.PopIndex(max); });

         SimCheck(oracle, params, banks, group, slot, manager, seed, -1, "initial bus");
         manager.PopulateUIState(*ui);
         SimCheckUIState(oracle, *ui, seed, -1, "initial bus ui");

+        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(timestamp, 32, true)));
+        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, 32, 0.4f)));
+        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(timestamp, 63, true)));
+        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, 63, 0.8f)));
+        REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(timestamp, 0, 0, 0.05f)));
+        bus.Process(timestamp++);
+        SimSetGestureSelected(oracle, 32, true);
+        oracle.gestureWeight[32] = 0.4f;
+        SimSetGestureSelected(oracle, 63, true);
+        oracle.gestureWeight[63] = 0.8f;
+        SimHandleTick(oracle, encoders[0], 0.05f);
+        SimCheck(oracle, params, banks, group, slot, manager, seed, -1,
+                 "deterministic gestures=32,63 random-consumption(values=0/0,coins=0/0,indices=0/0)");
+        manager.PopulateUIState(*ui);
+        SimCheckUIState(oracle, *ui, seed, -1,
+                        "deterministic gestures=32,63 ui random-consumption(values=0/0,coins=0/0,indices=0/0)");
+        REQUIRE_TRUE((ui->slots[0].cells[0].gesturesAffectingMask.load() & (synth::GestureMask{1} << 32)) != 0);
+        REQUIRE_TRUE((ui->slots[0].cells[0].gesturesAffectingMask.load() & (synth::GestureMask{1} << 63)) != 0);
+
         for (int step = 0; step < steps; ++step) {
             std::string action;
+            randomSamples.Clear();
             auto modifierName = [](synth::Modifier modifier) {
                 switch (modifier) {
                 case synth::Modifier::None:
                     return "none";
                 case synth::Modifier::Reset:
                     return "reset";
                 case synth::Modifier::Random:
                     return "random";
                 case synth::Modifier::RandomMod:
                     return "random-mod";
@@ -7723,21 +8180,21 @@ TEST_CASE(randomized_message_bus_ui_state_simulation) {
                 REQUIRE_TRUE(bus.Push(synth::MessageIn::SetRandomMod(timestamp, held)));
                 bus.Process(timestamp);
                 oracle.randomModHeld = held;
                 break;
             }
             case 11: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "bus toggle gesture " + std::to_string(gestureIx);
                 REQUIRE_TRUE(bus.Push(synth::MessageIn::ToggleGestureSelect(timestamp, gestureIx)));
                 bus.Process(timestamp);
-                oracle.gestureSelected[gestureIx] = !oracle.gestureSelected[gestureIx];
+                SimSetGestureSelected(oracle, gestureIx, !SimGestureSelected(oracle, gestureIx));
                 break;
             }
             case 12: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 const float value = unipolarDist(rng);
                 action = "bus set gesture value " + std::to_string(gestureIx);
                 REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, gestureIx, value)));
                 bus.Process(timestamp);
                 oracle.gestureWeight[gestureIx] = value;
                 break;
@@ -7811,29 +8268,180 @@ TEST_CASE(randomized_message_bus_ui_state_simulation) {
                 const std::size_t previousLeft = manager.Scene().leftScene;
                 const std::size_t previousRight = manager.Scene().rightScene;
                 REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(timestamp, kSimScenes + 1)));
                 bus.Process(timestamp);
                 REQUIRE_TRUE(manager.Scene().leftScene == previousLeft);
                 REQUIRE_TRUE(manager.Scene().rightScene == previousRight);
                 break;
             }
             }
             ++timestamp;
+            action += " random-consumption(" + randomSamples.ConsumptionSummary() + ")";
             SimCheck(oracle, params, banks, group, slot, manager, seed, step, action);
             if (step % 11 == 0) {
                 manager.PopulateUIState(*ui);
                 SimCheckUIState(oracle, *ui, seed, step, action);
             }
         }
     }
 }

+TEST_CASE(message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load) {
+    constexpr unsigned seed = 0x5A17C0DEu;
+    synth::ParameterManager manager;
+    REQUIRE_TRUE(manager.SetGestureCount(64));
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 2,
+                                       .numScenes = 2,
+                                       .maxParameters = 2,
+                                       .targetCenterAlpha = 1.0f});
+    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.25f});
+    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.75f});
+    group.AddParameterStorageBatch(synth::MakeParameterStorageBatch(group.Config(), group.GestureCount(), 2));
+    REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
+    manager.SetSceneBlend(0.25f);
+
+    auto& bank = manager.CreateBank();
+    bank.AddMapping(10, first);
+    bank.AddMapping(20, second);
+    auto& slot = manager.CreateBankSlot();
+    for (const synth::PhysicalEncoderId encoder : {10u, 11u, 12u, 20u}) {
+        slot.AddPhysicalEncoder(encoder);
+    }
+    slot.SelectBank(&bank);
+    synth::MessageInBus bus(&manager, 64);
+
+    SimOracle oracle;
+    auto fail = [&](int step, const std::string& action, const std::string& field,
+                    std::size_t expected, std::size_t actual) {
+        std::ostringstream oss;
+        oss << "seed " << seed << " step " << step << " action " << action
+            << " random-consumption(values=0/0,coins=0/0,indices=0/0) " << field
+            << " expected " << expected << " got " << actual;
+        throw std::runtime_error(oss.str());
+    };
+    auto checkCounts = [&](int step, const std::string& action) {
+        if (group.LiveLocalParameterCount() != oracle.liveLocalCount) {
+            fail(step, action, "live local count", oracle.liveLocalCount, group.LiveLocalParameterCount());
+        }
+        if (group.FreeLocalParameterSlotCount() != oracle.freeLocalCount) {
+            fail(step, action, "free local count", oracle.freeLocalCount, group.FreeLocalParameterSlotCount());
+        }
+    };
+    std::uint64_t timestamp = 1;
+    auto push = [&](const synth::MessageIn& message) {
+        REQUIRE_TRUE(bus.Push(message));
+        bus.Process(timestamp);
+        ++timestamp;
+    };
+
+    push(synth::MessageIn::ParamPush(timestamp, 0, 0)); // open First
+    oracle.liveLocalCount = 2;
+    for (std::size_t sourceIx = 0; sourceIx < 2; ++sourceIx) {
+        oracle.localSlots[sourceIx] = {
+            .storageIdentity = 2 + sourceIx,
+            .parentParameter = 0,
+            .sourceIx = sourceIx,
+            .live = true,
+            .free = false,
+            .pinned = true,
+        };
+    }
+    checkCounts(0, "open first modulation view");
+    REQUIRE_TRUE(bank.ShowingModulation());
+    synth::Parameter* firstSource0 = bank.VisibleParameter(10);
+    synth::Parameter* firstSource1 = bank.VisibleParameter(11);
+    REQUIRE_TRUE(firstSource0 == &group.ParameterByLocalIndex(oracle.localSlots[0].storageIdentity));
+    REQUIRE_TRUE(firstSource1 == &group.ParameterByLocalIndex(oracle.localSlots[1].storageIdentity));
+
+    push(synth::MessageIn::SetReset(timestamp, true));
+    push(synth::MessageIn::ParamPush(timestamp, 0, 0)); // reset visible local through the bus
+    push(synth::MessageIn::SetReset(timestamp, false));
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0); // the model's pinned guard is observable
+    checkCounts(1, "reset pinned local and collect");
+
+    push(synth::MessageIn::ParamPush(timestamp, 0, 3)); // close First view
+    oracle.liveLocalCount = 0;
+    oracle.freeLocalCount = 2;
+    for (SimLocalSlot& local : oracle.localSlots) {
+        local.live = false;
+        local.free = true;
+        local.pinned = false;
+        local.parentParameter = -1;
+    }
+    checkCounts(2, "close first view and collect neutral locals");
+    REQUIRE_TRUE(!bank.ShowingModulation());
+
+    push(synth::MessageIn::ParamPush(timestamp, 0, 3)); // open Second using recycled slots
+    oracle.liveLocalCount = 2;
+    oracle.freeLocalCount = 0;
+    oracle.localSlots[1].parentParameter = 1;
+    oracle.localSlots[1].sourceIx = 0;
+    oracle.localSlots[1].live = true;
+    oracle.localSlots[1].free = false;
+    oracle.localSlots[1].pinned = true;
+    oracle.localSlots[0].parentParameter = 1;
+    oracle.localSlots[0].sourceIx = 1;
+    oracle.localSlots[0].live = true;
+    oracle.localSlots[0].free = false;
+    oracle.localSlots[0].pinned = true;
+    checkCounts(3, "open second view with distinct-parent reuse");
+    REQUIRE_TRUE(bank.VisibleParameter(10) == firstSource1);
+    REQUIRE_TRUE(bank.VisibleParameter(11) == firstSource0);
+
+    push(synth::MessageIn::SetGestureSelect(timestamp, 63, true));
+    push(synth::MessageIn::SetGestureValue(timestamp, 63, 1.0f));
+    push(synth::MessageIn::ParamIncDec(timestamp, 0, 0, 0.1f)); // arm gesture 63
+    push(synth::MessageIn::ParamIncDec(timestamp, 0, 0, 0.1f)); // edit the armed gesture
+    synth::Parameter* retained = bank.VisibleParameter(10);
+    REQUIRE_TRUE(retained != nullptr);
+    REQUIRE_TRUE(retained->GestureActive(0, 63));
+    REQUIRE_TRUE(retained->GestureActive(1, 63));
+    REQUIRE_TRUE(retained->GestureValue(0, 63) != 0.5f || retained->GestureValue(1, 63) != 0.5f);
+    const float savedGesture0 = retained->GestureValue(0, 63);
+    const float savedGesture1 = retained->GestureValue(1, 63);
+
+    push(synth::MessageIn::ParamPush(timestamp, 0, 3)); // close Second view
+    oracle.liveLocalCount = 1;
+    oracle.freeLocalCount = 1;
+    oracle.localSlots[1].pinned = false;
+    oracle.localSlots[0].live = false;
+    oracle.localSlots[0].free = true;
+    oracle.localSlots[0].pinned = false;
+    oracle.localSlots[0].parentParameter = -1;
+    checkCounts(4, "close second view and retain non-default gesture route");
+    REQUIRE_TRUE(second.ModulationDepthParameter(0) == retained);
+    REQUIRE_TRUE(second.ModulationDepthParameter(1) == nullptr);
+
+    synth::JsonArena patchArena(262144);
+    synth::MidiInstrumentConfig instrument;
+    synth::AudioDeviceState audio;
+    const synth::JSON patch = synth::BuildPatchJSON(patchArena, "Lifecycle", manager, instrument, audio);
+    REQUIRE_TRUE(!patchArena.Failed());
+    manager.RevertAllToDefaults();
+    oracle.liveLocalCount = 0;
+    oracle.freeLocalCount = 2;
+    checkCounts(5, "revert all and collect");
+    REQUIRE_TRUE(second.ModulationDepthParameter(0) == nullptr);
+
+    REQUIRE_TRUE(synth::LoadPatchJSON(patch, manager, instrument, &audio));
+    oracle.liveLocalCount = 1;
+    oracle.freeLocalCount = 1;
+    checkCounts(6, "patch load rematerializes retained route and collects omissions");
+    synth::Parameter* loaded = second.ModulationDepthParameter(0);
+    REQUIRE_TRUE(loaded != nullptr);
+    REQUIRE_TRUE(loaded->GestureActive(0, 63));
+    REQUIRE_TRUE(loaded->GestureActive(1, 63));
+    REQUIRE_NEAR(loaded->GestureValue(0, 63), savedGesture0, 0.000001f);
+    REQUIRE_NEAR(loaded->GestureValue(1, 63), savedGesture1, 0.000001f);
+}
+
 TEST_CASE(randomized_patch_lifecycle_simulation) {
     const std::vector<unsigned> seeds = SimSeedsFromEnvironment();
     const int steps = SimStepsFromEnvironmentOrDefault(260);

     for (const unsigned seed : seeds) {
         const std::filesystem::path tempRoot =
             std::filesystem::temp_directory_path() / ("sheaf-synth-patch-random-" + std::to_string(seed));
         std::filesystem::remove_all(tempRoot);
         std::filesystem::create_directories(tempRoot);

@@ -8002,28 +8610,28 @@ TEST_CASE(randomized_patch_lifecycle_simulation) {
                 manager.HandlePress(encoder);
                 resetSamples.RequireDrained(seed, step, action);
                 manager.SetResetHeld(false);
                 oracle.resetHeld = false;
                 break;
             }
             case 5: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "patch select gesture " + std::to_string(gestureIx);
                 manager.SelectGesture(gestureIx);
-                oracle.gestureSelected[gestureIx] = true;
+                SimSetGestureSelected(oracle, gestureIx, true);
                 break;
             }
             case 6: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "patch deselect gesture " + std::to_string(gestureIx);
                 manager.DeselectGesture(gestureIx);
-                oracle.gestureSelected[gestureIx] = false;
+                SimSetGestureSelected(oracle, gestureIx, false);
                 break;
             }
             case 7: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 const float value = unipolarDist(rng);
                 action = "patch set gesture value " + std::to_string(gestureIx);
                 manager.SetGestureValue(gestureIx, value);
                 oracle.gestureWeight[gestureIx] = value;
                 break;
             }
@@ -8071,27 +8679,27 @@ TEST_CASE(randomized_patch_lifecycle_simulation) {
                 }
                 SimProcessLiteAll(oracle);
                 break;
             case 14: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "patch clear active gesture " + std::to_string(gestureIx);
                 manager.ClearGestureActiveFlagsForActiveSceneSelection(gestureIx);
                 const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
                 for (auto& parameter : oracle.params) {
                     if (blend <= 0.0f) {
-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
                     } else if (blend >= 1.0f) {
-                        parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
                     } else {
-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
                         if (oracle.scene.rightScene != oracle.scene.leftScene) {
-                            parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
+                            SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
                         }
                     }
                 }
                 break;
             }
             case 15:
             case 16:
                 action = "patch save";
                 saveCurrentOracle();
                 break;
@@ -8236,20 +8844,31 @@ TEST_CASE(randomized_patch_lifecycle_preserves_recursive_local_modulation_depths
             1, {.name = "Cutoff Env", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});
         auto& lfoCurve = cutoffLfo.EnsureModulationDepth(
             2, {.name = "Cutoff LFO Curve", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});
         auto& resonanceLfo = resonance.EnsureModulationDepth(
             0, {.name = "Resonance LFO", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});
         REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
         manager.SetSceneBlend(0.25f);
         manager.CaptureDefaultControlState();

         std::vector<synth::Parameter*> tracked{&cutoff, &resonance, &cutoffLfo, &cutoffEnv, &lfoCurve, &resonanceLfo};
+        auto refreshTrackedTopology = [&] {
+            synth::Parameter* liveCutoffLfo = cutoff.EnsureModulationDepth(0);
+            synth::Parameter* liveCutoffEnv = cutoff.EnsureModulationDepth(1);
+            synth::Parameter* liveResonanceLfo = resonance.EnsureModulationDepth(0);
+            REQUIRE_TRUE(liveCutoffLfo != nullptr);
+            REQUIRE_TRUE(liveCutoffEnv != nullptr);
+            REQUIRE_TRUE(liveResonanceLfo != nullptr);
+            synth::Parameter* liveLfoCurve = liveCutoffLfo->EnsureModulationDepth(2);
+            REQUIRE_TRUE(liveLfoCurve != nullptr);
+            tracked = {&cutoff, &resonance, liveCutoffLfo, liveCutoffEnv, liveLfoCurve, liveResonanceLfo};
+        };
         RecursivePatchSnapshot expected = captureValues(tracked);
         const RecursivePatchSnapshot defaultExpected = expected;

         synth::WrldBldrDefaultProfileOptions midiOptions;
         midiOptions.visibleEncoderCount = 5;
         midiOptions.sceneCount = kSimScenes;
         midiOptions.bankButtonCount = 2;
         midiOptions.gestureSelectorCount = kSimGestures;
         const synth::MidiControllerProfileConfig defaultProfile = synth::WrldBldrDefaultProfileConfig(midiOptions);
         const synth::MidiInstrumentConfig defaultInstrument = MakeInstrumentFromProfile(defaultProfile);
@@ -8269,20 +8888,21 @@ TEST_CASE(randomized_patch_lifecycle_preserves_recursive_local_modulation_depths
         auto processPatchMessages = [&] {
             synth::PatchMessageIn message;
             while (inputBus.Pop(message)) {
                 const synth::PatchApplyStatus status =
                     synth::ApplyPatchMessage(message, manager, instrument, defaultInstrument,
                                              audioDevice, defaultAudioDevice, outputBus);
                 REQUIRE_TRUE(status == synth::PatchApplyStatus::Applied ||
                              status == synth::PatchApplyStatus::Reverted ||
                              status == synth::PatchApplyStatus::Serialized);
             }
+            refreshTrackedTopology();
         };

         auto completePendingSave = [&](const RecursivePatchSnapshot& snapshot) {
             processPatchMessages();
             const auto now = std::chrono::system_clock::from_time_t(1700005000 + writeCounter++);
             const synth::PatchCommandResult completion = patchManager.ProcessResponses(now);
             REQUIRE_TRUE(completion.status == synth::PatchCommandStatus::Written);
             savedVersions.push_back({completion.path, snapshot});
             expectedCurrentPatchDir = completion.path.parent_path();
         };
@@ -8466,26 +9086,26 @@ TEST_CASE(randomized_recursive_modulation_ui_tree_round_trips_into_fresh_initial
                 return true;
             }
             for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
                 if (std::fabs(parameter.GestureValue(sceneIx, gestureIx) - defaultValue) > tolerance ||
                     parameter.GestureActive(sceneIx, gestureIx)) {
                     return true;
                 }
             }
         }
         for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
-            for (const float depth : parameter.CurrentDepths(voiceIx)) {
+            for (const float depth : parameter.CurrentDepthSlots(voiceIx)) {
                 if (std::fabs(depth) > tolerance) {
                     return true;
                 }
             }
-            for (const float depth : parameter.TargetDepths(voiceIx)) {
+            for (const float depth : parameter.TargetDepthSlots(voiceIx)) {
                 if (std::fabs(depth) > tolerance) {
                     return true;
                 }
             }
             if (std::fabs(parameter.CurrentCenterScale(voiceIx) - 1.0f) > tolerance ||
                 std::fabs(parameter.TargetCenterScale(voiceIx) - 1.0f) > tolerance ||
                 std::fabs(parameter.CurrentNormalizationOffset(voiceIx)) > tolerance ||
                 std::fabs(parameter.TargetNormalizationOffset(voiceIx)) > tolerance) {
                 return true;
             }
@@ -10591,20 +11211,672 @@ TEST_CASE(compute_all_targets_preserves_process_lite_slew) {
     const float afterOneSlew = parameter.GetRaw(0);
     REQUIRE_TRUE(afterOneSlew > 0.0f);
     REQUIRE_TRUE(afterOneSlew < 1.0f);        // approaching, not jumped

     manager.ComputeAllParameters();           // existing API still snaps
     REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 1e-4f);
 }

 namespace {

+float FullScanApply(const synth::Modulators& modulators, std::size_t voiceIx,
+                    std::span<const float> depthsBySource) {
+    float sum = 0.0f;
+    for (std::size_t sourceIx = 0; sourceIx < depthsBySource.size(); ++sourceIx) {
+        sum += modulators.Value(voiceIx, sourceIx) * depthsBySource[sourceIx];
+    }
+    return sum;
+}
+
+void RequireRouteBijection(const synth::Parameter& parameter, std::size_t sourceCount) {
+    const auto sources = parameter.ActiveRouteSourceIndices();
+    REQUIRE_TRUE(sources.size() == parameter.ActiveRouteCount());
+    std::vector<bool> seen(sourceCount, false);
+    for (std::size_t slot = 0; slot < sourceCount; ++slot) {
+        const std::size_t sourceIx = parameter.RouteSourceIndex(slot);
+        REQUIRE_TRUE(sourceIx < sourceCount);
+        REQUIRE_TRUE(!seen[sourceIx]);
+        seen[sourceIx] = true;
+        REQUIRE_TRUE(parameter.RoutePositionForSource(sourceIx) == slot);
+    }
+}
+
+void RequireFullScanCurrentMatch(const synth::Parameter& parameter) {
+    const std::size_t sourceCount = parameter.Group().Config().numModulators;
+    RequireRouteBijection(parameter, sourceCount);
+    std::vector<float> depthsBySource(sourceCount, 0.0f);
+    for (std::size_t voiceIx = 0; voiceIx < parameter.Group().Config().numVoices; ++voiceIx) {
+        for (std::size_t sourceIx = 0; sourceIx < sourceCount; ++sourceIx) {
+            depthsBySource[sourceIx] = parameter.CurrentDepthForSource(voiceIx, sourceIx);
+        }
+        const float expected = synth::ClampToRange(
+            parameter.CurrentCenter() * parameter.CurrentCenterScale(voiceIx) +
+                parameter.CurrentNormalizationOffset(voiceIx) +
+                FullScanApply(parameter.Group().GetModulators(), voiceIx, depthsBySource),
+            parameter.Range());
+        REQUIRE_NEAR(parameter.GetRaw(voiceIx), expected, 0.000001f);
+    }
+}
+
+}  // namespace
+
+TEST_CASE(modulators_apply_active_uses_explicit_stable_source_indices) {
+    synth::Modulators modulators(1, 4);
+    modulators.Value(0, 0) = 0.2f;
+    modulators.Value(0, 1) = -0.4f;
+    modulators.Value(0, 2) = 0.7f;
+    modulators.Value(0, 3) = 0.9f;
+    const std::array<float, 2> depths = {0.5f, -0.25f};
+    const std::array<std::size_t, 2> sources = {3, 0};
+    const std::array<float, 4> fullDepths = {-0.25f, 0.0f, 0.0f, 0.5f};
+
+    REQUIRE_NEAR(modulators.ApplyActive(0, depths, sources),
+                 FullScanApply(modulators, 0, fullDepths), 0.000001f);
+
+    bool threw = false;
+    try {
+        (void)modulators.ApplyActive(0, depths, std::span<const std::size_t>(sources).first(1));
+    } catch (const std::invalid_argument&) {
+        threw = true;
+    }
+    REQUIRE_TRUE(threw);
+}
+
+TEST_CASE(active_modulation_routes_preserve_identity_and_settling_tail) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(1);
+    auto& group = manager.CreateGroup({.numVoices = 2,
+                                       .numModulators = 4,
+                                       .numScenes = 2,
+                                       .maxParameters = 16,
+                                       .processLiteAlpha = 1.0f,
+                                       .targetCenterAlpha = 1.0f});
+    group.GetModulators().Metadata(0) = {.name = "Zero", .shortName = "Z", .sourceColor = synth::Color::Red};
+    group.GetModulators().Metadata(1) = {.name = "One", .shortName = "O", .sourceColor = synth::Color::Orange};
+    group.GetModulators().Metadata(2) = {.name = "Two", .shortName = "T", .sourceColor = synth::Color::Green};
+    group.GetModulators().Metadata(3) = {.name = "Three", .shortName = "H", .sourceColor = synth::Color::Cyan};
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth3 = carrier.EnsureModulationDepth(3);
+    auto* depth0 = carrier.EnsureModulationDepth(0);
+    auto* depth2 = carrier.EnsureModulationDepth(2);
+    auto* depth1 = carrier.EnsureModulationDepth(1);
+    REQUIRE_TRUE(depth3 != nullptr);
+    REQUIRE_TRUE(depth0 != nullptr);
+    REQUIRE_TRUE(depth2 != nullptr);
+    REQUIRE_TRUE(depth1 != nullptr);
+    group.GetModulators().Value(0, 0) = -0.25f;
+    group.GetModulators().Value(0, 2) = 0.5f;
+    group.GetModulators().Value(0, 3) = 0.75f;
+    group.GetModulators().Value(1, 0) = 0.4f;
+    group.GetModulators().Value(1, 2) = -0.6f;
+    group.GetModulators().Value(1, 3) = 0.1f;
+
+    depth3->SceneCenter(0) = 0.75f;
+    depth3->SceneCenter(1) = 0.75f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 3);
+    RequireFullScanCurrentMatch(carrier);
+
+    depth0->SceneCenter(0) = 0.7f;
+    depth0->SceneCenter(1) = 0.7f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 2);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 3);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[1] == 0);
+
+    depth2->SceneCenter(0) = 0.8f;
+    depth2->SceneCenter(1) = 0.8f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 3);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[2] == 2);
+    RequireFullScanCurrentMatch(carrier);
+
+    depth1->SceneCenter(0) = 0.65f;
+    depth1->SceneCenter(1) = 0.65f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 4);
+    RequireFullScanCurrentMatch(carrier);
+
+    depth0->SceneCenter(0) = 0.5f;
+    depth0->SceneCenter(1) = 0.5f;
+    depth0->GestureValue(0, 0) = 0.6f;  // latent persisted state must retain source key 0
+    depth1->SceneCenter(0) = 0.5f;
+    depth1->SceneCenter(1) = 0.5f;
+    manager.ComputeAllTargets();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 4);
+    carrier.ProcessLite();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 4);
+    manager.ComputeAllTargets();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 2);
+    REQUIRE_TRUE(carrier.RoutePositionForSource(0) >= carrier.ActiveRouteCount());
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 3);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[1] == 2);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(2) == depth2);
+    REQUIRE_TRUE(depth0->Name() == "Carrier Zero");
+    REQUIRE_TRUE(depth2->Name() == "Carrier Two");
+    synth::Parameter::UIState ui(2, 4, 1);
+    carrier.PopulateUIState(ui);
+    REQUIRE_TRUE(ui.modulatorSourceColors[0].Load() == synth::Color::Red);
+    REQUIRE_TRUE(ui.modulatorSourceColors[2].Load() == synth::Color::Green);
+    synth::JsonArena arena(16384);
+    const synth::JSON values = carrier.ToValueJSON(arena);
+    REQUIRE_TRUE(!values.Get("modDepths").Get("0").IsNull());
+    REQUIRE_TRUE(values.Get("modDepths").Get("1").IsNull());
+    REQUIRE_TRUE(!values.Get("modDepths").Get("2").IsNull());
+    REQUIRE_TRUE(!values.Get("modDepths").Get("3").IsNull());
+    RequireFullScanCurrentMatch(carrier);
+}
+
+TEST_CASE(active_modulation_route_union_keeps_source_with_only_voice_one_nonzero) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 2,
+                                       .numModulators = 3,
+                                       .numScenes = 1,
+                                       .maxParameters = 12,
+                                       .processLiteAlpha = 1.0f,
+                                       .targetCenterAlpha = 1.0f});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
+    auto* depth = carrier.EnsureModulationDepth(2);
+    REQUIRE_TRUE(depth != nullptr);
+    auto* nested = depth->EnsureModulationDepth(0);
+    REQUIRE_TRUE(nested != nullptr);
+    nested->SceneCenter(0) = 0.75f;
+    group.GetModulators().Value(0, 0) = 0.5f;
+    group.GetModulators().Value(1, 0) = 1.0f;
+    group.GetModulators().Value(0, 2) = -0.8f;
+    group.GetModulators().Value(1, 2) = 0.6f;
+
+    manager.ComputeAllParameters();
+
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 2), 0.0f, 0.000001f);
+    REQUIRE_TRUE(std::fabs(carrier.CurrentDepthForSource(1, 2)) > 0.000001f);
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 2);
+    RequireFullScanCurrentMatch(carrier);
+}
+
+TEST_CASE(active_modulation_routes_randomized_full_scan_oracle_and_work_bound) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 2,
+                                       .numModulators = 4,
+                                       .numScenes = 2,
+                                       .maxParameters = 16,
+                                       .processLiteAlpha = 0.25f,
+                                       .targetCenterAlpha = 1.0f});
+    synth::ParameterProcessingObserver work;
+    group.SetProcessingObserverForTests(&work);
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.35f});
+    std::array<synth::Parameter*, 4> depths{};
+    for (std::size_t sourceIx = 0; sourceIx < depths.size(); ++sourceIx) {
+        depths[sourceIx] = carrier.EnsureModulationDepth(sourceIx);
+        REQUIRE_TRUE(depths[sourceIx] != nullptr);
+    }
+    std::mt19937 random(0x5a17eU);
+    std::uniform_int_distribution<int> sourceDistribution(0, 3);
+    std::uniform_int_distribution<int> valueDistribution(0, 4);
+    std::uniform_real_distribution<float> modulatorDistribution(-1.0f, 1.0f);
+
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 0);
+    for (std::size_t step = 0; step < 128; ++step) {
+        const std::size_t sourceIx = static_cast<std::size_t>(sourceDistribution(random));
+        const float knob = 0.5f + 0.1f * static_cast<float>(valueDistribution(random) - 2);
+        depths[sourceIx]->SceneCenter(step & 1U) = knob;
+        for (std::size_t voiceIx = 0; voiceIx < 2; ++voiceIx) {
+            for (std::size_t modIx = 0; modIx < 4; ++modIx) {
+                group.GetModulators().Value(voiceIx, modIx) = modulatorDistribution(random);
+            }
+        }
+
+        REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
+        manager.SetSceneBlend(static_cast<float>(step % 5) * 0.25f);
+        manager.ComputeAllTargets();
+        const std::size_t visitsBefore = work.activeRouteVisits;
+        carrier.ProcessLite();
+        REQUIRE_TRUE(work.activeRouteVisits - visitsBefore == carrier.ActiveRouteCount() * 2);
+        RequireFullScanCurrentMatch(carrier);
+    }
+}
+
+TEST_CASE(neutral_local_collection_reclaims_leaf_and_preserves_high_water_accounting) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(64);
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 2,
+                                       .numScenes = 1,
+                                       .maxParameters = 5});
+    group.GetModulators().Metadata(0) = {.name = "Old", .shortName = "Old", .sourceColor = synth::Color::Red};
+    group.GetModulators().Metadata(1) = {.name = "New", .shortName = "New", .sourceColor = synth::Color::Cyan};
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .shortName = "Car", .defaultValue = 0.4f});
+    auto& other = manager.CreateParameter(group, {.name = "Other", .shortName = "Oth", .defaultValue = 0.6f});
+    synth::Parameter* oldLocal = &carrier.EnsureModulationDepth(
+        0, {.name = "Old Local",
+            .shortName = "Old",
+            .defaultValue = 0.5f,
+            .range = synth::RangeKind::Bipolar,
+            .switchValues = 7,
+            .baseColor = synth::Color::Red,
+            .indicatorColors = {synth::Color::Orange}});
+    REQUIRE_TRUE(oldLocal != nullptr);
+    const synth::Parameter* carrierAddress = &carrier;
+    const synth::Parameter* otherAddress = &other;
+    const std::size_t recycledStorageIx = group.ParameterCount() - 1;
+    REQUIRE_TRUE(&group.ParameterByLocalIndex(recycledStorageIx) == oldLocal);
+
+    const std::size_t highWater = group.ParameterCount();
+    const std::size_t availableBefore = group.AvailableParameterSlots();
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 1);
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(group.ParameterCount() == highWater);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
+    REQUIRE_TRUE(group.AvailableParameterSlots() == availableBefore + 1);
+
+    synth::Parameter* reused = other.EnsureModulationDepth(1);
+    REQUIRE_TRUE(reused != nullptr);
+    REQUIRE_TRUE(group.ParameterCount() == highWater);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 1);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 0);
+    REQUIRE_TRUE(&carrier == carrierAddress);
+    REQUIRE_TRUE(&other == otherAddress);
+    REQUIRE_TRUE(&group.ParameterByLocalIndex(recycledStorageIx) == reused);
+    REQUIRE_TRUE(reused->Name() == "Other New");
+    REQUIRE_TRUE(reused->ShortName() == "New");
+    REQUIRE_TRUE(reused->BaseColor() == synth::Color::Cyan);
+    REQUIRE_TRUE(reused->Range() == synth::RangeKind::Bipolar);
+    REQUIRE_TRUE(reused->SwitchValues() == 0);
+    REQUIRE_NEAR(reused->SceneCenter(0), 0.5f, 0.000001f);
+    REQUIRE_NEAR(reused->CurrentCenter(), 0.5f, 0.000001f);
+    REQUIRE_NEAR(reused->TargetCenter(), 0.5f, 0.000001f);
+    REQUIRE_NEAR(reused->CurrentCenterScale(0), 1.0f, 0.000001f);
+    REQUIRE_NEAR(reused->TargetCenterScale(0), 1.0f, 0.000001f);
+    REQUIRE_NEAR(reused->CurrentNormalizationOffset(0), 0.0f, 0.000001f);
+    REQUIRE_NEAR(reused->TargetNormalizationOffset(0), 0.0f, 0.000001f);
+    REQUIRE_TRUE(reused->ActiveRouteCount() == 0);
+    REQUIRE_TRUE(reused->RouteSourceIndex(0) == 0);
+    REQUIRE_TRUE(reused->RouteSourceIndex(1) == 1);
+    REQUIRE_TRUE(reused->ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(reused->ModulationDepthParameter(1) == nullptr);
+    REQUIRE_NEAR(reused->GestureValue(0, 32), 0.5f, 0.000001f);
+    REQUIRE_NEAR(reused->GestureValue(0, 63), 0.5f, 0.000001f);
+    REQUIRE_TRUE(!reused->GestureActive(0, 32));
+    REQUIRE_TRUE(!reused->GestureActive(0, 63));
+    synth::Parameter::UIState ui(1, 2, 64);
+    reused->PopulateUIState(ui);
+    REQUIRE_NEAR(ui.values[0].load(), 0.0f, 0.000001f);
+    REQUIRE_NEAR(ui.spreadValues[0].load(), 0.0f, 0.000001f);
+    REQUIRE_NEAR(ui.minValues[0].load(), 0.0f, 0.000001f);
+    REQUIRE_NEAR(ui.maxValues[0].load(), 0.0f, 0.000001f);
+    REQUIRE_TRUE(ui.modulatorsAffectingMask.load() == 0);
+    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == 0);
+}
+
+TEST_CASE(neutral_local_collection_retains_non_default_scene_state) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 2, .maxParameters = 2});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(1) = 0.6f;
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+}
+
+TEST_CASE(neutral_local_collection_retains_inactive_latent_gesture_value) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(64);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->GestureValue(0, 63) = 0.6f;
+    REQUIRE_TRUE(!depth->GestureActive(0, 63));
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+}
+
+TEST_CASE(neutral_local_collection_retains_active_gesture_at_default_value) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(64);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SetGestureActive(0, 32, true);
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+}
+
+TEST_CASE(neutral_local_collection_retains_unsnapped_runtime_state) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 1,
+                                       .numScenes = 1,
+                                       .maxParameters = 2,
+                                       .targetCenterAlpha = 1.0f});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 0.75f;
+    manager.ComputeAllParameters();
+    depth->SceneCenter(0) = 0.5f;
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+}
+
+TEST_CASE(neutral_local_collection_retains_nonzero_normalization_state) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 1,
+                                       .numScenes = 1,
+                                       .maxParameters = 3,
+                                       .targetCenterAlpha = 1.0f});
+    group.GetModulators().Value(0, 0) = 1.0f;
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    auto* nested = depth->EnsureModulationDepth(0);
+    REQUIRE_TRUE(nested != nullptr);
+    nested->SceneCenter(0) = 0.25f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(depth->CurrentNormalizationOffset(0) > 0.0f);
+    REQUIRE_TRUE(depth->TargetNormalizationOffset(0) > 0.0f);
+
+    depth->ClearModulationDepths();
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+
+    REQUIRE_TRUE(depth->AssignModulationDepth(0, nested));
+    depth->RevertAllToDefault();
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 2);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+}
+
+TEST_CASE(neutral_local_collection_retains_parent_with_non_collectible_child) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(1);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 3});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    auto* nested = depth->EnsureModulationDepth(1);
+    REQUIRE_TRUE(nested != nullptr);
+    nested->GestureValue(0, 0) = 0.6f;
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+    REQUIRE_TRUE(depth->ModulationDepthParameter(1) == nested);
+}
+
+TEST_CASE(neutral_local_collection_collapses_recursive_subtree_bottom_up) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 3});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    REQUIRE_TRUE(depth->EnsureModulationDepth(1) != nullptr);
+    const std::size_t highWater = group.ParameterCount();
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 2);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(group.ParameterCount() == highWater);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 2);
+}
+
+TEST_CASE(neutral_local_collection_detaches_child_while_parent_route_finishes_settling) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 1,
+                                       .numScenes = 1,
+                                       .maxParameters = 2,
+                                       .processLiteAlpha = 0.5f,
+                                       .targetCenterAlpha = 1.0f});
+    group.GetModulators().Value(0, 0) = 1.0f;
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 0.75f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
+    REQUIRE_TRUE(std::fabs(carrier.CurrentDepthForSource(0, 0)) > 0.000001f);
+
+    depth->SceneCenter(0) = 0.5f;
+    manager.ComputeAllTargets();
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.0f, 0.000001f);
+    REQUIRE_TRUE(std::fabs(carrier.CurrentDepthForSource(0, 0)) > 0.000001f);
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
+
+    for (std::size_t step = 0; step < 32 && carrier.ActiveRouteCount() != 0; ++step) {
+        carrier.ProcessLite();
+        manager.ComputeAllTargets();
+    }
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 0);
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), 0.0f, 0.000001f);
+}
+
+TEST_CASE(modulation_view_pins_visible_locals_until_deselect_boundary) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 3});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto& bank = manager.CreateBank();
+    bank.AddMapping(10, carrier);
+    auto& slot = manager.CreateBankSlot();
+    slot.AddPhysicalEncoder(10);
+    slot.AddPhysicalEncoder(11);
+    slot.AddPhysicalEncoder(12);
+    slot.SelectBank(&bank);
+
+    slot.HandlePress(10);
+    REQUIRE_TRUE(bank.ShowingModulation());
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 2);
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == bank.VisibleParameter(10));
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(1) == bank.VisibleParameter(11));
+
+    bank.Deselect();
+    REQUIRE_TRUE(!bank.ShowingModulation());
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(1) == nullptr);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 2);
+}
+
+TEST_CASE(multi_level_modulation_view_balances_pins_and_reuses_the_collapsed_subtree) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 6});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto& other = manager.CreateParameter(group, {.name = "Other", .defaultValue = 0.6f});
+    auto& bank = manager.CreateBank();
+    bank.AddMapping(10, carrier);
+    auto& slot = manager.CreateBankSlot();
+    slot.AddPhysicalEncoder(10);
+    slot.AddPhysicalEncoder(11);
+    slot.SelectBank(&bank);
+
+    slot.HandlePress(10);
+    synth::Parameter* first = carrier.ModulationDepthParameter(0);
+    REQUIRE_TRUE(first != nullptr);
+    slot.HandlePress(10);
+    synth::Parameter* second = first->ModulationDepthParameter(0);
+    REQUIRE_TRUE(second != nullptr);
+    slot.HandlePress(10);
+    synth::Parameter* third = second->ModulationDepthParameter(0);
+    REQUIRE_TRUE(third != nullptr);
+    REQUIRE_TRUE(bank.SelectedParameter() == second);
+    REQUIRE_TRUE(bank.VisibleParameter(10) == third);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 3);
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    const std::size_t highWater = group.ParameterCount();
+
+    bank.Deselect();
+
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 3);
+    synth::Parameter* reused = other.EnsureModulationDepth(0);
+    REQUIRE_TRUE(reused == first || reused == second || reused == third);
+    REQUIRE_TRUE(group.ParameterCount() == highWater);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 1);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 2);
+}
+
+TEST_CASE(revert_all_collects_neutral_local_topology_at_control_boundary) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    manager.CaptureDefaultControlState();
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 0.75f;
+
+    manager.RevertAllToDefaults();
+
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
+}
+
+TEST_CASE(neutral_local_reuse_stays_bounded_beyond_configured_capacity) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
+    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.25f});
+    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.75f});
+    group.AddParameterStorageBatch(synth::MakeParameterStorageBatch(group.Config(), group.GestureCount(), 1));
+
+    for (std::size_t iteration = 0; iteration < group.Config().maxParameters * 4; ++iteration) {
+        synth::Parameter& parent = (iteration & 1U) == 0 ? first : second;
+        REQUIRE_TRUE(parent.EnsureModulationDepth(0) != nullptr);
+        REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+        REQUIRE_TRUE(parent.ModulationDepthParameter(0) == nullptr);
+    }
+    REQUIRE_TRUE(group.ParameterCount() == 3);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
+}
+
+TEST_CASE(randomized_neutral_local_collection_reuses_slots_without_stale_topology) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(64);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 2, .maxParameters = 5});
+    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.25f});
+    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.75f});
+    auto& third = manager.CreateParameter(group, {.name = "Third", .defaultValue = 0.5f});
+    std::array<synth::Parameter*, 3> parents = {&first, &second, &third};
+    std::mt19937 random(0x74c011ecU);
+
+    for (std::size_t step = 0; step < 128; ++step) {
+        synth::Parameter& parent = *parents[random() % parents.size()];
+        const std::size_t sourceIx = random() % 2;
+        synth::Parameter* local = parent.EnsureModulationDepth(sourceIx);
+        REQUIRE_TRUE(local != nullptr);
+        if ((random() & 3U) == 0) {
+            local->GestureValue(1, 63) = 0.75f;
+            REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+            REQUIRE_TRUE(parent.ModulationDepthParameter(sourceIx) == local);
+            local->RevertAllToDefault();
+        }
+        REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+        REQUIRE_TRUE(parent.ModulationDepthParameter(sourceIx) == nullptr);
+        REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+        REQUIRE_TRUE(group.ParameterCount() <= 4);
+    }
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
+}
+
+TEST_CASE(patch_load_collection_preserves_high_gesture_nested_state_and_collects_default_omissions) {
+    synth::ParameterManager source;
+    source.SetGestureCount(64);
+    auto& sourceGroup = source.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 4});
+    auto& sourceCarrier = source.CreateParameter(sourceGroup, {.name = "Carrier", .defaultValue = 0.25f});
+    auto* sourceDepth = sourceCarrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(sourceDepth != nullptr);
+    auto* sourceNested = sourceDepth->EnsureModulationDepth(1);
+    REQUIRE_TRUE(sourceNested != nullptr);
+    sourceDepth->GestureValue(0, 32) = 0.7f;
+    sourceDepth->SetGestureActive(0, 32, true);
+    sourceNested->GestureValue(0, 63) = 0.8f;
+    sourceNested->SetGestureActive(0, 63, true);
+
+    synth::JsonArena patchArena(262144);
+    synth::MidiInstrumentConfig instrument;
+    synth::AudioDeviceState audio;
+    synth::JSON patch = synth::BuildPatchJSON(patchArena, "GC", source, instrument, audio);
+    REQUIRE_TRUE(!patchArena.Failed());
+
+    synth::ParameterManager target;
+    target.SetGestureCount(64);
+    auto& targetGroup = target.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 5});
+    auto& targetCarrier = target.CreateParameter(targetGroup, {.name = "Carrier", .defaultValue = 0.25f});
+    REQUIRE_TRUE(targetCarrier.EnsureModulationDepth(1) != nullptr);  // absent/default dirty topology
+    REQUIRE_TRUE(synth::LoadPatchJSON(patch, target, instrument, &audio));
+
+    auto* targetDepth = targetCarrier.ModulationDepthParameter(0);
+    REQUIRE_TRUE(targetDepth != nullptr);
+    auto* targetNested = targetDepth->ModulationDepthParameter(1);
+    REQUIRE_TRUE(targetNested != nullptr);
+    REQUIRE_NEAR(targetDepth->GestureValue(0, 32), 0.7f, 0.000001f);
+    REQUIRE_TRUE(targetDepth->GestureActive(0, 32));
+    REQUIRE_NEAR(targetNested->GestureValue(0, 63), 0.8f, 0.000001f);
+    REQUIRE_TRUE(targetNested->GestureActive(0, 63));
+    REQUIRE_TRUE(targetCarrier.ModulationDepthParameter(1) == nullptr);
+    REQUIRE_TRUE(targetGroup.LiveLocalParameterCount() == 2);
+
+    const float outputBeforeRematerialization = targetCarrier.GetRaw(0);
+    synth::Parameter* rematerialized = targetCarrier.EnsureModulationDepth(1);
+    REQUIRE_TRUE(rematerialized != nullptr);
+    target.ComputeAllParameters();
+    REQUIRE_NEAR(targetCarrier.GetRaw(0), outputBeforeRematerialization, 0.000001f);
+    REQUIRE_TRUE(rematerialized->Name() == "Carrier Mod Depth 2");
+    REQUIRE_NEAR(rematerialized->SceneCenter(0), 0.5f, 0.000001f);
+    REQUIRE_NEAR(rematerialized->GestureValue(0, 32), 0.5f, 0.000001f);
+    REQUIRE_NEAR(rematerialized->GestureValue(0, 63), 0.5f, 0.000001f);
+    REQUIRE_TRUE(!rematerialized->GestureActive(0, 32));
+    REQUIRE_TRUE(!rematerialized->GestureActive(0, 63));
+    REQUIRE_TRUE(rematerialized->ActiveRouteCount() == 0);
+    REQUIRE_TRUE(targetGroup.CollectNeutralLocalParameters() == 1);
+    REQUIRE_TRUE(targetCarrier.ModulationDepthParameter(1) == nullptr);
+    REQUIRE_TRUE(targetGroup.LiveLocalParameterCount() == 2);
+}
+
+TEST_CASE(eligible_collection_preserves_semantic_parameter_json) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(1);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 4});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.25f});
+    auto* neutral = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(neutral != nullptr);
+    auto* retained = carrier.EnsureModulationDepth(1);
+    REQUIRE_TRUE(retained != nullptr);
+    retained->GestureValue(0, 0) = 0.75f;
+
+    synth::JsonArena beforeArena(65536);
+    const synth::JSON before = manager.ParameterValuesToJSON(beforeArena);
+    REQUIRE_TRUE(!beforeArena.Failed());
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+    synth::JsonArena afterArena(65536);
+    const synth::JSON after = manager.ParameterValuesToJSON(afterArena);
+    REQUIRE_TRUE(!afterArena.Failed());
+    REQUIRE_TRUE(JsonSemanticallyEqual(before, after));
+}
+
+namespace {
+
 // Regression for slog-2: MidiSender's worker thread (Run()) must tag itself
 // with ThreadId::MidiSender so log messages produced while sending (and any
 // future thread-identity-sensitive code on that thread) observe the correct
 // identity. This sink records synth::GetCurrentThreadId() as observed from
 // inside Send(), which runs on the sender's worker thread.
 struct RecordingMidiOutputSink final : synth::IMidiOutputSink {
     std::mutex mutex;
     std::optional<synth::ThreadId> observedThreadId;

     void Send(const synth::BasicMidi&) override {
diff --git a/projects/synth/tests/portable_ui_tests.cpp b/projects/synth/tests/portable_ui_tests.cpp
index eace7945..179226f5 100644
--- a/projects/synth/tests/portable_ui_tests.cpp
+++ b/projects/synth/tests/portable_ui_tests.cpp
@@ -429,20 +429,42 @@ int main()
     const synth::ui::EncoderDrawState snapshotEncoder =
         synth::ui::EncoderDrawStateFromParameter(parameterState);
     Require(snapshotEncoder.baseColor == synth::Color::Red, "encoder uses snapshot base color");
     Require(snapshotEncoder.voices[0].indicatorColor == synth::Color::Blue,
             "encoder uses snapshot voice-zero indicator color");
     Require(snapshotEncoder.modulatorColors == std::vector<synth::Color>{synth::Color::Cyan},
             "encoder uses snapshot source badge colors");
     Require(snapshotEncoder.gestureColors == std::vector<synth::Color>{synth::Color::Orange},
             "encoder uses snapshot gesture badge colors");

+    Require(synth::ui::EncoderGeometry::BadgeText(false, 16) == "17", "gesture 16 badge is one-based");
+    Require(synth::ui::EncoderGeometry::BadgeText(false, 62) == "63", "gesture 62 badge is one-based");
+    Require(synth::ui::EncoderGeometry::BadgeText(false, 63) == "64", "gesture 63 badge is one-based");
+    synth::Parameter::UIState highGestureState(1, 0, 64);
+    highGestureState.connected.store(true);
+    highGestureState.voiceCount.store(1);
+    highGestureState.gesturesAffectingMask.store(std::uint64_t{1} << 63);
+    highGestureState.gestureColorCount.store(64);
+    for (std::size_t gestureIx = 0; gestureIx < 64; ++gestureIx) {
+        highGestureState.gestureColors[gestureIx].Store(synth::Color::Orange);
+    }
+    const synth::ui::EncoderDrawState highGestureEncoder =
+        synth::ui::EncoderDrawStateFromParameter(highGestureState);
+    Require(highGestureEncoder.gesturesAffectingMask == (std::uint64_t{1} << 63),
+            "encoder snapshot preserves gesture bit 63");
+    const auto highGestureCommands = synth::ui::BuildEncoderDrawCommands(
+        highGestureEncoder, {0.0f, 0.0f, 128.0f, 128.0f});
+    Require(std::any_of(highGestureCommands.begin(), highGestureCommands.end(), [](const auto& command) {
+                return command.kind == synth::ui::DrawCommand::Kind::Text && command.text == "64";
+            }),
+            "encoder renders gesture 63 as badge 64");
+
     static_assert(synth::SynthApplication<TestApp>);
     static_assert(!synth::ui::kPortableUiUsesJuce);
     static_assert(std::is_same_v<decltype(synth::ui::WaveformLayerDrawState::scope), const synth::ScopeWriter*>);
     static_assert(!std::is_copy_constructible_v<synth::ui::Visualizer>);
     static_assert(!std::is_copy_assignable_v<synth::ui::Visualizer>);
     static_assert(!std::is_move_constructible_v<synth::ui::Visualizer>);
     static_assert(!std::is_move_assignable_v<synth::ui::Visualizer>);
     TestVisualizer visualizer;
     Require(visualizer.Visible(), "visualizer is visible by default");
     visualizer.SetBounds({11.0f, 12.0f, 44.0f, 45.0f});
