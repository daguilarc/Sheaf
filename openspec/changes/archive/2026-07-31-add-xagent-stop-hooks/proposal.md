## Why

xagent can keep a supervised worker alive without polling, but a Claude or
Codex controller can still end its own turn before issuing the required
`xagent_await`; no worker event then re-enters that completed turn. A
deterministic, session-scoped stop guard should give each new actionable
pending state one continuation opportunity without waking the model for
routine progress or trapping the controller in a stop loop.

## What Changes

- Add xagent-managed `PostToolUse` and `Stop` command hooks for Claude Code and
  Codex.
- Record outstanding xagent run IDs and await cursors for top-level controller
  sessions when xagent dispatch, follow-up, message, interrupt, await, and
  close tools complete.
- Reject a controller stop at most once for each new actionable pending state
  and feed back the exact `xagent_await` instruction needed to continue.
- Serialize overlapping observer and asynchronous Stop updates with a
  per-session lock so state transitions cannot overwrite one another.
- Extend the xagent global installer to merge the hook registrations
  atomically into `$HOME/.claude/settings.json` and
  `$CODEX_HOME/hooks.json`, preserving unrelated configuration and retaining a
  recoverable backup.
- Make repeated xagent installation idempotent and make the agents global
  installers preserve xagent-managed Codex and Claude hook entries.
- Document and test the Codex hook trust step; preserve unrelated hook order so
  positional trust records are not invalidated during routine reinstalls.
- Add captured cross-harness payload fixtures plus hook, installer,
  session-isolation, malformed-state, test-discovery, and coexistence tests.

## Capabilities

### New Capabilities

- `xagent-controller-stop-hooks`: Session-scoped observation and stop-guard
  behavior for xagent controllers in Claude Code and Codex, including global
  hook installation and durable local bookkeeping.

### Modified Capabilities

- `agents-skill-distribution`: Convert the agents-owned Codex hook from
  whole-file ownership to group-level merge/check/clean semantics, preserve
  xagent groups, migrate the legacy whole-file marker, and make the managed
  Superpowers Claude-settings merge atomic.

## Impact

- `plugins/xagent/` gains packaged hook assets plus installer merge and backup
  behavior for Claude Code and Codex global JSON configuration.
- `plugins/xagent/scripts/install_global_test.py` gains installation and
  lifecycle regression coverage.
- `projects/agents/scripts/install.py` and its tests gain coexistence behavior
  for the agents-owned post-compaction hook and xagent-owned controller hooks.
- `projects/agents/scripts/install_superpowers.py` uses recoverable atomic JSON
  writes so its Claude settings update preserves xagent hook registration.
- The root xagent plugin test target explicitly executes the new hook-state
  test module.
- User-global hook configuration changes only during the explicit xagent
  global install; unrelated hooks and settings remain intact.
- Codex users may still need to approve new or changed commands through
  `/hooks`; installation documents and verifies that activation boundary.
- This change does not add a new xagent MCP API, restart completed controller
  turns, or change the xagent service-crash boundary.
