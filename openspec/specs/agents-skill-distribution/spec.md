# Capability: Agents Skill Distribution

Project: `projects/agents`
ID prefix: `asd` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Maintains shared agent instructions and skills from a canonical
`projects/agents` source tree, then installs them into the harness-specific
locations used by Claude Code, Cursor, Pi, and Codex. This capability owns the
source skill metadata format, global instruction rendering, managed generated
file safety, and Makefile entry points for installing and checking the generated
agent guidance.
## Requirements
### Requirement: asd-1 — Source tree: canonical agents project
WHEN the agents project is implemented, THE repository SHALL contain `projects/agents/` with `global/AGENTS.md` as the canonical global instruction source and `global/skills/` as the canonical shared skill source tree.

#### Scenario: Source tree exists
- **WHEN** a developer inspects the repository root
- **THEN** the `projects/agents/` directory exists
- **AND** `projects/agents/global/AGENTS.md` exists
- **AND** `projects/agents/global/skills/` exists

### Requirement: asd-2 — Skill sources: one directory per shared skill
WHEN a shared skill is added, THE agents project SHALL store it under `projects/agents/global/skills/<skill-id>/` with metadata and a source `SKILL.md` body sufficient to render the skill for every supported harness target.

#### Scenario: Shared skill source exists
- **WHEN** the installer scans `projects/agents/global/skills/`
- **THEN** each shared skill is discoverable as one `projects/agents/global/skills/<skill-id>/` directory
- **AND** each shared skill includes metadata and source markdown

### Requirement: asd-3 — Initial skills: convert prompt drafts
WHEN the agents project is first implemented, THE repository SHALL include shared skills converted from the prompt drafts `about_me.me`, `git_workflow.md`, `incremental_mode.md`, `pyramid_index.md`, and `software_principles.md` found under `/Users/joyo/Desktop/prompt_draft`.

#### Scenario: Initial converted skills are present
- **WHEN** the installer scans the shared skill source tree
- **THEN** it finds source skills for `about-me`, `git-workflow`, `incremental-mode`, `pyramid-index`, and `software-principles`

### Requirement: asd-4 — Install script: repo-local target-specific skill outputs
WHEN `projects/agents/scripts/install.py install --scope repo` runs, THE installer SHALL render only Sheaf-specific skills from `projects/agents/sheaf/skills/` into the repo-local harness skill directories selected by each skill's `targets` metadata and SHALL NOT render shared skills from `projects/agents/global/skills/` into repo-local harness directories.

#### Scenario: Sheaf-only skills installed for selected repo-local targets
- **WHEN** the repo-local install command completes successfully
- **THEN** every Sheaf-only skill has an installed `SKILL.md` file in each selected repo-local harness skill directory
- **AND** the installer does not create repo-local skill outputs for harness targets omitted from the skill metadata

#### Scenario: Shared global skill is not installed repo-locally
- **WHEN** a skill exists under `projects/agents/global/skills/<skill-id>/`
- **AND** repo-local install runs successfully
- **THEN** the installer does not render that skill under `.claude/skills/`, `.cursor/skills/`, `.pi/skills/`, or `.codex/skills/`

### Requirement: asd-5 — Install script: global instruction outputs
WHEN `projects/agents/scripts/install.py install` runs, THE installer SHALL render `projects/agents/global/AGENTS.md` to repository-root `AGENTS.md` and repository-root `CLAUDE.md`.

#### Scenario: Global instructions installed
- **WHEN** the install command completes successfully
- **THEN** root `AGENTS.md` exists with the rendered global instruction content
- **AND** root `CLAUDE.md` exists with the rendered global instruction content

### Requirement: asd-6 — Install script: managed-file safety
IF an install destination exists, differs from the rendered output, and is not marked as managed by the agents installer, THEN THE installer SHALL fail without overwriting it unless the user explicitly passes a force option.

#### Scenario: Unmarked conflict
- **WHEN** a destination file exists without the managed marker
- **AND** the destination content differs from the rendered content
- **THEN** installation fails before overwriting the file

