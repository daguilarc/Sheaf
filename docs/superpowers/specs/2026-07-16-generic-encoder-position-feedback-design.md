# Generic Encoder Position Feedback Design

## Contract

A Generic controller with encoder-turn input mappings automatically receives plain position feedback when it has no explicit `encoderOutput`. Each turn mapping produces exactly one debounced MIDI CC at the same zero-based channel and CC as its input address. The message value is the mapped encoder position byte. Generic feedback emits no color, brightness, animation, ring-mode, SysEx, or auxiliary messages.

An explicit Twister or WRLD.Bldr `encoderOutput` remains an override, preserving existing configured profiles. A Generic controller without encoder input has no derived encoder output.

## Architecture

Add a small `GenericMidiOutProcessor` that owns a copy of the encoder turn mappings. It projects each mapping's `(slotIx, position)` into the existing position-feedback machinery and supplies the mapping's full input `MidiControlAddress` when enqueueing. It maintains only one validity/value cache entry per mapping.

`CreateMidiControllerProfile` receives the controller kind from engine assembly through a trailing `std::optional<MidiProfileKind>` argument. The omitted sentinel preserves legacy/direct call behavior; it must not default to `MidiProfileKind::Generic`. When the supplied kind is Generic, `encoderInput` exists, and `encoderOutput` does not, the factory creates the Generic processor. Existing explicit encoder-output construction is unchanged and takes precedence.

The shared position decision is refactored to accept the final `MidiControlAddress` at its enqueue boundary. Twister and WRLD.Bldr continue supplying their fixed primary channel `0` plus configured CC; Generic supplies the stored input mapping address. The state machine and cache rules remain shared.

## Absolute and Relative Data Flow

For `EncoderMode::Absolute`, the factory gives Generic input and output the same engine-owned `AbsoluteFeedbackCoordinator` and controller-slot identity. Generic output uses the existing guarded `A/E/B/P` state machine: it gates while DSP acknowledgement is behind, suppresses an acknowledged exact input byte, sends one same-address correction after rejection or rerouting, preserves pending/cache state on enqueue failure, and survives processor rebuilds.

For both relative modes, Generic output remains outside epoch coordination and sends the existing post-modulation display position on the same input address.

## Compatibility and Failure Behavior

- Existing direct factory calls that do not supply a controller kind retain their prior behavior.
- Existing Generic profiles with explicit Twister or WRLD.Bldr output retain that output and do not also create Generic feedback.
- Route-capacity exhaustion retains the established absolute policy: input fails closed; untracked output uses ordinary raw-center debounce.
- Disconnected or out-of-capacity mapped cells send one debounced zero position on the same address when no unresolved tracked expectation keeps them gated.
- MIDI sender enqueue failure follows the existing absolute retry/cache rules.

## Verification

Focused factory and processor tests must prove:

- automatic Generic output is constructed only for Generic profiles lacking explicit output;
- each mapping emits exactly one CC at its input channel and CC, with no other MIDI traffic;
- multiple mappings preserve their independent full addresses;
- absolute pre-acknowledgement gating, exact suppression, rejection correction, retry, and rebuild persistence use the existing epoch coordinator;
- both relative modes use post-modulation position without epochs;
- explicit Twister/WRLD.Bldr output overrides automatic Generic output; and
- Generic profiles without encoder input create no derived output.

No visual/UI redesign and no persisted profile-schema migration are required.
