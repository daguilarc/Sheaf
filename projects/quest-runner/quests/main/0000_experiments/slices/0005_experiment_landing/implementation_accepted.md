# Implementation Accepted

Slice `0005_experiment_landing` is accepted by the polisher reviewer.

## Scope reviewed

Experiment landing as archival + cleanup: artifact archiving, branch push, worktree
and local-branch cleanup, `landed` metadata, source-checkout commit, plus the
`POST /experiments/land` route, the `experiments land` CLI command, and the
`land --experiment-id` alias.

## Outcome

All reported polishing issues are resolved and verified:

- **PL-0001 (completed)** — `land_experiment` previously recorded/returned a dangling
  `source_commit` because `commit_experiment_land` captured `HEAD` before a
  `git commit --amend`, orphaning that commit. Escalated to a human, who confirmed no
  consumers and instructed removing the field. `source_commit` is now removed from
  `ExperimentMeta`, metadata read/write, `update_experiment_status`, the service/API
  response, and CLI output; the `--amend` is gone. A legacy-ignore test was added and
  the success test asserts the field is absent. Defect eliminated.

- **PL-0002 (completed)** — A failed push or mid-copy artifact failure left copied
  archive files in the source checkout, blocking retry via the `target_dirty` guard.
  `_restore_source_experiment_dir_for_retry` now cleans copied artifacts on both
  failure paths. Tests assert `git status --porcelain` is empty after each failure and
  that a subsequent land retry succeeds.

## Validation

Implementer/polisher reported `make -C projects/quest-runner test` passing, including
the new landing/CLI/API tests covering the fixes above. Per reviewer policy, tests were
not re-run in this pass; sufficiency was assessed from the changed test code and
reported outcomes.
