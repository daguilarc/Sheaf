## Context

Sheaf's agents installer already owns shared skills, Sheaf-only skills, global
instructions, and Codex hooks from `projects/agents`. OpenSpec and Superpowers
sit outside that ownership today:

| Tool | Current install | What agents need |
| --- | --- | --- |
| OpenSpec | Global npm `@fission-ai/openspec`; `openspec init/update` writes repo harness skills/commands | CLI without global npm; managed skills/commands for claude/cursor/pi/codex |
| Superpowers | Harness marketplaces / `pi install git:github.com/obra/superpowers` | Managed local plugin/package installs for the four harnesses, preserving `superpowers:` skill ids |

Upstream install research:

- **OpenSpec** (`Fission-AI/OpenSpec`): Node ≥20.19 CLI. Published package ships
  prebuilt `dist/` plus 10 runtime deps (not bundled). `openspec update`
  regenerates workflow skills and tool-specific `opsx-*` commands/prompts, and
  can also manage `<!-- OPENSPEC:START/END -->` blocks in instruction files.
- **Superpowers** (`obra/superpowers`): No standalone `bin` CLI. Skills under
  `skills/` plus harness plugin metadata; skills are consumed as
  `superpowers:<id>` when installed as a plugin.

Constraint: keep the agents installer's managed-file contract. Do not clear
harness skill directories wholesale. Root `AGENTS.md` / `CLAUDE.md` remain
agents-installer-owned (asd-5).

## Goals / Non-Goals

**Goals:**

- Vendor OpenSpec and Superpowers under
  `projects/agents/vendor/{openspec,superpowers}` at pinned revisions with
  offline-installable trees.
- Make `make agents-install` the supported install path for these tools into
  Claude, Cursor, Pi, and Codex for Sheaf work.
- Install the OpenSpec CLI from vendor without `npm install -g`.
- Install Superpowers as managed local plugin/package packages so the
  `superpowers:` namespace and hooks keep working.
- Provide a documented vendor-update path when bumping upstream pins.

**Non-Goals:**

- Vendoring every OpenSpec-supported tool beyond claude/cursor/pi/codex.
- Replacing OpenSpec planning data (`openspec/specs`, `openspec/changes`).
- Rewriting OpenSpec or Superpowers upstream behavior.
- Publishing Sheaf forks to public marketplaces.
- Automatically uninstalling a user's existing global npm OpenSpec or
  marketplace Superpowers plugins (document coexistence and recommended
  disable/remove; optional cleanup later).
- Putting a fictional `superpowers` CLI on PATH.
- Merging Superpowers hooks into Sheaf-owned `$CODEX_HOME/hooks.json` in this
  change (Codex Superpowers hooks come only from the managed Superpowers Codex
  plugin package).

## Decisions

### 1. Vendor layout, artifact shape, and pinning (resolves C1, I2, M5)

```text
projects/agents/vendor/
  openspec/
    VENDOR.toml      # url, revision, version, retrieved_at
    package/         # offline-installable package tree (incl. node_modules, dist, bin)
  superpowers/
    VENDOR.toml
    tree/            # full upstream checkout used to build managed plugins
```

All normative paths use this nesting. The OpenSpec CLI entry point is
`projects/agents/vendor/openspec/package/bin/openspec.js`. Superpowers install
reads `projects/agents/vendor/superpowers/tree/`.

**OpenSpec vendored artifact:** a complete offline-installable package tree under
`openspec/package/`: published package contents (`dist/`, `bin/`, `schemas/`,
`package.json`, …) **plus** a fully resolved production `node_modules/`. Sync may
use the network once; subsequent `agents-install` MUST NOT fetch from GitHub or
npm.

**Superpowers vendored artifact:** a full upstream tree at
`superpowers/tree/` for a pinned revision (skills, plugin manifests, hooks,
`.pi` extension). Sync may use the network once; install copies from that tree
only.

Pin metadata MUST include at least: `url`, `revision`, `version` (semver as
reported by the tool where applicable; for OpenSpec this matches
`openspec --version`), and `retrieved_at`.

The vendored trees are fully git-tracked (no silent ignore of `node_modules`
under `projects/agents/vendor/`). Prefer a vendor sync script over submodules.

Alternative considered: git checkout only, build at install time. Rejected
because install would need network/`npm ci` and fails the offline requirement.

Alternative considered: package tarball without `node_modules`. Rejected for
the same offline reason.

### 2. OpenSpec CLI install (resolves I2, I8, M4)

Global install copies/links the vendored OpenSpec package tree into a
Sheaf-managed user prefix and writes an `openspec` shim:

