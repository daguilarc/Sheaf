# Quest Runner — Living Spec

The quest runner is a service that executes **quests** — units of feature work
— through a YAML-defined state machine of LLM-agent roles operating in git
worktrees. It exposes an HTTP API and CLI for quest lifecycle, issues, slices,
and experiments, plus a web dashboard with live agent-log streaming.

This directory is the project's living spec under the rules in
[Docs Structure](../../../structure/docs-structure.md): normative
requirements with stable IDs, held to the rebuild-test standard. Spec status
and known gaps are tracked in [coverage.md](coverage.md).

- [Architecture](architecture.md) — components, execution data flow, key
  design decisions.
- [Operations](operations.md) — build, run, test, and operate, from fresh
  checkout.
- [Coverage](coverage.md) — rebuild-test audit and gap register.

## Capability Map

| Capability | Prefix | What it specifies |
|---|---|---|
| [quest-lifecycle](../../../openspec/specs/quest-runner-quest-lifecycle/spec.md) | `ql` | Create, run, advance, upgrade, and land quests; worktrees, branches, commit conventions, human-intervention pauses |
| [service-lifecycle](../../../openspec/specs/quest-runner-service-lifecycle/spec.md) | `svc` | The long-running service process: health, exit, startup, registry entry, CLI base-URL resolution |
| [state-machine-engine](../../../openspec/specs/quest-runner-state-machine-engine/spec.md) | `sm` | The workflow YAML language semantics: machines, transitions, conditions, actions, variables, collections, the step model |
| [workflow-config](../../../openspec/specs/quest-runner-workflow-config/spec.md) | `wf` | The `workflow/` package format: workflow.yaml, profiles, prompts, preamble; the packaged default eight-role pipeline |
| [agent-harness](../../../openspec/specs/quest-runner-agent-harness/spec.md) | `ah` | Harness adapters (codex, claude_code, cursor), thread registry, step logs, path enforcement, the agent VM |
| [issues](../../../openspec/specs/quest-runner-issues/spec.md) | `iss` | Issue files, issue HTTP API, issue CLI, ownership and response semantics |
| [slices](../../../openspec/specs/quest-runner-slices/spec.md) | `sl` | Slice initialization API/CLI, naming, numbering, scaffolding |
| [experiments](../../../openspec/specs/quest-runner-experiments/spec.md) | `exp` | Replay experiments: create, scoped runs, stop conditions, landing/archival |
| [dashboard](../../../openspec/specs/quest-runner-dashboard/spec.md) | `dash` | The dashboard SPA and `/api/dashboard/*` data endpoints, including git views |
| [chat-stream](../../../openspec/specs/quest-runner-chat-stream/spec.md) | `chat` | WebSocket agent-log streaming and quest-event → AGUI mapping |

## Shared Contracts

- [Runtime files](contracts/runtime-files.md) — the quest directory layout
  and every persistent file format (meta.json, state.md, thread registry,
  sentinels, step logs, issue files, experiments).
- [Agent harness event schema](../../../structure/agent-harness-event-schema.md)
  — the tagged-union schema for step-log events (repo-level, shared across
  projects).
