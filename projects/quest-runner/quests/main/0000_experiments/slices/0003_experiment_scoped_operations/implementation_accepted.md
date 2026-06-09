# Implementation Accepted

Slice `0003_experiment_scoped_operations` is accepted by the polisher reviewer.

## Scope verified

Optional `experiment_id` is threaded through quest-scoped REST/CLI operations and
agent runtime prompts so experiment work runs against the experiment worktree. Behavior
is unchanged when `experiment_id` is absent.

Reviewed against the physical plan (`physicalplan/plan.md`) and the implementation in
commits `5c2051b` (initial) and `6df52f4` (polishing fixes):

- Scope resolution centralized in `QuestService._resolve_mutable_quest_scope` /
  `_prepare_run`, with experiment-aware lock keys and improved `MissingQuestWorktree`
  guidance. Verified the error-path `experiment_worktree_path(root, experiment_id_str)`
  call is correct because `worktree_name == experiment_id` at creation
  (`quest_service.py:569`).
- `experiment_id` accepted/passed through `run`, `advance`, `slices init`, and all
  issue service wrappers/API/CLI paths.
- Dashboard `_quest_context()` and payloads resolve experiment worktrees and surface
  `experiment_id` + `checkout_kind="experiment"` when scoped.
- Runtime context threaded `run_quest -> run_quest_v2 -> RunContext -> quest_v2_nodes
  -> perform_role_harness_sequence -> build_runtime_context`, injecting the required
  `--experiment-id` preservation instruction.
- `land --experiment-id` returns a clear validation error directing to
  `experiments land` (slice 5).

## Issue history

- PL-0001 (unused `QuestScope` dataclass) — resolved: dataclass removed; `rg` confirms
  no references in `src/` or `tests/`. Closed.
- PL-0002 (incomplete experiment-scoped test coverage) — resolved: added experiment
  worktree tests for `agent_log` and `git_commits`, CLI forwarding tests for `advance`
  and `issues list`, and registered the test module in the Makefile so it runs in
  `make test`. Closed.

No open polishing issues remain. Reported test outcome: 329 tests pass
(`make -C projects/quest-runner test`).
