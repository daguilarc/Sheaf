# API Reference

Quest Runner exposes a Flask service on port `9002` by default. The service
provides quest lifecycle REST endpoints, dashboard read APIs, and a dashboard
WebSocket stream for agent chat transcripts. It does not expose service
registration, service lifecycle, service log streaming, database, or MCP routes.

Implementation: `src/quest_runner_service/api.py`.

## Service endpoints

### `GET /health`

Returns the standard Sheaf service health shape.

**Response `200`:**

```json
{
  "healthy": true,
  "uptime": 123.45
}
```

- `healthy` is always `true` when the process is running.
- `uptime` is seconds since service startup.

There is no `service_count` or other orchestrator-specific field.

### `POST /exit`

Exits the service cleanly. Registered services in `config/services.json` must
expose this endpoint.

**Response `200`:**

```json
{
  "status": "exiting"
}
```

## Quest lifecycle endpoints

Both quest endpoints require a `project` field identifying the owning Sheaf
project under `projects/<project>/`.

### `POST /create_quest`

Creates a quest under `projects/<project>/quests/`, commits the scaffold on the
currently checked-out branch in the source Sheaf repository, and immediately
creates the matching quest worktree.

**Request body (JSON):**

| Field | Required | Description |
| --- | --- | --- |
| `project` | yes | Sheaf project name (directory under `projects/`) |
| `quest_type` | yes | `main` or `side` |
| `name` | yes | Human-readable quest name; slug is derived unless overridden |
| `slug` | no | Explicit slug override |
| `requested_by` | no | Stored in `meta.json` as `created_by` |

**Response `201`:**

