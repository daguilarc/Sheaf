# Experiment Landing

## Objective

Implement experiment landing as archival and cleanup, not code integration.

Expected outcome: `scripts/quest-runner experiments land ...` verifies a completed experiment, copies runtime artifacts from the experiment worktree into the source checkout's `experiments/<number>/` archive, pushes the experiment branch to remote, removes the local worktree, deletes the local branch, updates metadata to `landed`, commits the archive on the source checkout, and returns useful counts and links.

## Sequencing

This slice depends on `ExperimentComplete` from slice 4. It must land before dashboard UI wires the Land button to the experiment landing endpoint.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/experiments.py`
- `projects/quest-runner/src/quest_runner_service/worktrees.py`
- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/src/quest_runner_service/cli.py`
- `projects/quest-runner/src/quest_runner_service/quest_fs.py`
- `projects/quest-runner/tests/test_experiments.py`
- `projects/quest-runner/tests/test_land_api.py`
- `projects/quest-runner/tests/test_cli.py`

## Existing APIs To Reuse As-Is

- `worktrees.porcelain_status(...)`, `branch_exists(...)`, `remove_worktree(...)`, `delete_branch(...)`, `rev_parse_head(...)`, and `run_git(...)`.
- `quest_fs.read_quest_state(...)`, `read_issues(...)`, and `read_issue_responses(...)` for validating and reading artifact files.
- Source checkout cleanliness checks used by normal `land_quest(...)`, but not its rebase/merge flow.

## APIs To Add Or Modify

### Artifact archiving

Add in `experiments.py`:

```python
archive_experiment_artifacts(source_experiment_dir: Path, experiment_quest_dir: Path) -> ArtifactCopySummary
```

Copy:

- `logs/*.jsonl` from the experiment worktree quest into `experiments/<number>/logs/`.
- Quest-level `physicalplan_issues.md` and each slice `polishing_issues.md` into `experiments/<number>/issues/`, preserving enough relative path information to avoid collisions. Use subdirectories such as `quest/physicalplan_issues.md` and `slices/<slice_dir>/polishing_issues.md`.
- Quest-level `physicalplan_issue_responses.md` and each slice `polishing_issue_responses.md` into `experiments/<number>/issue_responses/` with the same collision-safe relative layout.

Do not copy missing optional response files. Preserve filenames and relative paths, and return counts for logs, issues, issue responses, and skipped missing files.

### Branch push and cleanup

Add helpers:

- `push_experiment_branch(source_repo_root, branch_name, remote="origin")`.
- `delete_local_experiment_branch(source_repo_root, branch_name)`.

Push `refs/heads/<branch_name>:refs/heads/<branch_name>`. Do not delete the remote branch.

### Service method

Add `QuestService.land_experiment(...)`:

1. Resolve source quest and experiment metadata.
2. Verify the experiment belongs to the request and the worktree exists.
3. Verify the experiment worktree quest state is `ExperimentComplete` and metadata status is `experiment_complete`, unless a future explicit override is added. Do not add the override in this slice unless tests require it.
4. Verify the source checkout is clean before copying archive files.
5. Copy artifacts.
6. Update `experiment.json` with `status="landed"`, `landed_at`, `remote_branch`, and `source_commit` after commit.
7. Push the experiment branch. If push fails, do not delete the worktree or local branch and do not mark landed.
8. Remove the experiment worktree.
9. Delete the local branch after the worktree has been removed and the push succeeded.
10. Stage `experiments/<number>/` and commit with `experiment-land: <project>/<type>/<quest_number:04d>/<experiment_number:04d>`.
11. Return copied counts, remote branch name, source commit hash, worktree/branch deletion booleans, and dashboard URL.

Order matters: copying must not mark landed before push succeeds, and local state must remain if push fails.

### API and CLI

Add:

- `POST /experiments/land`
- `scripts/quest-runner experiments land --project ... --type ... --number ... --experiment-id ...`
- `scripts/quest-runner land --project ... --type ... --number ... --experiment-id ...` as an alias that sends the same `/experiments/land` request. Without `--experiment-id`, `land` must keep the existing normal quest rebase/merge behavior.

Request body:

```json
{
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 0,
  "experiment_id": "experiment_quest-runner_main_0_0"
}
```

CLI output should include status, experiment id, copied counts, remote branch, worktree_deleted, branch_deleted, source_commit, and dashboard_url.

## Enabling Refactor

Factor shared source-checkout cleanliness error construction out of `land_quest(...)` only if it reduces duplication. Do not change normal land behavior or rebase/merge semantics.

## Validation Expectations

Add tests for:

- Landing rejects unknown experiment id, mismatched quest identity, missing worktree, and non-complete experiment state.
- Landing copies JSONL logs into `experiments/<number>/logs/`.
- Landing copies quest and slice issue files into collision-safe archive paths.
- Landing copies issue response files into collision-safe archive paths.
- Landing updates `experiment.json` to `landed` with `landed_at`, remote branch, and source commit.
- Landing pushes the branch using the unique experiment branch name.
- If push fails, local worktree and branch remain and metadata is not marked landed.
- If artifact copy fails, metadata is not marked landed.
- Local worktree and branch are deleted only after successful artifact copy and push.
- The source checkout receives an `experiment-land: ...` commit containing archived files.
- CLI sends the expected `/experiments/land` body and formats the result.

Run:

```text
make -C projects/quest-runner test
```
