---
name: xagent-subagents
description: Use packaged xagent from Codex to launch cross-provider review and worker subagents from any active repository.
---

# xagent Subagents

Use this skill when Codex needs an external review opinion, a cross-provider
second pass, or a delegated worker through the Conductor-managed xagent service.

Before launching a worker, verify Conductor reports the registered `xagent`
service healthy at `127.0.0.1:9005`. If the service is unhealthy or
unreachable, surface broken agentic infrastructure and inspect Conductor health.
Do not launch an embedded, plugin-local, or unmanaged replacement supervisor.

Prefer the packaged HTTP MCP supervision tools declared by the xagent Codex
plugin (`http://127.0.0.1:9005/mcp`). Before invocation, `codex plugin list`
must report the xagent plugin installed and enabled at
`$HOME/.agents/plugins/plugins/xagent`.

Use the active repository as an absolute existing working directory for every
dispatch. Child harnesses run in that worktree. The executable runtime is
supplied by the installed Codex plugin rather than by the active repository.
Packaged xagent defaults persisted logs to the Sheaf central log root;
set `XAGENT_LOG_ROOT` only when intentionally validating or isolating logs
somewhere else.

## Superpowers SDD

Superpowers subagent-driven development (SDD) uses the xagent SDD MCP facade
exclusively. For every implementer, task-reviewer, fix, re-review, and final
whole-branch reviewer turn, use only these four tools:

```text
xagent_sdd_start
→ independent controller work
→ one long xagent_sdd_await
→ consume report.text
→ xagent_sdd_followup for fix or re-review on the same agent_id
→ one long xagent_sdd_await
→ xagent_sdd_close when the session is finished
```

`xagent_sdd_start` renders the role prompt through the trusted
`dispatch-prompt` executable in the service checkout, reserves the SDD ledger
row, and returns `agent_id`, `sequence`, and artifact paths. Record the
returned `agent_id` and `sequence` cursor for every turn. The returned
`sequence` is the pre-turn supervision cursor; it is not a provider JSONL position.
Pass it to `xagent_sdd_await` as `after_sequence`.

After `xagent_sdd_start` or `xagent_sdd_followup`, do independent controller
work until it is exhausted, then enter one long `xagent_sdd_await` with the
latest `sequence`. Healthy provider deltas, tools, raw events, status,
and healthy watchdog verdicts never complete an await and never enter the
leader context.

On successful completion, consume the sanitized final assistant report from
`report.text` in the await result only after xagent persists it in the SDD
ledger (report-before-return). Do not read the intermediate transcript, tail
logs, summarize progress for the leader, or read the mutable Superpowers report
file on disk. If the service completes without final text, treat that as
`missing_final_report` and escalate.

Fix rounds MUST call `xagent_sdd_followup` on the existing implementer
`agent_id`. Re-review rounds MUST call `xagent_sdd_followup` on the existing
task-reviewer `agent_id`. Do not start a fresh agent merely to send that
follow-up. The final whole-branch `code-reviewer` is a single-turn session:
`xagent_sdd_start` → await → `xagent_sdd_close`. It has no fix or re-review
follow-up; a new whole-branch review round means a new `xagent_sdd_start`.
Close each task-scoped SDD session with `xagent_sdd_close` only after its
task passes both verdicts.

While a Superpowers SDD agent is healthy and the controller has no independent
work, do not poll at a short fixed interval. Specifically, do not poll
`write_stdin`, `xagent list`, xagent logs, terminal status, or unchanged MCP
inspect output merely to observe progress. Inspect supervision state only after
attention, a long await deadline, or an explicit user status request.

If the xagent SDD MCP facade, Conductor-managed xagent service, trusted
`dispatch-prompt` renderer, or required Superpowers templates are unavailable,
surface broken agentic infrastructure. Do not fall back to native subagents,
generic `xagent_start`, raw `xagent_message`, quiet `xagent supervise`, or
terminal polling for Superpowers SDD turns.

## Generic Delegation

Use the sections below for review, worker, and other delegation outside
Superpowers SDD.

### Supervision Flow

The controller flow is:

```text
verify Conductor reports xagent healthy
→ xagent_start(cwd, prompt, harness/model/policy)
→ perform independent boss work
→ one xagent_await(run_id, after_sequence)
→ consume report.text, or handle compact attention
→ xagent_await again with the returned after_sequence only when continuing
```

Record the returned `run_id` and `after_sequence` cursor.

After `xagent_start`, do independent controller work until it is exhausted.
Then enter one long `xagent_await` with the latest cursor. Healthy provider
deltas, tools, raw events, status, and healthy watchdog verdicts never
complete an await and never enter the leader context.

