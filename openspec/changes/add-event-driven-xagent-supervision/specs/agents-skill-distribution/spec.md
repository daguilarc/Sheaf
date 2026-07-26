## ADDED Requirements

### Requirement: asd-24 — Shared skill: event-driven xagent supervision

WHEN Codex uses the distributed `xagent-subagents` skill for a long-running external worker or reviewer, THE skill SHALL direct Codex to use the Conductor-managed xagent service through packaged HTTP MCP discovery, enter one long cursor-based await after independent controller work is exhausted, consume the final assistant report directly from the completion result, and use the quiet service-client CLI only as the documented transport fallback.

#### Scenario: Skill prefers MCP supervision

- **WHEN** Codex opens the xagent skill and the packaged supervision tools are available
- **THEN** the skill instructs Codex to verify the Conductor-managed xagent service and start the external worker through its MCP tools
- **AND** instructs Codex to await completion or attention with the returned run identifier and cursor
- **AND** instructs Codex to use the completion result's final report without reading the intermediate transcript

#### Scenario: Skill prohibits routine polling

- **WHEN** an xagent worker is healthy and the controller has no independent work
- **THEN** the skill instructs Codex not to poll `xagent list`, xagent logs, terminal `write_stdin`, or unchanged status at a short fixed interval
- **AND** instructs Codex to inspect progress only after attention, a long await deadline, or an explicit user status request

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

### Requirement: asd-25 — Shared skill: controller wait discipline

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
