# task-analyzer-sdd-annotations

## ADDED Requirements

### Requirement: Sibling annotation file format
The system SHALL define a versioned YAML annotation format stored as a sibling
file to an SDD plan (`docs/superpowers/plans/<name>.assignments.yaml`) that
records, per SDD task: task key, implementer model and effort, complexity
vector C1–C7 with composite, and predicted cost quantiles. The format MUST be
optional: absence of the file MUST NOT affect any existing workflow, and the
existing Superpowers plan format MUST NOT be modified.

#### Scenario: Annotation file accompanies a plan
- **WHEN** a decomposition has been selected for plan `docs/superpowers/plans/X.md`
- **THEN** its assignments are written to `docs/superpowers/plans/X.assignments.yaml` with `format: 1`, the openspec change name, the estimator id (or null), and one entry per task containing model, effort, complexity `{C1..C7, composite}`, and predicted cost fields

#### Scenario: Absence is harmless
- **WHEN** a plan has no `.assignments.yaml` sibling
- **THEN** all existing tooling and workflows behave exactly as before this change

### Requirement: Annotation validation
The system SHALL provide a validator (invocable as a script) that checks an
annotation file for: known `format` version, task keys matching the sibling
plan's task list, complexity integers in 1–5, `composite` equal to the mean of C1–C6 rounded
to one decimal (or omitted, in which case it is computed), and a model/effort
pair present in the estimator's known arms; it SHALL exit nonzero with a
per-error report on invalid input.

#### Scenario: Invalid annotation rejected
- **WHEN** the validator runs on a file whose task keys do not match the plan, whose complexity values fall outside 1–5, or whose `composite` disagrees with the mean of C1–C6
- **THEN** it exits nonzero and reports each mismatch with its task key and field