### Requirement: asd-7 — Check mode: drift detection
WHEN `projects/agents/scripts/install.py check` runs, THE installer SHALL compare the rendered outputs with installed files and exit non-zero if any managed output is missing or stale.

#### Scenario: Installed output is stale
- **WHEN** an installed skill file differs from the rendered source
- **THEN** check mode exits non-zero and reports the stale path

### Requirement: asd-8 — Clean mode: managed output removal
WHEN `projects/agents/scripts/install.py clean` runs, THE installer SHALL remove only files and directories it can identify as managed agents-installer outputs.

#### Scenario: Unmanaged file exists
- **WHEN** clean mode encounters an unmarked file in a harness skill directory
- **THEN** it leaves the unmarked file unchanged

### Requirement: asd-9 — Makefile: delegated agents targets
WHEN the agents project is implemented, THE root Makefile SHALL expose delegated `agents`, `agents-install`, `agents-check`, and `agents-clean` targets that call the matching targets in `projects/agents/Makefile`.

#### Scenario: Agent install target invoked
- **WHEN** a developer runs `make agents-install`
- **THEN** make delegates to `projects/agents/Makefile`
- **AND** the agents installer runs in install mode

### Requirement: asd-10 — Install scopes: repo, global, and all
WHEN `projects/agents/scripts/install.py` runs in `install`, `check`, or `clean` mode, THE installer SHALL accept a scope option with values `repo`, `global`, and `all`, where `all` is the default and includes both repo-local and user-global outputs.

#### Scenario: Default scope is all
- **WHEN** a developer runs `projects/agents/scripts/install.py install` without a scope
- **THEN** the installer processes both repo-local outputs and user-global outputs

#### Scenario: Repo-only scope
- **WHEN** a developer runs `projects/agents/scripts/install.py install --scope repo`
- **THEN** the installer processes repo-local outputs only

#### Scenario: Global-only scope
- **WHEN** a developer runs `projects/agents/scripts/install.py install --scope global`
- **THEN** the installer processes user-global outputs only

### Requirement: asd-11 — User-global instruction outputs
WHEN `projects/agents/scripts/install.py install --scope global` runs, THE installer SHALL render `projects/agents/global/AGENTS.md` to the user-global instruction paths `$HOME/.claude/CLAUDE.md`, `$HOME/.cursor/AGENTS.md`, `$HOME/.pi/AGENTS.md`, and `$CODEX_HOME/AGENTS.md` with `CODEX_HOME` defaulting to `$HOME/.codex`.

#### Scenario: Global instructions installed
- **WHEN** the global install command completes successfully
- **THEN** `$HOME/.claude/CLAUDE.md` exists with the rendered global instruction content
- **AND** `$HOME/.cursor/AGENTS.md` exists with the rendered global instruction content
- **AND** `$HOME/.pi/AGENTS.md` exists with the rendered global instruction content
- **AND** `$CODEX_HOME/AGENTS.md` exists with the rendered global instruction content

### Requirement: asd-12 — User-global target-specific skill outputs
WHEN `projects/agents/scripts/install.py install --scope global` runs, THE installer SHALL render each shared skill into only the user-global harness skill directories selected by that skill's `targets` metadata, with `CODEX_HOME` defaulting to `$HOME/.codex`.

#### Scenario: Global skills installed for selected targets
- **WHEN** the global install command completes successfully
- **THEN** every shared skill has an installed `SKILL.md` file in each selected user-global harness skill directory
- **AND** the installer does not create user-global skill outputs for harness targets omitted from the skill metadata

#### Scenario: Codex-only global skill installed only for Codex
- **WHEN** a shared skill declares `targets` containing only `codex`
- **AND** global install runs successfully
- **THEN** the skill is rendered to `$HOME/.agents/skills/<skill-id>/SKILL.md`
- **AND** the skill is rendered to `$CODEX_HOME/skills/<skill-id>/SKILL.md`
- **AND** the skill is not rendered to `$HOME/.claude/skills/<skill-id>/SKILL.md`
- **AND** the skill is not rendered to `$HOME/.cursor/skills/<skill-id>/SKILL.md`
- **AND** the skill is not rendered to `$HOME/.pi/skills/<skill-id>/SKILL.md`

