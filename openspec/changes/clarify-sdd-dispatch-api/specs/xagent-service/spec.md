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

WHEN an MCP client reads the advertised `xagent_sdd_start` or `xagent_sdd_followup` input schema, THE xagent service SHALL derive every artifact-field description from a **dispatch field manifest** rather than from independently authored prose, and SHALL fail its own tool-surface suite when a description, direction, or required condition disagrees with that manifest.

**The variant registry.** THE service SHALL declare a closed registry naming exactly seven public dispatch variants — `implementer`, `reviewer:task`, `reviewer:branch`, `fixer`, `re-reviewer`, `followup:fix`, and `followup:re-review` — **and, for each, the canonical set of in-scope public fields it accepts**. A bare list of variant names is not a registry: without the per-variant field matrix there is nothing for the manifest to be equal to.

THE suite SHALL assert three independent equalities, because each closes a different seam:

1. The variants the union, the reviewer refinement, and the dispatch router actually recognize SHALL equal the registry's variant keys. Without this, a new route can be added while registry and manifest stay equal to each other and both stay wrong.
2. The public `(variant, field)` pairs the schemas actually accept SHALL equal the registry matrix.
3. The manifest's caller-input pairs SHALL equal the registry's in-scope pairs.

**In-scope and operational fields.** An in-scope field is one the caller supplies that reaches a renderer argument or a service-formatted prompt. THE operational exclusion set SHALL be exactly `role`, `kind`, `cwd`, `model`, `harness`, `effort`, `policy`, `note`, and `run_id` — routing, transport, and supervision inputs that no prompt consumes. Every other public field is in scope, artifact-bearing or not.

**Artifact fields.** An artifact field is an in-scope field whose value is a filesystem path: `plan`, `brief`, `report_out`, `implementer_report`, `fixer_report`, `constraints`, `diff`, and `findings`. Non-artifact in-scope fields — `task`, `name`, `context`, `description`, `base`, `head`, `round`, `tests`, `findings_text` — SHALL appear with a null direction, because dpr-10 can name their renderer options in a fault trailer.

**Manifest entries.** Each entry SHALL carry: `variant`; `field`; `source`; `renderer_option` or an explicit service-formatted marker; **`provenance`**; `surface_kind`; `direction`; `transport`; `required_condition`; and `derivation`.

**Provenance.** THE `provenance` SHALL be `caller_input`, `ledger`, or `derived`. Not every renderer argument comes from the caller: a `followup:re-review` sources `--plan`, `--task`, and `--brief` from the target agent's `sdd_agents` row, and the follow-up schema deliberately exposes none of them. Only `caller_input` entries SHALL be compared against the registry matrix, and only they SHALL carry a surface field. A `ledger` or `derived` entry SHALL carry a null surface field, so the manifest can be simultaneously equal to the public surface and complete over renderer arguments.

**Direction is artifact lifecycle, not who does the reading.** `reads` SHALL mean the supplied path must identify an existing file consumed by the dispatch pipeline — by the renderer, by the agent, or by both. `writes` SHALL mean the path is an agent output destination. Direction SHALL NOT be defined as what the dispatched agent does with the path: for a whole-branch reviewer the renderer inlines `--requirements` and the agent never receives the path at all, so an agent-centred definition would make `reads` untrue for the one field that most needed describing. `transport` carries the orthogonal fact dpr-5 declares on the slot, so `reviewer:branch`'s `brief` records `direction: reads` with `transport: inlined_contents` and both are true. `plan` is `reads` under this definition — it must exist, and the pipeline consumes it to locate the workspace. Fields whose surface value is inline text SHALL carry a null direction.

**Two sources.** The manifest SHALL draw from exactly two sources whose union equals the registry:

1. The renderer's slot table (dpr-11) plus the service's own record of how it adapts each renderer-backed variant — which surface field maps to which renderer option, and where a path surface field is delivered through a text slot. `dispatch-prompt` renders `implementer`, both `reviewer` variants, `re-reviewer`, and `followup:re-review`.
2. A service-owned declaration for the variants the renderer has no template for — `fixer` and `followup:fix`. Superpowers ships no fix template; upstream a fix is a follow-up to a live implementer or a fresh implementer, so `fixer` is a service-local recovery role whose prompt text is the authority for its fields.

