## 1. Installer Contract And Tests

- [x] 1.1 Add installer tests that create a temporary Codex-only global skill fixture and assert repo-local outputs include only `.codex/skills/<skill-id>/SKILL.md`.
- [x] 1.2 Add installer tests that assert user-global Codex-only outputs include `$HOME/.agents/skills/<skill-id>/SKILL.md` and `$CODEX_HOME/skills/<skill-id>/SKILL.md` but exclude Claude, Cursor, and Pi skill paths.
- [x] 1.3 Adjust installer implementation only if the new tests reveal target-specific Codex-only behavior is missing or incomplete.
- [x] 1.4 Update `projects/agents/README.md` to document target-specific skills and Codex-only skills using `targets: [codex]`.

## 2. xagent-subagents Skill Source

- [x] 2.1 Create `projects/agents/global/skills/xagent-subagents/skill.yaml` with `id: xagent-subagents`, `name: xagent-subagents`, a review/subagent-oriented description, and only the `codex` target.
- [x] 2.2 Create `projects/agents/global/skills/xagent-subagents/SKILL.md` with concise Codex-facing guidance for when to use `xagent` subagents.
- [x] 2.3 Document Claude review routing in the skill, including `xagent run --harness claude_code`, active worktree cwd guidance, review prompt shape, and model tier guidance for Opus 4.8, Sonnet 4.8, and Haiku 4.7.
- [x] 2.4 Document worker routing in the skill, including Cursor Composer 2.5 as a capable worker through the Cursor harness and GPT/Codex-backed workers for the trickiest implementation tasks.
- [x] 2.5 Document failure handling in the skill: if `xagent`, the target harness, or a requested model is unavailable, surface the broken agentic infrastructure rather than silently working around it.

## 3. Generated Outputs And Verification

- [x] 3.1 Run the agents installer tests, including the new Codex-only target coverage.
- [x] 3.2 Run `make agents-check-repo` and confirm existing generated repo-local outputs are either current or expected to change after install.
- [x] 3.3 Run `make agents-install-repo` to regenerate repo-local managed outputs, then verify `xagent-subagents` appears under `.codex/skills/` and not under `.claude/skills/`, `.cursor/skills/`, or `.pi/skills/`.
- [x] 3.4 Run `make agents-check-repo` after regeneration.
- [x] 3.5 Validate the OpenSpec change with `openspec validate add-xagent-subagents-skill`.
