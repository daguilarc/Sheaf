## Why

Agent assets currently have overlapping distribution paths: shared skills are
installed both globally and into every Sheaf worktree, while xagent is packaged
as a plugin but is only invoked from repository source and its skill is also
installed separately. This creates stale copies, makes the supposedly portable
xagent workflow depend on a Sheaf checkout, and leaves no supported Make target
that installs xagent as a real global Codex plugin.

## What Changes

- **BREAKING** Stop rendering skills from `projects/agents/global/skills/`
  into repo-local harness directories; those skills install only into their
  user-global destinations.
- Keep `projects/agents/sheaf/skills/smoke-test/` repo-local only and continue
  rendering it for its declared harness targets.
- Detect and safely remove obsolete managed repo-local copies of global skills
  while preserving unmanaged files at the same paths.
- Make the xagent plugin the sole distribution owner of its bundled
  `xagent-subagents` skill, launcher, and packaged runtime rather than also
  installing a standalone managed copy of that skill.
- Add a global xagent plugin installer Make target that builds and validates the
  package, publishes or updates its personal-marketplace entry, and installs or
  reinstalls it through Codex's plugin command.
- Keep executable plugin scripts and runtime assets in the plugin package only;
  do not add duplicate launcher or runtime installations to PATH, global skill
  directories, or harness-specific script directories.
- Add scoped agents-installer cleanup plus documentation covering which
  installer owns every global and repo-local artifact.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agents-skill-distribution`: Shared skills become user-global only,
  Sheaf-only skills remain repo-local, plugin-owned skills are excluded from
  standalone skill installation, and obsolete managed repo-local outputs are
  pruned safely.
- `xagent-cli`: The packaged xagent distribution gains a supported global
  Codex plugin installation/update target and a single-owner contract for its
  bundled skill, launcher, and runtime.

## Impact

- Affected code: `projects/agents/scripts/install.py`, its tests and Make
  targets, agent distribution documentation, `plugins/xagent/` packaging and
  marketplace support, root Make targets, and the xagent plugin skill source.
- Removed generated files: repo-local harness copies of globally managed
  skills and the standalone globally managed `xagent-subagents` skill.
- User-global filesystem skills remain under their existing harness locations.
  The smoke-test skill remains in Sheaf worktrees. xagent becomes available
  globally through Codex plugin installation and is picked up by new Codex
  conversations after installation or reinstall.
- This repository intentionally relies on per-user global installation:
  developers, fresh machines, CI environments, and containers that need the
  shared skills or xagent must run the documented global install targets.
- The installer must write the personal marketplace under the user's home
  directory and invoke Codex plugin installation, so the global plugin install
  target requires the same explicit filesystem/process authority as other
  user-global installation operations.
