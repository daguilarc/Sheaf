# Experiment Docs Validation

## Objective

Finish documentation, recovery guidance, integration coverage, and cleanup after the experiment system is fully wired.

Expected outcome: Quest Runner docs describe experiment lifecycle and operational recovery, schema references match the implemented metadata, and an end-to-end test covers create, scoped run, stop, dashboard visibility, landing, archive, and cleanup. Temporary compatibility code or dead paths introduced during earlier slices are removed.

## Sequencing

This slice is last because it documents and validates the final behavior across all previous slices. It should not introduce new product behavior beyond small cleanup required by the completed implementation.

## Key Files And Systems

- `projects/quest-runner/docs/README.md`
- `projects/quest-runner/docs/explanation/architecture.md`
- `projects/quest-runner/docs/explanation/lifecycle.md`
- `projects/quest-runner/docs/reference/api.md`
- `projects/quest-runner/docs/reference/cli.md`
- `projects/quest-runner/docs/reference/dashboard.md`
- `projects/quest-runner/docs/reference/runtime-files.md`
- `projects/quest-runner/docs/reference/roles.md`
- `projects/quest-runner/docs/reference/testing.md`
- `projects/quest-runner/src/quest_runner_service/quest_docs/schemas.md`
- `projects/quest-runner/src/quest_runner_service/quest_docs/workflow.md`
- `projects/quest-runner/tests/test_experiment_lifecycle.py`
- Existing tests added in slices 1 through 6

## Existing APIs To Reuse As-Is

- Existing documentation structure under `projects/quest-runner/docs/reference` and `docs/explanation`.
- Existing test helper `TempRepo`, `make_app_client(...)`, and git/worktree utilities.
- CLI/API examples and response style established in current docs.

## APIs To Add Or Modify

### Documentation

Update docs to cover:

- Experiment concepts: source checkout, experiment worktree, experiment id, open/completed/closed statuses.
- Directory layout under `projects/<project>/quests/<type>/<number>_<slug>/experiments/<number>/`.
- Full `experiment.json` schema, including status values, start step, stop condition, branch/worktree naming, created/landed timestamps, remote branch, and source commit.
- CLI examples:
  - `experiments create`
  - `run --experiment-id`
  - `advance --experiment-id`
  - issue commands with `--experiment-id`
  - `experiments land`
- API endpoints:
  - `POST /experiments/create`
  - `POST /experiments/land`
  - experiment-aware request/query fields on quest-scoped endpoints.
- Start-step replay semantics from `<step_commit>^`.
- Agent prompt requirement to preserve and pass `--experiment-id`.
- Dashboard behavior:
  - open experiment worktrees alongside quest panes
  - landed experiment archive on regular quest pages
  - Land button for experiment completion
- Recovery notes:
  - metadata committed but worktree creation failed
  - push failed during landing
  - archive copy failed
  - source checkout dirty during completion metadata update
  - missing normal quest worktree when an experiment id was omitted

Update `quest_docs/schemas.md` and `quest_docs/workflow.md` because agents receive these references in runtime prompts. Include `ExperimentComplete` and experiment issue-response/archive locations where relevant.

### Integration tests

Add `tests/test_experiment_lifecycle.py` or extend existing experiment tests with a high-level flow:

1. Build a temporary source repo with a completed quest history and v2 step metadata.
2. Create an experiment from a selected start step with alternate config.
3. Verify metadata commit, branch, worktree base commit, and config replacement.
4. Run or manually advance the experiment to the configured stop node using test doubles where harness calls would otherwise be required.
5. Verify `ExperimentComplete` and source metadata `experiment_complete`.
6. Verify dashboard project snapshot exposes the open experiment and quest overview exposes pending/completed status.
7. Land the experiment with a local bare remote configured for push.
8. Verify archived logs/issues/responses, metadata `landed`, remote branch exists, local branch/worktree removed, and source commit created.

Keep this test focused and deterministic. Use lower-level unit tests from earlier slices for edge cases.

### Cleanup

Review for and remove:

- Duplicate experiment id validation logic outside `experiments.py`.
- Any temporary stop-node alias tables duplicated outside the canonical validation helper.
- Any normal quest land path accepting `experiment_id` but not using it.
- Dead fallback code that reads experiment worktrees by path without metadata validation.

Do not remove compatibility for normal quests or for older quests without an `experiments/` directory.

## Enabling Refactor

If the final integration test needs a reusable fixture for v2 quest step commits, add it to `tests/test_helpers.py` with a narrow name and no experiment-specific assumptions outside the fixture.

## Validation Expectations

Run and document:

```text
make -C projects/quest-runner test
node --test projects/quest-runner/src/quest_runner_service/dashboard_assets/*.test.mjs
```

Also run targeted checks during implementation:

- `python -m unittest projects/quest-runner/tests/test_experiment_lifecycle.py`
- CLI help snapshot assertions in `tests/test_cli.py`
- Any markdown link/reference tests currently used by the project, if present

Manual verification notes for the implementer:

- Start the service with `make -C projects/quest-runner run` or the existing service command.
- Create a throwaway experiment in a temp repo.
- Confirm the dashboard shows the open experiment, an experiment detail page, archived artifacts after landing, and no experiment Land button on normal quest rows.
