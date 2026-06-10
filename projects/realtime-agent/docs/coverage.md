# Spec Coverage

Last audit: living-spec migration (one-time rewrite from code), 2026-06-10

| Capability | Status | Gaps |
|---|---|---|
| session-lifecycle | partial | silent post-close send errors, EventRouter per-class callback surface untested |
| turn-model | partial | `cancelled` result status unproduced, hold leak on never-emitted tool output |
| tool-dispatch | partial | no schema validation, accumulator leak on abandoned deltas |
| persistence | partial | cross-process concurrency unspecified |
| audio-capture | partial | sox availability unchecked at startup, resampler unspecified consumer |
| config | partial | `runtimeLogPath` ignores `logs_dir`, `data_dir` unused |
| cli | partial | unrecognized flags crash uncaught, `--input-device` for sox path |
| vscode-extension | partial | webview CSS/visual contract, Secret Storage has no write surface, output-channel wording |
| editor-tools | partial | `too_many_results` code unproduced, rgrep glob semantics deferred to VS Code, `bottom` reveal approximation |
| freshness | partial | lost notification on send failure, `.` (workspace-root) relative path edge |

## Known gaps

### session-lifecycle
- The session impl registers no `RealtimeClient.onError` handler, so
  transport errors during `send` after an unexpected close (e.g. audio
  frames still streaming) are silently dropped — no log, no callback.
- The `EventRouter` per-class callbacks (`onTranscription`,
  `onToolCall`, …) are exported surface but unused by both consumers;
  their invocation order relative to `onEvent`/`onConversationEvent` is
  specified only loosely (general first, class-specific second).
- `startAgentSession` creates the session row before connecting; a failed
  connect leaves an orphan row with no `ended_at`. Unspecified whether
  callers should clean these up (neither does).
- `connect()` rejections after socket replacement and `off()` semantics of
  the `RealtimeWebSocketLike` wrapper (message/close listeners cannot be
  removed) are unspecified.

### turn-model
- `QueuedEventResult.status` includes `"cancelled"` but no code path
  produces it.
- If a function call is detected and a hold registered (turn-11) but the
  dispatcher never transmits the matching `function_call_output` (cannot
  happen with current dispatcher code paths, which always send an output),
  the queue would stay busy forever; no timeout exists.
- `response.cancelled` is handled as a terminal event but the Realtime API
  primarily signals cancellation through `response.done` with a cancelled
  status; the extra type is defensive and untested against the live API.

### tool-dispatch
- `inputSchema` is advertised to the model but never validated locally;
  `invalid_arguments` covers only JSON parse failures (documented in
  td-9, but the schema-mismatch behavior — args passed through to the
  callback — is implicit).
- `FunctionCallArgumentAccumulator` entries for calls that stream deltas
  but never receive a `done` event are retained for the session lifetime.
- `ToolRuntimeContext.log` exists in the type but is never populated.

### persistence
- Two simultaneous CLI runs share `data/realtime-agent/realtime-agent.sqlite`;
  behavior relies on better-sqlite3 defaults (no WAL mode, no busy
  timeout configured) and is unspecified. The CLI and extension use
  separate database files, so cross-surface contention does not arise.

### audio-capture
- The sox path (`rec`) is resolved lazily at capture start; there is no
  startup probe, so a missing sox binary surfaces as a spawn `error`
  callback after the session is already connected.
- `ResampleInt16Mono` is exported from the module (not the package) and
  unused by both capture backends; intended consumer unspecified.
- PortAudio device ids are backend-assigned and can change across
  restarts/hardware changes; stability is unspecified.

### config
- `runtimeLogPath` is always the default `logs/realtime-agent/realtime-agent.jsonl`
  even when `logs_dir` is customized (cfg-3); whether `logs_dir` should
  feed it is unresolved — the old docs implied it did.
