# Slice 0003 — VS Code Extension Scaffold

## Objective

Create the new `apps/vscode-extension` package that hosts the VS Code
extension. After this slice, a developer can launch the extension in a
VS Code Extension Development Host, press F15 to start a manual-mode
realtime-agent session with microphone capture, press F19 to commit and
request a response, and press F15 again to stop. The extension uses the
new realtime-agent Session API (slices 0001 and 0002) — it does not
duplicate Realtime websocket handling.

The chat pane, navigation tools, and context freshness updates are added
in later slices.

## Scope

In scope:

- New `apps/vscode-extension/` package mirroring the shape of
  `apps/obsidian-replica/` (TypeScript + esbuild build to a single
  bundle, separate `tsconfig.test.json` for Node tests).
- `package.json` extension manifest with:
  - `contributes.commands` for `sheaf.realtime.toggleSession` and
    `sheaf.realtime.commitAndRespond`.
  - `contributes.keybindings` mapping `F15` and `F19` to those commands.
  - `engines.vscode` and `activationEvents` covering the two commands.
- `src/extension.ts` activation entry exporting `activate(context)` and
  `deactivate()`.
- `SessionController` (`src/sessionController.ts`) that:
  - Tracks state (`idle`, `starting`, `active`, `stopping`).
  - Starts/stops a manual-mode `RealtimeAgentSession` via the imported
    realtime-agent library.
  - Owns microphone capture and pipes frames to
    `session.sendAudioFrame()`.
  - Handles transient-state guards so duplicate command invocations no-op
    cleanly.
  - Calls `session.commitAudioAndCreateResponse()` for the commit command.
- Microphone capture in the extension host using the existing
  `apps/realtime-agent` `CreateMicrophoneCapture` (sox-based on macOS,
  PortAudio elsewhere). Confirmed reusable because the extension runs in
  the Node-based extension host.
- A status-bar item that mirrors session state and acts as the toggle's
  visual surface (the spec calls for a button; in VS Code, a status-bar
  item is the idiomatic always-visible toggle and can be clicked to
  invoke the same command as F15).
- Configuration surface (`contributes.configuration`) for:
  - `sheaf.realtime.openAiApiKey` (string, secret-friendly via
    SecretStorage if available).
  - `sheaf.realtime.model` (string, default `gpt-realtime-2`).
  - `sheaf.realtime.systemPrompt` (string, default empty — the extension
    supplies a built-in baseline prompt suitable for voice navigation).
  - `sheaf.realtime.inputDevice` (string, optional).
  - `sheaf.realtime.safetyIdentifier` (string, optional).
- SQLite database file managed via `RealtimeAgentDb.open(...)` using the
  extension's global storage path.
- Error surfacing: microphone failures and connection errors stop the
  session and show a `vscode.window.showErrorMessage`.
- Build, lint, and test scripts wired into the package.

Out of scope:

- Chat pane / webview (slice 0005).
- Navigation, code reading, and viewport tools (slice 0004).
- Context freshness notifications (slice 0006).
- Speech output / TTS.
- Publishing/packaging for the VS Code marketplace.

## Key Files / Systems Affected

New package layout (mirrors `apps/obsidian-replica/`):

```
apps/vscode-extension/
  package.json           # extension manifest + scripts
  tsconfig.json          # build config
  tsconfig.test.json     # test config (Node test runner)
  esbuild.config.mjs     # bundle src/extension.ts -> out/extension.js
  src/
    extension.ts         # activate/deactivate
    sessionController.ts # session lifecycle + mic
    commands.ts          # command id constants and registration
    statusBar.ts         # status bar item
    config.ts            # read/typed access to workspace settings
    log.ts               # output channel wrapper
  test/
    sessionController.test.ts
    config.test.ts
  out/                   # build output (gitignored)
```

Cross-package:

