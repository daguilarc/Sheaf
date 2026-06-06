# Roadmap

## Current Foundation

The repository supports two tracks:

- Node TypeScript realtime-agent tooling for OpenAI Realtime experimentation.
- VS Code extension tooling for voice-driven editor workflows.

The realtime-agent foundation is usable as both a CLI and a library. It starts WebSocket Realtime sessions, streams microphone input, requests text output only, dispatches model tool calls, prints non-audio events, and persists durable session/event records.

The VS Code extension foundation embeds the realtime-agent library in the extension host. It runs manual-turn voice sessions, exposes a focused chat pane, registers the `sheaf VS Code` read/navigation/write tool set, and sends structured freshness context when previously observed editor state becomes stale.

## Realtime Agent: Current Capabilities

- Library entry point: `apps/realtime-agent/src/index.ts`, published as `realtime-agent-lib`.
- CLI entry point: `apps/realtime-agent/src/cli.ts`, published as `realtime-agent`.
- Session model: prompt file, initial context file, model, tool call set, session config, lifecycle callbacks.
- Transport: WebSocket connection to the OpenAI Realtime API with bearer auth and optional `OpenAI-Safety-Identifier`.
- Audio input: local microphone device listing, device selection by id or name substring, 24 kHz mono PCM frame forwarding.
- Realtime config: text-only output, transcription, server VAD, 500 ms silence threshold, automatic response creation.
- Event handling: typed classification for known event families and generic handling for unknown Realtime event types.
- Persistence: SQLite sessions and events with idempotent migrations.
- Tooling: duplicate-name validation, serial FIFO callback execution, function-call output events, structured error payloads.
- Operator visibility: stdout JSON-lines output for non-audio events.
- Test support: fake microphone capture, fake WebSocket transport, dependency injection for CLI/session tests.

## VS Code Extension: Current Capabilities

- Extension entry point: `apps/vscode-extension/src/extension.ts`.
- Session controller: starts and stops manual-turn OpenAI Realtime sessions on top of `realtime-agent-lib`.
- User controls: Activity Bar `Sheaf` container, `Realtime Chat` webview, status bar session item, `F16` session toggle, and `F20` audio commit/respond.
- Configuration: OpenAI API key resolution, model override, system prompt override, input device selector, and optional safety identifier.
- Tool call set: `sheaf VS Code` with `code_read`, `list_files`, `rgrep`, `read_visible_range`, `set_cursor_position`, `move_visible_range`, and `modifyFile`.
- Read/search/navigation behavior: workspace-scoped VS Code APIs and editor buffers, with normalized workspace-relative POSIX paths.
- Write behavior: `modifyFile` validates the current buffer range, exact target text, and up to three surrounding lines before applying a VS Code buffer edit.
- Freshness behavior: file, viewport, and cursor changes are pushed as structured context after non-agent mutations; agent-originated navigation and writes are suppressed.
- Test support: memory editor access, fake VS Code event hosts, deterministic session-controller tests, tool contract tests, and freshness service tests.

## Realtime Agent: Next Product Work

- Add a named tool-call-set registry so operators can choose reusable tool bundles by stable names.
- Add replay and inspection commands for persisted SQLite sessions.
- Add explicit retention controls for realtime session/event data.
- Add richer built-in tools beyond the current `echo` example.
- Add optional CLI manual turn controls for commit/clear flows when server VAD is not desired.
- Clarify packaging behavior for the default SQLite path in installed versus local builds.
- Add manual smoke guidance for live Realtime API sessions and microphone device behavior.

## VS Code Extension: Next Product Work

- Package and install the extension with native module handling documented for supported platforms.
- Expand live smoke guidance for the Activity Bar chat, microphone capture, manual commit flow, and `modifyFile` edits.
- Add richer operator inspection for the extension-scoped realtime SQLite database.
- Continue hardening tool summaries and context bubbles so the chat pane stays useful without exposing raw protocol events.
- Evaluate additional editor tools only when they preserve the VS Code-buffer-first contract.

## Engineering Constraints

- Keep behavior documented in present tense and tied to code in the repository.
- Preserve clear boundaries between the realtime-agent library and the VS Code extension host integration.
- Preserve clear boundaries between VS Code buffer tools and direct filesystem/shell mutation paths.
- Prefer focused vertical changes with corresponding tests.
- Do not persist or print raw outgoing realtime audio append payloads.
- Treat unexpected realtime socket close as terminal for the current session.
