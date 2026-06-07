# Physical Plan: Scaffold Inventory And Source Import

## Objective

Create the new Sheaf project shell at `projects/quest-runner/`, migrate only the quest-runner-owned source/docs/assets/prompts/tests from `/Users/joyo/conductor`, and leave service-orchestrator, database, service lifecycle, log streaming, and MCP code behind.

Expected outcome:

- `projects/quest-runner/` has the required Sheaf layout: `README.md`, `quests/`, `src/`, `tests/`, and `docs/`.
- Quest-runner Python modules and dashboard assets are present under the new project, still functionally equivalent to the external source before project-local path changes.
- Runtime roles and default quest execution config are colocated with the migrated runner so `build_role_prompt` and quest creation no longer depend on `/Users/joyo/conductor`.
- The project is runnable/testable from its own `Makefile`, with any root Makefile changes limited to thin forwarding and `PROJECTS` registration.
- No service-manager, SQLite, service registry, service log tracking, or MCP code is copied into `projects/quest-runner/`.

## Source Inventory

Quest-runner source to migrate:

- `/Users/joyo/conductor/conductor/quest_service.py`: quest creation, scheduling, locks, run dispatch.
- `/Users/joyo/conductor/conductor/quest_runner.py`: role routing, harness execution, path-rule enforcement, state transitions, commit helpers.
- `/Users/joyo/conductor/conductor/quest_runner_v2.py`: canonical recursive runner.
- `/Users/joyo/conductor/conductor/quest_fs.py`: quest/slice filesystem parsing and writing.
- `/Users/joyo/conductor/conductor/quest_types.py`: quest, slice, execution profile, issue, metadata, and recursive snapshot datatypes.
- `/Users/joyo/conductor/conductor/quest_thread.py`: thread registry, prompt loading, runtime context.
- `/Users/joyo/conductor/conductor/harness.py`: Codex, Cursor, and Claude Code CLI harnesses and JSONL logging.
- `/Users/joyo/conductor/conductor/quest_lock.py`: in-process quest lock.
- `/Users/joyo/conductor/conductor/deferred_tasks.py`: in-process retry scheduler for billing/rate-limit deferrals; migrate because it is not database-backed.
- `/Users/joyo/conductor/conductor/dashboard_data.py`, `dashboard_git.py`, `dashboard_runs.py`, `dashboard_slice.py`: dashboard payloads, git history, run overlay, slice pages.
- `/Users/joyo/conductor/conductor/dashboard_assets/`: dashboard HTML, CSS, JS, and JS tests.
- `/Users/joyo/conductor/conductor/state_machine/`: recursive state-machine core, quest definitions, v2 state IO, commit metadata.
- `/Users/joyo/conductor/conductor/default_state_execution_config.yaml`: default role profiles and path enforcement template.
- `/Users/joyo/conductor/roles/*.md`: physical planner, reviewers, implementer, polisher, and documenter prompts used by `quest_thread.build_role_prompt`.
- `/Users/joyo/conductor/docs/quest/**`: runtime-injected quest schema/workflow reference docs; bundle these unchanged under `projects/quest-runner/src/quest_runner_service/quest_docs/`.
- `/Users/joyo/conductor/docs/quest-harness.md` and `docs/dashboard.md`: source material for human-facing project documentation only; rewrite in slice 6.
- Initial runnable test subset from `/Users/joyo/conductor/tests/`: only tests that do not depend on `api.create_app`, `ServiceManager`, `DB`, project-local path rewrites, or dashboard UI rewrites. Own this subset in slice 1:
  - `test_commit_metadata.py` for pure commit metadata rendering/parsing behavior.
  - `test_normalized_state_md.py`.
  - `test_state_machine_core.py`.
  - focused `test_quest_fs.py` cases for state, issue, history, thread registry, and execution config parsing that remain valid before project-local discovery changes.
  - focused `test_harness_quest_thread.py` cases for harness/thread helpers and role prompt loading after roles are bundled.

Code not to migrate:

- `/Users/joyo/conductor/conductor/service_manager.py`: service lifecycle, restart, trace, and log behavior belongs to `projects/conductor/`.
- `/Users/joyo/conductor/conductor/db.py`: SQLite-backed service registry; excluded by spec.
- Service-manager routes in `/Users/joyo/conductor/conductor/api.py`: `/services`, `/register_service`, `/start_service`, `/stop_service`, `/restart_service`, `/start_all_services`, `/stop_all_services`, `/all_health`, `/logs`, `/trace`, and `/restart_conductor`.
- `/Users/joyo/conductor/conductor/__main__.py` MCP and service-manager composition; use only as a reference for process wiring.
- `/Users/joyo/conductor/conductor/mcp_server.py`: excluded by spec.
- `/Users/joyo/conductor/tests/test_service_manager_lifetime.py`: service-manager-only coverage.
- `/Users/joyo/conductor/conductor.db*`, `/Users/joyo/conductor/logs/*`, virtualenvs, local MCP/Cursor settings, and cache files.

## Key Files And Systems

Likely new files:

