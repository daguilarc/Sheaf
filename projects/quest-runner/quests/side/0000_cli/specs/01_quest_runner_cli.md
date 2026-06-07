# Quest Runner CLI And Manual Advancement APIs

## Overview

Build a small Quest Runner CLI that wraps the Quest Runner REST service. Its
operator commands, including manual recovery and landing, are primarily for
human operators who need to inspect, repair, advance, and land quests without
hand-crafting REST payloads. Its issue commands are intentionally for both
agents and humans, so agents can work with quest issues without learning or
editing the underlying markdown schemas.

This quest adds:

- REST APIs for manual quest advancement, landing, and issue operations.
- A CLI command surface that calls those REST APIs.
- A comprehensive CLI help page that is useful to human operators and clear
  enough for agents to follow for issue workflows.
- Prompt and injected-context updates so agents are told to use the CLI for
  issue work instead of reading or writing issue schemas directly.
- A top-level `scripts/` symlink pointing at the CLI implementation.

The CLI should be simple, scriptable, and explicit. It should print useful
human-readable output by default and support JSON output for automation.

## Goals

- Let a human operator manually advance a stopped quest after fix-ups by running
  the same end-of-turn state transition and commit logic the regular runner uses.
- Let agents list, read, create, edit, and respond to quest issues through a
  stable command interface.
- Remove the need to inject detailed issue schemas into role prompts.
- Keep all quest mutation behavior centralized in Quest Runner product code, not
  duplicated in the CLI.
- Make the CLI discoverable from the repository root through `scripts/`.

## Non-Goals

- Do not replace the existing `/create_quest` or `/run_quest` APIs.
- Do not make the CLI directly edit quest state, issue files, response files, or
  git history.
- Do not introduce a separate database or persistent service state for issues.
- Do not expose issue schemas to agents as the primary interface.
- Do not make `advance_quest` run an agent turn. It only performs the same
  checks, commits, and state transition that normally occur after the current
  role turn has already modified files.

## Command Name And Location

Add the Quest Runner CLI inside `projects/quest-runner/`, for example:

```text
projects/quest-runner/bin/quest-runner
```

Add a symlink in the repository-root `scripts/` directory:

```text
scripts/quest-runner -> ../projects/quest-runner/bin/quest-runner
```

The exact implementation language should follow the project convention. A Python
script is acceptable because the service is Python, but the CLI must remain
usable from a checkout without requiring agents to import internal modules.

By default, the CLI should read the repository's `config/services.json`, find the
`quest-runner` service entry, and derive the service URL from that entry's
configured host and port. If the service entry is absent or incomplete, the CLI
may fall back to `http://localhost:9002` with a clear warning.

Allow overriding the discovered service URL with either:

- `--base-url <url>`
- `QUEST_RUNNER_URL`

Command-line `--base-url` wins over the environment variable.

## CLI Help Requirements

The CLI must have a clear help page at:

```text
scripts/quest-runner --help
scripts/quest-runner help
```

Every subcommand must also support `--help`.

The top-level help page must include:

- The service URL discovery behavior, including `config/services.json`, fallback,
  and override mechanisms.
- The required quest identity fields: `project`, `quest_type`, and
  `quest_number`.
- Examples for creating a quest, running a quest, advancing a quest, landing a
  quest worktree, listing issues, reading one issue, creating an issue, editing
  an issue, responding to an issue, and producing JSON output.
- A short note that recovery/advance and landing commands are human-operated
  workflows.
- A short note that agents should use the issue CLI for issue work instead of
  editing issue files directly.

Help text should favor copy-pasteable examples over schema prose.

## Existing Lifecycle Commands

The CLI should wrap the existing lifecycle APIs:

```text
scripts/quest-runner create \
  --project quest-runner \
  --type side \
  --name "CLI"

scripts/quest-runner run \
  --project quest-runner \
  --type side \
  --number 0 \
  --max-steps 25
```

Behavior:

- `create` calls `POST /create_quest`.
- `run` calls `POST /run_quest`.
- `--type` maps to REST `quest_type`.
- `--number` maps to REST `quest_number`.
- Successful commands print the useful URLs and identifiers returned by the API.
- Failed commands print the HTTP status, endpoint, and API error message, then
  exit non-zero.