**Construction.** THE manifest SHALL be a checked-in artifact generated from `dispatch-prompt --describe-slots` by the repository's packaging step, verified by a `--check` mode that fails when the checked-in copy diverges from the renderer. It SHALL NOT be built by executing the renderer during service startup or MCP registration: the advertised schemas are module-level constants and registration is synchronous, so a startup subprocess would add Python availability, renderer resolution, and schema-version negotiation to the service's boot path for data that changes only when the renderer does. Generation SHALL fail loudly on an unsupported `schema_version` rather than degrade.

#### Scenario: Read-direction paths are advertised as inputs

- **WHEN** a client reads the advertised schema for a variant that reads an existing report — `reviewer:task`, `re-reviewer`, or `followup:re-review`
- **THEN** the field is named for the report it reads rather than the generic `report`
- **AND** its description states that the file must already exist and is read, not written

#### Scenario: Write-direction paths are advertised as outputs

- **WHEN** a client reads the advertised schema for a variant that writes its own report — `implementer`, `fixer`, or `followup:fix`
- **THEN** the field is `report_out`
- **AND** its description states that the agent writes to that path

#### Scenario: Surface direction survives an inlining transport

- **WHEN** the manifest describes `reviewer:branch`'s `brief`, delivered through the renderer's `--requirements` text slot
- **THEN** the entry records direction `reads`, `surface_kind` path, and transport `inlined_contents`
- **AND** the renderer's own slot table still declares no direction for that slot, without the suite reporting a contradiction

#### Scenario: The registry is bound to the routes that actually exist

- **WHEN** the suite enumerates the variants the union, the reviewer refinement, and the dispatch router recognize
- **THEN** that set equals the registry's variant keys
- **AND** a route added without registering it fails the suite, rather than passing because registry and manifest remain equal to each other

#### Scenario: The registry matrix is bound to the accepted fields

- **WHEN** the suite enumerates the `(variant, field)` pairs the schemas actually accept
- **THEN** that set equals the registry matrix
- **AND** the manifest's caller-input pairs equal the registry's in-scope pairs

#### Scenario: A new variant reusing only existing fields cannot slip through

- **WHEN** a variant is introduced that reuses only fields already advertised, and is not added to the registry
- **THEN** the suite fails
- **AND** the failure names the unregistered variant rather than passing because the flat advertised field set was unchanged

#### Scenario: Ledger-sourced renderer arguments carry no surface field

- **WHEN** the manifest describes `followup:re-review`'s `--plan`, `--task`, and `--brief`, which the service reads from the `sdd_agents` row
- **THEN** each entry carries provenance `ledger` and a null surface field
- **AND** those entries are excluded from the registry comparison, so the manifest is complete over renderer arguments without claiming public fields that do not exist

#### Scenario: Conditionally required fields say what satisfies them

- **WHEN** a field is required by its prompt source and a documented derivation can satisfy it
- **THEN** the description states the condition and names the derivation
- **AND** the field is not described as unconditionally optional

#### Scenario: The checked-in manifest cannot silently diverge

- **WHEN** the renderer's slot table changes and the checked-in manifest is not regenerated
- **THEN** the packaging `--check` mode fails
- **AND** the failure names the diverging template and option

#### Scenario: Non-artifact fields need no direction

- **WHEN** the suite inspects `context`, `description`, `findings_text`, `note`, `base`, `head`, `task`, or `round`
- **THEN** it requires no direction for them
- **AND** their presence with a null direction is not a failure

### Requirement: xsvc-18 — MCP: renderer argument failures are structured, coded, and named in surface vocabulary

WHEN `dispatch-prompt` exits non-zero having emitted an allowlisted argument-fault trailer (dpr-10), THE xagent service SHALL return a structured `sdd_renderer_bad_input` error whose details carry the fixed `reason` code and the **corresponding surface field** for the variant being dispatched, and SHALL continue to withhold raw renderer stderr, which can echo brief and plan body text. THE service SHALL return the opaque `sdd_renderer_failed` for any non-zero exit whose trailer is absent, unparseable, carries a reason outside the allowlist, or names a renderer option the facade never sends.

THE allowlisted reason codes SHALL be exactly: `no_such_file`, `empty_file`, `parent_missing`, `not_accepted`, and `required_missing`.

