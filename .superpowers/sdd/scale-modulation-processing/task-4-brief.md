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
