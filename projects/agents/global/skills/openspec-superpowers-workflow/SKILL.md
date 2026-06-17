# OpenSpec Superpowers Workflow

Use this skill when an approved OpenSpec change should be implemented through
Superpowers planning and subagent-driven development instead of a direct
`openspec apply` run.

This skill is a coordinator. It does not replace OpenSpec or Superpowers
skills. Invoke the relevant OpenSpec and Superpowers skills for their current
instructions.

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

4. Decide whether brainstorming is required.
   - Use brainstorming before implementation when artifacts are ambiguous,
     incomplete, mutually inconsistent, missing acceptance criteria, or require
     new architecture or behavior decisions.
   - If implementation reveals a design defect, stop and update the OpenSpec
     artifacts before continuing.
   - If the OpenSpec proposal, specs, design, and tasks are already clear and
     approved, skip full brainstorming and proceed to implementation planning.

5. Write the Superpowers plan.
   - Invoke `superpowers:writing-plans`.
   - Save the plan under `docs/superpowers/plans/` unless the user specified
     another path.
   - Preserve OpenSpec requirements explicitly in the plan.
   - Split broad OpenSpec tasks into subagent-sized tasks.
   - Include exact files, tests, commands, expected outputs, implementation
     steps, and commits.
   - Include the plan header requiring `superpowers:subagent-driven-development`
     for task-by-task execution.

6. Execute only when authorized.
   - If the user asked only to convert or plan, stop after writing the plan.
   - If the user explicitly asked to apply, implement, execute, or replace
     `openspec apply`, treat that as authorization to continue after plan
     creation.
   - If the user explicitly pre-authorized plan-and-execute, do not pause for
     the writing-plans execution-choice prompt.

7. Execute with subagent-driven development.
   - Invoke `superpowers:subagent-driven-development`.
   - Dispatch one fresh implementer subagent per plan task.
   - Run spec compliance review before code quality review for each task.
   - Require fix and re-review loops until both reviews pass.
   - Do not dispatch implementation subagents in parallel when tasks may touch
     overlapping files.

8. Keep OpenSpec progress synchronized.
   - Update an OpenSpec task checkbox only after the corresponding Superpowers
     work is complete, reviewed, and verified.
   - If one OpenSpec task was split across multiple Superpowers tasks, update
     the OpenSpec checkbox only after all split tasks are complete.

## Stop Conditions

Stop and report status if any of these occur:

- OpenSpec artifacts are missing or blocked.
- Requirements are ambiguous enough to require human choice.
- Implementation reveals the OpenSpec design is wrong or incomplete.
- Agentic infrastructure, skill loading, OpenSpec, or Superpowers tooling is
  broken.
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
