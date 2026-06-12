# Architecture

Quest Runner is the Sheaf service that executes **quests** — self-contained
units of feature work stored under `projects/<project>/quests/<type>/<n>_<slug>/`
— by driving LLM-agent roles through a YAML-defined state machine inside a
dedicated git worktree per quest. It exposes a Flask HTTP service (port `9002`),
a CLI that wraps that service, and a web dashboard with a live agent-chat view.
This document is cross-capability design prose; normative requirements live in
the capability specs under [openspec/specs/](../../../openspec/specs/), and exact build/run/test
commands live in [operations.md](operations.md).

Quest Runner is filesystem- and git-backed only: there is no database. Quest
state, issues, logs, and workflow configuration are files inside the quest
directory; durable history is the git commit log of the quest worktree.

## Component map

All paths are relative to `projects/quest-runner/`.

| Component | Path | Role |
| --- | --- | --- |
| Service entry | `src/quest_runner_service/__main__.py` | `python -m quest_runner_service`; binds host/port, configures logging, builds the app |
| Service layer | `src/quest_runner_service/api.py` | Flask routes: lifecycle (`/create_quest`, `/run_quest`, `/advance_quest`, `/land`, `/upgrade_quest`), experiments, issues, slices, dashboard APIs, `/health`, `/exit` |
| Quest service | `src/quest_runner_service/quest_service.py` | `create_quest`, `run_quest` scheduling, manual advance, landing, per-worktree locks (`quest_lock.py`) |
| Quest filesystem | `src/quest_runner_service/quest_fs.py` | Project-local quest discovery, state files, thread registry I/O |
| Worktrees | `src/quest_runner_service/worktrees.py` | Deterministic worktree creation/location at `<repo-parent>/.quest-worktrees/<project>_<type>_<n>_<slug>/` |
| State-machine interpreter | `src/quest_runner_service/state_machine/` | Generic recursive interpreter (`workflow_interpreter.py`), step executor (`v2_step_executor.py`), conditions (`workflow_conditions.py`), actions, state I/O, commit metadata (`commit_metadata.py`) |
| Runner entry | `src/quest_runner_service/quest_runner_v2.py` | Loads the quest-local `workflow/` directory and runs the step loop |
| Workflow config | `src/quest_runner_service/workflow_config.py`, `workflow_scaffold.py`, `workflow_upgrade.py` | YAML loading/validation, copy-on-create scaffolding, legacy migration |
| Default workflow package | `src/quest_runner_service/default_workflow/` | Packaged `workflow.yaml`, `machines/` (quest, slice), `profiles/` and `prompts/` for the eight default roles, `preamble.md` |
| Harness layer | `src/quest_runner_service/harness.py`, `harness_config.py`, `quest_thread.py`, `workflow_profile_execution.py`, `agent_vm.py` | Adapters for the `claude_code`, `cursor`, and `codex` agent CLIs; provider config from `config/quest-runner.json`; per-role thread registry; profile prompt/path-rule assembly; optional VM-backed CLI execution |
| Issues | `src/quest_runner_service/issue_service.py` | Structured issue files (`QP-`, `PL-`, `IT-` prefixes) edited only through the API/CLI |
| Experiments | `src/quest_runner_service/experiments.py` | Replay a quest from an earlier step commit in a separate worktree; metadata, stop conditions, landing/archival |
| Dashboard backend | `src/quest_runner_service/dashboard_data.py`, `dashboard_git.py`, `dashboard_slice.py`, `dashboard_runs.py`, `dashboard_chat.py` | JSON payloads, git commit/diff views, slice pages, in-memory run tracking, agent-log WebSocket |
| Chat streaming | `src/quest_runner_service/agui_mapper.py`, `chat_event_bus.py` | Maps harness JSONL logs to AGUI events; fans live events out to WebSocket subscribers |
| Dashboard frontend | `src/quest_runner_service/dashboard_assets/` | HTML/CSS/ES-module web UI served at `/dashboard` |
| Prompt schema docs | `src/quest_runner_service/quest_docs/` | Runtime schema reference injected into role prompts (not part of this docs tree) |
| Agent VM | `vm/agent-macos/` | Tart-based macOS VM image and lifecycle scripts for per-worktree harness execution (see [operations.md](operations.md)) |
| CLI | `bin/quest-runner`, `src/quest_runner_service/cli.py`, repo-root `scripts/quest-runner` | Argparse CLI wrapping the REST service |

