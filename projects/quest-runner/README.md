# Quest Runner

Sheaf project for the migrated Quest Runner service.

Quest Runner creates and executes quests under `projects/<project>/quests/`, runs
role harnesses through a recursive state machine, and serves a web dashboard for
monitoring and control. Service orchestration, SQLite, and MCP remain in
`projects/conductor/`.

## Quick start

```bash
make -C projects/quest-runner test
make -C projects/quest-runner run
```

From the repository root:

```bash
make quest-runner-test
make quest-runner-run
```

The service listens on port `9002`. Open the dashboard at
`http://localhost:9002/dashboard`.

## Documentation

See [docs/README.md](docs/README.md) for the full documentation index.
