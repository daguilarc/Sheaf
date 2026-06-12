# Operations

Normative procedures to get from a fresh checkout to a built, tested,
running project. Repo-wide conventions: [Makefiles](../../../structure/makefile.md),
[Testing](../../../structure/testing.md),
[Configuration](../../../structure/configuration.md),
[Logs And Data](../../../structure/logs-and-data.md).

## Prerequisites

- Node.js 20 or newer (`engines: ">=20"`) and npm.
- macOS CLI microphone capture with no `--input-device` uses the sox `rec`
  binary (`brew install sox`); all other capture paths use the bundled
  PortAudio module. See [audio-capture](../../../openspec/specs/realtime-agent-audio-capture/spec.md).
- For extension development: VS Code 1.85+; Xcode command-line tools on
  macOS when rebuilding native modules.
- An OpenAI API key in `config/api_keys.json` at the repository root
  (git-ignored):

```json
{
  "openai_api_key": "sk-..."
}
```

## Install

From the repository root:

```bash
make -C projects/realtime-agent install     # npm install for the workspace + both packages
```

## Build

```bash
make -C projects/realtime-agent build       # build-agent then build-vscode-extension
make realtime-agent-build                   # repo-root forwarding target, same thing
```

Single package:

```bash
make -C projects/realtime-agent build-agent              # npm run build:agent  (tsc → src/agent/dist/)
make -C projects/realtime-agent build-vscode-extension   # npm run build:vscode-extension (esbuild → src/vscode-extension/out/)
```

Equivalent npm scripts run from `projects/realtime-agent/`:
`npm run build`, `npm run build:agent`, `npm run build:vscode-extension`.
Extension watch mode: `npm run dev --workspace sheaf-vscode-extension`.
Extension type-check only: `npm run lint --workspace sheaf-vscode-extension`.

## Test

```bash
make -C projects/realtime-agent test        # test-agent then test-vscode-extension
make realtime-agent-test                    # repo-root forwarding target
```

Single lane:

```bash
make -C projects/realtime-agent test-agent             # npm run test:agent
make -C projects/realtime-agent test-vscode-extension  # npm run test:vscode-extension
```

What the lanes do:

- **test-agent** — `tsc -p src/agent/tsconfig.json` (compiles `src/` and
  `tests/agent/` into `src/agent/dist/`), then
  `src/agent/scripts/run-agent-tests.mjs` runs `node --test` over every
  `*.test.js` under `src/agent/dist/tests/agent/`. Fails if no compiled test
  files are found.
- **test-vscode-extension** — removes `.test-dist`, compiles
  `tsconfig.test.json` (extension `src/` + `tests/vscode-extension/`) into
  `src/vscode-extension/.test-dist/`, then
  `scripts/run-vscode-extension-tests.mjs` runs `node --test` over
  `.test-dist/tests/vscode-extension/**/*.test.js`. No VS Code UI process is
  launched; tests use the fakes in `tests/vscode-extension/helpers/`.

Minimum check before merging any realtime-agent change:
`make -C projects/realtime-agent test`.

## Clean

```bash
make -C projects/realtime-agent clean       # removes dist, out, .test-dist, *.vsix, node_modules
make realtime-agent-clean
```

## Run The CLI

Build the agent package first. The built entry point is
`projects/realtime-agent/src/agent/dist/src/agent/src/cli.js`.

```bash
# Via Make (CONTEXT_FILE is required; the target errors without it):
make -C projects/realtime-agent run-cli CONTEXT_FILE=/path/to/context.md
make realtime-agent-run-cli CONTEXT_FILE=/path/to/context.md

# Direct invocation with all options:
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js \
  --context-file /path/to/context.md \
  --prompt-file projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md \
  --model gpt-realtime-2 \
  --tool echo \
  --input-device 2 \
  --safety-identifier my-user-id

# List microphone devices (needs no config or API key):
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js --list-input-devices
```

