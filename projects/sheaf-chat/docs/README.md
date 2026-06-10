# Sheaf Chat — Living Spec

Sheaf Chat is the Sheaf service for browser-based conversations with Pi
coding agents. It organizes chat sessions into **piles**, runs each session's
Pi agent with repository-local auth/model state and a scoped filesystem tool
set, persists a replayable envelope history per session, and serves a browser
UI over REST discovery endpoints plus one bidirectional WebSocket route that
carries AGUI events.

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
| [service](capabilities/service.md) | `svc` | Process boot, configuration keys, health endpoints, static/vendor asset serving, REST dispatch and error envelope |
| [piles-sessions](capabilities/piles-sessions.md) | `ps` | Pile and session REST API: list/create piles, create blank session shells, read manifests |
| [session-history](capabilities/session-history.md) | `hist` | The per-session envelope log: sequence allocation, paging semantics, the REST history endpoint |
| [chat-protocol](capabilities/chat-protocol.md) | `chat` | The `/ws/chat` WebSocket: connect/replay handshake, client and server frame kinds, broadcast and persistence behavior |
| [agent-runtime](capabilities/agent-runtime.md) | `ar` | Agent lifecycle states, attach/detach, idle offload, message delivery and steering, cancellation, deferred manifest creation |
| [models](capabilities/models.md) | `mdl` | Provider/model registry, the local OpenAI-compatible provider, availability rules, `/api/models`, service-local Pi auth storage |
| [agui-mapping](capabilities/agui-mapping.md) | `agui` | Pi event → AGUI event mapping, Sheaf activity mapping, sanitization, snapshot reduction |
| [scoped-tools](capabilities/scoped-tools.md) | `st` | The Pi extension exposing eight root-scoped filesystem tools and the path policy behind them |
| [chat-ui](capabilities/chat-ui.md) | `ui` | The hash-routed browser UI: piles/sessions/chat screens, reconnect, acks, lazy history, and the file workspace host |
| [file-browser](capabilities/file-browser.md) | `fb` | Session-root read-only file REST API, `file.changed` broadcasts, Markdown/KaTeX previews, file tabs and mobile/desktop workspace panels |

## Shared Contracts

- [Session files](contracts/session-files.md) — the `data/sheaf-chat/`
  layout, pile/session-id validation patterns, the chat envelope schema, and
  every persisted per-session file format (Pi session file, envelope history
  log, provisional record, manifest).
- AGUI event shapes are canonical in
  [`structure/schemas/ag_ui_events.schema.json`](../../../structure/schemas/ag_ui_events.schema.json)
  and are not restated here.

## Related Repository Rules

Sheaf Chat follows the repository-level
[configuration](../../../structure/configuration.md),
[services](../../../structure/services.md),
[testing](../../../structure/testing.md), and
[logs-and-data](../../../structure/logs-and-data.md) rules.
