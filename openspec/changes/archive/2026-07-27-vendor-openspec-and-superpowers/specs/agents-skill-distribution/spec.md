## ADDED Requirements

### Requirement: asd-25 — Installer: vendored OpenSpec and Superpowers integration

WHEN OpenSpec and Superpowers are vendored under `projects/agents/vendor/`, THE agents installer SHALL include their install, check, and clean outputs in the existing `repo`, `global`, and `all` scopes according to `agents-vendored-tooling` ownership (OpenSpec harness artifacts in repo scope; OpenSpec CLI and Superpowers managed plugins/packages in global scope), using `projects/agents/vendor/` as the source of truth rather than global npm or harness marketplaces.

#### Scenario: All-scope install covers vendored tooling

- **WHEN** `make agents-install` or `install --scope all` orchestration runs
  successfully on a machine with a supported Node.js
- **THEN** repo-scope OpenSpec harness outputs are installed via `install.py`
- **AND** global-scope OpenSpec CLI outputs are installed via `install.py`
- **AND** Superpowers managed plugin/package outputs are installed via
  `projects/agents/scripts/install_superpowers.py`
- **AND** existing shared-skill and instruction outputs continue to install as
  before

#### Scenario: Repo scope excludes Superpowers global outputs

- **WHEN** `projects/agents/scripts/install.py install --scope repo` runs
- **THEN** Superpowers managed plugin/package destinations are not written by
  that repo-scoped run
- **AND** OpenSpec repo-local harness outputs are still installed from vendor by
  invoking the vendored package entry point directly

#### Scenario: Global scope install.py does not write Superpowers or repo OpenSpec outputs

- **WHEN** `projects/agents/scripts/install.py install --scope global` runs
- **THEN** the managed OpenSpec CLI is installed from vendor when Node meets
  the CLI engine floor (CLI skipped with warning otherwise)
- **AND** that `install.py` run does not install Superpowers plugins (those are
  installed only via `install_superpowers.py` from Make orchestration)
- **AND** the run does not write repo-local `.claude/skills/openspec-*`,
  `.cursor/skills/openspec-*`, `.pi/skills/openspec-*`, or
  `.codex/skills/openspec-*` paths

### Requirement: asd-26 — Makefile and docs: vendored tooling entry points

WHEN vendored OpenSpec and Superpowers support is added, THE agents project SHALL document and expose Make (or script) entry points for vendor sync and for install/check/clean that include vendored tooling, and THE documentation SHALL state that Sheaf agent work must not rely on a global OpenSpec npm install or on Claude/Cursor/Codex/Pi Superpowers marketplace installs.

#### Scenario: README documents vendor-first install

- **WHEN** a developer reads `projects/agents/README.md` after this change
- **THEN** it describes `projects/agents/vendor/openspec` and
  `projects/agents/vendor/superpowers` as the source of truth
- **AND** it instructs using agents install rather than global npm OpenSpec or
  Superpowers marketplace/`pi install` setup
- **AND** it recommends disabling or removing marketplace Superpowers copies
  when using the managed packages

#### Scenario: Make still delegates agents install

- **WHEN** a developer runs `make agents-install`
- **THEN** make delegates to `projects/agents` install
- **AND** that install includes vendored OpenSpec and Superpowers outputs for
  the default scope
