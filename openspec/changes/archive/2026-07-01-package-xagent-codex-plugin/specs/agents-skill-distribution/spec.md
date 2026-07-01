## ADDED Requirements

### Requirement: asd-20 — Shared skill: xagent portable Codex usage
WHEN the agents project provides the Codex-only `xagent-subagents` guidance, THE skill body SHALL direct Codex agents to use the packaged xagent launcher or tool provided by the xagent Codex distribution instead of assuming that `xagent` is on `PATH` or built inside the active repository.

#### Scenario: Skill avoids PATH assumption
- **WHEN** a Codex agent opens the `xagent-subagents` skill
- **THEN** the skill instructs the agent to invoke the packaged launcher or tool path first
- **AND** the skill does not present bare `xagent run ...` as the only usable command form

#### Scenario: Skill explains repository-independent use
- **WHEN** a Codex agent opens the `xagent-subagents` skill
- **THEN** the skill explains that xagent should be launched from the active worktree root so child harnesses use that repository
- **AND** it explains that the executable runtime is supplied by the Codex distribution rather than by the active repository

#### Scenario: Skill explains central log permissions
- **WHEN** a Codex agent opens the `xagent-subagents` skill
- **THEN** the skill explains that packaged xagent defaults persisted logs to `/Users/joyo/Sheaf/data/xagent`
- **AND** it explains that sandboxed agents can invoke xagent but real runs may fail with `log_root_unavailable` or harness-specific errors when they lack write, network, auth, or process permissions

#### Scenario: Skill escalates broken distribution
- **WHEN** the packaged xagent launcher or tool cannot be invoked
- **THEN** the skill instructs the agent to report the broken agentic infrastructure instead of rebuilding xagent ad hoc from a guessed repository path

### Requirement: asd-21 — Shared skill: Claude Code model aliases
WHEN the `xagent-subagents` skill recommends Claude Code review models, THE skill SHALL use model names accepted by the local Claude Code CLI and SHALL recommend `opus` for strongest Opus review unless a verified newer local alias is available.

#### Scenario: Opus recommendation uses accepted alias
- **WHEN** a Codex agent opens the `xagent-subagents` skill
- **THEN** the strongest-review command example uses `--model opus`
- **AND** the surrounding guidance does not recommend the stale dotted alias `claude-opus-4.8`

#### Scenario: Model alias verification
- **WHEN** a Codex agent needs a Claude Code model alias not documented by the skill
- **THEN** the skill instructs the agent to verify the alias with local Claude Code help or an equivalent local source before retrying
- **AND** it instructs the agent not to silently downgrade to a weaker model after a model rejection
