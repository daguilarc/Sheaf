# Scale Modulation Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make parameter processing scale with top-level parameters, active/settling modulation routes, and active gestures while supporting 64 gestures and safely recycling neutral local modulation controls.

**Architecture:** `ParameterGroup` owns a dense list of manager-registered roots plus fixed-storage route permutations and a reusable local-slot pool. Each `Parameter` recursively computes local controls at control cadence, keeps stable source identities through compact route slots, and evaluates gestures from 64-bit masks. Collection walks roots bottom-up only at control/UI boundaries, detaches neutral unpinned leaves, and reinitializes their existing storage in place on reuse.

**Tech Stack:** C++20, the existing arena/span parameter storage, atomic UI snapshots, custom `TEST_CASE` binaries driven by `projects/synth/Makefile`, OpenSpec.

## Global Constraints

- Preserve patch JSON schema and the public meaning of modulator and gesture indices.
- Preserve manager-owned top-level `Parameter` addresses and IDs.
- Keep allocation, deallocation, locks, graph traversal, and collection out of the per-sample path.
- Support gesture counts `0..64`; reject `65` before any group is created and without mutating the previous topology.
- Keep settling routes active until every voice's current and target depth is within the existing `1e-6` neutral tolerance, then snap and remove only at a control boundary.
- Keep `parameterCount_` and `ParameterByLocalIndex` as high-water storage inspection; expose separate live-local and free-slot counts.
- Gestures 0-7 retain numeric labels, 8-15 retain directional labels, and 16-63 use distinct one-based numeric labels `17` through `64`.
- Browser command buffers contain rendered draw commands, not gesture masks: do not add compatibility, versioning, serialization, or wire-layout work.
- After every task, generate an exact base-to-head review package and run an xagent Claude review. The prompt must request separate `SPEC COMPLIANCE` and `CODE QUALITY` verdicts plus Critical/Important/Minor findings with file:line evidence. Use Sonnet for Tasks 1, 2, 5, and 6; use Opus for Tasks 3 and 4. Do not begin the next task until both verdicts pass and all Critical/Important findings are fixed and re-reviewed. Immediately after approval, mark only that task's mapped OpenSpec checkboxes complete, re-run strict validation, and include that synchronized artifact in the task commit or a small follow-up commit before starting the next task.

---

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

### Task 2: 64-Bit Sparse Gesture Core and UI

**OpenSpec coverage:** tasks 2.1-2.4; `spm-20`, `spm-25`, and all `spm-73` scenarios.

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp` — `Gestures`, gesture arenas, `Parameter::UIState`, mask-return types.
- Modify: `projects/synth/src/ParameterModulation.cpp` — 0-64 validation, set-bit compute/edit iteration, snapshots.
- Modify: `projects/synth/include/synth/EncoderDraw.hpp` — 64-bit draw snapshot and high-index badges.
- Inspect: `projects/synth/src/MidiController.cpp` — confirm its existing 32-bit affecting mask selects banks, not gestures; change it only if a separate gesture-indexed selector is found.
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — boundaries, sparse visit counts, messages, persistence, randomized mask oracle.
- Modify: `projects/synth/tests/portable_ui_tests.cpp` — bit-63 render and labels.
- Modify: `projects/synth/tests/instrument_tests.cpp` — controller/UI mask boundary.

**Interfaces:**
- Produces: `using GestureMask = std::uint64_t;` in `synth` namespace.
- Produces: `GestureMask Gestures::SelectedMask() const`, `GestureMask Parameter::GesturesAffectingMask() const`, and `GestureMask Bank::GesturesAffectingMask() const`.
- Produces: one `GestureMask` active selector per parameter scene, replacing `gestureActiveArena_` bytes.
- Consumes: Task 1's observer; increment `activeGestureVisits` only when a set bit is evaluated.

- [ ] **Step 1: Write RED boundary, sparse-work, UI, and label tests**

Cover counts 0, 1, 32, 33, 64, and rejected 65; indices 0, 31, 32, and 63; and preservation of the old topology after rejection. Add a sparse-work test with 64 configured gestures and no active bits:

```cpp
synth::ParameterProcessingObserver work{};
group.SetProcessingObserverForTests(&work);
parameter.Compute(manager.Scene());
REQUIRE_TRUE(work.activeGestureVisits == 0);
parameter.SetGestureActive(0, 63, true);
manager.SetGestureValue(63, 0.75f);
parameter.Compute(manager.Scene());
REQUIRE_TRUE(work.activeGestureVisits == 1);
REQUIRE_TRUE((parameter.GesturesAffectingMask() & (std::uint64_t{1} << 63)) != 0);
```

In portable UI tests, store `std::uint64_t{1} << 63`, build encoder draw commands, and assert a text command contains `"64"`. Also assert `BadgeText(false, 16) == "17"`, `BadgeText(false, 62) == "63"`, and `BadgeText(false, 63) == "64"`.

- [ ] **Step 2: Run the RED suite**

```bash
make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/instrument_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/portable_ui_tests
projects/synth/build/instrument_tests
```

Expected: compilation or assertions fail at the 32-bit mask fields, count 64, index 63, and collapsed badge label.

- [ ] **Step 3: Introduce `GestureMask` and replace scan storage**

Use one type everywhere the selector crosses parameter/UI/controller boundaries:

```cpp
using GestureMask = std::uint64_t;

