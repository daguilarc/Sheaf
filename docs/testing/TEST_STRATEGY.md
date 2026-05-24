# Test Strategy

## Objectives

- Preserve Sheaf server ledger, queue, websocket, model, vault, and tool behavior.
- Preserve realtime-agent public TypeScript contracts and session orchestration behavior.
- Preserve VS Code extension session controls, read/navigation/write tool contracts, chat reduction behavior, and context freshness notifications.
- Validate persistence, event routing, tool dispatch, and transport error handling.
- Keep live-device behavior covered by manual smoke checks where automation cannot reliably exercise local permissions or hardware.

## Automated Test Layers

- Python unit tests: server runtime, migrations, queue behavior, model/tool dispatch, vault state, and API behavior.
- Obsidian replica TypeScript tests: chat API, service behavior, rendering, transport, replay, and sync behavior.
- Realtime TypeScript unit tests: session config, event classification, stdout filtering, tool registry/dispatch, and audio frame processing.
- Realtime persistence tests: SQLite migration idempotency, expected schema, session rows, event rows, indexes, and audio append persistence filtering.
- Realtime transport tests: WebSocket URL/header construction, JSON send/receive, invalid message handling, close handling, and fake socket integration.
- Realtime CLI tests: argument parsing, required prompt/context files, required `OPENAI_API_KEY`, unknown tool handling, signal-style shutdown, and dependency-injected runtime startup.
- VS Code extension TypeScript unit tests: session controller lifecycle, command wiring, chat model summaries, tool dispatcher wiring, read/navigation tool contracts, `modifyFile` validation/edit contracts, and freshness service behavior.

## Commands

From the repository root:

```bash
make test-server
make test-realtime-agent
```

From the realtime-agent package:

```bash
cd apps/realtime-agent
npm install
npm test
```

`npm test` builds the TypeScript package before running Node's built-in test runner against the compiled `dist/test` files.

From the VS Code extension package:

```bash
cd apps/vscode-extension
npm install
npm test
```

The extension test command compiles tests into `.test-dist` and runs them with Node's built-in test runner. Coverage is focused on deterministic extension-host logic; it does not launch a full VS Code UI process.

`modifyFile` coverage verifies the registered `sheaf VS Code` tool set name, stable legacy read/navigation tool names, single-line and multi-line replacements, zero-length insertion, exact target/context mismatch failures, compact mismatch details, no partial edit on failure, file/position validation, and suppression of self-generated freshness notifications.

## Minimum Checks Before Merging

- `PYTHONPATH=src .venv/bin/python -m pytest -q` for Sheaf server changes.
- `npm test` in `apps/realtime-agent` for realtime-agent changes.
- `npm test` in `apps/vscode-extension` for VS Code extension changes.
- Obsidian replica tests for plugin/client changes.
- Relevant combinations for shared documentation or repository-level workflow changes.

## Manual Checks

- Realtime CLI microphone device listing with `realtime-agent --list-input-devices`.
- Live realtime session startup with a real `OPENAI_API_KEY`, prompt file, context file, and selected microphone.
- Confirmation that stdout omits `input_audio_buffer.append` while still showing session, transcription, text output, tool, and error events.
- Confirmation that SQLite contains session metadata, incoming events, and outgoing non-audio events after a live run.
- VS Code extension smoke run in an Extension Development Host:
  - build `apps/realtime-agent` and `apps/vscode-extension`
  - start the extension with `F5`
  - verify idle status bar state
  - press `F16` to start listening
  - speak, then press `F20` to commit audio and request a response
  - verify chat pane bubbles for transcript, assistant output, and tool/context activity
  - verify a simple `modifyFile` edit changes the active VS Code buffer through the editor and remains undoable in VS Code
  - edit an observed file manually and verify the agent receives a freshness context bubble before it writes again
  - press `F16` again to stop and confirm return to idle
