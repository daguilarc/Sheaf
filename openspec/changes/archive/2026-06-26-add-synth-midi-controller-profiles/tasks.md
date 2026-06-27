## 1. Safe Message Application and UI State

- [x] 1.1 Add tests proving out-of-bounds `SelectParamBank`, gesture select/value, `SceneSelect`, and slot-position messages are no-ops.
- [x] 1.2 Update `MessageInBus::Apply` and any manager APIs it calls so invalid message targets return without mutating state.
- [x] 1.3 Add `MessageIn::SetShift` and `MessageIn::SetGestureSelect` command support, factories, and bus application semantics.
- [x] 1.4 Add tests for idempotent explicit shift set and explicit gesture select/deselect through `MessageInBus`.
- [x] 1.5 Add bank color metadata to `Bank` with default color, accessor, and mutator APIs.
- [x] 1.6 Extend `ParameterManager::UIState` setup/population with bank entries for connected, selected, and color state.
- [x] 1.7 Extend UI-state population with gesture-bank-affecting data derived from visible bank mappings and active-scene gesture masks.
- [x] 1.8 Add unit tests for bank color UI state, selected-bank UI state, missing-bank feedback safety, and zero/one/multiple gesture-bank-affecting cases.

## 2. MIDI Input Processors

- [x] 2.1 Add `AnalogMidiInConfig` and `AnalogMidiInProcessor` for channel/CC to gesture value and scene blend mappings.
- [x] 2.2 Add analog input tests for normalized value conversion, timestamp provider use, mapped consumption, and unmapped thru behavior.
- [x] 2.3 Add `SystemButtonMidiInConfig` and `SystemButtonMidiInProcessor` for press and optional release `MessageIn` associations.
- [x] 2.4 Add system button input tests for press value > 0, optional release at value 0, mapped release-without-message consumption, explicit gesture release, timestamp provider use, and unmapped thru behavior.

## 3. System MIDI Output

- [x] 3.1 Add `SystemMessageOutputInfo` with `MessageIn` to `{Color, isOn}` behavior for bank select, shift, scene select, gesture select, and unsupported message types.
- [x] 3.2 Add output-info tests for selected/unselected/missing banks, shift on/off, concrete scene endpoint brightness values and missing scenes, scene endpoint tie handling, selected/unselected/missing gestures, and unsupported messages.
- [x] 3.3 Add `SystemCcMidiOutProcessor` with config associations, own debounce cache, reset behavior, and 127/0 CC output.
- [x] 3.4 Add `WrldBldrSystemMidiOutProcessor` with WRLD.Bldr position associations, own debounce cache, reset behavior, and Yaeltex-compatible color feedback.
- [x] 3.5 Add output processor tests using a fake MIDI sink for CC on/off values, WRLD.Bldr color bytes, debounce, and reset re-render.

## 4. Controller Profiles

- [x] 4.1 Add profile config types that share system-message associations between input and output and carry encoder, analog, and system sections without duplicating channel/CC or WRLD.Bldr position definitions.
- [x] 4.2 Add a profile factory/result type that builds an input processor chain with shared bus/timestamp provider and returns independent output processors bound to UI state and sender.
- [x] 4.3 Add tests that profile-created input chains route encoder, analog, and system button messages in order through thru.
- [x] 4.4 Add tests that profile-created output processors mirror shared associations without requiring an output chain.

## 5. Default WRLD.Bldr Profile

- [x] 5.1 Implement the default WRLD.Bldr profile with row-major encoder channel 0/1 mappings for slot 0 and matching encoder output mappings.
- [x] 5.2 Implement WRLD.Bldr analog defaults for logical analog index 0 scene blend and logical indices 1..16 gesture values, including channel 2 direct mapping and channel 14 +2 offset mapping.
- [x] 5.3 Implement WRLD.Bldr system defaults: momentary shift at aux `(0,4)` with explicit set/release messages, scene select on aux row 6, bank select at Smart Grid-derived row 2/3 positions, configurable momentary gesture selectors with explicit set/release messages, and no aux focus mapping.
- [x] 5.4 Add profile tests proving extra bank/scene/gesture buttons are safe no-ops when the app topology is smaller than the default layout.
- [x] 5.5 Verify default WRLD.Bldr positions against `/Users/joyo/theallelectricsmartgrid/private/src/TheNonagonSquiggleBoyWrldBldr.hpp` and keep a source-derived note in the tests or implementation comments.

## 6. Miniapp Integration

- [x] 6.1 Replace miniapp direct encoder MIDI processor construction with the default WRLD.Bldr profile.
- [x] 6.2 Configure the miniapp profile for one gesture selector, gesture analog input, scene blend analog input, valid scene buttons, shift, bank buttons, and the current visible encoder count.
- [x] 6.3 Install the profile-created input chain into `MidiInHandler` and preserve the existing dedicated MIDI bus separate from the on-screen UI bus.
- [x] 6.4 Invoke all profile-created output processors after `manager_.PopulateUIState(*uiState_)`.
- [x] 6.5 Keep the miniapp usable without MIDI hardware and preserve clean sender/device shutdown.

## 7. Verification

- [x] 7.1 Run `make -C projects/synth test` and fix any failures.
- [x] 7.2 Run `make -C projects/synth miniapp` when `~/JUCE` is available, or record the documented missing-JUCE result.
- [x] 7.3 Run `make -C projects/synth/miniapp test` when `~/JUCE` is available, or record the documented missing-JUCE result.
- [x] 7.4 If hardware is available, smoke the miniapp with a WRLD.Bldr controller for one gesture button, gesture analog CC, scene blend CC, scene select, shift, encoders, bank feedback, and system-button feedback.
