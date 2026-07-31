# xagent Plugin

`plugins/xagent` owns the packaged `xagent-subagents` skill, launcher, and
runtime, and it distributes them to **every harness** — Claude Code, Codex,
Cursor, and Pi. Do not install `xagent-subagents` through the shared agents
skill installer.

## Ownership

```text
Shared skills: projects/agents/global/skills -> agents-install-global
smoke-test: projects/agents/sheaf/skills/smoke-test -> agents-install-repo
xagent-subagents + launcher + runtime: plugins/xagent -> xagent-plugin-install-global
```

`projects/agents/scripts/install.py` never renders `xagent-subagents`. It still
prunes stale copies it wrote in the past, but a file carrying this plugin's
marker (`sheaf-xagent-managed: DO NOT EDIT`) is reported as `plugin-owned` and
left alone.

## What lands where

| Harness | Skill | MCP tools (`xagent_*`) |
|---|---|---|
| Codex | inside the installed plugin package | plugin `.mcp.json` |
| Claude Code | `~/.claude/skills/xagent-subagents/SKILL.md` | `~/.claude.json` → `mcpServers.xagent` |
| Cursor | `~/.cursor/skills/xagent-subagents/SKILL.md` | `~/.cursor/mcp.json` → `mcpServers.xagent` |
| Pi | `~/.pi/skills/xagent-subagents/SKILL.md` | **none — see below** |

Only the `xagent` key of each MCP registry is written; every other server the
user configured survives. An existing skill file without the plugin marker is
never overwritten — the installer fails and tells you to move it aside.

### Pi has no MCP

Pi ships without built-in MCP on purpose ("It intentionally does not include
built-in MCP, sub-agents, permission popups…" — pi `docs/usage.md`). There is
no registry to write, so a Pi controller reaches xagent through the packaged
CLI only, and cannot drive Superpowers SDD (the SDD facade is MCP-only). The
skill says so; this is a harness constraint, not a missing install step.

## Installing

```shell
make xagent-plugin-install-global
```

After installation, open a new conversation in each harness so it reloads the
skill and MCP metadata. To confirm, ask the harness to list its tools and look
for `xagent_start_non_sdd`; on Codex you can also check `codex plugin list` reports
xagent installed and enabled at `$HOME/.agents/plugins/plugins/xagent`.

For recovery, rerun `make xagent-plugin-install-global`. If the installed
package is unmarked, inspect it and move it aside manually rather than forcing
overwrite.

## One-time SDD ledger reprovision (schema v2)

The SDD ledger was redesigned as an insert-only per-agent dispatch index at
schema version 2. There is no migration: v1 rows were already inconsistent and
their forensic content survives in the run directories they point at.

Once, before starting a service build that includes the v2 ledger:

1. Stop the xagent service.
2. Delete `<log_root>/sdd.sqlite`, `<log_root>/sdd.sqlite-wal`, and
   `<log_root>/sdd.sqlite-shm`.
3. Start the service. It provisions schema v2 on first open.

A service that finds a ledger whose `user_version` is not 2 refuses to start the
SDD manager and names the files to delete, stating that v1 data is not migrated.

**Run directories are the system of record.** Reports and submitted prompts for
SDD agents live only in `<log_root>/<run_id>/normalized.jsonl`. Any cleanup,
retention, or garbage-collection tooling must treat a run directory whose
`run_id` appears in `sdd_agents.agent_id` as evidence, not cache.
