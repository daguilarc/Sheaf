# Sheaf Chat — Living Spec

Sheaf Chat is the Sheaf service for browser-based conversations with Pi
coding agents. It discovers Git repositories directly under the user's home
directory, lets the browser choose a repository worktree, and scopes every
chat to that workspace root. It persists replayable chat envelope history,
workspace chat metadata, and server-side editor tab/viewport state.

The service is registered as `sheaf-chat` (port `9004`) in
`config/services.json`; see [Services](../../../structure/services.md).

This directory is the project's living spec under the rules in
[Docs Structure](../../../structure/docs-structure.md): normative
requirements with stable IDs, held to the rebuild-test standard. Spec status
and known gaps are tracked in [coverage.md](coverage.md).

- [Architecture](architecture.md) — components, data flow, key decisions.
- [Operations](operations.md) — build, run, test from a fresh checkout.
- [Coverage](coverage.md) — rebuild-test audit and gap register.

## Capability Map

| Capability | Prefix | What it specifies |
|---|---|---|
| [service](../../../openspec/specs/sheaf-chat-service/spec.md) | `svc` | Process boot, configuration keys, health endpoints, static/vendor asset serving, REST dispatch and error envelope |
| [repo-workspaces](../../../openspec/specs/sheaf-chat-repo-workspaces/spec.md) | `rw` | Direct-home repository discovery, worktree discovery, workspace ids, metadata caching, and server-side workspace editor state |
| [workspace-chats](../../../openspec/specs/sheaf-chat-workspace-chats/spec.md) | `wc` | Workspace chat list, create, and read routes |
| [session-history](../../../openspec/specs/sheaf-chat-session-history/spec.md) | `hist` | The per-chat envelope log: sequence allocation, paging semantics, the REST history endpoint |
| [chat-protocol](../../../openspec/specs/sheaf-chat-chat-protocol/spec.md) | `chat` | The `/ws/chat` WebSocket: repo/workspace/chat connect parameters, replay handshake, client and server frame kinds, broadcast and persistence behavior |
| [agent-runtime](../../../openspec/specs/sheaf-chat-agent-runtime/spec.md) | `ar` | Agent lifecycle states, attach/detach, idle offload, message delivery and steering, cancellation, deferred manifest creation |
| [models](../../../openspec/specs/sheaf-chat-models/spec.md) | `mdl` | Provider/model registry, the local OpenAI-compatible provider, availability rules, `/api/models`, service-local Pi auth storage |
| [agui-mapping](../../../openspec/specs/sheaf-chat-agui-mapping/spec.md) | `agui` | Pi event → AGUI event mapping, Sheaf activity mapping, sanitization, snapshot reduction |
| [scoped-tools](../../../openspec/specs/sheaf-chat-scoped-tools/spec.md) | `st` | The Pi extension exposing eight root-scoped filesystem tools and the path policy behind them |
| [chat-ui](../../../openspec/specs/sheaf-chat-chat-ui/spec.md) | `ui` | The hash-routed browser UI: repository picker, workspace picker, workspace editor, reconnect, acks, lazy history, and server-backed file state |
| [file-browser](../../../openspec/specs/sheaf-chat-file-browser/spec.md) | `fb` | Workspace/chat-root read-only file REST API, `file.changed` broadcasts, Markdown/KaTeX previews, file tabs and mobile/desktop workspace panels |

## Shared Contracts

- [Chat files](contracts/session-files.md) — the `data/sheaf-chat/`
  repository/workspace/chat layout, identity validation, the chat envelope
  schema, and every persisted per-chat file format.
- AGUI event shapes are canonical in
  [`structure/schemas/ag_ui_events.schema.json`](../../../structure/schemas/ag_ui_events.schema.json)
  and are not restated here.

## Related Repository Rules

Sheaf Chat follows the repository-level
[configuration](../../../structure/configuration.md),
[services](../../../structure/services.md),
[testing](../../../structure/testing.md), and
[logs-and-data](../../../structure/logs-and-data.md) rules.
