# Sheaf Chat Documentation

Sheaf Chat is the Sheaf service for browser-based conversations with Pi agents. It provides pile-organized chat sessions, repository-local Pi agent configuration, scoped filesystem tools, provider/model discovery, persistent history, and a bidirectional WebSocket protocol that carries AGUI events.

The service is registered as `sheaf-chat` in `config/services.json` and normally runs on port `9004`.

## Start Here

- [Run And Use Sheaf Chat](how-to/run-and-use.md): build, test, start, and use the browser workflow.
- [Architecture](explanation/architecture.md): how the server, Pi runtime, storage, protocol, and UI fit together.
- [API Reference](reference/api.md): REST endpoints, WebSocket URL, envelopes, frame kinds, and error shapes.
- [Configuration And Data](reference/config-and-data.md): service config, secrets, data paths, manifests, and session logs.
- [Scoped Tools](reference/scoped-tools.md): root-scoped Pi tools and path security rules.

## Implementation Map

| Area | Primary Code |
|------|--------------|
| Server entry and routing | `../src/server/main.ts`, `../src/server/server.ts`, `../src/server/router.ts` |
| REST handlers | `../src/server/routes/` |
| WebSocket protocol | `../src/server/websocket.ts`, `../src/protocol/` |
| Agent lifecycle | `../src/agents/manager.ts`, `../src/agents/sessionRuntime.ts`, `../src/agents/piAdapter.ts` |
| Provider and model setup | `../src/agents/auth.ts`, `../src/agents/models.ts`, `../src/agents/localProvider.ts` |
| Storage | `../src/storage/` |
| AGUI mapping | `../src/agui/` |
| Scoped Pi extension | `../src/extensions/sheaf-chat/` |
| Browser UI | `../src/ui/` |
| Shared AGUI renderer | `../../web/src/agui-chat.js`, `../../web/src/agui-chat.css` |

## Related Repository Rules

Sheaf Chat follows the repository-level layout, configuration, and data conventions documented under `../../../structure/`.

The AGUI event contract is `../../../structure/schemas/ag_ui_events.schema.json`.
