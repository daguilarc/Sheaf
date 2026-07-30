## MODIFIED Requirements

### Requirement: xsvc-11 — SDD dispatch: four-way start role union

WHEN `xagent_sdd_start` is called, THE xagent service SHALL accept exactly the roles `implementer`, `reviewer`, `fixer`, and `re-reviewer` as a discriminated union over strict objects that all share the assignment fields (`note?`, `cwd`, `plan`, `model`, `harness`, `effort`, `policy?`) and additionally require: for `implementer` — `task`, `name`, `brief`, `report_out`, `context?`; for `reviewer` — `brief` (unifying v1 `brief` and `review_brief`), `base`, `head`, and an optional `task` that when present requires `implementer_report` and permits `constraints?`/`diff?`, and when absent requires `description` and forbids `implementer_report`/`constraints`/`diff`; for `fixer` — `task`, the original `brief`, `findings`, `findings_text`, `tests`, and `report_out`, with no `name` or `context` field; for `re-reviewer` — `task`, the original review `brief`, `findings`, `fixer_report`, `base`, `head`, `diff?`; `fixer` and `re-reviewer` SHALL each accept an optional `round` defaulting to 1, which — exactly as in xsvc-12 — parameterizes only the rendered text and is recorded nowhere but the resulting `turn.submitted` event; what those roles SHALL NOT have is a `name` field encoding the round into an assignment identity; `reviewer` with a `task` SHALL render the task-review template and `reviewer` without a `task` SHALL render the whole-branch review template; `fixer` SHALL render the service-owned fix prompt rather than encoding the fix round into an assignment name; every dispatch SHALL therefore carry a brief, read at dispatch time into `brief_text`.

THE assignment field naming a provider model SHALL be `model`, matching `xagent_start_non_sdd`; the retired name `agent` SHALL NOT be accepted. THE report field SHALL be named for the direction the receiving role applies to it: `report_out` where the dispatched agent writes the file, `implementer_report` and `fixer_report` where it reads an existing one. No compatibility alias for `agent`, `report`, or `agent_id` SHALL be accepted on either dispatch tool.

#### Scenario: Reviewer merge replaces the v1 role split

- **WHEN** a controller dispatches role `reviewer` with `task: 4`
- **THEN** the task-review template renders for task 4
- **AND** dispatching role `reviewer` without a task renders the whole-branch review template with `task` NULL in the ledger row

#### Scenario: Fresh fixer without impersonation

- **WHEN** a controller dispatches role `fixer` for a task whose implementer is dead, passing the original brief, the findings file, and covering tests
- **THEN** the rendered prompt identifies the work as a fix for that plan and task
- **AND** no assignment name of the form "Task N Fix Round M" is required or rendered as the task identity

#### Scenario: Unknown role rejected

- **WHEN** a controller dispatches role `task-reviewer` or `code-reviewer` (the v1 names) or any other unlisted role, or passes the v1 field name `review_brief` to role `reviewer`
- **THEN** input validation rejects the call before any ledger or run state is created

#### Scenario: Re-reviewer carries the original review brief

- **WHEN** a controller dispatches role `re-reviewer` for a reviewed task, passing the brief the original reviewer was dispatched with
- **THEN** the dispatch inserts a row whose `brief_path`/`brief_text` record that brief, satisfying the ledger's unconditional NOT NULL brief columns
- **AND** a `re-reviewer` dispatch without a `brief` is rejected by input validation

#### Scenario: Retired field names are rejected, never ignored

- **WHEN** a controller sends `agent`, `report`, or `agent_id` on `xagent_sdd_start`, alone or alongside the replacing field
- **THEN** the call is rejected with a structured validation error naming the retired field
- **AND** the retired key is not stripped before the union sees it

### Requirement: xsvc-12 — SDD continuation: demoted `xagent_sdd_followup`

