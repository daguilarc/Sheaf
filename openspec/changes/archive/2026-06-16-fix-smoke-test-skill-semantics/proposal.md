## Why

The shared `smoke-test` skill currently asks Conductor to restart services in smoke mode, but it gives production Conductor no way to launch those services from the agent's worktree. Manual upgrade testing needs production Conductor to keep managing the production ports while temporarily restarting selected services from a supplied worktree and continuing to use the main checkout's git-ignored assets.

## What Changes

- Move the smoke-test skill out of the global shared skill set and into a Sheaf-only skill source tree at `projects/agents/sheaf/skills/smoke-test/`.
- Extend Conductor lifecycle start/restart requests with a `worktree` argument that overrides the service launch root for that request.
- Update the smoke-test skill semantics so it uses the existing production Conductor and passes the current worktree path when restarting services.
- Keep the existing smoke-mode asset behavior: restarted services use the worktree's code and tracked config while resolving git-ignored assets from the main checkout via `SHEAF_SMOKE_ASSET_ROOT`.
- Add verification guidance so an agent can confirm Conductor and restarted services are coming from the worktree, not from the production checkout.
- Update the agents distribution script so Sheaf-only skills render to repo-local harness skill directories but are not installed to user-global harness locations.
- Remove the already-distributed global `smoke-test` skill copies from user-global harness skill locations when global installation/cleanup runs.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `agents-skill-distribution`: add Sheaf-only skill distribution semantics and strengthen the `smoke-test` skill requirement so its ready-to-run launch sequence passes a worktree argument to production Conductor.
- `conductor-smoke-test`: extend lifecycle smoke-test behavior so production Conductor can restart a service from a request-supplied worktree while preserving production asset-root injection.

## Impact

- Affected source: `projects/agents/sheaf/skills/smoke-test/SKILL.md`, `projects/agents/scripts/install.py`, generated repo-local per-harness skill installs, and Conductor lifecycle request handling.
- Affected docs/tests: `openspec/specs/agents-skill-distribution/spec.md`, agents installer/check coverage, and any smoke-test skill validation added around the launch script text.
- User-global cleanup impact: existing managed global `smoke-test` skill outputs should be pruned because the skill is Sheaf-only.
- Runtime impact: production Conductor remains running, but the skill intentionally replaces selected services on production ports with processes launched from the supplied worktree; it must make that behavior explicit and provide recovery instructions.
