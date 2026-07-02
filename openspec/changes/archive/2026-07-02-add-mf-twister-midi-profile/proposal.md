## Why

The synth MIDI layer already knows how to drive encoder grids and profile-based system messages, but the MIDI Fighter Twister profile is still only the 4x4 encoder subset. The six side buttons are useful synth controls when configured as channel 4 CCs 8-13, and Twister feedback needs the same color, brightness, and indicator-state fidelity as the WRLD.Bldr path.

## What Changes

- Add a default MIDI Fighter Twister profile config/factory that builds encoder inc/dec/push handling, six configurable input-only side-button system-message associations, and encoder value/color/brightness/indicator feedback.
- Treat the Twister side buttons as user-facing channel 4 CCs 8-13, represented in `BasicMidi` configs as zero-based channel 3 CCs 8-13.
- Extend encoder UI-state snapshots with a brightness field, defaulted to `1.0` for connected cells and `0.0` for disconnected cells, and have both Twister and WRLD.Bldr encoder output use it.
- Extend Twister encoder output to send indicator/ring position and indicator color feedback, using Smart Grid/manual-compatible channel conventions and HSV-to-Twister color mapping.
- Update MIDI profile JSON persistence so MF Twister profile options and side-button associations round-trip cleanly.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `synth-parameter-modulation`: Adds MF Twister controller-profile behavior and extends existing MIDI output/UI-state requirements for Twister color, brightness, and indicator feedback.

## Impact

- Affected code: `projects/synth/include/synth/MidiController.hpp`, `projects/synth/src/MidiController.cpp`, `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, synth tests, and miniapp profile selection if it exposes built-in controller choices.
- APIs: additive profile config/factory APIs for MF Twister, additive UI-state brightness field, encoder-output feedback extensions, and JSON round-trip support for new profile data.
- External references: MIDI Fighter Twister manual/channel conventions and Smart Grid Twister implementation under `/Users/joyo/theallelectricsmartgrid`.
