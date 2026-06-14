## Why

The Launchpad's Talon Lite path is a parallel dictation system that does not work well enough to justify its complexity. The machine already has the full Talon app installed, and live testing confirmed Talon can be woken, put to sleep, and queried through its scripting API.

## What Changes

- Remove the Launchpad Talon Lite dictation workflow from the primary product layout and controller path.
- Add a Sheaf-owned Talon bridge script, stored in this repository, that exposes local-only wake, sleep, and state operations backed by Talon's `actions.speech.enable()`, `actions.speech.disable()`, and `actions.speech.enabled()` APIs.
- Add a Make command that installs the Talon bridge into the user's Talon home using a symlink so the Sheaf repo remains the source of truth.
- Repurpose the current Talon Lite Launchpad button into a full Talon toggle: pressing once wakes Talon, pressing again sleeps Talon, and the pad color reflects Talon's awake, asleep, unavailable, or blocked state.
- Before starting any non-Talon Dictator dictation flow, always send Talon a sleep command, even if Talon is already believed to be asleep.
- Refuse to wake Talon while any non-Talon Dictator dictation operation is active.
- **BREAKING**: The Launchpad `talon_lite_dictation` behavior and Talon Lite interaction-history mode are retired from the normal Launchpad workflow.

## Capabilities

### New Capabilities

- `dictator-talon-control`: Defines the Sheaf-owned Talon bridge, symlink installation flow, local control/status operations, and Talon availability semantics.

### Modified Capabilities

- `dictator-launchpad`: Replaces the Talon Lite pad with a full Talon control/status pad and removes the Launchpad Talon Lite recording behavior.
- `dictator-dictation-pipeline`: Requires every non-Talon Dictator dictation start path to force Talon asleep before recording or processing begins.

## Impact

- Affected code:
  - `projects/dictator/src/Sources/DictatorService/LaunchpadServiceController.swift`
  - `projects/dictator/src/Sources/DictatorService/LaunchpadDSL.swift`
  - `projects/dictator/src/Sources/DictatorService/DictationHTTPServer.swift`
  - `projects/dictator/src/launchpad/launchpad-layout.json`
  - `projects/dictator/tests/fixtures/launchpad-layout.json`
  - New Talon bridge source under `projects/dictator/src/talon/`
  - `Makefile` or project Make include for the bridge install command
- Affected specs:
  - `openspec/specs/dictator-launchpad/spec.md`
  - `openspec/specs/dictator-dictation-pipeline/spec.md`
  - New `openspec/specs/dictator-talon-control/spec.md`
- Runtime dependencies:
  - A locally installed Talon app with user scripts loaded from `~/.talon/user`.
  - A symlink from Talon user scripts back to the Sheaf-owned bridge source.
  - Local-only IPC or HTTP between Dictator and the Talon bridge.
