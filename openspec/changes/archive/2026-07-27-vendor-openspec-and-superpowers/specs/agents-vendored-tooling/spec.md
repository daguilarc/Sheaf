# Capability: Agents Vendored Tooling

Project: `projects/agents`
ID prefix: `avt` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Owns vendored upstream OpenSpec and Superpowers trees under
`projects/agents/vendor/`, revision pinning and sync, OpenSpec CLI installation
from vendor (no global npm), OpenSpec repo harness artifact install from vendor,
and Superpowers managed local plugin/package install into Claude, Cursor, Pi,
and Codex.

## ADDED Requirements

### Requirement: avt-1 — Vendor trees: OpenSpec and Superpowers

WHEN vendored agent tooling is enabled, THE agents project SHALL contain
`projects/agents/vendor/openspec/` and `projects/agents/vendor/superpowers/` as
the canonical local source trees, each with pin metadata that records upstream
URL, revision, version, and retrieval time, and each tree SHALL be fully
git-tracked and sufficient for offline install without fetching from GitHub or
the npm registry.

#### Scenario: Vendor directories exist with pin metadata

- **WHEN** a developer inspects `projects/agents/vendor/`
- **THEN** `openspec/` and `superpowers/` directories exist
- **AND** each directory includes pin metadata identifying upstream URL,
  revision, version, and retrieval time

#### Scenario: OpenSpec vendor tree is offline-installable

- **WHEN** `projects/agents/vendor/openspec/package/` is inspected
- **THEN** it contains a complete package tree including production
  `node_modules` and built CLI assets needed to run OpenSpec
- **AND** pin metadata lives at `projects/agents/vendor/openspec/VENDOR.toml`

#### Scenario: Install does not require network fetch of upstream

- **WHEN** `projects/agents/scripts/install.py install` runs with vendored
  trees already present
- **THEN** OpenSpec and Superpowers install outputs are produced from
  `projects/agents/vendor/` without requiring a live clone from GitHub or npm
  registry for those sources

### Requirement: avt-2 — Vendor sync: pinned revision update

WHEN a developer updates a vendored tool pin, THE agents project SHALL provide a
documented sync entry point that replaces the corresponding
`projects/agents/vendor/<tool>/` tree from the requested upstream revision,
updates pin metadata including version, and refuses to clobber a locally
modified vendor tree unless forced.

#### Scenario: Sync updates pin metadata

- **WHEN** the vendor sync entry point runs for `openspec` or `superpowers`
  with an explicit revision
- **THEN** the vendored tree contents match that revision
- **AND** pin metadata records the new revision and version

#### Scenario: Sync refuses to clobber local vendor modifications

- **WHEN** the vendor sync entry point runs without force
- **AND** the existing vendor tree has local modifications
- **THEN** sync exits non-zero without replacing the tree

### Requirement: avt-3 — OpenSpec CLI: managed install from vendor

WHEN agents global install runs, THE agents installer SHALL install the OpenSpec
CLI from `projects/agents/vendor/openspec` into a Sheaf-managed user prefix with
an `openspec` shim, SHALL NOT require a prior global
`npm install -g @fission-ai/openspec`, and SHALL NOT run OpenSpec's npm
postinstall script during that managed install.

#### Scenario: Managed CLI shim installed

- **WHEN** `projects/agents/scripts/install.py install --scope global` completes
  successfully on a machine with Node.js meeting OpenSpec's minimum engine
- **THEN** a managed `openspec` shim exists under the Sheaf-managed bin prefix
- **AND** invoking that shim reports a version equal to the vendored OpenSpec
  pin metadata `version` field

#### Scenario: Missing or too-old Node skips CLI without blocking other global outputs

- **WHEN** global install attempts OpenSpec CLI installation
- **AND** Node.js is missing or older than OpenSpec's required minimum
- **THEN** the installer skips the CLI step with an explicit warning
- **AND** it still installs the non-CLI global agents outputs in that run
- **AND** it does not fall back to a global npm OpenSpec install

#### Scenario: Check detects stale CLI

- **WHEN** `projects/agents/scripts/install.py check --scope global` runs
- **AND** the managed OpenSpec shim is missing or its `--version` does not equal
  the vendored pin metadata `version`
- **THEN** check exits non-zero and reports the CLI drift

### Requirement: avt-4 — OpenSpec harness artifacts: four tools from vendor

WHEN agents repo install runs, THE agents installer SHALL generate OpenSpec skills and tool-specific command/prompt files for `claude`, `cursor`, `pi`, and `codex` from `projects/agents/vendor/openspec/package` by invoking that package's CLI entry point directly (not the user PATH shim), copy only those skill/command outputs through the managed write path for the pinned tools and workflows (`propose`, `apply-change`, `archive-change`, `explore`, `sync-specs`) recorded in `projects/agents/vendor/openspec/VENDOR.toml`, produce byte-reproducible outputs for that pin, and SHALL NOT modify root `AGENTS.md` or `CLAUDE.md` during that generation.

#### Scenario: Repo-local OpenSpec skills installed for four harnesses

- **WHEN** `projects/agents/scripts/install.py install --scope repo` completes
  successfully
- **THEN** OpenSpec skill directories exist under `.claude/skills/`,
  `.cursor/skills/`, `.pi/skills/`, and `.codex/skills/` for
  `openspec-propose`, `openspec-apply-change`, `openspec-archive-change`,
  `openspec-explore`, and `openspec-sync-specs`
- **AND** those outputs are derived from `projects/agents/vendor/openspec`
- **AND** each installed skill file is marked managed by the agents installer

#### Scenario: Repo-local OpenSpec commands/prompts installed where applicable

