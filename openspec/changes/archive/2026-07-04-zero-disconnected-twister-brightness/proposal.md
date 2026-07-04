## Why

MF Twister output feedback should reliably turn off LEDs for mapped physical encoders that are not connected to a live UI cell. This matters when a configured encoder position is unused in the current bank/slot view and when a profile intentionally maps an encoder position that the application has not realized.

## What Changes

- Clarify that Twister output treats missing slot/position UI cells as disconnected hardware cells, not as transient snapshot failures.
- Require disconnected Twister cells to emit the MF Twister manual's brightness-off animation values alongside blank value, color, and indicator position feedback.
- Cover both disconnected mapped-cell sources: a realized but unused slot position, and an output mapping whose slot/position is outside the current `ParameterManager::UIState` tree.
- Clarify that unmapped Twister encoders are ignored by the output processor rather than blanked.
- Preserve existing output debounce behavior so the blank brightness message is sent once per state/cache transition rather than every processing pass.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-parameter-modulation`: Tightens Twister MIDI output requirements for disconnected or unrealized mapped encoder positions.

## Impact

- Affected code is expected to stay within `projects/synth` MIDI output processing and its focused tests, primarily `TwisterMidiOutProcessor`, `MidiOutProcessor::LoadCellSnapshot`, and `parameter_modulation_tests`.
- No patch format, MIDI profile JSON, runtime API, or dependency changes are expected.
