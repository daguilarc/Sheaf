# Capability: Dashboard

ID prefix: `dash`

## Purpose

The dashboard is the human-facing web UI for the Quest Runner service: a
single-page application served at `/dashboard` plus the read-only
`/api/dashboard/*` JSON API that backs it. It lets an operator browse projects
and their quests, inspect quest state, step history, human-intervention
requests, physical-plan and polishing issues, agent step logs, git commits and
diffs, and open or archived experiments — and trigger quest actions (create,
run, advance, land) through the service API.

## Requirements

### Shell and static assets

- **[dash-1]** THE service SHALL serve the dashboard SPA shell (the
  `index.html` in `dashboard_assets/`) at `GET /dashboard`.
- **[dash-2]** THE service SHALL serve files from
  `src/quest_runner_service/dashboard_assets/` at
  `GET /dashboard/assets/<filename>`.
- **[dash-3]** THE service SHALL serve files from the repository's
  `projects/web/src/` directory at `GET /assets/web/<filename>` (shared chat
  assets `agui-chat.js` / `agui-chat.css`).
- **[dash-4]** THE service SHALL send no-cache headers
  (`Cache-Control: no-store, no-cache, must-revalidate, max-age=0`,
  `Pragma: no-cache`, `Expires: 0`) on every response from `dash-1`,
  `dash-2`, and `dash-3`.
- **[dash-5]** THE dashboard shell SHALL read its view selection from URL
  query parameters `project`, `quest_type`, `quest_number`, `experiment_id`,
  `page` (default `overview`), `slice_number`, and `subpage` (default
  `physicalplan`); the server serves the same shell regardless of these
  parameters (all routing is client-side).

### Common quest-scoped query handling

All quest-scoped `/api/dashboard/*` endpoints accept the query parameters
`project`, `quest_type`, `quest_number`, and optional `experiment_id`.

- **[dash-6]** WHEN `project`, `quest_type`, or `quest_number` is missing or
  blank on a quest-scoped endpoint, THE service SHALL return 400 with body
  `{"error": <message>, "fields": {<param>: "required"}}`.
- **[dash-7]** WHEN `quest_type` is not `main` or `side`, or `quest_number` is
  not a non-negative integer, THE service SHALL return 400 with
  `fields` marking the parameter `"invalid"`.
- **[dash-8]** WHEN `project` is not a valid project name, THE service SHALL
  return 400; WHEN `projects/<project>/` does not exist, THE service SHALL
  return 404 `{"error": "Project not found: ..."}`.
- **[dash-9]** IF no quest directory exists for the given
  project/quest_type/quest_number, THEN THE service SHALL return 404
  `{"error": "No quest found for project=... type=... number=..."}`.
- **[dash-10]** WHERE `experiment_id` is supplied (non-blank), THE service
  SHALL resolve quest data from the experiment worktree for that experiment
  instead of the quest worktree; a blank `experiment_id` is treated as absent.
- **[dash-11]** IF a quest `state.md` cannot be parsed while resolving a
  request, THEN THE service SHALL return 422 `{"error": <message>}`.

### Data endpoints

- **[dash-12]** THE service SHALL serve `GET /api/dashboard/projects`
  returning only projects that contain at least one quest under
  `projects/<project>/quests/main/` or `.../side/`, with `default_project` set
  to the first listed project (or `null` when none).
- **[dash-13]** THE service SHALL serve `GET /api/dashboard/project_snapshot?project=`
  returning `main` and `side` quest summary rows sorted by quest number
  descending, plus `experiments` rows for open experiments whose worktree
  still exists, sorted by (quest_type, quest_number, experiment_number)
  descending.
- **[dash-14]** THE service SHALL serve `GET /api/dashboard/quest_overview`
  returning the quest identity, checkout resolution, workflow state, active
  child state, pause/human-intervention status, issue counts, slice
  navigation, step history (at most the 400 most recent entries), and the
  canonical quest dashboard URL (see Contracts).
- **[dash-15]** WHEN `experiment_id` is present on `quest_overview`, THE
  payload SHALL include an `experiment` object (with `can_land`); WHEN absent,
  it SHALL instead include `archived_experiments` listing landed experiments
  sorted by `experiment_number` descending.
