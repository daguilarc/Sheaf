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

