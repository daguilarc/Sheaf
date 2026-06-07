# Testing

Quest Runner tests live under `projects/quest-runner/tests/`. Dashboard UI logic
modules include Node built-in tests under
`src/quest_runner_service/dashboard_assets/`.

## Full suite

From the project directory:

```bash
cd projects/quest-runner
make test
```

From the repository root:

```bash
make quest-runner-test
```

The project Makefile runs Python `unittest` against all registered test modules
and executes dashboard ES module tests through
`tests/test_dashboard_shell.py`.

## Focused Python commands

Run a single module:

```bash
cd projects/quest-runner
PYTHONPATH=src .venv/bin/python -m unittest tests.test_quest_creation
```

Useful modules for the project-local quest model:

| Module | Coverage |
| --- | --- |
| `tests.test_project_quest_model` | Discovery, legacy exclusion, metadata |
| `tests.test_quest_creation` | Creation, numbering, worktree bootstrap |
| `tests.test_worktrees` | Worktree naming and helpers |
| `tests.test_worktree_execution_path` | Run path, worktree resolution |
| `tests.test_quest_service_api` | REST routes, forbidden imports, absent orchestrator routes |
| `tests.test_dashboard_api` | Dashboard payloads, project identity |
| `tests.test_dashboard_shell` | HTML shell and JS unit tests |
| `tests.test_state_machine_core` | Recursive state machine behavior |
| `tests.test_commit_metadata` | Git step commit metadata |
| `tests.test_migration_validation` | Migration hardening checks |
| `tests.test_agui_mapper` | JSONL harness log replay into AGUI events |

## Focused JavaScript commands

```bash
node --test projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.test.mjs
node --test projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-pages-utils.test.mjs
```

## Temp git and worktree fixtures

Integration tests use temporary git repositories created by helpers in
`tests/test_helpers.py`:

- `TempRepo` initializes a clean git repo with an initial commit
- `ensure_project(root, name)` creates `projects/<name>/`
- `cleanup_worktrees(root)` removes `<parent>/.quest-worktrees/` after tests

Quest creation tests call `QuestService.create_quest` against temp repos. REST
tests build Flask test clients via `make_app_client(repo_root, source_repo_root)`.

Worktree execution tests verify that `run_quest` uses the worktree checkout as
the git and command boundary and refuses when the expected worktree is missing.

## AGUI Mapper Replay

`tests.test_agui_mapper` gathers current quest `logs/*.jsonl` files from the
top-level `quests/` tree and every `projects/*/quests/` tree. It feeds every
source event through `QuestLogToAguiMapper`, validates emitted AGUI events
against `structure/schemas/ag_ui_events.schema.json`, checks lifecycle balance
after `flush()`, and asserts that `mapper.errors()` is empty.

The empty-errors assertion is a harness compatibility guard. If a harness starts
emitting a new event shape and the mapper has to use its AGUI `RAW` fallback, the
test fails until the new source event is mapped explicitly.

## Static exclusion checks

Verify no orchestrator, database, or MCP behavior remains in product source:

```bash
rg "/Users/joyo/conductor|conductor.db|sqlite|mcp_server|ServiceManager|register_service|start_service|stop_service|restart_service|/mcp|/logs|/trace" projects/quest-runner/src
```

The only expected `/logs` match is quest-relative path globs in runner path
enforcement, not HTTP log-stream routes.

Verify dashboard public state does not use legacy repository selection:

```bash
rg "repo_path" projects/quest-runner/src/quest_runner_service/dashboard_assets projects/quest-runner/tests
```

Matches should be limited to internal checkout paths in tests and lock error
details, not dashboard URL or selection state.

## Manual smoke checks

Run the service and verify health:

```bash
make quest-runner-run
curl -s http://localhost:9002/health
```

Open the dashboard:

```text
http://localhost:9002/dashboard
```

Confirm the dashboard lists only project-local quests under
`projects/*/quests/`. Create or open a quest, verify its dashboard URL includes
`project`, `quest_type`, and `quest_number`, and run an idle quest through the
overview run control.

After a run, confirm service logs are under `logs/quest-runner/` and step logs
are under the selected quest directory.
