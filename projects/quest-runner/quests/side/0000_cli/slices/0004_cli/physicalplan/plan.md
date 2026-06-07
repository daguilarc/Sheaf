# Quest Runner CLI

## Objective

Add a scriptable Quest Runner CLI and repository-root `scripts/quest-runner` symlink that wrap lifecycle, manual advancement, landing, and issue REST APIs with clear human-readable output and `--json` automation output.

Expected outcome: operators and agents can use `scripts/quest-runner` for all specified commands without hand-crafting REST payloads or editing issue markdown.

## Sequencing

This slice depends on:

- `0001_manual_advance_api` for `/advance_quest`.
- `0002_land_api` for `/land`.
- `0003_issue_api` for `/api/issues`.

## Key Files And Systems

- New executable: `projects/quest-runner/bin/quest-runner`
- New CLI module: `projects/quest-runner/src/quest_runner_service/cli.py`
- New symlink: `scripts/quest-runner -> ../projects/quest-runner/bin/quest-runner`
- `config/services.json`
- `projects/quest-runner/Makefile`
- New tests, for example `projects/quest-runner/tests/test_cli.py`

## Existing APIs To Reuse As-Is

- REST endpoints from previous slices.
- `config/services.json` service entry named `quest-runner`.
- Python standard library `argparse`, `json`, `os`, `pathlib`, `sys`, and `urllib.request`.

## APIs To Extend Or Modify

### CLI implementation

Implement the CLI in Python. Keep the executable usable from a checkout:

- `projects/quest-runner/bin/quest-runner` should have a shebang and be executable.
- The bin script may add `projects/quest-runner/src` to `sys.path` and call `quest_runner_service.cli.main(...)`.
- The CLI module should avoid importing service internals for behavior; it should build HTTP requests and format responses.

Service URL resolution:

- Global `--base-url <url>` wins.
- `QUEST_RUNNER_URL` wins over config fallback.
- Otherwise, walk upward from the script/repo location to find `config/services.json`, read service `name == "quest-runner"`, and build `http://<host>:<port>`.
- Treat `0.0.0.0` as `localhost` for a client URL.
- If the service entry is absent or incomplete, fall back to `http://localhost:9002` and print a clear warning to stderr unless `--json` is active.

HTTP behavior:

- Send JSON request bodies.
- On success, parse JSON.
- On HTTP error, print status, endpoint, and API error message; exit non-zero.
- On connection/transport errors, print the target base URL and endpoint; exit non-zero.
- `--json` on every command prints formatted raw JSON response and suppresses human-readable warnings where possible.

### Commands

Top-level:

- `scripts/quest-runner --help`
- `scripts/quest-runner help`

Lifecycle:

- `create --project <project> --type <main|side> --name <name> [--slug <slug>]`
  - Calls `POST /create_quest`.
  - Maps `--type` to `quest_type`.
  - Prints useful identifiers, quest directory, worktree branch/path, and dashboard URL if present.
- `run --project <project> --type <main|side> --number <n> [--max-steps <n>]`
  - Calls `POST /run_quest`.
  - Maps `--number` to `quest_number`.
  - Prints run id/status, quest URL, and status URL.

Manual operations:

- `advance --project <project> --type <main|side> --number <n>`
  - Calls `POST /advance_quest`.
  - Prints previous/next quest state, active slice and slice state transition when present, and commit SHA when present.
- `land --project <project> --type <main|side> --number <n> [--target-branch <branch>]`
  - Calls `POST /land`, defaulting target branch to `main`.
  - Prints target branch, worktree branch, rebase result, fast-forward result, worktree deletion result, and target head.
  - On rebase/manual cleanup failure, prints worktree path and next step.

Issue commands:

- `issues list --project ... --type ... --number ... --scope physicalplan [--status open|completed|all]`
- `issues list --project ... --type ... --number ... --scope polishing --slice <number> [--status ...]`
- `issues read <issue_id> ...`
- `issues create ... --title <title> (--body <text> | --body-file <path>)`
- `issues edit <issue_id> ... [--status open|completed] [--title <title>] [--body <text> | --body-file <path>]`
- `issues respond <issue_id> ... --outcome Fixed|NotFixed (--explanation <text> | --explanation-file <path>)`
- `issues responses <issue_id> ...`

Issue CLI validation:

- `--scope` is required and must be `physicalplan` or `polishing`.
- `--slice` is required for `polishing` and rejected for `physicalplan`.
- `--body` and `--body-file` are mutually exclusive.
- `--explanation` and `--explanation-file` are mutually exclusive.
- Malformed local arguments fail before making HTTP requests.

Default output:

- Use concise labeled fields for read/create/edit/respond/advance/land.
- Use concise tables for issue lists and response lists.
- Keep output plain text and stable enough for humans to scan.

### Help text

The top-level help must include:

- Service URL discovery via `config/services.json`, fallback, `QUEST_RUNNER_URL`, and `--base-url`.
- Required quest identity fields: `project`, `quest_type`/`--type`, and `quest_number`/`--number`.
- Copy-pasteable examples for create, run, advance, land, issue list, issue read, issue create, issue edit, issue respond, and JSON output.
- Note that advance/recovery and landing are human-operated workflows.
- Note that agents should use `scripts/quest-runner issues ...` instead of editing issue files directly.

Every subcommand must support `--help`.

## Enabling Refactor

Add `tests.test_cli` to `projects/quest-runner/Makefile` test modules. Structure the CLI module so tests can inject a fake HTTP transport and inspect requested endpoint/payload without starting the Flask service for every formatting case.

## Validation Expectations

Add tests for:

- URL discovery precedence: `--base-url`, `QUEST_RUNNER_URL`, `config/services.json`, fallback.
- `0.0.0.0` service host becomes `localhost`.
- Top-level `--help` and `help` include required examples and notes.
- Each subcommand accepts `--help`.
- `create`, `run`, `advance`, `land`, and all issue commands call the expected endpoint with the expected method and payload/query params.
- `--json` prints formatted raw JSON.
- HTTP failures exit non-zero and include status, endpoint, and API error.
- Local validation rejects polishing commands without `--slice`, physicalplan commands with `--slice`, bad scope, bad status, bad outcome, and conflicting `--body`/`--body-file` or `--explanation`/`--explanation-file`.
- The root `scripts/quest-runner` symlink resolves to the bin script.

Manual smoke after implementation:

```text
scripts/quest-runner --help
scripts/quest-runner help
scripts/quest-runner issues list --project quest-runner --type side --number 0 --scope physicalplan
```

Run:

```text
make -C projects/quest-runner test
```
