Committed successfully.

**Status: Done.**

**Commit:** `1068934` — `fix(synth-runtime): lay row editors out in editableFields order; true drift test`

**Test summary:** `make -C projects/synth build test` — clean rebuild, 539 tests pass, 0 failures, 0 compiler warnings (`-Wall -Wextra -Wpedantic`); `make -C projects/synth apps` links cleanly; launch smoke (`SynthMiniapp`, 8s timeout) started normally with no crash/error (MIDI reconcile + audio device init logged, killed by timeout as expected).

Notes on finding 2: strengthening the drift test to actually call `AddSingle`/`AddBlock` surfaced two real cases where the four-kind fixture's `Add*` calls refuse even though `GroupSupports*` says true — both are dispatch-agreement cases with documented runtime refusals (twister has no `analogInput`; wrldbldr's dense default `AnalogGesture` packing collides on the second cell of `AddBlock`'s default 2-wide block), not drift. The test now asserts strict equality when `GroupSupports*` is false, and asserts dispatch-branch agreement (not generic outcome equality) when `GroupSupports*` is true — documented in detail in the test's comment and in the appended fix note at `.superpowers/sdd/blocks-t3-report.md`. No production code outside `ControllersPage.hpp`/`viewmodel_tests.cpp` was touched.