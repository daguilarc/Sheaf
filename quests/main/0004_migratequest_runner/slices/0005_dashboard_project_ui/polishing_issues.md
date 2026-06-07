# Issues

## Issue PR-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-07T03:12:00Z
- updated_at: 2026-06-07T03:12:00Z
- title: resolve_dashboard_checkout crashes when worktree exists but quest dir is not found inside it
- details: |
  In `projects/quest-runner/src/quest_runner_service/dashboard_data.py`,
  `resolve_dashboard_checkout` (lines ~127-146) handles the worktree branch as
  follows:

  ```python
  if worktree_exists(source_repo_root, meta):
      checkout_root = quest_worktree_path(source_repo_root, meta).resolve()
      quest_dir = source_qdir
      worktree_qdir = quest_fs.find_quest_dir(checkout_root, ...)
      if worktree_qdir is not None:
          quest_dir = worktree_qdir
      quest_dir_rel = quest_dir.resolve().relative_to(checkout_root).as_posix()
  ```

  The `if worktree_qdir is not None` guard explicitly anticipates that
  `find_quest_dir` may return `None`. When that happens, `quest_dir` stays as
  `source_qdir`, which lives under the source repo root, NOT under the worktree
  `checkout_root`. The very next line then calls
  `quest_dir.resolve().relative_to(checkout_root)`, which raises
  `ValueError: <source path> is not in the subpath of <worktree path>`.

  This is internally inconsistent: the code defends against a `None` worktree
  quest dir for the `quest_dir` assignment, but then immediately assumes the
  resulting `quest_dir` is located under the worktree. Any caller that reaches
  this path (`quest_overview_payload`, `run_status_payload`, `resolve_quest_dirs`,
  `resolve_quest_checkout_root`) would propagate the exception and fail the
  dashboard request with a 500 rather than a graceful result.
- why it is a problem: |
  This is a latent crash in newly introduced code. Either the `None` case can
  occur (in which case the dashboard request crashes instead of degrading), or it
  can never occur (in which case the guard is dead/misleading and signals an
  unhandled assumption). Either way the worktree branch is not robust, and there
  is no test covering the "worktree exists but quest dir missing inside it"
  scenario.
- what must be true to mark completed: |
  The worktree branch must compute `quest_dir_rel` without raising when
  `find_quest_dir` returns `None` (e.g. derive the relative path against the
  checkout root actually containing `quest_dir`, or remove the now-impossible
  guard with justification that the case cannot occur), AND there must be either
  a test exercising the worktree-exists-but-quest-dir-missing path or a clear,
  reviewed rationale (in the implementer's response) explaining why the branch is
  unreachable.
- resolution_notes: none

## Issue PR-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-07T03:12:00Z
- updated_at: 2026-06-07T03:12:00Z
- title: Dead/unwired JS helpers introduced in dashboard-logic.mjs
- details: |
  This slice adds three exported helpers in
  `projects/quest-runner/src/quest_runner_service/dashboard_assets/dashboard-logic.mjs`
  that have no production callers:

  - `StorageRepoKey` (line ~24) — marked `@deprecated`, delegates to
    `StorageProjectKey`. A repo-wide grep finds it only at its definition; neither
    `app.js` nor any test imports it.
  - `ResolveRepositorySelection` (line ~63) — marked `@deprecated`, delegates to
    `ResolveProjectSelection`. A repo-wide grep finds it only at its definition;
    `app.js` now calls `ResolveProjectSelection`, and the test file dropped the
    `ResolveRepositorySelection` import.
  - `CanonicalQuestDashboardUrl` (line ~116) — exported and unit-tested, but never
    imported by `app.js`. The canonical dashboard URL actually rendered to users is
    produced server-side (`quest_dashboard_url` in `dashboard_data.py`, asserted in
    `test_dashboard_api.py`), so this JS helper is unused in the live UI.
- why it is a problem: |
  These are backwards-compatibility shims and unwired helpers for a freshly
  migrated, self-contained project with no external JS consumers. They are dead
  code: they add maintenance surface, can drift from the real (server-side)
  behavior, and `CanonicalQuestDashboardUrl` is "covered" only by a test of code
  nothing else exercises, giving a false impression of coverage. This conflicts
  with keeping the migrated implementation clean and maintainable.
- what must be true to mark completed: |
  Either (a) remove `StorageRepoKey`, `ResolveRepositorySelection`, and
  `CanonicalQuestDashboardUrl` (and their tests, for the canonical-url helper)
  since they have no callers, or (b) wire the intended helper(s) into `app.js`
  where they belong (e.g. use `CanonicalQuestDashboardUrl` for quest links) so the
  exports are actually exercised by production code. The implementer should also
  justify, in the response file, retaining any deprecated shim if there is a
  concrete consumer that needs it.
- resolution_notes: none
