# OpenSpec Superpowers Workflow

Use this skill when an approved OpenSpec change should be implemented through
Superpowers planning and subagent-driven development instead of a direct
`openspec apply` run.

This skill is a coordinator. It does not replace OpenSpec or Superpowers
skills. Invoke the relevant OpenSpec and Superpowers skills for their current
instructions.

## Provider and model rules

These rules govern assignment, model selection, and session retention across
pre-plan coordination and Superpowers SDD task execution:

- If the user specifically tells you to use the OpenSpec Superpowers workflow,
  you are authorized to use xagent for the current change's SDD.
- **Reviews run on the opposite provider via xagent.** Any review — the
  pre-planning spec review, per-task spec/quality reviews, re-reviews, and
  the final whole-branch review — is dispatched through xagent
  (`projects/xagent`) on the provider opposite to the one that produced the
  work under review: Claude-produced work is reviewed by a Codex model, and
  Codex-produced work is reviewed by a Claude model.
- **Pre-plan helpers may use native transport when the model is available.**
  See Pre-plan coordination for native-vs-xagent transport rules. This does not
  apply to written-plan SDD task turns.
- **SDD task turns always use the xagent SDD MCP facade.** Once a written
  Superpowers plan exists, every implementer, task reviewer, fix, re-review, and
  final whole-branch reviewer turn uses `xagent_sdd_start` and
  `xagent_sdd_followup` regardless of native model availability. Native
  subagents, generic `xagent_start_non_sdd`, raw `xagent_message`, quiet
  `xagent supervise`, and terminal polling are prohibited for those turns.
- **Keep each task's implementer and reviewer open until the task finishes.**
  Do not discard an implementer after its first report or a reviewer after
  its first verdict: send small fixes back to the same implementer session
  and re-reviews back to the same reviewer session (native pre-plan helpers are
  resumable; xagent SDD sessions stay open via `agent_id` and
  `xagent_sdd_followup`). Start fresh agents per task, not per fix round.
  Close nothing until the task passes both verdicts.
- **Dispatch the full brief, never a summary.** When dispatching an
  implementer or reviewer, hand it the complete task brief / review brief as
  a file and point at it verbatim. Do not paraphrase, condense, or summarize
  requirements into the dispatch prompt — paraphrased dispatches are the
  leading avoidable cause of underspecified work. Exact values, formats, and
  acceptance criteria live in the brief file; the dispatch prompt adds only
  scene-setting, cross-task interfaces, and the report contract.

## Pre-plan coordination

These rules apply to pre-plan OpenSpec review, plan generation, and other
helpers that run before a written Superpowers SDD plan task exists.
They do not fabricate an SDD plan or task identity solely to enter the SDD
ledger.

- **Prefer native harness subagents when the assigned model is available.**
  Native subagents are not the default transport for cross-provider work, and
  xagent is not the default transport for same-provider work when the harness
  already offers the assigned model.
- **Perform independent controller work first.** After dispatching a subagent,
  do controller-only work until it is exhausted, then enter one long wait.
- **Native subagents use one long native mailbox wait.** Do not repeat the
  harness default short timeout merely to observe unchanged state.
- **Cross-provider pre-plan review uses generic xagent service MCP.** Verify
  Conductor reports xagent healthy at `127.0.0.1:9005`, call `xagent_start_non_sdd`,
  do independent work, then one long `xagent_await` with the returned
  `after_sequence` cursor. Consume the sanitized final assistant report from
  `report.text`. Use `xagent_message` only for unstructured non-SDD follow-up
  messages on generic runs. The quiet `xagent supervise` service-client path is
  a generic transport fallback when plugin MCP discovery is unavailable; it is
  not for Superpowers SDD. Do not poll `write_stdin`, `xagent list`, xagent
  logs, or unchanged status at a short fixed interval.
- **Status inspection is reason-gated.** Direct `list_agents`, log, transcript,
  or MCP inspect checks happen only after attention, a long wait deadline, or
  an explicit user status request — never as a fixed-frequency polling loop.
