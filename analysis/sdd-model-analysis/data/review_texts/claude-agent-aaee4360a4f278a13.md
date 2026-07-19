Confirmed — `.superpowers/sdd/` is intentionally gitignored (report artifacts, not committed source). Everything is in order.

## Status: complete

**Commit:** `0b9f1cae92649a3d2b65af07f8e8b481a4b07b74` — `fix(synth): locked instrument snapshot for message-thread readers`

**Test summary:** `make -C projects/synth build test` → 281/281 tests pass (280 pre-existing + 1 new: `engine_instrument_snapshot_is_deep_copy_equal_to_live_instrument`), zero warnings, zero errors under `-Wall -Wextra -Wpedantic`. `make -C projects/synth miniapp` links clean and exercises the `MidiPanel.hpp` change.

**Caller audit** (`LiveInstrument()` call sites in `projects/synth`, post-fix):

| Caller | Location | Disposition |
|---|---|---|
| `MidiPanel::Slot0Endpoints()` | `runtime/MidiPanel.hpp` | **Fixed** — switched to `InstrumentSnapshot()` (this was the finding) |
| `SynthRig::InstallMidiProfileForTest()` | `tests/support/SynthRig.hpp:192` | (c) test-support single-threaded harness, no concurrent audio thread |
| All `engine_tests.cpp` uses (10 test cases) | `tests/engine_tests.cpp` | (a) single-threaded test drivers — run `Initialize()`/`EditInstrument()`/`ProcessBlock` synchronously, no real concurrent thread |

No other production caller of `LiveInstrument()` exists anywhere in `projects/synth`.

Key changes:
- `projects/synth/include/synth/Engine.hpp` — added `InstrumentSnapshot()` (locked deep copy, mirrors `AudioDeviceSnapshot()`), tightened `LiveInstrument()`'s doc comment to state exactly when the unlocked reference is legal, updated the `instrumentConfig_`/`audioDeviceStateMutex_` doc comments.
- `projects/synth/runtime/MidiPanel.hpp` — `Slot0Endpoints()` now reads via `InstrumentSnapshot()` instead of `LiveInstrument()`.
- `projects/synth/tests/engine_tests.cpp` — new regression test asserting `InstrumentSnapshot()` is content-equal to the live instrument and a true deep copy (mutating the snapshot doesn't affect `instrumentConfig_`).

Fix report appended to `/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p1-task-4-report.md` under a "Round 2 addendum" section.