### Requirement: asd-13 — Global check mode
WHEN `projects/agents/scripts/install.py check --scope global` runs, THE installer SHALL compare rendered user-global outputs with installed user-global files and exit non-zero if any managed output is missing, stale, or blocked by an unmanaged conflicting file.

#### Scenario: Global output is missing
- **WHEN** a user-global skill output is missing
- **THEN** global check mode exits non-zero and reports the missing path

#### Scenario: Global output is stale
- **WHEN** a user-global instruction file differs from the rendered source
- **THEN** global check mode exits non-zero and reports the stale path

### Requirement: asd-14 — Global clean mode
WHEN `projects/agents/scripts/install.py clean --scope global` runs, THE installer SHALL remove only user-global outputs that are marked as managed by the agents installer.

#### Scenario: Unmanaged global file exists
- **WHEN** global clean mode encounters an unmarked file at a configured global destination
- **THEN** it leaves the unmarked file unchanged

### Requirement: asd-15 — Makefile: scoped agents install targets
WHEN the agents project is implemented, THE root Makefile and `projects/agents/Makefile` SHALL expose install, check, and clean targets for all scopes, repo-only scope, and global-only scope.

#### Scenario: Global install target invoked
- **WHEN** a developer runs `make agents-install-global`
- **THEN** make delegates to `projects/agents/Makefile`
- **AND** the agents installer runs in install mode with global scope

#### Scenario: Default install target invoked
- **WHEN** a developer runs `make agents-install`
- **THEN** make delegates to `projects/agents/Makefile`
- **AND** the agents installer runs in install mode with all scope

### Requirement: asd-16 — Shared skill: smoke-test

THE agents project SHALL provide a Sheaf-only `smoke-test` skill under `projects/agents/sheaf/skills/smoke-test/` (a `skill.yaml` with `id: smoke-test` targeting every supported harness plus a source `SKILL.md`) that documents how to ask production Conductor to launch services from the active worktree for human testing, replace the production-port service instances during the session, preserve git-ignored assets from the main checkout via `smoke_test: true`, and poll service health.

#### Scenario: Smoke-test skill source exists

- **WHEN** the installer scans `projects/agents/global/skills/`
- **THEN** the `smoke-test/` skill directory is not present in the global shared skill source tree
- **AND** `projects/agents/sheaf/skills/smoke-test/` is discoverable with a `skill.yaml` (`id: smoke-test`) and a `SKILL.md`

#### Scenario: Skill passes worktree to production Conductor

- **WHEN** an agent opens the `smoke-test` skill
- **THEN** the skill body explains that production Conductor handles smoke-test lifecycle requests
- **AND** it provides a copy-paste script or command sequence that verifies production Conductor is healthy, builds the current worktree services, restarts the asset-dependent services with `smoke_test: true` and a `worktree` path for the current worktree, and polls their health

#### Scenario: Skill describes worktree-code production-asset semantics

- **WHEN** an agent opens the `smoke-test` skill
- **THEN** the skill body explains that restarted services temporarily replace the production-port service instances with services launched from the worktree's code and tracked config
- **AND** it explains that git-ignored assets such as API keys, `.secrets.json`, and models continue to resolve from the main checkout asset root injected by Conductor

#### Scenario: Skill provides origin verification and recovery

- **WHEN** an agent opens the `smoke-test` skill
- **THEN** the skill body provides verification guidance that helps confirm Conductor and the restarted services are running from the worktree rather than the production checkout
- **AND** it provides recovery guidance for returning the production stack after manual smoke testing

#### Scenario: Skill distributes only to repo-local harness targets

- **WHEN** `make agents-install-repo` runs after the skill is added
- **THEN** the `smoke-test` skill is rendered into each supported repo-local harness skills location selected by its targets
- **AND** `make agents-install-global` does not render `smoke-test` into any user-global skill location