WHEN `xagent_sdd_followup` is called with kind `fix` or `re-review`, THE xagent service SHALL accept as input for `fix`: `run_id`, `round`, `findings`, `findings_text`, `tests`, `report_out`, `note?`, and for `re-review`: `run_id`, `round`, `findings`, `fixer_report`, `base`, `head`, `diff?`, `note?` — where the report field is a required tool input (the v2 ledger stores no report path) named for the direction its kind applies to it, the brief is sourced from the target agent's own `sdd_agents` row and never from input, and `round` parameterizes only the rendered text, recorded nowhere but the resulting `turn.submitted` event; THE service SHALL render the continuation and submit it to the same live agent without writing the ledger, returning `{ run_id, sequence }` with no v1 `turn_number` field, validating only that an `sdd_agents` row exists (else `unknown_sdd_agent`), that the run is live in the run manager, and that the kind matches the agent's immutable start role (`fix` for `implementer` or `fixer`; `re-review` for `reviewer` or `re-reviewer`, else `sdd_followup_role_mismatch`); WHEN the run is not live, THE service SHALL return a structured `sdd_agent_not_live` error — replacing v1's `sdd_session_terminal` — whose details name the fresh-agent recovery: the role to dispatch for the same `plan_path` and `task`.

WHERE kind `re-review` renders the upstream re-review template, `diff` SHALL be required unless the conventional review-package file is derivable in the plan workspace, on the same terms as a task-scoped `reviewer` start.

THE service SHALL refuse a follow-up in every supervision phase except `ready`, with a structured error rather than a bare provider phase error: terminal phases (`completed`, `failed`, `cancelled`, `abandoned`) SHALL return `sdd_agent_not_live` as above, and every other non-`ready` phase SHALL return `sdd_agent_busy` naming the observed phase and `xagent_await` as the recovery tool. A re-review addressed to a task-less (whole-branch) reviewer SHALL return `sdd_followup_task_required` before any prompt is rendered. Every recovery pointer SHALL name a tool the service actually registers.

#### Scenario: A dead but still-tracked agent gets the signpost

- **WHEN** a controller sends a follow-up to an agent whose supervisor has reached a terminal phase but whose run is still tracked by the run manager
- **THEN** the service returns `sdd_agent_not_live` with the fresh-agent recovery details
- **AND** submits nothing to the provider
- **AND** the controller never receives an unstructured phase error it cannot act on

#### Scenario: A mid-turn agent is told to wait, not stranded

- **WHEN** a controller sends a follow-up to an agent that is starting or already running a turn
- **THEN** the service returns `sdd_agent_busy` naming the observed phase
- **AND** the recovery names `xagent_await`, which the service registers

#### Scenario: Same-agent fix writes no ledger state

- **WHEN** a controller sends kind `fix` to a live implementer
- **THEN** the fix prompt is rendered and submitted, appearing as a `turn.submitted` event
- **AND** the `sdd_agents` table is unchanged

#### Scenario: Dead agent gets a signpost, not a dead end

- **WHEN** a controller sends kind `fix` to an agent whose run is terminal or absent from the run manager
- **THEN** the service returns `sdd_agent_not_live`
- **AND** the error details state that recovery is `xagent_sdd_start` with role `fixer` for the same plan and task

#### Scenario: Kind must match start role

- **WHEN** a controller sends kind `re-review` to an agent whose start role is `implementer`
- **THEN** the service rejects the call with a structured role-mismatch error
- **AND** submits nothing to the provider

#### Scenario: Careless controllers cannot corrupt the ledger

- **WHEN** a controller double-calls `xagent_sdd_followup`, skips it entirely, or calls it after the agent died
- **THEN** no `sdd_agents` row is created, mutated, or orphaned in any of those cases
- **AND** every submitted continuation remains recoverable from `turn.submitted` events

#### Scenario: Re-review without a diff fails at the facade

- **WHEN** a controller sends kind `re-review` with no `diff` and no derivable review-package file in the plan workspace
- **THEN** the service rejects the call naming `diff`
- **AND** submits nothing to the provider

### Requirement: xsvc-15 — MCP: SDD dispatch tools advertise their input contract

WHEN an MCP client lists tools, THE xagent service SHALL advertise, for `xagent_sdd_start` and `xagent_sdd_followup`, an input schema that names every accepted field and its JSON type — including the discriminating `role` and `kind` fields with their permitted values, and for each variant-specific field a description naming the variants that require it — so that a client which has never seen the service can construct a valid call from discovery alone; THE service SHALL NOT advertise an empty or field-less schema for either tool.

The MCP SDK derives a tool's advertised schema only from an object schema; a Zod discriminated union normalizes to `undefined` and is published as the empty object. Registration SHALL therefore supply an object schema that is a **superset** of the union — the discriminator as an enumeration, the fields shared by every variant as required, and every variant-specific field as optional — while the handler SHALL continue to parse each call against the union itself. The union remains the sole authority for rejection; the advertised schema exists to describe, never to enforce.

