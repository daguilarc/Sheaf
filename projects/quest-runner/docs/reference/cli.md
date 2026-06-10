# CLI Reference

Quest Runner provides a repository-root CLI at:

```bash
scripts/quest-runner
```

The root command is a short bash dispatcher that uses the project virtualenv to
run `projects/quest-runner/bin/quest-runner`, which loads
`quest_runner_service.cli` from the project source tree. The CLI wraps the Quest
Runner REST service; it does not edit quest files or git history directly.

Implementation:

- `bin/quest-runner`
- `src/quest_runner_service/cli.py`

The repository-root dispatcher uses `projects/quest-runner/.venv/bin/python`.
Run `make -C projects/quest-runner test` if the virtualenv is missing.

## Service URL Resolution

The CLI sends requests to the first available service URL source in this order:

1. `--base-url <url>`
2. `QUEST_RUNNER_URL`
3. the `quest-runner` entry in repository-root `config/services.json`
4. fallback `http://localhost:9002`

When the `config/services.json` entry uses host `0.0.0.0`, the CLI connects to
`localhost` at the configured port. If discovery falls back to
`http://localhost:9002`, the CLI prints a warning unless `--json` is active.

## Common Options

Global options must appear before the subcommand:

```bash
scripts/quest-runner --json --base-url http://localhost:9002 run ...
```

| Option | Description |
| --- | --- |
| `--base-url <url>` | Override service URL discovery. |
| `--json` | Print formatted response JSON instead of human-readable fields. |
| `help` | Print the top-level help page. |

Most quest commands require:

| Option | Description |
| --- | --- |
| `--project <name>` | Owning Sheaf project under `projects/<project>/`. |
| `--type main|side` | Quest type. |
| `--number <n>` | Zero-based quest number. |
| `--experiment-id <id>` | Experiment id when operating in an experiment worktree. |

`scripts/quest-runner --help`, `scripts/quest-runner help`, and every
subcommand's `--help` print copy-pasteable examples.

## Lifecycle Commands

### `create`

Creates a quest through `POST /create_quest` and prints the quest identity,
quest directory, worktree branch, worktree path, and dashboard URL.

```bash
scripts/quest-runner create \
  --project quest-runner \
  --type side \
  --name "CLI"
```

Options:

| Option | Description |
| --- | --- |
| `--project <name>` | Owning project. |
| `--type main|side` | Quest type. |
| `--name <text>` | Human-readable quest name. |
| `--slug <slug>` | Optional explicit quest slug. |

### `run`

Schedules quest execution through `POST /run_quest`. The service starts a run
from the deterministic quest worktree and returns immediately.

```bash
scripts/quest-runner run \
  --project quest-runner \
  --type side \
  --number 0 \
  --max-steps 25
```

Options:

| Option | Description |
| --- | --- |
| `--max-steps <n>` | Optional maximum runner steps for this run. |
| `--experiment-id <id>` | Experiment id when running in an experiment worktree. |

The human-readable output includes `run_id`, `status`, `quest_url`, and
`status_url`.

```bash
scripts/quest-runner run \
  --project quest-runner \
  --type main \
  --number 0 \
  --experiment-id experiment_quest-runner_main_0_0
```

## Experiment Commands

### `experiments create`

Creates an experiment from an earlier quest step with an alternate transition
config. Commits metadata on the source checkout and creates the experiment
worktree at `<step_commit>^`.

```bash
scripts/quest-runner experiments create \
  --project quest-runner \
  --type main \
  --number 0 \
  --start-step 5 \
  --stop-node slice_completed \
  --notes-file /tmp/experiment-notes.md \
  --config-file /path/to/alternate/workflow
```

Options:

| Option | Description |
| --- | --- |
| `--start-step <n>` | Global step to replay (required). |
| `--stop-node <name>` | Stop condition node or alias such as `slice_completed` (required). |
| `--stop-machine-path <path>` | Optional machine path (default `root/slice`). |
| `--notes-file <path>` | Experiment description and operator notes (required). |
| `--config-file <path>` | Alternate workflow directory containing `workflow.yaml` (required). |

