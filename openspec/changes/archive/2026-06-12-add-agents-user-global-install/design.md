## Context

The current `agents-skill-distribution` capability has a naming trap: the source tree is `projects/agents/global`, but installation is repo-local. The installer writes root `AGENTS.md`/`CLAUDE.md` and harness-specific repo folders such as `.claude/skills` and `.codex/skills`.

The user intended "global" to mean user-global agent configuration: install the same guidance and skills where Claude Code, Cursor, Pi, and Codex can see them outside this repository. The repo-local generated outputs are still useful as checked-in team/project outputs, but they are not sufficient.

Codex also has two relevant global skill surfaces in this environment:

- `$HOME/.agents/skills/<skill-id>/SKILL.md`, the documented user-skill location.
- `$CODEX_HOME/skills/<skill-id>/SKILL.md`, the Codex-home skill location already used by this setup.

## Goals / Non-Goals

**Goals:**

- Preserve existing repo-local install/check/clean behavior.
- Add user-global install/check/clean behavior.
- Make `make agents-install` install both scopes by default.
- Add explicit Makefile targets for repo-only and global-only install/check/clean.
- Use deterministic destination maps rather than ad hoc path construction spread through the script.
- Keep generated-file marker safety for all destinations, including home-directory outputs.
- Verify global outputs are outside `/Users/joyo/Sheaf`.

**Non-Goals:**

- Removing repo-local generated skill outputs.
- Publishing a Codex plugin or external package.
- Solving cloud/host sync for other machines.
- Guessing product-specific hidden paths at runtime without a configured destination map.

## Decisions

### 1. Install Scopes

Add a `--scope` option to `projects/agents/scripts/install.py` for `install`, `check`, and `clean`:

```shell
projects/agents/scripts/install.py install --scope all
projects/agents/scripts/install.py install --scope repo
projects/agents/scripts/install.py install --scope global
```

`all` is the default and means repo-local plus user-global outputs. This makes `make agents-install` do the thing the user expected while preserving focused operations for tests and rollback.

### 2. User-Global Destination Map

Define global destinations centrally in the installer:

```text
Claude Code instructions: $HOME/.claude/CLAUDE.md
Claude Code skills:       $HOME/.claude/skills/<skill-id>/SKILL.md

Cursor instructions:      $HOME/.cursor/AGENTS.md
Cursor skills:            $HOME/.cursor/skills/<skill-id>/SKILL.md

Pi instructions:          $HOME/.pi/AGENTS.md
Pi skills:                $HOME/.pi/skills/<skill-id>/SKILL.md

Codex instructions:       $CODEX_HOME/AGENTS.md, defaulting to $HOME/.codex/AGENTS.md
Codex skills:             $HOME/.agents/skills/<skill-id>/SKILL.md
Codex-home skills:        $CODEX_HOME/skills/<skill-id>/SKILL.md, defaulting to $HOME/.codex/skills/<skill-id>/SKILL.md
```

`CODEX_HOME` should be read from the environment if present and default to `~/.codex`.

### 3. Repo-Local Destination Map Remains

Keep existing repo-local outputs:

```text
AGENTS.md
CLAUDE.md
.claude/skills/<skill-id>/SKILL.md
.cursor/skills/<skill-id>/SKILL.md
.pi/skills/<skill-id>/SKILL.md
.codex/skills/<skill-id>/SKILL.md
```

These remain useful because they are checked into the repo and make the source-of-truth state reviewable.

### 4. Makefile Targets

Keep current targets and add explicit scope-specific shortcuts:

```text
make agents-install          # all scopes
make agents-check            # all scopes
make agents-clean            # all scopes
make agents-install-repo
make agents-check-repo
make agents-clean-repo
make agents-install-global
make agents-check-global
make agents-clean-global
```

The root Makefile should delegate all of these to `projects/agents/Makefile`.

### 5. Safety Model

All generated files, whether repo-local or user-global, use the same managed marker. Install refuses to overwrite an unmarked conflicting file unless `--force` is passed. Clean removes only managed outputs.

This is especially important for home-directory destinations, where manually authored agent instructions are plausible.

## Risks / Trade-offs

**Risk: Existing user-global files already exist and are unmanaged.**

Mitigation: installation fails with the path and does not overwrite. The user can decide whether to merge, remove, or rerun with `--force`.

**Risk: Codex has multiple skill discovery locations.**

Mitigation: install to both documented user skills (`~/.agents/skills`) and Codex-home skills (`$CODEX_HOME/skills`) until this repo intentionally narrows the Codex target surface.

**Risk: Global clean could remove useful files.**

Mitigation: clean only removes files with the managed marker.

**Risk: A global destination is wrong for a harness.**

Mitigation: paths are centralized in one map, documented in the spec, and covered by check/install output. If a harness path changes, update the map and spec together.

## Migration Plan

1. Add scope-aware output construction to the installer.
2. Add user-global instruction and skill destination maps.
3. Update project and root Makefiles with repo/global scoped targets.
4. Run `make agents-install-global` and `make agents-check-global`.
5. Run `make agents-install` and `make agents-check` to verify all scopes.
6. If unmanaged global conflicts are found, stop and let the user decide how to merge or force them.
