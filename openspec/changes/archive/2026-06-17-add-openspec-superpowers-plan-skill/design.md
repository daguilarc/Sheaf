## Context

`projects/agents` already distributes shared global skills from
`projects/agents/global/skills/<skill-id>/` into repo-local and user-global
harness skill directories. The new workflow should live as another global skill
source because it is not Sheaf-specific: it coordinates OpenSpec artifacts,
Superpowers planning, and subagent-driven execution across any project that has
both systems installed.

The desired behavior is a workflow skill, not a new CLI or installer feature.
The existing agents installer can already distribute a new global skill once the
source `skill.yaml` and `SKILL.md` exist.

## Goals / Non-Goals

**Goals:**

- Add a global skill source that tells agents how to treat an approved OpenSpec
  change as the source of truth for a Superpowers implementation run.
- Make the workflow explicit: inspect OpenSpec status/instructions, read context
  files, decide whether brainstorming is required, write a Superpowers plan, and
  execute with subagent-driven development when requested.
- Avoid unnecessary human checkpoints when the OpenSpec artifacts are already
  clear and approved; stop only for ambiguity, blockers, infrastructure
  failures, approval-required commands, or completion.

**Non-Goals:**

- Do not change OpenSpec CLI behavior.
- Do not change Superpowers skills.
- Do not add a script or automation wrapper around `openspec`.
- Do not make this skill Sheaf-only.

## Decisions

### Add a global skill rather than a project-local skill

The workflow composes general-purpose agent systems and does not depend on
Sheaf product code. Adding it under `projects/agents/global/skills/` ensures the
installer can distribute it to Claude Code, Cursor, Pi, and Codex user-global
locations alongside the other shared skills.

Alternative considered: add a Sheaf-only skill under `projects/agents/sheaf/`.
That would avoid global distribution, but it would incorrectly scope a workflow
that should apply wherever OpenSpec and Superpowers coexist.

### Keep the skill as procedural guidance only

The skill should define the decision tree and handoff boundaries. It should not
copy large chunks of OpenSpec or Superpowers skill documentation. Agents must
invoke the relevant underlying skills for current instructions.

Alternative considered: include a full standalone implementation workflow in
the new skill. That would be easier to read in isolation but would drift from
the source Superpowers and OpenSpec skills.

### Use `openspec-superpowers-workflow` as the skill id

The id names the integration boundary without implying that the skill replaces
OpenSpec entirely. Its description should include concrete trigger phrases such
as converting OpenSpec tasks into a Superpowers plan, using Superpowers as the
implementation engine for an OpenSpec change, and replacing `openspec apply`
with subagent-driven execution.

Alternative considered: `openspec-to-superpowers-plan`. That is accurate for
plan creation, but it under-describes the immediate execution workflow the user
wants.

## Risks / Trade-offs

- Skill drift from underlying OpenSpec or Superpowers behavior -> Mitigate by
  making the new skill invoke those skills instead of duplicating their detailed
  instructions.
- Accidental human gates after plan creation -> Mitigate by explicitly allowing
  user pre-authorization to write and execute the plan in one run.
- Agents may skip brainstorming too aggressively -> Mitigate by defining the
  concrete conditions that require brainstorming: ambiguous artifacts, missing
  acceptance criteria, unresolved architecture choices, or implementation
  revealing design defects.
