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
vendor/
  openspec/
    VENDOR.toml
    package/          # offline OpenSpec CLI + production node_modules
  superpowers/
    VENDOR.toml
    tree/             # pinned Superpowers upstream checkout
```

`global/AGENTS.md` is rendered to the repository root as both `AGENTS.md` and
`CLAUDE.md`, and to user-global harness locations when global install scope is
enabled.

`global/skills/` contains skills that are safe to install into user-global
harness locations. `sheaf/skills/` contains Sheaf-only skills that render into
this repository's harness directories only.

`vendor/` holds pinned offline-capable OpenSpec and Superpowers trees. Sync
them with `make vendor-sync` (or `make agents-vendor-sync` from the repo root).

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

Skills may target any subset of supported harnesses. For example, a Sheaf-only
Codex skill declares only:

```yaml
targets:
  - codex
```

Repo-local installs render that Sheaf skill only under `.codex/skills/`.
User-global installs render shared Codex skills only to the documented Codex
user skill locations:
`~/.agents/skills/` and `$CODEX_HOME/skills/`.

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
make vendor-sync TOOL=openspec REF=1.4.1
make vendor-sync TOOL=superpowers REF=v6.2.0
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
make agents-vendor-sync TOOL=openspec REF=1.4.1
make agents-vendor-sync TOOL=superpowers REF=v6.2.0
```

`vendor-sync` refreshes the offline vendor trees under `vendor/openspec` and
`vendor/superpowers`. Pass `FORCE=1` to clobber local vendor modifications.
Superpowers sync deletes `tree/.gitignore` so the repo-root vendor un-ignore wins.
Install still runs separately via `make agents-install`.

Default `install`, `check`, and `clean` operate on both repo-local and
user-global outputs. The `*-repo` and `*-global` targets limit the scope.
Repo-local outputs contain repository instructions and Sheaf-only skills.
Shared skills install only through agents-install-global.
Plugin-owned skills such as xagent-subagents are excluded from the agents installer.

## Skill Ownership

```text
Shared skills: projects/agents/global/skills -> agents-install-global
smoke-test: projects/agents/sheaf/skills/smoke-test -> agents-install-repo
xagent-subagents + launcher + runtime: plugins/xagent -> xagent-plugin-install-global
```

Install or update the xagent plugin package with:

```shell
make xagent-plugin-install-global
```

Open a new Codex conversation after installing or updating the plugin so Codex
reloads the installed skill and launcher metadata. If recovery is needed, rerun
`make xagent-plugin-install-global`. If the installed package is unmarked,
inspect it and move it aside manually rather than forcing overwrite.

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
