Commit landed at `6d86492`. Report already appended to `.superpowers/sdd/p1-task-4-report.md`.

**Status: complete**

**Commit:** `6d86492b4b927853f10832ee58d8bf14b1064d7c`

**Test summary:** 280/280 tests pass, zero warnings, zero errors (`make -C projects/synth build test`); `make -C projects/synth miniapp` builds and links clean.

Summary of changes:
- **Critical fix** (`Engine.hpp` `RebuildMidiProcessors()`): now takes `audioDeviceStateMutex_`, copies `controllers.front().config` (or a default-empty profile) into a local snapshot under the lock, releases it, then builds `midiProcessors_` from the snapshot outside the lock — closing the data race with the audio-side `ApplyPatchMessage` mutations of `instrumentConfig_`. Audited every other reader of `instrumentConfig_`; all others already lock correctly or are documented/intentional exceptions (`LiveInstrument()`, pre-audio `Initialize()` snapshot).
- **Minor fix**: stale `midiProfileConfig` wording updated in `Engine.hpp` (~line 149, careful to preserve the historically-accurate old-miniapp code quote while clarifying it's not current) and `runtime/MidiPanel.hpp` (~line 128).
- **Test**: added `engine_rebuild_midi_processors_observes_fully_applied_edit_snapshot` to `engine_tests.cpp`, exercising the snapshot-then-build contract for both populated and empty controller lists after a serialized `EditInstrument` mutation. A true concurrent stress test isn't feasible in this single-threaded harness — noted in the report; relies on the lock-discipline fix plus the pre-existing `engine_edit_instrument_and_pending_patch_load_same_tick_observe_serialized_order` test.