- `--json` prints the raw response body as formatted JSON.

## Land Quest REST API

Add:

```text
POST /land
```

Request body:

```json
{
  "project": "quest-runner",
  "quest_type": "side",
  "quest_number": 0,
  "target_branch": "main"
}
```

Purpose:

Land a quest worktree branch back onto the repository's main branch using a
classic linear git workflow. This is an operator action for after quest work is
ready to integrate.

Required behavior:

- Default `target_branch` to `main`.
- Resolve the quest's worktree path and worktree branch from quest metadata.
- Fail if the quest is currently running.
- Fail if the target branch checkout is not clean before any rebase or merge
  operation begins.
- Fail if the quest worktree is missing.
- Rebase the quest worktree branch onto the current target branch.
- If the rebase fails or leaves the worktree in a conflicted or dirty state,
  stop and return a clear error. A human or agent may then clean up the worktree
  manually and call `land` again.
- After the worktree branch is cleanly rebased, fast-forward the target branch
  to the rebased worktree branch. Do not create a merge commit.
- If the target branch cannot be fast-forwarded, fail with a clear error and do
  not delete the worktree.
- After the fast-forward succeeds, delete the quest worktree checkout.
- Do not delete the quest branch unless this is explicitly added as a separate
  option. This quest only requires deleting the worktree.
- Return JSON describing each completed step and any remaining manual cleanup
  instructions.

Suggested successful response:

```json
{
  "status": "landed",
  "project": "quest-runner",
  "quest_type": "side",
  "quest_number": 0,
  "target_branch": "main",
  "worktree_branch": "quest/quest-runner_side_0000_cli",
  "rebased": true,
  "fast_forwarded": true,
  "worktree_deleted": true,
  "target_head": "<sha>"
}
```

Suggested failure response when rebase needs manual cleanup:

```json
{
  "status": "rebase_failed",
  "error": "Rebase stopped with conflicts",
  "project": "quest-runner",
  "quest_type": "side",
  "quest_number": 0,
  "worktree_path": "/path/to/.quest-worktrees/quest-runner_side_0000_cli",
  "worktree_branch": "quest/quest-runner_side_0000_cli",
  "next_step": "Resolve conflicts in the quest worktree, leave it clean, then run land again."
}
```

Implementation notes:

- Reuse existing worktree metadata and git helper patterns rather than shelling
  out ad hoc from the Flask route.
- The service should serialize `land` with quest execution using the same lock
  family as `run_quest` and `advance_quest`.
- The endpoint should not run tests itself unless a later option explicitly asks
  for pre-land validation.

## Land Quest CLI Command

Add:

```text
scripts/quest-runner land \
  --project quest-runner \
  --type side \
  --number 0
```

Behavior:

- Calls `POST /land`.
- Supports `--target-branch <branch>`, defaulting to `main`.
- Prints the target branch, worktree branch, rebase result, fast-forward result,
  and worktree deletion result.
- On rebase failure, prints the worktree path and the manual cleanup instruction.
- Exits non-zero on API failure.
- Supports `--json`.
- Help text must explain the linear workflow: clean target branch, rebase the
  worktree branch onto target, fast-forward target to the worktree branch, delete
  the worktree.

## Advance Quest REST API

Add:

```text
POST /advance_quest
```

Request body:

```json
{
  "project": "quest-runner",
  "quest_type": "side",
  "quest_number": 0
}
```

Purpose:

Run the same end-of-turn advancement code the regular runner runs after the
current role finishes. This is for manual recovery: a human operator fixes files
while the quest is stopped, then asks Quest Runner to validate, commit, and move
the quest forward exactly as if the interrupted role turn had ended normally.

Required behavior:

- The endpoint must fail if the quest is currently running.
- The endpoint must acquire the same quest lock used by `run_quest` before
  reading or mutating quest state.
- The endpoint must resolve and operate in the quest worktree, not the source
  checkout fallback.
- Missing worktree behavior should match `/run_quest`: return a clear `409`
  response that includes `project`, `quest_type`, `quest_number`, and
  `expected_worktree`.
- The endpoint must not send a harness prompt or start an agent turn.
- The endpoint must evaluate the current quest/slice state and perform the
  normal post-turn validation, filesystem side effects, state transition, and
  git commit as shared product code.