- **Native child messaging stays sparse.** Dispatch instructs native children to
  message the controller only for required input, an unresolved blocker, or
  final completion. Routine tool progress stays in the child thread or activity
  UI.
- **Multiple agents complete independently.** When one running subagent
  completes or needs attention, handle that event and enter another long event
  wait for the remaining agents without inserting unchanged `list_agents`
  snapshots.
- **Broken infrastructure escalates.** If native subagent transport, xagent MCP,
  the Conductor-managed xagent service, OpenSpec, or Superpowers tooling is
  broken, stop and surface broken agentic infrastructure instead of working
  around it.

## Superpowers SDD task execution

Once a written Superpowers plan exists, every implementer, task reviewer, fix,
re-review, and final whole-branch reviewer turn MUST use the xagent SDD MCP
facade. The facade renders each turn through the trusted
`dispatch-prompt` executable in the service checkout; controllers pass brief,
report, and assignment metadata — never the rendered prompt body.

Required SDD flow per turn:

```text
xagent_sdd_start
→ independent controller work
→ one long xagent_sdd_await
→ consume report.text after report-before-return
→ xagent_sdd_followup for fix or re-review on the same agent_id
→ one long xagent_sdd_await
→ xagent_sdd_close when the session is finished
```

- **Initial task agents use `xagent_sdd_start`.** Pass the complete brief,
  plan path, assignment metadata, and report path for implementer and
  task-reviewer roles. Record the returned `agent_id` and `sequence`.
  The returned `sequence` is the pre-turn supervision cursor; it is not a
  provider JSONL position. Pass it to `xagent_sdd_await` as `after_sequence`.
- **Fix and re-review preserve sessions.** Call `xagent_sdd_followup` with the
  existing implementer `agent_id` for fixes and the existing task-reviewer
  `agent_id` for re-reviews. Do not start a fresh agent merely to send that
  follow-up. The final whole-branch `code-reviewer` is single-turn
  (`xagent_sdd_start` → await → `xagent_sdd_close`) with no follow-up; a new
  whole-branch review round means a new `xagent_sdd_start`.
- **One long SDD await per wait cycle.** After dispatching an SDD agent, do
  independent controller work, then one long `xagent_sdd_await` with the
  latest `sequence`. Do not use native mailbox waits or short status
  loops for SDD turns.
- **Consume persisted reports only.** Read `report.text` from the await
  result after xagent records the sanitized assistant report in the SDD ledger
  (report-before-return). Do not read the mutable Superpowers report file on
  disk or poll for completion.
- **Close sessions deliberately.** Call `xagent_sdd_close` only after the task
  passes both verdicts.
- **Number tasks in every user-facing update.** In your updates, refer to task
  numbers as `Task <N>/<Total>` — for example `Task 3/7` — so the user always
  sees position and remaining work.
- **No SDD fallbacks.** If the xagent SDD MCP facade or Conductor-managed
  xagent service is unavailable, surface broken agentic infrastructure. Do not
  fall back to native subagents, generic `xagent_start_non_sdd`, raw `xagent_message`,
  quiet `xagent supervise`, or terminal polling for Superpowers SDD turns.

While an SDD agent is healthy and the controller has no independent work,
do not poll at a short fixed interval. Inspect supervision state only after
attention, a long await deadline, or an explicit user status request.

## Workflow

1. Select the OpenSpec change.
   - Use the change name supplied by the user.
   - If omitted and only one active change exists, use that change.
   - If ambiguous, ask the user to choose.

2. Inspect OpenSpec state.
   - Run `openspec status --change "<name>" --json`.
   - Run `openspec instructions apply --change "<name>" --json`.
   - If OpenSpec reports blocked or missing artifacts, stop and report the
     missing artifacts.
   - If OpenSpec reports all tasks complete, stop and suggest archive.

