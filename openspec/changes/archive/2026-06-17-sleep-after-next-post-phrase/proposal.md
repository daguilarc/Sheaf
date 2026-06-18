## Why

Pressing the Launchpad Talon control pad to sleep Talon can discard speech that Talon has heard but has not yet finalized into a phrase. This makes the hardware sleep button feel lossy when it is pressed immediately after speaking.

## What Changes

- Change Talon sleep requests so the Sheaf Talon bridge defers `actions.speech.disable()` until the next Talon `post:phrase` callback.
- Ensure sleep still completes after a bounded timeout when no `post:phrase` callback arrives.
- Keep the scope limited to sleep timing. This change does not add phrase buffering, replay, cancellation, deferred command execution, or any new Launchpad modes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dictator-talon-control`: sleep requests should allow an in-flight Talon phrase to finalize before disabling speech, with a bounded timeout fallback.

## Impact

- `projects/dictator/src/talon/sheaf_control/sheaf_control.py`: Talon-side bridge sleep handling and phrase callback registration.
- `projects/dictator/src/Sources/DictatorService/TalonControlClient.swift`: request timeout margin for sleep calls that now wait until speech is disabled.
- `projects/dictator/tests/DictatorServiceTests/TalonControlClientTests.swift`: coverage for delayed sleep responses.
- Talon bridge HTTP contract remains local-only and does not expose arbitrary Talon execution.