- If checks fail, return a non-2xx response with an actionable error and do not
  advance state.
- If the working tree is dirty in a way the normal runner would reject, return
  the same failure class the runner would return.
- If the current state is `PrePlanning`, automatically advance to
  `PhysicalPlanning` without requiring the operator to edit `state.md` manually.
- If the current state is `Completed`, return a successful no-op response.
- If a human-intervention request exists, return a conflict-style response and
  do not advance unless the existing runner semantics already permit it.

Suggested successful response:

```json
{
  "status": "advanced",
  "project": "quest-runner",
  "quest_type": "side",
  "quest_number": 0,
  "previous_state": "Implementing",
  "next_state": "PolishingReview",
  "previous_slice_state": "Implementing",
  "next_slice_state": "PolishingReview",
  "commit": "<sha>",
  "message": "Advanced quest side/0000_cli"
}
```

For `PrePlanning`:

```json
{
  "status": "advanced",
  "previous_state": "PrePlanning",
  "next_state": "PhysicalPlanning",
  "commit": "<sha>"
}
```

For completed no-op:

```json
{
  "status": "completed",
  "advanced": false
}
```

### Shared Runner Code

Do not duplicate advancement logic in the Flask route.

Factor out the existing code path used by `execute_v2_top_level_step` or the
runner's transition handling so both `run_quest` and `advance_quest` call the
same implementation for:

- Reading current quest and slice state.
- Checking marker files and issue state.
- Building the transition plan.
- Applying transition filesystem side effects.
- Creating the normal per-step git commit with the usual commit message and
  metadata.
- Returning transition output and commit information.

The extracted function should accept enough context to run without a harness
message. It should not need fake harness operations for the manual advancement
case.

## Advance Quest CLI Command

Add:

```text
scripts/quest-runner advance \
  --project quest-runner \
  --type side \
  --number 0
```

Behavior:

- Calls `POST /advance_quest`.
- Prints previous and next state, active slice information when relevant, and
  the commit SHA when a commit was created.
- Exits non-zero on API failure.
- Supports `--json`.
- Help text must explain that this is intended after manual fix-ups while the
  quest is stopped.

## Advance Quest Dashboard Action

Add an `Advance` button to the Quest Runner web UI near the existing `Run`
button for the selected quest.

Visibility and state:

- Show the button only when the quest is not currently running and is not
  completed.
- Hide or disable the button while a run is active.
- Hide or disable the button for completed quests.
- The button should be visually secondary to `Run`, because it is a manual
  recovery action rather than the normal execution path.

Behavior:

- Clicking the button calls `POST /advance_quest` with the selected `project`,
  `quest_type`, and `quest_number`.
- On success, refresh the same quest dashboard data that changes after a run
  starts or finishes, including state, current slice, issue counts, run status,
  and latest commit/history data.
- On failure, show the returned error message in the dashboard without losing
  the current quest selection.
- The UI should make clear that this is for human-operated manual recovery after
  fix-ups, not for starting an agent turn.

## Issue REST APIs

Add REST APIs for all issue-related actions. These APIs are the supported
interface for agents.

Issue scopes:

- `physicalplan`: quest-level physical plan issues in
  `physicalplan_issues.md`.
- `polishing`: slice-level polishing issues in
  `slices/<slice>/polishing_issues.md`.

Issue response scopes:

- `physicalplan`: quest-level responses in
  `physicalplan_issue_responses.md`.
- `polishing`: slice-level responses in
  `slices/<slice>/polishing_issue_responses.md`.

The API should hide markdown schema details while preserving existing file
storage and ownership rules.

### List Issues

```text
GET /api/issues?project=<project>&quest_type=<type>&quest_number=<n>&scope=<scope>&slice=<slice?>
```

Behavior:

- Returns parsed issues with status, title, body/details, timestamps, and ids.
- `slice` is required for `scope=polishing`.
- Supports optional `status=open|completed|all`; default `all`.
- Returns an empty list when the issue file is absent or contains no issues.

### Read Issue

```text
GET /api/issues/<issue_id>?project=<project>&quest_type=<type>&quest_number=<n>&scope=<scope>&slice=<slice?>
```

Behavior:

