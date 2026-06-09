# Issues

## Issue PL-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-09T03:37:52Z
- updated_at: 2026-06-09T03:41:35Z
- title: Dead/duplicated archived_experiments_payload and minor DRY cleanups in dashboard_data
- details: ## What is wrong

`dashboard_data.archived_experiments_payload(source_repo_root, project, quest_type, quest_number)` (dashboard_data.py:625) is defined but never called anywhere in `src/` or `tests/` (verified by grep). It duplicates logic that is instead re-implemented inline inside `quest_overview_payload(...)` (the `else` branch around dashboard_data.py:1013-1046): both iterate `list_experiment_dirs`, read each `experiment.json`, filter `status == "landed"`, build `_archived_experiment_summary(...)`, attach `log_count`, and sort by `experiment_number` descending.

Two smaller cleanups in the same area:
- `open_experiment_summary_row(...)` accepts a `source_qdir` parameter that is never used in the body.
- `experiment_archive_detail_payload(...)` builds the experiment dir with a hardcoded `f"{exp_meta.experiment_number:04d}"` (dashboard_data.py ~679) instead of the existing `experiments.experiment_dir_name(...)` helper, duplicating the naming convention.

## Why it is a problem

- `archived_experiments_payload` is dead code: it adds an untested, unreachable public-looking function plus an `issue_file_count` field that no caller or test exercises, so it can silently drift from the inline overview logic it mirrors.
- The duplicated archived-experiments loop means a future change to archived-summary shape must be made in two places, and the unused function invites a maintainer to wire up the wrong/stale one.
- The unused parameter and hardcoded dir-name format are minor inconsistencies that reduce clarity and DRY-ness.

## What must be true to mark this completed

Either:
- `archived_experiments_payload` is removed, OR
- `quest_overview_payload`'s archived-experiments `else` branch is refactored to call `archived_experiments_payload` (or a shared helper) so there is a single source of truth, with tests covering the path that is kept.

And:
- The unused `source_qdir` parameter on `open_experiment_summary_row` is removed (and its caller updated), or it is actually used.
- `experiment_archive_detail_payload` uses `experiment_dir_name(...)` for the experiment directory name (or a comment justifies the inline format).

No behavior change to the existing endpoints is required; the slice's API contract and tests should remain green.
- resolution_notes: none