class Gestures {
public:
    GestureMask SelectedMask() const { return selectedMask_; }
private:
    GestureMask selectedMask_ = 0;
};
```

Replace `std::vector<bool> selected_` with `selectedMask_`, replace the per-scene byte active arena with `std::vector<GestureMask> gestureActiveMaskArena_`, and bind each `Parameter` to `std::span<GestureMask> gestureActiveMasks_` of length `numScenes`. Change `Parameter::UIState::gesturesAffectingMask`, encoder draw snapshot masks, and all matching locals/returns to `std::uint64_t`. Leave `GestureManagerUIState::bankAffectingMask` as `std::uint32_t` because it selects banks, not gestures.

- [ ] **Step 4: Add one checked set-bit iterator and migrate compute/edit paths**

Define a local C++20 helper used by compute and edit distribution:

```cpp
template <class Fn>
void ForEachGestureBit(GestureMask mask, Fn&& fn) {
    while (mask != 0) {
        const std::size_t ix = std::countr_zero(mask);
        mask &= mask - 1;
        fn(ix);
    }
}
```

Mask off bits above `GestureCount()` when forming scene unions. In `ComputeRawCenter`, iterate `gestureActiveMasks_[left] | gestureActiveMasks_[right]`; keep `EffectiveGestureWeight` and weighted-blend math unchanged. In arming use `Gestures::SelectedMask`; in edit distribution use the active scene union. Increment the observer once per evaluated set bit, not once per configured slot.

- [ ] **Step 5: Validate count mutation and render high badges**

In `SetGestureCount`, reject `count > 64` before constructing new gesture storage or touching groups. Update `EncoderGeometry::BadgeText` so the existing 0-15 branch remains intact and the final branch is:

```cpp
return std::to_string(index + 1);
```

Extend message-bus and patch round-trip fixtures to select, activate, serialize, reload, and publish gestures 32 and 63. Change the randomized UI oracle mask type and expected comparisons to `GestureMask`, exercising bit 63 deterministically.

- [ ] **Step 6: Run tests, commit, and pass the global Claude gate**

Run Step 2's commands; all three binaries must exit 0. Then:

```bash
git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/include/synth/EncoderDraw.hpp projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/portable_ui_tests.cpp projects/synth/tests/instrument_tests.cpp
git commit -m "feat(synth): support sparse 64-bit gestures"
```

Run the global Sonnet gate and record both passing verdicts.

---

### Task 3: Stable-Identity Active Modulation Route Prefixes

**OpenSpec coverage:** tasks 4.1-4.5; remaining `spm-72` active-prefix scenarios. Task 1.2's full-scan oracle is consumed here but is not closed twice.

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp` — compact apply API, route permutation arenas/accessors.
- Modify: `projects/synth/src/ParameterModulation.cpp` — activation, swap-removal, compact slew/application, invariants.
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — full-scan oracle and zero/sparse/dense/settling/randomized cases.
- Modify: `projects/synth/tests/module_tests.cpp` — module-level audio equivalence.

**Interfaces:**
- Produces: `float Modulators::ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths, std::span<const std::size_t> sourceIndices) const`.
- Produces: `std::size_t Parameter::ActiveRouteCount() const`, `std::span<const std::size_t> Parameter::ActiveRouteSourceIndices() const`, and `std::size_t Parameter::RoutePositionForSource(std::size_t sourceIx) const` for tests/debugging.
- Produces: fixed-capacity per-parameter `routeSourceIndices_`, `sourceRoutePositions_`, and `activeRouteCount_`; internal current/target depths are voice-major by route slot. Replace tests/callers that assumed the public `CurrentDepths`/`TargetDepths` spans were source-ordered with explicit `CurrentDepthForSource`/`TargetDepthForSource` accessors, and name any remaining slot-ordered spans `CurrentDepthSlots`/`TargetDepthSlots` so their semantics cannot be mistaken for stable source order.
- Consumes: Task 1's `activeRouteVisits` observer field.