THE advertised schema SHALL NOT reject anything the union accepts. Discovery may be more permissive than enforcement, because an over-permissive schema costs a caller one structured validation error, whereas an over-strict one hides a legal call that the service would have served.

BECAUSE the SDK validates call arguments against the registered advertised schema before the handler runs, and a plain object schema strips keys it does not declare, THE advertised schemas for both dispatch tools SHALL preserve unknown keys so the union receives them. A retired or misspelled field that the advertised schema silently removes cannot be rejected by the union, which would convert a loud error into a wrong dispatch.

#### Scenario: A cold client can construct a dispatch

- **WHEN** an MCP client lists tools and reads the `xagent_sdd_start` input schema without prior knowledge of the service
- **THEN** the schema names `role` with its four permitted values, and the assignment and role-specific fields with their types
- **AND** a call constructed from that schema alone passes input validation

#### Scenario: Field-less schemas are a defect

- **WHEN** any advertised SDD dispatch tool schema is inspected
- **THEN** it declares at least the discriminating field and the fields shared by every variant
- **AND** a schema with no properties fails the service's own tool-surface tests

#### Scenario: Discovery never hides a legal call

- **WHEN** a payload that the union accepts is checked against the advertised schema, for every start role and every follow-up kind
- **THEN** the advertised schema accepts it too
- **AND** the tool-surface suite fails if any variant's valid payload is rejected by the advertised schema

#### Scenario: Enforcement stays with the union

- **WHEN** a client sends a payload the advertised superset permits but the union rejects — a `fixer` missing `findings`, or a task-less `reviewer` that sets `implementer_report`
- **THEN** the handler rejects it with the union's own structured validation error
- **AND** the advertised schema is never consulted at runtime

#### Scenario: Unknown keys survive to the union

- **WHEN** a client sends a retired or misspelled field alongside an otherwise valid payload, through the real MCP boundary
- **THEN** the key reaches the union rather than being stripped by the advertised schema
- **AND** the union rejects the call with a structured error naming that field

## ADDED Requirements

### Requirement: xsvc-17 — MCP: advertised SDD field descriptions derive from a dispatch field manifest

WHEN an MCP client reads the advertised `xagent_sdd_start` or `xagent_sdd_followup` input schema, THE xagent service SHALL describe every artifact-path field from a **dispatch field manifest** rather than from independently authored prose, and SHALL fail its own tool-surface suite when a description disagrees with that manifest.

THE manifest SHALL have exactly one entry per (variant, artifact field) pair, carrying: the surface field name; the prompt source that consumes it; the renderer option it maps to, or an explicit marker that the variant is service-formatted; the **direction**; the **required condition**; and the **derivation** that can satisfy it when the caller omits it.

THE manifest SHALL draw from exactly two sources, and their union SHALL cover every advertised artifact field:

1. The renderer's machine-readable slot table (dpr-11), for the variants whose prompts `dispatch-prompt` renders — `implementer`, task-scoped and whole-branch `reviewer`, and `re-reviewer`.
2. A service-owned declaration for the variants the service formats in its own code and the renderer has no template for — the `fixer` start role and follow-up kind `fix`. Superpowers ships no fix template; a fix upstream is a follow-up to a live implementer or a fresh implementer, so `fixer` is a service-local recovery role whose prompt text is the authority for its fields.

