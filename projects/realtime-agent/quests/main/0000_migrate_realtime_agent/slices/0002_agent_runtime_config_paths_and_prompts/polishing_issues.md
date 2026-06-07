# Issues

## Issue PI-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-07T00:00:00Z
- updated_at: 2026-06-07T21:30:00Z
- title: Committed crash.log artifact in agent source tree
- details: |
  A native crash dump is committed to the repository at
  `projects/realtime-agent/src/agent/crash.log` (tracked by git, 33 lines). It is
  a SIGSEGV backtrace from naudiodon's `getDevices` (PID 7795, fault address
  0x0), produced during microphone device enumeration.

  Why it is a problem:
  - It is a runtime/crash artifact, not source, and must never be in version
    control. The slice scope is config paths, secrets, prompts, runtime data, and
    structured logs; a crash dump is unrelated cruft that pollutes the slice diff
    and the migrated tree.
  - It is not covered by any `.gitignore` (neither
    `projects/realtime-agent/.gitignore` nor the root `.gitignore`), so it will be
    re-committed if regenerated.
- resolution_notes: |
  To mark completed, the following must be true:
  - `projects/realtime-agent/src/agent/crash.log` is no longer tracked by git
    (verify `git ls-files projects/realtime-agent | grep crash.log` returns
    nothing).
  - A `.gitignore` rule (e.g. `crash.log`) prevents future accidental commits of
    segfault dumps in the agent tree.

  Verification 2026-06-07: Both criteria met in the observed repo state.
  `git ls-files projects/realtime-agent/src/agent/crash.log` returns nothing,
  `git status --short` for the path is clean, and the file is absent from disk,
  so it is neither tracked nor pending. `projects/realtime-agent/.gitignore`
  now contains a `crash.log` rule (line 11) preventing recurrence. Note: the
  polisher's response reported `git rm --cached` was blocked by a sandbox
  worktree-index limitation, but the deletion has since been completed, so the
  end state is fully resolved. Closing on observed repo state.
