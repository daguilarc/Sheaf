# Migrate Quest Runner

## Quest Overview

Migrate the quest runner from the external Conductor repository into Sheaf as a
new project at `projects/quest-runner/`.

The external Conductor repository currently contains two major systems:

- the Conductor service orchestrator, including service registration, lifecycle
  control, log tracking, and database-backed service state
- the quest runner, including quest creation, quest execution, role harnesses,
  recursive state machines, quest dashboard data, and the web dashboard UI

This quest migrates only the quest runner. It must not migrate the service
orchestrator, service log tracking, SQLite database usage, service registration
database behavior, or MCP server.

The migrated Quest Runner will be a Sheaf project service running on port `9002`.
It should preserve the current quest-runner behavior where appropriate, while
changing quest discovery and quest storage to match Sheaf's project directory
layout.

The current top-level `quests/` directory contains legacy quest records, including
this running quest. Those quests are not migrated in this quest and must not be
shown by the new Quest Runner UI.

## Required Initial Planning Work

The first physical-planning step must inspect `/Users/joyo/conductor` and produce
an inventory of files that belong to the quest runner versus files that belong to
the service orchestrator. The planner should use that inventory to divide the
migration into reviewable slices.

Likely quest-runner source areas include, but are not limited to:

- `conductor/quest_service.py`
- `conductor/quest_runner.py`
- `conductor/quest_runner_v2.py`
- `conductor/quest_fs.py`
- `conductor/quest_types.py`
- `conductor/quest_thread.py`
- `conductor/harness.py`
- `conductor/quest_lock.py`
- `conductor/deferred_tasks.py`, if still needed without database behavior
- `conductor/dashboard_data.py`
- `conductor/dashboard_git.py`
- `conductor/dashboard_runs.py`
- `conductor/dashboard_slice.py`
- `conductor/dashboard_assets/`
- `conductor/state_machine/`
- `docs/quest-harness.md`
- `docs/dashboard.md`
- `docs/quest/`
- quest-runner tests under `tests/`

Likely non-migration areas include, but are not limited to:

- `conductor/service_manager.py`
- `conductor/db.py`
- service lifecycle, service registry, service log tracking, and restart recovery
  code in `conductor/api.py` or `conductor/__main__.py`
- `conductor/mcp_server.py`
- service-manager tests such as `tests/test_service_manager_lifetime.py`
- Conductor SQLite database setup, schemas, and runtime database files

The planner must verify these lists from source rather than assuming they are
complete.

## Goals

- Create `projects/quest-runner/` following the required project layout in
  `structure/repo-layout.md` and `structure/project-rules.md`.
- Migrate quest-runner source, tests, docs, and dashboard UI into
  `projects/quest-runner/`.
- Expose the Quest Runner as a long-running REST service on port `9002`.
- Preserve the quest lifecycle, role routing, harness execution, recursive state
  machine, state files, per-step commits, and dashboard behavior that belong to
  the existing quest runner.
- Change quest storage from top-level `quests/` to project-local quest
  directories under `projects/<project>/quests/`.
- Change quest discovery so the runner scans `projects/*/quests/` and ignores
  the legacy top-level `quests/` directory.
- Change quest creation so a new quest is created under the selected project,
  for example `projects/example/quests/main/0000_example_quest/`.
- Change quest execution so `run_quest` runs the quest from its project-local
  quest directory while using the Sheaf repository root as the git and command
  boundary.
- Direct runtime logging for the Quest Runner service to `logs/quest-runner/`.
- Keep quest step logs inside the project-local quest directory, matching the
  existing quest artifact model.
- Add or migrate focused automated tests covering project-local quest creation,
  discovery, dashboard visibility, runner execution paths, and legacy quest
  exclusion.
- Add project-local documentation describing the migrated Quest Runner service,
  REST API, dashboard, quest directory layout, operational behavior, and testing
  workflow.

## Non-Goals

- Do not migrate existing top-level legacy quests.
- Do not display top-level legacy quests in the new Quest Runner web UI.
- Do not migrate the MCP server or expose any MCP endpoint.
- Do not migrate the Conductor service orchestrator.
- Do not migrate service registration, service lifecycle management, service
  restart recovery, service health polling, or service log tracking.
- Do not migrate SQLite database usage or introduce a database for Quest Runner.
- Do not create a new persistent database-backed quest index.
- Do not move unrelated projects or legacy application code into `projects/`.
- Do not change the semantics of existing quest state files unless needed for
  project-local paths.
- Do not migrate old quest records after the runner is moved; legacy quest
  migration will be a later quest.

## Project Layout

Create this project:

```text
projects/quest-runner/
  README.md
  quests/
  src/
  tests/
  docs/
```

Implementation code, migrated dashboard assets, tests, and project docs belong
under `projects/quest-runner/`.

Any `Makefile` changes must comply with the Makefile protocols in
`structure/makefile.md`. Project-specific commands belong in
`projects/quest-runner/Makefile`; root `Makefile` changes should be limited to
thin forwarding targets and aggregate project registration.

The implementation should avoid product code outside `projects/quest-runner/`.
If service registration, root Makefile forwarding, or shared configuration files
must be touched to make the service runnable according to Sheaf conventions, the
physical plan must call out those changes explicitly and keep them minimal.

## Quest Directory Model

The migrated runner must treat project-local quests as canonical:

```text
projects/<project>/quests/
  main|side/
    0000_example_slug/
      meta.json
      state.md
      state_history.md
      thread_registry.json
      physicalplan_issues.md
      state_execution_config.yaml
      specs/
      slices/
      logs/
      threads/
```

The top-level legacy layout remains on disk but is not used by the new runner:

```text
quests/
  main|side/
    0000_legacy_slug/
```

