## 1. Launchpad Mapping Types

- [x] 1.1 Add `LaunchpadController`, `LaunchpadGridPosition`, and shape/product-byte helpers to `projects/synth/include/synth/MidiController.hpp`.
- [x] 1.2 Implement Smart Grid-compatible `LaunchpadPositionToNote`, `LaunchpadNoteToPosition`, and `LaunchpadShapeSupports` helpers in `projects/synth/src/MidiController.cpp`.
- [x] 1.3 Add unit tests for Launchpad X, Launchpad Mini MK3, and Launchpad Pro MK3 supported positions, unsupported positions, and representative note round trips from the sibling `LaunchPadMidi.hpp` mapping.

## 2. Generic System Input Launchpad Addressing

- [x] 2.1 Extend the existing generic system-message input association/config types so they can match Launchpad `(controller,x,y)` positions as well as channel/CC addresses.
- [x] 2.2 Implement Launchpad note/CC press and release matching inside the generic system-message input processor, preserving timestamp stamping, optional release behavior, and thru behavior.
- [x] 2.3 Add unit tests for press, release, value-zero release, CC edge-button mapping, unmapped thru, and unsupported-controller/position rejection through the generic processor.

## 3. Launchpad RGB Output

- [x] 3.1 Add `LaunchpadGridMidiOutAssociation`, `LaunchpadGridMidiOutConfig`, `LaunchpadGridMidiOutProcessor`, and `LaunchpadColorSysex` declarations.
- [x] 3.2 Implement RGB SysEx generation for product bytes `0x0C`, `0x0D`, and `0x0E`, using `SystemMessageOutputInfo` and the existing 8-bit-to-7-bit color conversion convention.
- [x] 3.3 Add unit tests for exact SysEx bytes, RGB conversion, debounce behavior, and reset re-rendering.

## 4. Profile Factory And JSON

- [x] 4.1 Extend `MidiControllerSystemMessageAssociation` with optional Launchpad grid position data while preserving existing WRLD.Bldr associations.
- [x] 4.2 Update `CreateMidiControllerProfile` to route Launchpad associations into the generic system-message input processor and build Launchpad output processors grouped by controller.
- [x] 4.3 Add JSON serialization/loading for `LaunchpadController`, `LaunchpadGridPosition`, and Launchpad-bearing system associations, including backwards-compatible loading of WRLD.Bldr-only JSON.
- [x] 4.4 Add profile factory and JSON unit tests that rebuild equivalent processors from a serialized Launchpad profile.

## 5. Default Launchpad Profiles

- [x] 5.1 Add default Launchpad profile options and factory/config helpers for Launchpad X, Launchpad Pro MK3, and Launchpad Mini MK3.
- [x] 5.2 Implement default system-message associations for scene select, momentary gesture select, bank select, and optional shift, leaving analog and encoder sections unset.
- [x] 5.3 Add unit tests proving default profiles create only generic system-message input plus Launchpad grid output processors, with no analog or encoder processors.

## 6. Verification

- [x] 6.1 Run `make -C projects/synth test` and fix any failures.
- [x] 6.2 Run `openspec status --change "add-synth-launchpad-midi-profiles"` and confirm the change remains apply-ready.
- [x] 6.3 Review the implementation against `openspec/changes/add-synth-launchpad-midi-profiles/specs/synth-parameter-modulation/spec.md` and mark tasks complete only after tests pass.
