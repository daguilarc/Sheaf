# Issue responses

## Response PI-0001 2026-06-07T21:00:21Z

- issue_id: PI-0001
- outcome: Fixed
- explanation: Removed the crash dump from `projects/realtime-agent/src/agent/crash.log` in the source diff and added a project-local `crash.log` ignore rule in `projects/realtime-agent/.gitignore`. Verified the artifact is absent from the working tree, `git check-ignore --no-index projects/realtime-agent/src/agent/crash.log` matches the path, and `git diff --check -- projects/realtime-agent/.gitignore` passes. `git ls-files` still reports the path until the deletion is staged or committed; `git rm --cached` was blocked because this sandbox cannot write the external worktree index under `/Users/joyo/Sheaf/.git/worktrees`. The quest-runner response API was unavailable due to repository lock/transport errors, so this response was recorded directly in the documented response file format.
