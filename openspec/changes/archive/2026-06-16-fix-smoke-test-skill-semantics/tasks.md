## 1. Skill Scope

- [x] 1.1 Create `projects/agents/sheaf/skills/` as a sibling source tree to `projects/agents/global/skills/` for repo-only skills.
- [x] 1.2 Move the canonical `smoke-test` skill source from `projects/agents/global/skills/smoke-test/` to `projects/agents/sheaf/skills/smoke-test/`.
- [x] 1.3 Update `projects/agents/README.md` to document global versus Sheaf-only skill source trees and distribution scopes.

## 2. Installer Distribution

- [x] 2.1 Update `projects/agents/scripts/install.py` so repo-scope outputs include both global skills and Sheaf-only skills.
- [x] 2.2 Update `projects/agents/scripts/install.py` so global-scope outputs include global skills only and exclude Sheaf-only skills.
- [x] 2.3 Add obsolete global cleanup for previously managed global `smoke-test` outputs, preserving unmanaged files.

## 3. Skill Procedure

- [x] 3.1 Update `projects/agents/sheaf/skills/smoke-test/SKILL.md` so the ready-to-run flow starts from the current worktree root while using the existing production Conductor.
- [x] 3.2 Replace the worktree-Conductor flow with a script or command sequence that verifies production Conductor is healthy on port 9001 and passes the current worktree path in lifecycle restart requests.
- [x] 3.3 Ensure the script restarts `dictator`, `sheaf-chat`, and `quest-runner` through production Conductor with `{"smoke_test": true, "worktree": "<current worktree>"}` and polls each service health endpoint.
- [x] 3.4 Add verification guidance that helps confirm the restarted services are running from the worktree, using available signals such as worktree log paths and Conductor responses.
- [x] 3.5 Add recovery guidance for returning to the production stack after manual smoke testing.

## 4. Conductor Worktree Launch API

- [x] 4.1 Update Conductor lifecycle request parsing so `start` and `restart` accept an optional `worktree` JSON body field.
- [x] 4.2 Validate `worktree` as an absolute existing Sheaf repository root and reject invalid values with a client error.
- [x] 4.3 Launch service commands from the supplied worktree when present while preserving existing launch-root behavior when absent.
- [x] 4.4 Preserve production smoke asset-root discovery when `smoke_test: true` is combined with `worktree`.
- [x] 4.5 Add Conductor tests covering HTTP restart with `worktree`, invalid worktree rejection, lifecycle launch-root override, and smoke env plus worktree behavior.

## 5. Distribution Outputs

- [x] 5.1 Run `make -C projects/agents install-repo` to regenerate tracked repo-local harness skill files from the Sheaf-only canonical source.
- [x] 5.2 Review generated diffs for `.claude/skills/smoke-test/SKILL.md`, `.cursor/skills/smoke-test/SKILL.md`, `.pi/skills/smoke-test/SKILL.md`, and `.codex/skills/smoke-test/SKILL.md` and confirm their managed source points at `projects/agents/sheaf/skills/smoke-test`.
- [x] 5.3 Run the global cleanup path, or document that it requires approval, so existing managed user-global `smoke-test` skill outputs are removed.

## 6. Verification

- [x] 6.1 Run `make conductor-test` to verify the lifecycle API and smoke-worktree behavior.
- [x] 6.2 Run `make -C projects/agents check-repo` to verify the canonical skill source and repo-local generated outputs are in sync.
- [x] 6.3 Run an installer global check using a temporary home/codex-home fixture to verify Sheaf-only skills are excluded and obsolete managed `smoke-test` outputs are reported or pruned.
- [x] 6.4 Run `openspec status --change "fix-smoke-test-skill-semantics"` and confirm the change remains apply-ready.
- [x] 6.5 If feasible without disrupting a needed local service session, dry-run the smoke-test script up to the pre-restart confirmation or document why manual runtime validation was skipped.

Manual runtime validation note: skipped the smoke-test launch dry run because it intentionally restarts services on production ports 9002-9004. The Conductor API behavior, installer behavior, and generated skill distribution were verified without touching those service ports.