The source checkout must be clean. On success, the CLI prints the experiment id,
experiment number, branch, worktree path, base commit, and dashboard URL when the
service returns one.

The experiment worktree replaces the quest-local `workflow/` directory with the
supplied workflow. The source checkout stores a copy under
`experiments/<number>/workflow/` as the permanent experiment record.

### `experiments land`

Lands a completed experiment by archiving artifacts, pushing the experiment
branch, and removing the local worktree.

```bash
scripts/quest-runner experiments land \
  --project quest-runner \
  --type main \
  --number 0 \
  --experiment-id experiment_quest-runner_main_0_0
```

When `--experiment-id` is passed to `scripts/quest-runner land`, the CLI routes
to `POST /experiments/land` instead of normal quest landing.

The experiment must have reached `ExperimentComplete`. If branch push fails, the
service preserves the local worktree and branch so the operator can fix the
remote or credentials and retry.

## Slice Commands

### `slices init`

Initializes slice scaffolds through `POST /api/slices/init`. Physical planners
use this after deciding the complete ordered slice list and before writing plan
docs.

```bash
scripts/quest-runner slices init \
  --project quest-runner \
  --type side \
  --number 0 \
  --count 3 \
  --slug rest_api \
  --slug cli \
  --slug docs_and_prompts
```

Options:

| Option | Description |
| --- | --- |
| `--count <n>` | Number of slices to create. Must be positive. |
| `--slug <slug>` | Slice slug. Repeat exactly `--count` times, in execution order. |
| `--collection <name>` | Workflow collection to initialize. Optional when there is exactly one collection. |

The service appends after the highest existing slice number, normalizes slugs,
and creates each child directory from the selected workflow collection's
`scaffold` actions. In the default workflow this creates `physicalplan/`,
`state.md`, `state_history.md`, `polishing_issues.md`, and `notes/`. The planner
then writes one or more `.md` files under each created `physicalplan/`
directory.

## Upgrade Commands

### `upgrade`

Upgrades a writable project-local quest from legacy `state_execution_config.yaml`
to a quest-local `workflow/` directory through `POST /upgrade_quest`.

```bash
scripts/quest-runner upgrade \
  --project quest-runner \
  --type side \
  --number 0
```

Options:

| Option | Description |
| --- | --- |
| `--experiment-id <id>` | Experiment id when upgrading an experiment worktree. |

The upgrade copies the packaged default workflow, ports legacy profile
customizations into `workflow/profiles/*.yaml`, merges legacy harness provider
settings into `config/quest-runner.json` when needed, deletes
`state_execution_config.yaml`, and rewrites pre-normalized quest-root
`state.md` to the normalized format. It does not alter issue files, logs,
slice state files, or `thread_registry.json`.

## Operator Commands

`advance` and `land` are human-operated workflows. They are intended for manual
recovery and integration, not for routine agent issue handling.

### `advance`

Runs the same end-of-turn advancement logic used after a role finishes, without
starting a harness turn.

```bash
scripts/quest-runner advance \
  --project quest-runner \
  --type side \
  --number 0
```

Accepts `--experiment-id` for experiment worktrees.

Use `advance` after a quest is stopped and a human has repaired files,
acceptance markers, issue state, or a human-intervention block. The command
calls `POST /advance_quest`. On success it prints the quest state transition,
active slice transition when present, commit hash, and service message.

`advance` can fail when the quest is running, the expected worktree is missing,
the worktree is dirty in a way the runner cannot commit, state files are
malformed, or a human-intervention request still blocks progress.

### `land`

Lands a quest worktree branch onto a target branch through `POST /land`.

```bash
scripts/quest-runner land \
  --project quest-runner \
  --type side \
  --number 0
```

Options:

| Option | Description |
| --- | --- |
| `--target-branch <branch>` | Branch to land onto. Defaults to `main`. |

The service performs a linear git workflow:

1. verify the quest is not running
2. verify the target checkout and quest worktree are clean
3. rebase the quest worktree branch onto the target branch
4. fast-forward the target branch to the rebased quest branch
5. delete the quest worktree checkout
6. delete the local quest branch

