# Issues

## Issue PR-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-07T00:00:00Z
- updated_at: 2026-06-07T15:30:00Z
- title: Runtime trace.log artifact committed under projects/dictator/logs/
- details: |
  Commit 96423a3 (quest-step 12) added a tracked runtime log file
  `projects/dictator/logs/dictator/trace.log` (34 lines of launchpad/interaction
  event output). This is a generated runtime artifact, not source.

  What is wrong:
  - A runtime log is now tracked in git and was committed as part of this slice.
  - The repo `.gitignore` ignores root `logs/**` (line 21) but does NOT cover
    `projects/dictator/logs/`, so this path is not protected from future commits.
  - Root cause is test pollution: `TraceLogger` is a global singleton whose default
    `configuredLogURL` is the relative fallback `logs/dictator/trace.log`
    (TraceLogger.swift:5). Many DictatorService sources call `TraceLogger.log`
    internally (InteractionHistory, Launchpad*, DictationHTTPServer, etc.). Tests
    exercising those paths (e.g. LaunchpadTests, InteractionHistoryTests) do not
    configure an isolated log directory, so when `swift test` runs with the working
    directory at `projects/dictator`, those log writes land in
    `projects/dictator/logs/dictator/trace.log`, dirtying the tracked source tree.
    (TraceLoggerTests itself correctly uses temp dirs, so it is not the source.)

  Why it is a problem:
  - Committing runtime logs is incorrect and conflicts with the plan intent that
    logs are runtime data written under `logs/dictator/` (physicalplan/plan.md
    objective + validation "logs write to logs/dictator/").
  - Every future test run re-creates/grows this file, producing a perpetually dirty
    working tree. The v2 runner refuses to invoke a harness when the working tree is
    not clean (untracked files included), so this can block subsequent quest steps.
  - The committed log content is environment/run-specific noise that will churn in
    diffs.

  What must be true to mark this issue completed:
  - The tracked file `projects/dictator/logs/dictator/trace.log` is removed from the
    repository (no longer returned by `git ls-files`).
  - `projects/dictator/logs/` (or an equivalent broader rule covering project-level
    `logs/` directories) is gitignored so the artifact cannot be re-committed.
  - Test runs no longer write trace logs into the tracked source tree: either tests
    that trigger `TraceLogger.log` configure an isolated/temp log directory, or
    `TraceLogger`'s default resolves to a location outside the tracked tree (and is
    ignored). After a full `make dictator-test`, `git status` shows no new/modified
    files under `projects/dictator/logs/`.
- resolution_notes: |
  Verified fixed.
  - `git ls-files 'projects/dictator/logs/**'` returns nothing; the tracked
    `projects/dictator/logs/dictator/trace.log` artifact has been removed.
  - `projects/dictator/.gitignore` now contains `logs/`, so any project-local
    `logs/` directory is ignored. The repo-root `.gitignore` `logs/**` rule covers
    the repo-root path.
  - `TraceLogger.swift:12` now initializes the default `configuredLogURL` via
    `resolvedDefaultLogURL()`, which uses `SheafRootDiscovery.findRepoRoot()` to
    resolve to repo-root `logs/dictator/trace.log` (gitignored). Even the relative
    fallback path is now covered by the project `.gitignore`, so test runs cannot
    pollute the tracked tree regardless of working directory.
  - `git status --short` is clean.
