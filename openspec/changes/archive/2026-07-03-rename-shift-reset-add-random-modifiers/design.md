## Context

The synth parameter path already routes encoder turns, presses, shift/reset presses, bank selection, gestures, scenes, and MIDI system buttons through `ParameterManager` and `MessageInBus`. The current modifier is named shift even though its behavior is reset: when held, encoder press resets the visible target and neutralizes that target's modulation subtree. The WRLD.Bldr default profile maps a momentary aux button to `SetShift`.

This change keeps the existing routing shape but replaces the one-off shift flag with a small modifier model: reset, random, and random-mod. The modifier model must be usable from direct manager APIs, `MessageInBus`, UI state, deterministic tests, and the WRLD.Bldr profile.

## Goals / Non-Goals

**Goals:**

- Rename the reset behavior away from shift-oriented public names.
- Track reset, random, and random-mod held state in the manager and expose the effective modifier through `GetCurrentModifier`.
- Make encoder press and bank-select messages respect the effective modifier.
- Randomize parameter values without altering modulation routes when the effective modifier is random.
- Randomize a geometric number of modulation slots when the effective modifier is random-mod.
- Keep randomized simulation tests reproducible.
- Add default WRLD.Bldr mappings for random and random-mod near the reset control.

**Non-Goals:**

- Redesign the modulation view layout or parameter allocation model.
- Add modified turn behavior; modified turns remain ignored unless a future change defines turn semantics.
- Change MIDI controller hardware protocols beyond profile mappings and action names.
- Change patch value JSON semantics beyond any serialized MIDI profile action-name migration needed by the rename.

## Decisions

1. Replace shift as a concept with reset, but keep the same state shape.

   `ParameterManager` should expose reset-held state with reset-oriented names and a `Modifier` enum:

   ```cpp
   enum class Modifier { None, Reset, Random, RandomMod };
   Modifier GetCurrentModifier() const;
   ```

   The manager should store independent held booleans for reset, random, and random-mod. `GetCurrentModifier` returns `RandomMod` first, then `Random`, then `Reset`, then `None`. This preserves the existing momentary-button model while ensuring only one modifier behavior executes for a routed action.

   Alternative considered: store a single current modifier. Independent booleans fit existing momentary press/release MIDI messages better and avoid stuck-state surprises when overlapping hardware buttons are released in different orders.

2. Rename message and UI contracts to reset/random/random-mod.

   `MessageIn::Type::ToggleShift` and `SetShift` should become reset-oriented message types/factories. Random and random-mod should have matching toggle/set message pairs. UI state should publish the held states needed for hardware feedback and miniapp button lighting. Profile action serialization should use reset/random/randomMod names, with migration compatibility for old shift strings if existing patches or profile JSON can contain them.

   Alternative considered: keep shift aliases forever. Short-lived compatibility aliases are acceptable during implementation if they lower churn, but the spec-facing contract should use reset names.

3. Move modifier behavior into press routing, not separate handler names.

   The separate `HandleShiftPress` path should collapse into press handling that consults `GetCurrentModifier`. Direct manager, slot, and bank APIs should expose normal press/tick operations plus modifier-aware press behavior rather than a shift-specific handler. `ParamPush` should call that same manager path.

   Alternative considered: add `HandleRandomPress` and `HandleRandomModPress`. That would repeat the shift-special-case structure this change is removing.

   OpenSpec delta note: existing requirement headers must match the source spec for `MODIFIED` blocks. Any changed requirement whose title still contains `shift-press` should have reset-oriented normative text and scenarios; the remaining header wording is an archive-tool matching constraint, not a behavior name to preserve in code.

4. Implement random value as an absolute value edit on the visible knob.

   Random applies a uniformly generated normalized value to the visible `Parameter` by routing a delta equal to `sampledValue - currentEffectiveKnobValue` through the same active scene and gesture distribution rules as `HandleIncDec`. It does not create, delete, clear, or rewrite modulation-depth assignments for a top-level target. If the visible knob is itself a modulation-depth parameter in an open modulation view, random affects that visible depth knob because that is the selected knob position.

   Alternative considered: randomize all scenes or all gesture targets. The request says "knob position", so the active scene/gesture editing context is the least surprising match.

5. Implement random-mod as geometric modulation-slot randomization.

   Random-mod repeatedly samples while the random coin is less than `0.5`. Each successful iteration picks one modulator slot for the target parameter with replacement, so a later iteration may pick and randomize the same slot again. If that slot already has a modulation-depth parameter, it randomizes that depth parameter. If the slot is empty, it materializes the depth parameter using the existing capacity-checked modulation-depth path, then randomizes it. The operation stops when the coin fails or when an empty chosen slot cannot be materialized because capacity is unavailable. For groups with zero modulators, the operation is a no-op.

   Alternative considered: always randomize at least one slot. The user's sketch has a geometric loop that may perform zero iterations, so the implementation should allow zero generated changes.

6. Keep random deterministic under test by centralizing the random source.

   Production can default to `std::rand`-compatible behavior, but the manager should expose a narrow random-source hook or use an injectable generator in tests so randomized simulation oracles can consume the same random choices. Tests should assert behavior by deterministic seeds, not by statistical expectations.

   Alternative considered: call `std::rand()` directly from scattered handlers. That is simple, but it makes failure reproduction and oracle modeling unnecessarily brittle.

7. Modifier plus bank select is a bulk action, not navigation.

   When `SelectParamBank` is processed with `GetCurrentModifier() != None`, the manager should target the requested bank and apply the modifier to every top-level parameter mapped by that bank. Reset reverts each parameter to default and neutralizes modulation. Random randomizes each parameter's knob value and leaves modulation routes intact. Random-mod applies the geometric modulation operation to each parameter. The selected bank should not change during a modified bank-select operation.

   Alternative considered: both select and bulk-edit the bank. Keeping modified selection as an action avoids a hidden page/bank navigation side effect during destructive or randomizing operations.

## Risks / Trade-offs

- **Public rename churn** -> Implement focused compatibility only where persisted profile JSON or transition call sites require it, and remove shift naming from new tests/specs.
- **Random-mod may need more local parameter storage** -> Reuse the existing modulation-depth materialization path and its capacity/request behavior; stop safely when capacity is unavailable.
- **Random tests can become flaky** -> Route all random choices through a deterministic test source and include seed, step, action, target, and sampled values in failure messages.
- **Modifier precedence may hide a lower-priority held button** -> Publish each held state in UI state so feedback shows what is held, while `GetCurrentModifier` defines the single effective action.
