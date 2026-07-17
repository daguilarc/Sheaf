# Task 6 Report: Controllers grid mapping UI

Status: complete

Base: `2ea3a2794abd6cf67d552ebae543e41ff9314e36`

Commit: `5b9653a1208efe93ae021676c0cfc2c3365dba2f` (`feat(synth): edit grid mappings in controllers`)

## Implemented

- Added stable `Grid Button` and `Grid Block` presentation rows to the System Messages section.
- Added the exact editable fields `Grid Slot`, `X Min`, `X Max`, `Y Min`, and `Y Max`; WRLD.Bldr rows also expose channel, while Launchpad rows remain channel-free.
- Reconstructed exact Task 5 system/pressure pairs into visible rows and retained unmatched pressure mappings in `SectionPresentation::hiddenPressureMappings`.
- Made every edit/add/add-block/delete flush rebuild visible system and pressure mappings together, append hidden mappings unchanged, normalize, validate, and commit atomically.
- Preserved open-session row identity through `Rebuild`; closing and reopening reconstructs from committed truth.
- Restricted the Grid add group to WRLD.Bldr and Launchpad, with valid one-cell and two-cell half-open defaults.
- Made grid placement pressure-address-aware, so hidden orphan mappings at an early physical cell are preserved and skipped instead of permanently blocking Add/Add Block.
- Routed the existing generic portable actions and stable node IDs through the new group and fields.
- Rendered signed coordinate editors and nonnegative grid-slot editors in JUCE.
- Added strict finite/full-string numeric parsing so malformed editor text is refused rather than coerced to zero.
- Added structural UI assertions that pressure-bearing profiles show only Grid Button/Grid Block concepts and never expose aftertouch, polyphonic-pressure, MIDI-status, or standalone-note fields.
- Added a deterministic independent grid oracle with seed `0x6a1d2026`: 320 operations, 200 accepted mutations, including add, add-block, edit, delete, invalid repair, close/open, JSON reload, stable renderer IDs, mixed legacy rows, hidden-orphan equality, and scroll reachability.

`projects/synth/runtime/ControllersPage.hpp` was audited but intentionally left unchanged. It is only a thin `ControllersPageHost` alias; all action routing is already generic in `ControllersPageSurface`, so a runtime-specific grid branch would duplicate the portable seam.

Task 5's `MidiConfigBlocks` model/header/tests were not modified.

## TDD evidence

1. View-model RED: `make -C projects/synth build/viewmodel_tests` failed because `RowGroup::Grid` and the five grid fields did not exist. GREEN: view-model tests passed after the presentation/flush implementation.
2. Portable-tree RED: `controllers_page_ui_tests` failed at `portable tree shows Grid Button`. GREEN: exact captions, fields, generic actions, stable IDs, signed values, and hidden implementation details passed.
3. JUCE RED: `ControllersPageJuceTests` failed at `JUCE signed grid editor has input filter`. GREEN: signed coordinate and grid-slot editor assertions passed.
4. Simulation RED: malformed grid input was accepted as zero. GREEN: the portable numeric parser now rejects malformed, partial, and non-finite input atomically.
5. Simulation oracle investigation: a test orphan used a nonzero runtime timestamp, but profile JSON intentionally does not serialize `MessageIn::timestamp`. The config fixture was corrected to the canonical timestamp-zero form used by Task 5 expansions; full-object equality remains asserted across every operation and reload.
6. Independent review RED: `GridAddSkipsPhysicalAddressesOwnedByHiddenOrphans` reproduced Add refusing forever when the first candidate address belonged to a hidden orphan. GREEN: WRLD.Bldr and Launchpad single/pair searches now skip occupied pressure addresses and preserve the orphan unchanged.

## Review

An independent read-only review found no Critical issues and one Important add-placement issue (hidden orphan pressure-address collision). After the RED/GREEN fix, the follow-up review reported no Critical, Important, or Minor issues and assessed the task ready.

## Verification

- PASS: `make -C projects/synth build/viewmodel_tests build/controllers_page_ui_tests build/blocks_tests && projects/synth/build/viewmodel_tests && projects/synth/build/controllers_page_ui_tests && projects/synth/build/blocks_tests`
- PASS: `make -C projects/synth/apps/miniapp test`
  - `ControllersPageJuceTests passed`
  - `GridControllersSimulation passed seed=0x6a1d2026 operations=320 accepted=200`
  - `ControllersPageSimulationTests passed seed=0x5eaf2026`
- PASS before the final review fix: `make -C projects/synth test`
- After the final view-model-only fix, two full-suite reruns passed all functional tests and the UI boundary check but each hit the unrelated timing-only `braid4_meets_96000hz_256_frame_deadline_and_continuity` p99 threshold after the very large logging suite.
- PASS immediately in isolation after that failure: `projects/synth/build/braid4_deadline_tests`; all five deadline cases passed, including 96 kHz baseline p99 `1.21846 ms` versus the `2.13333 ms` limit.
- PASS: `git diff --check`
- PASS: committed-file audit contains exactly the eight Task 6 implementation/test files; protected reports/plans and Task 5 model files were not staged.

## Residual concern

The full-suite 96 kHz deadline benchmark remains sensitive to host scheduling when run after the logging-heavy suite. It is unrelated to this Controllers/view-model change and passes in isolation; no DSP or deadline code changed in this commit.
