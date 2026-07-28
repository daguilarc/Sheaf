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

`vendor/` holds pinned offline-capable OpenSpec and Superpowers trees. Those
trees are the source of truth for Sheaf agent work. Sync them with
`make vendor-sync` (or `make agents-vendor-sync` from the repo root), then
install with `make install` / `make agents-install`. Do not rely on
`npm install -g @fission-ai/openspec`, Claude/Cursor/Codex marketplace
Superpowers plugins, or `pi install git:github.com/obra/superpowers` for
Sheaf work.

Approximate vendor tree sizes at the current pins: OpenSpec `package/`
(including production `node_modules`) is about 21M; Superpowers `tree/` is
about 2M.

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
Plugin-owned skills such as xagent-subagents are excluded from the agents
filesystem skill renderer (`install.py`).

## Node.js

Repo install, repo check, and `make test` / `make agents-test` require
Node.js ≥20.19 (OpenSpec's engine floor). Generation and byte-reproducible
check of vendored OpenSpec harness skills/commands both invoke the vendored
CLI entry point. Global OpenSpec CLI install skips with an explicit warning
when Node is missing or too old, and still installs other global agents
outputs; it never falls back to `npm install -g`.

## Installer ownership (asd-23)

asd-23 keeps Sheaf plugin-owned skills such as `xagent-subagents` out of
`install.py`'s filesystem skill renderer. Superpowers is different: it is
third-party vendored tooling under `projects/agents/vendor/superpowers/`,
distributed as managed local plugins/packages. That is a deliberate
agents-project responsibility and an explicit exception to “do not install
plugin packages through `install.py`'s filesystem skill renderer.”

`install.py` remains unaware of Superpowers. Make (and root `agents-*`
targets) run `scripts/install.py` and `scripts/install_superpowers.py` as
sibling steps whenever the scope includes global. Running
`install.py install --scope global` alone does not install Superpowers.

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

## Vendored tooling install

Global install also copies the vendored OpenSpec CLI into a Sheaf-managed
prefix and writes a shim:

- package: `~/.local/share/sheaf/vendor/openspec/`
- shim: `~/.local/share/sheaf/bin/openspec`

Put `~/.local/share/sheaf/bin` on your `PATH` ahead of any Homebrew or
`npm install -g` `openspec` so the managed shim wins. The installer does
not edit shell rc files. If an older global npm package remains, prefer
PATH order over deleting it; agents install never auto-removes foreign
CLIs.

Global install also installs Superpowers as managed local plugins from
`vendor/superpowers/tree/`:

| Harness | Managed package path | Discovery |
| --- | --- | --- |
| Claude | `~/.claude/plugins/cache/sheaf-managed/superpowers/<version>/` | `superpowers@sheaf-managed` in `installed_plugins.json`, sheaf-managed marketplace record, and `enabledPlugins` in `~/.claude/settings.json` (install alone without enable leaves skills on disk but invisible to sessions) |
| Cursor | `~/.cursor/plugins/local/superpowers/` | Cursor has no sheaf-managed JSON registry entry; presence under `plugins/local/` is the install. Expect skills as `superpowers:<id>` once Cursor loads local plugins (may need a new Agent session). |
| Codex | `~/.agents/plugins/plugins/superpowers/` | Local-source entry for `superpowers` in `~/.agents/plugins/marketplace.json`. Staging alone may leave `codex plugin list` showing the plugin as available but not installed; run `codex plugin add superpowers@<marketplace-name>` once (suffix is the `name` field of that marketplace file; fresh installs default to `personal`), then open a new conversation. |
| Pi | `~/.pi/packages/sheaf-managed/superpowers/` | Absolute path in `~/.pi/agent/settings.json` `packages` |

Each managed package carries a `.sheaf-managed` marker with the vendor
`revision` and `version`. Superpowers Codex hooks stay inside that managed
Codex plugin; they are not merged into Sheaf-owned `$CODEX_HOME/hooks.json`.

### Marketplace Superpowers coexistence

Marketplace or `pi install` Superpowers copies may still exist on the
machine. For Sheaf work, disable or remove them so skill ids resolve from
the managed package only:

- Claude: uninstall or disable `superpowers@claude-plugins-official` (or
  `superpowers@superpowers-marketplace`) via `/plugin` / plugin UI, or
  remove that key from `~/.claude/plugins/installed_plugins.json` after
  confirming you no longer need the marketplace copy.
- Cursor: remove any marketplace Superpowers install from Cursor's plugin
  UI so it does not compete with `~/.cursor/plugins/local/superpowers/`.
- Codex: disable or remove non-Sheaf `superpowers` marketplace entries;
  keep only the sheaf-managed local path entry.
- Pi: remove any `git:github.com/obra/superpowers` (or similar) package
  entry from `~/.pi/agent/settings.json` `packages`.

`install_superpowers.py` (and therefore `make install` /
`make agents-install` when global scope runs) refuses without `--force`
when a foreign Claude key such as `superpowers@claude-plugins-official`
is present, or when an unmanaged same-key / same-destination conflict
exists. That avoids dual `superpowers:<id>` registration. Pass
`AGENTS_INSTALL_FLAGS=--force` only when you intentionally keep the
foreign copy alongside the managed package. Clean removes only
sheaf-managed Superpowers packages and registry keys; it never deletes
foreign marketplace copies.

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
