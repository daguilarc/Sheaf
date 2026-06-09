# Implementation Accepted

Slice `0007_experiment_docs_validation` is accepted by the polisher reviewer.

## Scope reviewed

Experiment documentation and validation, concentrated in commit `742486c`:

- Human-facing docs under `projects/quest-runner/docs/` (README, architecture,
  lifecycle, api, cli, dashboard, runtime-files, roles, testing).
- Agent runtime references `quest_docs/schemas.md` and `quest_docs/workflow.md`.
- End-to-end `tests/test_experiment_lifecycle.py` and the `commit_v2_quest_step`
  helper in `tests/test_helpers.py`, registered in the `Makefile`.

## Verification

Documentation was checked against the implementation:

- Naming (`experiment_id`, branch, worktree) matches `experiments.py`.
- `experiment.json` schema fields and status set
  (`created/open/experiment_complete/landed/failed`) match `ExperimentMeta` and
  `_EXPERIMENT_STATUSES`.
- HTTP contracts confirmed: create→201, land→200, worktree-creation→500,
  land conflicts→409, quest-not-found→404, not-a-git-repo→422,
  invalid/dirty/detached→400.
- CLI `land --experiment-id` routes to `POST /experiments/land`;
  `experiments create` options match the parser.
- `build_runtime_context` injects the experiment id and `--experiment-id`
  instruction.
- Integration test exercises create → advance → `ExperimentComplete` →
  dashboard snapshot/overview → land → archive/cleanup.

## Issues

- PL-0001 (api.md `/experiments/create` error table mapped dirty/detached
  checkouts to 422 instead of 400) — fixed by the polisher and verified
  completed. The table now reads 400 for invalid/dirty/detached input and 422
  only for non-git source checkouts, consistent with the `create_quest` table.

No open polishing issues remain.
