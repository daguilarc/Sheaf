# Task 2 — MiniApp ratio grid and independent pitch offsets

## Implementation summary

- Added one MiniApp-owned runtime grid declaration during `MiniAppCore::Init`:
  one `(0,0)`–`(8,2)` grid and one matching selected slot, with sixteen
  `StateCell<std::size_t>` set-only cells.
- Added two application-local selections, both initialized to the unity index
  (`3`), plus the ordered JI ratio table: `1/2`, `3/4`, `2/3`, `1/1`, `5/4`,
  `3/2`, `4/3`, `2/1`. `6/5` is absent.
- Added a fixed eight-color RGB palette. Off cells use `AdjustBrightness(0.35f)`;
  on/off remains represented by the existing UI-state alpha convention.
- Every topology result is checked. Missing manager, failed range/grid/slot
  creation, failed lookup/cell registration, or failed grid selection throws
  `std::logic_error`.
- Applied the selected ratio after `VcoModule::SetInput` and immediately before
  `VcoModule::Process`, independently for both voices. The parameter manager
  and Tune raw state are not written.

## Test evidence

### RED

Command:

```sh
make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests
```

Before production changes, the focused target built and failed as intended:

- `miniapp_ratio_grid_declares_independent_set_only_rows_and_feedback` failed
  because `grids.slots.size() == 1` was false (MiniApp declared no slot).
- `miniapp_ratio_grid_applies_independent_voice_pitch_offsets_without_mutating_tune`
  failed because voice 0 retained its unscaled prepared VCO frequency.

### GREEN

The same focused command was rerun after implementation:

```sh
make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests
```

Result: successful build; all 34 MiniApp system tests passed. The new coverage
checks finalized topology, 16 cells, unity startup at x=3, independent row
presses, RGB brightness dimming plus alpha on/off feedback, set-only release/
pressure behavior, per-voice `1/2` and `2/1` prepared-frequency offsets, and
unchanged Tune raw value.

## Changed files

- `projects/synth/apps/miniapp/MiniAppCore.hpp`
- `projects/synth/tests/miniapp_system_tests.cpp`

## Self-review

- Confirmed the table order exactly matches the approved eight ratios and does
  not include `6/5`.
- Confirmed the palette is RGB-brightness dimmed, rather than alpha-dimmed;
  existing grid publication assigns alpha `1` for selected and `0` otherwise.
- Confirmed all optional/pointer/topology operation results are checked and
  failure paths use `std::logic_error`.
- Confirmed the frequency multiplier executes between `SetInput` and `Process`
  on every sample, so `SetInput` refreshes the base input before multiplication.
- Ran `git diff --check`: no whitespace errors.

## Concerns

None. The interaction test advances 25 blocks after events because MiniApp's
48 kHz / 64-frame / 30 Hz UI publication cadence publishes once every 25
blocks; this exercises the normal runtime publication path.
