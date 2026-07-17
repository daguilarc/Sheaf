## Why

Some MIDI controllers send buttons as notes rather than CCs, but controller
profiles currently model encoder pushes and Generic system messages as CC-only.
These controls need an explicit CC/note choice without otherwise changing their
channel-and-number configuration model.

## What Changes

- Add a CC/note message-type choice to encoder push mappings.
- Add the same CC/note choice to Generic controller system-message mappings;
  controller-specific system-message address schemes remain unchanged.
- Treat note-on with positive velocity as press, and note-on with zero velocity
  or note-off as release. Existing CC behavior remains nonzero = press and zero
  = release.
- Suppress system-message output feedback for note-addressed Generic mappings;
  this change does not add note feedback and must not emit a CC at the note
  number.
- Persist the message type with each affected address while loading existing
  profiles that omit it as CC.
- Show a compact Note/CC toggle in encoder push rows and Generic system-message
  rows. Note numbers remain numeric `0..127`, using the same channel and number
  fields as CC mappings rather than musical note names.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-parameter-modulation`: allow note-addressed encoder pushes and Generic
  system-message associations, define press/release handling, and persist their
  message type.
- `synth-midi-instrument`: accept note addresses in the supported profile
  sections while retaining controller-kind validation.
- `synth-runtime-ui`: expose Note/CC selection for encoder push and Generic
  system-message rows using numeric channel and message-number fields.

## Impact

- `projects/synth/include/synth` and `projects/synth/src`: extend MIDI input
  address/config matching, validation, output selection, and JSON persistence
  with a backward-compatible message type.
- `projects/synth/src/MidiConfigViewModel.cpp` and the portable Controllers page
  renderer: add the toggle only to the affected row schemas.
- `projects/synth/tests`: cover input matching, note press/release semantics,
  persistence compatibility, validation, and view-model editing.
- No new dependencies and no musical-note-name parsing or display.
