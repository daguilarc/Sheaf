# Implementation Complete

Slice `0002_experiment_creation` is implemented.

## Summary

Experiment creation is available through `POST /experiments/create` and
`scripts/quest-runner experiments create`. The flow validates start step and stop
condition, writes `experiments/<number>/` metadata on the source checkout,
commits with `experiment-create: <project>/<type>/<quest>/<experiment>`, creates
an experiment branch/worktree from `<step_commit>^`, and replaces the experiment
worktree quest `state_execution_config.yaml` with the supplied config.

## Key additions

- `resolve_start_step`, `validate_stop_condition`, and worktree/metadata helpers in `experiments.py`
- `quest_fs.validate_state_execution_config_text` for in-memory config validation
- `QuestService.create_experiment` orchestrating the full create flow
- REST route and CLI `experiments create` subcommand
- Tests covering metadata resolution, creation, API/CLI payloads, and failure cleanup

## Verification

`make -C projects/quest-runner test` — 312 tests passing.
