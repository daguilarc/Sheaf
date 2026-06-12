## Why

The agents skill distribution currently installs generated outputs only into this repository, even though the intended outcome was to make the shared guidance and skills available globally to the user's agent harnesses. The spec needs to distinguish repo-local generated outputs from true user-global installation targets so the installer can put files where agents see them outside this repo.

## What Changes

- Extend the agents installer with a user-global install mode for shared `AGENTS.md`/`CLAUDE.md` guidance and skills.
- Keep the existing repo-local install behavior for checked-in harness outputs unless explicitly disabled.
- Add check/clean behavior for user-global outputs, with the same managed-file marker and unmanaged-conflict protections as repo-local outputs.
- Document exact destination roots for each supported harness, including Codex user skills and global AGENTS guidance.
- Update Makefile targets so `make agents-install` installs both repo-local and user-global outputs, with explicit targets for repo-only and global-only operation.
- Add verification tasks that prove global outputs exist outside `/Users/joyo/Sheaf`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agents-skill-distribution`: add requirements for true user-global install, check, and clean behavior in addition to the existing repo-local generated outputs.

## Impact

- `projects/agents/scripts/install.py` gains install scopes and user-global destination support.
- `projects/agents/Makefile` and the root `Makefile` gain explicit repo/global install and check targets.
- Generated files may be written outside the repository under user-level agent configuration directories.
- Tests/checks need to cover both repository output drift and user-global output drift.
