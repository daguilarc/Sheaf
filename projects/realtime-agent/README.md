# Realtime Agent

Realtime Agent is a Sheaf project that contains:

- **realtime-agent-lib** — Node 20 TypeScript library and `realtime-agent` CLI for OpenAI Realtime sessions.
- **sheaf-vscode-extension** — Sheaf VS Code extension for voice-driven editor workflows on top of the library.

The CLI and extension are not registered as long-running Sheaf services in `config/services.json`.

## Quick commands

From the project directory:

```bash
make -C projects/realtime-agent install
make -C projects/realtime-agent build
make -C projects/realtime-agent test
```

Or from `projects/realtime-agent/`:

```bash
make install
make build
make test
```

## Documentation

See [docs/README.md](docs/README.md) for reference, how-to, and explanation docs.