- `apps/realtime-agent/package.json` — already exports the library. The
  new extension consumes it via a workspace-style file dependency:
  `"realtime-agent-lib": "file:../realtime-agent"`. Because the repo has
  no top-level workspace (`apps/*` use per-app `node_modules`), the
  extension declares the relative dep and runs `npm install` inside its
  own directory.
- `.gitignore` — add `apps/vscode-extension/out` and
  `apps/vscode-extension/node_modules` if not already covered by the
  existing pattern.

## APIs To Reuse As-Is

- `startAgentSession` from `realtime-agent-lib` — manual mode via the API
  added in slice 0001.
- `CreateMicrophoneCapture` from `realtime-agent-lib` (re-exported if
  not already public; otherwise this slice should add a re-export in
  `apps/realtime-agent/src/index.ts` since the extension is now an
  intended consumer of the audio_input module).
- `RealtimeAgentDb.open(path?)` for session/event persistence.
- `vscode.commands.registerCommand`, `vscode.window.createStatusBarItem`,
  `vscode.window.createOutputChannel`,
  `vscode.window.showErrorMessage`, and `context.secrets`.

## APIs To Extend / Modify

- `apps/realtime-agent/src/index.ts` — add re-exports needed by the
  extension (at minimum `CreateMicrophoneCapture`,
  `CreateSoxMicrophoneCapture`, `MicrophoneCapture` type, and
  `REALTIME_PCM_SAMPLE_RATE`). Keep this targeted; do not bulk-export
  internals that are not needed.

## Design Notes

### Manual-mode session start

`SessionController.start()` does:

1. Resolve API key (SecretStorage preferred, falling back to workspace
   setting / env var).
2. Open the SQLite DB at
   `path.join(context.globalStorageUri.fsPath, "realtime-agent.sqlite3")`.
3. Build `AgentStartConfig` with
   `turnMode: { type: "manual" }`,
   `systemPrompt`, `initialContext`, an empty `toolCallSet`
   (`{ tools: [] }` — populated by slice 0004), and
   `responseAfterToolOutput: true` (added in slice 0002). The flag
   makes the dispatcher request a follow-up model response after each
   tool output so navigation/read tool calls can chain to the next
   tool or final answer. Because `turnMode.type === "manual"`, the
   realtime-agent library (per slice 0001) skips the initial
   `response.create`. The extension does not request a response on
   startup; the first model response is triggered only when the user
   presses F19 (or the chat-pane button bound to
   `sheaf.realtime.commitAndRespond`).
4. `await startAgentSession(config, deps)`.
5. `CreateMicrophoneCapture` with `onFrame: session.sendAudioFrame`.
6. `audioCapture.start()`.

`SessionController.stop()` mirrors the CLI shutdown sequence in
`apps/realtime-agent/src/cli.ts`: stop microphone before
`session.stop(reason)`, then close the database. Reuse the CLI's general
shape but do not import CLI internals; the lifecycle is small enough to
restate inside the extension.

### Commands and keybindings

`package.json` contribution:

```json
{
  "contributes": {
    "commands": [
      { "command": "sheaf.realtime.toggleSession",
        "title": "Sheaf: Toggle Realtime Session" },
      { "command": "sheaf.realtime.commitAndRespond",
        "title": "Sheaf: Commit Audio And Request Response" }
    ],
    "keybindings": [
      { "command": "sheaf.realtime.toggleSession", "key": "f15" },
      { "command": "sheaf.realtime.commitAndRespond", "key": "f19" }
    ]
  }
}
```

No `when` clauses so the bindings work in any VS Code surface (per spec).

### State guarding

`SessionController` exposes a small state machine. The toggle command:

- In `idle`: transition to `starting`, run `start()`, on success
  transition to `active`. On failure, surface the error and return to
  `idle`.
- In `starting` or `stopping`: log and ignore.
- In `active`: transition to `stopping`, run `stop()`, return to `idle`.

