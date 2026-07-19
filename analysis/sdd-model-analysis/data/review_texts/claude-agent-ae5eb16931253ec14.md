All confirmed. Here are the findings.

## 1. Does `state.connected` reflect the same "connected" concept as `slots[0].cells[ix].connected`?

Yes — it is literally the same underlying atomic field, not a different concept.

- `Braid4UiModel.hpp:291-334` (`SnapshotUiState`) builds `snapshot.encoders[ix]` via `synth::ui::EncoderDrawStateFromParameter(slotState.cells[ix])` at `Braid4UiModel.hpp:331`, where `slotState` is `uiState.slots[0]` (`Braid4UiModel.hpp:323`).
- `EncoderDrawStateFromParameter` (`projects/synth/include/synth/EncoderDraw.hpp:306-317`) sets `candidate.connected = state.connected.load(...)` at `EncoderDraw.hpp:317`, where `state` is a `synth::Parameter::UIState&` — i.e. exactly `slots[0].cells[ix]`.
- `BankSlot::UIState::cells` is declared as `std::unique_ptr<Parameter::UIState[]>` (`projects/synth/include/synth/ParameterModulation.hpp:624`), so `slots[0].cells[ix].connected` and the `.connected` read inside `EncoderDrawStateFromParameter` are the same `std::atomic<bool>` object.
- Semantically, `Parameter::UIState::connected` is set true only when a real parameter populates that cell (`Parameter::PopulateUIState`, `projects/synth/src/ParameterModulation.cpp:1052`, `state.connected.store(true, ...)`) and false via `SetDisconnected()` (`ParameterModulation.cpp:912-914`) otherwise. `BankSlot::PopulateUIState` (`ParameterModulation.cpp:2519-2535`) calls `SetDisconnected()` for any cell where `selectedBank_->VisibleCellFor(...)` returns a null parameter (`ParameterModulation.cpp:2528-2531`) — i.e. exactly the "gap" positions in the modulation view feature.
- The system test that exercises the Task‑1 feature confirms this directly: `braid4_system_tests.cpp:1035` (`REQUIRE_TRUE(ui->slots[0].cells[connected].connected.load())`) and `braid4_system_tests.cpp:1040` (`REQUIRE_TRUE(!ui->slots[0].cells[gap].connected.load())`) check the exact same field the new `Braid4UI.hpp` code reads.

So `!state.connected` in the new `continue` check correctly identifies modulation-view "gap" cells and does not conflate a different notion of encoder connectivity.

## 2. Is the loop used for both top-level and modulation-view rendering, and is hardcoded `slots[0]` a risk?

Yes, it's one single function/loop (`Braid4UiSurface::BuildTree`, `Braid4UI.hpp:31-96`) used unconditionally for every render — top-level bank view and modulation-depth view alike. There's no separate code path; the only branch is the new `if (showingModulationView && !state.connected) { continue; }` at `Braid4UI.hpp:65-68`. That's why gating solely on `showingModulationView` is both necessary and sufficient: when `showingModulationView` is false, the new `continue` can never fire (short-circuits), so top-level rendering is provably untouched by this diff.

Regarding hardcoded `slots[0]` (`Braid4UI.hpp:60`, `:73`, and pre-existing `Braid4UiModel.hpp:323`): Braid4 has exactly one bank slot. `Braid4Core.hpp:149` does `slot_ = &manager.CreateBankSlot();` (single call), and `Braid4Core.hpp:486` declares a single `synth::BankSlot* slot_` member — there is no array/vector of slots and no other `CreateBankSlot()` call anywhere in `projects/synth/apps/braid-4/`. So for Braid4 specifically, `slots[0]` is the only slot that ever exists and this is not a latent bug in this file. (Contrast: `MiniAppCore.hpp:133` also only creates one slot via `context_->parameterManager->CreateBankSlot()`, so the same reasoning holds there too — this appears to be a single-slot-per-app architecture, not multi-slot.)

## 3. Is Braid4UI.hpp the only production file touched (aside from ParameterModulation.cpp)?

Yes. The commit that introduces this exact render-loop change is `c81ed6d2` ("test(synth): cover disconnected modulation positions"); `git show --stat c81ed6d2` shows it touches:
- `projects/synth/apps/braid-4/Braid4UI.hpp` (production, +7 lines — this is the code under review)
- `projects/synth/docs/coverage.md` (docs)
- `projects/synth/tests/braid4_system_tests.cpp` (test)
- `projects/synth/tests/miniapp_system_tests.cpp` (test)
- `projects/synth/tests/portable_ui_tests.cpp` (test)

`Braid4UI.hpp` is the only production (non-test, non-doc) file in that commit. The other production file the user flagged, `projects/synth/src/ParameterModulation.cpp`, was changed in the separate, earlier commit `4c166f48` ("feat(synth): hide disconnected modulation depths"), whose stat (`git show --stat 4c166f48`) shows only `ParameterModulation.cpp` (production) plus `engine_tests.cpp` and `parameter_modulation_tests.cpp` (tests) — no other production files. No other production source file (e.g. `Braid4Core.hpp`, `MiniAppCore.hpp`, `StandardModulators.hpp`, etc., which do appear in the full epic branch diff from earlier, unrelated commits) is touched by either of these two commits.