### Requirement: asd-17 — Source tree: Sheaf-only skills

WHEN a skill is specific to this repository rather than suitable for user-global distribution, THE agents project SHALL store it under `projects/agents/sheaf/skills/<skill-id>/` with the same `skill.yaml` metadata and source `SKILL.md` body format used by global shared skills, and THE installer SHALL render it only into repo-local harness skill directories.

#### Scenario: Sheaf-only skill source exists

- **WHEN** the installer scans `projects/agents/sheaf/skills/`
- **THEN** each Sheaf-only skill is discoverable as one `projects/agents/sheaf/skills/<skill-id>/` directory
- **AND** each Sheaf-only skill includes metadata and source markdown

#### Scenario: Sheaf-only skill installs to repo-local targets

- **WHEN** `projects/agents/scripts/install.py install --scope repo` runs
- **THEN** each Sheaf-only skill is rendered into the repo-local harness skill directories selected by its `targets`

#### Scenario: Sheaf-only skill is excluded from user-global targets

- **WHEN** `projects/agents/scripts/install.py install --scope global` runs
- **THEN** Sheaf-only skills are not rendered into user-global harness skill directories

### Requirement: asd-18 — Install script: obsolete global skill cleanup

WHEN a previously global skill becomes Sheaf-only or plugin-owned, THE agents installer SHALL remove or report the obsolete managed user-global outputs for that skill during global install, check, and clean operations without deleting unmanaged files.

#### Scenario: Global install prunes obsolete managed skill

- **WHEN** `projects/agents/scripts/install.py install --scope global` runs
- **AND** an obsolete user-global skill output exists with the agents managed marker
- **THEN** the installer removes that obsolete output instead of leaving it installed globally

#### Scenario: Global check reports obsolete managed skill

- **WHEN** `projects/agents/scripts/install.py check --scope global` runs
- **AND** an obsolete user-global skill output exists with the agents managed marker
- **THEN** check mode exits non-zero and reports the obsolete output

#### Scenario: Global cleanup preserves unmanaged skill

- **WHEN** `projects/agents/scripts/install.py clean --scope global` runs
- **AND** an obsolete user-global skill path exists without the agents managed marker
- **THEN** clean mode leaves that file unchanged

#### Scenario: Plugin-owned standalone skill is pruned globally

- **WHEN** global agents installation runs after `xagent-subagents` becomes plugin-owned
- **AND** a standalone user-global `xagent-subagents` output exists with the agents managed marker
- **THEN** the installer removes that obsolete standalone skill output
- **AND** it does not remove the xagent plugin's bundled skill

### Requirement: asd-19 — Shared skill: OpenSpec Superpowers workflow

WHEN OpenSpec and Superpowers are both used to plan and implement changes, THE agents project SHALL provide a global `openspec-superpowers-workflow` skill under `projects/agents/global/skills/openspec-superpowers-workflow/` with metadata and source instructions that guide agents through converting an OpenSpec change into a Superpowers subagent-driven implementation workflow.

#### Scenario: OpenSpec Superpowers workflow skill source exists

- **WHEN** the installer scans `projects/agents/global/skills/`
- **THEN** it finds an `openspec-superpowers-workflow/` skill directory
- **AND** that directory includes a `skill.yaml` with `id: openspec-superpowers-workflow`
- **AND** that directory includes a source `SKILL.md`

#### Scenario: Skill preserves OpenSpec as source of truth

- **WHEN** an agent opens the `openspec-superpowers-workflow` skill
- **THEN** the skill body instructs the agent to inspect OpenSpec status and apply instructions for the selected change
- **AND** it instructs the agent to read every context file returned by OpenSpec before writing or executing a Superpowers implementation plan

#### Scenario: Skill routes ambiguity through brainstorming

- **WHEN** an agent opens the `openspec-superpowers-workflow` skill
- **THEN** the skill body explains that brainstorming is required before implementation when OpenSpec artifacts are ambiguous, incomplete, or require new design decisions
- **AND** it explains that full brainstorming is not required when the OpenSpec proposal, specs, design, and tasks are already clear and approved

