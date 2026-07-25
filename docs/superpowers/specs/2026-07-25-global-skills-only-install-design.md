# Global Skills Only Installation Design

## Goal

Stop installing skills sourced from `projects/agents/global/skills/` into
repository-local harness directories. Global skills remain installed only in
the supported user-global locations. Skills sourced from
`projects/agents/sheaf/skills/` remain repository-local.

## Scope

The change applies to repo-local skill outputs under:

- `.claude/skills/`
- `.cursor/skills/`
- `.pi/skills/`
- `.codex/skills/`

It does not change:

- repo-local `AGENTS.md` or `CLAUDE.md` generation;
- user-global instruction or skill installation;
- target filtering declared in each `skill.yaml`;
- Sheaf-only repo-local skill installation;
- unmanaged-file conflict and preservation behavior.

## Installer Behavior

`build_repo_outputs` will render repo-local instruction files and Sheaf-only
skills. It will no longer include skills loaded from the global skills source.

The installer will separately derive the old repo-local paths for global
skills as obsolete outputs. Scope-specific modes will handle them as follows:

- `install --scope repo` and `install --scope all` remove obsolete files after
  installing desired outputs.
- `check --scope repo` and `check --scope all` report obsolete managed files
  as an error.
- `clean --scope repo` and `clean --scope all` remove both current desired
  outputs and obsolete managed outputs.
- Global-only modes do not inspect or modify repo-local obsolete outputs.

Cleanup continues to rely on the existing managed marker. An unmanaged file at
an obsolete path is preserved.

## Repository State

After running the updated repo installer, all tracked repo-local copies of
global skills are deleted. Repo-local Sheaf-only skills, currently
`smoke-test`, remain generated and tracked. Global copies under the user's home
directory remain unchanged.

## Documentation

`projects/agents/README.md` will state that repo-local installation renders
only Sheaf-specific skills and that global skills are available exclusively
from user-global harness locations.

## Testing

Installer unit tests will verify:

1. Global skills are absent from desired repo outputs.
2. Sheaf-only skills remain in desired repo outputs for their declared targets.
3. Global skill outputs remain present in user-global output sets.
4. Repo installation removes obsolete managed global-skill files.
5. Repo installation preserves unmanaged files at obsolete paths.
6. Repo checks fail while an obsolete managed file exists and pass after
   cleanup.

Verification will run the installer unit tests, the repo-local consistency
check, and the global consistency check.