- `data_dir` is loaded and defaulted but consumed by nothing.
- `DEFAULT_DATABASE_PATH` ([persistence](capabilities/persistence.md)) is
  computed at module import and throws outside a Sheaf checkout, making
  the package import-unsafe elsewhere; unspecified whether that is
  intended.

### cli
- Unrecognized flags or positional arguments make `parseArgs` throw; the
  error is not caught, so the process dies with an uncaught-exception
  stack instead of a usage message (cli error catalogue marks this as a
  gap).
- On macOS, supplying `--input-device` forces the PortAudio path; there is
  no way to pick a specific device through the sox backend.
- `RunCli` with `registerSignalHandlers: false` returns 0 immediately
  after startup while the session keeps running (test seam); the contract
  for embedding callers is loosely specified.
- Stdout is line-buffered JSON with no flush guarantees on abnormal exit.

### vscode-extension
- The chat webview's visual contract (`index.css` class names
  `sheaf-bubble-*`, layout) is unspecified; only the DOM/data behavior in
  vsx-17/18 is normative.
- Secret Storage is read (vsx-5) but the extension offers no command to
  write the secret; populating it is out of band.
- Output-channel line wording (vsx-20 `Line`/`Error` messages) is not
  pinned; only the structured JSONL event names are.
- `sessionIdPrefix` in the snapshot message carries the full session id
  (truncation happens client-side); the field name is misleading.
- The baseline system prompt text is treated as canonical-in-source rather
  than restated; rewording it would not violate this spec.
- Deactivation wait deadlines (30 s starting / 10 s stopping) poll every
  50 ms; behavior when deadlines lapse (session left running) is
  unspecified.

### editor-tools
- `ToolError` code `too_many_results` is declared but no tool returns it
  (rgrep/list_files use `truncated` instead).
- `rgrep` `fileGlob`/`directory` matching defers to VS Code
  `findFiles` glob semantics (and its `files.exclude`/search settings);
  not restated here, so results can differ between users.
- The 5 001-file discovery cap means rgrep over large workspaces silently
  ignores files beyond the cap with `truncated` still `false` if matches
  fit; unspecified.
- `move_visible_range`/`set_cursor_position` `bottom` alignment is
  approximated by revealing from five lines above at top
  (`editorAccess.ts`); exact final viewport is editor-dependent.
- `list_files` non-recursive mode collects all entries before applying
  `maxEntries` (no early exit); recursive mode truncates in BFS order
  before sorting. Cost/order nuances unspecified beyond et-6.
- `modifyFile` validates against the buffer, then applies the edit in a
  separate async step; a buffer change in between (same-process only,
  since validation and edit share the extension host's single thread plus
  awaited document opens) is not re-validated.

### freshness
- `notificationSent` is set before the send resolves; if
  `sendStructuredContext` rejects (e.g. connection just dropped), the
  notification is lost until the state is re-observed (fr-7 Design note).
- A document exactly at a workspace root resolves to relative path `.`;
  whether file-freshness tracking is meaningful for it is unspecified.
- Viewport/cursor staleness is global (not per file); switching tabs marks
  both stale regardless of which file was observed — intended, but the
  payload-file fallback chain on tab close is intricate and only pinned by
  `tabSwitch.test.ts`.

## Observed code/spec mismatches (candidate fixes, not spec gaps)

- The old `docs/reference/config.md` claimed “No environment variable
  dependencies”; the sox capture path reads `REALTIME_AGENT_REC_PATH`
  (now documented as aud-5/cfg-8).
- The old `docs/explanation/tool-dispatch.md` listed `commitAudio()` as a
  response-queue operation; it actually bypasses the queue (ses-10,
  turn contracts).
- The old reference docs did not mention the macOS sox fallback at all;
  the native-module rebuild doc implied naudiodon handles all capture.
- `package.json` `clean` for the agent package removes `node_modules`
  inside the workspace package, while the root clean also removes the
  workspace root `node_modules` — `make clean` therefore requires a fresh
  `make install` even for a subsequent build of one package.