- package root: `~/.local/share/sheaf/vendor/openspec/`
- shim: `~/.local/share/sheaf/bin/openspec`

Check compares shim `--version` to `VENDOR.toml` `version`. Clean removes only
managed prefix files. Do not silently edit shell rc files; document PATH.

**Node missing or `<20.19`:** install shared skills, instructions, and Codex
Sheaf hooks first; **skip** the OpenSpec CLI step with an explicit warning;
do not fall back to global npm. The overall global install still succeeds for
non-CLI outputs; `check --scope global` reports CLI absence/drift as a
separate failure so operators know the shim is incomplete.

**postinstall:** do not run OpenSpec's `scripts/postinstall.js` during managed
install; the vendored tree is already fully resolved.

Repo-scope generation (Decision 3) invokes the vendored package entry point
directly (`node projects/agents/vendor/openspec/package/bin/openspec.js …`),
never the user PATH shim and never requiring a prior global CLI install (I1).

### 3. OpenSpec harness artifacts (resolves C2, C3, I1, I9, I11, M2)

Repo install generates OpenSpec skills/commands for `claude`, `cursor`, `pi`,
and `codex` by invoking the vendored CLI in a **temporary workspace**, then
copying **only** skill and command/prompt outputs through the installer's write
path with managed markers.

**Never** let OpenSpec generation modify root `AGENTS.md` or `CLAUDE.md`. Those
remain exclusive agents-installer renders of `projects/agents/global/AGENTS.md`
(asd-5). Generation must not introduce `<!-- OPENSPEC:START -->` blocks into
those files.

**Pinned generation config** (recorded in vendor metadata or agents config):

- tools: `claude,cursor,pi,codex`
- workflows matching current Sheaf usage: `propose`, `apply-change`,
  `archive-change`, `explore`, `sync-specs` (five skills /
  `openspec-propose` … as currently committed)

Generation for a fixed pin + this config MUST be byte-reproducible so
`check --scope repo` can regenerate expected content and compare.

**Migration (C3):** In the same commit that lands the installer support,
regenerate the existing ~35 tracked OpenSpec harness files **with** managed
markers so the first `install --scope repo` does not hit unmanaged conflicts.
Rollback must revert those regenerated harness files together with the
installer change.

OpenSpec commands stay **repo-local only** (no user-global mirror).

### 4. Superpowers via managed local plugins (resolves C4, I3–I7, I10, R1, R4)

Global install builds **managed local plugin/package installs** from
`projects/agents/vendor/superpowers/tree` for each harness. Concrete mechanism
table (package destination, registry touch, registration, verification):

