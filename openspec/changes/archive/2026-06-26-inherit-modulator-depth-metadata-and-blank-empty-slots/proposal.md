## Why

Modulation-depth parameters currently get generic parameter metadata, so depth cells render as generic/white controls instead of carrying the identity of the modulator they encode. Empty bank-slot positions also still draw a placeholder controller on screen and can leave prior hardware feedback lit.

## What Changes

- Add short-name metadata to modulators.
- Make lazily materialized modulation-depth parameters inherit name, short name, and color from the corresponding modulator metadata.
- Render disconnected/unassigned encoder cells as empty space in the JUCE encoder component.
- Make MIDI output processors actively blank mapped disconnected cells by sending off colors, zero brightness, and zero value feedback instead of skipping them.

## Capabilities

### New Capabilities

### Modified Capabilities
- `synth-parameter-modulation`: modulator metadata, lazy modulation-depth parameter metadata, disconnected slot UI, and MIDI feedback blanking behavior.

## Impact

- Affected code: synth parameter modulation core, core MIDI output processors, JUCE encoder component, synth tests, and miniapp modulator setup.
- No dependency changes.