Capabilities specified on top of these components:
[quest-lifecycle](../../../openspec/specs/quest-runner-quest-lifecycle/spec.md),
[service-lifecycle](../../../openspec/specs/quest-runner-service-lifecycle/spec.md),
[state-machine-engine](../../../openspec/specs/quest-runner-state-machine-engine/spec.md),
[workflow-config](../../../openspec/specs/quest-runner-workflow-config/spec.md),
[agent-harness](../../../openspec/specs/quest-runner-agent-harness/spec.md),
[issues](../../../openspec/specs/quest-runner-issues/spec.md),
[slices](../../../openspec/specs/quest-runner-slices/spec.md),
[experiments](../../../openspec/specs/quest-runner-experiments/spec.md),
[dashboard](../../../openspec/specs/quest-runner-dashboard/spec.md),
[chat-stream](../../../openspec/specs/quest-runner-chat-stream/spec.md).

## Execution data flow

1. **Create** — `POST /create_quest` (or `scripts/quest-runner create`)
   validates that the source checkout is a clean git repo on a named branch,
   allocates the next quest number, scaffolds
   `projects/<project>/quests/<type>/<n>_<slug>/`, copies the packaged
   `default_workflow/` into the quest's `workflow/` directory
   (`workflow_scaffold.copy_packaged_default_workflow`), commits the scaffold,
   creates the quest worktree on branch `quest/<worktree_name>`, and, when
   `agent_vm.enabled` is true, allocates the worktree's VM after worktree
   creation succeeds
   ([quest-lifecycle](../../../openspec/specs/quest-runner-quest-lifecycle/spec.md)).
2. **Run** — `POST /run_quest` acquires the per-worktree lock, returns `202`
   with a `run_id`, and schedules `quest_runner_v2.run_quest_v2` on a
   background thread. The run executes entirely inside the quest worktree;
   a missing worktree is a `409`, never an implicit re-create.
3. **Step loop** — each step (`state_machine/v2_step_executor.py`):
   - the interpreter (`workflow_interpreter.py`) reads quest and slice
     `state.md`, descends into the active collection child (e.g. the active
     slice) and picks the current node from the machine YAML;
   - node transition conditions are evaluated by `workflow_conditions.py`
     (file/dir existence, open-issue counts, variable checks);
   - if the node has a `run` block, `workflow_profile_execution.py` resolves
     the profile, renders the prompt (profile prompt + `workflow/preamble.md`
     + node task text + `quest_docs/` schema reference), and the harness layer
     invokes the configured agent CLI on the role's persistent thread either on
     the host or inside the assigned worktree VM
     ([agent-harness](../../../openspec/specs/quest-runner-agent-harness/spec.md));
   - harness events are appended to `<quest_dir>/logs/step_<n>_<role>.jsonl`
     and fanned out live through the chat event bus
     ([chat-stream](../../../openspec/specs/quest-runner-chat-stream/spec.md));
   - profile path rules are enforced over the files the harness touched;
   - if the worktree changed, a git commit is created whose message carries
     `quest-step`, `state-machine-path`, node names, and a recursive snapshot
     JSON payload (`state_machine/commit_metadata.py`);
   - state transitions are written back to the quest/slice `state.md` files.
4. **Land** — `POST /land` (or `scripts/quest-runner land`) integrates the
   finished quest branch onto the target branch (default `main`) and deletes
   the registered worktree VM after successful landing cleanup.