Runtime output: JSON event lines on stdout, SQLite at
`data/realtime-agent/realtime-agent.sqlite`, JSONL log at
`logs/realtime-agent/realtime-agent.jsonl`. Stop with `Ctrl+C` (exit 0).
Full flag and exit-code contract: [cli](../../../openspec/specs/realtime-agent-cli/spec.md).

## Launch The VS Code Extension

1. Build the project: `make -C projects/realtime-agent build`.
2. Provide an OpenAI API key via one of (resolution order in
   [vscode-extension](../../../openspec/specs/realtime-agent-vscode-extension/spec.md)):
   - VS Code Secret Storage under key `sheaf.realtime.openAiApiKey`,
   - `config/api_keys.json` when the workspace is a Sheaf repository
     checkout,
   - the `sheaf.realtime.openAiApiKey` workspace setting.
3. On macOS, grant microphone permission to the VS Code app used for
   development.
4. Open `projects/realtime-agent/src/vscode-extension` in VS Code and press
   `F5` to launch an Extension Development Host. The extension activates on
   its two commands or when the `Realtime Chat` view opens.
5. Start a session: press `F16`, click the `Sheaf` status bar item, or run
   **Sheaf: Toggle Realtime Session**. Active state shows `Sheaf Listening`.
6. Commit audio and request a response: press `F20`, use the chat pane's
   **Commit / respond** button, or run **Sheaf: Commit Audio And Request
   Response**.
7. Stop: press `F16` again.

Troubleshooting:

- **Missing API key** — the extension shows
  `Sheaf realtime: set an OpenAI API key (VS Code Secret Storage, config/api_keys.json, or sheaf.realtime.openAiApiKey setting).`
  Provide a key per step 2.
- **Native module load errors** (`MODULE_NOT_FOUND`, ABI mismatch) — rebuild
  per the next section.
- **Connection lost** — the extension resets to idle and does not resume
  dropped sessions; start a new session.

## Rebuild Native Modules

`better-sqlite3` (SQLite) and `naudiodon` (PortAudio) compile against the
ABI of the runtime that loads them. Rebuild or reinstall them when changing
Node versions, updating VS Code, or on load errors such as
`MODULE_NOT_FOUND` or ABI-mismatch messages.

### Agent package (CLI and library, system Node)

From `projects/realtime-agent/src/agent/`:

```bash
npm rebuild better-sqlite3 naudiodon
```

Or reinstall and rebuild:

```bash
cd projects/realtime-agent
npm install
npm run build:agent
```

The CLI runs under system Node 20+; native modules must match that Node ABI.

### VS Code extension package (Electron ABI)

The extension host runs on VS Code's Electron Node ABI, which differs from
system Node. From `projects/realtime-agent/src/vscode-extension/`:

```bash
npm rebuild better-sqlite3 naudiodon --build-from-source
```

If the rebuild still fails after a VS Code upgrade, remove and reinstall
extension dependencies:

```bash
cd projects/realtime-agent/src/vscode-extension
rm -rf node_modules
npm install
npm run build
```

Consult the `better-sqlite3` and `naudiodon` package docs for
Electron-specific rebuild flags if your environment requires
`electron-rebuild`.

### Verify after rebuilding

```bash
make -C projects/realtime-agent test
```

For the extension, launch the Extension Development Host (`F5`) and start a
session with `F16` to confirm microphone capture and database open succeed.

## Manual Smoke Checks

CLI:

- `--list-input-devices` prints one line per input device.
- A live run (API key, prompt, context, selected microphone) streams JSON
  event lines that omit `input_audio_buffer.append` while showing session,
  transcription, text-output, tool, and error events.
- After the run, `data/realtime-agent/realtime-agent.sqlite` contains the
  session row and expected events.

Extension (in an Extension Development Host):

1. Verify the idle status bar item (`Sheaf`).
2. `F16` to start; verify `Sheaf Listening` and the chat header session id.
3. Speak, then `F20`; verify transcript and assistant bubbles.
4. Verify a simple `modifyFile` edit changes the buffer and remains
   undoable.
5. Edit an observed file manually; verify a freshness context bubble.
6. `F16` to stop; verify return to idle.
