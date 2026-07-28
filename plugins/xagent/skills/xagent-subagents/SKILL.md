---
name: xagent-subagents
description: Launch cross-provider review and worker subagents through the Conductor-managed xagent service, from any harness and any active repository.
---

# xagent Subagents

Use this skill when you need an external review opinion, a cross-provider
second pass, or a delegated worker through the Conductor-managed xagent
service. It applies to every harness — Claude Code, Codex, Cursor, and Pi.

## Reaching the service

xagent runs as one Conductor-managed service on `127.0.0.1:9005`. Everything
below talks to that service; nothing here starts a supervisor of its own.
Verify Conductor reports it healthy before launching a worker.

There are two client surfaces, and which one you have depends on your harness:

| Surface | Available when | Covers |
|---|---|---|
| HTTP MCP tools (`xagent_*`) | your harness has the `xagent` MCP server attached at `http://127.0.0.1:9005/mcp` | everything, including Superpowers SDD |
| Packaged CLI (`xagent`) | always, once the plugin is installed | generic delegation only — the CLI has no SDD verbs |

Confirm the MCP tools before relying on them: list your available tools and
look for `xagent_start_non_sdd`. The packaged launcher lives at
`$HOME/.agents/plugins/plugins/xagent/scripts/xagent`.

**Pi ships without built-in MCP by design.** On Pi, use the packaged CLI for
generic delegation, and do not attempt Superpowers SDD through this service —
escalate instead.

If the service is unhealthy or unreachable, or the MCP tools are missing on a
harness that should have them, surface broken agentic infrastructure and
inspect Conductor health. Do not launch an embedded, plugin-local, or
unmanaged replacement supervisor, and do not hand-roll your own MCP client.

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
row, and returns `agent_id`, `sequence`, `renderer_path`, and artifact paths. Record the
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
task passes both verdicts — a closed session cannot be followed up, and the
only recovery is a fresh session that has lost the worker's context.

`renderer_path` names the `dispatch-prompt` that rendered the turn. It is
always the service checkout's copy, never the run cwd's: a worktree's own
renderer is worker-writable and is deliberately not trusted. If your branch
changes the renderer or the Superpowers templates, those changes do not affect
dispatch until they land on the service's checkout.

Worker-facing text is worker-facing. `context`, `name`, `description`, and
`findings_text` are rendered straight into the subagent's prompt, and the
service rejects any of them containing an `xrun_...` run id — a dispatched
worker has no xagent access and cannot act on your session bookkeeping.

While a Superpowers SDD agent is healthy and the controller has no independent
work, do not poll at a short fixed interval. Specifically, do not poll
`write_stdin`, `xagent_list`, xagent logs, terminal status, or unchanged MCP
inspect output merely to observe progress. Inspect supervision state only after
attention, a long await deadline, or an explicit user status request.

If the xagent SDD MCP facade, Conductor-managed xagent service, trusted
`dispatch-prompt` renderer, or required Superpowers templates are unavailable,
surface broken agentic infrastructure. Do not fall back to native subagents,
generic `xagent_start`, raw `xagent_message` as a work dispatch, quiet
`xagent supervise`, or terminal polling for Superpowers SDD turns.

## Generic Delegation

Use the sections below for review, worker, and other delegation outside
Superpowers SDD.

### Supervision Flow

The controller flow is:

```text
verify Conductor reports xagent healthy
→ xagent_start_non_sdd(cwd, prompt, harness/model/policy)
→ perform independent boss work
→ one xagent_await(run_id, after_sequence)
→ consume report.text, or handle compact attention
→ xagent_await again with the returned after_sequence only when continuing
```

Record the returned `run_id` and `after_sequence` cursor.

After `xagent_start_non_sdd`, do independent controller work until it is exhausted.
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

`xagent_message` sends unstructured user input to a run. It works on SDD runs
too — that is how you answer a worker that stopped with `NEEDS_CONTEXT`, and
how you chit-chat generally. It is *not* how you dispatch work: a fix or
re-review round must go through `xagent_sdd_followup`, which renders the role
template and reserves the ledger row. A raw message creates no turn and is not
recorded as one.

Anything the templates have no slot for — "the tree has uncommitted work from
a cancelled sibling run", "ignore the stray build output" — goes in the
optional `note` on any `xagent_sdd_start` role or `xagent_sdd_followup` kind.
It is appended verbatim under a `## Controller Note` heading. Do not smuggle
it into a findings list or a constraints file.

### Long Awaits Need a Patient HTTP Client

`deadline_seconds` accepts up to 7000, but a default Node/undici HTTP client
gives up after 300 seconds with `UND_ERR_HEADERS_TIMEOUT`, and the await dies
client-side even though the run is healthy. The packaged CLI already chunks
around this. If your client does not and a long await dies, the run is still
alive: recover it with `xagent_list` and await again. Do not restart the
worker.

### Recovering a Lost Run

`xagent_list` returns service-owned runs newest first. Use it when a start
response was lost, a client died mid-await, or you need to find an orphaned
run to close. SDD-owned rows carry an `sdd` block naming their role, plan,
task, cwd, and agent, so a row identifies itself. This is a recovery tool,
not a progress-polling tool.

### Reading a Failure

A failed run returns a `reason` and a payload that explains itself:
`provider_error` carries the provider's own message (a usage limit, a rejected
model, an API error), and `process_exit` carries the exit code plus whatever
the child wrote to stderr. Act on that text; do not guess at causes or probe
the provider by hand. The full provider transcript for any supervised run is
on disk at `<log root>/<run_id>/raw-provider.jsonl` — read it when diagnosing
a failure, never to watch a healthy run.

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

`xagent run --subagent` remains available for harness compatibility, but the
default supervised path above is Conductor service MCP or the quiet
service-client fallback. Do not combine legacy terminal stdin polling with
service MCP for the same run. Legacy runs do not reliably exit on
`control.exit` and have leaked for days; prefer the supervised path, where the
service owns session close.

When xagent launches the Codex harness through either the supervised MCP path or the legacy terminal path, it passes Codex's explicit `--dangerously-bypass-approvals-and-sandbox` flag so the xagent-spawned Codex child does not stop for command approvals or inherit a restrictive sandbox. Use this only through xagent; do not copy that flag into unrelated workflows.

### Failure Handling

If the packaged launcher, MCP tools, Conductor service, Claude Code, Cursor
Agent, or a requested model cannot be used as instructed, surface broken
agentic infrastructure. Do not silently switch tools, rebuild xagent ad hoc from
a guessed Sheaf checkout, or work around broken agentic infrastructure.

Log inspection is reason-gated like other status checks, not a
polling loop.