Quest numbering is per project and per quest type. For example,
`projects/web/quests/main/0000_a/` and
`projects/quest-runner/quests/main/0000_b/` can both exist.

Quest metadata must include enough information for the runner and UI to identify
the owning project. The physical planner should decide whether this is stored in
`meta.json`, derived from the path, or both. The behavior must be deterministic
and test-covered.

The runner must use Sheaf's repository root for git operations and command
execution. Project-local quest paths must be used for quest artifacts,
`$currentQuest`, `$currentSlice`, thread transcripts, role logs, and dashboard
links.

## REST API Requirements

The migrated service should provide REST APIs equivalent to the quest-runner
parts of the Conductor repo, without service-orchestrator or MCP APIs.

Required behavior:

- `GET /health` returns the standard Sheaf service health shape.
- `POST /create_quest` creates a quest under a selected project.
- `POST /run_quest` runs a selected project-local quest.
- Dashboard read APIs list, inspect, and monitor only project-local quests.
- The dashboard shell serves the migrated web UI.

The `create_quest` and `run_quest` request models must include the project
identity needed to select `projects/<project>/quests/`. The physical planner
should preserve existing field names where they still make sense and add an
explicit project field where needed.

The REST API must not expose service registration, service lifecycle, service log
streaming, database, or MCP behavior.

## Web UI Requirements

Migrate the quest dashboard UI from the Conductor repo into
`projects/quest-runner/`.

The migrated UI must:

- list projects that contain project-local quests
- list quests from `projects/*/quests/`
- hide all quests from the legacy top-level `quests/` directory
- open a project-local quest detail view
- show quest state, active slice state, issue counts, run status, step history,
  and relevant git-backed metadata as the existing dashboard does
- create and run quests through the migrated REST API
- include project identity in dashboard URLs and API calls

The UI must not show or control registered services. It must not include service
orchestrator pages, service log streaming pages, service restart controls, or MCP
configuration.

## Logging And Runtime Data

Quest Runner service logs must be written under:

```text
logs/quest-runner/
```

The runner should log each significant event, including service startup,
requests, quest creation, quest execution start and finish, per-step runner
transitions, harness calls, retries, permission enforcement events, early exits,
and errors. Verbose logging is acceptable and preferred for this migration.

Quest execution artifacts remain part of each quest directory. Existing per-step
role logs such as `logs/step_<n>_<role>.jsonl` should stay under the active
project-local quest directory.

If runtime data is needed (most likely won't be), it must go under:

```text
data/quest-runner/
```

The implementation must not use SQLite or another persistent database for quest
state, discovery, service state, or dashboard state.

## Configuration

Configuration must follow `structure/configuration.md`.

The physical planner should verify whether the existing quest runner has any
configuration beyond quest-local `state_execution_config.yaml`. If migrated
configuration is needed, it must live in `config/quest-runner.json` unless it is
secret material, in which case it belongs in `config/api_keys.json`.

The implementation must not rely on environment variables or ad hoc local config
files for persistent configuration.

## Service Integration

The Quest Runner service must bind to port `9002`.

If the implementation registers the service in `config/services.json`, the
service entry should use:

- `name`: `quest-runner`
- `port`: `9002`
- `home_path`: the dashboard path
- `command`: a root-relative command that delegates into
  `projects/quest-runner/`

The service must expose `GET /health`. If it is registered in
`config/services.json`, it must also expose `POST /exit` according to
`structure/services.md`.

The service must not manage other services. That remains the responsibility of
`projects/conductor/`.

## Testing Requirements

Tests should be migrated or rewritten under `projects/quest-runner/tests/`.

Coverage must include:

- quest creation under `projects/<project>/quests/`
- quest numbering scoped by project and quest type
- quest discovery across multiple project directories
- legacy top-level `quests/` exclusion
- dashboard API responses with project identity
- dashboard UI logic that preserves project identity in links and actions
- `run_quest` lookup and execution using project-local quest directories
- state-machine behavior preserved from the existing runner
- git step metadata preserved for project-local quests
- no SQLite/database usage in the migrated quest-runner path
- no MCP endpoint exposed by the migrated service

Where existing Conductor tests cover quest-runner behavior, migrate the useful
tests and update their fixtures to use `projects/<project>/quests/`. Do not
migrate tests that are specifically about service management, SQLite, service
registration, or MCP.

## Documentation Requirements

Add project-local docs under `projects/quest-runner/docs/` covering:

- service overview
- REST API
- project-local quest layout
- dashboard behavior
- runner lifecycle and state machine
- logging and operational behavior
- configuration
- testing
- known legacy quest exclusion and future migration note

The old Conductor repository documentation format and Sheaf's current
documentation format may differ. Any added or rewritten documentation in this
repo must follow the new format described in `structure/docs-structure.md` and
the project documentation rules in `structure/project-rules.md`, even when the
source documentation from `/Users/joyo/conductor` uses a different organization.

Docs should describe the current migrated system. They should not document the
old top-level quest layout as active behavior except as legacy background.

## Acceptance Criteria

- `projects/quest-runner/` exists and follows the required project layout.
- The Quest Runner service runs on port `9002`.
- Quest creation writes new quests under `projects/<project>/quests/`.
- Quest execution reads and writes project-local quest artifacts.
- The web UI lists and opens only project-local quests.
- Top-level legacy quests remain untouched and hidden from the new UI.
- No MCP server or MCP route is present in the migrated service.
- No SQLite database or service-manager database behavior is used by the
  migrated quest runner.
- Service-orchestrator behavior remains in `projects/conductor/` and is not
  duplicated into `projects/quest-runner/`.
- Runtime service logs are written under `logs/quest-runner/`.
- Automated tests cover the migrated project-local path model and legacy quest
  exclusion.
- Project-local docs describe the migrated Quest Runner accurately.