```json
{
  "project": "example",
  "quest_type": "main",
  "quest_number": 0,
  "quest_slug": "my_quest",
  "quest_dir": "/path/to/projects/example/quests/main/0000_my_quest",
  "state": "PrePlanning",
  "created_files": ["state.md", "..."],
  "worktree_name": "example_main_0000_my_quest",
  "worktree_branch": "quest/example_main_0000_my_quest",
  "worktree_path": "/path/to/.quest-worktrees/example_main_0000_my_quest",
  "quest_create_commit": "<sha>"
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Missing required fields, invalid project, invalid input |
| `404` | Source repository path not found |
| `422` | Source checkout is not a git repository |
| `500` | Worktree creation failed after scaffold commit |

Creation refuses detached HEAD or dirty source checkouts.

### `POST /run_quest`

Schedules quest execution from the quest worktree. The expected worktree must
exist; `run_quest` does not recreate missing worktrees.

When `experiment_id` is set, execution uses the experiment worktree for the
parent quest. The experiment must belong to the supplied quest identity.

**Request body (JSON):**

| Field | Required | Description |
| --- | --- | --- |
| `project` | yes | Owning project |
| `quest_type` | yes | `main` or `side` |
| `quest_number` | yes | Zero-based quest number |
| `max_steps` | no | Maximum runner steps (default `500`) |
| `experiment_id` | no | Experiment id when running in an experiment worktree |

**Response `202`:**

```json
{
  "run_id": "<uuid>",
  "status": "running",
  "quest_url": "http://localhost:9002/dashboard?project=example&quest_type=main&quest_number=0",
  "status_url": "http://localhost:9002/api/dashboard/run_status?project=example&quest_type=main&quest_number=0"
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Missing fields or invalid `max_steps` |
| `404` | Quest not found under the project |
| `409` | Expected quest worktree missing, or lock contention |
| `422` | Malformed quest `state.md` |
| `500` | Fatal invariant failure |
| `503` | Harness not available |

**Missing worktree response `409`:**

```json
{
  "error": "...",
  "project": "example",
  "quest_type": "main",
  "quest_number": 0,
  "expected_worktree": "/path/to/.quest-worktrees/example_main_0000_my_quest"
}
```

### `POST /advance_quest`

Runs the same end-of-turn advancement logic the runner uses after a role finishes,
without starting a harness turn. Intended for manual recovery after a human fixes
files while the quest is stopped. The dashboard and CLI expose this as an
operator workflow; agents do not use it for normal issue handling.

Accepts optional `experiment_id` to advance an experiment worktree.

**Request body (JSON):**

| Field | Required | Description |
| --- | --- | --- |
| `project` | yes | Owning project |
| `quest_type` | yes | `main` or `side` |
| `quest_number` | yes | Zero-based quest number |
| `experiment_id` | no | Experiment id when advancing in an experiment worktree |

**Response `200` (advanced):**

```json
{
  "status": "advanced",
  "project": "example",
  "quest_type": "main",
  "quest_number": 0,
  "previous_state": "Implementing",
  "next_state": "PolishingReview",
  "active_slice": "0001_example_slice",
  "previous_slice_state": "Implementing",
  "next_slice_state": "PolishingReview",
  "commit": "<sha>",
  "message": "Advanced quest main/0000_my_quest"
}
```

**Response `200` (completed no-op):**

```json
{
  "status": "completed",
  "advanced": false
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Missing required fields |
| `404` | Quest not found |
| `409` | Quest is running, lock contention, or expected worktree missing |
| `422` | Validation failure, dirty tree, or human-intervention block |

### `POST /land`

Lands a quest worktree branch onto the repository target branch using a linear git
workflow: rebase the quest branch onto target, fast-forward target, delete the
worktree, then delete the quest branch.

**Request body (JSON):**

| Field | Required | Description |
| --- | --- | --- |
| `project` | yes | Owning project |
| `quest_type` | yes | `main` or `side` |
| `quest_number` | yes | Zero-based quest number |
| `target_branch` | no | Target branch (default `main`) |

**Response `200` (landed):**

```json
{
  "status": "landed",
  "project": "example",
  "quest_type": "main",
  "quest_number": 0,
  "target_branch": "main",
  "worktree_branch": "quest/example_main_0000_my_quest",
  "rebased": true,
  "fast_forwarded": true,
  "worktree_deleted": true,
  "branch_deleted": true,
  "target_head": "<sha>"
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Missing required fields |
| `404` | Quest not found |
| `409` | Quest is running, lock contention, missing worktree, dirty target branch, rebase conflict, fast-forward failure, or branch deletion failure |

Conflict responses include a `status` field such as `target_dirty`,
`worktree_dirty`, `rebase_failed`, `fast_forward_failed`, or
`branch_delete_failed`. Failures that need manual cleanup include the
`worktree_path` and a `next_step` message when available. The service keeps the
worktree checkout when landing does not finish before worktree deletion.

`POST /land` does not accept `experiment_id`. Use `POST /experiments/land` for
experiment landing.

## Experiment endpoints

### `POST /experiments/create`

Creates experiment metadata on the source checkout, commits it, creates an
experiment branch at the parent of the selected start-step commit, and adds an
experiment worktree with the supplied transition config.

**Request body (JSON):**

| Field | Required | Description |
| --- | --- | --- |
| `project` | yes | Owning project |
| `quest_type` | yes | `main` or `side` |
| `quest_number` | yes | Zero-based quest number |
| `start_step` | yes | Global step number to replay from |
| `stop_node` | yes | Stop condition node name or alias (for example `slice_completed`) |
| `stop_machine_path` | no | Machine path for stop condition (default `root/slice`) |
| `notes` | yes | Human-readable experiment description |
| `workflow_path` | yes | Absolute or repo-relative path to alternate workflow directory |
| `requested_by` | no | Stored as `created_by` in metadata |

**Response `201`:**

```json
{
  "experiment_id": "experiment_quest-runner_main_0_0",
  "experiment_number": 0,
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 0,
  "worktree_path": "/path/to/.quest-worktrees/experiment_quest-runner_main_0_0",
  "branch_name": "experiment/quest-runner/main/0000/0000",
  "base_commit": "<parent-of-selected-step>",
  "start_step": {
    "global_step": 5,
    "role": "implementer",
    "step_log": "logs/step_0005_implementer.jsonl",
    "step_commit": "<selected-step-commit>",
    "base_commit": "<parent-of-selected-step>"
  },
  "stop_condition": {
    "machine_path": "root/slice",
    "node_name": "Completed"
  },
  "metadata_commit": "<source-checkout-commit>",
  "dashboard_url": "http://localhost:9002/dashboard?project=quest-runner&quest_type=main&quest_number=0"
}
```

The dashboard URL points at the parent quest. Select the open experiment row, or
add `experiment_id=<id>` to the query string, to view the experiment worktree.

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Invalid input, unknown start step, unknown stop node, detached source checkout, or dirty source checkout |
| `404` | Quest not found |
| `422` | Source checkout is not a git repository |
| `500` | Metadata committed but worktree creation failed (response includes recovery fields) |

### `POST /experiments/land`

Archives experiment artifacts to the source checkout, pushes the experiment
branch, removes the local worktree and branch, and commits landed metadata.

**Request body (JSON):**

| Field | Required | Description |
| --- | --- | --- |
| `project` | yes | Owning project |
| `quest_type` | yes | `main` or `side` |
| `quest_number` | yes | Zero-based quest number |
| `experiment_id` | yes | Experiment id to land |

**Response `200`:**

```json
{
  "status": "landed",
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 0,
  "experiment_id": "experiment_quest-runner_main_0_0",
  "experiment_number": 0,
  "logs_copied": 3,
  "issues_copied": 2,
  "issue_responses_copied": 2,
  "skipped_missing": 0,
  "remote_branch": "experiment/quest-runner/main/0000/0000",
  "worktree_deleted": true,
  "branch_deleted": true,
  "landed_at": "2026-06-08T00:00:00Z",
  "dashboard_url": "http://localhost:9002/dashboard?project=quest-runner&quest_type=main&quest_number=0"
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Invalid input or experiment/quest identity mismatch |
| `404` | Experiment not found |
| `409` | Source checkout dirty, lock contention, worktree missing, not `ExperimentComplete`, metadata not `experiment_complete`, push failed, archive copy failed, worktree deletion failed, or branch deletion failed |

Landing conflict responses include a `status` field such as `target_dirty`,
`worktree_missing`, `not_complete`, `artifact_copy_failed`, `push_failed`,
`worktree_delete_failed`, or `branch_delete_failed`. Push failures preserve the
local experiment worktree and branch for retry.

## Slice APIs

### `POST /api/slices/init`

Initializes new slice directories for an existing quest. The service writes to
the quest worktree when it exists, matching dashboard and issue API behavior.

**Request body (JSON):**

| Field | Required | Description |
| --- | --- | --- |
| `project` | yes | Owning project |
| `quest_type` | yes | `main` or `side` |
| `quest_number` | yes | Zero-based quest number |
| `count` | yes | Number of slices to create |
| `slugs` | yes | Array of exactly `count` slice slugs, in execution order |
| `experiment_id` | no | Experiment id when initializing slices in an experiment worktree |

**Response `201`:**

```json
{
  "project": "example",
  "quest_type": "main",
  "quest_number": 0,
  "quest_slug": "my_quest",
  "quest_dir": "/path/to/projects/example/quests/main/0000_my_quest",
  "checkout_kind": "worktree",
  "checkout_path": "/path/to/.quest-worktrees/example_main_0000_my_quest",
  "created_slices": [
    {
      "slice_number": 1,
      "slice_slug": "rest_api",
      "directory_name": "0001_rest_api",
      "slice_dir": "/path/to/.../slices/0001_rest_api",
      "created_files": [
        "physicalplan",
        "state.md",
        "state_history.md",
        "polishing_issues.md"
      ]
    }
  ]
}
```

Slice numbers append after the highest existing slice number. Slugs are
normalized with the same rules as quest slugs and must be unique after
normalization.

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Missing fields, invalid count, invalid quest identity, or invalid slugs |
| `404` | Quest not found |
| `409` | Quest lock contention or target slice directory conflict |

## Issue APIs

Issue endpoints are the supported interface for agents and automation. They read and
write the same markdown issue files the runner uses internally.

Each request names a workflow-declared issue file with `issue_file` (quest-relative
path). For the default main-quest workflow, examples include
`physicalplan_issues.md` and `slices/<slice_dir>/polishing_issues.md`.

### `GET /api/issues`

List issues.

Query parameters: `project`, `quest_type`, `quest_number`, `issue_file`, optional
`status` (`open`, `completed`, or `all`; default `all`), optional `experiment_id`.

**Response `200`:**

```json
{
  "issues": [
    {
      "issue_id": "QP-0001",
      "status": "open",
      "owner_role": "physical_plan_reviewer",
      "created_at": "2026-01-01T00:00:00Z",
      "updated_at": "2026-01-01T00:00:00Z",
      "title": "Missing acceptance marker",
      "body": "Details",
      "details": "Details",
      "resolution_notes": "none"
    }
  ]
}
```

### `GET /api/issues/<issue_id>`

Read one issue and any matching responses. Same query parameters as list.

Physical-plan issue IDs use `QP-NNNN`; polishing issue IDs use `PL-NNNN`.

### `POST /api/issues`

Create an issue.

**Request body (JSON):** `project`, `quest_type`, `quest_number`, `issue_file`,
`title`, `body` (or `details`), optional `status` (default `open`), optional
`experiment_id`.

### `PATCH /api/issues/<issue_id>`

Edit an issue. Supports `status`, `title`, and `body` (or `details`). Reviewers close
issues with `status: completed`.

### `POST /api/issues/<issue_id>/responses`

Append a responder note. Requires `outcome` (`Fixed` or `NotFixed`) and non-empty
`explanation`. Does not change issue status.

### `GET /api/issues/<issue_id>/responses`

List responses for an issue in chronological order.

Issue mutation endpoints serialize with quest execution and return
`409 Conflict` while the quest is actively running.

The issue CLI is the supported operator and agent interface for these endpoints;
see [CLI reference](cli.md).

## Dashboard shell

### `GET /dashboard`

Serves the quest dashboard HTML shell.

### `GET /dashboard/assets/<path>`

Serves static dashboard assets (`app.js`, `styles.css`, ES modules).

### `GET /assets/web/<path>`

Serves shared browser assets from `projects/web/src/`, including
`agui-chat.js` and `agui-chat.css`.

## Dashboard read APIs

All dashboard APIs that address a specific quest require query parameters
`project`, `quest_type`, and `quest_number` unless noted otherwise.

### `GET /api/dashboard/projects`

Lists projects that contain at least one project-local quest.

**Response `200`:**

```json
{
  "projects": [
    {
      "project": "example",
      "main_count": 1,
      "side_count": 0
    }
  ],
  "default_project": "example"
}
```

Legacy top-level `quests/` records are not included.

### `GET /api/dashboard/project_snapshot?project=<name>`

Returns quest rows grouped by type for one project.

**Response `200`:** includes `project`, `main`, `side`, and `experiments` arrays.
Each quest row includes `project`, `number`, `slug`, `name`, and state summary
fields. Open experiment rows use `kind: experiment` and include `experiment_id`,
parent quest identity, `start_step`, `stop_condition`, `can_land`, `worktree_path`,
and `branch_name`.

### `GET /api/dashboard/quest_overview`

Quest detail for the overview page. Resolves checkout from the quest worktree
when present, otherwise from the source Sheaf checkout. Pass optional
`experiment_id` to view an open experiment worktree (`checkout_kind: experiment`).

Notable response fields:

- `project`, `quest_type`, `quest_number`
- `quest_state`, `active_slice`, issue counts
- `checkout_kind` (`worktree`, `source`, or `experiment`)
- `checkout_path`, `worktree_missing`, `quest_dir_rel`
- `execution_overlay_status` (`none`, `running`, `paused`, `human_intervention`)
- `quest_dashboard_url`
- `experiment` — present when `experiment_id` is set; includes `can_land` for
  `ExperimentComplete` experiments
- `archived_experiments` — landed experiments from `experiments/` on the source
  checkout (omitted when empty)

### `GET /api/dashboard/experiments`

Archived experiment detail for a landed experiment. Requires `project`,
`quest_type`, `quest_number`, and `experiment_id`. Returns metadata, archived
logs, issues, issue responses, and `remote_branch` when recorded.

### `GET /api/dashboard/run_status`

Active run overlay, lock state, and pause/human-intervention metadata for the
selected quest.

### `GET /api/dashboard/physicalplan_issues`

Physical plan issue list for the quest.

### `GET /api/dashboard/human_intervention`

Human intervention request content when present.

### `GET /api/dashboard/slice_page`

Slice subpage payload. Query parameters: `slice_number`, `subpage`
(`physicalplan` or `issues`).

### `GET /api/dashboard/agent_steps`

All agent step log artifacts for the quest, discovered from
`logs/step_<n>_<role>.jsonl`. The response includes `default_step` and `steps`
with step number, role, filename, relative path, updated timestamp, and current
selection marker.

### `GET /api/dashboard/agent_log`

Agent step log metadata and raw content. Query parameters: optional `step`.
When omitted, Quest Runner selects the newest available step log.

The dashboard uses this endpoint to populate the selected step, all-step
selector, and log metadata before opening the WebSocket transcript stream.

### `GET /api/dashboard/git_commits`

Git commit history from the resolved checkout (worktree preferred). Optional
`limit` and `skip`.

### `GET /api/dashboard/git_diff`

Git diff for a commit. Required: `commit`. Optional: `path` for a single-file diff.

## Dashboard WebSocket APIs

### `WS /api/dashboard/agent_log/stream`

Streams AGUI events for one agent step log. Query parameters are the same quest
identity parameters used by the dashboard read APIs, plus:

| Parameter | Required | Description |
| --- | --- | --- |
| `step` | no | Step number to stream; defaults to the newest available step log |

On connection, Quest Runner resolves the selected quest and JSONL log file,
subscribes to the in-process chat event bus for that file, replays existing log
events through `QuestLogToAguiMapper`, then continues streaming live events that
the harness publishes as it writes new JSONL lines.

Server messages are JSON objects:

| Message | Description |
| --- | --- |
| `{"type": "events", "events": [...]}` | Batch of AGUI events. Replay batches contain up to 100 events. Live batches contain the events produced by one source log event. |
| `{"type": "caught_up"}` | Historical replay is complete and subsequent `events` messages are live. |
| `{"type": "error", "message": "..."}` | Setup, JSONL parse, or stream error. |

The client does not send application messages after connecting. Invalid quest
parameters, unknown steps, and missing logs are reported as `error` messages on
the WebSocket.

## Absent routes

The following Conductor orchestrator routes are intentionally not present and
return `404`:

- `/services`, `/register_service`, `/start_service`, `/stop_service`, `/restart_service`
- `/all_health`, `/logs`, `/trace`, `/mcp`