#### Scenario: Skill supports plan-and-execute automation

- **WHEN** an agent opens the `openspec-superpowers-workflow` skill
- **THEN** the skill body explains how to write a Superpowers plan from OpenSpec artifacts
- **AND** it explains how explicit user pre-authorization can allow the agent to execute that plan with `superpowers:subagent-driven-development` without pausing for human checkpoints between plan creation and task execution
- **AND** it requires stopping for ambiguity, blockers, failed agentic infrastructure, approval-required commands, user interruption, or completion

#### Scenario: Skill keeps OpenSpec progress synchronized

- **WHEN** an agent opens the `openspec-superpowers-workflow` skill
- **THEN** the skill body instructs the agent to update OpenSpec task checkboxes only after the corresponding Superpowers task work is complete and verified

#### Scenario: Skill distributes globally

- **WHEN** `projects/agents/scripts/install.py install --scope global` runs after the skill is added
- **THEN** the `openspec-superpowers-workflow` skill is rendered into each supported user-global skill destination selected by its targets

### Requirement: asd-23 — Shared skill: xagent-subagents

WHEN Codex review or subagent work benefits from cross-provider opinions, THE xagent Codex plugin SHALL provide a Codex-only `xagent-subagents` skill under `plugins/xagent/skills/xagent-subagents/`, SHALL distinguish Superpowers SDD dispatch from generic delegation, and THE agents project SHALL NOT install a standalone repo-local or user-global copy of that plugin-owned skill.

#### Scenario: xagent-subagents skill has one canonical source

- **WHEN** the xagent plugin source is inspected
- **THEN** `plugins/xagent/skills/xagent-subagents/SKILL.md` exists
- **AND** `projects/agents/global/skills/xagent-subagents/` does not exist
- **AND** `projects/agents/sheaf/skills/xagent-subagents/` does not exist

#### Scenario: Skill directs generic Claude review through the xagent service

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill for review work outside Superpowers SDD
- **THEN** the skill body instructs Codex to start a Claude-backed reviewer through the xagent service MCP `xagent_start` tool with the `claude_code` harness
- **AND** the skill body documents the quiet `xagent supervise` service-client fallback for when plugin MCP discovery is unavailable but the Conductor-managed xagent service is healthy
- **AND** the skill body instructs Codex to include the review scope, expected output shape, and relevant files or diffs in the subagent prompt

#### Scenario: Skill directs Superpowers SDD through the SDD facade

- **WHEN** Codex opens the plugin-provided skill for a Superpowers SDD turn
- **THEN** the skill body requires the xagent SDD MCP facade
- **AND** prohibits generic raw-prompt tools, native subagents, and the quiet CLI fallback for that SDD turn

#### Scenario: Skill explains repository-independent use

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill
- **THEN** the skill explains that xagent is launched from the active worktree root so child harnesses use that repository
- **AND** it explains that the executable runtime is supplied by the installed Codex plugin rather than by the active repository
- **AND** it explains that packaged xagent defaults persisted logs to the Sheaf central log root, configurable via `XAGENT_LOG_ROOT` for the generic packaged client

#### Scenario: Skill documents Claude model tiers

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill
- **THEN** the skill body documents `opus`, `sonnet`, and `haiku` as Claude reviewer tiers in prose
- **AND** the documented generic quiet-supervise command example uses `--model sonnet` as the balanced default
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

### Requirement: asd-20 — Source tree: Codex global hook assets

WHEN Codex-specific user-global hook behavior is added, THE agents project SHALL store the canonical hook configuration template and hook script under `projects/agents/global/codex/`.

#### Scenario: Codex hook source assets exist

- **WHEN** a developer inspects `projects/agents/global/codex/`
- **THEN** the Codex hook configuration template is present in that tree
- **AND** the hook script that emits the post-compaction reminder is present in that tree