| Harness | Package destination | Registry / manifest | Registration | Verification |
| --- | --- | --- | --- | --- |
| Claude | `~/.claude/plugins/cache/sheaf-managed/superpowers/<version>/` | Merge only the `superpowers@sheaf-managed` entry in `~/.claude/plugins/installed_plugins.json` (and a sheaf-managed marketplace record under `known_marketplaces.json` / `marketplaces/` if required for discovery) | Write staged package with `.sheaf-managed` marker recording vendor `revision`+`version`; upsert registry keys owned by Sheaf | Marker present; registry entry points at destination; skill ids resolve as `superpowers:<id>` |
| Cursor | `~/.cursor/plugins/cache/sheaf-managed/superpowers/<version>/` (or Cursor's documented local-plugin cache for user-scope plugins) | Cursor plugin registry/manifest used for user plugins — merge only the sheaf-managed Superpowers entry | Same staged-package + marker pattern from vendored `.cursor-plugin` + skills/hooks | Marker + registry path; session can load Superpowers skills |
| Codex | `~/.agents/plugins/plugins/superpowers/` (parallel to xagent) | Upsert local-source entry in `~/.agents/plugins/marketplace.json` for plugin name `superpowers` only | Follow the xagent installer pattern: stage package, point marketplace local path, run Codex plugin helpers / `codex plugin` registration as needed | `codex plugin list` shows installed+enabled `superpowers` at the managed path |
| Pi | Pi user package/extension location used by `pi install` / `pi -e` (vendored `.pi` extension + `skills/`) | Pi package metadata as required by Pi's package layout | Install from local vendored tree (no `git:github.com/…`) | Pi loads Superpowers skills/extension from the managed package |

**Registry merge semantics (not avt-6 whole-file ownership):** for Claude/Cursor
JSON registries, the installer owns only named Superpowers sheaf-managed keys /
entries. It refuses to overwrite a conflicting *same-key* entry that is not
sheaf-managed without `--force`. It never rewrites unrelated plugin entries.
This is distinct from avt-6's whole-destination package rule.

Copy trees with `copy2`-equivalent semantics so executable bits on hook scripts
(`hooks/run-hook.cmd`, `hooks/session-start`, mode `0755`) are preserved.

This preserves `superpowers:writing-plans` /
`superpowers:subagent-driven-development` references required by asd-19. Do
**not** copy Superpowers skills into bare `~/.claude/skills/<id>` as the primary
install path.

**Coexistence:** marketplace copies may still exist; docs recommend
disabling/removing them for Sheaf work. Installer does not auto-delete foreign
plugins in v1. Check verifies the managed package is present, marked, and its
recorded pin matches `VENDOR.toml`.

**Codex hooks:** Superpowers Codex hooks live only inside the managed
Superpowers Codex plugin. This change does **not** merge Superpowers hooks into
Sheaf-owned `$CODEX_HOME/hooks.json`.

### 5. Installer ownership, entry points, and scopes (resolves R5, R3)

| Artifact | Scope | Entry point |
| --- | --- | --- |
| Shared Sheaf skills / AGENTS.md / Sheaf Codex hooks | unchanged | `projects/agents/scripts/install.py` |
| OpenSpec CLI (managed prefix) | global | `install.py` |
| OpenSpec skills/commands | repo | `install.py` (temp generate via vendored `package/bin/openspec.js`, then managed file writes) |
| Superpowers managed plugins/packages | global | Sibling script `projects/agents/scripts/install_superpowers.py`, invoked by the same Make/`install --scope global` orchestration as agents-install |

**asd-23 relationship:** asd-23 excludes *Sheaf plugin-owned skills* such as
`xagent-subagents` from filesystem skill distribution. Superpowers is
**third-party vendored tooling** distributed as managed plugins from
`projects/agents/vendor/`; it is a deliberate agents-project responsibility and
an explicit exception to “do not install plugin packages through install.py’s
skill renderer.”

**Orchestration boundary:** `install.py` remains unaware of Superpowers and keeps
the single-file `Output` model. The Makefile (and root `agents-*` targets)
invokes `install.py` and `install_superpowers.py` as sibling steps for
install/check/clean when scope includes global. `install.py install --scope
global` alone does **not** install Superpowers.

**Node for repo scope:** repo install and repo check hard-fail with an explicit
error when Node is missing or older than OpenSpec’s engine floor (generation and
byte-reproducible check both need it). Document that `make agents-test` (which
runs `check --scope repo`) requires Node ≥20.19 after this lands. This differs
from the global CLI skip policy in Decision 2.

Pinned OpenSpec tools+workflows live in `projects/agents/vendor/openspec/VENDOR.toml`
(and are duplicated in avt-4 scenarios for acceptance). Generation for that pin
MUST be byte-reproducible.

Obsolete cleanup is scoped to outputs these entry points own (managed markers /
managed plugin packages), never deleting marketplace copies they did not write.

### 6. Vendor update workflow

`make agents-vendor-sync TOOL=openspec REF=<tag-or-sha>` (and superpowers) or
`projects/agents/scripts/vendor_sync.py`:

1. fetch/build the offline-installable tree into staging;
2. replace `projects/agents/vendor/<tool>/`;
3. update pin metadata including `version`;
4. refuse to clobber a locally modified vendor tree unless forced;
5. leave install to a subsequent `make agents-install`.

## Risks / Trade-offs

- [Vendor tree size from OpenSpec `node_modules`] → Accept for offline
  correctness; measure in sync; document size in README.
- [Marketplace Superpowers still installed] → Document disable/remove; detect
  duplicate discovery in docs/check notes where feasible.
- [User still has global npm openspec] → Prefer managed shim earlier on PATH;
  do not auto-delete.
- [Byte-reproducibility of openspec generation] → Pin tools+workflows; test in
  CI; fail check loudly on drift.

## Migration Plan

1. Land offline-capable vendor trees at known-good pins (OpenSpec ≈1.4.1;
   Superpowers current skills/plugin set).
2. Extend installer + tests; regenerate repo OpenSpec harness files with managed
   markers in the same commit.
3. Run `make agents-install`; verify managed `openspec --version`; verify
   Superpowers via managed plugins; verify `superpowers:` ids still resolve for
   workflow skills.
4. README: stop recommending `npm i -g @fission-ai/openspec` and marketplace
   Superpowers for Sheaf; recommend disabling marketplace Superpowers when using
   the managed package.
5. Optionally remove old global npm package / disable marketplace plugins
   manually.

Rollback: revert the installer commit **and** the regenerated repo OpenSpec
harness files; previous global installs still work if kept.

## Open Questions

None blocking planning. Cursor/Claude/Codex/Pi managed-plugin install paths are
Decision 4; OpenSpec command scope is repo-local only (Decision 3).
