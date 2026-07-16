# Task 4 Report: Absolute MIDI Encoder Decoding

## Result

DONE

## Commit

`035ba434` (`feat(synth): decode absolute encoder positions`)

## Scope

- Modified `projects/synth/src/MidiController.cpp`.
- Added focused coverage in `projects/synth/tests/parameter_modulation_tests.cpp`.
- Preserved the user's untracked `projects/synth/miniapp/` directory.
- Did not modify Controllers edit sessions, property tests, OpenSpec artifacts, the plan, or the progress ledger.

## RED Evidence

Command:

`make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`

Result: exit 1 after the new tests compiled. Both new cases failed at the expected first missing message assertion:

- `midi_encoder_input_absolute_maps_raw_positions_independent_of_turn_step`: failed `bus.Pop(message, 103)` because mapped absolute turns emitted no message.
- `midi_encoder_input_absolute_preserves_mapped_push_and_thru_boundaries`: failed `bus.Pop(message, 77)` for the same missing absolute-turn emission.

All pre-existing cases passed during the RED run, isolating the failure to the absent absolute decoder branch.

## Implementation

`EncoderMidiInProcessor::Process` now handles a mapped turn in `EncoderMode::Absolute` by emitting:

`MessageIn::ParamSetAbsolute(NextTimestamp(), mapping->slotIx, mapping->position, float(raw) / 127.0f)`

The absolute branch returns before `DecodeDelta`, so it never reads or applies `turnStep`. Signed-7-bit and direction-only turns continue through the unchanged `DecodeDelta` path.

## Focused Coverage

- Raw CC values `0`, `64`, and `127` produce normalized values `0`, `64.0f / 127.0f`, and `1`.
- Generated timestamps are used instead of incoming MIDI timestamps.
- Mapped slot and position are preserved.
- The same expected messages are produced with `turnStep` values `0.01f` and `0.75f`.
- A mapped absolute raw-zero turn is emitted and consumed rather than treated as a relative no-op.
- Mapped nonzero pushes still emit `ParamPush` and are consumed.
- Mapped zero-value pushes remain consumed without emitting a message.
- Unmapped CC input still passes through unchanged.

## GREEN Evidence

Focused command:

`make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests`

Result: exit 0; 254/254 parameter-modulation cases passed, including both new absolute cases and existing relative decoder/default-profile/persistence coverage.

Prescribed non-regression command:

`make -C projects/synth build/parameter_modulation_tests build/rig_tests build/miniapp_system_tests build/braid4_system_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/rig_tests && projects/synth/build/miniapp_system_tests && projects/synth/build/braid4_system_tests`

Result: exit 0. Parameter modulation, rig, MiniApp system, and Braid4 system suites all passed. Existing Twister/WRLD.Bldr defaults and relative production routing remained green.

`git diff --check` also passed before commit.

## Self-Review

- The product delta is the minimal mode branch required by OpenSpec tasks 4.1-4.3.
- Relative decoding code was not rewritten or reordered.
- Absolute decoding uses the raw 7-bit value directly and has no parameter-state or `turnStep` dependency.
- Mapped/unmapped/thru/push behavior is explicitly covered at the processor boundary.
- Only the two task-scoped files were committed.

## Concerns

None.
