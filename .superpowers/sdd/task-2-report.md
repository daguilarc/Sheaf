# Task 2 Report: Runtime Monotonic Sample Position

## Summary

Implemented Task 2 for `decouple-encoder-block-rate`.

- Added `AudioBlock::startSample`.
- Updated `Engine::ProcessBlock` to stamp each block with the monotonic pre-increment sample position.
- Removed steady-state `manager_.ComputeAllTargets()` from the host block boundary.
- Updated engine comments and tests to separate message application (`SceneCenter`) from target/current processing (`ProcessSample`).
- Did not add engine-side per-slot `ProcessSample` calls, preserving the Task 1 reviewer constraint that the engine must not assume per-slot `ProcessSample` is O(1).

## Red Verification

Ran:

```bash
make -C projects/synth build/engine_tests && projects/synth/build/engine_tests
```

Expected pre-implementation failure occurred:

```text
tests/engine_tests.cpp:126:38: error: no member named 'startSample' in 'synth::AudioBlock'
```

## Green Verification

Ran:

```bash
make -C projects/synth build/engine_tests && projects/synth/build/engine_tests
```

Result: all focused engine tests passed.

## Notes

- Existing engine tests that assumed block-boundary target computation were updated to assert the new contract:
  - UI/MIDI/patch messages are still drained before `ProcessFrame` and `ProcessBlock`.
  - `SceneCenter` reflects those messages immediately.
  - `CurrentCenter`/UI display movement does not advance until sample-level processing runs.
- OpenSpec tasks `2.1` through `2.5` were not marked complete because the brief says to do that after review approval.
