All four reviewer findings are fixed, verified, and committed.

**Status:** complete, all four findings fixed and verified.

**Commit:** `729666ae72a28f0b24bc604b87ee19b00457d118` — "fix(synth): sink clear synchronization, startup reconcile gate, manual-open names"

**Test summary:** `make -C projects/synth build test` — 338 passed, 0 failed, zero warnings on a clean rebuild (up from 325 baseline: +7 `PlanMidiConnectionResize` cases, +6 new `midi_sender_tests` cases). New `midi_sender_tests` binary run 8x standalone, zero failures. `make -C projects/synth apps` links cleanly with zero warnings; `apps/miniapp` test target also passes.

**What changed:**
1. **Critical (sink use-after-free):** Added `MidiSender::ClearSinkSync(sinkIx)` — tracks `sendingSinkIx_` under the sender's mutex and blocks on a new `sendingCv_` until any in-flight `Send()` on that sink completes, while leaving `Send()` itself unlocked and other sinks unaffected. `MidiConnectionManager`'s destructor and `ResizeToControllerCount`'s shrink path now call `ClearSinkSync` (not `SetSink(ix, nullptr)`) before destroying output handlers.
2. **Important (startup double-reconcile):** Added a `started_` gate to `MidiConnectionManager`. `OnInstrumentRebuilt()` now only reconciles when `started_` is true; `StartupReconcile()` sets it after its own reconcile pass. A startup-patch rebuild inside `engine.Initialize()` (which fires the rebuilt callback before `Runtime::Start()` reaches `StartupReconcile()`) now only resizes vectors, never double-reconciles.
3. **Important (manual opens lose device names):** `ManualOpenInput`/`ManualOpenOutput` gained a `name` parameter, threaded from `MidiPanel`'s new `SelectedInputName()`/`SelectedOutputName()` accessors (reading the same enumerated `juce::MidiDeviceInfo` list used for identifiers) into the stored `EditInstrument` ref, restoring name-fallback reconnect matching.
4. **Minor (resize untested):** Extracted `synth::PlanMidiConnectionResize(oldCount, newCount)` into `include/synth/MidiReconcile.hpp`/`src/MidiReconcile.cpp` as a pure, JUCE-free helper; `ResizeToControllerCount` now executes its plan. 7 new unit tests cover growth, shrink, shrink-to-zero, and both no-op cases.

**Key files:** `projects/synth/include/synth/MidiController.hpp`, `projects/synth/src/MidiController.cpp`, `projects/synth/runtime/MidiConnectionManager.hpp`, `projects/synth/runtime/MidiPanel.hpp`, `projects/synth/include/synth/MidiReconcile.hpp`, `projects/synth/src/MidiReconcile.cpp`, `projects/synth/tests/midi_sender_tests.cpp` (new), `projects/synth/tests/reconcile_executor_tests.cpp`, `projects/synth/Makefile`.

**Concerns:** Fix 2's `started_` gate has no dedicated automated test proving the pre-startup skip end-to-end (would need a JUCE-level or rig-style harness triggering a startup-patch rebuild) — verified by code reading and confirming `Runtime.hpp`'s callback wiring is unchanged. Full fix report appended to `.superpowers/sdd/p3-task-2-report.md` (gitignored, not part of the commit).