The commit command is a no-op outside `active` (display a brief status
bar message via `vscode.window.setStatusBarMessage` and do nothing). In
`active`, it calls `session.commitAudioAndCreateResponse()`. The promise
is awaited; rejections are logged via the output channel but do not
unwind the session.

### Status bar

One status-bar item is created on activation. Its text/tooltip reflects
session state (`$(circle-large-outline) Sheaf` idle vs.
`$(record) Sheaf Listening` active vs. `$(sync~spin) Sheaf …` for
transient states). Clicking it runs the toggle command.

### Configuration access

`src/config.ts` exposes typed getters:

```ts
export function getOpenAiApiKey(context: ExtensionContext):
  Promise<string | undefined>;
export function getModel(): string;
export function getSystemPrompt(): string;
export function getInputDevice(): string | undefined;
export function getSafetyIdentifier(): string | undefined;
```

`getOpenAiApiKey` reads `context.secrets.get("sheaf.realtime.openAiApiKey")`
first, then falls back to the workspace setting, then `OPENAI_API_KEY`
env var.

### Default system prompt and initial context

Spec 03 does not specify wording. Provide a baseline prompt in
`src/prompts.ts` (or inline in `config.ts`) describing the agent as a
voice assistant for code navigation, and a placeholder
`initialContext: ""`. Later slices feed real editor context via tools and
structured-context messages, so the initial context can stay empty here.

### Build pipeline

esbuild config builds `src/extension.ts` to `out/extension.js` as a
single CommonJS bundle, externalizing the `vscode` module (per VS Code
extension convention). Bundle `realtime-agent-lib` because the extension
host needs the JS to be present without npm hoisting weirdness. Native
modules (`better-sqlite3`, `naudiodon`) must remain external and resolved
at runtime from the extension's `node_modules`.

`package.json` scripts:

- `build`: `node esbuild.config.mjs`
- `dev`: `node esbuild.config.mjs --watch`
- `test`: `rm -rf .test-dist && tsc -p tsconfig.test.json && node --test
  .test-dist/test/**/*.test.js`

This mirrors `apps/obsidian-replica`.

## Validation

- `npm test` in `apps/vscode-extension` passes:
  - `SessionController` tests use a fake realtime-agent
    (`startAgentSession` stub) and fake `MicrophoneCapture` to verify the
    state machine: idle→starting→active→stopping→idle, mic stopped
    before session stop, errors return to idle and surface a message,
    duplicate commands no-op.
  - `config` tests verify API key resolution precedence
    (SecretStorage > setting > env var).
  - `SessionController` start test asserts that the underlying
    `startAgentSession` is invoked with `turnMode: { type: "manual" }`
    and that no `response.create` event is sent during startup
    (paired with the manual-mode regression test in slice 0001).
- `npm run build` produces `out/extension.js`.
- Manual smoke (documented in slice notes): launching the Extension
  Development Host, pressing F15 starts a session, status bar reflects
  state, F19 commits and requests a response, F15 stops it.

## Risks / Open Concerns

- **macOS microphone permission**: the extension host process needs
  microphone permission. The first launch may require the user to grant
  permission to the VS Code process. This is documented in the slice's
  README/notes but not solved here — it is a platform reality, not a
  spec gap.
- **Native modules**: `better-sqlite3` and `naudiodon` ship native
  binaries. The extension consumes them via the realtime-agent package.
  They must be rebuilt against the Node version embedded in VS Code's
  extension host (`electron-rebuild` style). The build script documents
  this. If rebuilding becomes painful, a follow-up slice can switch to
  an in-memory better-sqlite3 alternative or pre-compiled binaries, but
  that is not required by the spec.
- **Spec mentions a "button"** for start/stop. A status-bar item is the
  closest idiomatic always-on toggle in VS Code without introducing a
  webview just for the button. The webview-based chat pane (slice 0005)
  can later add its own in-pane button as a richer surface. This plan
  treats the status-bar item as the spec's button for slice 0003.