#### Scenario: Codex hook assets remain repository-owned

- **WHEN** the agents installer renders user-global Codex hook outputs
- **THEN** it uses the files under `projects/agents/global/codex/` as the source of truth
- **AND** it does not require hook source files that live only under `$CODEX_HOME`

### Requirement: asd-21 — User-global Codex hook installation

WHEN `projects/agents/scripts/install.py install --scope global` runs, THE agents installer SHALL install the Codex post-compaction hook into the resolved `$CODEX_HOME` user-global hook location with managed-file safety.

#### Scenario: Global install writes Codex hook outputs

- **WHEN** the global install command completes successfully
- **THEN** the Codex hook script exists under the resolved `$CODEX_HOME`
- **AND** the Codex user-global hook configuration exists under the resolved `$CODEX_HOME`
- **AND** the hook configuration references the installed hook script with a stable absolute path

#### Scenario: Global check validates Codex hook outputs

- **WHEN** `projects/agents/scripts/install.py check --scope global` runs
- **THEN** check mode compares the rendered Codex hook script and hook configuration with the installed files
- **AND** check mode exits non-zero if either file is missing, stale, or blocked by an unmanaged conflict

#### Scenario: Global clean removes managed Codex hook outputs

- **WHEN** `projects/agents/scripts/install.py clean --scope global` runs
- **THEN** clean mode removes managed Codex hook files installed by the agents installer
- **AND** clean mode leaves unmanaged Codex hook files unchanged

#### Scenario: Repo install does not activate global Codex hooks

- **WHEN** `projects/agents/scripts/install.py install --scope repo` runs
- **THEN** the installer does not write the user-global Codex hook configuration
- **AND** the installer does not write the user-global Codex hook script

### Requirement: asd-22 — Codex hook behavior: post-compaction plan reminder

WHEN Codex starts a session with `SessionStart` source `compact`, THE installed Sheaf Codex hook SHALL inject extra developer context reminding the agent to review any active plan, checklist, or task list after compaction.

#### Scenario: Hook emits reminder after compaction

- **WHEN** the hook receives a `SessionStart` event whose source is `compact`
- **THEN** the hook outputs Codex-compatible hook JSON with `hookSpecificOutput.hookEventName` set to `SessionStart`
- **AND** the hook output includes additional developer context containing the reminder "If you were working from a plan, checklist, or task list, please review it after compaction."

#### Scenario: Hook ignores non-compaction starts

- **WHEN** the hook receives a `SessionStart` event whose source is `startup`, `resume`, or `clear`
- **THEN** the hook exits successfully without injecting additional developer context

#### Scenario: Hook output identifies its source

- **WHEN** the hook injects additional developer context
- **THEN** the injected context identifies itself as a post-compaction reminder from the Sheaf Codex hook
- **AND** the injected context does not present itself as a new user request

### Requirement: asd-24 — Install script: obsolete repo-local global skill cleanup
WHEN shared skills are user-global only, THE agents installer SHALL remove or report obsolete managed repo-local outputs previously rendered from `projects/agents/global/skills/` during repo install, check, and clean operations without deleting unmanaged files.

#### Scenario: Repo install prunes obsolete managed global skill
- **WHEN** `projects/agents/scripts/install.py install --scope repo` runs
- **AND** an obsolete repo-local global skill output exists with the agents managed marker
- **THEN** the installer removes that obsolete output

#### Scenario: Repo check reports obsolete managed global skill
- **WHEN** `projects/agents/scripts/install.py check --scope repo` runs
- **AND** an obsolete repo-local global skill output exists with the agents managed marker
- **THEN** check mode exits non-zero and reports the obsolete output

#### Scenario: Repo clean removes obsolete managed global skill
- **WHEN** `projects/agents/scripts/install.py clean --scope repo` runs
- **AND** an obsolete repo-local global skill output exists with the agents managed marker
- **THEN** clean mode removes that obsolete output

#### Scenario: Repo cleanup preserves unmanaged skill
- **WHEN** a repo-local path formerly used by a global skill contains a file without the agents managed marker
- **THEN** install, check, and clean operations leave that unmanaged file unchanged

