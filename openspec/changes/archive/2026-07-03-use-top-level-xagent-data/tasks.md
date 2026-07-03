## 1. Regression Coverage

- [x] 1.1 Add an xagent test that launches or exercises the CLI with `cwd` set to a nested `projects/xagent` directory inside a temporary Sheaf-like repository.
- [x] 1.2 Assert the default run record is created under the temporary repository root's `data/xagent/` directory.
- [x] 1.3 Assert no run record is created under `projects/xagent/data/xagent/`.
- [x] 1.4 Assert `xagent list` and `xagent logs <run_id>` read from the same top-level default log root when invoked from the nested package directory.

## 2. Log Root Resolution

- [x] 2.1 Add repository-root resolution for non-overridden xagent log roots so `projects/xagent` resolves back to the Sheaf checkout root.
- [x] 2.2 Preserve `XAGENT_LOG_ROOT` as the highest-priority explicit override for run, list, and logs commands.
- [x] 2.3 Keep packaged launcher behavior intact by continuing to honor its configured central log root.

## 3. Repository Hygiene

- [x] 3.1 Remove tracked generated files under `projects/xagent/data/xagent/` from the repository.
- [x] 3.2 Verify generated xagent run logs under top-level `data/xagent/` are ignored by the existing `data/**` rule.
- [x] 3.3 Avoid adding `projects/xagent/data/xagent/` as the primary ignore fix unless implementation verification shows an unavoidable compatibility need.

## 4. Verification

- [x] 4.1 Run the focused xagent test suite.
- [x] 4.2 Run OpenSpec validation/status for `use-top-level-xagent-data`.
- [x] 4.3 Confirm `git status --ignored` shows generated top-level xagent logs as ignored and no tracked `projects/xagent/data/xagent/` files remain.
