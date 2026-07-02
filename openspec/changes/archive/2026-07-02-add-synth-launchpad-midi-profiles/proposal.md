## Why

Launchpad grid controllers are a natural fit for synth system controls, but the synth MIDI library currently has reusable profiles only for encoder-oriented controllers. Adding a JUCE-free Launchpad profile layer lets reusable library code map grid `(x,y)` positions to existing `MessageIn` commands and render hardware feedback without changing the miniapp.

## What Changes

- Add Launchpad controller identity to the MIDI profile configuration, covering Launchpad X, Launchpad Pro MK3, and Launchpad Mini MK3.
- Extend the existing generic system-message input association pattern so Launchpad controller `(x,y)` positions can map to press/release `MessageIn` values, using the sibling Smart Grid `LPMidi` note/position conventions.
- Add a Launchpad grid output processor that evaluates associated `MessageIn` feedback through the existing system-message output-info helper and emits the correct Novation RGB SysEx for the selected Launchpad controller.
- Add default Launchpad profile builders for Launchpad X, Launchpad Pro MK3, and Launchpad Mini MK3 using the same message-association shape as the WRLD.Bldr profile, extended with controller identity.
- Keep the change library-only: no synth miniapp UI, miniapp wiring, analog mappings, encoder mappings, or app-specific profile selection changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: add JUCE-free Launchpad MIDI profile config, generic system-message input address support, SysEx output processors, defaults, and JSON round-trip behavior.

## Impact

- Affected code: `projects/synth/include/synth/MidiController.hpp`, `projects/synth/src/MidiController.cpp`, and `projects/synth/tests/parameter_modulation_tests.cpp`.
- Affected contracts: `MidiControllerProfileConfig`, profile factory output construction, and profile JSON serialization.
- External reference: `/Users/joyo/theallelectricsmartgrid/private/src/LaunchPadMidi.hpp` for Launchpad note/position support and SysEx product IDs.
- No new third-party dependencies and no miniapp changes.