- **[dash-16]** THE service SHALL serve `GET /api/dashboard/experiments`
  returning archived-experiment detail (metadata plus archived `logs`,
  `issues`, and `issue_responses` summaries); IF `experiment_id` is missing,
  THEN it SHALL return 400; IF the experiment is unknown, THEN 404.
- **[dash-17]** THE service SHALL serve
  `GET /api/dashboard/physicalplan_issues` returning the parsed issue cards
  from the quest's `physicalplan_issues.md` with open/completed counts,
  latest-update timestamps, and response summaries (explanations previewed to
  500 characters).
- **[dash-18]** THE service SHALL serve
  `GET /api/dashboard/human_intervention` returning
  `{present, markdown, path, updated_at}`; WHEN
  `human_intervention_request.md` is absent, `present` is `false` and
  `markdown`/`updated_at` are `null` (not an error).
- **[dash-19]** THE service SHALL serve `GET /api/dashboard/run_status`
  returning the workflow state, execution overlay status, pause state,
  `latest_heartbeat_at` (max of state timestamps and any active-run
  heartbeat), and `active_run` (`null` when no run is in flight).
- **[dash-20]** THE service SHALL compute `execution_overlay_status` on
  summary, overview, and run-status payloads as: `human_intervention` when
  `human_intervention_request.md` exists or `paused_until.md` is unparseable;
  else `paused` when `paused_until.md` holds a future timestamp; else
  `running` when this quest holds the run lock; else `none`.
- **[dash-21]** THE service SHALL serve `GET /api/dashboard/slice_page`
  with required `slice_number` (non-negative integer) and `subpage`
  (`physicalplan` or `issues`, case-insensitive); invalid values return 400
  with `fields`, and a `slice_number` with no matching slice directory
  returns 404.
- **[dash-22]** THE `slice_page` `physicalplan` subpage SHALL list the `.md`
  files under the slice's `physicalplan/` directory with raw markdown and an
  XSS-safe rendered-HTML version; the `issues` subpage SHALL return the
  slice's `polishing_issues.md` cards plus polishing response summaries.
- **[dash-23]** THE service SHALL serve `GET /api/dashboard/agent_steps`
  returning every quest-local log file matching
  `logs/step_<n>_<role>.jsonl`, sorted by step descending, with
  `default_step` set to the highest step (or `null` when none).
- **[dash-24]** THE service SHALL serve `GET /api/dashboard/agent_log` with
  optional `step`: it returns the raw JSONL text and metadata of the selected
  step log (latest step when `step` is omitted); a negative or non-integer
  `step` returns 400; an unknown step, or a quest with no step logs, returns
  404.
- **[dash-25]** THE service SHALL serve `GET /api/dashboard/git_commits` with
  optional `limit` (default 50, must be a positive integer, clamped to 200)
  and `skip` (default 0, non-negative integer), reading `git log HEAD` of the
  resolved checkout; a repository with no commits returns
  `{"commits": [], ...}` rather than an error.
- **[dash-26]** THE service SHALL serve `GET /api/dashboard/git_diff` with
  required `commit`: without `path` it returns a per-file change summary
  (`hunks_loaded: false`, no hunks); with `path` it returns parsed
  side-by-side diff rows for that one file.
- **[dash-27]** IF `commit` is missing, not a 7–64 character hex string, or
  `path` is not a clean relative path, THEN `git_diff` SHALL return 400; IF
  the commit does not exist or `path` is not part of the commit's diff, THEN
  404.
- **[dash-28]** THE `git_diff` file payload SHALL mark binary files with
  `is_binary: true` and empty `rows`, SHALL truncate diffs at 8000 lines with
  `truncated: true`, and SHALL diff root commits against the empty tree with
  `parent_sha: null`.

### UI behavior

- **[dash-29]** THE dashboard UI SHALL render the pages `overview`, `human`
  (human intervention), `diffs`, `agents` (chat transcript, see
  [chat-stream](chat-stream.md)), `physicalplan`, and per-slice `slice` pages
  with `physicalplan`/`issues` subpages, plus a quest/experiment navigation
  tree built from the project snapshot.
