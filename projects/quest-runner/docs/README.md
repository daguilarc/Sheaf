# Quest Runner Documentation

Human-facing documentation for the Quest Runner service.

Quest Runner is a Sheaf project service that creates, runs, and monitors
filesystem-backed quests under `projects/<project>/quests/`. It exposes a Flask
REST service on port `9002`, serves a project-aware dashboard at `/dashboard`,
creates deterministic git worktrees for new quests, and executes quests through
the recursive quest state machine.

Quest Runner is separate from `projects/conductor/`. It does not manage other
services, expose MCP routes, stream service logs, use SQLite, or maintain a
database-backed quest index.

Runtime quest schema and role prompt reference content is bundled under
`src/quest_runner_service/quest_docs/` for harness prompt injection. That package
directory is not part of this docs tree; see
[src/quest_runner_service/quest_docs/README.md](../src/quest_runner_service/quest_docs/README.md).

## Reference

Exact APIs, layout, configuration, and test commands:

- [REST API](reference/api.md)
- [Dashboard](reference/dashboard.md)
- [Quest directory layout](reference/layout.md)
- [Runtime files](reference/runtime-files.md)
- [Configuration](reference/config.md)
- [Testing](reference/testing.md)

## How-to

- [Run the service](how-to/run-service.md)

## Explanation

- [Architecture](explanation/architecture.md)
- [Quest lifecycle](explanation/lifecycle.md)

## Related repository docs

Repository-wide rules live under `structure/` at the repo root:

- [Services](../../../structure/services.md)
- [Configuration](../../../structure/configuration.md)
- [Logs and data](../../../structure/logs-and-data.md)
- [Docs structure](../../../structure/docs-structure.md)
