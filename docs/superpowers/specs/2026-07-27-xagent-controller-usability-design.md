# xagent Controller Usability — Findings and Dispositions

**Source incident:** Cursor cloud agent `bc-019fa46c-680f-7b47-b2fa-8fa1738006b5`
("Openspec superpowers agent vendor"), 2026-07-27, running as the SDD controller
for the `vendor-openspec-and-superpowers` change in
`~/.cursor/worktrees/Sheaf/ebfn` (branch `cursor/vendor-openspec-superpowers-06b5`).

**Goal of this document:** make xagent idiot-proof — specifically *grok-proof*.
A controller running on any harness, with no prior xagent knowledge, must be able
to drive a full SDD cycle without hand-rolling infrastructure, without guessing
at failure causes, and without losing work.

## Evidence sources

| Source | Path |
|---|---|
| SDD ledger | `data/xagent/sdd.sqlite` (12 sessions, 15 turns) |
| Run logs | `data/xagent/xrun_2026072717*` … `xrun_2026072720*` (15 supervised runs) |
| Controller's saved xagent responses | `~/.cursor/worktrees/Sheaf/ebfn/.superpowers/sdd/2026-07-27-vendor-openspec-and-superpowers/*.json` |
| Controller's hand-rolled MCP client | same dir, `sdd-mcp.mjs`, `package.json`, `node_modules/` |
| Worker transcripts | `~/.cursor/projects/Users-joyo-cursor-worktrees-Sheaf-ebfn/agent-transcripts/*/` |
| Controller terminal captures | same project, `terminals/{259946,756622,808170}.txt` |
| Controller conversation (partial cache) | Cursor IndexedDB `vscode-file_vscode-app_0.indexeddb.leveldb/000003.log` |
| Service logs | `logs/xagent/xagent_std{out,err}.log` |

## Timeline of the damage

| Time (UTC) | Event |
|---|---|
| 17:21–18:23 | Tasks 1–3 driven through **generic** `xagent_start` (absent from the SDD ledger) — the facade was not discovered yet |
| 18:24:33 | Task 4 implementer `23db37f8` starts; start response lands as a **0-byte file** |
| 18:27:06 | `23db37f8` cancelled (agent_id lost); replacement `c0ff2865` started |
| 18:35:38 | `c0ff2865` closed after its first report |
| 18:36:33 | Reviewer `97b81d67` runs 4 minutes, dies `exit_code:1`, **no reason given** |
| 18:41:17 | Reviewer retry `8c170f9f` dies in 2s, same opaque failure |
| 18:41:36 | Third attempt `838b7649` dies in 2s |
| 18:41:50 | Controller gives up on xagent, computes the noon-PT Claude reset, `sleep(1149)`, probes with `claude -p "Reply with exactly: PONG"` |
| 19:01:04 | PONG — root cause was a **Claude usage limit** |
| 19:28:47 | Reviewer `b30af348` finally succeeds |
| ~19:32 | Fix round blocked: `{"error":"sdd_session_closed"}` on `c0ff2865` |
| 19:33:28 | Fake fresh implementer `dd0c7f6d` started for the fix round |
| 19:39:04 | `dd0c7f6d` cancelled mid-edit, leaving uncommitted work in the tree |
| 19:40:50 | `d0a311c5` started; had to forensically reconstruct its dead sibling's work |

Net cost: ~1 hour of wall clock, one discarded 4-minute review, two discarded
implementer runs, one orphaned session, and a hand-written MCP client.

---

## Findings, dispositions, and design decisions

Disposition legend: **FIX NOW** (Tier 1, straight-up bug) · **FIX (Tier 2)**
(required, larger surface) · **DISCUSS** (needs a decision) · **NO ACTION**.

### A. Structural — xagent unreachable from the driving harness

#### A1 — No xagent MCP registered for Cursor (or Pi, or Claude Code)
**Disposition: LANDED for every harness that supports MCP.**

`install_global.register_harness_mcp` upserts `mcpServers.xagent`
(`{"type":"http","url":"http://127.0.0.1:9005/mcp"}`) into `~/.claude.json`
and `~/.cursor/mcp.json`; Codex keeps getting it from the plugin's
`.mcp.json`. Only the `xagent` key is written, so unrelated servers survive.

