# Realtime Agent — Living Spec

Realtime Agent is a Node 20 project for voice-driven agents on the OpenAI
Realtime API. It ships three surfaces from one npm workspace: the
`realtime-agent-lib` library (WebSocket sessions, turn handling, tool
dispatch, SQLite persistence, microphone capture), the `realtime-agent` CLI
(unattended server-VAD microphone sessions with JSON-lines stdout), and the
`sheaf-vscode-extension` VS Code extension (manual-turn voice workflow with
editor tools, a chat pane, and staleness pushes).

This directory is the project's living spec under the rules in
[Docs Structure](../../../structure/docs-structure.md): normative
requirements with stable IDs, held to the rebuild-test standard. Spec status
and known gaps are tracked in [coverage.md](coverage.md).

- [Architecture](architecture.md) — surfaces, package layout, data flow, key
  design decisions.
- [Operations](operations.md) — build, run, test, and native-module rebuild
  procedures, from fresh checkout.
- [Coverage](coverage.md) — rebuild-test audit and gap register.

## Capability Map

| Capability | Prefix | What it specifies |
|---|---|---|
| [session-lifecycle](capabilities/session-lifecycle.md) | `ses` | `startAgentSession`: connection, startup event sequence, the `RealtimeAgentSession` send/stop API, event routing and classification, structured-context envelope, end reasons |
| [turn-model](capabilities/turn-model.md) | `turn` | Server-VAD vs manual turn modes, the `session.update` payload, the response queue (policies, atomic units, tool-output holds) |
| [tool-dispatch](capabilities/tool-dispatch.md) | `td` | Tool registry, function-call extraction and dedupe, FIFO dispatch, structured error payloads, lifecycle notifications, follow-up responses |
| [persistence](capabilities/persistence.md) | `db` | The SQLite database: schema, session rows, event rows, write policy |
| [audio-capture](capabilities/audio-capture.md) | `aud` | Microphone device listing/selection, PortAudio and sox capture paths, PCM frame format |
| [config](capabilities/config.md) | `cfg` | Repository-root discovery, `config/realtime-agent.json`, `config/api_keys.json`, the runtime JSONL logger and its redaction rules |
| [cli](capabilities/cli.md) | `cli` | The `realtime-agent` CLI: flags, defaults, stdout event lines, exit codes, signal shutdown |
| [vscode-extension](capabilities/vscode-extension.md) | `vsx` | Extension manifest surfaces, commands/keybindings, settings, API-key resolution, session controller states, chat pane, storage exception |
| [editor-tools](capabilities/editor-tools.md) | `et` | The `sheaf VS Code` tool set: seven editor tools, the workspace path policy, the tool error catalogue |
| [freshness](capabilities/freshness.md) | `fr` | Stale-editor-state tracking and structured context pushes, agent-mutation suppression |

## Shared Contracts

No `contracts/` directory exists: every schema in this project has a single
owning capability, and other capabilities link to it. The candidates and
their canonical homes:

- SQLite schema — [persistence](capabilities/persistence.md).
- Runtime JSONL log-entry format — [config](capabilities/config.md).
- Structured-context envelope — [session-lifecycle](capabilities/session-lifecycle.md)
  (kinds produced by [freshness](capabilities/freshness.md)).
- Tool error payloads — [tool-dispatch](capabilities/tool-dispatch.md)
  (dispatcher-level) and [editor-tools](capabilities/editor-tools.md)
  (tool-level `ToolError`).

## Repository Rules

Configuration, data, log, Makefile, and testing conventions are repo-wide;
see [Configuration](../../../structure/configuration.md),
[Logs And Data](../../../structure/logs-and-data.md),
[Makefiles](../../../structure/makefile.md), and
[Testing](../../../structure/testing.md).
