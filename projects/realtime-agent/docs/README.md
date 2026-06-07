# Realtime Agent Docs

This documentation area describes the current state of the `realtime-agent`
project.

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
