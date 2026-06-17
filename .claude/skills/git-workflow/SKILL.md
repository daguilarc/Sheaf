---
name: git-workflow
description: Linear Git workflow, rebase discipline, and the land procedure.
metadata:
  managedBy: sheaf-agents-installer
  source: projects/agents/global/skills/git-workflow
---

<!-- sheaf-agents-managed: DO NOT EDIT; source=projects/agents/global/skills/git-workflow -->

# Git Workflow

Use this skill when creating branches, rebasing, landing work, or interpreting
the user's Git workflow instructions.

Follow a linear Git doctrine.

`main` stays clean. Do not develop directly on `main` unless explicitly
instructed. Create a worktree for feature work.

When creating a worktree, first use the active harness's native managed worktree
feature if one is available. For Codex, prefer the Codex desktop managed
thread/worktree tooling over manually running `git worktree` and choosing a
directory.

Never merge. Never use merge commits as part of normal development or landing.

Definitions:

- `rebase` means rebase the current working branch on `main`.
- `land` means archive with OpenSpec if you're applying an OpenSpec change,
  rebase the working branch on `main`, fast-forward `main` to the working
  branch, identify any services changed by the landed work, delete the working
  branch, delete the worktree, push `main`, then rebuild and redeploy the
  changed services from `main`.

When landing an OpenSpec change, first verify the change is actually ready for
archiving. If artifacts or tasks are incomplete, or the archive workflow would
require confirmation to proceed despite incomplete work, stop and do not
continue with the land until the change is ready to archive.

Landing procedure:

1. Archive with OpenSpec if you're applying an OpenSpec change.
2. Rebase the working branch on `main`.
3. Fast-forward `main` to the working branch.
4. Identify any services changed by the landed work and note how to rebuild and
   redeploy them.
5. Delete the working branch.
6. Delete the worktree.
7. Push `main`.
8. Rebuild and redeploy the services changed by the landed work from `main`.
