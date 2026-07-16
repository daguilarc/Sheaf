### Task 1: Test Observability and the Top-Level Processing Boundary

**OpenSpec coverage:** tasks 1.1-1.3, 3.1-3.3; `spm-72` scenarios “Materialized local depth does not add ProcessLite work” and “Recursive compute still refreshes local depth state.”

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp` — `ParameterProcessingObserver`, `ParameterGroup`, `Parameter` test-observer hooks and root list.
- Modify: `projects/synth/src/ParameterModulation.cpp` — registration, group processing, recursive local state seeding.
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — structural counters and recursive-display regression.
- Modify: `projects/synth/tests/braid4_system_tests.cpp` — Braid4 root/local structural assertion.

**Interfaces:**
- Produces: `struct ParameterProcessingObserver { std::size_t topLevelProcessLiteCalls; std::size_t localRecursiveComputeCalls; std::size_t activeRouteVisits; std::size_t activeGestureVisits; };`
- Produces: `void ParameterGroup::SetProcessingObserverForTests(ParameterProcessingObserver* observer)`; the caller owns the observer and may clear it with `nullptr`.
- Produces: `void ParameterGroup::RegisterTopLevelParameter(Parameter&)` and dense `std::vector<Parameter*> topLevelParameters_`.
- Consumes: existing `ParameterManager::RegisterParameter`, `ParameterGroup::ProcessSample`, `Parameter::ComputeAtDepth`, and `Parameter::SeedCachedKnobAndUiDisplayState`.

- [ ] **Step 1: Write RED structural tests before changing group processing**

Add a test that creates two roots, materializes a child and grandchild, attaches an observer, and processes both an ordinary sample and a compute-cadence sample:

```cpp
TEST_CASE(group_process_sample_visits_only_registered_roots) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2,
                                       .numScenes = 1, .maxParameters = 8,
                                       .targetComputeIntervalSamples = 16});
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});
    (void)manager.CreateParameter(group, {.name = "Tone"});
    auto& depth = carrier.EnsureModulationDepth(0, {.name = "Carrier M1", .defaultValue = 0.5f});
    (void)depth.EnsureModulationDepth(1, {.name = "Carrier M1 M2", .defaultValue = 0.5f});
    synth::ParameterProcessingObserver work{};
    group.SetProcessingObserverForTests(&work);

    group.ProcessSample(1);
    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 2);
    REQUIRE_TRUE(work.localRecursiveComputeCalls == 0);

    group.ProcessSample(16);
    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 4);
    REQUIRE_TRUE(work.localRecursiveComputeCalls == 2);
}
```

Add a second test that gives the local depth a non-default scene center, calls the compute cadence, and asserts its cached/UI center equals `GetRaw(0)` and spread is zero. Extend Braid4's structural test to record the root count, materialize neutral local depths, run one internal subframe, and assert exactly that root count of `ProcessLite` visits.

- [ ] **Step 2: Run the RED tests and capture the expected failure**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests build/braid4_system_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/braid4_system_tests
```

Expected: compilation fails because `ParameterProcessingObserver` and `SetProcessingObserverForTests` do not exist; after only adding the observer declarations, the structural test fails because the current group loop calls `ProcessSample` for every local index.

- [ ] **Step 3: Add the observer and dense root-list contract**

Add the observer next to `ParameterProcessingTiming`, and add these members to `ParameterGroup`:

```cpp
void SetProcessingObserverForTests(ParameterProcessingObserver* observer) { processingObserver_ = observer; }

private:
    void RegisterTopLevelParameter(Parameter& parameter);
    std::vector<Parameter*> topLevelParameters_;
    ParameterProcessingObserver* processingObserver_ = nullptr;
```

In `ParameterManager::RegisterParameter`, call `group.RegisterTopLevelParameter(created)` only after the new ID/name registration has succeeded. Do not call it from `EnsureModulationDepth` or `CreateLocalParameter`.

- [ ] **Step 4: Replace the group hot loop and retain recursive compute**

Implement the group loop as a root-only loop and count only actual root `ProcessLite` calls:

```cpp
void ParameterGroup::ProcessSample(std::uint64_t sampleIndex) {
    for (Parameter* parameter : topLevelParameters_) {
        parameter->ProcessSample(sampleIndex);
        if (processingObserver_ != nullptr) {
            ++processingObserver_->topLevelProcessLiteCalls;
        }
    }
}
```

In `Parameter::ComputeAtDepth`, increment `localRecursiveComputeCalls` when `recursionDepth > 0`. Keep the existing recursion-before-parent-depth derivation order. For local nodes, keep `SeedCachedKnobAndUiDisplayState()` after copying targets to currents; this pins the intentional local display behavior: center is seeded from the recursive value and spread energy is reset to zero at each compute cadence.

- [ ] **Step 5: Run focused and surrounding tests**

Run the two commands from Step 2 plus:

```bash
make -C projects/synth build/module_tests build/engine_tests build/rig_tests
projects/synth/build/module_tests
projects/synth/build/engine_tests
projects/synth/build/rig_tests
```

Expected: all five binaries exit 0; the new observer reports two root visits per sample regardless of the two materialized locals, while recursive local count changes only on cadence.

- [ ] **Step 6: Commit and pass the global Claude gate**

```bash
git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/braid4_system_tests.cpp
git commit -m "perf(synth): process only top-level parameters per sample"
```

Generate the review package from the task's starting commit through `HEAD`, run the global Sonnet gate, fix and re-review Critical/Important findings, and record both passing verdicts in `.superpowers/sdd/progress.md`.

---

