# Issues

## Issue PI-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-06T19:35:00Z
- updated_at: 2026-06-06T19:35:00Z
- title: Compiled Python bytecode (__pycache__/*.pyc) committed into the repo
- details: |
  Commit 1b0b5f1 adds 33 tracked `.pyc` files under
  `projects/quest-runner/src/.../__pycache__/`,
  `projects/quest-runner/src/.../state_machine/__pycache__/`, and
  `projects/quest-runner/tests/__pycache__/`. The set includes bytecode for two
  different interpreters (`cpython-312` and `cpython-314`), e.g.
  `quest_fs.cpython-314.pyc`, `machine.cpython-312.pyc`,
  `test_quest_fs_core.cpython-314.pyc`.

  These are build artifacts that should never be version-controlled:
  - They bloat the diff/repo and create noise on every future commit.
  - Mixed-interpreter bytecode can mask stale-bytecode bugs and is meaningless to
    a reviewer.
  - The project `.gitignore` only contains `.venv/`, and the root `.gitignore`
    has no `__pycache__/` or `*.pyc` rule, so nothing prevents recurrence. The
    `Makefile clean` target deletes them locally but they remain tracked in git.

  Why it is a problem: committing compiled artifacts violates standard Python
  project hygiene, defeats the purpose of `.gitignore`, and will keep
  reintroducing churn as the migration progresses through later slices.
- resolution_notes: |
  To mark completed, the following must be true:
  - No `__pycache__` directories or `*.pyc` files are tracked under
    `projects/quest-runner/` (verify with `git ls-files projects/quest-runner |
    grep -E 'pyc'` returning nothing).
  - `projects/quest-runner/.gitignore` (or the root `.gitignore`) ignores
    `__pycache__/` and `*.pyc` so the artifacts cannot be re-added.

## Issue PI-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-06T19:35:00Z
- updated_at: 2026-06-06T19:35:00Z
- title: POST /exit is non-functional under the pinned Flask 3.x
- details: |
  `projects/quest-runner/src/quest_runner_service/__main__.py:26-32` implements
  `POST /exit` by calling `request.environ.get("werkzeug.server.shutdown")` and
  invoking it. The `werkzeug.server.shutdown` environ hook was removed in
  Werkzeug 2.1. `requirements.txt` pins `flask>=3.0`, which requires
  Werkzeug >=3.0, so this hook is never present at runtime. The handler will
  always fall into the `func is None` branch and return HTTP 500
  `{"error": "shutdown not available"}`. The endpoint can never actually exit
  the service.

  Why it is a problem:
  - `implementation_done.md` explicitly claims the entry point exposes a
    "Sheaf-standard `GET /health` and `POST /exit`", but the delivered `/exit`
    is broken, so the stated deliverable is inaccurate.
  - `structure/services.md` requires registered services to expose a `POST /exit`
    that exits cleanly. Service registration is planned for slice 4, which will
    depend on a working `/exit`; shipping a known-broken implementation now hides
    the defect until that slice.
  - A handler that unconditionally 500s is an obvious correctness bug for any
    caller relying on it.
- resolution_notes: |
  To mark completed, the following must be true:
  - `POST /exit` cleanly terminates the service when run under the pinned
    Flask/Werkzeug 3.x stack (e.g. via `os._exit`/signal/threaded shutdown rather
    than the removed `werkzeug.server.shutdown` hook), OR the endpoint and the
    `implementation_done.md` claim are removed/deferred consistently so no broken
    endpoint is shipped.
  - The behavior is verifiable without depending on a Werkzeug API that does not
    exist in the pinned version.
