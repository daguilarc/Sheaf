# Experiment Scoped Operations

## Objective

Thread optional `experiment_id` support through quest-scoped REST/CLI operations and agent prompts so experiment work runs against the experiment worktree instead of the original quest worktree.

Expected outcome: `run`, `advance`, issue commands, slice commands, dashboard data helpers, and relevant API payloads accept `experiment_id`. Normal behavior is unchanged when it is absent. Agent prompts in an experiment explicitly tell the agent to preserve and pass `--experiment-id`.

## Sequencing

This slice depends on experiment creation from slice 2. It should land before stop-condition semantics so the existing runner can already execute in an experiment worktree.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/experiments.py`
- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/src/quest_runner_service/cli.py`
- `projects/quest-runner/src/quest_runner_service/issue_service.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_data.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_slice.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_git.py`
- `projects/quest-runner/src/quest_runner_service/quest_thread.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner_v2.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/context.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/quest_v2_nodes.py`
- `projects/quest-runner/tests/test_cli.py`
- `projects/quest-runner/tests/test_issue_api.py`
- `projects/quest-runner/tests/test_advance_quest_api.py`
- `projects/quest-runner/tests/test_worktree_execution_path.py`
- `projects/quest-runner/tests/test_dashboard_api.py`

## Existing APIs To Reuse As-Is

- `QuestService._prepare_run(...)` validation pattern and lock key construction.
- `QuestService._run_quest_locked(...)` and `quest_runner.run_quest(...)` execution path, including `event_bus` threading.
- `issue_service.resolve_issue_context(...)` read/write behavior once it receives the correct checkout.
- `dashboard_slice` payload builders for logs, agents, and slice pages once `qdir` points at the experiment worktree.
- `quest_thread.build_runtime_context(...)` as the place that injects common runtime prompt context.

## APIs To Add Or Modify

### Scope resolution

Add a small request model in `experiments.py`:

```python
QuestScope(project, quest_type, quest_number, experiment_id=None)
```

Add service helpers:

- `_prepare_run(..., experiment_id: str | None = None) -> tuple[Path, Path, str, ExperimentMeta | None]`
- `_resolve_mutable_quest_scope(..., experiment_id: str | None = None, require_open_experiment: bool = False)`

Rules:

- Without `experiment_id`, preserve current quest worktree requirements.
- With `experiment_id`, resolve source metadata, verify it belongs to the supplied quest, require the experiment worktree for run/advance/slice/issue mutation operations, and build the lock key from the experiment worktree path plus the parent quest identity plus experiment id.
- Dashboard read-only operations may read source archived metadata when a later slice adds archived experiment pages, but this slice should use open experiment worktrees for experiment-scoped quest detail reads.

### Service methods

Add optional `experiment_id` to:

- `QuestService.run_quest(...)`
- `QuestService.schedule_run_quest(...)`
- `_schedule_deferred_quest_run(...)`
- `QuestService.advance_quest(...)`
- `QuestService.initialize_slices(...)`
- all issue service wrappers: `list_issues`, `get_issue`, `create_issue`, `edit_issue`, `respond_to_issue`, `list_issue_responses`

Do not route experiment landing through `land_quest(...)` in this slice. Normal `land_quest(...)` remains for main/side quest worktree rebasing; slice 5 adds `experiments land`.

### API

Accept and pass `experiment_id` in JSON bodies for:

- `/run_quest`
- `/advance_quest`
- `/api/slices/init`
- issue create/edit/respond bodies

Accept `experiment_id` query parameter for:

- dashboard quest context endpoints
- issue list/read/responses
- agent log/stream
- git commits/diff for the current checkout

Update `_quest_context()` to parse `experiment_id` and call the centralized resolver. Existing responses should include `experiment_id` and `checkout_kind="experiment"` when scoped.

### CLI

Add `--experiment-id` to:

- `run`
- `advance`
- `land`, accepted but returning a clear "experiment landing is implemented by `experiments land` in slice 5" validation error until slice 5 wires the alias
- `slices init`
- `issues list/read/create/edit/respond/responses`

The temporary `land --experiment-id` validation keeps the CLI surface explicit while avoiding an accidental call to the normal rebase/merge land flow before experiment landing exists.

Update CLI help examples to show experiment-scoped `run` and issue commands.

### Agent prompt context

Extend `quest_thread.build_runtime_context(...)` and `perform_role_harness_sequence(...)` inputs to carry `experiment_id`.

Thread `experiment_id` through:

`QuestService._run_quest_locked -> quest_runner.run_quest -> quest_runner_v2.run_quest_v2 -> RunContext -> quest_v2_nodes -> perform_role_harness_sequence -> build_runtime_context`

When `experiment_id` is present, injected runtime context must include:

```text
Experiment: <experiment_id>
When using scripts/quest-runner, pass --experiment-id <experiment_id>.
Do not omit the experiment id; the original quest worktree may not exist.
```

This is a prompt-only change; do not change role markdown files.

### Clear missing-id failure

When a command targets a normal quest without `experiment_id` and the normal quest worktree is missing, keep `MissingQuestWorktree` but improve the error text to say that if the operator is working on an experiment, they must pass `--experiment-id <id>`.

## Enabling Refactor

Update `issue_service.resolve_issue_context(...)` to accept a resolved checkout or an optional `experiment_id` rather than calling `dashboard_data.resolve_dashboard_checkout(...)` directly. This keeps issue path resolution centralized and avoids duplicating experiment lookup in issue code.

## Validation Expectations

Add tests for:

- CLI request bodies/queries include `experiment_id` for run, advance, slices, and every issue command.
- API accepts `experiment_id` and passes it to service methods.
- `_prepare_run(..., experiment_id=...)` returns experiment worktree root and quest dir.
- Experiment id mismatch with supplied quest is rejected.
- Running with an experiment id does not require the normal quest worktree to exist.
- Running without an experiment id still fails when the normal quest worktree is missing, with the new clear message.
- Issue read/write paths are inside the experiment worktree when `experiment_id` is present.
- Slice initialization creates slices inside the experiment worktree when `experiment_id` is present.
- Dashboard agent log, git history, and quest overview endpoints read from the experiment worktree when `experiment_id` is present.
- Runtime prompt context contains the experiment id and `--experiment-id` instruction.
- Scheduled background runs preserve the experiment id in deferred retry metadata and callback execution.

Run:

```text
make -C projects/quest-runner test
```