- **[dash-30]** WHILE the browser tab is visible, THE dashboard SHALL poll
  the overview and active page every 5 seconds (`x_POLL_MS`), and refresh
  immediately when the tab becomes visible again; polling is paused while a
  form control is focused and for 8 seconds after user interaction with
  interactive elements.
- **[dash-31]** IF a refresh fails, THEN THE dashboard SHALL keep showing the
  last data with an error banner ("Last refresh failed (showing stale
  data): ...") and continue polling.
- **[dash-32]** THE dashboard SHALL mirror its selection into the URL query
  string (via `history.replaceState`) so views are linkable, persist the
  selected project in `localStorage`, and show a banner when the URL names a
  project that is not listed.
- **[dash-33]** THE dashboard SHALL expose quest actions that call the
  service API: Create Quest (`POST /create_quest`), Run quest
  (`POST /run_quest`), Advance (`POST /advance_quest`), Land quest
  (`POST /land`), and Land experiment (`POST /experiments/land`); action
  buttons are shown/enabled based on overview + run-status (e.g. Run hidden
  while running or when the worktree is missing; Land experiment only when
  the experiment payload reports `can_land`).

## Contracts

All endpoints are `GET` and return `application/json`. Timestamps are UTC ISO
8601 `YYYY-MM-DDTHH:MM:SSZ` strings. Error bodies are
`{"error": <string>}` with an optional `"fields": {<param>: "required"|"invalid"}`
on 400s.

### `GET /api/dashboard/projects`

```json
{"projects": [{"project": "quest-runner"}], "default_project": "quest-runner"}
```

### `GET /api/dashboard/project_snapshot?project=`

```json
{
  "project": "...",
  "main": [<quest row>], "side": [<quest row>],
  "experiments": [<experiment row>]
}
```

Quest row: `project`, `number`, `slug`, `name`, `state`, `workflow_state`
(same value), `is_terminal`, `active_child_number`, `updated_at`,
`execution_overlay_status` (`human_intervention|paused|running|none`),
`paused_until` (ISO or `null`), `has_human_intervention_request`.

Experiment row: `kind: "experiment"`, `experiment_id`, `experiment_number`,
`project`, `quest_type`, `quest_number`, `quest_slug`, `description`,
`status`, `state`, `start_step` (`{global_step, step_commit, base_commit,
role?, step_log?}`), `stop_condition` (`{machine_path, node_name}`),
`worktree_path`, `branch_name`, `can_land`, `execution_overlay_status`,
`updated_at`.

### `GET /api/dashboard/quest_overview?project=&quest_type=&quest_number=[&experiment_id=]`

Top-level fields: `project`, `quest_type`, `quest_number`, `quest_slug`,
`quest_dir_rel`, `checkout_kind`, `checkout_path`, `worktree_missing`,
`quest` (`{project, type, number, slug, name, path}`), `workflow_state`,
`is_terminal`, `active_child_number`, `active_child`
(`{collection, child_id, directory_name, child_number}` or `null`),
`active_child_state` (`{collection, child_id, child_number, state,
updated_at}` or `null`), `updated_at`, `last_transition`, `step_history`,
`has_human_intervention_request`, `has_paused_until`, `paused_until`,
`open_issues_quest_level`, `open_issues_active_child`,
`quest_dashboard_url`, `execution_overlay_status`,
`slices` (`[{slice_number, directory_name}]`).

`step_history` entries (≤ 400, oldest→newest, merged from commit metadata and
legacy `state_history.md`, metadata wins on duplicate commits):
`{source: "metadata"|"legacy", commit, timestamp, previous_state, next_state,
notes, global_step, node_name, role, thread_name, child_chain}`.
`last_transition` repeats the last entry's
`{timestamp, previous_state, next_state, notes, global_step, source,
child_chain}` or is `null`.

