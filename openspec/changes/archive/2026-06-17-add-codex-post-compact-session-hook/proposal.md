## Why

Codex can compact long-running sessions, but after compaction it is easy for the
agent to continue without re-reading the plan, checklist, or task list that was
driving the work. Sheaf already centralizes global agent setup, so it should
install a Codex-specific reminder hook globally instead of relying on each repo
or thread to remember this behavior.

## What Changes

- Add a Codex-specific global agents asset that defines a `SessionStart` hook
  matching the `compact` source.
- Add a checked-in hook script that emits model-visible developer context:
  "If you were working from a plan, checklist, or task list, please review it
  after compaction."
- Extend the agents installer so global Codex installation copies the hook asset
  and script from this repository into `$CODEX_HOME`, preserving managed-file
  safety and check/clean behavior.
- Document that the hook is intentionally installed at the Codex user/global
  layer so it runs after compaction in any trusted or untrusted project, while
  the source of truth remains in `projects/agents/global`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `agents-skill-distribution`: add Codex global hook source assets and installer
  behavior for user-global Codex hook installation, checking, and cleanup.

## Impact

- Affected source: `projects/agents/global`, `projects/agents/scripts/install.py`,
  and `projects/agents/README.md`.
- Affected generated/user-global outputs: `$CODEX_HOME/hooks.json` or equivalent
  Codex hook configuration, plus a managed hook script under `$CODEX_HOME`.
- Affected specs/tests: `openspec/specs/agents-skill-distribution/spec.md` and
  agents installer coverage for install/check/clean with temporary home and
  `CODEX_HOME` fixtures.
