## 1. Talon Bridge Deferred Sleep

- [x] 1.1 Register a Talon `post:phrase` callback in `projects/dictator/src/talon/sheaf_control/sheaf_control.py` for completing pending sleep requests.
- [x] 1.2 Add a single pending deferred-sleep controller that coalesces duplicate `/sleep` requests, owns the fallback timer, and calls `actions.speech.disable()` exactly once per pending sleep.
- [x] 1.3 Change `POST /sleep` so it returns immediately when speech is already disabled, otherwise waits for the pending deferred sleep to complete before returning the normal status body.
- [x] 1.4 Change `POST /wake` so waking Talon clears any pending deferred sleep before calling `actions.speech.enable()`.

## 2. Dictator Client Integration

- [x] 2.1 Increase `TalonControlClient`'s timeout so delayed `/sleep` responses have enough margin over the bridge fallback.
- [x] 2.2 Preserve the existing `TalonControlStatus` response model and awake/asleep/unavailable/error mapping; do not add a pending-sleep state.

## 3. Tests and Verification

- [x] 3.1 Add focused bridge-level coverage for sleep completing on `post:phrase`, sleep completing on fallback timeout, duplicate sleep coalescing, and already-asleep immediate response.
- [x] 3.2 Add or update `TalonControlClientTests` coverage for delayed successful sleep responses and bridge timeout/error behavior.
- [x] 3.3 Run the focused Dictator test suite covering Talon control and Launchpad Talon status behavior.
- [x] 3.4 Manually smoke-test the installed Talon bridge by waking Talon, speaking a short Talon command, pressing the Launchpad sleep control before normal phrase processing completes, and confirming the command finalizes before Talon sleeps.