**Pi is excluded on purpose.** Pi ships without built-in MCP by design (its
own `docs/usage.md`: "It intentionally does not include built-in MCP,
sub-agents, permission popups…"). There is no registry to write. A Pi
controller therefore has the packaged CLI and the skill, and cannot drive
Superpowers SDD, because the SDD facade is MCP-only. That is a harness
constraint, recorded rather than papered over, and it makes A3 sharper: the
one harness that *needs* a CLI SDD path is the one that can never have MCP.

Verified live: after installing, `cursor-agent` lists all ten `xagent_*`
tools and `claude --print` lists all ten `mcp__xagent__xagent_*` tools.

The controller's own words, recovered from the conversation cache:

> those tools exist on `main` / the live Sheaf checkout, and `sdd.sqlite` is
> present — but this agent still has no xagent MCP attached, so it can't call them.

There is no `~/.cursor/mcp.json` and no repo `.cursor/mcp.json`. The
`…-ebfn/mcps/` directory contains only `cursor-app-control`. xagent's MCP server
is wired exclusively through the Codex plugin marketplace
(`~/.agents/plugins/marketplace.json`).

**Design:** `install_global.py` in `plugins/xagent` must register the xagent MCP
endpoint (`http://127.0.0.1:9005/mcp`) for every harness it already installs a
launcher for — Codex, Cursor, Claude Code, Pi — using each harness's native MCP
registry, with the same managed-marker/idempotency discipline the installer
already uses for skills.

#### A2 — The only instruction manual is Codex-only and was not installed for Cursor
**Disposition: LANDED for all four harnesses.**

SKILL.md is now harness-neutral: no `codex` in the normative text, a surface
table saying which client each harness gets, and the Pi/no-MCP constraint
stated up front. `install_global.install_harness_skill` writes it to
`~/.claude/skills`, `~/.cursor/skills`, and `~/.pi/skills` (Codex has it inside
the plugin package) behind a `sheaf-xagent-managed` marker, refusing to
overwrite an unmanaged file.

Ownership had to be settled to make this safe: `install.py` listed
`xagent-subagents` in `OBSOLETE_GLOBAL_SKILL_IDS`, so `make
agents-install-global` would have deleted the copies this installer writes. It
now recognises the plugin marker, reports those files as `plugin-owned`, and
still prunes genuinely stale agents-managed copies.

The skill also absorbed what the incident taught: the undici 300s await
ceiling, `xagent_list` for recovery, how to read a failure payload, where the
provider transcript lives, `renderer_path` semantics, and why a closed SDD
session is expensive.

`plugins/xagent/skills/xagent-subagents/SKILL.md:8` opens "Use this skill when
**Codex** needs an external review opinion…" and gates invocation on
`codex plugin list`. The skill is absent from `.cursor/skills/` and
`~/.cursor/skills/`. The controller had no manual at all and reverse-engineered
xagent from `xagent --help` and the repo source.

**Design:** rewrite SKILL.md harness-neutrally (no `codex` in normative text;
replace the `codex plugin list` gate with a harness-agnostic "confirm the xagent
MCP tools are present, else surface broken infrastructure"), and install it to
every harness alongside the launcher.

#### A3 — SDD facade is MCP-only; the documented fallback cannot do SDD
**Disposition: AGENT STOPS — DISCUSS LATER.**

CLI verbs are `run | supervise | await | inspect | message | interrupt | close |
list | logs`. There is no `sdd` verb. Meanwhile `SKILL.md:79-83` forbids falling
back to `xagent supervise` or generic `xagent_start` for SDD turns. A controller
without MCP is in a documented dead end. Options to weigh later: add `xagent sdd
*` CLI verbs, or make A1 a hard prerequisite and fail loudly.

#### A4 — Consequence: the controller hand-built an MCP client
**Disposition: resolved by A1/A3 — no separate task.**

It wrote `sdd-mcp.mjs` (a Streamable-HTTP MCP client hardcoding
`127.0.0.1:9005/mcp`), added a `package.json`, and `npm install`ed `undici`
**inside the SDD plan artifact directory**, polluting it with `node_modules/`.
The workaround then failed at the worst moment — `task-4-implementer-close.json`
contains `ERR_MODULE_NOT_FOUND: Cannot find package 'undici'` where a close
confirmation should be, orphaning a live session.

#### A5 — Tasks 1–3 never used the facade
**Disposition: DISCUSS LATER (idiot-proofing).**

`sdd.sqlite` starts at Task 4. Runs 17:21–18:23Z exist in `data/xagent/` but not
in the ledger; the controller hand-assembled prompts and passed pointers
("Read and follow the complete implementation prompt at …") — exactly what the
facade exists to prevent. Discoverability problem: nothing tells a controller the
facade exists until it reads the source.

### B. Failures with zero diagnosis

#### B1 — `process_exit` discards the stderr message
**Disposition: FIX NOW.**

`adapters/process_jsonl.ts:221` builds a real failure message from captured
stderr, but `MechanicalHealthEvent`'s `process.exited` variant
(`supervision/health.ts:7`) carries only `exitCode`/`signal`, and
`supervision/supervisor.ts:885-891` therefore drops `event.message`.
`transport.lost`, three lines above, *does* forward its message — this is an
omission, not a policy.

What the controller received, three times:

```json
{"phase":"failed","reason":"process_exit","payload":{"exit_code":1,"signal":null}}
```

**Design:** add `message?: string` to the `process.exited` mechanical event,
forward `event.message` from the supervisor, and include it in the failure
payload as `message`. The payload is already run through `sanitizeValue`, so
paths stay redacted.

#### B2 — `raw-provider.jsonl` is always 0 bytes on the supervised path
**Disposition: FIX NOW.**

`createRunRecord` creates the file (`logs.ts:89`) and advertises it as
`paths.raw_provider`, but `appendRawProviderEvent` is called only from
`runtime.ts` (the legacy `xagent run` CLI). `service/run_manager.ts` never calls
it. Every supervised run — all 15 in this incident — has an empty file. When the
reviewer died after 4 minutes of work there was nothing whatsoever to inspect.

**Design:** add a `providerTranscriptSink` option to `Supervisor`, invoked from
the adapter-event loop (`supervisor.ts:281`) whenever `event.rawProvider` is
present, and wire it in `run_manager.ts` to `appendRawProviderEvent` with
`sanitizeValue`. Matches what the legacy path already does and what the file
name promises. This is disk-only; it does not change what enters leader context.

#### B3 — `exit_status` is `"running"` for every supervised run
**Disposition: FIX NOW.** (Answer to "what is that?": `metadata.json` carries a
legacy `exit_status` field maintained only by the old `xagent run` CLI path —
`updateRunExitStatus` is called exclusively from `runtime.ts`. The supervised
service never touches it, so all 15 runs report `"running"` while
`supervision.phase` in the same file says `completed`, `failed`, or `cancelled`.
Any consumer trusting `exit_status` — dashboards, `xagent list`, a human reading
the file — is misled 100% of the time on the supervised path.)

**Design:** in `run_manager`'s `metadataSink`, derive and persist a terminal
`exit_status` from the supervision phase: `completed` → `completed`;
`failed`/`cancelled`/`abandoned` → `failed`; otherwise leave `running`.

### C. Session-lifecycle traps

#### C1 — Closing a session is an irreversible dead end
**Disposition: DISCUSS — clear and easy restart path required.**

`task-4-fix-followup.json`:

```json
{"error":"sdd_session_closed","message":"SDD session is closed: xrun_20260727182714120_c0ff2865"}
```

`sdd_manager.ts:446-453` rejects any follow-up on a closed session with no
recovery path. The controller had to start a fresh session impersonating a fix
round, losing the implementer's entire context. Design options to weigh:
resume-from-ledger (`--resume` the provider thread recorded in run metadata),
versus refusing `xagent_sdd_close` while an unresolved review exists.

#### C2 — Should be able to start a fixer directly
**Disposition: DISCUSS.** Needs a first-class "fix round on a new session"
entry point that carries the prior turn's brief/report/findings identity, instead
of the current `--name "Task 4 Fix Round 1"` impersonation that produced
`You are implementing Task 4: Task 4 Fix Round 1`.

#### C3 — Cancel leaves the worktree dirty; the successor inherits it blind
**Disposition: DEFER.**

`23db37f8` (2m33s) and `dd0c7f6d` (5m36s) were both cancelled mid-flight; the
second had already written failing tests *and* production edits. Its successor's
report: *"Uncommitted Fix Round 1 work is already present. I'll compare git state
and tests against the four Important findings."*

#### C4 — Ledger rot: closing a session leaves its turns `running` forever
**Disposition: FIX NOW.** (Answer to "how to fix properly?": the mechanism
already exists and is simply not wired to close. `sdd_store.ts:435` prepares
`abandonOpenTurns`, but the only caller is `ReconcileTerminalRuns`
(`sdd_store.ts:637`), which runs at service startup and only for phases in
`{failed, cancelled, abandoned}` — never for `completed`, and never on close.
`MarkClosed` (`sdd_store.ts:582`) updates the session row alone.)

**Design:** make `MarkClosed` run `markClosed` and `abandonOpenTurns` inside one
`database.transaction`. 6 of the 15 rows in this incident are still
`status='running'` with `completed_at IS NULL` under a closed session; add a
one-shot repair at store open that abandons open turns belonging to already
closed sessions.

#### C5 — No way to enumerate runs over MCP
**Disposition: FIX NOW.**

There is no `xagent_list` MCP tool. `task-4-implementer-start.json` landed
**0 bytes** — the start response was lost and with it a live `agent_id`. The CLI
has `list`, but `SKILL.md:75` bans polling it, and the Cursor controller had no
CLI-to-MCP bridge anyway. The orphan was eventually killed by hand
(`task-4-implementer-close-orphan.json`).

**Design:** add an `xagent_list` MCP tool backed by the existing
`listRuns(logRoot)` (`logs.ts:236`), returning compact rows (run_id, harness,
model, phase, sequence, created_at, updated_at, supervised) with live runs
flagged, plus SDD role/task/plan joined from the ledger when the run is
SDD-owned. Recovery — not polling — is the documented use.

#### C6 — Follow-up artifact paths live in RAM despite being in SQLite
**Disposition: HARDENING LANDED — the restart case it appeared to fix is C1.**

**Correction after implementation** (found independently and confirmed by the
Opus review): `Followup` checks `runManager.has(agent_id)` *before* it looks at
the artifact cache (`sdd_manager.ts:474-481`), and `XagentRunManager` has no
rehydration — `#runs` is populated only by `create()`. After a service restart
`has()` is false, so a follow-up fails `sdd_session_terminal` with or without
this change; the provider child did not survive either. The premise below
("any service restart converts every live session into
`sdd_followup_missing_paths`") was wrong. What landed removes a redundant
second source of truth and is correct-by-construction, but restart recovery is
the C1 discussion item, not this one.

`artifactsByAgent` is an in-memory `Map` (`sdd_manager.ts:252`) even though
`brief_path`, `brief_text`, and `report_path` are already durable columns in
`sdd_turns`. Any service restart converts every live session into
`sdd_followup_missing_paths`. This is live, not theoretical: `logs/xagent/
xagent_stderr.log` shows the service crashing at startup with
`SqliteError: database is locked (SQLITE_BUSY)` and taking the make target down
with it.

**Design:** add `GetLatestTurn(agentId)` to `SddStore` and have `Followup`
recover artifacts from the ledger, using the in-memory map only as a cache.

### D. Rendered prompts that confuse the worker

#### D1 — "Ask them now" ×3 in a one-shot headless dispatch
**Disposition: DISCUSS — need a way to ask parents.**

The rendered implementer prompt says *"**Ask them now.** Raise any concerns
before starting work"*, *"If you encounter something unexpected or unclear,
**ask questions**"*, and *"It's always OK to pause and clarify."* There is no
channel. Every worker burned tokens reasoning around it — *"I'm the Task 4
implementer (subagent)"*, *"I'm a dispatched implementer subagent, so I'll follow
the brief directly."* The template is Superpowers' interactive
`implementer-prompt.md` rendered verbatim into a non-interactive context.
Open question: a real question channel (worker → controller attention event →
controller answers via followup) versus stripping the language.

#### D2 — Controller-layer session IDs leak into the worker prompt
**Disposition: FIX NOW.**

`"Keep the reviewer session xrun_20260727192847117_b30af348 open for re-review"`
was delivered to a grok worker with no xagent access. It cannot keep anything
open; it reads like an instruction it must obey and cannot.

**Design:** `xagent_sdd_start` rejects a `context` (and `xagent_sdd_followup` a
`findings_text`) containing a generated run id (`/xrun_\d{17}_[0-9a-f]{8}/`) with
a structured `sdd_context_leaks_run_id` error naming the offending id. Controller
bookkeeping does not belong in a worker prompt.

#### D3 — Templates resolve from a hardcoded foreign marketplace path
**Disposition: NO ACTION — that run was what fixed it; likely transient.**

`projects/agents/utils/dispatch-prompt:28` pins
`~/.claude/plugins/cache/claude-plugins-official/superpowers`, while the branch
under implementation installs to `cache/sheaf-managed/superpowers/6.2.0`.
Recorded here so it is not rediscovered as a surprise.

#### D4 — Renderer resolved from the service's repo root, not the run cwd
**Disposition: PARTIALLY FIXED — the rest is a trust-boundary decision, DISCUSS.**

**Correction after implementation:** preferring the run cwd's renderer is a
security regression, not a fix. `tests/sdd_prompt.test.ts` plants a
`#!/bin/sh echo MALICIOUS` script at
`<cwd>/projects/agents/utils/dispatch-prompt` and asserts it is never
executed — the run cwd is a worker-writable worktree, so a renderer found
there is attacker-controlled code. What shipped is the diagnostic half only:
`RenderSddPrompt` now returns `metadata.rendererPath`, `xagent_sdd_start`
returns `renderer_path`, and `sdd_renderer_missing` reports the searched
path. Closing the worktree/service mismatch requires deciding how a worktree
renderer could ever be trusted (signature? allowlist? render-in-service-from-
worktree-templates?) — that is a design question, not a bug.

`sdd_prompt.ts:119-123` builds the renderer path from `repoRoot`, and
`sdd_manager.ts:347` passes `deps.repoRoot` (the service's checkout). Working in
a worktree you silently get `main`'s renderer and `main`'s templates. The
controller hit this directly:

```
ls: /Users/joyo/.cursor/worktrees/Sheaf/ebfn/projects/agents/utils/dispatch-prompt: No such file or directory
/Users/joyo/Sheaf/projects/agents/utils/dispatch-prompt
```

**Design:** prefer `<cwd>/projects/agents/utils/dispatch-prompt` when it exists,
fall back to the service repo root, and report which one was used in the
`xagent_sdd_start` result as `renderer_path` so the choice is never silent.

### E. Output contract violated for the cursor harness

#### E1 — `report.text` is every narration segment concatenated
**Disposition: FIX NOW.**

`SKILL.md:57-62` promises "the sanitized final assistant report" and forbids
reading the transcript. What cursor runs actually returned
(`task-4-fix-implementer-await.json`):

> …so I can apply Fix Round 1 correctly.**I**'m the fix-round implementer, so
> I'll skip the general skill bootstrap and pull the review findings…

No separators, words fused across segment boundaries. `adapters/cursor.ts:76`
takes `raw.result`, which `cursor-agent` fills with the whole assistant stream.
`claude_code` returns a clean final message; cursor does not.

**Design:** the cursor adapter already detects the end-of-turn flush
(`cursor.ts:119`, `isFinalFlush`). Record that flushed segment as
`state.cursorFinalSegmentText` and prefer it for both `message.completed.text`
and `turn.completed.final_text`, falling back to `raw.result` when no final flush
was observed.

### F. Packaging and hygiene

#### F1 — Shipped launcher hardcodes one user's absolute path
**Disposition: FIX NOW.**

`plugins/xagent/scripts/xagent:7`:

```bash
MAIN_SHEAF_LOG_ROOT="/Users/joyo/Sheaf/data/xagent"
```

**Design:** resolve the Sheaf root by walking up for `config/services.json` +
`structure/` (the same rule `findSheafRoot` uses in
`service/config.ts:36-49`), starting from `$PWD`; fall back to
`$SHEAF_ROOT/data/xagent`, then to `$HOME/.xagent/data`. Fail with an actionable
message rather than silently writing to a stranger's path.

#### F2 — Leaked legacy `xagent run` processes
**Disposition: KILL THEM.**

30 `xagent run --subagent` processes alive at audit time, the oldest running
5 days 22 hours. Legacy CLI path; matches the known-unreliable `control.exit`.
Operational cleanup, not a code change in this plan.

**Reaped 2026-07-27:** 23 still-live processes killed (the other 7 had exited
between the audit and the cleanup); `main.js run --harness` count is now 0.
The underlying `control.exit` unreliability is unchanged — this was a cleanup,
not a fix.

---

## Tier assignment

| Tier | Findings |
|---|---|
| **Tier 1 — landed** | B1 (+B1b, Claude reports errors on stdout), B2, B3, C4, C5, D2, E1, F1, F2; C6 as hardening only; D4 diagnostic half only |
| **Tier 2 — landed** | A1 (Claude, Cursor, Codex; Pi has no MCP by design), A2 (all four) |
| **Discuss** | A3, A5, C1, C2, C3, D1, D4 (renderer trust boundary) |
| **No action** | D3 |

Implementation plan: `docs/superpowers/plans/2026-07-27-xagent-controller-usability.md`