- Returns one parsed issue and any matching responses.
- Returns `404` if the issue id does not exist in that scope.

### Create Issue

```text
POST /api/issues
```

Request body:

```json
{
  "project": "quest-runner",
  "quest_type": "side",
  "quest_number": 0,
  "scope": "physicalplan",
  "slice": null,
  "title": "Missing CLI help examples",
  "body": "The plan does not require examples for issue response commands.",
  "status": "open"
}
```

Behavior:

- Creates a new issue id using the existing id style for the scope.
- Defaults `status` to `open`.
- Fails if the role/action is not allowed to create issues for the requested
  scope, if the service can determine that from context.
- Writes the canonical markdown format internally.
- Returns the created issue.

### Edit Issue

```text
PATCH /api/issues/<issue_id>
```

Request body:

```json
{
  "project": "quest-runner",
  "quest_type": "side",
  "quest_number": 0,
  "scope": "physicalplan",
  "slice": null,
  "status": "completed",
  "title": "Updated title",
  "body": "Updated issue details."
}
```

Behavior:

- Supports updating `status`, `title`, and `body`.
- Preserves fields not provided.
- Updates the issue timestamp.
- Fails on invalid status.
- Returns the updated issue.

### Respond To Issue

```text
POST /api/issues/<issue_id>/responses
```

Request body:

```json
{
  "project": "quest-runner",
  "quest_type": "side",
  "quest_number": 0,
  "scope": "physicalplan",
  "slice": null,
  "outcome": "Fixed",
  "explanation": "Added explicit CLI help acceptance criteria."
}
```

Behavior:

- Appends a response to the matching response file.
- `outcome` must be `Fixed` or `NotFixed`.
- `explanation` is required and non-empty.
- Does not change issue status.
- Returns the created response and the issue summary.

### List Responses

```text
GET /api/issues/<issue_id>/responses?project=<project>&quest_type=<type>&quest_number=<n>&scope=<scope>&slice=<slice?>
```

Behavior:

- Returns all responses for the issue id in chronological order.
- Returns an empty list when no responses exist.

### API Safety And Concurrency

Issue mutation endpoints must:

- Validate project, quest type, quest number, scope, slice number, and issue id.
- Operate in the quest worktree when it exists.
- Avoid partial writes; write files atomically or by an existing safe helper.
- Return JSON errors.
- Refuse mutation while the quest is running unless the existing issue workflow
  explicitly needs live mutation. The preferred behavior is `409 Conflict`
  during active runs to avoid racing the agent and runner.

## Issue CLI Commands

Add CLI subcommands:

```text
scripts/quest-runner issues list \
  --project quest-runner --type side --number 0 --scope physicalplan

scripts/quest-runner issues read QP-0001 \
  --project quest-runner --type side --number 0 --scope physicalplan

scripts/quest-runner issues create \
  --project quest-runner --type side --number 0 --scope physicalplan \
  --title "Missing endpoint validation" \
  --body "The plan does not cover invalid scope handling."

scripts/quest-runner issues edit QP-0001 \
  --project quest-runner --type side --number 0 --scope physicalplan \
  --status completed

scripts/quest-runner issues respond QP-0001 \
  --project quest-runner --type side --number 0 --scope physicalplan \
  --outcome Fixed \
  --explanation "Added tests for invalid scope handling."

scripts/quest-runner issues responses QP-0001 \
  --project quest-runner --type side --number 0 --scope physicalplan
```

For polishing issue commands, require `--slice <number>`:

```text
scripts/quest-runner issues list \
  --project quest-runner --type side --number 0 --scope polishing --slice 1
```

CLI behavior:

- Use `--scope physicalplan|polishing`.
- Use `--slice` only for polishing issues.
- Accept `--body-file <path>` and `--explanation-file <path>` for longer text.
- Support `--json` for every issue command.
- Print concise tables or labeled fields by default.
- Exit non-zero for HTTP errors, validation errors, and malformed local
  arguments before making a request.

## Prompt And Injected Context Changes

The system should stop injecting detailed issue schemas as instructions the agent
must learn and manually apply.

Update role prompt/context generation so agents are told:

- Use `scripts/quest-runner issues ...` for listing, reading, creating, editing,
  and responding to issues.
