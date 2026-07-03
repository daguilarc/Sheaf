## Context

Sheaf's synth gesture editing is handled in `Parameter::HandleIncDec`. Controller profiles send encoder turns as `ParamIncDec`; the bank routes the turn to the visible parameter; `HandleIncDec` should use selected gestures only to arm inactive gesture state, then distribute ordinary turns between scene centers and all active gesture values.

The Smart Grid reference differs structurally because gestures are represented as encoder sub-cells. In `/Users/joyo/theallelectricsmartgrid/private/src/EncoderBank.hpp`, `BankedEncoderCell::Increment` first adds/activates selected gesture cells and `SetActive(true)` copies the parent value into the gesture cell. Once gesture cells are active, the increment is distributed using the effective gesture weights: gesture cells receive a weight-squared share, and the base receives the complementary weight share.

In Sheaf, selected gesture activation currently happens inside the same pass that calculates effective weights, and the proposed fix must avoid treating selection as a long-lived edit filter. Selection is only an activation gesture: after a parameter's gesture state is active, normal knob turns should distribute across that active gesture state even when the gesture pad is no longer held.

## Goals / Non-Goals

**Goals:**

- Make the first turn with a selected inactive gesture arm the gesture by activating it and copying the current main scene value.
- Make later turns distribute across all active gestures and the main scene values using Smart Grid-style effective-weight distribution, regardless of current gesture selection.
- Preserve existing scene-blend editing behavior and existing MIDI/controller message shapes.
- Add regression tests for the high gesture value case.

**Non-Goals:**

- Do not change gesture selection messages, analog gesture value messages, MIDI profile defaults, patch JSON shape, or manager-owned gesture metadata.
- Do not redesign gesture computation or audio-rate `Get`/`ProcessLite` behavior.
- Do not introduce per-voice gesture state.

## Decisions

1. Separate gesture arming from gesture editing.

   `Parameter::HandleIncDec` should first scan selected gestures for the active scene endpoints touched by the current blend. If any selected gesture is inactive for a touched endpoint, activate those missing endpoint flags, copy the corresponding `SceneCenter(sceneIx)` into `GestureValue(sceneIx, gestureIx)`, and return without applying the turn delta. The next turn sees the gesture as active and enters distribution.

   Alternative considered: keep Smart Grid's exact same-call activation plus increment. That works for Smart Grid's encoder sub-cell model, but Sheaf's separate gesture value and gesture weight model makes the first turn ambiguous when the gesture weight is already high. A distinct arming turn matches the desired controller workflow.

2. Use active gestures, not selected gestures, for distribution.

   After arming is complete, `HandleIncDec` should compute effective weights for all gestures that are active in the current scene selection. If the active effective weight sum is zero, the turn edits only the main scene values. Otherwise, each active gesture receives `delta * weight * weight / activeWeightSum`, and the main scene values receive `delta * sum(weight * (1 - weight)) / activeWeightSum`, using the existing scene distribution helper for each value pair. Gesture selection does not filter this distribution; it only determines which inactive gestures may become active on an arming turn.

   Alternative considered: distribute only across selected gestures. That keeps the implementation closer to the old selection-centric code, but it misstates the interaction model: in Smart Grid, selection creates gesture cells, and ordinary turns distribute across active cells after that.

3. Keep activation local to `Parameter::HandleIncDec`.

   The activation boundary belongs with routed edits rather than in `ParameterManager::SelectGesture` or MIDI profile processing. Selecting a gesture should remain a lightweight global state change; only turning a specific parameter decides whether that parameter's gesture value becomes active.

   Alternative considered: activate every visible parameter on gesture selection. That would create broad hidden state changes and would not match the "first turn arms this parameter" interaction.

## Risks / Trade-offs

- First-turn arming may feel like a swallowed turn if the user expected immediate movement -> Mitigate with tests and by matching the stated gesture workflow: selection plus first turn creates the editable high/gesture target.
- Multiple active gestures can be harder to reason about than one active gesture -> Mitigate by adopting the Smart Grid effective-weight distribution formula and covering it with unit tests.
- Scene blend endpoints can activate two scene-specific gesture values at once -> Mitigate by copying each active endpoint from its own `SceneCenter` and returning before any edit delta is applied.

## Migration Plan

No data migration is required. Existing patches keep their stored scene centers, gesture values, and active flags. Rollback is reverting the `Parameter::HandleIncDec` logic and its tests.

## Open Questions

- None.
