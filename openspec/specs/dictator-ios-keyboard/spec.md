# Capability: iOS Keyboard

Project: `projects/dictator`
ID prefix: `ios` — requirement IDs are append-only; never renumber or reuse.

## Purpose

A separate iOS client under `src/ios-keyboard/`: a host app that records
audio and uploads it to the dictator service, plus a custom keyboard
extension that triggers dictation and inserts the completed transcript into
the active text field. Host and extension coordinate through an app group
and Darwin notifications. It builds from its own Xcode project, not the
Swift package.

## Requirements

### Requirement: ios-1 — Server endpoint: URL resolution
THE client SHALL resolve the dictator base URL in this order: app-group default `ios_client_host_url` (trimmed, non-empty) → `Info.plist` key `ios_client_host_url` → fallback `http://127.0.0.1:9003`; the host app's Status section can save an override into the app-group default (saving an empty string clears it).

#### Scenario: App-group override present
- **WHEN** app-group default `ios_client_host_url` is set to a non-empty trimmed value
- **THEN** the client uses that value as the base URL

#### Scenario: App-group override absent, Info.plist key present
- **WHEN** app-group default `ios_client_host_url` is absent or empty and `Info.plist` key `ios_client_host_url` is set
- **THEN** the client uses the `Info.plist` value as the base URL

#### Scenario: Both overrides absent
- **WHEN** both app-group default and `Info.plist` key are absent or empty
- **THEN** the client uses the fallback `http://127.0.0.1:9003`

#### Scenario: Override cleared
- **WHEN** the host app's Status section saves an empty string as the app-group default
- **THEN** the app-group override is cleared

### Requirement: ios-2 — Server endpoint: Upload request shape
WHEN uploading a take, THE host app SHALL send `POST <base>/v1/dictate-audio` with raw WAV body and headers `Content-Type: audio/wav`, `X-Sample-Rate: 16000`, `X-Locale: en-US`, `X-Session-Id: <session id>`, `X-Request-Id: <request id>`, with a 90 s timeout, and decode the response as `{raw_transcript, revised_text, edit_summary, uncertainty_flags, transcribe_ms, refine_ms}`. The client SHALL NOT call `/v1/transcribe` or `/v1/refine`.

#### Scenario: Take uploaded
- **WHEN** the host app uploads a take
- **THEN** it sends `POST <base>/v1/dictate-audio` with a raw WAV body, headers `Content-Type: audio/wav`, `X-Sample-Rate: 16000`, `X-Locale: en-US`, `X-Session-Id`, and `X-Request-Id`, a 90 s timeout, and decodes the response as `{raw_transcript, revised_text, edit_summary, uncertainty_flags, transcribe_ms, refine_ms}`

#### Scenario: Forbidden endpoints not called
- **WHEN** the client communicates with the server
- **THEN** it does not call `/v1/transcribe` or `/v1/refine`

### Requirement: ios-3 — Shared session state: App-group storage
THE host and extension SHALL share state through app group `group.com.joyo.dictator`; the keyboard session persists as JSON under defaults key `keyboard_session_v1` (dates encoded as milliseconds since 1970) with fields `sessionID`, `startedAt`, `updatedAt`, `phase`, `errorMessage`, `latestTranscriptUpdatedAt`, `recordingStartedAt`, `lastTakeDuration`.

#### Scenario: Session state shared
- **WHEN** the host or extension saves session state
- **THEN** it is stored as JSON under `keyboard_session_v1` in the `group.com.joyo.dictator` app group, with dates encoded as milliseconds since 1970

### Requirement: ios-4 — Shared session state: Phase values and derived defaults
THE session phase SHALL be one of `idle`, `launching_host`, `host_ready`, `recording`, `stopping`, `processing`, `completed`, `failed`, `cancelled`; `idle`, `completed`, `failed`, and `cancelled` are terminal. Saving a session also maintains the derived defaults `host_session_active`, `dictation_in_progress`, and `host_session_heartbeat_at`; clearing the session removes them.

#### Scenario: Valid phase set
- **WHEN** the session phase is set
- **THEN** it is one of `idle`, `launching_host`, `host_ready`, `recording`, `stopping`, `processing`, `completed`, `failed`, or `cancelled`

#### Scenario: Session saved
- **WHEN** the session is saved
- **THEN** the derived defaults `host_session_active`, `dictation_in_progress`, and `host_session_heartbeat_at` are also maintained

#### Scenario: Session cleared
- **WHEN** the session is cleared
- **THEN** the derived defaults `host_session_active`, `dictation_in_progress`, and `host_session_heartbeat_at` are removed

### Requirement: ios-5 — Shared session state: Session ID mismatch, phase timestamps
WHEN a session update arrives for a different `sessionID` than the stored non-nil session, THE client SHALL ignore it; entering `recording` stamps `recordingStartedAt`; entering `processing`/`completed` derives `lastTakeDuration` from `recordingStartedAt` when not supplied.

#### Scenario: Mismatched session ID
- **WHEN** a session update arrives for a different `sessionID` than the stored non-nil session
- **THEN** the client ignores it

#### Scenario: Recording phase entered
- **WHEN** the session enters the `recording` phase
- **THEN** `recordingStartedAt` is stamped

#### Scenario: Processing or completed phase entered without lastTakeDuration
- **WHEN** the session enters `processing` or `completed` and `lastTakeDuration` was not supplied
- **THEN** `lastTakeDuration` is derived from `recordingStartedAt`

### Requirement: ios-6 — Shared session state: Stale session reconciliation
WHEN reading the current session, THE client SHALL reconcile stale sessions to `failed`: `launching_host` older than 8 s → `Dictator did not finish launching. Continue in Dictator to record.`; `stopping` older than 20 s or `processing` older than `max(180 s, lastTakeDuration)` → `Dictation did not finish processing. Open Dictator to continue.`; `host_ready`/`recording` never go stale.

