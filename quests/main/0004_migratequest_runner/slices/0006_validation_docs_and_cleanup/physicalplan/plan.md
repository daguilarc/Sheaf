# Physical Plan: Validation Docs And Cleanup

## Objective

Complete migration hardening: add focused end-to-end validation, finish project-local documentation, remove obsolete compatibility code, and prove the migrated Quest Runner contains no excluded Conductor service-orchestrator, database, or MCP behavior.

Expected outcome:

- Automated tests cover all acceptance criteria in the quest spec.
- Project-local docs under `projects/quest-runner/docs/` describe the current migrated system using Sheaf documentation rules.
- Temporary compatibility code for top-level quest discovery is removed or locked behind tests proving it is not used by the new runner/UI.
- Runtime/service integration is verified through `make` and direct health/dashboard checks.
- Static checks show no SQLite/database, service-manager, service lifecycle, service log tracking, or MCP endpoint remains in product code.

## Key Files And Systems

Likely affected files:

- `projects/quest-runner/README.md`
- `projects/quest-runner/docs/README.md`
- `projects/quest-runner/docs/reference/api.md`
- `projects/quest-runner/docs/reference/config.md`
- `projects/quest-runner/docs/reference/layout.md`
- `projects/quest-runner/docs/reference/testing.md`
- `projects/quest-runner/docs/explanation/architecture.md`
- `projects/quest-runner/docs/explanation/lifecycle.md`
- `projects/quest-runner/docs/how-to/run-service.md`
- `projects/quest-runner/tests/**`
- `projects/quest-runner/src/quest_runner_service/**`
- `projects/quest-runner/Makefile`
- Root `Makefile`
- `config/services.json`

## Existing APIs To Reuse As-Is

- Reuse the final public REST APIs from slice 4 and final UI behavior from slice 5 in integration tests.
- Reuse `dashboard.md` and `quest-harness.md` only as source material for human-facing project docs; rewrite to describe current Sheaf/project-local behavior.
- Treat `projects/quest-runner/src/quest_runner_service/quest_docs/**` as bundled runtime schema/workflow reference content for prompt injection, not as human-facing docs to rewrite.
- Reuse Sheaf docs structure and service/config/logging conventions from `structure/`.

## APIs To Extend Or Modify

- Add any missing test helpers/fixtures needed for project-local git worktree integration tests.
- Add docs-index links and canonical references; avoid duplicate API or layout descriptions across docs.
- Remove or tighten any APIs kept temporarily for migration, especially:
  - repo-path-only quest lookup
  - top-level `quests/` scanning
  - dashboard repository tracking concepts
  - service-manager compatibility fields
  - Conductor naming in public API responses

## Documentation Plan

Create or update:

- `README.md`: short project overview, service command, docs links.
- `docs/README.md`: project docs index.
- `docs/reference/api.md`: `/health`, `/exit`, `/create_quest`, `/run_quest`, dashboard APIs, request/response shapes, status codes, missing worktree errors.
- `docs/reference/layout.md`: `projects/<project>/quests/` canonical layout, metadata shape including project identity, worktree name/path convention, legacy top-level quest exclusion.
- `docs/reference/config.md`: service registration in `config/services.json`, absence or shape of `config/quest-runner.json`, role execution config location, no environment-variable persistence.
- `docs/reference/testing.md`: `make -C projects/quest-runner test`, focused Python and JS test commands, temp git/worktree fixture notes.
- `docs/explanation/architecture.md`: migrated modules, state machine, dashboard/data flow, and exclusion boundaries with `projects/conductor/`.
- `docs/explanation/lifecycle.md`: create/run flow, worktree resolution, locks, step commits, harness calls, logging, human intervention.
- `docs/how-to/run-service.md`: running the service on port `9002`, health check, dashboard URL, log path.

Docs must describe the migrated current state only. Mention top-level `quests/` only as legacy data that is intentionally hidden and not migrated.

This documentation rewrite targets only `projects/quest-runner/docs/**` and `projects/quest-runner/README.md`. It must not rewrite, reorganize, or Diataxis-convert `projects/quest-runner/src/quest_runner_service/quest_docs/**`, because that package directory is the runtime `quest_docs_dir` consumed by role prompts and state-machine context. Human-facing docs may link to the runtime schema docs or summarize them, but the runtime content stays structurally compatible with `/Users/joyo/conductor/docs/quest/**`.

## Cleanup Plan

- Delete or stop exporting any service-manager, DB, MCP, trace, and log-stream compatibility modules copied accidentally during migration.
- Remove dashboard UI affordances for service orchestration rather than hiding them with inactive code paths.
- Remove unused imports, dead tests, and stale Conductor-specific names where they are public-facing.
- Keep internal module names pragmatic; public docs and APIs should consistently say Quest Runner, not Conductor, except when describing migration provenance.
- Verify no product code relies on `/Users/joyo/conductor`.
- Verify runtime prompt/context code resolves quest schema docs from `projects/quest-runner/src/quest_runner_service/quest_docs/**`, not from human-facing `projects/quest-runner/docs/**`.

## Validation

Required automated checks:

- `make -C projects/quest-runner test`
- Root `make quest-runner-test`
- Focused Python tests for:
  - quest creation under `projects/<project>/quests/`
  - immediate worktree creation from current branch
  - deterministic worktree naming
  - per-project/per-type numbering
  - multi-project discovery
  - legacy top-level quest exclusion
  - run path using worktree project-local quest directory
  - run refusal when expected worktree is missing
  - state-machine behavior and git step metadata preservation
  - no database/MCP route/product import
- Focused JS tests for:
  - project identity in links/API calls
  - run-button visibility and click behavior
  - absence of service-orchestrator UI

Required manual/runtime checks:

- Start the service with `make quest-runner-run` or `make -C projects/quest-runner run`.
- Verify `GET http://localhost:9002/health` returns the Sheaf health shape.
- Open `http://localhost:9002/dashboard` and verify only project-local quests are visible.
- Create a temporary quest through the API/UI and verify the project-local quest record and deterministic worktree exist.
- Trigger `run_quest` for a quest with a missing worktree and verify the clear refusal response.
- Confirm `logs/quest-runner/` receives service logs and quest step logs remain under the quest directory.

Static checks:

- `rg "/Users/joyo/conductor|conductor.db|sqlite|mcp_server|ServiceManager|register_service|start_service|stop_service|restart_service|/mcp|/logs|/trace" projects/quest-runner/src`
- `rg "repo_path" projects/quest-runner/src/quest_runner_service/dashboard_assets projects/quest-runner/tests` should show only intentionally internal checkout paths, not public dashboard selection state.
