# Operations

Normative procedures to build, run, and test Quest Runner from a fresh
checkout. Design context: [architecture.md](architecture.md). Repository-wide
test lane rules: [structure/testing.md](../../../structure/testing.md).

All commands run from the Sheaf repository root unless noted. The project
directory is `projects/quest-runner/`.

## Prerequisites

- Python >= 3.10 on `PATH` as `python3` (`scripts/quest-runner` enforces the
  3.10 floor).
- git (worktree support required).
- Node.js on `PATH` as `node` — required by `tests/test_dashboard_shell.py`,
  which runs the dashboard ES-module tests via `node --test`. No `npm install`
  is needed; the dashboard has no `package.json`.
- Python dependencies are installed into the project venv from
  `projects/quest-runner/requirements.txt` (`flask`, `flask-sock`, `httpx`,
  `pyyaml`) by the targets below; no manual pip step.

## Build

```bash
make -C projects/quest-runner venv
```

Creates `projects/quest-runner/.venv` with `python3 -m venv` and installs
`requirements.txt`. `test` and `run` depend on `venv` and create it on demand.

## Make targets

Project Makefile (`projects/quest-runner/Makefile`):

| Target | Effect |
| --- | --- |
| `all` | Alias for `test`. |
| `venv` | Create `.venv` and install `requirements.txt`. |
| `test` | Run the regular test suite (see below). |
| `run` | Start the service via `start_quest_runner.sh`. |
| `clean` | Remove `__pycache__`, `*.pyc`, `.pytest_cache`, and any `node_modules` under `src/quest_runner_service/dashboard_assets/`. |
| `agent-vm-rebuild` | Reprovision the golden agent VM (`vm/agent-macos/bin/rebuild-golden`). |
| `agent-vm-fresh` | Rebuild the golden VM from the upstream base image (`rebuild-golden --fresh`). |
| `agent-vm-run` | Run an agent VM clone with a worktree mounted: `vm/agent-macos/bin/agent-run $(WORKTREE)`; `WORKTREE` defaults to the repository root. |

Root Makefile delegates:

| Target | Effect |
| --- | --- |
| `make quest-runner-build` | `make -C projects/quest-runner all` |
| `make quest-runner-test` | `make -C projects/quest-runner test` |
| `make quest-runner-run` | `make -C projects/quest-runner run` |
| `make quest-runner-clean` | `make -C projects/quest-runner clean` |

Agent VM usage with an explicit worktree:

```bash
make -C projects/quest-runner agent-vm-run WORKTREE=/path/to/worktree
```

## Tests

### Regular lane

```bash
make -C projects/quest-runner test
# or, from the repo root:
make quest-runner-test
```

This runs `PYTHONPATH=src .venv/bin/python -m unittest` over the
`TEST_MODULES` list in `projects/quest-runner/Makefile` (34 modules, from
`tests.test_commit_metadata` through `tests.test_dashboard_chat`).
`tests.test_dashboard_shell` shells out to `node --test` for
`dashboard-logic.test.mjs` and `dashboard-pages-utils.test.mjs` under
`src/quest_runner_service/dashboard_assets/`.

Two test files exist on disk but are NOT in `TEST_MODULES` and do not run in
this lane: `tests/test_workflow_upgrade.py` and
`tests/test_issue_file_resolution.py`. Run them explicitly if needed:

```bash
cd projects/quest-runner
PYTHONPATH=src .venv/bin/python -m unittest tests.test_workflow_upgrade tests.test_issue_file_resolution
```

Run a single module:

```bash
cd projects/quest-runner
PYTHONPATH=src .venv/bin/python -m unittest tests.test_quest_creation
```

Run the dashboard JS tests directly:

```bash
node --test projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.test.mjs
node --test projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-pages-utils.test.mjs
```

### Integration lane

There is no `integration-test` target in `projects/quest-runner/Makefile` and
no `tests/integration/` directory. Heavier flows (temp git repos, worktrees,
Flask test clients, the end-to-end `tests.test_experiment_lifecycle`) run
inside the regular lane above. This deviates from the Makefile contract in
[structure/testing.md](../../../structure/testing.md).

## Run the service

```bash
make -C projects/quest-runner run
# or: make quest-runner-run
# or: bash projects/quest-runner/start_quest_runner.sh
```

`start_quest_runner.sh` creates the venv if missing, installs
`requirements.txt`, sets `PYTHONPATH` to `projects/quest-runner/src`, `cd`s to
the repository root, and execs:

```bash
.venv/bin/python -m quest_runner_service --port 9002
```

stdout/stderr are appended to `logs/quest-runner/quest_runner_stdout.log` and
`logs/quest-runner/quest_runner_stderr.log`; the rotating service log is
`logs/quest-runner/quest-runner.log`. `python -m quest_runner_service` also
accepts `--host` (default `0.0.0.0`).

Registration: `config/services.json` declares the `quest-runner` service with
port `9002`, `home_path` `/dashboard`, and command `make quest-runner-run`.
The CLI resolves the service URL from this file.

Verify and stop:

