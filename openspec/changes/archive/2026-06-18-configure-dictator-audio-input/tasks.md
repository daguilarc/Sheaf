## 1. Runtime Configuration

- [x] 1.1 Add nullable/blank-normalized `audio_input` support to `RuntimeConfigFile`, bootstrap defaults, decode/encode, equality, patches, reset/default snapshots, and runtime configuration manager field mappings.
- [x] 1.2 Update config validation so `audio_input` accepts null or blank for default input and stores non-blank selectors trimmed without requiring the selected device to be currently connected.
- [x] 1.3 Add core config tests covering missing/null/blank `audio_input`, persisted non-blank values, reset defaults, safe-config defaults, and patch persistence.

## 2. Audio Device Resolution And Capture

- [x] 2.1 Introduce an audio input resolver abstraction that lists available macOS input devices and resolves default vs configured selectors without fuzzy fallback; ambiguous or missing configured selectors are unavailable.
- [x] 2.2 Extend `AudioRecorder` or its replacement capture path to bind recording to an optional resolved input device before capture starts and to record the selected device's first input channel.
- [x] 2.3 Ensure configured-input open/setup failures return a recording failure without falling back to the default input.
- [x] 2.4 Add resolver and recorder tests using fakes for default input, exact name/id match, unavailable configured input, ambiguous selector, and selected-device setup failure.

## 3. Web API And Dashboard

- [x] 3.1 Extend `/api/status` with `audio_input`, effective/default-vs-selected metadata, `audio_input_available`, and a user-readable unavailable reason while keeping API key material hidden.
- [x] 3.2 Extend `/api/config`, `PATCH /api/config`, and `/api/config/options?name=audio_input` for the new editable field and update Web API model mappings and error handling.
- [x] 3.3 Update the static dashboard to render the audio-input config field/options and hide the record button whenever status reports `audio_input_available: false`.
- [x] 3.4 Add Web API/dashboard tests for status shape, config field ordering/count, null/blank/non-blank patches, unavailable selected input status, audio input options, and hidden record-button behavior.

## 4. Launchpad Behavior

- [x] 4.1 Route Launchpad recording startup through the runtime `audio_input` resolver and pass the resolved input to the recorder.
- [x] 4.2 Update Launchpad rendering so `(0,7)` is off/unlit when a non-blank selected input is unavailable and returns to normal record-status colors when available.
- [x] 4.3 Ignore dictation actions for `(0,7)` while the selected input is unavailable, with trace logging that names the configured input and no default fallback.
- [x] 4.4 Add Launchpad tests for default-input recording, selected-input recording, unavailable selected input, `(0,7)` off rendering, action ignoring, and availability recovery.

## 5. Docs And Contracts

- [x] 5.1 Update `projects/dictator/docs/contracts/config.md` to document `audio_input`, null/blank/default semantics, no fallback, and the worked example.
- [x] 5.2 Update Dictator operations/architecture/coverage docs if they mention recording inputs, config fields, or dashboard/Launchpad record controls.
- [x] 5.3 Update any committed default or example `config/dictator*.json` files if the repo tracks them.

## 6. Verification

- [x] 6.1 Run `openspec validate configure-dictator-audio-input`.
- [x] 6.2 Run `make dictator-test`.
- [x] 6.3 If practical, perform a manual or smoke capture check with `audio_input` blank and with a non-existent configured input to confirm record controls disappear and no default fallback occurs. Not practical from this non-interactive workspace; covered by automated resolver, recorder, Web API, dashboard-source, and Launchpad controller tests.
