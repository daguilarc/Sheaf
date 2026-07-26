# OpenSpec Superpowers Workflow

Use this skill when an approved OpenSpec change should be implemented through
Superpowers planning and subagent-driven development instead of a direct
`openspec apply` run.

This skill is a coordinator. It does not replace OpenSpec or Superpowers
skills. Invoke the relevant OpenSpec and Superpowers skills for their current
instructions.

## Provider and model rules

These rules apply to every subagent dispatched anywhere in this workflow:

- If the user specifically tells you to use the OpenSpec Superpowers workflow,
  you are authorized to use xagent for the current change's SDD.
- **Reviews run on the opposite provider via xagent.** Any review — the
  pre-planning spec review, per-task spec/quality reviews, re-reviews, and
  the final whole-branch review — is dispatched through xagent
  (`projects/xagent`) on the provider opposite to the one that produced the
  work under review: Claude-produced work is reviewed by a Codex model, and
  Codex-produced work is reviewed by a Claude model.
- **All other subagents (planning, decomposition, implementation, fixes) run
  on the same provider as their assigned model.** Use the harness's native
  subagent mechanism when it offers the assigned model; when the assigned
  model is not available natively (e.g. a Codex implementer arm assigned
  while running in a Claude harness, or vice versa), dispatch that subagent
  through xagent on its own provider instead. The assignment decides the
  model; availability only decides the transport.
- **Keep each task's implementer and reviewer open until the task finishes.**
  Do not discard an implementer after its first report or a reviewer after
  its first verdict: send small fixes back to the same implementer session
  and re-reviews back to the same reviewer session (native subagents are
  resumable; xagent sessions stay open via their persistent stdin). Start
  fresh agents per task, not per fix round. Close nothing until the task
  passes both verdicts.
- **Dispatch the full brief, never a summary.** When dispatching an
  implementer or reviewer, hand it the complete task brief / review brief as
  a file and point at it verbatim. Do not paraphrase, condense, or summarize
  requirements into the dispatch prompt — paraphrased dispatches are the
  leading avoidable cause of underspecified work. Exact values, formats, and
  acceptance criteria live in the brief file; the dispatch prompt adds only
  scene-setting, cross-task interfaces, and the report contract.

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
   - Dispatch an xagent reviewer on the opposite provider (per the provider
     rules above) to read the change's proposal, specs, design, and tasks
     and report ambiguities, gaps, internal inconsistencies, missing
     acceptance criteria, and unstated assumptions — findings only, no
     edits.
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

6. Decompose with the task-analyzer decomposition subagent.
   - Dispatch the decomposition subagent
     (`projects/agents/task-analyzer/prompts/decomposer.md`) with the
     change's artifacts and the main-branch estimator database path
     (`data/agents/task-analyzer.sqlite` on `main` — never a worktree copy).
   - It proposes and complexity-scores candidate decompositions, runs
     `estimate.py` on each (default Thompson sampling), and selects the
     candidate with the lowest `thompson_total_usd`, emitting the
     `.assignments.yaml` sibling (per-task model, effort, complexity,
     predicted cost) plus its candidate comparison.
   - The Superpowers plan's task boundaries follow the selected candidate;
     per-task implementer models and efforts come from `.assignments.yaml`.
   - Validate the annotation file with
     `projects/agents/task-analyzer/annotations.py` before using it.
   - If the estimator database is unavailable or has no trained estimator,
     say so, fall back to judgment-based decomposition and model selection,
     and proceed without annotations rather than blocking.

7. Write the Superpowers plan.
   - Invoke `superpowers:writing-plans`.
   - Save the plan under `docs/superpowers/plans/` unless the user specified
     another path.
   - Preserve OpenSpec requirements explicitly in the plan.
   - Task boundaries follow the selected decomposition from step 6.
   - Include exact files, tests, commands, expected outputs, implementation
     steps, and commits.
   - Include the plan header requiring `superpowers:subagent-driven-development`
     for task-by-task execution.

8. Execute only when authorized.
   - If the user asked only to convert or plan, stop after writing the plan.
   - If the user explicitly asked to apply, implement, execute, or replace
     `openspec apply`, treat that as authorization to continue after plan
     creation.
   - If the user explicitly pre-authorized plan-and-execute, do not pause for
     the writing-plans execution-choice prompt.

9. Execute with subagent-driven development.
   - Invoke `superpowers:subagent-driven-development`.
   - Dispatch one fresh implementer subagent per plan task, on the model and
     effort assigned in `.assignments.yaml` (provider rules above govern
     native-vs-xagent transport).
   - Run spec compliance review before code quality review for each task,
     on the opposite provider via xagent.
   - Require fix and re-review loops until both reviews pass, reusing the
     task's open implementer for fixes and its open reviewer for re-reviews.
   - Do not dispatch implementation subagents in parallel when tasks may touch
     overlapping files.

10. Keep OpenSpec progress synchronized.
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
