## 1. Regression Tests

- [x] 1.1 Add a `parameter_modulation_tests.cpp` case where a selected inactive gesture with manager gesture value `1.0` receives a turn: the first call activates and copies the scene center without changing scene or gesture values.
- [x] 1.2 Add a follow-up case where the gesture is deselected after arming and the next turn still edits the now-active high gesture value while leaving the parent scene value unchanged.
- [x] 1.3 Add a blended-scene case proving the arming turn activates each touched endpoint from its own scene center and does not apply the delta.
- [x] 1.4 Add or update a multiple-active-gesture case proving Smart Grid-style effective-weight distribution across active gesture values and the base value, independent of current gesture selection.

## 2. Core Implementation

- [x] 2.1 Refactor `Parameter::HandleIncDec` to perform a selected-gesture arming pass before effective-weight distribution.
- [x] 2.2 Ensure the arming pass activates every selected inactive gesture for the active scene endpoint(s), copies from `SceneCenter(sceneIx)`, and returns without applying the delta when any activation occurred.
- [x] 2.3 Replace the active gesture distribution with the Smart Grid-style formula over all active gestures: gesture portions use `weight * weight / activeEffectiveWeightSum`, and the base portion uses `sum(weight * (1 - weight)) / activeEffectiveWeightSum`.
- [x] 2.4 Preserve existing behavior when no active gesture has a positive effective weight and no arming occurs: route the full turn through the base scene distribution path.

## 3. Verification

- [x] 3.1 Run the synth parameter modulation test target and confirm the new regression tests fail before the implementation and pass after it.
- [x] 3.2 Run the broader synth test target to catch routing, MIDI profile, patch persistence, and rig-level regressions.
- [x] 3.3 Inspect the final diff to confirm no MIDI profile schema, patch JSON schema, or unrelated synth behavior changed.
