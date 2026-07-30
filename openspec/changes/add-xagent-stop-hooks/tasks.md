## 1. Hook State Machine

- [ ] 1.1 Capture and sanitize representative Claude Code and Codex `PostToolUse`/`Stop` payload fixtures, including native-subagent events; stop and revise xhook-1/xhook-2 before any installation work if either harness lacks a reliable subagent discriminator; then add failing `plugins/xagent/scripts/controller_stop_hook_test.py` coverage for structured-content and JSON-text extraction, top-level error rejection, start/follow-up/message/interrupt/await/close transitions, multiple pending runs, top-level session isolation, concurrent Stop/observer serialization, one-second lock failure, and lock-file retention.
- [ ] 1.2 Implement `plugins/xagent/scripts/controller_stop_hook.py` with harness adapters, exact successful-result validation, an installer-selected state root, and an atomic per-session state store protected by a per-session exclusive advisory lock until the observer and overlap tests pass.
- [ ] 1.3 Add failing tests for both harnesses' top-level `{"decision":"block","reason":"..."}` Stop output, deterministic run selection, exact latest-cursor instruction, at-most-once rejection per state revision across later user turns and active-field variants, no-pending pass-through, malformed-state fail-open behavior, no-op deadline handling, and `completed`/`failed`/`cancelled`/`abandoned` terminal clearing.
- [ ] 1.4 Implement the harness-independent stop guard and change-only state-revision bookkeeping until the stop lifecycle tests pass.
- [ ] 1.5 Update the root `xagent-plugin-test` target so the hook-state test module is always executed, and prove the target fails when that module fails.

## 2. xagent Global Installation

- [ ] 2.1 Add failing installer tests for fresh and pre-populated Claude/Codex hook configuration, append/in-place order preservation, canonical duplicate removal, repeat-install idempotence, malformed-shape rejection, legacy agents-marker tolerance, atomic replacement, backup recovery, and the Codex trust notice.
- [ ] 2.2 Package the Python hook program under the installed plugin's `scripts/`, keep the plugin manifest free of unsupported hook fields, ship no plugin-root `hooks.json` or `hooks/` directory, and extend `install_global.py` to register stable absolute observer and stop commands with an installer-resolved state root in `$HOME/.claude/settings.json` and resolved `$CODEX_HOME/hooks.json`.
- [ ] 2.3 Extend plugin packaging and installation assertions to prove the installed hook program exists at the registered paths, no plugin-root hook registration exists, the manifest passes the existing validator, and repeated installation leaves exactly one canonical xagent group per event in each harness.

## 3. Agents Installer Coexistence

- [ ] 3.1 Add failing agents-installer tests for canonical command/matcher ownership, legacy whole-file marker migration, preserving xagent Codex groups during install/check/clean, append/in-place and unrelated-order behavior, deleting `hooks.json` only when empty, rejecting malformed shared JSON even with `--force`, symmetric Codex trust notices, converging in either installer order, and preserving Claude xagent hooks during managed Superpowers enablement.
- [ ] 3.2 Refactor `projects/agents/scripts/install.py` `$CODEX_HOME/hooks.json` handling to recognize the canonical agents group, merge/check/clean only that group, migrate the legacy top-level marker, preserve valid canonical xagent and unrelated groups, and report re-approval after effective positional changes.
- [ ] 3.3 Refactor only the Claude settings merge in `projects/agents/scripts/install_superpowers.py` to use staged atomic replacement with a recoverable sibling backup, preserving xagent Claude hooks and unrelated settings.

## 4. Documentation and Verification

- [ ] 4.1 Update the xagent and agents installation documentation with top-level Claude/Codex stop-guard scope, Cursor/Pi exclusion, global configuration paths, bounded failure behavior, Codex `/hooks` trust and activation verification, shared-file `--force` semantics, reinstall behavior, and manual rollback ownership boundary.
- [ ] 4.2 Run the focused hook, xagent installer, agents installer, managed Superpowers installer, root xagent plugin, and OpenSpec requirement-ID suites; run strict OpenSpec validation; and perform or precisely record the isolated manual Claude/Codex activation checks, using Codex trust bypass only inside a disposable test home.
