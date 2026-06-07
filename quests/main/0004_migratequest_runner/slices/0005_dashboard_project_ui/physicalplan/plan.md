# Physical Plan: Dashboard Project UI

## Objective

Adapt the migrated dashboard UI to project-local quests, remove service-orchestrator controls, preserve project identity in URLs/actions, add overview run-button behavior, and implement checkout resolution that prefers the deterministic quest worktree when present.

Expected outcome:

- The dashboard lists projects that contain project-local quests.
- It lists and opens only quests from `projects/*/quests/`.
- Top-level legacy `quests/` is hidden.
- Quest detail views include state, active slice state, issue counts, run status, step history, and relevant git metadata.
- Dashboard URLs and API calls include `project`, `quest_type`, and `quest_number`.
- The overview page shows a run button for an open quest that is not currently running; clicking it calls `POST /run_quest`.
- Service pages, service log streaming UI, service restart controls, and MCP configuration UI are removed.
- For existing quests, the UI/data layer prefers the deterministic quest worktree and falls back to the source checkout branch only for read-only discovery and creation flows.

## Key Files And Systems

Likely affected files:

- `projects/quest-runner/src/quest_runner_service/dashboard_assets/index.html`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/app.js`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.mjs`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-pages-utils.mjs`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/styles.css`
- `projects/quest-runner/src/quest_runner_service/dashboard_data.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_git.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_slice.py`
- JS tests migrated from `dashboard-logic.test.mjs` and `dashboard-pages-utils.test.mjs`
- Python dashboard tests covering payload shape and checkout resolution

## Existing APIs To Reuse As-Is

- Reuse the existing dashboard card/overview/detail rendering structure where it still maps to quests.
- Reuse issue count, physical plan response summary, human intervention, slice page, agent log, git commit, and git diff payload logic after project-aware path updates.
- Reuse `ActiveRunTracker` run status and overlay concepts.
- Reuse existing JS test style and helpers.

## APIs To Extend Or Modify

- Replace repository selection state in the UI with project selection state.
- Update all query-string builders/parsers from `repo_path` to `project`.
- Update dashboard payloads to include:
  - `project`
  - `quest_type`
  - `quest_number`
  - `quest_slug`
  - `quest_dir_rel`
  - `checkout_kind`: `worktree` or `source`
  - `checkout_path`
  - `worktree_missing`: boolean where useful
- Add dashboard data helper `resolve_dashboard_checkout(source_repo_root, meta)`:
  - if deterministic worktree exists, use it for quest details, run actions, git metadata, and links
  - otherwise use source checkout for read-only discovery and creation flows
- Update `canonical_quest_dashboard_url` to produce `/dashboard?project=<project>&quest_type=<type>&quest_number=<n>`.
- Add UI action helper for `POST /run_quest` with `project`, `quest_type`, `quest_number`, and optional `max_steps`.

## Implementation Notes

Project listing:

- Scan `projects/*/quests/`.
- Include projects with at least one valid project-local quest.
- Optionally include existing project directories without quests in creation controls if needed for `POST /create_quest`; do not show top-level legacy quests.

Overview run button:

- Visible when the selected quest is open and not currently running.
- Hidden or disabled when quest state is `Completed`, when execution overlay is `running`, when a human intervention/pause state blocks execution, or when the worktree is missing.
- On click, call `POST /run_quest` with project identity and refresh run status/overview after acceptance.
- Display clear API error text for missing worktree or validation failures.

Checkout resolution:

- Dashboard data APIs should perform checkout resolution server-side and return the chosen checkout in payloads.
- Git metadata endpoints should use the worktree path when present.
- If the worktree is missing, overview/detail read APIs may read the source checkout project-local quest directory, but run action must surface the missing worktree error from `/run_quest`.

UI cleanup:

- Remove service lists, service status panels, start/stop/restart controls, log stream links, trace views, and MCP links/assets.
- Keep styling restrained and task-focused; this is an operational dashboard, not a landing page.
- Ensure dashboard text and controls fit on mobile and desktop widths.

## Validation

- JS tests for project identity in dashboard URLs, API request URLs, and run action payloads.
- JS tests for overview run-button visibility across open/running/completed/human-intervention/missing-worktree states.
- JS tests that no service control routes or labels are rendered.
- Python dashboard API tests for project listing, legacy quest exclusion, detail payload project identity, and checkout resolution.
- Tests that git metadata uses the worktree when present and source fallback when missing.
- Manual or browser verification of `/dashboard` after starting the service.
- Run `make -C projects/quest-runner test`.
