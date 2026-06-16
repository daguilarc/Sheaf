## Context

The existing smoke-test infrastructure already defines the asset split: Conductor can spawn services with `smoke_test: true`, and those services resolve git-ignored assets from `SHEAF_SMOKE_ASSET_ROOT`. The weak link is launch-root selection. Production Conductor is the long-running process that owns service lifecycle on the production ports, but its registry commands currently launch from Conductor's own repository root. That means a smoke restart through production Conductor still starts production code unless the API can override the service launch root for that request.

The skill is also not generally useful outside Sheaf. It currently lives under `projects/agents/global/skills/`, so the installer distributes it to user-global harness locations. It should be sourced from a Sheaf-only tree and rendered only into this repository's harness directories.

The skill must treat production Conductor as the lifecycle controller and the supplied worktree as the service launch root. Since the tested services use the same production ports, the procedure must be explicit that manual smoke testing temporarily replaces selected service processes, not Conductor itself.

## Goals / Non-Goals

**Goals:**

- Add a lifecycle request option that tells production Conductor which Sheaf worktree to use as the service launch root.
- Make the `smoke-test` skill's default flow pass the current worktree path to production Conductor when restarting asset-dependent services.
- Preserve the existing production-asset behavior for git-ignored assets through Conductor's `smoke_test` environment injection.
- Include enough verification and recovery guidance that an agent can detect when it accidentally contacted production Conductor.
- Move `smoke-test` to `projects/agents/sheaf/skills/` and render Sheaf-only skills to repo-local harness directories only.
- Remove managed user-global `smoke-test` outputs left behind by the previous global distribution.

**Non-Goals:**

- Do not replace or restart production Conductor as part of the smoke-test skill.
- Do not introduce parallel per-worktree ports; smoke testing intentionally reuses production ports for realistic manual upgrade checks.
- Do not automate unrelated browser/user workflow checks inside the skill.
- Do not make every shared skill Sheaf-only; existing global skills remain global.

## Decisions

1. Add a `worktree` lifecycle request body field.

   `POST /api/services/<name>/start` and `POST /api/services/<name>/restart` should accept an optional `worktree` string. When present, Conductor validates that it is an absolute Sheaf repository root, then uses it as the cwd/log root for the service spawn. When absent, existing behavior is unchanged.

   Alternative considered: add a separate smoke-test endpoint. Reusing lifecycle options keeps start and restart behavior consistent and avoids another API surface for the same spawn action.

2. Keep smoke asset-root discovery tied to production Conductor.

   `smoke_test: true` should continue to inject `SHEAF_SMOKE_ASSET_ROOT` resolved by production Conductor. The `worktree` option changes only where the service command runs from, not which git-ignored assets are used.

   Alternative considered: resolve the smoke asset root from the supplied worktree. That would recreate the problem of worktrees lacking production-only secrets and models.

3. Make the skill verify production Conductor and pass worktree explicitly.

   The skill should check `http://127.0.0.1:9001/health`, build the worktree services, and post restart bodies like `{"smoke_test": true, "worktree": "<absolute worktree>"}`. Verification should focus on worktree service logs and Conductor responses, not a worktree Conductor process.

   Alternative considered: rely only on child service health. Health proves the service is up, not that it came from the worktree.

4. Introduce a sibling `projects/agents/sheaf/` source tree for repo-only guidance.

   The installer should continue reading `projects/agents/global/` for globally-distributed instructions and skills, and additionally read `projects/agents/sheaf/skills/` for repo-local skill outputs. Sheaf-only skills should use the same `skill.yaml` and `SKILL.md` format as global skills so authors do not learn a second metadata model.

   Alternative considered: add a metadata flag to individual global skills. A separate tree makes the distribution scope visible in the filesystem and prevents future confusion about whether a skill is safe to install into user-global harnesses.

5. Prune legacy global `smoke-test` outputs as obsolete managed files.

   Once the source moves out of `global/skills`, normal global clean no longer knows about the old output paths. The installer should carry a small obsolete-global list for `smoke-test` so global install/check/clean can remove or report the managed leftovers without affecting unmanaged files.

   Alternative considered: manually delete the current user's files once. That would leave the installer unable to clean other machines or future stale global copies.

## Risks / Trade-offs

- Existing service interruption -> The skill must keep the service replacement warning prominent and include a recovery path to return services to production code after manual testing.
- Bad worktree path -> Conductor should reject non-absolute, missing, or non-Sheaf-root paths with 400 instead of falling back silently.
- Verification signal may be indirect -> Prefer simple checks available today, such as worktree log paths and process command lines, while leaving room for a future Conductor repo-root API if needed.
- Obsolete global cleanup could delete user-authored files -> Cleanup must only remove files with the agents managed marker.
- Generated skill drift -> Implementation must run the agents install/check flow so global and harness-specific skill outputs match the canonical source.
