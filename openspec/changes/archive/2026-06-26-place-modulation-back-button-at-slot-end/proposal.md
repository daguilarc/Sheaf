## Why

Modulation views currently pack the return/back cell immediately after the visible modulator cells. That makes the back cell move depending on how many modulators a parameter has, even though the controller slot has fixed physical positions.

## What Changes

- Place the modulation-view return cell at the final physical position of the selected bank slot when routed through a slot.
- Leave any slot positions between populated modulation-depth cells and the return cell empty/disconnected.
- Treat a parameter group with more modulators than `slotPositions - 1` as a configuration error for that slot because there is no reserved return position left.
- Keep direct `Bank` usage compatible by falling back to the bank's compact top-level mapping order when no slot layout is supplied.

## Capabilities

### New Capabilities

### Modified Capabilities
- `synth-parameter-modulation`: clarify modulation-view return-cell placement and slot capacity validation.

## Impact

- Affected code: `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, and `projects/synth/tests/parameter_modulation_tests.cpp`.
- No dependency changes.
- Existing MIDI slot-position mappings become more predictable because the return cell remains at the final controller position.