**Direction** SHALL mean only the direction the dispatched agent applies to a caller-supplied filesystem path: a path it READS (whether the prompt receives the path or the file's contents) or a path it WRITES. Direction SHALL be declared only for artifact-bearing fields. Fields carrying inline text, an inline-or-`@FILE` value, or a plain literal SHALL carry no direction, and the tool-surface suite SHALL NOT require one. Whether a read path is substituted as a path or inlined as contents is a rendering detail below this API; it SHALL be stated in the field description and SHALL NOT by itself require distinct field names (see xsdd-9).

**Required condition** SHALL state whether the caller must supply the field, and SHALL account for derivation: a slot the renderer cannot render without is not thereby a field the caller must supply, when a documented derivation from the plan workspace can satisfy it. A field the renderer requires and no derivation can satisfy SHALL NOT be advertised as unconditionally optional.

#### Scenario: Read-direction paths are advertised as inputs

- **WHEN** a client reads the advertised schema for a variant that reads an existing report — a task-scoped `reviewer`, a `re-reviewer`, or follow-up kind `re-review`
- **THEN** the field is named for the report it reads rather than the generic `report`
- **AND** its description states that the file must already exist and is read, not written

#### Scenario: Write-direction paths are advertised as outputs

- **WHEN** a client reads the advertised schema for a variant that writes its own report — an `implementer`, a `fixer`, or follow-up kind `fix`
- **THEN** the field is `report_out`
- **AND** its description states that the agent writes to that path

#### Scenario: Conditionally required fields say what satisfies them

- **WHEN** a field is required by its prompt source and a workspace derivation can satisfy it
- **THEN** the description states the condition and names the derivation
- **AND** the field is not described as unconditionally optional

#### Scenario: Both manifest sources are covered

- **WHEN** the tool-surface suite builds the manifest
- **THEN** it joins the renderer slot table with the service-owned fixer declaration
- **AND** fails if any advertised artifact field of any variant appears in neither source

#### Scenario: Divergence is caught by test, not by a controller

- **WHEN** a renderer slot changes direction or required condition, or the fixer prompt gains or loses a field, without the corresponding description change
- **THEN** the tool-surface suite fails
- **AND** the failure names the field and the disagreeing attribute

#### Scenario: Non-artifact fields need no direction

- **WHEN** the suite inspects `context`, `description`, `findings_text`, `note`, `base`, or `head`
- **THEN** it requires no direction for them
- **AND** their presence without a direction is not a failure

### Requirement: xsvc-18 — MCP: renderer argument failures are structured, coded, and named in surface vocabulary

WHEN `dispatch-prompt` exits non-zero having emitted an allowlisted argument-fault diagnostic (dpr-10), THE xagent service SHALL return a structured `sdd_renderer_bad_input` error whose details carry the fixed `reason` code and the **surface field name** the caller actually sent, and SHALL continue to withhold raw renderer stderr, which can echo brief and plan body text. THE service SHALL return the opaque `sdd_renderer_failed` for any non-zero exit whose diagnostic is absent, unparseable, or carries a reason outside the allowlist.

THE allowlisted reason codes SHALL be exactly: `no_such_file`, `empty_file`, `parent_missing`, `not_accepted`, and `required_missing`.

THE service SHALL translate the renderer option back to the surface field name using the same dispatch field manifest that xsvc-17 describes the schema from — the mapping is role-aware, because one renderer option serves differently named surface fields across variants: `--report` backs `report_out` for an `implementer`, `implementer_report` for a task-scoped `reviewer`, and `fixer_report` for a `re-reviewer`. Returning the raw renderer flag SHALL be a defect: it reintroduces the retired ambiguous vocabulary and does not identify the caller's own field.

An option name and a caller-supplied path are already in the caller's own request, so returning them discloses nothing the caller did not send. Withholding them forced two controllers to reproduce the renderer invocation by hand to learn which flag was wrong, and one escalated on a misdiagnosis.

#### Scenario: A missing input file names the caller's field

- **WHEN** a task-scoped `reviewer` start supplies an `implementer_report` path that does not exist
- **THEN** the service returns `sdd_renderer_bad_input` with reason `no_such_file`
- **AND** the details name `implementer_report`, not `--report`
- **AND** no renderer stderr text appears in the response

#### Scenario: The same renderer option maps per role

- **WHEN** the identical `no_such_file` diagnostic for `--report` arises from an `implementer`, a task-scoped `reviewer`, and a `re-reviewer`
- **THEN** the returned field is `report_out`, `implementer_report`, and `fixer_report` respectively

#### Scenario: Every allowlisted reason classifies

- **WHEN** the renderer emits each of `no_such_file`, `empty_file`, `parent_missing`, `not_accepted`, and `required_missing`
- **THEN** each returns `sdd_renderer_bad_input` carrying that reason code

#### Scenario: Unrecognized renderer failures stay opaque

- **WHEN** the renderer exits non-zero with no parseable diagnostic, or a reason outside the allowlist
- **THEN** the service returns `sdd_renderer_failed`
- **AND** discloses no renderer stderr

#### Scenario: Brief and plan text never reach the caller

- **WHEN** a renderer failure occurs whose stderr contains brief or plan body text
- **THEN** the returned error contains no substring of that body text