- `projects/quest-runner/README.md`
- `projects/quest-runner/Makefile`
- `projects/quest-runner/requirements.txt`
- `projects/quest-runner/start_quest_runner.sh`
- `projects/quest-runner/src/quest_runner_service/**`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/**`
- `projects/quest-runner/src/quest_runner_service/roles/*.md`
- `projects/quest-runner/src/quest_runner_service/quest_docs/README.md`
- `projects/quest-runner/src/quest_runner_service/quest_docs/schemas.md`
- `projects/quest-runner/src/quest_runner_service/quest_docs/workflow.md`
- `projects/quest-runner/src/quest_runner_service/quest_docs/schemas/issue-responses.md`
- `projects/quest-runner/src/quest_runner_service/default_state_execution_config.yaml`
- `projects/quest-runner/tests/test_commit_metadata.py`
- `projects/quest-runner/tests/test_normalized_state_md.py`
- `projects/quest-runner/tests/test_state_machine_core.py`
- `projects/quest-runner/tests/test_quest_fs_core.py`
- `projects/quest-runner/tests/test_harness_quest_thread_core.py`
- `projects/quest-runner/docs/README.md`

Likely existing files to touch:

- `Makefile`: add `quest-runner` to `PROJECTS` and thin `quest-runner-*` forwarding targets only.
- `config/services.json`: not in this slice; service registration is planned in slice 4.

## Existing APIs To Reuse As-Is

- `quest_fs` state, metadata, issue, history, thread registry, and execution config parsers should be copied first with minimal import-path changes.
- `quest_types` dataclasses and enums should be copied unchanged initially.
- `harness` CLI abstractions and JSONL log sink should be reused with only package import-path updates.
- `state_machine` core modules should be copied intact before path-model changes.
- Initial runnable tests should be copied/adapted only for the slice-1 subset listed above. Dashboard JS tests and API/dashboard Python tests are owned by later slices.

## APIs To Extend Or Modify Later

- `QuestMeta` needs project identity in slice 2.
- `quest_fs.find_quest_dir` and `list_quest_dirs` need project-local path support in slice 2.
- `QuestService.create_quest` and `run_quest` need project and worktree semantics in slices 2 and 3.
- Dashboard payload APIs need project discovery and checkout resolution in slices 4 and 5.
- `api.create_app` should be replaced by a quest-runner-only REST app in slice 4.

## Implementation Notes

Keep the initial copy mechanically small, then repair imports and package paths in the new project. Use package name `quest_runner_service` under `projects/quest-runner/src/` to avoid colliding with the quest record directory name `quests/`.

Prompt loading should be changed from `conductor_repo_path / "roles"` to a project-local roles directory, for example `Path(__file__).resolve().parent / "roles"`, while retaining the public helper shape used by the runner.

Runtime quest schema docs should be bundled separately from human-facing docs at `projects/quest-runner/src/quest_runner_service/quest_docs/`. This directory is the concrete project-local `quest_docs_dir` used by role prompt/runtime context code. Copy `/Users/joyo/conductor/docs/quest/**` into this package directory without rewriting it to Sheaf human-doc style in this slice.

The default execution config should be bundled under the package or project and copied from there on quest creation. Do not leave a runtime dependency on `/Users/joyo/conductor/conductor/default_state_execution_config.yaml`.

The initial project `Makefile` should expose at least:

- `all`: run `test`
- `test`: the slice-1 focused Python unit subset only; later slices expand this target after adding their owned tests
- `run`: start the service entry point on port `9002`
- `clean`: remove Python and JS test caches inside the project only

## Test Migration Ownership

Do not copy every external Conductor test into slice 1. Migrate or split tests in the slice that introduces the dependency they need:

- Slice 1 owns core parser/state-machine/commit-metadata/thread tests that run without REST, service-manager, project-local discovery, worktrees, or dashboard rewrites.
- Slice 2 owns creation, slug, project-local quest filesystem, metadata project field, numbering, and worktree-creation tests. If using source `test_quest_service.py`, split only the creation/scheduler portions here; REST route cases wait for slice 4.
- Slice 3 owns runner execution, v2 state machine execution, role profile/path enforcement, dirty workspace, and project-local commit metadata tests.
- Slice 4 owns REST app, `/create_quest`, `/run_quest`, dashboard API, dashboard shell/static serving, and negative service-orchestrator/MCP route tests.
- Slice 5 owns dashboard asset JS tests and UI logic tests for project URLs, run-button behavior, and removal of service controls.
- Slice 6 owns aggregate/end-to-end validation and any remaining acceptance-criteria coverage after the feature slices.

## Validation

- Run `make -C projects/quest-runner test` after the copied subset is importable; for slice 1 this target must collect only the slice-1 core subset and must not collect REST/API/dashboard tests that still depend on later slices.
- Run focused Python tests for filesystem parsing, state machine core, commit metadata, harness/thread, and normalized state parsing.
- Verify `rg "service_manager|from \\.db|mcp_server|sqlite|conductor.db" projects/quest-runner/src projects/quest-runner/tests` shows no product dependency on excluded systems, aside from comments or tests asserting absence.