```bash
curl -s http://localhost:9002/health     # {"healthy": true, "uptime": ...}
curl -X POST http://localhost:9002/exit  # clean shutdown
```

Dashboard: `http://localhost:9002/dashboard`.

## Harness CLI prerequisites

Quest execution invokes agent CLIs configured in repo-root
`config/quest-runner.json` (read by
`src/quest_runner_service/harness_config.py`):

```json
{
  "harnesses": {
    "claude_code": { "cli_path": "/Users/joyo/.local/bin/claude" },
    "cursor": { "cli_path": "/Users/joyo/.local/bin/cursor-agent" },
    "codex": {}
  }
}
```

Keys must be valid harness kinds (`claude_code`, `cursor`, `codex`). Set each
`cli_path` to the installed binary on the host. A role whose harness is not
available fails the run with `HarnessNotAvailable`. The file is optional for
service startup and tests; it is required before running real quests.

## CLI

The operator CLI is repo-root `scripts/quest-runner` (wraps
`projects/quest-runner/bin/quest-runner`). It needs the project venv (or
`QUEST_RUNNER_PYTHON` pointing at a Python >= 3.10) and a running service.
Service URL resolution order: `--base-url`, `QUEST_RUNNER_URL`,
`config/services.json`, fallback `http://localhost:9002`. Add `--json` for raw
JSON output. `scripts/quest-runner help` prints the full surface.

## Operator procedures

### Create and run a quest

```bash
scripts/quest-runner create --project <project> --type main|side --name "<Name>"
scripts/quest-runner run --project <project> --type main|side --number <n> [--max-steps <k>]
```

`create` requires a clean source checkout on a named branch; it scaffolds the
quest, commits it, and creates the worktree at
`<repo-parent>/.quest-worktrees/<project>_<type>_<n>_<slug>/`. `run` returns
immediately; progress is visible on the dashboard and in the quest worktree.

### Advance after human intervention

When a run stops with `human_intervention_request.md` at the quest root:
resolve the condition in the quest worktree, delete
`human_intervention_request.md`, then either re-run or advance one top-level
step without invoking a harness:

```bash
scripts/quest-runner advance --project <project> --type main|side --number <n>
```

`advance` fails with a conflict while `human_intervention_request.md` exists
or while the quest lock is held.

### Land a quest

```bash
scripts/quest-runner land --project <project> --type main|side --number <n> [--target-branch main]
```

### Create and land an experiment

```bash
# Alternate workflow directory (must contain workflow.yaml):
cp -R projects/quest-runner/src/quest_runner_service/default_workflow /tmp/experiment-workflow

scripts/quest-runner experiments create \
  --project <project> --type main|side --number <n> \
  --start-step <global-step> \
  --stop-node <node> [--stop-machine-path <path>] \
  --notes-file /tmp/notes.md \
  --config-file /tmp/experiment-workflow

scripts/quest-runner run --project <project> --type main|side --number <n> \
  --experiment-id experiment_<project>_<type>_<n>_<expN>

scripts/quest-runner experiments land \
  --project <project> --type main|side --number <n> \
  --experiment-id experiment_<project>_<type>_<n>_<expN>
```

`experiments land` requires the experiment to have reached its stop condition
(state `ExperimentComplete`); it archives logs/issues/responses under the
quest's `experiments/<expN>/`, pushes the experiment branch, then removes the
local worktree and branch. Other quest-scoped commands (`advance`, `issues`,
`slices init`) accept the same `--experiment-id` to target the experiment
worktree.

### Issues and slices

```bash
scripts/quest-runner issues list   --project <p> --type <t> --number <n> --file physicalplan_issues.md
scripts/quest-runner issues read   <ID>   --project <p> --type <t> --number <n> --file <file>
scripts/quest-runner issues create --project <p> --type <t> --number <n> --file <file> --title "..." [--body "..."]
scripts/quest-runner issues edit   <ID>   --project <p> --type <t> --number <n> --file <file> [--status open|completed]
scripts/quest-runner issues respond <ID>  --project <p> --type <t> --number <n> --file <file> --outcome Fixed|NotFixed [--explanation "..."]
scripts/quest-runner issues responses <ID> --project <p> --type <t> --number <n> --file <file>

scripts/quest-runner slices init --project <p> --type <t> --number <n> --count <k> [--slug <slug> ...]
```

`--file` is the quest-relative issue file declared by the workflow (e.g.
`physicalplan_issues.md`, `slices/0001_api/polishing_issues.md`).

## Agent VM

`vm/agent-macos/` provisions a Tart-based macOS VM with the agent CLIs and
Sheaf system dependencies preinstalled (see `vm/agent-macos/README.md`).

```bash
make -C projects/quest-runner agent-vm-rebuild                      # reprovision golden VM
make -C projects/quest-runner agent-vm-fresh                       # rebuild from upstream base image (slow)
make -C projects/quest-runner agent-vm-run WORKTREE=/abs/worktree  # run a disposable clone with the worktree mounted
projects/quest-runner/vm/agent-macos/bin/agent-clean <vm-name>     # delete a disposable clone
```