- [ ] **Step 1: Add a source-indexed full-scan oracle and RED equivalence tests**

Keep the oracle test-only and independent of production permutations:

```cpp
float FullScanApply(const synth::Modulators& modulators, std::size_t voiceIx,
                    std::span<const float> depthsBySource) {
    float sum = 0.0f;
    for (std::size_t sourceIx = 0; sourceIx < depthsBySource.size(); ++sourceIx) {
        sum += modulators.Value(voiceIx, sourceIx) * depthsBySource[sourceIx];
    }
    return sum;
}
```

Add tests for no routes, sources `{0, 3}`, all sources, activation order `{3, 0, 2}`, swap-removal of source 0, two voices where only voice 1 is nonzero, a nested depth route, scene return-to-zero, and exact source metadata/JSON keys after swaps. At every sample reconstruct `depthsBySource[routeSourceIndices[slot]]` and compare `GetRaw`, current/target depths, and cached values with the oracle.

- [ ] **Step 2: Run RED route tests**

```bash
make -C projects/synth build/parameter_modulation_tests build/module_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/module_tests
```

Expected: compilation fails for the new active-route API/accessors; after declarations only, zero-depth allocated routes still produce full-width visit counts.

- [ ] **Step 3: Add fixed route permutation storage and invariants**

Add two `std::size_t` arenas sized `maxParameters * numModulators`, bind spans in both `Parameter` constructors, and initialize each slot to identity. Maintain this bijection:

```cpp
for (std::size_t slot = 0; slot < group_.Config().numModulators; ++slot) {
    assert(sourceRoutePositions_[routeSourceIndices_[slot]] == slot);
}
```

`EnsureRouteActive(sourceIx)` swaps the source's slot with `activeRouteCount_`, swaps current and target depth values for that pair in every voice, fixes both inverse positions, then increments the count. `RemoveActiveRoute(slot)` swaps with `activeRouteCount_ - 1`, fixes all voice depths and inverse positions, then decrements. Source-indexed editing, `modulationDepths_`, metadata, affecting masks, and JSON remain unchanged. Keep stable-source accessors for assertions and indexed control code; never expose a route-slot span under a source-indexed name.

- [ ] **Step 4: Build the per-parameter across-voice active union at compute cadence**

For each stable source index, recursively compute its child first, derive the target for every voice, activate the source if any target is non-neutral or its existing current slot is still non-neutral, and write targets into its route slot. Normalize center scale/offset/min/max by iterating `[0, activeRouteCount_)`. After targets are written, scan the active prefix backward; snap and swap-remove a route only when all voices have `abs(current) <= 1e-6` and `abs(target) <= 1e-6`.

Use a backward loop so swap-removal cannot skip the moved slot:

```cpp
for (std::size_t slot = activeRouteCount_; slot-- > 0;) {
    if (RouteNeutralAcrossVoices(slot)) {
        SnapRouteToZero(slot);
        RemoveActiveRoute(slot);
    }
}
```

- [ ] **Step 5: Migrate the hot paths to compact spans**

Implement `ApplyActive` with equal-length validation and stable source lookup:

```cpp
float Modulators::ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths,
                              std::span<const std::size_t> sourceIndices) const {
    if (activeDepths.size() != sourceIndices.size()) {
        throw std::invalid_argument("active depth and source index counts differ");
    }
    float result = 0.0f;
    for (std::size_t slot = 0; slot < activeDepths.size(); ++slot) {
        result += Value(voiceIx, sourceIndices[slot]) * activeDepths[slot];
    }
    return result;
}
```

Change `GetRaw`, `TargetValue`, and `ProcessLite` to pass only the active prefix and its source-index prefix. Slew only active route slots and increment `activeRouteVisits` once per route slot per voice actually visited. Keep the old source-indexed full scan only in test code; no production caller may use `Modulators::Apply` afterward.

- [ ] **Step 6: Extend the randomized oracle, run tests, commit, and pass Opus**

Add route/source and source/route arrays to the existing deterministic oracle. After every generated edit, compute, process, reset, and patch action, assert the bijection, active prefix, current/target state by stable source, cached output, and masks. Run Step 2's commands; both binaries must exit 0. Then:

