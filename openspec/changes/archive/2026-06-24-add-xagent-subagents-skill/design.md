## Context

`projects/agents` is the source of truth for shared agent instructions and skills. Skill metadata already includes a `targets` list with supported harness values (`claude`, `cursor`, `pi`, `codex`), and the installer already routes generated outputs by target. The specification, however, still describes shared skills as if every skill renders into every harness, which makes Codex-only skills look accidental rather than supported.

The requested `xagent-subagents` skill is specifically for Codex. Its purpose is to teach Codex when and how to use the `xagent` CLI to get cross-provider review perspectives, especially Claude-backed review passes. That guidance would be counterproductive if installed into Claude or Cursor, because it is written from the parent Codex agent's point of view.

## Goals / Non-Goals

**Goals:**

- Make target-specific skill installation an explicit agents installer contract.
- Support skills whose metadata declares only `codex`.
- Add a global Codex-only skill source named `xagent-subagents`.
- Keep the skill lean enough to load during review work without drowning the parent task.
- Preserve the existing managed-file install/check/clean behavior.

**Non-Goals:**

- Do not change `xagent` CLI behavior.
- Do not add a new installer subcommand for Codex-only skills.
- Do not install the new skill into Claude, Cursor, or Pi skill directories.
- Do not automatically launch subagents from hooks or session startup; the skill only guides Codex when review/subagent work is relevant.

## Decisions

1. Use `targets: [codex]` rather than a new source tree.

   The installer already models harness-specific distribution through `skill.yaml` targets. Extending that model is simpler than adding `global/codex/skills` or another installer path. The implementation should add tests and documentation that prove Codex-only targeting is a supported first-class case.

2. Store `xagent-subagents` under `projects/agents/global/skills/`.

   The skill describes a reusable Codex workflow, not Sheaf-only project knowledge. It should be available through both repo-local Codex skill installation and user-global Codex installation. Its `targets` metadata keeps it out of non-Codex harnesses.

3. Keep model routing in the skill body, not installer code.

   Model names and provider preferences are agent workflow guidance. They should live in `SKILL.md` where they can evolve without changing installer behavior. The installer should remain concerned only with rendering and target selection.

4. Treat Claude review as the default cross-provider review path.

   Review tasks benefit from a genuinely different model family. The skill should direct Codex to prefer `xagent run --harness claude_code` for review opinions, selecting Opus 4.8, Sonnet 4.8, or Haiku 4.7 based on complexity and cost sensitivity.

5. Include Cursor Composer 2.5 as a worker option, but reserve GPT/Codex workers for the hardest implementation tasks.

   Composer is useful for competent worker passes through the Cursor harness, but the skill should steer the parent agent toward GPT/Codex-backed workers for the trickiest tasks where the strongest implementation reasoning matters more than provider diversity.

## Risks / Trade-offs

- Model names may drift or provider CLIs may reject exact model identifiers. Mitigation: phrase the skill as preferred routing guidance and instruct the parent agent to surface harness/model failures instead of silently working around broken agentic infrastructure.
- Codex-only targeting could regress if future installer changes assume every skill targets every harness. Mitigation: add focused tests for repo-local and user-global Codex-only outputs.
- Extra review subagents can waste time or money on small changes. Mitigation: the skill should trigger on review/subagent work and include selection guidance for when to use Haiku, Sonnet, Opus, Composer, or GPT/Codex workers.
- A subagent launched from the wrong cwd may review the wrong worktree. Mitigation: the skill should instruct Codex to invoke `xagent` from the active worktree root and include the review scope explicitly in the prompt.

## Migration Plan

1. Update the `agents-skill-distribution` spec to describe target-selected repo-local and user-global skill outputs.
2. Add tests proving a Codex-only global skill renders only to `.codex`, `$CODEX_HOME`, and `$HOME/.agents` Codex destinations.
3. Add the `xagent-subagents` skill source with `targets: [codex]`.
4. Update agents documentation to mention Codex-only skills as a supported target-specific case.
5. Run `make agents-check-repo` or the installer tests before installation, then run install/check commands when ready to refresh generated outputs.

Rollback is straightforward: remove the source skill and restore the previous spec/docs/tests before installation, or run clean/install to remove managed generated outputs if implementation had already been installed.

## Open Questions

- Confirm exact Claude model identifiers accepted by the local Claude Code CLI for Opus 4.8, Sonnet 4.8, and Haiku 4.7 during implementation.
- Confirm exact Cursor model identifier for Composer 2.5 during implementation.
