# Quest Runner

Sheaf project for the migrated quest runner service.

This project hosts quest creation, execution, role harnesses, recursive state
machines, dashboard data, and the web dashboard UI. Service orchestration,
SQLite, and MCP remain in other projects.

See `docs/` for project documentation (expanded in later migration slices).

## Quick start

```bash
make -C projects/quest-runner test
make -C projects/quest-runner run
```

The service listens on port `9002` by default.