THE public `details` shape SHALL be exactly `{ reason, field }` for `required_missing` and `not_accepted`, and `{ reason, field, path }` for `no_such_file`, `empty_file`, and `parent_missing`. THE details SHALL NOT carry the renderer template name, the renderer option, or any other renderer-internal vocabulary. `field` names the surface field corresponding to the faulting option for that variant — not necessarily a field the caller sent, since `required_missing` fires precisely when the caller sent nothing.

THE service SHALL translate the renderer option to the surface field through the same dispatch field manifest xsvc-17 describes the schema from. The mapping is variant-aware, because one renderer option serves differently named surface fields: `--report` backs `report_out` for an `implementer`, `implementer_report` for `reviewer:task`, and `fixer_report` for `re-reviewer`. Returning the raw renderer flag SHALL be a defect: it reintroduces the retired ambiguous vocabulary and does not identify the caller's own field. The manifest covers every renderer option the facade sends, including the non-artifact ones dpr-10 can name — `--name`, `--base`, `--head`, `--task`, `--round` — so every trailer arising from caller input has a surface field to report.

**Ledger-sourced faults are not bad caller input.** WHERE the faulting option's manifest entry has provenance `ledger` — a `followup:re-review` whose stored `plan` or `brief` has been deleted, emptied, or moved since dispatch — THE service SHALL NOT return `sdd_renderer_bad_input`, because the caller supplied no such field and naming one would blame it for a value it never sent. THE service SHALL instead return a structured `sdd_stored_artifact_missing` error naming the stored artifact and the fresh-start recovery: `xagent_sdd_start` with role `re-reviewer` for the same plan and task, supplying the brief again. An option with provenance `derived` and no surface field SHALL fall back to `sdd_renderer_failed`.

An option name and a caller-supplied path are already in the caller's own request, so returning them discloses nothing the caller did not send. Withholding them forced two controllers to reproduce the renderer invocation by hand to learn which flag was wrong, and one escalated on a misdiagnosis.

#### Scenario: A missing input file names the caller's field

- **WHEN** a `reviewer:task` start supplies an `implementer_report` path that does not exist
- **THEN** the service returns `sdd_renderer_bad_input` with details `{ reason: "no_such_file", field: "implementer_report", path }`
- **AND** no renderer stderr, template name, or renderer option appears in the response

#### Scenario: The same renderer option maps per variant

- **WHEN** the identical `no_such_file` trailer for `--report` arises from an `implementer`, a `reviewer:task`, and a `re-reviewer`
- **THEN** the returned field is `report_out`, `implementer_report`, and `fixer_report` respectively

#### Scenario: A deleted ledger-sourced artifact is not blamed on the caller

- **WHEN** a `followup:re-review` renders and the `brief` stored in the agent's `sdd_agents` row has been deleted or emptied since dispatch
- **THEN** the service returns `sdd_stored_artifact_missing`, not `sdd_renderer_bad_input`
- **AND** the details name the stored artifact and the fresh-start recovery
- **AND** no field the caller never sent is named as bad input

#### Scenario: Non-artifact options also resolve to a surface field

- **WHEN** the renderer emits `required_missing` or `not_accepted` for a non-artifact option such as `--name`, `--base`, `--head`, `--task`, or `--round`
- **THEN** the service returns `sdd_renderer_bad_input` naming that option's surface field
- **AND** does not fall back to the opaque error merely because the field carries no direction

#### Scenario: Details shape follows the reason

- **WHEN** the reason is `required_missing` or `not_accepted`
- **THEN** details carry exactly `reason` and `field`
- **AND** when the reason is a path fault, details carry exactly `reason`, `field`, and `path`

#### Scenario: Every allowlisted reason classifies

- **WHEN** the renderer emits each of `no_such_file`, `empty_file`, `parent_missing`, `not_accepted`, and `required_missing`
- **THEN** each returns `sdd_renderer_bad_input` carrying that reason code

#### Scenario: Unrecognized renderer failures stay opaque

- **WHEN** the renderer exits non-zero with no parseable trailer, a reason outside the allowlist, or an option the facade never sends
- **THEN** the service returns `sdd_renderer_failed`
- **AND** discloses no renderer stderr

#### Scenario: Brief and plan text never reach the caller

- **WHEN** a renderer failure occurs whose stderr contains brief or plan body text
- **THEN** the returned error contains no substring of that body text
