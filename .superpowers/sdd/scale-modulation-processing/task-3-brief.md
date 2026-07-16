### Task 3: Stable-Identity Active Modulation Route Prefixes

**OpenSpec coverage:** tasks 1.2 and 4.1-4.5; remaining `spm-72` active-prefix scenarios. Task 1.2's full-scan oracle is implemented and closed here.

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

