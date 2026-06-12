## 1. Installer Scopes

- [x] 1.1 Add `--scope repo|global|all` to `projects/agents/scripts/install.py`
- [x] 1.2 Make `all` the default scope for install, check, and clean modes
- [x] 1.3 Split output construction into repo-local and user-global output builders
- [x] 1.4 Preserve existing `--repo-root` behavior for repo-local outputs and test fixtures

## 2. User-Global Outputs

- [x] 2.1 Add global instruction destinations for Claude Code, Cursor, Pi, and Codex
- [x] 2.2 Add global skill destinations for Claude Code, Cursor, Pi, documented Codex user skills, and Codex-home skills
- [x] 2.3 Resolve `CODEX_HOME` from the environment and default it to `$HOME/.codex`
- [x] 2.4 Ensure global output paths are outside the repository during real global install
- [x] 2.5 Keep managed markers on every generated global instruction and skill file

## 3. Safety And Check/Clean Behavior

- [x] 3.1 Apply unmanaged-conflict protection to global install destinations
- [x] 3.2 Make `check --scope global` report missing, stale, and unmanaged conflicting global paths
- [x] 3.3 Make `clean --scope global` remove only managed global outputs
- [x] 3.4 Add temp-home verification for unmanaged global conflict handling

## 4. Makefile Integration

- [x] 4.1 Update `projects/agents/Makefile` so default install/check/clean use all scope
- [x] 4.2 Add `install-repo`, `check-repo`, and `clean-repo` targets
- [x] 4.3 Add `install-global`, `check-global`, and `clean-global` targets
- [x] 4.4 Add root Makefile shortcuts for repo/global scoped agents targets
- [x] 4.5 Update root help output to mention global install/check targets

## 5. Verification

- [x] 5.1 Run `make agents-install-global`
- [x] 5.2 Run `make agents-check-global`
- [x] 5.3 Run `make agents-install`
- [x] 5.4 Run `make agents-check`
- [x] 5.5 Verify user-global outputs exist under home-directory destinations, not just under `/Users/joyo/Sheaf`
- [x] 5.6 Run `openspec validate add-agents-user-global-install --type change --strict`