```bash
git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/module_tests.cpp
git commit -m "perf(synth): traverse only active modulation routes"
```

Run the global Opus gate. The review prompt must explicitly audit source identity through swaps, across-voice union semantics, normalization, and settling-tail removal. Record both passing verdicts.

---

### Task 4: Safe Bottom-Up Local Node Collection and Slot Reuse

**OpenSpec coverage:** tasks 5.1-5.6; all `spm-74` scenarios.

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp` — collection, pin, reuse, and capacity APIs.
- Modify: `projects/synth/src/ParameterModulation.cpp` — eligibility, bottom-up detach, free-list accounting, in-place reset, safe-boundary calls.
- Modify: `projects/synth/src/PatchPersistence.cpp` — patch-load collection boundary.
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — lifecycle, pointer safety, capacity, semantic JSON, randomized collection.

**Interfaces:**
- Produces: `std::size_t ParameterGroup::CollectNeutralLocalParameters()`, `LiveLocalParameterCount() const`, and `FreeLocalParameterSlotCount() const`.
- Produces: private `Parameter::PinLocalForView()`, `UnpinLocalForView()`, `CanRecycleLocal() const`, `CollectNeutralChildren()`, and `ResetLocalForReuse(ParameterId, ParameterConfig)`; `Bank` is a friend for view pinning.
- Produces: `RecycledLocalSlot { Parameter* parameter; ParameterStorageBatch* batch; std::size_t slotIx; std::size_t storageLocalIx; }` entries owned by the group.
- Consumes: Task 1's root list and Task 3's active/settling route state.

- [ ] **Step 1: Write RED eligibility, pinning, and capacity tests**

Create one test per retention reason: non-default scene center, non-default latent gesture value even when inactive, active gesture, nonzero current/target/normalization state, non-collectible child, and an open modulation view pin. Add a recursive neutral-subtree test, then this reuse shape:

```cpp
const std::size_t highWater = group.ParameterCount();
const std::size_t availableBefore = group.AvailableParameterSlots();
bank.Deselect();
REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 2);
REQUIRE_TRUE(group.ParameterCount() == highWater);
REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 2);
REQUIRE_TRUE(group.AvailableParameterSlots() == availableBefore + 2);
auto* reused = otherRoot.EnsureModulationDepth(1);
REQUIRE_TRUE(reused != nullptr);
REQUIRE_TRUE(group.ParameterCount() == highWater);
REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
```

Keep an old local pointer only while its bank view is open and prove collection retains it. After close, do not dereference it once collection succeeds; locate reused topology through the new parent instead.

- [ ] **Step 2: Run RED collection tests**

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: compilation fails because collection/count APIs do not exist.

- [ ] **Step 3: Pin visible locals and collect children bottom-up**

When `Bank::OpenModulationView` installs local depth parameters in `visible_`, increment each local's pin count. `Bank::Deselect` first removes the visible mapping and decrements exactly those pins, clears `selected_`, then asks the affected group to collect. Never pin the top-level target.

Implement recursive collection from every `topLevelParameters_` root. Visit a child's children first; detach `modulationDepths_[sourceIx]` only if the child is unpinned, has no remaining children, every scene/gesture value and active bit is default, and all current/target center, scale, normalization, depth, and UI-affecting state is neutral. A current nonzero route settling to zero is not collectible.

- [ ] **Step 4: Add keyed free slots and central in-place reinitialization**

Store the original backing batch pointer and backing `slotIx` with each recycled object. Keep `parameterCount_` unchanged as the high-water object count and keep `ParameterByLocalIndex` enumerating the same storage objects. Track `liveLocalParameterCount_` separately and define:

```cpp
std::size_t ParameterGroup::AvailableParameterSlots() const {
    return unallocatedInitialSlots + unallocatedBatchSlots + recycledLocalSlots_.size();
}
```

Before allocating initial or batch storage, `CreateLocalParameter` pops a compatible recycled slot, calls `ResetLocalForReuse`, increments the live-local count, and returns the same object address. `ResetLocalForReuse` replaces ID/config and resets every scalar/span: centers to the clamped default, scale to one, offsets/depths/spread/masks/pins to zero, gesture values to the new clamped default, current/target min and max to that same unmodulated default center, child pointers to null, route permutations to identity, active route count to zero, and cached/UI center from the default. Do not allocate inside reset.

- [ ] **Step 5: Invoke collection only at safe boundaries and verify persistence**

Call collection after bank modulation view close/deselect, reset/revert completion, and successful patch load after all values/topology are applied. Do not call it from `ProcessSample`, `ProcessLite`, `GetRaw`, `ComputeAtDepth`, or modulation application.

Serialize semantic JSON before and after eligible collection and compare parsed values, not string key order. Round-trip a non-default nested route plus gestures 32 and 63 and assert it is retained; round-trip a default omitted child and assert lazy rematerialization produces identical audio and fully reset metadata/state. Repeat edit/collect/reuse for more iterations than `maxParameters` and assert high-water capacity remains bounded.

- [ ] **Step 6: Run tests, commit, and pass Opus**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests build/engine_tests build/miniapp_system_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/engine_tests
projects/synth/build/miniapp_system_tests
```

