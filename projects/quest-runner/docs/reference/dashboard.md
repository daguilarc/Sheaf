# Dashboard

Quest Runner serves its web dashboard at `/dashboard`. The dashboard is a
project-aware control surface for project-local quests discovered under
`projects/*/quests/`.

Implementation files:

- `src/quest_runner_service/dashboard_assets/index.html`
- `src/quest_runner_service/dashboard_assets/app.js`
- `src/quest_runner_service/dashboard_assets/dashboard-logic.mjs`
- `src/quest_runner_service/dashboard_assets/dashboard-pages-utils.mjs`
- `src/quest_runner_service/dashboard_data.py`
- `src/quest_runner_service/dashboard_git.py`
- `src/quest_runner_service/dashboard_slice.py`
- `src/quest_runner_service/dashboard_runs.py`

## Project And Quest Selection

The dashboard loads available projects from `/api/dashboard/projects`. A project
appears only when it contains at least one quest under
`projects/<project>/quests/main/` or `projects/<project>/quests/side/`.

Quest selection and detail URLs include:

- `project`
- `quest_type`
- `quest_number`

This keeps navigation, run actions, git views, and slice views scoped to the
owning Sheaf project. Legacy top-level `quests/` records are not listed.

## Overview Page

The overview page is the primary quest detail view. It shows:

- quest identity and project identity
- quest state and active slice
- physical-plan and polishing issue counts
- human-intervention status
- active run status
- recent step history
- git-backed commit metadata from the resolved checkout

The page shows a **Run quest** control when the selected quest is idle and runnable.
The control calls `POST /run_quest` with project, type, number, and optional step
limit. The run control is hidden or disabled when the quest is already running,
blocked by human intervention, or missing its expected worktree.

The page also shows an **Advance** secondary control when the quest is stopped,
incomplete, and has its worktree. Unlike **Run quest**, **Advance** remains available
during human-intervention recovery states. It is hidden or disabled while the quest is
running, paused, completed, or missing its worktree.

**Advance** calls `POST /advance_quest` with the selected project, type, and number.
On success the dashboard refreshes the project snapshot, quest overview, run status,
current page content, issue counts, and git history views. On failure the API error
message appears on the overview page without clearing the current project or quest
selection. Short copy on the overview page explains that **Advance** is for manual
recovery after fix-ups and does not start an agent turn.

## Checkout Resolution

Dashboard data resolves checkout context with the same worktree convention used
by the runner:

1. Use the deterministic quest worktree when it exists.
2. Fall back to the source Sheaf checkout for read-only discovery when the
   worktree is absent.

Responses expose checkout status through fields such as `checkout_kind`,
`checkout_path`, `worktree_missing`, and `quest_dir_rel`.

Execution never uses the read-only fallback. `POST /run_quest` requires the
expected quest worktree and returns a missing-worktree error when it is absent.

## Slice And Issue Views

Slice pages load through `/api/dashboard/slice_page` and include project
identity in every request. The dashboard can display slice physical plans,
polishing state, issue files, implementation markers, and agent logs for the
selected quest.

Physical-plan and polishing issue views read the quest-local issue files. Issue
completion authority remains with reviewer roles through the runner workflow;
the dashboard is a read/control surface, not a replacement for role ownership
rules.

## Agent Logs

Agent summaries come from `/api/dashboard/quest_agents`. Individual logs load
from `/api/dashboard/agent_log` by agent key and optional step. The log content
is read from quest-local files such as:

```text
<quest_dir>/logs/step_<n>_<role>.jsonl
```

Thread transcripts remain under `<quest_dir>/threads/`.

## Git Views

Commit and diff views use the resolved checkout:

- `/api/dashboard/git_commits`
- `/api/dashboard/git_diff`

For normal executed quests, this is the quest worktree. The source-checkout
fallback is used only for read-only views when no worktree exists.

## Absent Dashboard Surfaces

The dashboard intentionally has no service-management pages, restart controls,
service log streaming, database browser, or MCP configuration. Those surfaces
belong outside Quest Runner.