With `experiment_id`: adds `experiment_id` and `experiment`
(`{experiment_id, experiment_number, description, status, start_step,
stop_condition, branch_name, worktree_path, can_land, parent_quest:
{project, quest_type, quest_number, quest_slug}}`). `can_land` is true when
the worktree state is the experiment-complete state or the experiment status
is `experiment_complete`. Without `experiment_id`: adds
`archived_experiments` (landed only):
`[{experiment_id, experiment_number, description, status, start_step,
stop_condition, created_at, landed_at, remote_branch?, log_count}]`.

### `GET /api/dashboard/experiments?project=&quest_type=&quest_number=&experiment_id=`

Archived experiment detail: the archived summary fields above plus `project`,
`quest_type`, `quest_number`, `quest_slug`, `branch_name`, `completed_at`,
`remote_branch_url?`, and:

- `logs`: `[{filename, path: "logs/<f>", line_count}]`
- `issues`: `[{path, open_count, completed_count, issues: [<issue card>]}]`
  (or `{path, parse_error: true}`)
- `issue_responses`: `[{path, response_count, responses: [{issue_id,
  response_timestamp, outcome, explanation_preview}]}]` (or `parse_error`)

### `GET /api/dashboard/physicalplan_issues?...`

```json
{
  "issues_path": "physicalplan_issues.md",
  "issues": [<issue card>],
  "open_count": 0, "completed_count": 0,
  "latest_issue_updated_at": null,
  "latest_response_updated_at": null,
  "latest_update_at": null,
  "responses_summary": [{"issue_id": "...", "response_timestamp": "...",
                          "outcome": "...", "explanation_preview": "..."}]
}
```

Issue card: `{issue_id, status, owner_role, created_at, updated_at, title,
details, resolution_notes}`. The issue/response markdown file formats are
shared contracts; see [runtime files](../contracts/runtime-files.md).

### `GET /api/dashboard/human_intervention?...`

`{"present": bool, "markdown": str|null,
"path": "human_intervention_request.md", "updated_at": str|null}` —
`updated_at` is the file's mtime.

### `GET /api/dashboard/run_status?...`

`project`, `quest_type`, `quest_number`, `quest_slug`, `quest_dir_rel`,
`checkout_kind`, `checkout_path`, `worktree_missing`, `workflow_state`,
`is_terminal`, `active_child_number`, `active_child`, `active_child_state`,
`execution_overlay_status`, `paused_until`, `pause_marker_invalid`
(true when `paused_until.md` exists but is unparseable),
`latest_heartbeat_at`, `active_run`
(`{run_id, started_at, last_heartbeat_at}` or `null`), and `experiment_id`
when experiment-scoped.

### `GET /api/dashboard/slice_page?...&slice_number=&subpage=`

```json
{
  "slice": {"slice_number": 1, "directory_name": "slice_0001_..."},
  "slice_state": {"state": "...", "updated_at": "..."},
  "subpage": "physicalplan",
  "payload": { ... }
}
```

`slice_state` is `null` when the slice has no state file. `physicalplan`
payload: `{"files": [{name, relative_path, updated_at, raw_markdown,
rendered_html}]}` (rendered inside `<div class="dashboard-markdown">`).
`issues` payload: `{issues_path, issues: [<issue card>], open_count,
completed_count, latest_issue_updated_at, polishing_issue_responses:
{present, path, latest_response_updated_at, summaries: [...]}}`.

### `GET /api/dashboard/agent_steps?...`

```json
{"default_step": 7,
 "steps": [{"step": 7, "role": "implementer",
            "filename": "step_0007_implementer.jsonl",
            "relative_path": "logs/step_0007_implementer.jsonl",
            "updated_at": "...", "is_current": true}]}
```

### `GET /api/dashboard/agent_log?...[&step=]`

`{"step": n, "role": str, "jsonl_raw": <full file text>,
"metadata": {relative_path, step, filename, role, updated_at},
"log_steps": [<agent_steps step entries>]}`. The JSONL line format is the
harness quest-log event schema; see
[runtime files](../contracts/runtime-files.md) and the repository
[agent harness event schema](../../../../structure/agent-harness-event-schema.md).

### `GET /api/dashboard/git_commits?...[&limit=][&skip=]`

`{"commits": [{sha, title, message, author, committed_at}],
"limit": n, "skip": n, "has_more": bool}` — `has_more` is true when exactly
`limit` commits were returned.

