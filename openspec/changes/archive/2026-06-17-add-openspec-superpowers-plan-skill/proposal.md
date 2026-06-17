## Why

OpenSpec and Superpowers are both installed, but the workflow for turning an
approved OpenSpec change into a Superpowers subagent-driven implementation run
is currently conversational knowledge rather than reusable agent guidance. A
global skill should make that workflow consistent across projects and harnesses.

## What Changes

- Add a new global shared skill under `projects/agents/global/skills/` that
  guides agents through converting an OpenSpec change into a Superpowers plan
  and executing it with subagent-driven development.
- The skill will treat OpenSpec artifacts as the source of truth, use
  brainstorming only when the artifacts are ambiguous or require new design
  decisions, and otherwise proceed without human checkpoints until blocked or
  complete.
- The skill will instruct agents to keep OpenSpec task checkboxes in sync with
  completed Superpowers implementation work.

## Capabilities

### New Capabilities

### Modified Capabilities

- `agents-skill-distribution`: adds a required global skill source for the
  OpenSpec-to-Superpowers implementation workflow.

## Impact

- Affects `projects/agents/global/skills/` by adding a new global skill source.
- Affects installed global and repo-local skill outputs through the existing
  agents installer.
- No runtime product APIs, services, or external dependencies change.
