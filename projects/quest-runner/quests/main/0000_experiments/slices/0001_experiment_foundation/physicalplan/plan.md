# Experiment Foundation

## Objective

Add the shared experiment data model, metadata readers/writers, deterministic naming helpers, and centralized path resolution used by every later slice.

Expected outcome: Quest Runner can read and validate archived experiment records under a quest's `experiments/<number>/` directory, compute experiment ids/branches/worktree paths, and resolve either a normal quest checkout or an experiment checkout through one shared API. No create/run/land behavior is exposed yet.

## Sequencing

This slice is first because creation, scoped running, landing, issues, slices, and dashboard views all need the same metadata schema and resolver. Implementing those surfaces before the resolver would scatter path logic across the service.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/quest_types.py`
- `projects/quest-runner/src/quest_runner_service/quest_fs.py`
- `projects/quest-runner/src/quest_runner_service/worktrees.py`
- new `projects/quest-runner/src/quest_runner_service/experiments.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_data.py`
- `projects/quest-runner/src/quest_runner_service/quest_docs/schemas.md`
- `projects/quest-runner/tests/test_experiments.py`
- `projects/quest-runner/tests/test_worktrees.py`
- `projects/quest-runner/tests/test_dashboard_api.py` or a focused resolver test module

## Existing APIs To Reuse As-Is

- `quest_fs.find_quest_dir(...)`, `list_quest_dirs(...)`, `read_quest_meta(...)`, and existing project-local quest layout rules.
- `worktrees.quest_worktree_base_dir(...)`, `run_git(...)`, `is_git_worktree(...)`, `porcelain_status(...)`, and `validate_project_name(...)`.
- `dashboard_data.DashboardCheckout` shape as the base for checkout-oriented API responses.
- `dashboard_data.canonical_quest_dashboard_url(...)` for parent quest dashboard URLs.

## APIs To Add Or Modify

### Experiment dataclasses

Add dataclasses in `quest_types.py` or the new `experiments.py` module:

- `ExperimentStartStep`
  - `global_step: int`
  - `role: str | None`
  - `step_log: str | None`
  - `step_commit: str`
  - `base_commit: str`
- `ExperimentStopCondition`
  - `machine_path: str`
  - `node_name: str`
- `ExperimentMeta`
  - fields from the spec's `experiment.json`: id, number, parent quest identity, quest slug, description, start step, stop condition, worktree name, branch name, status, created/landed timestamps, created_by, remote branch/source commit fields where present.

Use explicit status strings `created`, `open`, `experiment_complete`, `landed`, and `failed`. Keep the parser permissive for absent optional landed fields so older created records remain readable.

### `experiments.py`

Add the central experiment API:

- `experiment_dir_name(number: int) -> str` returns four-digit names such as `0000`.
- `experiment_id(project, quest_type, quest_number, experiment_number) -> str` returns `experiment_<project>_<quest_type>_<quest_number>_<experiment_number>` with unpadded quest/experiment numbers.
- `experiment_branch_name(project, quest_type, quest_number, experiment_number) -> str` returns `experiment/<project>/<quest_type>/<quest_number:04d>/<experiment_number:04d>`.
- `experiment_worktree_path(source_repo_root, experiment_meta_or_id) -> Path` returns `<repo-parent>/.quest-worktrees/<experiment_id>`.
- `experiments_root(quest_dir) -> Path`.
- `list_experiment_dirs(quest_dir) -> list[Path]`, numeric directories only, sorted by number.
- `next_experiment_number(quest_dir) -> int`.
- `write_experiment_meta(path_or_dir, meta)`, `read_experiment_meta(path_or_dir)`, and `update_experiment_status(...)`.
- `find_experiment_by_id(source_repo_root, project, quest_type, quest_number, experiment_id) -> ExperimentMeta`.
- `validate_experiment_belongs_to_quest(meta, project, quest_type, quest_number) -> None`.

All JSON output should be deterministic with `indent=2` and a trailing newline. Store path-like fields in metadata as repo-relative strings where the spec shows relative paths.

### Central checkout resolver

Extend `dashboard_data.DashboardCheckout` rather than creating a parallel result type:

- Add `experiment_id: str | None = None`, `experiment_number: int | None = None`, and `parent_quest_dir: Path | None = None`.
- Add `checkout_kind="experiment"` for experiment worktrees.

Add a new resolver, preferably in `experiments.py` with a thin `dashboard_data` wrapper:

```python
resolve_quest_scope_checkout(
    source_repo_root: Path,
    meta: QuestMeta,
    *,
    experiment_id: str | None = None,
    require_open_experiment: bool = False,
) -> DashboardCheckout
```

Behavior:

- Without `experiment_id`, preserve current `resolve_dashboard_checkout(...)` behavior exactly.
- With `experiment_id`, resolve metadata from the source checkout's parent quest directory, verify it matches the supplied quest identity, compute the experiment worktree path, verify the worktree exists when `require_open_experiment` is true, and find the quest directory inside that experiment worktree.
- If a caller targets an experiment but the normal quest worktree is missing, do not fall back to the source checkout. Return a clear experiment-specific error if the experiment id is invalid or missing for the requested operation.

Then make `dashboard_data.resolve_dashboard_checkout(...)` delegate to the new resolver with `experiment_id=None`.

## Enabling Refactor

Keep existing callers compiling by preserving the old `resolve_dashboard_checkout(source_repo_root, meta)` signature and return shape. Later slices will opt into the new `experiment_id` argument one surface at a time.

## Validation Expectations

Add tests for:

- Experiment id, worktree name/path, branch name, and numeric directory formatting.
- `next_experiment_number(...)` ignoring non-numeric experiment entries.
- `write_experiment_meta(...)` and `read_experiment_meta(...)` round-tripping required and optional fields.
- Resolver behavior without `experiment_id` remains unchanged for normal quests.
- Resolver behavior with a matching experiment id returns `checkout_kind="experiment"` and the experiment worktree quest path.
- Resolver rejects an experiment id that belongs to a different project/type/quest number.
- Resolver reports a missing open experiment worktree when required.

Run:

```text
make -C projects/quest-runner test
```
