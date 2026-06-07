# Dashboard, Prompt, And Documentation Integration

## Objective

Wire the new operator and issue workflows into the dashboard, role prompts, injected runtime context, and project documentation so humans and agents discover and use the CLI/API instead of editing issue schemas directly.

Expected outcome: the dashboard has an `Advance` action, agent-facing instructions point to the issue CLI, full issue schemas are no longer injected as the primary issue workflow contract, and docs describe the new APIs and CLI workflows.

## Sequencing

This slice depends on:

- `0001_manual_advance_api` for the dashboard `Advance` action.
- `0004_cli` for prompt and documentation language that tells agents to use `scripts/quest-runner issues ...`.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/dashboard_assets/app.js`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.mjs`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.test.mjs`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/styles.css`
- `projects/quest-runner/src/quest_runner_service/quest_thread.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner.py`
- `projects/quest-runner/src/quest_runner_service/roles/*.md`
- `projects/quest-runner/src/quest_runner_service/quest_docs/schemas.md`
- `projects/quest-runner/src/quest_runner_service/quest_docs/workflow.md`
- `projects/quest-runner/docs/reference/api.md`
- `projects/quest-runner/docs/how-to/run-service.md`
- `projects/quest-runner/docs/reference/roles.md`
- `projects/quest-runner/docs/reference/dashboard.md`
- `projects/quest-runner/docs/reference/layout.md`
- `projects/quest-runner/docs/reference/runtime-files.md` if present or the nearest existing runtime-file reference doc.
- `projects/quest-runner/tests/test_harness_quest_thread_core.py`
- `projects/quest-runner/tests/test_dashboard_api.py`
- Dashboard JS tests in `dashboard_assets`.

## Existing APIs To Reuse As-Is

- `/advance_quest` from slice `0001_manual_advance_api`.
- Existing dashboard refresh functions: project snapshot, overview, run status, physical plan issues, slice data, git history/diffs.
- Existing UI state conventions for `runActionPending`, `runActionError`, polling, and `RefreshCurrentContent(...)`.
- Existing role prompt loading through `build_role_prompt(...)`.
- Existing runtime context assembly through `build_runtime_context(...)`.

## APIs To Extend Or Modify

### Dashboard advance action

In `dashboard-logic.mjs`:

- Add `BuildAdvanceQuestPayload(project, questType, questNumber)`.
- Add `ShouldShowAdvanceButton(overview, runStatus)`:
  - Return true only when a quest is selected, not completed, not currently running, and not missing its worktree.
  - Unlike the normal run button, allow human-intervention/stopped states because this is a recovery action after manual fix-ups.
  - Return false when `runStatus.active_run` exists or execution overlay is `running`/`paused`.

In `app.js`:

- Add `advanceActionPending` and `advanceActionError` state.
- Add `PostAdvanceQuest()` and `HandleAdvanceQuestClick()` mirroring the run action style but calling `/advance_quest`.
- Render an `Advance` button next to the existing `Run quest` button when `ShouldShowAdvanceButton(...)` is true. Style it as secondary, not primary.
- Disable while pending and hide/disable while active run status says running.
- On success, refresh the same dashboard data that changes after a run starts or finishes: project snapshot, selected overview, run status, current content for the selected page, issue counts, and latest commit/history data.
- On failure, show the returned API error message without losing project/quest selection.
- Add short UI copy near the action that makes clear `Advance` is for manual recovery after fix-ups, not for starting an agent turn.

In `styles.css`:

- Reuse existing button classes where possible.
- Add only minimal spacing/error styles needed for the new secondary action.

### Prompt and injected context

Update agent-facing instructions so issue workflows use the CLI:

- In role files for `physical_planner`, `physical_plan_reviewer`, `polisher`, and `polisher_reviewer`, replace direct issue-file workflow instructions with CLI workflow instructions:
  - Use `scripts/quest-runner issues list/read/create/edit/respond/responses`.
  - Responders use `issues respond` with `Fixed` or `NotFixed`.
  - Reviewers use `issues edit --status completed` to close resolved issues.
  - Responders must not close issues.
  - Direct edits to issue files are allowed only when explicitly instructed by a human or the CLI/API is unavailable.
- Update `quest_runner.build_task_instruction(...)` strings that currently mention direct issue files so they point to the CLI commands.
- Update `quest_thread.build_runtime_context(...)` so it no longer injects the full `schemas.md` as the primary agent-facing issue contract. Replace it with compact runtime context that includes:
  - quest identity and paths as today;
  - a short issue workflow summary pointing to `scripts/quest-runner issues --help`;
  - a pointer to the quest runner reference directory for maintainers/internal storage details.
- Keep `quest_docs/schemas.md` and `quest_docs/schemas/issue-responses.md` in the repository as internal storage references; do not delete them.

### Documentation

Update docs to cover:

- REST API reference for `/advance_quest`, `/land`, and all issue endpoints.
- How-to CLI usage for create, run, advance, land, and issue workflows.
- Runtime/role docs explaining agents normally use the issue CLI.
- Dashboard reference mentioning when `Advance` appears, what it does, and how failures are shown.
- Layout/runtime-file docs clarifying issue files remain storage but agents normally use the CLI.

## Enabling Refactor

If dashboard logic around run/advance visibility starts duplicating too much, keep extraction limited to pure helpers in `dashboard-logic.mjs`. Do not introduce a frontend framework or restructure the dashboard page.

If runtime context tests rely on exact schema injection text, update them to assert the new compact issue CLI guidance and that the full issue schema headings are absent from normal agent-facing context.

## Validation Expectations

Add/extend tests for:

- `BuildAdvanceQuestPayload(...)` returns `project`, `quest_type`, and `quest_number`.
- `ShouldShowAdvanceButton(...)` is true for stopped, incomplete quests with worktrees, including human-intervention recovery state.
- `ShouldShowAdvanceButton(...)` is false for completed quests, active runs, paused/running overlays, missing worktrees, or no selected quest.
- Dashboard action posts to `/advance_quest` and refreshes snapshot/overview/run status/current content on success.
- Dashboard action preserves selection and shows API error text on failure.
- Prompt/context tests confirm issue CLI guidance is present and full issue schemas are not injected as the primary instruction block.
- Role prompt tests or text checks confirm issue roles mention CLI commands and responder/reviewer ownership rules.
- Documentation tests, if any, continue to pass.

Manual smoke after implementation:

```text
scripts/quest-runner --help
scripts/quest-runner advance --project quest-runner --type side --number 0
scripts/quest-runner issues list --project quest-runner --type side --number 0 --scope physicalplan
```

Run:

```text
make -C projects/quest-runner test
```
