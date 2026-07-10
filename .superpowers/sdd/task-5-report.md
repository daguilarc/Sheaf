# Task 5 Report: Dresden 4 Core Graph

## Status

Partial RED-test slice only. No Dresden 4 core implementation was added in this slice.

## Summary

- Added a `dresden4_system_tests` Makefile target.
- Added the target to the root synth `test` aggregate so the future Dresden 4 core graph is covered by normal test runs.
- Created `projects/synth/tests/dresden4_system_tests.cpp` as a JUCE-free system-test contract for the upcoming Dresden 4 core.
- The tests currently include the future `Dresden4.hpp` and `Dresden4Core.hpp` app headers and assert the initialization/routing contracts the implementation must satisfy:
  - config declares a patch-launchable stereo app named `Dresden 4`,
  - exactly three parameter groups with two scenes each,
  - scene endpoints `0/1`,
  - two banks and one 16-encoder slot,
  - Dresden bank blank cells `2/3`,
  - matrix bank full row-major coverage,
  - mono group has 24 params with matrix sharing the group,
  - quad group has one modulator and materializes four clamped/normalized voice values,
  - host rates map to 4x internal rates,
  - internal subframe debug counters prove four internal subframes per host frame,
  - finite non-silent stereo output after processing/decimation.

## Files changed

- `projects/synth/Makefile`
- `projects/synth/tests/dresden4_system_tests.cpp`

## Commit hash

- `1bd2ca0cb660f375a39f35409e7401acf59c62c5` (`test: add Dresden 4 core red tests`)

## RED command/result

- Command:
  - `make -C projects/synth build/dresden4_system_tests && projects/synth/build/dresden4_system_tests`
- Result: failed as expected before app files exist.
- Relevant output:
  - `tests/dresden4_system_tests.cpp:1:10: fatal error: 'Dresden4.hpp' file not found`

## GREEN command/result

- Not run in this partial slice. The Dresden 4 core implementation is intentionally still absent, so this target remains RED.

## Self-review

- Scope stayed limited to the Makefile target and RED test file.
- No app/core files, runtime integration, portable UI, launcher code, or DSP implementation were added.
- The Makefile target uses `-Iapps/dresden-4`, matching the intended app-local header layout.
- The target intentionally omits the missing future app headers from prerequisites for now so the RED failure is a compiler failure on the missing include, not a make dependency-resolution failure.
- The known unrelated untracked `projects/synth/miniapp/` directory was not touched.

## Concerns

- The tests define the future Dresden core test-only inspection surface (`DebugCounters`, `SetRawMatrixOutputForTest`, `PublishMatrixModulatorsForTest`, `NormalizedMatrixSource`, and graph accessors). The implementation worker should either provide these exact accessors or adjust the tests and core together during the full Task 5 implementation if a cleaner equivalent inspection API emerges.
