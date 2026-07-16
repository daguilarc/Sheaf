# Task 1 Report: Encoder-Mode Contract and Compatible Persistence

## Result

- Status: `DONE`
- OpenSpec mapping: `1.1`, `1.2`, `1.3`
- Commit: `8693e629` (`feat(synth): add encoder mode contract and migration`)
- The pre-existing `projects/synth/miniapp/`, OpenSpec proposal, implementation plan, and progress ledger were not committed or modified by this task.

## Implementation

- Renamed the public C++ contract from `EncoderRelativeMode` / `relativeMode` to `EncoderMode` / `mode` across tracked synth consumers.
- Added declaration-order `EncoderMode::Absolute` while preserving `Signed7Bit` as the default and `turnStep == 1 / 128`.
- Added JSON conversion for `absolute` and changed new encoder-input JSON output to the `mode` key.
- Added compatible loading of legacy `relativeMode` only when `mode` is absent. A present invalid `mode`, including explicit JSON `null`, fails without mutating the destination and never falls back.
- Renamed exposed Controllers view-model/UI field and catalog identifiers to encoder-mode terminology. The catalog remains limited to the two existing relative choices until the dedicated Controllers integration task; absolute input decoding also remains deferred to its planned task.

## Files Changed

- `projects/synth/include/synth/ControllersPageUI.hpp`
- `projects/synth/include/synth/MidiConfigViewModel.hpp`
- `projects/synth/include/synth/MidiController.hpp`
- `projects/synth/src/MidiConfigViewModel.cpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`
- `projects/synth/tests/rig_tests.cpp`
- `projects/synth/tests/viewmodel_tests.cpp`

## Baseline Evidence

Command:

```text
make -C projects/synth build/parameter_modulation_tests build/viewmodel_tests build/blocks_tests build/controllers_page_ui_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/viewmodel_tests && projects/synth/build/blocks_tests && projects/synth/build/controllers_page_ui_tests
```

Observed result: exit `0`; all four binaries passed before Task 1 edits.

## TDD RED Evidence

After adding the new contract and persistence tests, before production edits:

```text
make -C projects/synth build/parameter_modulation_tests build/viewmodel_tests
```

Observed result: exit `2` during compilation. The expected missing-contract diagnostics included:

```text
error: no member named 'EncoderMode' in namespace 'synth'
error: no member named 'mode' in 'synth::EncoderMidiInConfig'
make: *** [build/parameter_modulation_tests] Error 1
```

During self-review, an additional authority edge-case test was added before its fix:

```text
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Observed result: exit `1`, with only the new explicit-null authority assertion failing:

```text
[FAIL] encoder_mode_json_new_field_is_authoritative: requirement failed: !synth::FromJSON(nullMode, loaded)
```

This demonstrated that the legacy fallback incorrectly treated a present JSON `null` mode as absent before `ObjectHasKey` was introduced.

## GREEN Evidence

Focused edge-case GREEN after the parser-presence fix:

```text
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Observed result: exit `0`; all parameter-modulation tests passed, including the four new encoder-mode contract/persistence cases.

Final required gate:

```text
make -C projects/synth build/parameter_modulation_tests build/viewmodel_tests build/blocks_tests build/controllers_page_ui_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/viewmodel_tests && projects/synth/build/blocks_tests && projects/synth/build/controllers_page_ui_tests
```

Observed result: exit `0`; all four builds and binaries passed without compiler warnings.

Repository compatibility scan:

```text
rg -n 'EncoderRelativeMode|\.relativeMode|"relativeMode"' projects/synth --glob '!miniapp/**'
```

Observed result: no old C++ type/member references. Matches were limited to the deliberate legacy JSON parser lookup, migration/authority tests, and pre-existing invalid-input legacy fixtures.

## Self-Review

- Confirmed declaration values `0`, `1`, and `2` with compile-time assertions.
- Confirmed new writes omit `relativeMode`, absolute values round-trip, both legacy relative strings remain covered, `mode` wins when both keys exist, and failed parsing preserves the destination.
- Confirmed existing relative decoder code paths and default preset configuration remain behaviorally unchanged aside from the source-level rename.
- Confirmed `git diff --cached --check` passed and the commit contains only the eight Task 1 synth source/test files.

## Concerns

None for Task 1. Absolute CC message emission and the third editable Controllers catalog choice are intentionally pending in Tasks 4 and 5, respectively.

## Review Fix: Truthful Absolute Catalog State

- Commit: `653f8b1e` (`fix(synth): represent absolute encoder mode truthfully`)
- Expanded `EncoderModeCatalog()` to the three declaration-order values and made both `ApplyMappingEdit` and `RowFieldValue` map indices `0`, `1`, and `2` exactly. Invalid stored enum values and catalog index `3` remain rejected.
- Updated catalog comments and focused tests. Task 5 still owns the deeper open-session identity, commit/rebuild, and live processor reconstruction behavior.

### Review-Fix RED Evidence

Command:

```text
make -C projects/synth build/viewmodel_tests && projects/synth/build/viewmodel_tests
```

Observed result before production edits: exit `1` with the focused regression failing because `EncoderModeCatalog().size()` was `2` rather than `3`.

After only expanding the catalog, the same command remained RED and exposed the two aliasing paths:

```text
[FAIL] AbsoluteEncoderModeHasItsOwnCatalogIndexAndRowValue: requirement failed: value == 2.0
[FAIL] EncoderModeIndexOutOfRangeIsRefused: requirement failed: !ok
```

After adding the explicit index-2 edit assertion, the pre-fix mapping also failed with:

```text
[FAIL] AbsoluteEncoderModeHasItsOwnCatalogIndexAndRowValue: requirement failed: edited.controllers[0].config.encoderInput->mode == EncoderMode::Absolute
```

### Review-Fix GREEN Evidence

Focused command:

```text
make -C projects/synth build/viewmodel_tests && projects/synth/build/viewmodel_tests
```

Observed result: exit `0`; `EncoderModeCatalogExposesAllChoicesInDeclarationOrder`, `AbsoluteEncoderModeHasItsOwnCatalogIndexAndRowValue`, the relative round-trip, and index-3 rejection all passed.

Full Task 1 gate:

```text
make -C projects/synth build/parameter_modulation_tests build/viewmodel_tests build/blocks_tests build/controllers_page_ui_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/viewmodel_tests && projects/synth/build/blocks_tests && projects/synth/build/controllers_page_ui_tests
```

Observed result: exit `0`; all four binaries passed.
