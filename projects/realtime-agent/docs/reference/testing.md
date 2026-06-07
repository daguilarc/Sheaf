# Testing Reference

## Project Make targets

From the repository root:

```bash
make -C projects/realtime-agent test
make -C projects/realtime-agent build
```

Repository-root forwarding targets:

```bash
make realtime-agent
make realtime-agent-build
make realtime-agent-test
make realtime-agent-clean
make realtime-agent-run-cli CONTEXT_FILE=/path/to/context.md
```

From `projects/realtime-agent/`:

```bash
make test
make build
```

Project targets:

| Target | Command |
|---|---|
| `test` | `test-agent` then `test-vscode-extension` |
| `test-agent` | `npm run test:agent` |
| `test-vscode-extension` | `npm run test:vscode-extension` |
| `build` | `build-agent` then `build-vscode-extension` |
| `build-agent` | `npm run build:agent` |
| `build-vscode-extension` | `npm run build:vscode-extension` |
| `install` | `npm install` |
| `run-cli` | Runs the built CLI with `CONTEXT_FILE` |
| `clean` | `npm run clean` |

## npm workspace scripts

From `projects/realtime-agent/`:

```bash
npm run build:agent
npm run build:vscode-extension
npm run test:agent
npm run test:vscode-extension
npm test
```

Agent tests build TypeScript then run Node's built-in test runner against compiled
`dist/test` output via `scripts/run-agent-tests.mjs`.

Extension tests compile into `.test-dist` and run via
`scripts/run-vscode-extension-tests.mjs`. They cover deterministic extension-host
logic without launching a full VS Code UI process.

## Automated test coverage

### Agent (`realtime-agent-lib`)

- Session configuration and turn modes
- Event classification and routing
- Stdout filtering (`input_audio_buffer.append` omission)
- Tool registry, duplicate-name validation, dispatch, and follow-up responses
- Response queue policies
- SQLite migrations, schema, session rows, event rows, and audio-append filtering
- WebSocket URL/header construction, transport errors, fake socket integration
- CLI argument parsing, config/API key loading, unknown tools, signal shutdown,
  dependency-injected runtime startup

### VS Code extension (`sheaf-vscode-extension`)

- Session controller lifecycle and command wiring
- API key resolution order (Secret Storage → repo config → setting)
- Repository root detection and runtime log path resolution
- Chat model summaries for transcript, tool, and context bubbles
- Tool dispatcher wiring
- Read/navigation tool contracts and path policy
- `modifyFile` validation, edit success/failure, and freshness suppression
- Freshness coordinator behavior for file, viewport, cursor, tab switch, and
  agent-caused mutations

## Minimum checks before merging

- `make -C projects/realtime-agent test` for any realtime-agent change.
- Both agent and extension test suites when shared documentation or workflow
  changes affect both packages.

## Manual smoke checks

### CLI

- `realtime-agent --list-input-devices`
- Live session with `config/api_keys.json`, prompt file, context file, and
  selected microphone
- Confirm stdout omits `input_audio_buffer.append` while showing session,
  transcription, text output, tool, and error events
- Confirm SQLite under `data/realtime-agent/` contains session metadata and
  expected events after a live run

### VS Code extension

In an Extension Development Host:

1. Build the project (`make -C projects/realtime-agent build`)
2. Open `projects/realtime-agent/src/vscode-extension` and press `F5`
3. Verify idle status bar state (`Sheaf`)
4. Press `F16` to start listening
5. Speak, then press `F20` to commit audio and request a response
6. Verify chat bubbles for transcript, assistant output, and tool/context activity
7. Verify a simple `modifyFile` edit changes the buffer and remains undoable
8. Edit an observed file manually and verify a freshness context bubble appears
9. Press `F16` to stop and confirm return to idle

macOS requires microphone permission for the VS Code app used for development.