On successful completion, consume the sanitized final assistant report from
`report.text` in the await result. Do not read the intermediate transcript,
tail logs, or summarize progress for the leader. If the service completes
without final text, treat that as `missing_final_report` and escalate.

When await returns compact attention instead of completion, read the attention
payload, act only at the controller layer, and call `xagent_await` again with
the returned cursor only when continuing supervision.

`xagent_message` sends unstructured user input to a generic run. Do not use it
for Superpowers SDD follow-ups; the SDD facade uses `xagent_sdd_followup`
instead.

### No Routine Polling

While a worker is healthy and the controller has no independent work, do not
poll at a short fixed interval. Specifically, do not poll `write_stdin`,
`xagent list`, xagent logs, terminal status, or unchanged MCP inspect output
merely to observe progress.

Inspect supervision state only after attention, a long await deadline, or an explicit
user status request. On the supervised path the persisted surfaces are lifecycle
phase, attention events, and watchdog telemetry — not a provider transcript; the
service does not persist routine provider output to the run logs. One long
blocking await is the default wait mechanism.

### Quiet Service-Client Fallback

When plugin MCP discovery is unavailable but Conductor reports the xagent
service healthy and the packaged xagent CLI remains functional, use the quiet
`xagent supervise` service-client fallback instead of terminal polling:

```shell
XAGENT_PLUGIN_ROOT="${HOME}/.agents/plugins/plugins/xagent"
"${XAGENT_PLUGIN_ROOT}/scripts/xagent" supervise --harness claude_code --model sonnet "<prompt>"
"${XAGENT_PLUGIN_ROOT}/scripts/xagent" await <run_id> --after-sequence <n> --deadline-seconds 7000
```

Issue one application-level blocking await per wait cycle. The quiet client may
reissue shorter HTTP MCP request chunks under the hood (≤240 seconds) until that
deadline; treat those as an implementation detail, not a polling loop. Surface
the MCP discovery failure rather than hiding it. Use this fallback only when the
Conductor-managed service is healthy and the work is outside Superpowers SDD.

### Watchdog Boundary

Mechanical supervision is deterministic and never invokes Haiku: process
exit/spawn failure, turn completion/failure, transport failure, exposed
input/permission wait, cancellation/close, hard deadline, and silence.

Haiku is eligible only while a live worker is actively producing
tokens/messages/tools. It detects active semantic derailment or uncertainty.
Watchdog results are advisory only. Watchdog attention never messages,
interrupts, kills, restarts, edits for, or otherwise steers the worker.

### Review Routing

For review tasks, prefer a Claude-backed reviewer through `xagent_start`
with the `claude_code` harness:

- `opus`: strongest reviewer for subtle architecture, security, correctness,
  or release-risk reviews.
- `sonnet`: balanced default for ordinary code review.
- `haiku`: fast, small, inexpensive reviewer for narrow diffs, copy checks, or
  quick sanity passes.

Write the review prompt with the scope and output shape:

- Name the files, diff, PR, or task being reviewed.
- Ask for findings first, ordered by severity.
- Ask for concrete file/line references when available.
- Ask the reviewer to call out uncertainty instead of filling gaps.

Do not use stale dotted model names such as `claude-opus-4.8`; local Claude
Code accepts aliases such as `opus` or full names such as `claude-opus-4-8`.
If an unfamiliar model alias is needed, verify it with local Claude Code
before retrying. Do not silently downgrade to a weaker model after a model
rejection.

### Worker Routing

Use Cursor through xagent when a competent worker pass is useful. Treat
Composer 2.5 as a solid worker for straightforward implementation, cleanup,
alternate drafts, or exploratory passes.

For the trickiest implementation tasks, prefer a GPT or Codex-backed worker
agent instead of Composer.

### Legacy Terminal Protocol

`xagent run --subagent` remains available for harness compatibility, but the default supervised path above is Conductor service MCP or the quiet
service-client fallback. Do not combine legacy terminal stdin polling with
service MCP for the same run.

When xagent launches the Codex harness through either the supervised MCP path or the legacy terminal path, it passes Codex's explicit `--dangerously-bypass-approvals-and-sandbox` flag so the xagent-spawned Codex child does not stop for command approvals or inherit a restrictive sandbox. Use this only through xagent; do not copy that flag into unrelated workflows.

### Failure Handling

If the packaged launcher, MCP tools, Conductor service, Claude Code, Cursor
Agent, or a requested model cannot be used as instructed, surface broken
agentic infrastructure. Do not silently switch tools, rebuild xagent ad hoc from
a guessed Sheaf checkout, or work around broken agentic infrastructure.

Log inspection is reason-gated like other status checks, not a
polling loop.
