## MODIFIED Requirements

### Requirement: xsdd-1 — MCP: SDD dispatch surface plus generic lifecycle tools

WHEN the xagent service exposes its MCP endpoint, THE service SHALL provide
`xagent_sdd_start` and `xagent_sdd_followup` as the Superpowers SDD dispatch
surface, SHALL NOT register `xagent_sdd_await` or `xagent_sdd_close`, and SHALL
retain the generic xagent tools so controllers await, message, inspect,
interrupt, and close SDD-owned runs with the `run_id` the dispatch tools
return. THE dispatch tools SHALL name that identifier `run_id`, the same name
the generic tools accept, so no controller and no document has to teach that
one value carries two names.

#### Scenario: Controller discovers the SDD dispatch tools

- **WHEN** an MCP client initializes against the xagent service
- **THEN** it discovers exactly two xagent SDD tools, `xagent_sdd_start` and
  `xagent_sdd_followup`
- **AND** does not discover `xagent_sdd_await` or `xagent_sdd_close`

#### Scenario: Generic lifecycle tools cover SDD-owned runs

- **WHEN** a controller needs to await, message, or close an SDD-owned run
- **THEN** it uses `xagent_await`, `xagent_message`, or `xagent_close` with the
  `run_id` the dispatch returned, unchanged and unaliased
- **AND** those tools behave identically for SDD-owned and generic runs

### Requirement: xsdd-2 — Start: structured assignment and four-way role prompt

WHEN `xagent_sdd_start` receives an absolute existing `cwd`, a plan file, a supported start role (`implementer`, `reviewer`, `fixer`, or `re-reviewer`), a non-empty brief file, task identity where required, a non-empty `model`, an existing xagent harness, an effort in `low`, `medium`, `high`, or `xhigh`, and role-specific dispatch arguments, THE service SHALL execute `<service repoRoot>/projects/agents/utils/dispatch-prompt` with Python 3 and the canonical `cwd` as its working directory for every renderer-backed role, preserve the renderer's template resolution and validation, insert one immutable `sdd_agents` row, start one supervised persistent session, and return once the turn is durably started. THE service SHALL NOT wait for the turn to complete before returning: awaiting completion is `xagent_await`'s job. Dispatch tools that blocked until turn completion once appeared to fail against every client timeout while succeeding, so a controller that retried would spawn duplicates.

THE start result SHALL carry `run_id` and the supervision `sequence` usable as `after_sequence` on `xagent_await`; `brief_path`; `report_out_path` for the roles that write a report (`implementer`, `fixer`) and no report key for the roles that read one; and `prompt_path` and `renderer_path` only for the renderer-backed roles. `fixer` is formatted by the service and has no renderer, so it SHALL omit those two keys rather than return them empty. No result key SHALL expose the run identifier under a second name.

THE report argument SHALL be named for its direction rather than shared across directions: `report_out` for `implementer` and `fixer`, which write the file; `implementer_report` for a task-scoped `reviewer` and `fixer_report` for a `re-reviewer`, each an existing file the agent reads. WHERE the selected template requires a review diff — a task-scoped `reviewer` or a `re-reviewer` — `diff` SHALL be required unless the plan workspace already holds the derivable review-package file, and SHALL NOT be advertised as unconditionally optional.

THE identifier for a started agent SHALL be `run_id` in every tool input, every tool result, every structured error detail, and every validation message. The immutable `sdd_agents.agent_id` ledger column is internal and keeps its name; the conceptual error names `sdd_agent_not_live`, `sdd_agent_busy`, and `unknown_sdd_agent` refer to the dispatched agent and are unaffected.

#### Scenario: Implementer starts from a brief

- **WHEN** a controller starts an `implementer` with an existing non-empty brief
  file and valid assignment fields
- **THEN** the worker receives the rendered implementer prompt pointing at that
  brief path
- **AND** the controller does not need to submit raw prompt prose
- **AND** the result includes `run_id`, the start-of-turn sequence,
  `prompt_path`, `brief_path`, and `report_out_path`

#### Scenario: Task reviewer starts with a task

- **WHEN** a controller starts a `reviewer` with `task`, a brief, the
  `implementer_report` it is to read, constraints, base/head range, and a
  `diff` or a derivable review-package file
- **THEN** the rendered task-review prompt includes every required upstream
  template value
- **AND** prompt-template drift or a missing required input fails before a
  worker is dispatched

