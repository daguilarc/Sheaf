# Implementation Accepted — Slice 0008 (experiments_cleanup_compatibility)

The polisher reviewer accepts the slice 0008 implementation. All polishing issues
are resolved (PL-0001 verified Fixed and closed).

## What was reviewed

- Full slice diff `dfc4007..HEAD` covering:
  - Experiments migrated to workflow-directory based creation: CLI `--config-file`
    now points at an alternate `workflow/` directory; `validate_workflow_directory`
    + `install_experiment_workflow` copy it into both experiment metadata and the
    worktree; `api.py`/`quest_service` consistently use `workflow_path`/`issue_file`.
  - Stop-condition validation resolved against the loaded workflow machines
    (logical state ids, `node_name` overrides, case-insensitive aliases) and
    generic `stop_machine_path` handling; `snapshot_matches_stop_condition` threads
    the active workflow.
  - Artifact archiving walks workflow-declared issue files (including
    `$active_child` child slice expansion) instead of hard-coded paths.
  - Cleanup: removal of `quest_v2_definitions/nodes/predicates`,
    `legacy_quest_state_io`, `v2_quest_state_io`, dead transition-plan/scaffold
    helpers in `quest_runner.py`, packaged `default_state_execution_config.yaml`
    and `roles/*.md`; new `errors.py` (`FatalInvariantError`,
    `AdvanceValidationError`) and `EXPERIMENT_COMPLETE_STATE`.
  - New `tests/test_workflow_compatibility.py` plus existing suite coverage.

## Verification notes

- No dangling references to any removed module or symbol remain in `src`/`tests`.
- Experiment create/stop/archive paths are internally consistent;
  `EXPERIMENT_COMPLETE_STATE` matches `QuestState.ExperimentComplete.value`.
- Compatibility matrix is covered across the suite (workflow runner integration,
  experiment stop conditions, state IO, and the new compatibility test).
- Public docs now describe the `workflow/` directory and `--file` issue commands;
  repo-wide searches over `projects/quest-runner/docs/` find no references to
  `--scope`/`--slice` issue flags or `state_execution_config.yaml` as active
  config.

## Process note

The issue CLI/API was unavailable during this review: the live service at
`localhost:9002` runs pre-migration scope-based code and returns
`HTTP 400 "Missing required parameter: scope"` for the worktree's migrated
`--file`-based CLI. This is the expected consequence of the runner migrating its
own issue API. Per role rules ("…unless the CLI/API is unavailable"), PL-0001 was
created and closed directly in `polishing_issues.md` in the exact `write_issues`
serialized format; the workflow's `has_open_issues` condition reads that markdown
directly, so the state machine sees the correct issue status.
