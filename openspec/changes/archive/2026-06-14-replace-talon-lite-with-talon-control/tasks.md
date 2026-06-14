## 1. Talon Bridge And Install

- [x] 1.1 Add `projects/dictator/src/talon/sheaf_control/` with a Talon user script package that implements local status, wake, and sleep operations using Talon's speech APIs.
- [x] 1.2 Choose and document the bridge transport as either loopback HTTP or a Unix-domain socket, keeping it local-only and limited to status/wake/sleep.
- [x] 1.3 Add an idempotent Make target that installs `~/.talon/user/sheaf_control` as a symlink to the repository bridge source.
- [x] 1.4 Make the install target fail clearly when `~/.talon/user/sheaf_control` exists and is not the expected symlink.
- [x] 1.5 Add manual verification notes for reloading Talon scripts and querying bridge status after install.

## 2. Dictator Talon Control Client

- [x] 2.1 Add a Swift Talon control client abstraction with `status`, `sleep`, and `wake` operations.
- [x] 2.2 Map bridge responses and connection failures to explicit Dictator states: `awake`, `asleep`, `unavailable`, and `error`.
- [x] 2.3 Add short timeouts and trace logging so Talon bridge failure never blocks Dictator startup or non-Talon dictation indefinitely.
- [x] 2.4 Add unit tests for awake, asleep, unavailable, error, wake, and sleep client behavior with a fake bridge transport.

## 3. Dictation Activity Arbitration

- [x] 3.1 Extend or replace `DictationActivityTracker` so shared state distinguishes idle, recording, and processing across Launchpad and HTTP dictation paths.
- [x] 3.2 Update HTTP dictation processing to mark shared activity state while active and preserve existing `/api/status` `dictation_state` behavior.
- [x] 3.3 Update Launchpad standard, auxiliary, and review dictation paths to mark shared activity state while recording and processing.
- [x] 3.4 Add tests that Talon wake is refused when Dictator is recording or processing.

## 4. Force Talon Sleep Before Non-Talon Dictation

- [x] 4.1 Send Talon sleep before accepting a valid HTTP `/v1/dictate-audio` request into transcription.
- [x] 4.2 Send Talon sleep before Launchpad standard dictation starts recording.
- [x] 4.3 Send Talon sleep before Launchpad auxiliary dictation starts recording.
- [x] 4.4 Send Talon sleep before Launchpad voice diff review dictation starts recording.
- [x] 4.5 Ensure the sleep command is sent unconditionally, even when Talon is cached or queried as already asleep.
- [x] 4.6 Log and continue non-Talon dictation when the Talon bridge is unavailable or sleep fails.

## 5. Launchpad Talon Control

- [x] 5.1 Replace the `talon_lite_dictation` layout action at `(1,7)` with a `talon_control` action in product and fixture layouts.
- [x] 5.2 Update Launchpad layout decoding and validation to accept `talon_control` and no longer require Talon Lite in the product layout.
- [x] 5.3 Add a Talon control status role or equivalent dynamic color provider for the `(1,7)` pad.
- [x] 5.4 Implement Talon toggle behavior: wake when asleep and Dictator is idle, sleep when awake, refuse wake when Dictator is active, and log unavailable bridge presses.
- [x] 5.5 Render Talon control colors for awake, asleep, blocked, unavailable, and error states.
- [x] 5.6 Add Launchpad tests for Talon control dispatch, status colors, blocked wake, and unavailable bridge behavior.

## 6. Talon Lite Retirement

- [x] 6.1 Remove Launchpad controller invocation of the Talon Lite transcription/rendering pipeline.
- [x] 6.2 Update interaction-history mapping so Launchpad dictation no longer records `talon_lite` mode from product controls.
- [x] 6.3 Remove or quarantine obsolete Talon Lite tests only after confirming no remaining supported path uses the Talon Lite core parser.
- [x] 6.4 Update Launchpad docs and contracts to describe the full Talon control pad instead of Talon Lite.

## 7. Validation

- [x] 7.1 Run the Dictator service tests covering Launchpad, HTTP dictation, and web API status.
- [x] 7.2 Run the Make install target against a temporary Talon home to verify symlink creation, idempotency, and conflict handling.
- [x] 7.3 With Talon running locally, install the bridge, reload Talon scripts, and manually verify status, wake, sleep, Launchpad color, and blocked wake behavior.
- [x] 7.4 Run `openspec validate replace-talon-lite-with-talon-control --strict` or the repository's equivalent OpenSpec validation command.