#### Scenario: Stale launching_host session
- **WHEN** the current session is read and its phase is `launching_host` older than 8 s
- **THEN** it is reconciled to `failed` with message `Dictator did not finish launching. Continue in Dictator to record.`

#### Scenario: Stale stopping session
- **WHEN** the current session is read and its phase is `stopping` older than 20 s
- **THEN** it is reconciled to `failed` with message `Dictation did not finish processing. Open Dictator to continue.`

#### Scenario: Stale processing session
- **WHEN** the current session is read and its phase is `processing` older than `max(180 s, lastTakeDuration)`
- **THEN** it is reconciled to `failed` with message `Dictation did not finish processing. Open Dictator to continue.`

#### Scenario: host_ready or recording session
- **WHEN** the current session is read and its phase is `host_ready` or `recording`
- **THEN** it is never considered stale

### Requirement: ios-7 — Shared session state: Transcript storage and insertion dedup
WHEN a transcript completes, THE host SHALL store it in the app-group defaults under `latest_transcript` / `latest_transcript_updated_at`; THE extension SHALL insert the latest completed transcript at most once per (`sessionID`, `latest_transcript_updated_at`) pair, tracked via `last_inserted_session_id` / `last_inserted_transcript_updated_at`.

#### Scenario: Transcript completed
- **WHEN** a transcript completes
- **THEN** the host stores it under `latest_transcript` and `latest_transcript_updated_at` in the app-group defaults

#### Scenario: Extension inserts transcript
- **WHEN** the extension inserts a completed transcript
- **THEN** it inserts it at most once per (`sessionID`, `latest_transcript_updated_at`) pair, tracked via `last_inserted_session_id` and `last_inserted_transcript_updated_at`

### Requirement: ios-8 — Coordination and diagnostics: Darwin notifications
THE host and extension SHALL signal each other with Darwin notifications `com.joyo.dictator.dictation.start`, `.stop`, `.cancel-take`, and `.session-updated`; every session save posts `.session-updated`.

#### Scenario: Session saved
- **WHEN** a session is saved
- **THEN** the `.session-updated` Darwin notification is posted

#### Scenario: Dictation signalled
- **WHEN** dictation is started, stopped, or a take is cancelled
- **THEN** the corresponding Darwin notification (`com.joyo.dictator.dictation.start`, `.stop`, or `.cancel-take`) is posted

### Requirement: ios-9 — Coordination and diagnostics: Host app launch via URL scheme
THE extension SHALL launch the host app via URL scheme `dictatorkeyboardhost://` (`://open`, `://dictation`).

#### Scenario: Extension launches host app
- **WHEN** the extension needs to launch the host app
- **THEN** it does so via the `dictatorkeyboardhost://` URL scheme (`://open` or `://dictation`)

### Requirement: ios-10 — Coordination and diagnostics: Local diagnostics only
THE client SHALL append timestamped diagnostics lines to `host_diagnostics.log` inside the app-group container only; it SHALL NOT post traces to any remote service or write under the repo's `data/dictator/`.

#### Scenario: Diagnostics written locally
- **WHEN** the client writes diagnostics
- **THEN** timestamped lines are appended to `host_diagnostics.log` inside the app-group container

#### Scenario: No remote traces
- **WHEN** the client generates diagnostic information
- **THEN** it does not post traces to any remote service and does not write under the repo's `data/dictator/`

## Contracts

The upload request/response contract is owned by
[dictation-pipeline](../dictator-dictation-pipeline/spec.md). App-group keys (all under
`group.com.joyo.dictator`):

| Key | Content |
|---|---|
| `keyboard_session_v1` | JSON `SharedKeyboardSession` (ms-since-1970 dates) |
| `latest_transcript` / `latest_transcript_updated_at` | last completed transcript + epoch seconds |
| `last_inserted_session_id` / `last_inserted_transcript_updated_at` | insertion dedup markers |
| `ios_client_host_url` | server base-URL override |
| `dictation_in_progress`, `host_session_active`, `host_session_heartbeat_at` | derived activity flags |

## Design

- `src/ios-keyboard/Shared/SharedConfig.swift` — everything normative above:
  URL resolution, request construction
  (`makeDictateAudioRequest`), session persistence/staleness, transcript and
  insertion tracking, diagnostics. `Shared/DarwinNotificationCenter.swift`
  wraps `CFNotificationCenterGetDarwinNotifyCenter`.
- `src/ios-keyboard/DictatorKeyboardHost/HostApp/` — SwiftUI host app
  (recording, upload, status/override UI);
  `DictatorKeyboardHost/DictatorKeyboardExtension/KeyboardViewController.swift`
  — keyboard UI, host launch, transcript insertion.
- `src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj` —
  source-of-truth build metadata; scheme `DictatorKeyboardHost`. Setup notes:
  `src/ios-keyboard/README.md`, `src/ios-keyboard/XCODE_SETUP.md`.
- Tests: `tests/ios-keyboard/DictatorKeyboardHostTests/DictatorKeyboardHostTests.swift`
  (URL resolution and overrides, upload target and headers, response
  decoding, session launch/stale/failure paths, insertion tracking, Darwin
  callback delivery, local diagnostics), plus UI test stubs under
  `tests/ios-keyboard/DictatorKeyboardHostUITests/`. Build/test lanes:
  [operations](../../../projects/dictator/docs/operations.md).

## Interactions

- [dictation-pipeline](../dictator-dictation-pipeline/spec.md) — the only service API this
  client uses. On a physical device the base URL must point at the Mac's LAN
  address with port `9003`.
