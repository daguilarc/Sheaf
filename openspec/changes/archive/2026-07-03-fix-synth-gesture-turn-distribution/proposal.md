## Why

Synth gesture editing currently gets stuck around high gesture values because selection and distribution are conflated. The behavior should match the Smart Grid workflow: selecting a gesture only lets knob turns activate that gesture for the touched parameter, and once gestures are active, every knob turn distributes movement across base and active gesture values.

## What Changes

- Adjust synth routed encoder tick handling so selected inactive gestures are activated from the current main scene value without swallowing the edit into an already-clamped gesture target.
- Preserve Smart Grid-style distribution after activation: active gestures receive their weighted share of knob turns whether or not they are currently selected, while the main scene value receives the complementary share.
- Add regression coverage for the high-gesture case and for newly activated gestures beginning from the main value.
- Keep MIDI/controller profiles unchanged; they continue to send `ParamIncDec`, gesture select, and gesture value messages through the existing message bus.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-parameter-modulation`: clarify and fix routed gesture arming for selected inactive gestures and routed edit distribution for already-active gestures.

## Impact

- Affected code: `projects/synth/src/ParameterModulation.cpp`, especially `Parameter::HandleIncDec`, `Parameter::ActivateGestureForScene`, and related gesture-weight helpers.
- Affected tests: `projects/synth/tests/parameter_modulation_tests.cpp` and, if useful for production routing, `projects/synth/tests/rig_tests.cpp` or `projects/synth/tests/support/SynthRig.hpp`.
- No public MIDI message, patch JSON, or controller profile schema changes are expected.
