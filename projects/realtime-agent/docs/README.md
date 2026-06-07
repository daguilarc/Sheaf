# Realtime Agent Documentation

Human-facing documentation for the realtime-agent project: the `realtime-agent-lib`
library, `realtime-agent` CLI, and Sheaf VS Code extension.

## Reference

Exact APIs, commands, configuration, data paths, logs, and test commands:

- [CLI](reference/cli.md)
- [Library API](reference/api.md)
- [VS Code extension](reference/vscode-extension.md)
- [Configuration](reference/config.md)
- [Data](reference/data.md)
- [Logs](reference/logs.md)
- [Testing](reference/testing.md)

## How-to

- [Build and test](how-to/build-and-test.md)
- [Run the CLI](how-to/run-cli.md)
- [Launch the VS Code extension](how-to/launch-vscode-extension.md)
- [Rebuild native modules](how-to/rebuild-native-modules.md)

## Explanation

- [Architecture](explanation/architecture.md)
- [Session lifecycle](explanation/session-lifecycle.md)
- [Turn model](explanation/turn-model.md)
- [Persistence](explanation/persistence.md)
- [Tool dispatch](explanation/tool-dispatch.md)
- [Freshness model](explanation/freshness.md)

## VS Code extension storage exception

The Sheaf VS Code extension keeps its session SQLite database under VS Code
extension global storage (`context.globalStorageUri`), not under repository
`data/realtime-agent/`.

Rationale:

- Session state is editor-host state scoped by extension identity.
- It survives workspace folder changes without writing into arbitrary user
  workspaces.
- Repository `data/realtime-agent/` remains reserved for CLI and other
  non-editor-host runtimes.

When the extension runs against a Sheaf repository workspace, configuration and
structured runtime logs still use repository paths (`config/` and
`logs/realtime-agent/`). Only the SQLite session database remains VS Code-owned.

## Related repository docs

Repository-wide rules live under `structure/` at the repo root:

- [Docs structure](../../../structure/docs-structure.md)
- [Configuration](../../../structure/configuration.md)
- [Logs and data](../../../structure/logs-and-data.md)
- [Makefiles](../../../structure/makefile.md)
