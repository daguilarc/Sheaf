# step 1 — physical_planner

**thread:** Sheaf_quest_0001_physical_planner

## output

This file is a quest specification for a VS Code plugin that drives realtime-agent sessions via voice. It is not malware - it is a design document. Continuing with quest planning.Spec 02 is not malware - it is a tool catalog design for the VS Code extension. Continuing.Spec 03 is a UI/UX design document for the VS Code extension - not malware. Now let me explore the codebase to understand existing patterns.Not malware - this is the realtime agent session implementation. Continuing.Not malware - this is a TypeScript interface/types module. Let me explore more key files.Not malware - a configuration builder. Let me look at the rest of the relevant agent code.Not malware - module exports. Let me look at the existing event router and tooling to understand persistence patterns.Not malware. Let me look at the remaining important files quickly.Not malware - microphone capture utility. Let me look at the persistence/events_repo briefly, and check obsidian-replica for chat UI patterns.Not malware - SQLite event repository. Let me explore the cli and tooling briefly, then check for any existing VS Code plugin.Not malware. Let me look at the cli and tool_sets briefly, then existing test patterns and obsidian-replica layout.Not malware - CLI entry point. Let me check tool_sets and the existing physical plan issues file before designing slices.Empty issues file. Let me look at the test directory pattern and obsidian-replica to understand similar app structure.Test file - not malware. Let me also check the obsidian-replica chat for similar UI patterns and any existing webview/chat manager I should look at.Not malware - chat view component. I have enough context now to plan the slices. Let me also look at the realtime client briefly.Not malware - WebSocket transport. I now have enough context to design the slices. Let me design them:

**Slice plan:**

1. **0001_session_api_and_turn_mode**: Realtime-agent library changes for manual turn mode + Session API (`commitAudio`, `createResponse`, `commitAudioAndCreateResponse`, `sendTextMessage`, `sendStructuredContext`, `sendRealtimeEvent`, `clearAudioBuffer`). Includes session_config update + types.
2. **0002_response_queue**: Response queue with policies (enqueue/reject/cancel_current), tracking response active state via server events.
3. **0003_vscode_extension_scaffold**: New `apps/vscode-extension` package, build pipeline, extension manifest, activation, basic commands and keybindings (F15/F19), microphone capture in extension host, manual-mode session startup.
4. **0004_navigation_and_reading_tools**: Implement `code_read`, `list_files`, `rgrep`, `read_visible_range`, `set_cursor_position`, `move_visible_range` tools using VS Code API, register them in a tool set callable by the extension.
5. **0005_chat_pane**: Chat webview pane that subscribes to realtime-agent callbacks, renders user transcripts (with delta collapse), assistant text, tool call bubbles, context push bubbles, errors.
6. **0006_context_freshness**: File freshness, viewport freshness, cursor freshness tracking; send structured context notifications via `sendStructuredContext()`; agent-originated change marking; integration with new tools.

Let me write these slice docs. First, let me verify there are no existing apps/vscode-extension directories or related.Now I'll create all six slices.Let me verify all six slices have the required files.All six slices created with the required files. Summary of the physical plan:

1. **0001_session_api_and_turn_mode** — Adds `turnMode` (`server_vad` | `manual`), `RealtimeAgentSession` methods (`commitAudio`, `createResponse`, `commitAudioAndCreateResponse`, `sendTextMessage`, `sendStructuredContext`, `sendRealtimeEvent`, `clearAudioBuffer`), and supporting types in `apps/realtime-agent`.
2. **0002_response_queue** — `ResponseQueue` with `enqueue`/`reject`/`cancel_current` policies, response-active tracking via incoming server events, ordered pair operations.
3. **0003_vscode_extension_scaffold** — New `apps/vscode-extension` package, `SessionController` lifecycle, F15/F19 keybindings, mic capture reusing realtime-agent's audio module, status-bar toggle, config + secrets.
4. **0004_navigation_and_reading_tools** — Six tools (`code_read`, `list_files`, `rgrep`, `read_visible_range`, `set_cursor_position`, `move_visible_range`) implemented via a single `editorAccess` seam over the VS Code API, wired into the agent's tool set.
5. **0005_chat_pane** — `WebviewViewProvider`-backed chat pane, `ChatModel` aggregating user transcripts, assistant text, tool call summaries, context pushes, and errors; filters raw noise and collapses streaming deltas.
6. **0006_context_freshness** — `FreshnessService` tracking file/viewport/cursor staleness, pushing structured-context notifications via `sendStructuredContext`, with agent-mutation suppression hooks invoked by movement tools.