#### Scenario: Reviewer without a diff is rejected before dispatch

- **WHEN** a controller starts a task-scoped `reviewer` or a `re-reviewer` with
  no `diff` and no derivable review-package file in the plan workspace
- **THEN** the service rejects the request naming `diff` as the missing input
- **AND** no `sdd_agents` row or provider process is created

#### Scenario: Whole-branch reviewer has no task number

- **WHEN** a controller starts a `reviewer` without a `task` for a complete SDD
  branch
- **THEN** the plan and assignment are recorded with `task` NULL
- **AND** the supplied brief file contents are inlined as the upstream
  template's review requirements
- **AND** the ledger retains the brief path and exact copy as `brief_text`

#### Scenario: Fresh fixer and re-reviewer are first-class roles

- **WHEN** a controller starts a `fixer` or `re-reviewer` for a plan and task
- **THEN** the role-specific prompt is produced with the original brief and the
  required findings inputs
- **AND** the `fixer` writes to `report_out` while the `re-reviewer` reads the
  existing `fixer_report`
- **AND** the `fixer` result omits `prompt_path` and `renderer_path`
- **AND** the ledger row records that start role immutably

#### Scenario: Caller worktree cannot select executable code

- **WHEN** the caller's `cwd` contains a different or malicious
  `projects/agents/utils/dispatch-prompt`
- **THEN** the service executes only the renderer under its own trusted
  `repoRoot`
- **AND** uses the caller's canonical `cwd` only as the renderer process
  working directory

#### Scenario: Assignment input is invalid

- **WHEN** the harness or effort is outside the supported enums, `model` is
  empty, or a v1 role name such as `task-reviewer` or `code-reviewer` is
  supplied
- **THEN** the service rejects the request before creating an `sdd_agents` row
  or provider process

#### Scenario: No public surface exposes the second identifier name

- **WHEN** any dispatch result, validation message, or structured error detail
  is inspected across every role and every failure path
- **THEN** the run identifier appears only as `run_id`
- **AND** `agent_id` appears only in ledger records

### Requirement: xsdd-3 — Follow-up: optional same-agent convenience with fresh-agent recovery

WHEN `xagent_sdd_followup` receives a valid SDD `run_id`, follow-up kind, round, required artifacts, and the report path its kind requires — `report_out` for `fix`, which the agent appends to, and `fixer_report` for `re-review`, an existing file it reads — THE service SHALL format the prescribed fix or re-review message, submit it to the same live provider session without writing the ledger, and return `{ run_id, sequence }`. THE service SHALL source the brief from the target agent's `sdd_agents` row. WHERE kind `re-review` renders the upstream re-review template, `diff` SHALL be required unless the plan workspace already holds the derivable review-package file, on the same terms as a task-scoped `reviewer` start. WHEN the run is not live, THE service SHALL return `sdd_agent_not_live` naming the fresh-agent recovery (`xagent_sdd_start` with role `fixer` or `re-reviewer` for the same plan and task) rather than a closed-session dead end. Follow-up is optional convenience while the agent is live; it is not a mandatory same-session path, and a dead agent is recovered by a fresh start rather than by reopening a closed session.

#### Scenario: Fix resumes a live implementer or fixer

- **WHEN** an implementer or fixer run is live and ready and the controller
  submits a `fix` follow-up with findings, covering-test guidance, and a
  `report_out` path
- **THEN** xagent sends the formatted fix message to that agent's existing
  session
- **AND** no ledger row is created or mutated
- **AND** no new run identifier is created

#### Scenario: Re-review resumes a live reviewer or re-reviewer

- **WHEN** a task-scoped reviewer or re-reviewer run is live and ready and the
  controller submits a `re-review` follow-up with a round, findings, the
  existing `fixer_report`, base/head range, and a `diff` or a derivable
  review-package file
- **THEN** xagent renders the upstream re-review prompt
- **AND** sends it to that agent's existing session
- **AND** no ledger row is created or mutated

#### Scenario: Re-review without a diff is rejected before submission

- **WHEN** a `re-review` follow-up supplies no `diff` and the plan workspace
  holds no derivable review-package file
- **THEN** the service rejects the call naming `diff`
- **AND** submits nothing to the provider

#### Scenario: Raw message is legal on SDD runs

