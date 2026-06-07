# Issues

## Issue PR-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-07T02:44:14Z
- updated_at: 2026-06-07T02:44:14Z
- title: Deferred rate-limit/billing retry path does not pass new required `project` arg to `run_quest`
- details: |
  This slice added a required positional `project` parameter to
  `QuestService.run_quest` (quest_service.py:456) and `_prepare_run`
  (quest_service.py:392), but did not thread `project` through the deferred
  retry chain. The result is a runtime `TypeError` whenever the deferred retry
  fires.

  Call chain:
  - `run_quest(repo_path, project, quest_type, quest_number, max_steps)` calls
    `_run_quest_locked(root, qdir, quest_type, quest_number, max_steps)`
    (quest_service.py:477) — `project` is dropped here.
  - `schedule_run_quest`'s background `worker()` likewise calls
    `_run_quest_locked(...)` without `project` (quest_service.py:546).
  - `_run_quest_locked` (quest_service.py:402), on a `QuestHarnessError` whose
    detail is `billing_error` or `rate_limit`, calls
    `_schedule_deferred_quest_run(repo_path=root, quest_type=..., quest_number=...,
    ...)` (quest_service.py:425) — still no `project`.
  - `_schedule_deferred_quest_run` (quest_service.py:179) has no `project`
    parameter and its scheduled `_callback` calls
    `self.run_quest(repo_path=..., quest_type=..., quest_number=..., max_steps=...)`
    (quest_service.py:193) without `project`.

  Because `run_quest` now requires `project` positionally, that deferred
  `_callback` invocation raises `TypeError: run_quest() missing 1 required
  positional argument: 'project'` when the scheduled retry executes (after
  `delay_seconds=3600`).

  Why it is a problem: the deferred retry is the recovery mechanism for harness
  `billing_error`/`rate_limit` failures during a quest run. As implemented in
  this slice, that recovery is broken — the retry crashes instead of resuming
  the quest, silently (the exception is swallowed by the `except Exception`
  logging in `_callback`). This is a regression introduced by the signature
  change in this slice and is not exercised by any of the new tests
  (test_quest_creation.py only covers `create_quest`).

  To mark completed:
  - `project` must be threaded from `run_quest` and `schedule_run_quest` through
    `_run_quest_locked` and `_schedule_deferred_quest_run` into the deferred
    `_callback`'s `self.run_quest(...)` call, so the rate-limit/billing-error
    deferred retry invokes `run_quest` with the correct project.
  - A test should exercise the deferred-retry path (e.g. simulate a
    `QuestHarnessError` with detail `rate_limit`/`billing_error` and assert the
    scheduled callback calls `run_quest` with the right `project`), so the
    regression cannot recur.
- resolution_notes: none
