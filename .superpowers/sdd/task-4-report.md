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

# Browser App Catalog Task 4: Selection Activation Lease

## Result

IMPLEMENTED — OpenSpec 4.1–4.5 behavior is covered. Per controller instruction,
the OpenSpec checkboxes and `.superpowers/sdd/progress.md` remain unchanged for
review/coordination to update separately.

## Commits

- Phase A: `17ef3271` (`feat(synth-browser): acquire activation resources before launch`)
- Phase B: `feat(synth-browser): launch packages from one activation gesture`

## TDD Evidence

Phase A RED was captured with four focused activation tests failing because
`dist/src/activation.js` did not exist. Phase A then implemented synchronous
audio construction/resume and sysex MIDI request ownership, one-shot consume,
partial-failure cleanup, idempotent disposal, leased AudioBridge context
injection, and leased MIDI reconciliation. Before the Phase A commit, the
focused suites passed in order: activation 4/4, audio 7/7, MIDI 7/7.

Phase B RED was captured with four new integration cases failing against the
placeholder launcher selection path: no same-stack acquire/materialize/version
forwarding, no package-failure retry cleanup, no runtime-init cleanup, and no
leased unload teardown. Converting the generic fake-app gate also exposed a
structured-clone failure when a `MaterializedPackage.dispose` function crossed
the Worker boundary; the production fix sends only the serializable
`MaterializedRuntimeModule` fields while retaining package disposal with the
active app.

## Implementation

- `SheafPatchLauncher` invokes its supplied selection boundary synchronously in
  the click stack, then settles the returned promise separately while preserving
  the Task 2 pending-shell/root-ownership guards.
- The production selection callback calls `ActivationLease.acquire()` before
  entering package materialization, so AudioContext construction/resume and the
  `{sysex:true}` MIDI request start before the first await.
- `installSynthBrowserApp` consumes one lease, passes declared catalog versions
  through the existing Task 3 runtime negotiation boundary, injects the exact
  leased AudioContext and MIDI access, and creates one runtime only after
  activation succeeds.
- Package failure, runtime initialization failure, active-page unload, and
  repeated disposal release the package URLs, runtime, UI, AudioBridge node,
  AudioContext, MIDI bindings, and MIDI ports without duplicate acquisition.
- Generic fake-app and real miniapp acceptance now enter through catalog rows,
  verified materialization, activation lease consumption, and generic runtime
  installation. Counters assert one context, resume, MIDI request, runtime,
  materialization/import load, and input binding.
- Focused direct AudioBridge, native Wasm AudioWorklet, MIDI manager, and direct
  runtime installation APIs remain callable and covered.

## Controller-Approved Audio Variance

The brief's phrase “runtime-owned Wasm AudioWorklet” cannot attach to a
JavaScript-created AudioContext through the current native ABI without changing
native files outside Task 4. The controller approved the binding OpenSpec
`sbac-6` implementation: launcher-selected apps use the existing host
AudioBridge/shared-ring path on the exact leased host AudioContext and never
invoke `runtime.startAudioWorklet` or create a second context. The focused direct
native Wasm AudioWorklet path is preserved unchanged.

## Final Verification

After `npm run build` and `git diff --check`, the prescribed Chromium gates ran
in the exact required order and passed:

1. `tests/activation-lease.spec.ts`: 8/8
2. `tests/audio-flow.spec.ts`: 7/7
3. `tests/midi-flow.spec.ts`: 7/7
4. `tests/fake-app.e2e.spec.ts`: 3/3
5. `tests/miniapp-smoke.spec.ts`: 6/6

`npm run check:generic-runtime` passed, followed by
`tests/launcher.spec.ts tests/runtime-core.spec.ts` at 13/13. The miniapp smoke
spec unconditionally rewrites its two tracked screenshot paths; because Task 4
has no intended pixel delta, both generated PNG changes were restored from HEAD
after the successful normal-mode run.

## Scope and Concerns

- No Task 5 persistence identity/path work was started.
- The pre-existing untracked `projects/synth/browser/package-lock.json` and
  `projects/synth/miniapp/` tree were preserved and never staged.
- No OpenSpec task checkbox or progress-ledger entry was edited.
- No unresolved implementation concern remains; the native-worklet wording
  variance is explicit above for reviewer attention.