- **WHEN** a caller submits generic `xagent_message` for an SDD-owned run
- **THEN** the service accepts it as unstructured input
- **AND** records the submitted text as a durable `turn.submitted` event
- **AND** does not require `xagent_sdd_followup` for chit-chat or
  `NEEDS_CONTEXT` answers

#### Scenario: Dead agent gets a signpost, not a closed-session dead end

- **WHEN** a caller requests a follow-up against an agent whose run is terminal
  or absent from the run manager
- **THEN** the service returns `sdd_agent_not_live` naming the fresh-agent
  recovery role and `xagent_sdd_start`
- **AND** submits nothing to the provider

#### Scenario: Incompatible follow-up is rejected

- **WHEN** a caller requests a fix from a reviewer, a re-review from an
  implementer, a re-review against a task-less whole-branch reviewer, or a
  follow-up while the agent is mid-turn
- **THEN** the service rejects the request with a structured error before
  submitting provider input
- **AND** a mid-turn rejection names `xagent_await` as the recovery tool

### Requirement: xsdd-6 — Cursor: supervision sequence from tools and events

WHEN an SDD dispatch or await returns a position, THE service SHALL expose the
xagent supervision sequence from the tool result or durable event and SHALL NOT
synthesize or expose a provider JSONL byte offset, line number, or file
position. THE ledger SHALL NOT store resume or completion sequences; the
controller retains the cursor returned by `xagent_sdd_start`,
`xagent_sdd_followup`, or `xagent_await`.

#### Scenario: Dispatch and completion cursors are usable

- **WHEN** an SDD start or follow-up returns `sequence` and the turn later
  completes
- **THEN** awaiting with that `sequence` as `after_sequence` observes that
  turn's completion
- **AND** does not replay an event the controller has already been given

#### Scenario: Provider logs have no public position

- **WHEN** provider JSONL files exist for an xagent run
- **THEN** the SDD MCP result and ledger do not claim a JSONL position
- **AND** session continuation uses `run_id` plus the supervision
  sequence cursor from prior tool results

## ADDED Requirements

### Requirement: xsdd-9 — Vocabulary: one name, one function across the SDD surface

THE xagent SDD dispatch surface SHALL NOT use one field name for two functions, and SHALL NOT expose one value under two names. A field whose function depends on the variant that receives it SHALL be split into variant-distinct names; a value already named by the generic lifecycle tools SHALL keep that name on the SDD tools.

**Function** SHALL mean the logical role the artifact plays in the dispatch — the assignment document, the findings, a report the agent reads, a report the agent writes — and SHALL NOT mean the transport by which the prompt receives it. Two variants that both take "the findings for this task" share a function even where one prompt substitutes the path and the other inlines the contents, because transport is a rendering choice below this API and no caller supplies a different thing on account of it. What a caller does supply differently, and has twice supplied wrongly, is a file to be read versus a path to be written.

The surface previously carried `report` in both directions, `agent` for a provider model beside `agent_id` for a run identity, and `agent_id` for the value every other tool calls `run_id` — a collision both skills had to teach controllers to work around. Two controllers constructed wrong calls directly from the resulting descriptions.

#### Scenario: No dispatch field name carries two functions

- **WHEN** the advertised schemas for `xagent_sdd_start` and `xagent_sdd_followup` are inspected across every role and kind
- **THEN** no field name is applied to both a read artifact and a written one, or to two distinct concepts
- **AND** a test enumerating the surface fails if one is introduced

#### Scenario: One value keeps one name across tool families

- **WHEN** a controller starts an SDD agent and then awaits, messages, or closes it with the generic tools
- **THEN** the identifier is called `run_id` at every step
- **AND** no documentation instructs the controller to pass one field's value as a differently named field

#### Scenario: Shared function survives differing transport

- **WHEN** `brief` is supplied to a task-scoped `reviewer` whose prompt substitutes its path, and to a whole-branch `reviewer` whose prompt inlines its contents
- **THEN** the field keeps the single name `brief`, since both are the assignment document for the dispatch
- **AND** the advertised description states which document each variant supplies and how the prompt receives it
- **AND** the same holds for `findings` across `fixer` and follow-up kind `re-review`

#### Scenario: Variant selection by field presence is not a collision

- **WHEN** `task` is present on a `reviewer` and selects the task-review prompt, and absent and selects the whole-branch prompt
- **THEN** `task` is not a violation, since it always means the plan task number
- **AND** its presence rule is stated in the `role` and `task` descriptions
