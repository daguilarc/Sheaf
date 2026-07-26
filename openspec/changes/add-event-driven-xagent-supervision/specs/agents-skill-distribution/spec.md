## MODIFIED Requirements

### Requirement: asd-23 — Shared skill: xagent-subagents

WHEN Codex review or subagent work benefits from cross-provider opinions, THE xagent Codex plugin SHALL provide a Codex-only `xagent-subagents` skill under `plugins/xagent/skills/xagent-subagents/`, and THE agents project SHALL NOT install a standalone repo-local or user-global copy of that plugin-owned skill.

#### Scenario: xagent-subagents skill has one canonical source

- **WHEN** the xagent plugin source is inspected
- **THEN** `plugins/xagent/skills/xagent-subagents/SKILL.md` exists
- **AND** `projects/agents/global/skills/xagent-subagents/` does not exist
- **AND** `projects/agents/sheaf/skills/xagent-subagents/` does not exist

#### Scenario: Skill directs Codex to start Claude review through the xagent service

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill for review work
- **THEN** the skill body instructs Codex to start a Claude-backed reviewer through the xagent service MCP `xagent_start` tool with the `claude_code` harness
- **AND** the skill body documents the quiet `xagent supervise` service-client fallback for when plugin MCP discovery is unavailable but the Conductor-managed xagent service is healthy
- **AND** the skill body instructs Codex to include the review scope, expected output shape, and relevant files or diffs in the subagent prompt

#### Scenario: Skill explains repository-independent use

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill
- **THEN** the skill explains that xagent is launched from the active worktree root so child harnesses use that repository
- **AND** it explains that the executable runtime is supplied by the installed Codex plugin rather than by the active repository
- **AND** it explains that packaged xagent defaults persisted logs to the Sheaf central log root, configurable via `XAGENT_LOG_ROOT`

#### Scenario: Skill documents Claude model tiers

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill
- **THEN** the skill body documents `opus`, `sonnet`, and `haiku` as Claude reviewer tiers in prose
- **AND** the documented quiet-supervise command example uses `--model sonnet` as the balanced default
- **AND** the surrounding guidance does not recommend the stale dotted alias `claude-opus-4.8`
- **AND** the skill instructs Codex to verify unfamiliar Claude Code model aliases locally before retrying
- **AND** it instructs Codex not to silently downgrade to a weaker model after a model rejection

#### Scenario: Skill documents Cursor and GPT worker routing

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill
- **THEN** the skill body identifies Cursor Composer 2.5 as a capable worker option through the Cursor harness
- **AND** the skill body instructs Codex to prefer a GPT or Codex-backed worker agent for the trickiest implementation tasks

#### Scenario: Skill preserves agentic infrastructure escalation

- **WHEN** the packaged xagent launcher or tool, Claude Code, Cursor Agent, or a selected model cannot be launched as instructed
- **THEN** the skill body instructs Codex to surface the failure instead of silently working around broken agentic infrastructure

## ADDED Requirements

### Requirement: asd-25 — Shared skill: event-driven xagent supervision

WHEN Codex uses the distributed `xagent-subagents` skill for a long-running external worker or reviewer, THE skill SHALL direct Codex to use the Conductor-managed xagent service through packaged HTTP MCP discovery, enter one long cursor-based await after independent controller work is exhausted, consume the final assistant report directly from the completion result, and use the quiet service-client CLI only as the documented transport fallback.

#### Scenario: Skill prefers MCP supervision

- **WHEN** Codex opens the xagent skill and the packaged supervision tools are available
- **THEN** the skill instructs Codex to verify the Conductor-managed xagent service and start the external worker through its MCP tools
- **AND** instructs Codex to await completion or attention with the returned run identifier and cursor
- **AND** instructs Codex to use the completion result's final report without reading the intermediate transcript

#### Scenario: Skill prohibits routine polling

- **WHEN** an xagent worker is healthy and the controller has no independent work
- **THEN** the skill instructs Codex not to poll `xagent list`, xagent logs, terminal `write_stdin`, or unchanged status at a short fixed interval
- **AND** instructs Codex to inspect supervision state only after attention, a long await deadline, or an explicit user status request, and that the supervised path persists lifecycle, attention, and watchdog records rather than a provider transcript

#### Scenario: Skill documents quiet CLI fallback

- **WHEN** plugin MCP discovery is unavailable but the Conductor-managed xagent service and packaged xagent CLI remain functional
- **THEN** the skill documents the quiet service-client command as a transport fallback
- **AND** instructs Codex to issue one service-side blocking await rather than terminal polling
- **AND** requires Codex to surface the MCP discovery failure rather than hiding it

#### Scenario: Xagent service is unavailable

- **WHEN** the registered xagent service is unhealthy or unreachable
- **THEN** the skill requires Codex to surface broken agentic infrastructure and inspect Conductor health
- **AND** prohibits launching an embedded, plugin-local, or unmanaged replacement supervisor

#### Scenario: Skill explains watchdog boundary

- **WHEN** Codex opens the xagent skill
- **THEN** the skill explains that crashes, silence, completion, deadlines, and exposed input waits are deterministic
- **AND** explains that Haiku is used only to detect active semantic derailment or uncertainty
- **AND** explains that watchdog attention never autonomously acts on the worker

### Requirement: asd-26 — Shared skill: controller wait discipline

WHEN the distributed `openspec-superpowers-workflow` skill coordinates native or xagent subagents, THE skill SHALL require event-driven completion/attention waits, long wait deadlines, and blocker-or-final child messaging; SHALL prohibit repeated unchanged status snapshots and short fixed-interval wait loops; and SHALL keep routine progress out of the leader model context.

#### Scenario: Native subagent uses long mailbox wait

- **WHEN** native implementation or review subagents are running
- **AND** the controller has exhausted independent work
- **THEN** the workflow instructs the controller to use one long native mailbox wait
- **AND** not to repeat the native default short timeout merely to observe unchanged state

#### Scenario: Native child messaging is sparse

- **WHEN** the workflow dispatches a native subagent
- **THEN** the dispatch instructs the child to message the controller only for required input, an unresolved blocker, or final completion
- **AND** routine tool progress remains in the child thread or activity UI

#### Scenario: Multiple agents complete independently

- **WHEN** one of several running subagents completes or needs attention
- **THEN** the controller handles that event
- **AND** enters another long event wait for remaining agents without inserting unchanged `list_agents` snapshots

#### Scenario: Status inspection has a reason

- **WHEN** the workflow performs a direct agent-list, log, or transcript inspection
- **THEN** the inspection follows a long wait deadline, a reported attention event, or an explicit user status request
- **AND** is not part of a fixed-frequency polling loop
