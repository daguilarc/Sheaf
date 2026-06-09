# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T01:29:06Z
- updated_at: 2026-06-09T01:29:06Z
- title: land_experiment records a dangling/stale source_commit due to git commit --amend
- details: WHAT IS WRONG:
commit_experiment_land in experiments.py records/returns a source_commit that does NOT identify the actual landing commit on the source branch.

Flow:
1. git add -- experiments/<n>/ then git commit -m experiment-land:... creates commit C1.
2. land_commit = git rev-parse HEAD captures C1.
3. experiment.json is rewritten with source_commit=C1 and re-staged.
4. git commit --amend --no-edit replaces C1 with a NEW commit C2 (tree changed because experiment.json now embeds source_commit, so the hash differs).
5. The function returns C1; experiment.json on disk also embeds C1.

After the amend HEAD==C2, but the recorded/returned source_commit==C1. C1 is no longer reachable from any branch (orphaned/dangling, gc-eligible).

WHY IT IS A PROBLEM:
- source_commit is the spec-mandated field to locate the land commit in source history (plan steps 6, 10-11). The recorded value points to a dangling commit, so 'git branch --contains <source_commit>' is empty and 'git show <source_commit>' breaks after gc.
- The value is propagated to the API response, CLI source_commit output, and experiment.json metadata; every consumer gets a hash that does not match the real HEAD landing commit.
- Existing test test_land_success_archives_and_cleans_up does NOT catch this: it only asserts source_commit is truthy and equals the stored value (both C1) and checks the commit SUBJECT via 'git log -1 --format=%s' (preserved by --amend --no-edit). Nothing asserts source_commit == git rev-parse HEAD.

WHAT MUST BE TRUE TO MARK COMPLETED:
- source_commit returned by land_experiment and stored in experiment.json must equal the actual post-land HEAD of the source checkout (the branch-reachable commit containing the archived files), verifiable via git rev-parse HEAD and git branch --contains <source_commit>.
- A test asserts the returned/stored source_commit equals the post-land HEAD commit (not merely truthy).
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T01:29:19Z
- updated_at: 2026-06-09T01:29:19Z
- title: Failed push (or mid-copy artifact failure) leaves source checkout dirty and blocks retry
- details: WHAT IS WRONG:
In _land_experiment_locked, archive_experiment_artifacts copies log/issue/response files into source_experiment_dir (inside the SOURCE checkout) BEFORE push_experiment_branch runs. These copied files are new untracked files, so the source checkout becomes dirty at that point.

If push_experiment_branch then fails, the code raises ExperimentLandConflict(status=push_failed) without committing or cleaning up the copied artifacts. The same applies if archive_experiment_artifacts itself fails partway (OSError) after copying some files.

WHY IT IS A PROBLEM:
- land_experiment begins with _raise_source_checkout_dirty_for_land, which rejects a dirty source checkout with status=target_dirty. After a transient push failure (e.g. network/remote hiccup), the leftover uncommitted archive files mean any retry of land_experiment is immediately rejected as target_dirty.
- This makes the documented recovery path unusable without manual cleanup: an operator must hand-delete the partially-copied experiments/<n>/ files before retrying, which is non-obvious and error-prone.
- test_land_push_failure_preserves_local_state only checks the worktree, branch, and metadata are preserved; it does not check that the source checkout is restored to a clean, retryable state, so the gap is untested.

NOTE: plan step ordering lists copy (5) before push (7), so this stems partly from the spec's ordering. Recording for visibility; the fix should make a failed land recoverable (e.g. clean up copied artifacts on push/copy failure, or reorder so artifacts are copied only after push succeeds) without violating the 'do not mark landed / do not delete worktree or branch on push failure' guarantee.

WHAT MUST BE TRUE TO MARK COMPLETED:
- After a push failure (and after a mid-copy artifact failure), the source checkout is left clean (no uncommitted archived files), so a subsequent land_experiment retry is not rejected with target_dirty.
- A test exercises a push failure followed by a successful retry, or otherwise asserts the source checkout is clean after the failure.
- resolution_notes: none