- Do not directly edit `physicalplan_issues.md`,
  `physicalplan_issue_responses.md`, `polishing_issues.md`, or
  `polishing_issue_responses.md` unless explicitly instructed by a human or the
  CLI/API is unavailable.
- Use `scripts/quest-runner issues respond` to record responder notes.
- Reviewers use `scripts/quest-runner issues edit --status completed` to close
  resolved issues.
- Responders must not close issues; they respond with `Fixed` or `NotFixed`.

The injected context may still include a compact issue workflow summary and the
CLI help text or a pointer to the CLI help command. It should not include the
full markdown schema as the primary agent-facing contract.

Keep the schema docs in the repository as the service's internal storage
contract and for maintainers. The change is about what the runner teaches
agents to do.

## Documentation

Update Quest Runner docs:

- REST API reference documents `/advance_quest`, `/land`, and the issue APIs.
- How-to docs show common CLI usage.
- Runtime role docs explain that issue actions go through the CLI.
- Dashboard docs mention the manual `Advance` button and when it is available.
- Layout/runtime-files docs may still document the underlying files, but should
  state that agents normally use the CLI.

## Validation

Automated tests should cover:

- `POST /advance_quest` refuses to run while the quest is active.
- `POST /advance_quest` fails clearly when the quest worktree is missing.
- `POST /advance_quest` advances `PrePlanning` to `PhysicalPlanning`.
- `POST /advance_quest` uses the same transition and commit path as normal
  runner end-of-turn processing.
- `POST /advance_quest` returns validation failures without advancing state.
- `POST /land` refuses to run while the quest is active.
- `POST /land` fails before mutation when the target branch checkout is dirty.
- `POST /land` fails clearly when the quest worktree is missing.
- `POST /land` rebases the quest worktree branch onto `main`.
- `POST /land` returns a manual cleanup error when rebase conflicts or dirty
  worktree state remain.
- `POST /land` fast-forwards `main` to the rebased quest branch and does not
  create a merge commit.
- `POST /land` deletes the quest worktree only after the fast-forward succeeds.
- Issue list/read/create/edit/respond/response-list APIs for physical plan
  issues.
- Issue list/read/create/edit/respond/response-list APIs for polishing issues.
- Polishing issue APIs require `slice`.
- Issue mutation APIs refuse active-running quests.
- CLI commands call the expected endpoints and handle success/error responses.
- CLI `--help` includes examples for lifecycle, advancement, landing, and issue
  commands.
- Dashboard tests or UI smoke coverage verify the `Advance` button appears when
  the quest is stopped and incomplete, is unavailable while running or completed,
  calls `/advance_quest`, refreshes quest data on success, and displays API
  errors.
- Prompt/context tests confirm full issue schemas are no longer injected as the
  agent-facing issue instructions.

Manual smoke:

```text
scripts/quest-runner --help
scripts/quest-runner advance --project quest-runner --type side --number 0
scripts/quest-runner land --project quest-runner --type side --number 0
scripts/quest-runner issues list --project quest-runner --type side --number 0 --scope physicalplan
```

Run the project test suite:

```text
make -C projects/quest-runner test
```

## Acceptance Criteria

- The repository-root `scripts/quest-runner` symlink invokes the Quest Runner CLI.
- The CLI has comprehensive top-level and subcommand help suitable for human
  operators, with issue-command guidance clear enough for agents to use.
- The CLI wraps `create_quest`, `run_quest`, `advance_quest`, `land`, and all
  issue APIs.
- The dashboard shows an `Advance` button next to the run control when the quest
  is stopped and incomplete, and that button calls `/advance_quest`.
- `advance_quest` refuses active-running quests and missing worktrees.
- `advance_quest` performs normal runner end-of-turn checks, commits, and state
  advancement using shared runner code.
- `advance_quest` automatically moves `PrePlanning` to `PhysicalPlanning`.
- `land` performs the linear git workflow: clean target branch check, rebase
  quest worktree branch onto target, fast-forward target, and delete the quest
  worktree after success.
- Issue APIs support listing, reading, creating, editing, responding, and listing
  responses for both physical plan and polishing scopes.
- Agents are instructed to use the CLI for issue actions instead of learning or
  applying issue-file schemas directly.
- Existing issue files remain the storage format and dashboard readers continue
  to work.