The dashboard reads the same filesystem and git data through
`/api/dashboard/*`; it resolves the quest worktree first and falls back to the
source checkout for read-only views ([dashboard](../../../openspec/specs/quest-runner-dashboard/spec.md)).

## Key design decisions and invariants

- **Per-step git commits as audit trail.** Every step that changes the
  worktree commits with structured `quest-step` metadata in the message. The
  commit log is the durable step history: dashboards replay it, and
  experiments use it to find the exact commit for a step to replay from.
- **Copy-on-create workflow snapshot.** The packaged `default_workflow/` is
  copied into each new quest's `workflow/` directory. A quest always runs the
  workflow it was created with — later changes to the package never alter
  in-flight quests, and experiments can substitute an entire alternate
  `workflow/` directory ([workflow-config](../../../openspec/specs/quest-runner-workflow-config/spec.md)).
- **No state enums in code.** State names come exclusively from the workflow
  machine YAML; the interpreter is generic and the codebase carries no
  hardcoded quest-state enum (guarded by `tests/test_no_state_enums.py`).
  `workflow.yaml` declares the only special names the engine needs
  (`completed_state`, `human_intervention_file`).
- **File-presence gating.** Progress conditions are sentinel files inside the
  quest tree — e.g. `implementation_done.md` in a slice,
  `physicalplan_accepted.md` at the quest root — evaluated by
  `workflow_conditions.py`. Agents signal completion by creating files, not by
  calling back into the service.
- **Human intervention blocks, and state writes are deferred.** When a step
  needs a human, the runner writes `human_intervention_request.md` at the
  quest root and stops; its presence blocks `run_quest` and `advance_quest`.
  State transitions computed during such a step are carried as
  `PendingStateWrite` records (`workflow_interpreter.py`) and only applied and
  committed once the step completes without intervention, so `state.md` never
  runs ahead of reality.
- **Thread reuse per role.** Each workflow role gets one persistent harness
  thread per quest, recorded in a thread registry inside the quest directory
  (`quest_thread.py`), so a role retains its conversation context across
  steps.
- **Worktree as execution boundary.** All agent commands, path rules, and git
  operations during a run are scoped to the quest (or experiment) worktree. In
  VM-backed mode the VM preserves the host worktree path inside the guest, so
  provider sessions and path rules see the same filesystem paths as host-local
  runs. Per-worktree locks (`quest_lock.py`) serialize runs; lock contention is
  a `409` with owner details.
- **Issues are API-mediated.** Issue markdown files (`physicalplan_issues.md`,
  slice `polishing_issues.md`, `integration_test_issues.md`) are read and
  written only through the issue API/CLI, keeping IDs and statuses
  machine-parseable ([issues](../../../openspec/specs/quest-runner-issues/spec.md)).
- **Experiments replay, never merge.** An experiment branches from the parent
  of a chosen step commit, runs an alternate workflow in its own worktree to a
  configured stop node, and lands by archiving artifacts under
  `experiments/<n>/` on the source checkout and pushing the branch — it never
  rebases or merges code into `main`
  ([experiments](../../../openspec/specs/quest-runner-experiments/spec.md)).

## Service boundaries

Quest Runner deliberately excludes service orchestration: registration and
lifecycle of other services, service-log streaming, SQLite, and MCP routes
belong to `projects/conductor/`. Quest Runner registers itself in
`config/services.json` and offers `GET /health` and `POST /exit` for
coordinated shutdown ([service-lifecycle](../../../openspec/specs/quest-runner-service-lifecycle/spec.md)).

Service process logs go to `logs/quest-runner/`; all quest-run artifacts stay
inside the quest directory in its worktree. See repository-wide rules in
[structure/services.md](../../../structure/services.md) and
[structure/logs-and-data.md](../../../structure/logs-and-data.md).
