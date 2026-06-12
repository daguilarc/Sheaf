# Git Workflow

Use this skill when creating branches, rebasing, landing work, or interpreting
the user's Git workflow instructions.

Follow a linear Git doctrine.

`main` stays clean. Do not develop directly on `main` unless explicitly
instructed. Create a worktree for feature work.

Never merge. Never use merge commits as part of normal development or landing.

Definitions:

- `rebase` means rebase the current working branch on `main`.
- `land` means archive with OpenSpec if you're applying an OpenSpec change,
  rebase the working branch on `main`, fast-forward `main` to the working
  branch, delete the working branch, and delete the worktree.

When landing an OpenSpec change, first verify the change is actually ready for
archiving. If artifacts or tasks are incomplete, or the archive workflow would
require confirmation to proceed despite incomplete work, stop and do not
continue with the land until the change is ready to archive.

Landing procedure:

1. Archive with OpenSpec if you're applying an OpenSpec change.
2. Rebase the working branch on `main`.
3. Fast-forward `main` to the working branch.
4. Delete the working branch.
5. Delete the worktree.
