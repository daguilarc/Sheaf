# Capability: iOS Keyboard

ID prefix: `ios`

## Purpose

A separate iOS client under `src/ios-keyboard/`: a host app that records
audio and uploads it to the dictator service, plus a custom keyboard
extension that triggers dictation and inserts the completed transcript into
the active text field. Host and extension coordinate through an app group
and Darwin notifications. It builds from its own Xcode project, not the
Swift package.

## Requirements

### Server endpoint

- **[ios-1]** THE client SHALL resolve the dictator base URL in this order:
  app-group default `ios_client_host_url` (trimmed, non-empty) → `Info.plist`
  key `ios_client_host_url` → fallback `http://127.0.0.1:9003`; the host
  app's Status section can save an override into the app-group default
  (saving an empty string clears it).
- **[ios-2]** WHEN uploading a take, THE host app SHALL send
  `POST <base>/v1/dictate-audio` with raw WAV body and headers
  `Content-Type: audio/wav`, `X-Sample-Rate: 16000`, `X-Locale: en-US`,
  `X-Session-Id: <session id>`, `X-Request-Id: <request id>`, with a 90 s
  timeout, and decode the response as `{raw_transcript, revised_text,
  edit_summary, uncertainty_flags, transcribe_ms, refine_ms}`. The client
  SHALL NOT call `/v1/transcribe` or `/v1/refine`.

### Shared session state

- **[ios-3]** THE host and extension SHALL share state through app group
  `group.com.joyo.dictator`; the keyboard session persists as JSON under
  defaults key `keyboard_session_v1` (dates encoded as milliseconds since
  1970) with fields `sessionID`, `startedAt`, `updatedAt`, `phase`,
  `errorMessage`, `latestTranscriptUpdatedAt`, `recordingStartedAt`,
  `lastTakeDuration`.
- **[ios-4]** THE session phase SHALL be one of `idle`, `launching_host`,
  `host_ready`, `recording`, `stopping`, `processing`, `completed`,
  `failed`, `cancelled`; `idle`, `completed`, `failed`, and `cancelled` are
  terminal. Saving a session also maintains the derived defaults
  `host_session_active`, `dictation_in_progress`, and
  `host_session_heartbeat_at`; clearing the session removes them.
- **[ios-5]** WHEN a session update arrives for a different `sessionID` than
  the stored non-nil session, THE client SHALL ignore it; entering
  `recording` stamps `recordingStartedAt`; entering `processing`/`completed`
  derives `lastTakeDuration` from `recordingStartedAt` when not supplied.
- **[ios-6]** WHEN reading the current session, THE client SHALL reconcile
  stale sessions to `failed`: `launching_host` older than 8 s →
  `Dictator did not finish launching. Continue in Dictator to record.`;
  `stopping` older than 20 s or `processing` older than
  `max(180 s, lastTakeDuration)` → `Dictation did not finish processing.
  Open Dictator to continue.`; `host_ready`/`recording` never go stale.
- **[ios-7]** WHEN a transcript completes, THE host SHALL store it in the
  app-group defaults under `latest_transcript` /
  `latest_transcript_updated_at`; THE extension SHALL insert the latest
  completed transcript at most once per (`sessionID`,
  `latest_transcript_updated_at`) pair, tracked via
  `last_inserted_session_id` / `last_inserted_transcript_updated_at`.

### Coordination and diagnostics

- **[ios-8]** THE host and extension SHALL signal each other with Darwin
  notifications `com.joyo.dictator.dictation.start`, `.stop`,
  `.cancel-take`, and `.session-updated`; every session save posts
  `.session-updated`.
- **[ios-9]** THE extension SHALL launch the host app via URL scheme
  `dictatorkeyboardhost://` (`://open`, `://dictation`).
- **[ios-10]** THE client SHALL append timestamped diagnostics lines to
  `host_diagnostics.log` inside the app-group container only; it SHALL NOT
  post traces to any remote service or write under the repo's
  `data/dictator/`.

## Contracts

The upload request/response contract is owned by
[dictation-pipeline](dictation-pipeline.md). App-group keys (all under
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
  [operations](../operations.md).

## Interactions

- [dictation-pipeline](dictation-pipeline.md) — the only service API this
  client uses. On a physical device the base URL must point at the Mac's LAN
  address with port `9003`.
