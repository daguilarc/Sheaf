# Experiment Stop Conditions

## Objective

Teach the runner to stop an experiment at its configured workflow graph node and mark the experiment as complete without treating the parent quest as normally landed.

Expected outcome: experiment execution uses the existing recursive runner, but after a step reaches the configured stop node it persists an `ExperimentComplete` filesystem state, updates source metadata status to `experiment_complete`, and returns a run status that dashboard and landing can distinguish from normal quest completion.

## Sequencing

This slice depends on scoped execution from slice 3. It must land before experiment landing and dashboard Land-button behavior.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/quest_types.py`
- `projects/quest-runner/src/quest_runner_service/quest_fs.py`
- `projects/quest-runner/src/quest_runner_service/experiments.py`
- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner_v2.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/v2_step_executor.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/quest_v2_definitions.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/v2_quest_state_io.py`
- `projects/quest-runner/tests/test_experiments.py`
- `projects/quest-runner/tests/test_state_machine_core.py`
- `projects/quest-runner/tests/test_quest_service_api.py`

## Existing APIs To Reuse As-Is

- `execute_v2_top_level_step(...)` already returns committed/noop/human-intervention outcomes and creates recursive snapshots.
- `RecursiveSnapshot` child-chain shape captures node names and machine paths after every step.
- `quest_fs.write_quest_normalized_machine_state(...)` and `V2QuestStateIo` write top-level machine state.
- `experiments.update_experiment_status(...)` from slice 1.

## APIs To Add Or Modify

### Filesystem state

Add `QuestState.ExperimentComplete = "ExperimentComplete"` to `quest_types.py`.

Update quest state readers/writers and normalized state validation so `ExperimentComplete` is a supported top-level filesystem state. It is terminal for experiment runs only. It is not a normal quest `Completed` state and must not trigger the existing quest land/rebase flow.

### Stop condition matching

Add in `experiments.py`:

```python
snapshot_matches_stop_condition(snapshot: RecursiveSnapshot, stop: ExperimentStopCondition) -> bool
```

Rules:

- Walk the root snapshot and all `child` snapshots.
- Match by canonical `node_name`.
- Match `machine_path` deterministically:
  - `root/quest` means the root quest snapshot.
  - `root/slice` means any slice child snapshot below the root.
  - A concrete repo-relative machine path may also match exactly.
- Store canonical stop condition values in `experiment.json`; do not rely on display aliases during execution.

### Runner integration

Add optional `experiment_meta: ExperimentMeta | None` to:

- `QuestService._run_quest_locked(...)`
- `quest_runner.run_quest(...)`
- `quest_runner_v2.run_quest_v2(...)`

Also pass enough source-checkout context through the service boundary for completion metadata updates. Prefer a small `ExperimentRunContext` dataclass containing `experiment_meta`, `source_repo_root`, and `source_experiment_dir` over giving lower-level runner code ad hoc path strings.

In `run_quest_v2(...)`:

- If no experiment metadata is present, current behavior is unchanged.
- If the current quest state is `ExperimentComplete`, return `{"status": "experiment_complete", ...}`.
- After each `execute_v2_top_level_step(...)`, inspect the committed step snapshot. If it matches the experiment stop condition:
  - rewrite the experiment worktree quest `state.md` to `ExperimentComplete` while preserving `global_step` and tags;
  - create one final commit on the experiment branch for the state change if the stop step did not already persist that state;
  - return `status="experiment_complete"`.

In `QuestService._run_quest_locked(...)`, when an experiment run returns `status="experiment_complete"`:

- update source-checkout `experiments/<number>/experiment.json` status to `experiment_complete` and record `completed_at`;
- commit the source metadata update with `experiment-complete: <project>/<type>/<quest_number:04d>/<experiment_number:04d>`;
- include the experiment id and completion status in the returned run payload.

Avoid committing source metadata from a dirty source checkout. If source metadata update fails because the source checkout is dirty, write a clear `human_intervention_request.md` in the experiment worktree and return human-intervention status with the failed metadata update reason.

### Manual advance

Update `advance_quest(..., experiment_id=...)` so manual advances also evaluate the resulting recursive snapshot or manual advance equivalent. If the stop condition is reached, it marks `ExperimentComplete` and source metadata just like a normal run.

### State-machine terminal behavior

Do not add `ExperimentComplete` to normal quest machine definitions as a path that ordinary quests can enter. Add a simple gate only if the loader needs to read it without error. The runner should stop before executing any node when state is `ExperimentComplete`.

## Enabling Refactor

`execute_v2_top_level_step(...)` may need to return the `RecursiveSnapshot` in its `V2StepResult`. Extend the dataclass to include `snapshot: RecursiveSnapshot | None` while keeping existing callers compatible.

## Validation Expectations

Add tests for:

- `ExperimentComplete` parses and writes in legacy and normalized state formats where applicable.
- Stop condition matching for quest root nodes, slice child nodes, and concrete machine paths.
- Unknown stop condition aliases were already rejected in slice 2 and remain rejected.
- A run with an experiment id stops after reaching `SliceCompletedNode` when configured.
- The experiment worktree state becomes `ExperimentComplete`.
- Source `experiment.json` status becomes `experiment_complete` with `completed_at`.
- The source metadata update commit is created with the expected message.
- A normal quest with no experiment id still reaches `Completed` using existing behavior.
- Manual `advance --experiment-id` also triggers experiment completion.
- The dashboard run status payload can represent `quest_state="ExperimentComplete"` and `status="experiment_complete"`.

Run:

```text
make -C projects/quest-runner test
```
