# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T00:48:59Z
- updated_at: 2026-06-09T00:48:59Z
- title: Unused QuestScope dataclass introduced in experiments.py
- details: What is wrong:
The physical plan asked for a 'QuestScope(project, quest_type, quest_number, experiment_id=None)' request model in experiments.py. Commit 5c2051b added the dataclass (experiments.py:58-64) but it is never referenced anywhere in src/ or tests/ (verified via grep -rn 'QuestScope'). Scope resolution is instead threaded through individual parameters on QuestService._resolve_mutable_quest_scope / _prepare_run.

Why it is a problem:
The dataclass is dead code added by this slice. It implies an API surface that does not exist, which misleads future maintainers and is a maintainability smell. If it was added in anticipation of a later slice, that intent is not recorded.

What must be true to close:
Either (a) QuestScope is actually used to carry scope through the resolution path (replacing the loose project/quest_type/quest_number/experiment_id parameters), or (b) it is removed if not needed in this slice, or (c) the responder confirms with a concrete reference that a specific later slice (4/5) consumes it, in which case I will verify and close.
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T00:49:10Z
- updated_at: 2026-06-09T00:49:10Z
- title: Incomplete test coverage for experiment-scoped dashboard and CLI surfaces
- details: What is wrong:
The plan's Validation Expectations explicitly list tests for: 'Dashboard agent log, git history, and quest overview endpoints read from the experiment worktree when experiment_id is present' and 'CLI request bodies/queries include experiment_id for run, advance, slices, and every issue command'.

tests/test_experiment_scoped_operations.py (commit 5c2051b) covers only a subset:
- Dashboard: only /api/dashboard/quest_overview is asserted to read the experiment worktree. The agent_log (/api/dashboard/agent_log, .../stream), git_commits, and git_diff endpoints — all of which were changed in this slice to thread experiment_id through _quest_context() — have no experiment-scoped test.
- CLI: only 'run' is asserted to put experiment_id in the request body. advance, slices init, and the issues list/read/create/edit/respond/responses commands have no CLI-layer assertion that --experiment-id is forwarded into the body/query.

Why it is a problem:
These are explicit validation expectations in the physical plan that are unmet. While all dashboard endpoints share the _quest_context() helper (so the wiring risk is low) and the CLI paths are straightforward parameter passing, a future regression in any individual endpoint/command's forwarding would not be caught. The plan called these out specifically because each is a distinct caller.

What must be true to close:
Add tests asserting experiment_id scoping for (1) at least one of the changed git endpoints (git_commits or git_diff) and the agent_log endpoint reading from the experiment worktree, and (2) the CLI advance command and at least one issues command (e.g. issues list) forwarding --experiment-id into the request body/query. Alternatively, the responder may argue with concrete reasoning that the shared-helper coverage is sufficient, which I will evaluate.
- resolution_notes: none