### Requirement: asd-25 — Shared skill: event-driven xagent supervision

WHEN Codex uses the distributed `xagent-subagents` skill for a long-running external worker or reviewer, THE skill SHALL direct Codex to use the Conductor-managed xagent service through packaged HTTP MCP discovery, enter one long cursor-based await after independent controller work is exhausted, consume the final assistant report directly from the completion result, use the quiet service-client CLI only as the documented transport fallback for non-SDD delegation, and prohibit that fallback for Superpowers SDD.

#### Scenario: Skill prefers MCP supervision

- **WHEN** Codex opens the xagent skill and the packaged supervision tools are available
- **THEN** the skill instructs Codex to verify the Conductor-managed xagent service and start the external worker through its MCP tools
- **AND** instructs Codex to await completion or attention with the returned run identifier and cursor
- **AND** instructs Codex to use the completion result's final report without reading the intermediate transcript

#### Scenario: Skill prohibits routine polling

- **WHEN** an xagent worker is healthy and the controller has no independent work
- **THEN** the skill instructs Codex not to poll `xagent list`, xagent logs, terminal `write_stdin`, or unchanged status at a short fixed interval
- **AND** instructs Codex to inspect supervision state only after attention, a long await deadline, or an explicit user status request, and that the supervised path persists lifecycle, attention, and watchdog records rather than a provider transcript

#### Scenario: Skill documents generic quiet CLI fallback

- **WHEN** plugin MCP discovery is unavailable during non-SDD delegation but the Conductor-managed xagent service and packaged xagent CLI remain functional
- **THEN** the skill documents the quiet service-client command as a transport fallback
- **AND** instructs Codex to issue one service-side blocking await rather than terminal polling
- **AND** requires Codex to surface the MCP discovery failure rather than hiding it

#### Scenario: Skill rejects quiet CLI fallback for SDD

- **WHEN** plugin MCP discovery is unavailable during a Superpowers SDD turn
- **THEN** the skill requires the controller to report broken SDD infrastructure
- **AND** prohibits quiet CLI or native-subagent fallback for that turn

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

WHEN the distributed `openspec-superpowers-workflow` skill coordinates pre-plan helpers or xagent SDD task agents, THE skill SHALL require event-driven completion/attention waits, long wait deadlines, and blocker-or-final child messaging; SHALL prohibit repeated unchanged status snapshots and short fixed-interval wait loops; and SHALL keep routine progress out of the leader model context.

#### Scenario: SDD agent uses one long xagent await

- **WHEN** a Superpowers SDD implementation or review agent is running
- **AND** the controller has exhausted independent work
- **THEN** the workflow instructs the controller to use one long xagent SDD await
- **AND** not to use native mailbox waits or short status loops

#### Scenario: Non-SDD native helper uses a long mailbox wait

- **WHEN** a pre-plan helper outside the Superpowers SDD task facade runs as a native subagent
- **AND** the controller has exhausted independent work
- **THEN** the workflow instructs the controller to use one long native mailbox wait
- **AND** not to repeat the native default short timeout merely to observe unchanged state

#### Scenario: Non-SDD native child messaging is sparse

- **WHEN** the workflow dispatches a native pre-plan helper
- **THEN** the dispatch instructs the child to message the controller only for required input, an unresolved blocker, or final completion
- **AND** routine tool progress remains in the child thread or activity UI

#### Scenario: Multiple agents complete independently

- **WHEN** one of several running subagents completes or needs attention
- **THEN** the controller handles that event
- **AND** enters another long event wait for remaining agents without inserting unchanged agent-list snapshots

#### Scenario: Status inspection has a reason

- **WHEN** the workflow performs a direct agent-list, log, or transcript inspection
- **THEN** the inspection follows a long wait deadline, a reported attention event, or an explicit user status request
- **AND** is not part of a fixed-frequency polling loop

## ADDED Requirements

