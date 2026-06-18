# dictator-talon-control Specification

## Purpose
Define how Dictator controls the full Talon installation already present on the
machine: a Sheaf-owned Talon user script (the "bridge") exposing local-only
status/wake/sleep operations, the symlink install flow that keeps the repo as
the source of truth, and the availability semantics (awake, asleep,
unavailable, error) Dictator maps bridge responses to.

## Requirements
### Requirement: tc-1 — Talon bridge source of truth
THE Dictator project SHALL store the Talon-side bridge source in the Sheaf repository under `projects/dictator/src/talon/sheaf_control/`, and that repository copy SHALL be the source of truth for the installed Talon user script.

#### Scenario: Bridge source lives in repo
- **WHEN** a developer inspects the Talon bridge implementation
- **THEN** the bridge source is present under `projects/dictator/src/talon/sheaf_control/`

#### Scenario: Installed bridge points to repo source
- **WHEN** the bridge is installed into Talon
- **THEN** the installed Talon user-script entry points back to the Sheaf repository source rather than containing an independent copy

### Requirement: tc-2 — Talon bridge symlink install command
THE Dictator project SHALL provide an idempotent Make command that installs the Talon bridge by creating or repairing a symlink from the user's Talon home into the Sheaf repository source.

#### Scenario: Symlink absent
- **WHEN** the Make install command runs and `~/.talon/user/sheaf_control` is absent
- **THEN** it creates a symlink to `projects/dictator/src/talon/sheaf_control`

#### Scenario: Symlink already correct
- **WHEN** the Make install command runs and `~/.talon/user/sheaf_control` already points to the repository bridge source
- **THEN** it succeeds without replacing the symlink

#### Scenario: Conflicting path exists
- **WHEN** the Make install command runs and `~/.talon/user/sheaf_control` exists but is not the expected symlink
- **THEN** it fails with a clear message and does not overwrite user files

### Requirement: tc-3 — Talon bridge local control API
THE Talon bridge SHALL expose local-only status, wake, and sleep operations backed by Talon's `actions.speech.enabled()`, `actions.speech.enable()`, and `actions.speech.disable()` APIs.

#### Scenario: Status requested
- **WHEN** Dictator requests Talon status through the bridge
- **THEN** the bridge returns whether Talon speech is enabled and includes the current Talon mode set

#### Scenario: Wake requested
- **WHEN** Dictator requests Talon wake through the bridge
- **THEN** the bridge calls `actions.speech.enable()` and returns the resulting status

#### Scenario: Sleep requested
- **WHEN** Dictator requests Talon sleep through the bridge
- **THEN** the bridge follows the deferred sleep semantics and returns the resulting status

### Requirement: tc-4 — Talon bridge local-only exposure
THE Talon bridge SHALL accept control requests only from the local machine and SHALL NOT expose arbitrary Talon code execution or non-Talon Dictator APIs.

#### Scenario: Local request
- **WHEN** Dictator sends a status, wake, or sleep request from the local machine
- **THEN** the bridge can process the request

#### Scenario: Unsupported operation
- **WHEN** a caller requests any operation other than status, wake, or sleep
- **THEN** the bridge rejects the request without executing arbitrary code

### Requirement: tc-5 — Dictator Talon control client
THE Dictator service SHALL provide a Talon control client that maps bridge responses and failures to explicit states: `awake`, `asleep`, `unavailable`, or `error`.

#### Scenario: Talon awake
- **WHEN** the bridge reports speech enabled
- **THEN** Dictator maps Talon state to `awake`

#### Scenario: Talon asleep
- **WHEN** the bridge reports speech disabled or a mode set containing `sleep`
- **THEN** Dictator maps Talon state to `asleep`

#### Scenario: Bridge unavailable
- **WHEN** Dictator cannot connect to the Talon bridge within the configured timeout
- **THEN** Dictator maps Talon state to `unavailable`

#### Scenario: Bridge error
- **WHEN** the bridge responds with an error
- **THEN** Dictator maps Talon state to `error` and preserves the error message for tracing

### Requirement: tc-6 — Talon wake refusal while Dictator is active
WHEN Dictator receives a request to wake Talon while any non-Talon Dictator dictation is recording or processing, THE Dictator service SHALL refuse the wake request, SHALL leave or put Talon asleep, and SHALL expose a blocked Talon state to Launchpad rendering.

#### Scenario: Wake requested while Dictator recording
- **WHEN** the Launchpad Talon control is pressed while Dictator is recording non-Talon dictation
- **THEN** Dictator refuses to wake Talon and renders the Talon control as blocked

#### Scenario: Wake requested while Dictator processing
- **WHEN** the Launchpad Talon control is pressed while Dictator is processing non-Talon dictation
- **THEN** Dictator refuses to wake Talon and renders the Talon control as blocked

#### Scenario: Wake requested while Dictator idle
- **WHEN** the Launchpad Talon control is pressed while Dictator is idle and Talon is asleep
- **THEN** Dictator requests Talon wake through the bridge

### Requirement: tc-7 — Bridge sleep: Defer until phrase finalization
WHEN the Talon bridge receives a sleep request while Talon speech is enabled, THE Talon bridge SHALL disable speech after the next Talon `post:phrase` callback, and SHALL disable speech after a bounded fallback timeout if no `post:phrase` callback arrives.

#### Scenario: Sleep waits for phrase finalization
- **WHEN** the bridge receives `POST /sleep` while speech is enabled and Talon later emits `post:phrase` before the fallback timeout
- **THEN** the bridge disables speech after the `post:phrase` callback and returns an asleep status

#### Scenario: Sleep falls back when no phrase finalizes
- **WHEN** the bridge receives `POST /sleep` while speech is enabled and no `post:phrase` callback arrives before the fallback timeout
- **THEN** the bridge disables speech after the fallback timeout and returns an asleep status

#### Scenario: Duplicate sleep joins pending sleep
- **WHEN** the bridge receives another `POST /sleep` while a deferred sleep is already pending
- **THEN** the bridge coalesces the request with the existing pending sleep and does not register an additional phrase callback or fallback timer

#### Scenario: Sleep while already asleep
- **WHEN** the bridge receives `POST /sleep` while speech is already disabled
- **THEN** the bridge returns an asleep status without waiting for `post:phrase`
