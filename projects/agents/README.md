# Agents

`projects/agents` is the source of truth for shared agent guidance in this
repository.

## Layout

```text
global/
  AGENTS.md
  skills/
    <skill-id>/
      skill.yaml
      SKILL.md
sheaf/
  skills/
    <skill-id>/
      skill.yaml
      SKILL.md
```

`global/AGENTS.md` is rendered to the repository root as both `AGENTS.md` and
`CLAUDE.md`, and to user-global harness locations when global install scope is
enabled.

`global/skills/` contains skills that are safe to install into user-global
harness locations. `sheaf/skills/` contains Sheaf-only skills that render into
this repository's harness directories only.

Each skill directory contains:

- `skill.yaml`: stable metadata used by the installer
- `SKILL.md`: harness-neutral source instructions

## Metadata

`skill.yaml` uses a small YAML subset:

```yaml
id: incremental-mode
name: incremental-mode
description: Follow explicit keyboard-style instructions without adjacent initiative.
targets:
  - claude
  - cursor
  - pi
  - codex
```

Supported targets are `claude`, `cursor`, `pi`, and `codex`.

## Commands

```shell
make install
make check
make clean
make install-repo
make check-repo
make clean-repo
make install-global
make check-global
make clean-global
```

Run these from `projects/agents`, or use the root shortcuts:

```shell
make agents-install
make agents-check
make agents-clean
make agents-install-repo
make agents-check-repo
make agents-clean-repo
make agents-install-global
make agents-check-global
make agents-clean-global
```

Default `install`, `check`, and `clean` operate on both repo-local and
user-global outputs. The `*-repo` and `*-global` targets limit the scope.
Repo-local outputs include both global skills and Sheaf-only skills. User-global
outputs include only global skills.

User-global outputs are written to:

- `~/.claude/CLAUDE.md`
- `~/.claude/skills/<skill-id>/SKILL.md`
- `~/.cursor/AGENTS.md`
- `~/.cursor/skills/<skill-id>/SKILL.md`
- `~/.pi/AGENTS.md`
- `~/.pi/skills/<skill-id>/SKILL.md`
- `~/.agents/skills/<skill-id>/SKILL.md`
- `$CODEX_HOME/AGENTS.md`
- `$CODEX_HOME/skills/<skill-id>/SKILL.md`
- `$CODEX_HOME/hooks/sheaf/session_start_after_compact.py`
- `$CODEX_HOME/hooks.json`

`CODEX_HOME` defaults to `~/.codex`.

The Codex hook is a user-global `SessionStart` hook for the `compact` source.
After Codex compacts a session, it injects a short developer-context reminder:
if the agent was working from a plan, checklist, or task list, it should review
that material after compaction. Codex may require reviewing and trusting the
new command hook through `/hooks` before it runs.

Because Codex uses a single user-level `$CODEX_HOME/hooks.json` file, the
installer treats that file like other managed outputs: it writes the managed
file when missing or already managed, and it fails on an unmanaged conflicting
file unless `--force` is passed. If you already maintain personal Codex hooks,
review and merge the Sheaf hook intentionally before forcing installation.

To explicitly replace unmanaged destination files during install, pass the
installer flag through make:

```shell
make agents-install-global AGENTS_INSTALL_FLAGS=--force
```
