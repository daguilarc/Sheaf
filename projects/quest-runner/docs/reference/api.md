# REST API reference

Quest Runner exposes a Flask REST service on port `9002` by default. The service
provides quest lifecycle endpoints and dashboard read APIs. It does not expose
service registration, service lifecycle, log streaming, database, or MCP routes.

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

**Request body (JSON):**

| Field | Required | Description |
| --- | --- | --- |
| `project` | yes | Owning project |
| `quest_type` | yes | `main` or `side` |
| `quest_number` | yes | Zero-based quest number |
| `max_steps` | no | Maximum runner steps (default `500`) |

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

## Dashboard shell

### `GET /dashboard`

Serves the quest dashboard HTML shell.

### `GET /dashboard/assets/<path>`

Serves static dashboard assets (`app.js`, `styles.css`, ES modules).

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

**Response `200`:** includes `project`, `main`, and `side` arrays. Each quest
row includes `project`, `number`, `slug`, `name`, and state summary fields.

### `GET /api/dashboard/quest_overview`

Quest detail for the overview page. Resolves checkout from the quest worktree
when present, otherwise from the source Sheaf checkout.

Notable response fields:

- `project`, `quest_type`, `quest_number`
- `quest_state`, `active_slice`, issue counts
- `checkout_kind` (`worktree` or `source`)
- `checkout_path`, `worktree_missing`, `quest_dir_rel`
- `execution_overlay_status` (`none`, `running`, `paused`, `human_intervention`)
- `quest_dashboard_url`

### `GET /api/dashboard/run_status`

Active run overlay, lock state, and pause/human-intervention metadata for the
selected quest.

### `GET /api/dashboard/physicalplan_issues`

Physical plan issue list for the quest.

### `GET /api/dashboard/human_intervention`

Human intervention request content when present.

### `GET /api/dashboard/slice_page`

Slice subpage payload. Query parameters: `slice_number`, `subpage` (`physicalplan`,
`polishing`, etc.).

### `GET /api/dashboard/quest_agents`

Agent/thread registry summary for the quest.

### `GET /api/dashboard/agent_log`

Agent step log content. Query parameters: `agent_key`, optional `step`.

### `GET /api/dashboard/git_commits`

Git commit history from the resolved checkout (worktree preferred). Optional
`limit` and `skip`.

### `GET /api/dashboard/git_diff`

Git diff for a commit. Required: `commit`. Optional: `path` for a single-file diff.

## Absent routes

The following Conductor orchestrator routes are intentionally not present and
return `404`:

- `/services`, `/register_service`, `/start_service`, `/stop_service`, `/restart_service`
- `/all_health`, `/logs`, `/trace`, `/mcp`