3. Read OpenSpec context before planning.
   - Read every file listed in `contextFiles` from the apply instructions.
   - Treat proposal, specs, design, and tasks as the source of truth.
   - Do not invent behavior outside those artifacts.

4. Review the spec with the opposite provider before planning.
   - Dispatch an xagent reviewer on the opposite provider (per the pre-plan
     coordination rules above) to read the change's proposal, specs, design,
     and tasks and report ambiguities, gaps, internal inconsistencies, missing
     acceptance criteria, and unstated assumptions — findings only, no edits.
   - Resolve Critical/Important findings before planning: fix the OpenSpec
     artifacts (or escalate to the user where the finding requires a human
     decision). Minor findings may be carried into planning notes.
   - Keep this reviewer open; it is the natural re-reviewer if the artifacts
     change materially during planning.

5. Decide whether brainstorming is required.
   - Use brainstorming before implementation when artifacts are ambiguous,
     incomplete, mutually inconsistent, missing acceptance criteria, or require
     new architecture or behavior decisions — the spec review's findings are
     direct evidence for this decision.
   - If implementation reveals a design defect, stop and update the OpenSpec
     artifacts before continuing.
   - If the OpenSpec proposal, specs, design, and tasks are already clear and
     approved, skip full brainstorming and proceed to implementation planning.

6. Write the Superpowers plan.
   - Invoke `superpowers:writing-plans`, and let it decide task boundaries and
     decomposition.
   - Save the plan under `docs/superpowers/plans/` unless the user specified
     another path.
   - Preserve OpenSpec requirements explicitly in the plan.
   - Include exact files, tests, commands, expected outputs, implementation
     steps, and commits.
   - Include the plan header requiring `superpowers:subagent-driven-development`
     for task-by-task execution.

7. Execute only when authorized.
   - If the user asked only to convert or plan, stop after writing the plan.
   - If the user explicitly asked to apply, implement, execute, or replace
     `openspec apply`, treat that as authorization to continue after plan
     creation.
   - If the user explicitly pre-authorized plan-and-execute, do not pause for
     the writing-plans execution-choice prompt.

8. Execute with subagent-driven development.
   - Invoke `superpowers:subagent-driven-development`.
   - Dispatch one fresh implementer per plan task through `xagent_sdd_start`.
   - After dispatch, do independent controller work, then one long
     `xagent_sdd_await` — not short polling loops.
   - Run spec compliance review before code quality review for each task
     through `xagent_sdd_start` with the task-reviewer role on the opposite
     provider.
   - Require fix and re-review loops until both reviews pass, reusing the
     task's open implementer via `xagent_sdd_followup` for fixes and its open
     reviewer via `xagent_sdd_followup` for re-reviews.
   - Do not dispatch implementation subagents in parallel when tasks may touch
     overlapping files.

9. Keep OpenSpec progress synchronized.
   - Update an OpenSpec task checkbox only after the corresponding Superpowers
     work is complete, reviewed, and verified.
   - If one OpenSpec task was split across multiple Superpowers tasks, update
     the OpenSpec checkbox only after all split tasks are complete.

## Stop Conditions

Stop and report status if any of these occur:

- OpenSpec artifacts are missing or blocked.
- Requirements are ambiguous enough to require human choice.
- Implementation reveals the OpenSpec design is wrong or incomplete.
- Agentic infrastructure, skill loading, OpenSpec, Superpowers tooling, or
  xagent is broken.
- A command requires user approval.
- A subagent reports `BLOCKED` and the controller cannot resolve it with more
  context, a smaller task, or a more capable model.
- The user interrupts.
- All tasks are complete.

## Expected User Prompts

These should trigger this workflow:

- "Convert this OpenSpec change into a Superpowers plan."
- "Apply this OpenSpec change using Superpowers."
- "Use Superpowers instead of openspec apply."
- "Write the Superpowers plan and execute it with subagents."
- "Plan and apply this OpenSpec proposal without human checkpoints unless
  blocked."