### `GET /api/dashboard/git_diff?...&commit=[&path=]`

Summary (no `path`): `{"commit": {sha, title, message, author, author_email,
committed_at}, "parent_sha": str|null, "files": [{path, path_before,
change_type, is_binary, hunks_loaded: false}], "file_order": [paths],
"detail_path": null}`. `change_type` is the git name-status letter
(`A|M|D|R|C|...`).

File detail (with `path`): `{"commit": {...}, "parent_sha", "path",
"path_before", "change_type", "is_binary", "rows": [<row>],
"truncated": bool, "hunks_loaded": true}`. Rows are one of
`{kind: "hunk_header", text}`,
`{kind: "context"|"removal"|"addition", old: {line_no, text}|null,
new: {line_no, text}|null}`, or `{kind: "other", text}`.

## Design

- Routes live in `src/quest_runner_service/api.py` (`create_app`); the shared
  quest-context parser `_quest_context()` resolves
  project/quest_type/quest_number/experiment_id and the checkout root for
  every quest-scoped endpoint.
- Validation and payload builders: `dashboard_data.py`
  (parsers, `projects_payload`, `project_snapshot_payload`,
  `quest_overview_payload`, `run_status_payload`,
  `experiment_archive_detail_payload`, `execution_overlay_status`,
  `build_quest_step_history`); `dashboard_slice.py` (slice pages, agent step
  logs, the safe markdown renderer `render_dashboard_markdown`);
  `dashboard_git.py` (read-only `git log` / `diff-tree` / `diff` subprocess
  wrappers, 45 s git timeout, commit-metadata scan over the most recent 2500
  commits); `dashboard_runs.py` (`ActiveRunTracker` for `active_run`).
- Errors are raised as `DashboardBadRequest` / `DashboardNotFound` and mapped
  to 400/404 by Flask error handlers in `api.py`; `StateFileParseError` maps
  to 422.
- Checkout resolution prefers the experiment worktree (when `experiment_id`
  is set), then the quest worktree, then falls back to the source checkout
  read-only (`checkout_kind`/`worktree_missing` expose this). Step history
  merges recursive step-commit metadata (parsed from commit messages,
  newest-first `git log`) with legacy `state_history.md` records.
- Frontend: `dashboard_assets/app.js` (ES module, no framework; state object
  + full re-render), pure logic extracted to `dashboard-logic.mjs`
  (`RefreshScheduler`, button predicates, URL/query builders — unit-tested in
  `dashboard-logic.test.mjs`) and `dashboard-pages-utils.mjs` (markdown/diff
  HTML helpers). The shell `index.html` loads `/assets/web/agui-chat.js`
  before `app.js`.
- Tests: `tests/test_dashboard_api.py`, `test_dashboard_shell.py`,
  `test_dashboard_slice.py`, `test_dashboard_git.py`,
  `tests/test_advance_quest_api.py`; frontend logic tests under
  `dashboard_assets/*.test.mjs`.

## Interactions

- [chat-stream](chat-stream.md) — the Agents page mounts the WebSocket chat
  transcript for the selected step log.
- [quest-lifecycle](quest-lifecycle.md) — the UI's create/run/advance/land
  actions call the quest lifecycle endpoints; the run lock and run tracker
  feed `execution_overlay_status` and `active_run`.
- [experiments](experiments.md) — experiment worktree resolution,
  open-experiment rows, archived experiment detail, land-experiment action.
- [slices](slices.md) — slice directories, polishing issues, slice state
  files rendered by `slice_page`.
- [issues](issues.md) — issue file parsing shared with the issues API.
- [agent-harness](agent-harness.md) — produces the
  `logs/step_<n>_<role>.jsonl` files listed by `agent_steps` / `agent_log`.
- [state-machine-engine](state-machine-engine.md) /
  [workflow-config](workflow-config.md) — workflow state, terminal detection,
  and active-child resolution shown on every quest payload.
- [service-lifecycle](service-lifecycle.md) — the Flask app hosting these
  routes.
- Shared file formats: [runtime files](../contracts/runtime-files.md).
