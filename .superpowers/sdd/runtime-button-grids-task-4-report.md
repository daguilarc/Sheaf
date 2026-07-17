# Task 4 Report: Polyphonic Pressure and Profile Persistence

## Status

Implemented and committed as `a193309eb8481aba5018ef48c08ed524b69579ac`
(`feat(synth): map polyphonic grid pressure`).

## Summary

- Added `BasicMidi` polyphonic-aftertouch construction, recognition, and
  pressure access for complete `0xA0` messages.
- Added JUCE-free `MidiNoteAddress`, `PolyphonicPressureMapping`,
  `PolyphonicPressureMidiInConfig`, and a fixed-config, allocation-free process
  path that validates unique addresses and `GridPressureChange` targets.
- Added pressure input to the shared encoder/analog/system thru chain with the
  same `MessageInBus` and timestamp provider. Matched pressure is stamped and
  consumed; unmatched/non-pressure MIDI reaches thru once.
- Advanced only the nested controller-profile schema to version 2. The reader
  accepts versions 1 and 2, treats v1 or absent pressure data as unconfigured,
  and validates address byte ranges, target kind, types, and duplicates.
- Preserved instrument/runtime envelope schema versions and patch JSON shape.
- Added stable pressure normalization by
  `(gridSlot, x, y, channel, note)` without changing existing encoder, analog,
  or system-message ordering.
- Kept pressure mappings entirely in the hidden profile/config layer; no
  Controllers presentation concept or aftertouch row was added.

## Files

- `projects/synth/include/synth/MidiController.hpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/include/synth/MidiConfigBlocks.hpp`
- `projects/synth/src/MidiConfigBlocks.cpp`
- `projects/synth/tests/instrument_tests.cpp`
- `projects/synth/tests/blocks_tests.cpp`
- `projects/synth/tests/rig_tests.cpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`

The final test file is the one authorized deviation from the brief's staged
list. Its existing invalid-version fixture used schema version 2; because this
task makes version 2 current, the future-version sentinel was advanced to 3.

## TDD Evidence

### RED

Before production edits:

```text
make -C projects/synth build/instrument_tests build/blocks_tests build/rig_tests
```

Exited 2 at `instrument_tests.cpp` for the expected missing Task 4 API:
`PolyphonicPressureMapping`, `BasicMidi::PolyPressure`, `IsPolyPressure`,
`GetPressure`, `PolyphonicPressureMidiInConfig`, and
`PolyphonicPressureMidiInProcessor`.

### GREEN

After implementation:

```text
make -C projects/synth build/instrument_tests build/blocks_tests build/rig_tests && \
projects/synth/build/instrument_tests && \
projects/synth/build/blocks_tests && \
projects/synth/build/rig_tests
```

Exited 0. All focused existing and new tests passed.

The first complete-suite run then exposed the stale out-of-scope schema-2
rejection fixture described above. After the authorized version-3 maintenance
edit, the affected binary passed:

```text
make -C projects/synth build/parameter_modulation_tests && \
projects/synth/build/parameter_modulation_tests
```

Exited 0.

## Final Verification

```text
make -C projects/synth test
```

Exited 0, including `check-ui-boundary` and the complete synth test matrix.

```text
git diff --check
git diff --cached --check
```

Both were silent before commit.

## Risks / Minors

- Pressure lookup is linear in the prevalidated controller mapping list. It
  performs no allocation in `Process`; expected controller mapping counts are
  bounded by the fixed installed profile.
- Mapping equality is exact structural equality, including template timestamp
  and all `MessageIn` storage fields. Persisted mapping templates are expected
  to use timestamp zero; runtime processing stamps a copy and never mutates the
  stored template.
- No OpenSpec checkboxes, shared progress, prior reports, plan artifacts, or
  `projects/synth/miniapp/` content were staged or committed.
