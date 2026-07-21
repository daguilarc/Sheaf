# task-analyzer-decomposition-agent

## ADDED Requirements

### Requirement: Decomposition subagent prompt asset and search protocol
The system SHALL provide a decomposition subagent prompt
(`projects/agents/task-analyzer/prompts/decomposer.md`) that, given an
OpenSpec change's proposal/design/specs and a database path, instructs the
agent to: generate 3–5 candidate decompositions varying granularity and
grouping axis; score each task's C1–C7 against the pinned complexity rubric;
run `estimate.py` on every candidate; and select the candidate minimizing
total cost at the configured quantile subject to guardrails (no task above
composite 3.5 — split instead; prefer briefs at prescriptiveness C7 ≤ 2;
dependency order respected).

#### Scenario: Candidate search produces a comparison
- **WHEN** the decomposition subagent runs on an OpenSpec change
- **THEN** it produces at least 3 scored candidate decompositions, a comparison table of their estimator totals, the selected candidate, and a rationale referencing the guardrails

#### Scenario: Oversized task is split
- **WHEN** every generated candidate contains a task with composite complexity above 3.5
- **THEN** the agent generates a further candidate splitting that task before selecting

### Requirement: Output is the annotation file, workflow untouched
The subagent's deliverable SHALL be the sibling annotation YAML (per
task-analyzer-sdd-annotations) plus its candidate comparison, written into the
change's planning artifacts; it SHALL read estimator weights only from the
designated main-branch database path supplied by the caller (never a worktree
copy), and it SHALL NOT modify openspec-superpowers-workflow or dispatch any
implementation work.

#### Scenario: Main-branch weights only
- **WHEN** the subagent runs inside a planning worktree that contains its own copy of the database
- **THEN** estimates are computed against the caller-supplied main-branch database path, and the worktree copy is not read

#### Scenario: No workflow side effects
- **WHEN** the subagent completes
- **THEN** the only files it has written are the annotation YAML and its comparison report
