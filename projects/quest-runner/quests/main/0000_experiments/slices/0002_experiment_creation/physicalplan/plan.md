# Experiment Creation

## Objective

Implement experiment creation through REST and CLI.

Expected outcome: an operator can run `scripts/quest-runner experiments create ...` to create source-checkout experiment metadata, commit it, create an experiment branch and worktree from the parent of the selected step commit, and replace the experiment worktree's quest `state_execution_config.yaml` with the supplied experimental config.

## Sequencing

This slice depends on slice 1 for metadata and resolver helpers. It must land before experiment-scoped execution because the run path needs real experiment records and worktrees.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/experiments.py`
- `projects/quest-runner/src/quest_runner_service/worktrees.py`
- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/src/quest_runner_service/cli.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_git.py`
- `projects/quest-runner/src/quest_runner_service/quest_fs.py`
- `projects/quest-runner/tests/test_experiments.py`
- `projects/quest-runner/tests/test_cli.py`
- `projects/quest-runner/tests/test_quest_service_api.py`

## Existing APIs To Reuse As-Is

- `quest_fs.find_quest_dir(...)`, `read_quest_meta(...)`, `read_state_execution_config_version(...)`, and execution config validation routines already used by role profile resolution.
- `dashboard_git.scan_quest_metadata_step_commits(...)` for v2 recursive step commit discovery.
- `quest_fs.read_history(...)` as the deterministic legacy fallback for quests that only have `state_history.md`.
- `worktrees.run_git(...)`, `porcelain_status(...)`, `current_branch(...)`, and `is_git_worktree(...)`.
- CLI request/formatting patterns in `cli.py`, especially `FakeTransport`-friendly tests.

## APIs To Add Or Modify

### Start step resolution

In `experiments.py`, add:

```python
resolve_start_step(source_repo_root: Path, quest_dir: Path, start_step: int) -> ExperimentStartStep
```

Resolution order:

1. Compute the quest machine path relative to `source_repo_root`.
2. Call `dashboard_git.scan_quest_metadata_step_commits(source_repo_root, quest_machine_path)`.
3. Find the row where `global_step == start_step`; because the scanner returns newest first, enforce exactly one matching global step after deduplication.
4. Set `step_commit` to the row SHA, `role` from the row role or first child-chain role, `step_log` to `logs/step_<start_step:04d>_<role>.jsonl` when the role is known and the file exists, and `base_commit` to `git rev-parse <step_commit>^`.
5. If no metadata row exists, read `state_history.md`, find the deterministic record for the requested step by one-based chronological index or by matching global-step metadata if present, set `step_commit` from its `commit`, and resolve `<step_commit>^`.
6. Reject missing, duplicate, or parentless commits with `InvalidQuestInput`.

This is intentionally deterministic and test-covered; do not scrape arbitrary log text as a third fallback.

### Stop condition validation

Add:

```python
validate_stop_condition(machine_path: str | None, stop_node: str) -> ExperimentStopCondition
```

Rules:

- Default `machine_path` to `root/slice` for the CLI's `--stop-node` form.
- Accept stop nodes only if they match a node in the existing quest/slice v2 definitions:
  - quest nodes from `build_quest_machine_definition().node_map`
  - slice nodes from `build_slice_machine_definition().node_map`
  - additionally accept normalized lower-case aliases from the spec such as `slice_completed`, mapped to `SliceCompletedNode`.
- Return the canonical node name stored in metadata.
- Reject unknown stop nodes before creating any files or branches.

### Worktree helpers

Add helpers in `worktrees.py` or `experiments.py`:

- `create_experiment_branch_and_worktree(source_repo_root, branch_name, worktree_path, base_commit)`.
- `remove_partial_experiment_worktree(source_repo_root, branch_name, worktree_path)`.
- `commit_experiment_metadata(source_repo_root, experiment_dir, project, quest_type, quest_number, experiment_number) -> str`.

Use `git worktree add -b <branch> <path> <base_commit>`. Clean up partial branch/worktree on pre-commit failures or worktree creation failures when safe. If metadata has already been committed and worktree creation fails, raise an error carrying the metadata commit, branch name, and attempted worktree path.

### Service method

Add `QuestService.create_experiment(...)`:

- Validate repo, project, quest type, quest number, notes/config file content, start step, and stop condition.
- Resolve source quest directory only in the source checkout. Do not require the original quest worktree to exist.
- Create `experiments/<number>/experiment.json`, `notes.md`, and `state_execution_config.yaml`.
- Validate the supplied config with the existing state execution config parser before writing it.
- Commit metadata on the source checkout with `experiment-create: <project>/<type>/<quest_number:04d>/<experiment_number:04d>`.
- Create the experiment branch/worktree from `base_commit`.
- Copy the experimental config into the experiment worktree at the quest's normal `state_execution_config.yaml`.
- Update source metadata status to `open` after successful worktree creation and commit that status update only if the implementation chooses a two-step status transition. Prefer writing `open` before the first metadata commit when all inputs have already been validated and branch creation is the only remaining side effect.
- Return experiment id, number, worktree path, branch name, base commit, start step, stop condition, metadata commit, and dashboard URL.

### API and CLI

Add:

- `POST /experiments/create`
- CLI subcommands:
  - `scripts/quest-runner experiments create --project ... --type ... --number ... --start-step ... --stop-node ... --notes-file ... --config-file ...`

Request body:

```json
{
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 0,
  "start_step": 5,
  "stop_node": "slice_completed",
  "stop_machine_path": "root/slice",
  "notes": "...",
  "config": "..."
}
```

The CLI reads file contents and sends JSON strings rather than file paths. Formatting should print experiment id, number, branch, worktree path, base commit, and dashboard URL.

## Enabling Refactor

If `quest_fs` does not expose validation of arbitrary config text, add a small parser that validates a temporary in-memory YAML mapping or a temporary file path without changing the existing role profile API. Keep it reusable for tests.

## Validation Expectations

Add tests for:

- Next experiment number assignment.
- Metadata, notes, and config files written under `experiments/<number>/`.
- Source metadata commit message.
- Start step resolution from v2 commit metadata, including `base_commit == <step_commit>^`.
- Legacy `state_history.md` fallback.
- Rejecting unknown start step, parentless start commit, and unknown stop node before creating a worktree.
- Experiment worktree created at the deterministic path from the selected parent commit.
- Experiment worktree quest `state_execution_config.yaml` equals the supplied config while the source quest config is unchanged.
- API validates required fields and returns the creation payload.
- CLI sends the expected `/experiments/create` request body and prints key fields.
- Partial branch/worktree cleanup on branch/worktree creation failure when metadata was not committed; committed metadata failure response includes retry/cleanup details.

Run:

```text
make -C projects/quest-runner test
```
