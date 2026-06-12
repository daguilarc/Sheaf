# Spec Coverage

Last audit: living-spec migration (one-time rewrite from code), 2026-06-10

| Capability | Status | Gaps |
|---|---|---|
| dictation-pipeline | partial | `X-Style-Prefs-Json` dead end, whisper talon decode options, segments/confidence internal shape |
| service-lifecycle | partial | in-flight requests at shutdown, log rotation, server concurrency limits |
| web-ui | partial | dashboard rendering detail, stale config-manager snapshots, 500-path messages |
| launchpad | partial | MIDI wire protocol, render-worker timing, Talon Lite grammar not enumerated |
| ios-keyboard | partial | host/extension UI flows, recording format on device, Xcode signing setup |

## Known gaps

### dictation-pipeline
- `X-Style-Prefs-Json` is validated and forwarded as `style_prefs`, but no
  engine or prompt builder consumes it (dp-8 documents acceptance only).
- Talon-lite whisper decoding options (initial prompt, suppress regex,
  guidance) in `WhisperCPPBridgeSTTEngine` are unspecified; only the
  observable Talon Lite outputs are pinned in [launchpad](../../../openspec/specs/dictator-launchpad/spec.md).
- `TranscribeResponse.segments`/`confidence`/`duration_ms` exist internally
  but are not exposed over HTTP; their computation is Design-level only.
- Validation order among the 400/422 checks is not pinned beyond what tests
  assert.
- The HTTP failure record discards the captured audio (`audioData` is
  accepted by the handler and ignored); audio is never persisted anywhere.

### service-lifecycle
- Behavior of in-flight dictation requests during `/exit` shutdown is
  unspecified (channel close cancels per-connection tasks; no drain
  guarantee).
- `logs/dictator/trace.log` grows without rotation; startup `reset()` does
  not truncate. No retention policy.
- Single event-loop-thread capacity/backpressure beyond the 25 MiB body cap
  and backlog 256 is unspecified.
- The service reads `config/services.json` only at startup; registry edits
  require a restart.

### web-ui
- `app.js` rendering/refresh behavior (polling, panel state) is summarized
  in web-17, not specified element-by-element.
- `GET /api/config` `current` values come from configuration-manager
  snapshots that can lag hand-edits of `config/dictator.json` made while the
  service runs (noted in Design); intended semantics unresolved.
- Unexpected handler failures (e.g. prompt file deleted between list and
  preview) return 500 with platform `localizedDescription` strings; not
  catalogued.
- Wrong-method requests on `/api/*` paths return 404 rather than 405
  (svc-10); acceptable but unreviewed.

### launchpad
- The Launchpad Pro Mk3 MIDI protocol (SysEx programmer-mode enter, LED
  message format, note↔coordinate mapping, sleep detection) is implemented
  in `LaunchpadMIDIManager` and pinned by `LaunchpadTests` but not specified
  here.
- Render-worker cadence and diffing are Design-level only.
- The Talon Lite grammar (commands, captures, rendering rules) and the LLM
  correction prompt are not enumerated; covered only by
  `TalonLite*Tests`.
- Multi-page layouts are supported by the page controller but the product
  layout has one page; page-switching behavior is unspecified.

### ios-keyboard
- Host app and keyboard extension UI flows (buttons, status text, recording
  pipeline on device) are unspecified; only the shared contract surface
  (`SharedConfig`) is pinned.
- On-device audio capture format is assumed 16 kHz WAV to match the upload
  header; not verified in this spec.
- Xcode signing/app-group provisioning steps live in
  `src/ios-keyboard/XCODE_SETUP.md` (informative, not normative).

### contracts
- `config/dictator.json` `version` has no behavioral meaning beyond the
  legacy `model`-key decode path; version-3 semantics undefined.
- Cross-process concurrent writers to `config/dictator.json` or the
  interaction JSONL files are unspecified (single-process locking only).

## Observed code/spec mismatches and dead code (candidate fixes, not spec gaps)

- Unwired components compiled into the targets:
  `SpeechFrameworkSTTEngine`, `ModelAvailabilityChecker`,
  `VoiceConfigDecision` + `VoiceConfigInteractionOrchestrator` (the service
  never passes an orchestrator, so `interactForRuntimeConfig` always throws),
  `OllamaBootstrapper` (never invoked despite the `ollama_bin_path` config
  key), `FocusedInputDetector`, `InMemorySecretStore` (test-only), and the
  `LaunchpadArrowCycle*` event-tap trio.
- `config/dictator.safe` does not exist in the current checkout, so reset
  and the safe-config pad restore bootstrap defaults (`use_cloud: false`),
  which differ from the live `config/dictator.json` (`use_cloud: true`).
- `WebAPIJSON.StatusResponse.ollama_reachable` is typed optional but every
  code path sets it.
- The old `src/contracts/dictation_v1.yaml` omits the 405/413 statuses and
  the `audio/x-wav` alias; this spec supersedes it.
