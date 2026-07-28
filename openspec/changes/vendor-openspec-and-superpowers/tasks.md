## 1. Vendor trees and sync

- [x] 1.1 Add `projects/agents/vendor/openspec/{VENDOR.toml,package/}` and `projects/agents/vendor/superpowers/{VENDOR.toml,tree/}` with pin schema (`url`, `revision`, `version`, `retrieved_at`) and ensure vendor paths are fully git-tracked (including OpenSpec `package/node_modules`)
- [x] 1.2 Implement `projects/agents/scripts/vendor_sync.py` that builds offline-capable trees, updates pin metadata, and refuses to clobber local vendor modifications without force
- [x] 1.3 Sync initial OpenSpec vendor tree at pin ≈1.4.1 into `vendor/openspec/package/`
- [x] 1.4 Sync initial Superpowers vendor tree into `vendor/superpowers/tree/`
- [x] 1.5 Add Make targets for vendor sync and document them in `projects/agents/README.md`

## 2. OpenSpec CLI from vendor (`install.py`)

- [x] 2.1 Define Sheaf-managed user prefix paths for the OpenSpec package root and `openspec` shim
- [x] 2.2 Extend `install.py` global scope to install from `vendor/openspec/package/` without `npm install -g` and without running upstream postinstall
- [x] 2.3 On missing/too-old Node, skip CLI with an explicit warning while still installing other global agents outputs; never fall back to global npm
- [x] 2.4 Wire check/clean comparing shim `--version` to `VENDOR.toml` `version`
- [x] 2.5 Add installer tests covering CLI install, version check, Node-skip behavior, and clean

## 3. OpenSpec harness artifacts (repo scope, `install.py`)

- [x] 3.1 Generate via `node projects/agents/vendor/openspec/package/bin/openspec.js` into a temp workspace; copy only skills/commands through the managed write path; never modify root `AGENTS.md`/`CLAUDE.md`; hard-fail if Node unavailable
- [x] 3.2 Install the five pinned workflows for all four harness skill dirs
- [x] 3.3 Install `opsx` commands/prompts for Claude, Cursor, and Pi; keep Codex skills-only
- [x] 3.4 In the landing commit, regenerate existing tracked OpenSpec harness outputs with managed markers
- [x] 3.5 Add installer tests for install/check/clean, AGENTS.md/CLAUDE.md non-touch, Node hard-fail, and direct vendored entry-point use; note `make agents-test` requires Node ≥20.19

## 4. Superpowers managed plugins (global scope, sibling script)

- [x] 4.1 Implement `projects/agents/scripts/install_superpowers.py` with the per-harness destinations/registries from design §4 (Claude/Cursor/Codex/Pi), package-level markers recording vendor revision+version, `copy2` executable-bit preservation, and registry merge only for sheaf-managed Superpowers entries
- [x] 4.2 Keep Superpowers Codex hooks inside the managed Superpowers Codex plugin; do not merge into Sheaf-owned `$CODEX_HOME/hooks.json`
- [x] 4.3 Wire check/clean for missing/unmarked/stale-pin Superpowers packages; leave foreign marketplace copies untouched
- [x] 4.4 Wire Make/`agents-install-global`/`agents-check-global`/`agents-clean-global` (and `all` scope) to invoke `install_superpowers.py` as a sibling of `install.py`; keep `install.py` unaware of Superpowers
- [x] 4.5 Add tests for plugin install/check/clean, unmanaged same-key conflict, registry non-touch of unrelated entries, and executable bits

## 5. Agents integration and docs

- [x] 5.1 Document asd-23 exception: Superpowers is vendored third-party tooling via sibling script, not filesystem skill rendering
- [x] 5.2 Update `projects/agents/README.md` for vendor-first install, PATH note, marketplace Superpowers disable/remove guidance, and Node requirement for repo check/tests
- [x] 5.3a Smoke-verify per harness (disk/registry): managed `openspec --version`; repo OpenSpec outputs managed; Superpowers managed packages present with pin markers and registry/settings entries
- [x] 5.3b Human gate: with foreign marketplace Superpowers copies disabled/removed, confirm in a live Claude/Cursor/Pi/Codex session that `superpowers:<id>` (or harness-equivalent) resolves from the managed package (avt-5 namespace)
- [x] 5.4 Run agents unit tests and `openspec validate vendor-openspec-and-superpowers --strict`
