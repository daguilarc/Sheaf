Clean: 509 pass, 0 fail, 0 warnings, `make apps` links.

## Final report

**Status:** All six reviewer findings fixed, TDD throughout (red confirmed before every fix), full suite green.

**Commit:** `6a9c0814d819f0880c9d0ae782c843c5de65c40d` — "fix(synth): block run-pattern, validation, variant, and round-trip rigor"

**Test summary:** 509 tests pass, 0 fail, 0 warnings, clean `rm -rf build && make build test` and `make apps` both exit 0.

**Finding 5's existing-test adaptation:** none needed. I searched every twister association fixture in `viewmodel_tests.cpp`, `instrument_tests.cpp`, and `parameter_modulation_tests.cpp`. The only fixture affected by the tightened `SlotValidForKind` (channel 3, cc 8..13) was `MakeControlOnlyAssociation()` in `instrument_tests.cpp`, which already used `channel=3, cc=8` — it happened to already fit the real hardware shape, so it kept passing unchanged. `MakeTwisterSlot()` in `viewmodel_tests.cpp` uses the zero-arg `MfTwisterDefaultProfileConfig()` which has no side buttons configured, so it wasn't exercised either. For the one new `RowFieldValue` test that needed an out-of-shape association, I had to add the controller with a valid association first (since `AddController` now gates on `SlotValidForKind`) and mutate the in-memory config directly afterward, to isolate `RowFieldValue`'s own defense from the write-path gate.

Key files touched:
- `projects/synth/include/synth/MidiConfigBlocks.hpp` — added `SystemBlock::launchpadController`
- `projects/synth/src/MidiConfigBlocks.cpp` — gesture press-sense check, channel/domain-cap validation in all `Expand*`, wrap-safe successor checks, Launchpad variant threading
- `projects/synth/src/MidiConfigViewModel.cpp` — `RowFieldValue`'s `Field::Button` bounds cc to 8..13
- `projects/synth/src/MidiController.cpp` — `SlotValidForKind` enforces twister channel 3 + cc 8..13
- `projects/synth/tests/{blocks,instrument,viewmodel}_tests.cpp` — 20 new tests + 4 strengthened round-trip tests with a new `AssociationEqual`/`MessageInFullyEquivalent` structural-equality helper

Verified finding 1's regression is caught by the strengthened round-trip tests by temporarily reverting the fix and confirming failure, then restoring (byte-identical via `diff`).

Full fix report appended to `.superpowers/sdd/blocks-t1-report.md` (gitignored scratch dir, not committed).