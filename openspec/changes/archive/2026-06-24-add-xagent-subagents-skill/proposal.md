## Why

Codex review work benefits from cross-provider opinions, but there is no Codex-only skill that tells Codex how to dispatch review subagents through `xagent`. The agents installer also needs an explicit requirement for skills that intentionally target only Codex, rather than relying on the existing target filtering as an implicit behavior.

## What Changes

- Define the agents installer contract for target-specific skills, including skills whose only target is `codex`.
- Add a Codex-only global skill source named `xagent-subagents` under `projects/agents/global/skills/`.
- Specify that the skill directs Codex to use `xagent run --harness claude_code` for review tasks when cross-provider review is useful.
- Specify model-selection guidance in the skill:
  - Claude Opus 4.8 as the strongest review model.
  - Claude Sonnet 4.8 as the middle/default review model.
  - Claude Haiku 4.7 as the fast, small, inexpensive review model.
- Specify worker-routing guidance in the skill:
  - Cursor Composer 2.5 as a capable worker through the Cursor harness.
  - GPT/Codex-backed workers for the trickiest implementation tasks.
- Update tests and documentation so Codex-only skills are installed only into repo-local and user-global Codex destinations.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `agents-skill-distribution`: Add explicit target-specific/Codex-only skill installation requirements and add the Codex-only `xagent-subagents` skill source requirement.

## Impact

- Affected source: `projects/agents/global/skills/xagent-subagents/`.
- Affected installer contract: `projects/agents/scripts/install.py`, installer tests, and `projects/agents/README.md`.
- Affected generated outputs after implementation/install: `.codex/skills/xagent-subagents/SKILL.md`, `$CODEX_HOME/skills/xagent-subagents/SKILL.md`, and `$HOME/.agents/skills/xagent-subagents/SKILL.md`.
- No xagent CLI behavior changes are required; the skill consumes the existing `xagent run` interface.