On rebase, dirty-worktree, fast-forward, or cleanup failure, the CLI prints the
worktree path and next manual cleanup step when the service returns one.

## Issue Commands

Agents and humans use `scripts/quest-runner issues ...` for quest issue work.
Agents must not edit issue markdown files directly. If the CLI/API is unavailable
or cannot perform the needed issue operation, agents create/update quest-root
`human_intervention_request.md` and stop.

Issue commands take `--file <quest-relative-path>` naming a workflow-declared
issue file. For the default main-quest workflow:

| Issue file | ID prefix |
| --- | --- |
| `physicalplan_issues.md` | `QP-NNNN` |
| `slices/<slice_dir>/polishing_issues.md` | `PL-NNNN` |
| `integration_test_issues.md` | `IT-NNNN` |

### `issues list`

Lists issues as a table.

```bash
scripts/quest-runner issues list \
  --project quest-runner \
  --type side \
  --number 0 \
  --file physicalplan_issues.md \
  --status open \
  --experiment-id experiment_quest-runner_main_0_0
```

Issue commands accept `--experiment-id` for experiment worktrees.

Options:

| Option | Description |
| --- | --- |
| `--file <path>` | Quest-relative issue file declared by the workflow. |
| `--status open|completed|all` | Status filter. Defaults to `all`. |

### `issues read`

Reads one issue and any recorded responses.

```bash
scripts/quest-runner issues read QP-0001 \
  --project quest-runner \
  --type side \
  --number 0 \
  --file physicalplan_issues.md
```

### `issues create`

Creates an issue. The API assigns the next issue ID from the matched workflow
issue declaration. `owner_role` defaults from the workflow declaration unless
`--owner` is supplied.

```bash
scripts/quest-runner issues create \
  --project quest-runner \
  --type side \
  --number 0 \
  --file physicalplan_issues.md \
  --title "Missing acceptance marker" \
  --body "The quest needs physicalplan_accepted.md."
```

Options:

| Option | Description |
| --- | --- |
| `--title <text>` | Required non-empty title. |
| `--body <text>` | Issue body. Mutually exclusive with `--body-file`. |
| `--body-file <path>` | Read issue body from a file. |
| `--status open|completed` | Initial status. Defaults to `open`. |
| `--owner <name>` | Owner role attribution. Defaults from the workflow issue declaration. |

### `issues edit`

Edits issue status, title, or body.

```bash
scripts/quest-runner issues edit QP-0001 \
  --project quest-runner \
  --type side \
  --number 0 \
  --file physicalplan_issues.md \
  --status completed
```

At least one of `--status`, `--title`, `--body`, or `--body-file` is required.
`--body` and `--body-file` are mutually exclusive. Reviewer roles close resolved
issues with `--status completed`; responder roles do not close issues.

### `issues respond`

Appends a responder note without changing issue status.

```bash
scripts/quest-runner issues respond QP-0001 \
  --project quest-runner \
  --type side \
  --number 0 \
  --file physicalplan_issues.md \
  --outcome Fixed \
  --explanation "Created the missing marker."
```

Options:

| Option | Description |
| --- | --- |
| `--outcome Fixed|NotFixed` | Required response outcome. |
| `--explanation <text>` | Response explanation. Mutually exclusive with `--explanation-file`. |
| `--explanation-file <path>` | Read explanation from a file. |

### `issues responses`

Lists responses for one issue.

```bash
scripts/quest-runner issues responses QP-0001 \
  --project quest-runner \
  --type side \
  --number 0 \
  --file physicalplan_issues.md
```

## JSON Output

Use `--json` before the subcommand:

```bash
scripts/quest-runner --json issues list \
  --project quest-runner \
  --type side \
  --number 0 \
  --file slices/0001_api/polishing_issues.md
```

Successful JSON output is the formatted REST response body. HTTP failures print
the HTTP status, endpoint, error message, and response JSON to stderr.
Connection failures print the transport reason, resolved `base_url`, and
endpoint, then exit non-zero.
