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

The human-readable output includes `run_id`, `status`, `quest_url`, and
`status_url`.

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

The service appends after the highest existing slice number, normalizes slugs,
and creates each slice directory with `physicalplan/`, `state.md`,
`state_history.md`, and `polishing_issues.md`. The planner then writes one or
more `.md` files under each created `physicalplan/` directory.

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
Agents should not edit issue markdown files directly when the CLI/API is
available.

Issue scopes:

| Scope | Files | Slice option |
| --- | --- | --- |
| `physicalplan` | Quest-level physical plan issues and responses | `--slice` is not allowed |
| `polishing` | Slice-level polishing issues and responses | `--slice <n>` is required |

Physical-plan issue IDs use `QP-NNNN`; polishing issue IDs use `PL-NNNN`.

### `issues list`

Lists issues as a table.

```bash
scripts/quest-runner issues list \
  --project quest-runner \
  --type side \
  --number 0 \
  --scope physicalplan \
  --status open
```

Options:

| Option | Description |
| --- | --- |
| `--scope physicalplan|polishing` | Issue scope. |
| `--slice <n>` | Required for polishing scope. |
| `--status open|completed|all` | Status filter. Defaults to `all`. |

### `issues read`

Reads one issue and any recorded responses.

```bash
scripts/quest-runner issues read QP-0001 \
  --project quest-runner \
  --type side \
  --number 0 \
  --scope physicalplan
```

### `issues create`

Creates an issue. The API assigns the next issue ID and owner role for the
scope.

```bash
scripts/quest-runner issues create \
  --project quest-runner \
  --type side \
  --number 0 \
  --scope physicalplan \
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

### `issues edit`

Edits issue status, title, or body.

```bash
scripts/quest-runner issues edit QP-0001 \
  --project quest-runner \
  --type side \
  --number 0 \
  --scope physicalplan \
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
  --scope physicalplan \
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
  --scope physicalplan
```

## JSON Output

Use `--json` before the subcommand:

```bash
scripts/quest-runner --json issues list \
  --project quest-runner \
  --type side \
  --number 0 \
  --scope polishing \
  --slice 1
```

Successful JSON output is the formatted REST response body. HTTP failures print
the HTTP status, endpoint, error message, and response JSON to stderr.
Connection failures print the transport reason, resolved `base_url`, and
endpoint, then exit non-zero.
