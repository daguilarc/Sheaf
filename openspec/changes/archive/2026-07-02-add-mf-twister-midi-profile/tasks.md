## 1. Protocol Tests And Helpers

- [x] 1.1 Add unit tests that document MF Twister side buttons as user-facing channel 4 / zero-based channel 3 CCs 8-13.
- [x] 1.2 Add unit tests for `ColorToTwister` covering off, neutral, and representative saturated colors against the Smart Grid/manual hue expectations.
- [x] 1.3 Add unit tests for Twister brightness conversion, including disconnected blanking, half brightness, and full brightness value 47.

## 2. UI-State Brightness

- [x] 2.1 Add an atomic brightness field to `Parameter::UIState` and initialize it during UI-state creation/setup.
- [x] 2.2 Populate connected parameter cells with brightness `1.0` and disconnected cells with brightness `0.0`.
- [x] 2.3 Extend `MidiOutProcessor::CellSnapshot` to load brightness under the existing revision protocol.

## 3. Twister Encoder Output

- [x] 3.1 Update `ColorToTwister` to use the source-derived HSV/MF Twister hue mapping over the full `1..126` hue range.
- [x] 3.2 Update `TwisterMidiOutProcessor` to use UI-state brightness instead of hardcoded full brightness.
- [x] 3.3 Add Twister encoder indicator position feedback from voice-0 display value.
- [x] 3.4 Add Twister encoder indicator color feedback from voice-0 indicator color.
- [x] 3.5 Update WRLD.Bldr encoder output to adjust button color by UI-state brightness while preserving indicator-color behavior.

## 4. MF Twister Side Buttons

- [x] 4.1 Add MF Twister profile option/config types for six configurable side-button system-message associations.
- [x] 4.2 Build the default MF Twister profile with encoder input/output plus side-button associations on zero-based channel 3 CCs 8-13.
- [x] 4.3 Ensure MF Twister side-button associations create input messages only and do not create generic CC, color, or other side-button output processors.
- [x] 4.4 Extend profile factory wiring so MF Twister configs create encoder input, system-button input, and Twister encoder output processors as configured.

## 5. Persistence And Integration

- [x] 5.1 Extend MIDI profile JSON round-trip tests to cover MF Twister side-button control addresses, press messages, and optional release messages.
- [x] 5.2 Update profile JSON serialization/loading only if the current generic system-message schema cannot already preserve all MF Twister side-button data.
- [x] 5.3 Update any miniapp preset/profile selection code that still creates Twister processors manually so it can use the new MF Twister profile helper when selected.

## 6. Verification

- [x] 6.1 Run `make synth-test` and fix any synth test failures.
- [x] 6.2 Run targeted MIDI profile/persistence tests if a narrower command exists and record the command/output.
- [x] 6.3 If MF Twister hardware is available, smoke test encoder turn, encoder press, side-button press/release, and encoder color/brightness/indicator output; otherwise record that hardware verification was not run.
