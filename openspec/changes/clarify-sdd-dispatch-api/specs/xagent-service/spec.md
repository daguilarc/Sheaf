## ADDED Requirements

### Requirement: xsvc-17 — MCP: advertised SDD field descriptions match the renderer contract

WHEN an MCP client reads the advertised `xagent_sdd_start` or `xagent_sdd_followup` input schema, THE xagent service SHALL describe each artifact-path field with the direction the renderer actually applies to it — a path the dispatched agent WRITES versus an existing file it READS — and SHALL describe each field's optionality as the renderer enforces it, so that a field the renderer requires is never advertised as optional. THE service SHALL NOT advertise one description across roles that apply a field in opposite directions; where a field's direction differs by role, the field SHALL carry role-distinct names rather than a shared name with a role-conditional description. A description that contradicts the renderer is a defect of the same class as a schema that omits the field: xsvc-15 makes the surface discoverable, and this requirement makes what it discloses true.

The renderer is the authority. `dispatch-prompt` types each template slot as a must-exist input, a write destination, or an inlined file, and treats every slot without a fallback as required; the advertised text SHALL be derived from those facts and not restated independently of them.

#### Scenario: Read-direction paths are advertised as inputs

- **WHEN** a client reads the advertised schema for a role that reads an existing report — a task-scoped `reviewer` or a `re-reviewer`
- **THEN** the field is named for the report it reads rather than the generic `report`
- **AND** its description states that the file must already exist and is read, not written

#### Scenario: Write-direction paths are advertised as outputs

- **WHEN** a client reads the advertised schema for a role that writes its own report — an `implementer` or a `fixer`
- **THEN** the field is `report_out`
- **AND** its description states that the agent writes to that path

#### Scenario: Renderer-required fields are not advertised as optional

- **WHEN** the renderer requires a slot for a role and no value can be derived from the plan workspace
- **THEN** the advertised description for that role states the field is required and names the derivation that would satisfy it
- **AND** the service's tool-surface suite fails when an advertised optionality disagrees with the renderer's slot table

#### Scenario: Divergence is caught by test, not by a controller

- **WHEN** a renderer slot changes direction or gains or loses a fallback, and the advertised description is not updated
- **THEN** the tool-surface suite fails
- **AND** the failure names the field and the disagreeing direction or optionality

### Requirement: xsvc-18 — MCP: renderer argument failures are structured and actionable

WHEN `dispatch-prompt` exits non-zero because a supplied argument is missing, unaccepted by the selected template, or names a file that does not exist, THE xagent service SHALL return a structured `sdd_renderer_bad_input` error naming the offending option and a reason drawn from a closed allowlist of renderer argument-error forms, and SHALL continue to withhold raw renderer stderr, which can echo brief and plan body text. THE service SHALL fall back to the existing opaque `sdd_renderer_failed` only for a non-zero exit that matches no allowlisted form.

An option name and a caller-supplied path are already in the caller's own request, so returning them discloses nothing the caller did not send; withholding them forced two controllers to reproduce the renderer invocation by hand to learn which flag was wrong, and one of them escalated on a misdiagnosis.

#### Scenario: A missing input file names its option

- **WHEN** a start or follow-up supplies an artifact path that does not exist and the renderer rejects it
- **THEN** the service returns `sdd_renderer_bad_input`
- **AND** the details name the option and the reason
- **AND** no renderer stderr text appears in the response

#### Scenario: A required-but-underivable input names its option

- **WHEN** the renderer requires a slot for the selected template and neither an explicit value nor a workspace derivation supplies it
- **THEN** the service returns `sdd_renderer_bad_input` naming that option as required

#### Scenario: Unrecognized renderer failures stay opaque

- **WHEN** the renderer exits non-zero with output matching no allowlisted argument-error form
- **THEN** the service returns `sdd_renderer_failed`
- **AND** discloses no renderer stderr

#### Scenario: Brief and plan text never reach the caller

- **WHEN** a renderer failure occurs whose stderr contains brief or plan body text
- **THEN** the returned error contains no substring of that body text
