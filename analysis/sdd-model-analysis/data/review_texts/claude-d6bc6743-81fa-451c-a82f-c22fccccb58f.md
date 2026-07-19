I've verified the complete change against the actual source (ButtonGrid, Color, Engine routing, Modules, MiniApp wrapper). Here is the final whole-change review.

## Final Review — MiniApp Just-Intonation Ratio Grid

I read the full corrected diff (`dbe70cf5..c026fc64`), the approved design, and the plan, then cross-checked every non-trivial claim against the live sources: `ButtonGrid.hpp/.cpp`, `Color.hpp`, `Engine.hpp`, `ParameterModulation.hpp` (`MessageInBus`), `Modules.hpp` (`CurrentInput`), and the MiniApp wrapper. The implementation matches the design precisely; I found no correctness, threading, realtime, or scope defects. The items below are non-blocking.

### Findings (ordered by severity)

**1. (Low — traceability) OpenSpec task 3.2 remains unchecked while 3.1 is checked** — `openspec/changes/add-miniapp-ji-ratio-grid/tasks.md:14` (diff line 441). Task 3.1 (verification) is `[x]` but 3.2 (spec-coverage note + task check-off) is `[ ]`. This is consistent with commit `7e6637d5` "leave final review task pending" and with this review being the pending final step, so it is intentional rather than an omission — but the change is not yet fully checked off, and no spec-sync/archive has been performed (correctly, since that awaits user instruction).

**2. (Low — test hygiene) Unchecked pointer deref in the Engine test app** — `projects/synth/tests/engine_tests.cpp` (diff ~line 761): `ctx->gridManager->GridAt(*gridIx)->RegisterCell(0, 0, ...)` dereferences `GridAt` without a null guard, unlike the production `MiniAppCore::Init` which checks `ratioGrid == nullptr`. `GridAt` cannot be null immediately after `CreateGrid`, so this is test-only and harmless, but it is slightly less defensive than the pattern it exercises.

**3. (Info — production reachability) The grid is not driven by any default MIDI mapping** — By design (plan Global Constraints; design "Non-Goals"), no default profile maps slot 0, so on real hardware the ratio grid is inert until a controller profile maps it; tests drive `GridManagerForTest().HandlePress(...)` directly. This is a documented, intentional scope boundary, noted here only for production-readiness completeness.

### Audit results

- **Correctness / ratios:** `kJiRatios` = `1/2, 3/4, 2/3, 1/1, 5/4, 3/2, 4/3, 2/1` with index 3 = `1.0f`; `6/5` absent; both rows init to `3` (unity). Sixteen cells over `[0,8)×[0,2)`. `MiniAppCore.hpp:305-311, 322`. Matches mrg-1 and the design exactly.
- **StateCell SetOnly / independence:** `StateCell<std::size_t>` `SetOnly` `OnPress` sets `*state_ = onState_ (=x)`; `OnRelease`/`OnPressureChange` are no-ops (`ButtonGrid.hpp:106-124`). Separate backing `&ratioSelections_[y]` per row gives independent selection; `GetOnOff()` = `selection==x` guarantees exactly one on-cell per row. Matches mrg-2.
- **RGB-dim vs alpha on/off:** off color = `ratioColor.AdjustBrightness(0.35f)` → `Darken` scales RGB, preserves nothing into alpha; `PopulateUIState` then overwrites `published.a = GetOnOff() ? 1 : 0` (`ButtonGrid.cpp:214-215`). Dimming is RGB-only; alpha is exactly 1/0. Matches the design and the test assertions.
- **Realtime / threading:** `AppContext::gridManager` is Init-only (topology declaration on the message/init thread). Runtime presses route through `Engine`'s own `gridManager_` inside `ProcessBlock` (`Engine.hpp:278-286`) — the bus drain (`HandlePress`→`OnPress` writing `ratioSelections_`) and the ratio read/multiply both execute on the audio thread, sequentially, in the same block. No data race, no lock, no allocation, no throw on the audio path. `ratioSelections_` is always in `[0,8)`, so the `kJiRatios[...]` index is bounded.
- **Signal path / no Tune mutation:** the multiply sits between `vcoModule_.SetInput(...)` and `vcoModule_.Process()` on the mutable prepared input (`MiniAppCore.hpp:232-236`); `SetInput` refreshes freq each frame so no cross-frame compounding. Tune raw value is untouched — the test asserts exact equality before/after. Matches mrg-3.
- **Lifecycle / loud failure:** every topology call (`GridRange::Create`, `CreateGrid`, `CreateSlot`, `GridAt`/`SlotAt`, `RegisterCell`, `SelectGridForSlot`) is checked and throws `std::logic_error` in `Init`, before audio — no partial grid can start. The pre-existing portable-surface test was correctly updated to supply a `GridManager` now that Init requires one.
- **Tests:** engine test proves Init-time declaration + post-Init finalization/publication; MiniApp tests prove exact geometry, unity startup, independent set-only selection, packed dim/full feedback, non-press invariance, and independent per-voice offsets with Tune unchanged. Coverage is faithful to the spec.
- **OpenSpec consistency:** proposal, design, `sar-3` (MODIFIED), and `synth-miniapp-ratio-grid` mrg-1/2/3 (ADDED) all agree with the code, including ratio order and the `6/5` exclusion.

SPEC COMPLIANCE: PASS
CODE QUALITY: PASS