Expected: all binaries exit 0, semantic JSON is unchanged by eligible collection, visible pointers remain pinned, and repeated cycles stop growing high-water storage. Then:

```bash
git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/src/PatchPersistence.cpp projects/synth/tests/parameter_modulation_tests.cpp
git commit -m "perf(synth): recycle neutral modulation controls"
```

Run the global Opus gate. Require explicit review of raw-pointer lifetime, detach ordering, every stale-state field, backing-slot compatibility, high-water/index semantics, and absence of collection from the audio path. Record both passing verdicts.

---

### Task 5: Randomized, Persistence, UI, and Controller Integration

**OpenSpec coverage:** tasks 2.4, 4.5, 5.5-5.6, and modified `spm-25` as an integrated state-machine requirement.

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` — manager-owned 64-gesture oracle, permutations, collection/reuse actions, failure diagnostics.
- Modify: `projects/synth/tests/portable_ui_tests.cpp` — full snapshot-to-render bit-63 path.
- Modify: `projects/synth/tests/instrument_tests.cpp` — gesture/controller integration.
- Modify: `projects/synth/tests/browser_command_buffer_tests.cpp` only if an existing draw-command expectation changes because badge text changes; do not add mask fields or versions.

**Interfaces:**
- Consumes: all Tasks 1-4 production APIs.
- Produces: deterministic reference-model coverage for stable route identity, 64-bit masks, slot collection/reuse, and semantic JSON.

- [ ] **Step 1: Extend the randomized model before its production-action wiring**

Change simulated gesture selectors and expected affecting masks to `std::uint64_t`. Store `routeSourceIndices`, inverse positions, `activeRouteCount`, live/free slot identity, and pin state in `SimParam`/`SimOracle`. Add deterministic operations for gesture indices 32/63, route activation/removal, bank open/close, reset/revert, collect, reuse under a distinct parent, and patch load.

After every action validate both models with an error payload containing seed, step, action/message, random samples consumed, stable source index, route slot, expected/actual mask, and expected/actual current/target value.

- [ ] **Step 2: Run the oracle and observe RED model/production mismatches**

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: the newly modeled actions fail until their message/view/collection wiring and comparison extraction are complete; failures print the deterministic seed and step.

- [ ] **Step 3: Wire all existing external operations through the extended oracle**

Drive edits only through `MessageInBus` where a message exists, including normal and modified bank selection. Preserve the production random-source consumption order by drawing exactly the same samples in the oracle. Populate UI periodically and compare connected cells' centers, spreads, switch buckets, bipolar/min/max metadata, colors, all visible modulator bits, gesture bits `0..63`, manager gesture state, scenes/blend, modifiers, and selected bank/view state.

For GC-only control-boundary operations with no message type, invoke the same public manager/bank API used by production and mirror it in the oracle; do not invent a browser or patch wire command.

- [ ] **Step 4: Finish cross-surface integration assertions**

In portable UI, pass a real `Parameter::UIState` carrying bit 63 through snapshot and renderer and assert the distinct `64` badge command. In instrument/controller tests, verify controller gesture index 63 selects/edits the same manager gesture and that bank-affecting masks remain 32-bit bank selectors. Run browser command-buffer tests only to prove rendered command output remains valid; make no serialization/layout change.

- [ ] **Step 5: Run integration tests, commit, and pass the global Claude gate**

```bash
make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/instrument_tests build/browser_command_buffer_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/portable_ui_tests
projects/synth/build/instrument_tests
projects/synth/build/browser_command_buffer_tests
```

Expected: all four binaries exit 0 and repeated runs use the same seeds and consume identical samples. Then:

```bash
git add projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/portable_ui_tests.cpp projects/synth/tests/instrument_tests.cpp projects/synth/tests/browser_command_buffer_tests.cpp
git commit -m "test(synth): cover sparse modulation lifecycle end to end"
```

If `browser_command_buffer_tests.cpp` is unchanged, omit it from `git add`. Run the global Sonnet gate and record both passing verdicts.

---

### Task 6: Braid4 Structural/Deadline Regression and Coverage Closure

**OpenSpec coverage:** tasks 6.1-6.4; coverage rows for `spm-20`, `spm-72`, `spm-73`, `spm-74`, and modified `spm-25`.

**Files:**
- Modify: `projects/synth/tests/braid4_deadline_tests.cpp` — baseline/materialized-neutral/sparse-active/64-inactive cases at two host rates.
- Modify: `projects/synth/tests/braid4_system_tests.cpp` — authoritative work-count assertions.
- Modify: `projects/synth/docs/coverage.md` — requirements/scenarios and timing limitations.

**Interfaces:**
- Consumes: `ParameterProcessingObserver` counters from Task 1 and sparse visit counts from Tasks 2-3.
- Produces: deterministic complexity guards plus secondary average/p99 timing evidence.

- [ ] **Step 1: Add RED Braid4 scenario accounting**

Create four rig configurations: baseline; all available local depth nodes materialized but neutral; a sparse active set; and 64 configured but inactive gestures. For the 64-gesture case, call `context.parameterManager->SetGestureCount(64)` before `Engine::Initialize` invokes `Braid4Core::Init` and creates any groups; do not add a shipping Braid4 mode. For the same processed internal-subframe count, assert:

```cpp
REQUIRE_TRUE(neutral.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
REQUIRE_TRUE(inactive64.activeGestureVisits == 0);
REQUIRE_TRUE(sparse.activeRouteVisits > 0);
REQUIRE_TRUE(sparse.activeRouteVisits < denseConfiguredRouteVisits);
```

Run measured deadline cases at 48 kHz host/192 kHz internal and 96 kHz host/384 kHz internal. Record average and p99 for baseline and sparse-active, retaining generous platform-appropriate ceilings already used by the test instead of asserting a fragile speedup ratio.

- [ ] **Step 2: Run the Braid4 tests**

```bash
make -C projects/synth build/braid4_system_tests build/braid4_deadline_tests
projects/synth/build/braid4_system_tests
projects/synth/build/braid4_deadline_tests
```

Expected before final fixture wiring: structural scenario assertions fail or do not compile; after wiring, both binaries exit 0 and print timing lines for both rates.

- [ ] **Step 3: Update requirement coverage precisely**

Add a new `spm-20` row, update `spm-25` for 64-bit randomized masks, and add `spm-72`, `spm-73`, and `spm-74` rows. Each row must name the exact test cases introduced by Tasks 1-6. State that deterministic visit counters are the complexity contract and deadline measurements are secondary, platform-sensitive smoke evidence.

- [ ] **Step 4: Run the complete synth verification matrix**

```bash
make synth-test
openspec validate scale-modulation-processing --strict
```

Expected: every synth test target, including parameter modulation, modules, persistence/engine, portable UI, browser command buffer, MIDI/controller, Braid4 system, Braid4 deadline, and randomized oracles, exits 0; OpenSpec reports the change valid. No browser format/version diff should exist.

- [ ] **Step 5: Commit and pass the final task gate**

```bash
git add projects/synth/tests/braid4_deadline_tests.cpp projects/synth/tests/braid4_system_tests.cpp projects/synth/docs/coverage.md
git commit -m "test(synth): guard sparse modulation scaling"
```

Run the global Sonnet gate and record both passing verdicts.

- [ ] **Step 6: Run final cross-task Opus review and synchronize OpenSpec tasks**

Generate one exact review package from the pre-Task-1 base through `HEAD`. Run xagent Claude Opus with the proposal, design, delta spec, implementation plan, test results, and review package. Require separate final `SPEC COMPLIANCE` and `CODE QUALITY` verdicts and explicit audit of audio equivalence, source identity, settling tails, 64-bit boundaries, pointer lifetime, capacity accounting, and audio-thread safety. Fix/re-run/re-review any Critical/Important finding.

Every mapped checkbox must already have been synchronized after its owning task review. Only after the final Opus verdicts and Step 4 verification pass, confirm no checkbox was closed without its evidence, re-run strict validation, and commit any final evidence-only correction to the artifact:

```bash
git add openspec/changes/scale-modulation-processing/tasks.md
git commit -m "docs(openspec): complete sparse modulation processing change"
```