- **WHEN** repo install completes successfully
- **THEN** OpenSpec `opsx` command or prompt files exist for Claude, Cursor,
  and Pi at their supported repo-local command/prompt paths
- **AND** Codex remains skills-only for OpenSpec (no fabricated Codex custom
  prompt files)
- **AND** those command/prompt files are marked managed by the agents installer

#### Scenario: Root instruction files stay agents-installer owned

- **WHEN** repo install generates OpenSpec harness artifacts from vendor
- **THEN** root `AGENTS.md` and `CLAUDE.md` are not modified by the OpenSpec
  generation step
- **AND** those files contain no `<!-- OPENSPEC:START -->` block introduced by
  that generation

#### Scenario: Repo install does not require managed CLI shim or global npm

- **WHEN** repo install runs from vendored OpenSpec
- **THEN** it invokes the vendored package entry point directly
- **AND** it does not require the managed user-prefix shim
- **AND** it does not require `openspec` installed via global npm

#### Scenario: Repo install fails loudly when Node is unavailable

- **WHEN** repo install or repo check needs OpenSpec generation
- **AND** Node.js is missing or older than OpenSpec's required minimum
- **THEN** the command exits non-zero with an explicit error
- **AND** it does not skip harness generation silently

#### Scenario: Check detects OpenSpec harness drift

- **WHEN** `projects/agents/scripts/install.py check --scope repo` runs
- **AND** a managed OpenSpec harness output differs from regeneration for the
  current vendor pin and pinned tools/workflows
- **THEN** check exits non-zero and reports the stale path

#### Scenario: Clean removes managed OpenSpec harness outputs only

- **WHEN** `projects/agents/scripts/install.py clean --scope repo` runs
- **THEN** managed OpenSpec harness outputs installed by the agents installer
  are removed
- **AND** unmarked files in the same directories are left unchanged

#### Scenario: Existing OpenSpec outputs migrate in the landing commit

- **WHEN** the change that introduces vendored OpenSpec install lands
- **THEN** the previously tracked repo OpenSpec harness outputs are regenerated
  with agents managed markers in that same commit
- **AND** a subsequent `install --scope repo` without `--force` succeeds against
  those destinations

### Requirement: avt-5 — Superpowers managed plugins from vendor

WHEN agents global install runs, THE agents project SHALL install Superpowers from `projects/agents/vendor/superpowers/tree/` via `projects/agents/scripts/install_superpowers.py` as managed local plugin or package installs for Claude, Cursor, Pi, and Codex such that skills remain addressable as `superpowers:<skill-id>`, nested skill files and hook/extension assets are included, executable permissions on vendored scripts are preserved, and each managed package marker records the vendor revision and version used to build it.

#### Scenario: Managed Superpowers plugins installed for four harnesses

- **WHEN** `make agents-install-global` or equivalent global agents install
  orchestration completes successfully
- **THEN** a managed Superpowers plugin or package derived from
  `projects/agents/vendor/superpowers/tree/` is installed for Claude, Cursor,
  Pi, and Codex at the destinations defined in the agents-vendored-tooling
  design
- **AND** each managed install is marked as agents-installer managed
- **AND** executable permissions on vendored hook scripts are preserved

#### Scenario: Superpowers skill namespace preserved

- **WHEN** global Superpowers install completes successfully from vendor
- **THEN** a new Claude, Cursor, Pi, or Codex session can invoke Superpowers
  skills using `superpowers:<skill-id>` ids
- **AND** no prior marketplace plugin install or `pi install` from GitHub is
  required for that discovery

#### Scenario: Check detects missing or stale managed Superpowers package

- **WHEN** Superpowers check runs as part of global agents check
- **AND** a required managed Superpowers plugin/package is missing, unmarked, or
  its recorded pin differs from `projects/agents/vendor/superpowers/VENDOR.toml`
- **THEN** check exits non-zero and reports the missing or stale package

#### Scenario: Codex Superpowers hooks stay outside Sheaf hooks.json

- **WHEN** global install installs the managed Superpowers Codex plugin
- **THEN** it does not merge Superpowers hooks into the Sheaf-owned
  `$CODEX_HOME/hooks.json` managed by asd-21

#### Scenario: Plugin registry merge touches only sheaf-managed Superpowers entries

- **WHEN** the Superpowers installer updates a harness plugin registry JSON file
- **THEN** it upserts only the sheaf-managed Superpowers entry or key
- **AND** it leaves unrelated plugin entries unchanged
- **AND** if the same Superpowers key exists and is not sheaf-managed, it fails
  without overwriting unless `--force` is passed

### Requirement: avt-6 — Managed safety for vendored tooling outputs

WHEN the agents installer writes OpenSpec CLI, OpenSpec harness, or Superpowers plugin/package outputs from vendor, THE installer SHALL apply managed-output safety rules: refuse to overwrite differing unmanaged destinations without force, support check drift detection, and remove only installer-managed outputs on clean, using package-level managed markers for Superpowers plugins rather than mutating upstream SKILL.md bodies.

#### Scenario: Unmanaged conflicting Superpowers package is not overwritten

- **WHEN** global install would write a Superpowers managed-plugin destination
- **AND** that destination exists, differs, and is not marked managed
- **THEN** installation fails before overwriting unless `--force` is passed

#### Scenario: Clean removes managed vendored tooling outputs only

- **WHEN** clean runs for a scope that includes vendored tooling outputs
- **THEN** managed OpenSpec/Superpowers outputs installed by the agents
  installer are removed
- **AND** unmarked files and foreign marketplace plugin copies in related
  locations are left unchanged
