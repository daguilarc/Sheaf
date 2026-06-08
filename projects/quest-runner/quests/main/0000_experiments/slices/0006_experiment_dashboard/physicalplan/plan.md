# Experiment Dashboard

## Objective

Expose open and landed experiments in dashboard data APIs and the web UI, including a Land button for completed open experiments.

Expected outcome: operators can see open experiment worktrees alongside main/side quest panes, open an experiment detail view that reads the experiment worktree, inspect landed experiment artifacts from regular quest pages, and land completed experiments through the experiment landing API rather than the normal quest land flow.

## Sequencing

This slice depends on scoped data access from slice 3, completion state from slice 4, and landing API from slice 5.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/dashboard_data.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_slice.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_git.py`
- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/app.js`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.mjs`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-pages-utils.mjs`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/styles.css`
- `projects/quest-runner/tests/test_dashboard_api.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.test.mjs`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-pages-utils.test.mjs`

## Existing APIs To Reuse As-Is

- `dashboard_data.project_snapshot_payload(...)` row-building pattern for main/side quests.
- `quest_overview_payload(...)`, `run_status_payload(...)`, `dashboard_slice` payloads, and `dashboard_git` payloads once called with an experiment checkout.
- Existing dashboard `FetchJson`, `QuestBase()`, navigation state, land-action pending/error UI, and route rendering structure in `app.js`.
- `POST /experiments/land` from slice 5.

## APIs To Add Or Modify

### Dashboard data

Add:

- `open_experiment_summary_rows(source_repo_root, project, lock) -> list[dict]`
- `archived_experiments_payload(source_repo_root, project, quest_type, quest_number) -> dict`
- `experiment_archive_detail_payload(...)` if the UI needs a drilldown.

Open experiment row fields:

- `kind: "experiment"`
- `experiment_id`
- `experiment_number`
- parent `project`, `quest_type`, `quest_number`, and `quest_slug`
- `description`
- `status`
- current `state` from the experiment worktree quest `state.md`
- start step and stop condition
- worktree path and branch name
- `can_land: true` when worktree state is `ExperimentComplete` or metadata status is `experiment_complete`

Archived experiment fields:

- experiment id, number, description, status, start step, stop condition, created/landed timestamps
- copied log summaries from `experiments/<number>/logs/*.jsonl`
- archived issue file list and parsed issue summaries where possible
- archived issue response file list and parsed response summaries where possible
- remote branch link when metadata includes remote branch

Update `project_snapshot_payload(...)` to include an `experiments` list in addition to `main` and `side`. Do not fold experiment rows into `main` or `side`; the UI can display them alongside panes while preserving existing response compatibility.

Update quest overview payload to include `archived_experiments` summary when the source quest has an `experiments/` directory.

### API

Add or extend:

- `/api/dashboard/project_snapshot` includes `experiments`.
- `/api/dashboard/quest_overview` includes landed/archived experiment summary for the parent quest.
- `/api/dashboard/experiments` for full archived experiment details if the overview payload would become too large.

Existing `_quest_context()` from slice 3 already supports `experiment_id`; use it for experiment detail pages and agent logs.

### UI behavior

Update dashboard assets:

- Add an open experiments list visible near the main/side quest panes for the selected project.
- Selecting an open experiment sets URL/query state with the parent quest identity plus `experiment_id`.
- `QuestBase()` includes `experiment_id` when selected so all detail API calls stay scoped.
- Clearly label experiment detail views with experiment id, parent quest, description, start step, stop condition, branch/worktree, and status.
- Show a Land button only when `can_land` is true. The button calls `/experiments/land` with the parent quest identity and experiment id.
- Ensure normal quest Land UI, if present, still calls the existing normal land endpoint and never receives `experiment_id`.
- Add a regular quest overview section for landed experiments and their archived logs/issues/responses.

Keep the UI operational and dense like the existing dashboard. Do not create a landing page or a separate decorative experience.

## Enabling Refactor

If `app.js` assumes only main/side selected rows, add a small selection type field such as `selectedKind: "quest" | "experiment"` rather than overloading quest rows. Keep URL parsing backward-compatible for existing dashboard links.

## Validation Expectations

Add Python tests for:

- Project snapshot includes open experiment rows when experiment worktrees exist.
- Open experiment rows include current state, start step, stop condition, and `can_land`.
- Quest overview includes landed experiment summaries from source archive.
- Archived experiment payload includes log, issue, response, and remote branch metadata.
- Dashboard endpoints with `experiment_id` read detail/log/git data from the experiment worktree.
- The experiment Land API is called by the dashboard endpoint path, not normal `/land`.

Add Node tests for:

- URL state preserves `experiment_id`.
- `QuestBase()` includes `experiment_id` only for experiment selection.
- Open experiment rows render separately from main/side quests.
- Land button renders for completed experiments and posts to `/experiments/land`.
- Normal quest land action still posts to `/land`.
- Archived experiment section renders metadata and artifact links without breaking quests that have no experiments.

Run:

```text
make -C projects/quest-runner test
node --test projects/quest-runner/src/quest_runner_service/dashboard_assets/*.test.mjs
```