### Requirement: asd-27 — Shared skill: mandatory xagent SDD routing

WHEN the `openspec-superpowers-workflow` skill executes a written Superpowers plan task, THE skill SHALL require every implementer, task reviewer, fix, re-review, and final whole-branch reviewer turn to use the xagent SDD MCP facade with the assigned agent/model, harness, and effort; SHALL require fix and re-review follow-ups to reuse their recorded implementer or task-reviewer SDD agent IDs while the workflow permits reuse; SHALL treat the final whole-branch `code-reviewer` as a single-turn `xagent_sdd_start` → await → `xagent_sdd_close` session with no follow-up; and SHALL prohibit native subagent transport, raw xagent prompt/message composition, and terminal xagent fallback for those SDD turns.

#### Scenario: Initial task agents use SDD start

- **WHEN** the workflow dispatches an implementer or task reviewer for a Superpowers plan task
- **THEN** the skill directs the controller to call `xagent_sdd_start`
- **AND** requires the controller to pass the complete brief and assignment metadata
- **AND** does not offer native dispatch as an alternative

#### Scenario: Fix and re-review preserve sessions

- **WHEN** a task enters a fix round that permits agent reuse
- **THEN** the skill directs the controller to call `xagent_sdd_followup` with the existing implementer or task-reviewer agent ID
- **AND** prohibits starting a fresh agent merely to send that follow-up

#### Scenario: Whole-branch reviewer is single-turn

- **WHEN** the workflow dispatches the final whole-branch `code-reviewer`
- **THEN** the skill directs the controller to use `xagent_sdd_start`, one long await, and `xagent_sdd_close`
- **AND** does not offer `xagent_sdd_followup` for that session
- **AND** treats a later whole-branch review round as a new `xagent_sdd_start`

#### Scenario: SDD reports use persisted await

- **WHEN** an SDD agent is running and independent controller work is exhausted
- **THEN** the skill directs the controller to call one long `xagent_sdd_await`
- **AND** consume the returned report only after xagent records it

#### Scenario: SDD MCP is unavailable

- **WHEN** the xagent SDD MCP facade or Conductor-managed xagent service is unavailable
- **THEN** the skill requires the controller to surface broken agentic infrastructure
- **AND** prohibits falling back to a native subagent, raw xagent tools, or the terminal service client for that SDD turn

#### Scenario: Planning helpers remain outside the task facade

- **WHEN** the workflow performs pre-plan OpenSpec review, decomposition, or plan generation before a Superpowers SDD plan task exists
- **THEN** those operations continue to follow their own documented dispatch contracts
- **AND** do not fabricate an SDD plan or task identity solely to enter the SDD ledger

### Requirement: asd-28 — Plugin skill: SDD-specific xagent API

WHEN a controller uses the plugin-provided `xagent-subagents` skill for Superpowers SDD, THE skill SHALL direct it to the xagent SDD MCP facade rather than the generic xagent tools, explain the initial and follow-up lifecycle, require report consumption through `xagent_sdd_await`, and reserve the generic MCP and quiet service-client guidance for non-SDD delegation.

#### Scenario: Skill distinguishes SDD from generic delegation

- **WHEN** a controller opens the xagent skill
- **THEN** the skill identifies `xagent_sdd_start`, `xagent_sdd_followup`, `xagent_sdd_await`, and `xagent_sdd_close` as the required Superpowers SDD path
- **AND** identifies the generic tools as the path for work outside Superpowers SDD

#### Scenario: Skill documents ledger identity

- **WHEN** the skill explains an SDD dispatch
- **THEN** it tells the controller to retain the returned `agent_id` and supervision sequence
- **AND** explains that xagent records the brief and sanitized report in its SDD ledger before report delivery
- **AND** does not describe the sequence as a provider JSONL position

#### Scenario: Skill source remains plugin-owned

- **WHEN** the xagent SDD guidance is updated
- **THEN** its canonical xagent skill source remains under `plugins/xagent/skills/xagent-subagents/`
- **AND** the agents installer does not create a competing standalone copy
