# Capability: Issues

Project: `projects/quest-runner`
ID prefix: `iss` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The issue-tracking surface lets workflow roles record, inspect, and resolve
review findings against a quest without editing issue markdown by hand. It
exposes a REST API (`/api/issues...`) and a CLI (`scripts/quest-runner
issues ...`) over the markdown-backed issue files that workflow configurations
declare (e.g. `physicalplan_issues.md`, `slices/<dir>/polishing_issues.md`).
Reviewer roles open and close issues; responder roles attach `Fixed`/`NotFixed`
responses. The state machine consumes the same files through
`has_open_issues`/`no_open_issues` conditions, so this surface is the
agent-facing write path for review gating.

## Requirements

### Requirement: iss-1 — Scoping and issue-file resolution: operation scope fields
THE service SHALL scope every issue operation by `project`, `quest_type` (`main`|`side`), `quest_number` (non-negative integer), a quest-relative `issue_file`, and an optional `experiment_id`.

#### Scenario: Valid scope provided
- **WHEN** an issue operation is received with `project`, `quest_type`, `quest_number`, and `issue_file` all provided
- **THEN** the service scopes the operation to that combination

#### Scenario: experiment_id provided
- **WHEN** an issue operation includes `experiment_id`
- **THEN** the service includes it as part of the operation scope

### Requirement: iss-2 — Scoping and issue-file resolution: invalid issue_file rejected
IF `issue_file` is missing, absolute, contains `..`, does not end in `_issues.md`, or does not match any issue declaration in the quest's workflow, THEN THE service SHALL reject the request with HTTP 400 and a `{"error", "fields"}` body.

#### Scenario: issue_file missing
- **WHEN** a request arrives with no `issue_file`
- **THEN** the service responds 400 with `{"error", "fields"}`

#### Scenario: issue_file absolute or contains ..
- **WHEN** a request arrives with an `issue_file` that is absolute or contains `..`
- **THEN** the service responds 400 with `{"error", "fields"}`

#### Scenario: issue_file does not end in _issues.md
- **WHEN** a request arrives with an `issue_file` that does not end in `_issues.md`
- **THEN** the service responds 400 with `{"error", "fields"}`

#### Scenario: issue_file not declared in workflow
- **WHEN** a request arrives with an `issue_file` that does not match any issue declaration in the quest's workflow
- **THEN** the service responds 400 with `{"error", "fields"}`

### Requirement: iss-3 — Scoping and issue-file resolution: issue_file matching rules
THE service SHALL match `issue_file` against workflow issue declarations either literally (e.g. `physicalplan_issues.md`) or via a `$active_child/<name>` declaration, which matches `<collection-child>/<name>` for any child directory of a declared collection (e.g. `slices/0001_api/polishing_issues.md`). Backslashes in `issue_file` are normalized to `/` before matching.

#### Scenario: Literal match
- **WHEN** `issue_file` matches a workflow declaration literally
- **THEN** the service resolves the issue file using that declaration

#### Scenario: $active_child match
- **WHEN** `issue_file` matches `<collection-child>/<name>` for a `$active_child/<name>` workflow declaration
- **THEN** the service resolves the issue file using that declaration

#### Scenario: Backslash normalization
- **WHEN** `issue_file` contains backslashes
- **THEN** they are normalized to `/` before matching

### Requirement: iss-4 — Scoping and issue-file resolution: experiment_id redirects to experiment checkout
WHERE `experiment_id` is supplied, THE service SHALL resolve the issue file inside the experiment checkout instead of the quest worktree (see [experiments](../quest-runner-experiments/spec.md)).

#### Scenario: experiment_id supplied
- **WHEN** `experiment_id` is supplied with an issue operation
- **THEN** the service resolves the issue file inside the experiment checkout instead of the quest worktree

### Requirement: iss-5 — Reading issues: GET /api/issues returns issue list
WHEN it receives `GET /api/issues` with valid scope query parameters, THE service SHALL respond 200 with `{"issues": [<issue>, ...]}` parsed from the issue file, in file order.

#### Scenario: GET /api/issues with valid scope
- **WHEN** `GET /api/issues` is received with valid scope query parameters
- **THEN** the service responds 200 with `{"issues": [<issue>, ...]}` in file order

### Requirement: iss-6 — Reading issues: status filter
WHERE the `status` query parameter is `open`, `completed`, or `all` (default `all` when absent or blank), THE service SHALL filter the list accordingly; IF `status` is any other value, THEN THE service SHALL respond 400.

#### Scenario: status=open
- **WHEN** `GET /api/issues` is received with `status=open`
- **THEN** the service returns only open issues

#### Scenario: status=completed
- **WHEN** `GET /api/issues` is received with `status=completed`
- **THEN** the service returns only completed issues

#### Scenario: status absent or blank
- **WHEN** `GET /api/issues` is received with `status` absent or blank
- **THEN** the service returns all issues (default `all`)

#### Scenario: invalid status value
- **WHEN** `GET /api/issues` is received with `status` set to an unrecognized value
- **THEN** the service responds 400

### Requirement: iss-7 — Reading issues: GET /api/issues/<issue_id> returns issue with responses
WHEN it receives `GET /api/issues/<issue_id>` for an existing issue, THE service SHALL respond 200 with the issue object plus a `responses` array containing that issue's responses in file order.

#### Scenario: GET /api/issues/<issue_id> for existing issue
- **WHEN** `GET /api/issues/<issue_id>` is received for an existing issue
- **THEN** the service responds 200 with the issue object and a `responses` array in file order

### Requirement: iss-8 — Creating and editing issues: POST /api/issues creates issue
WHEN it receives `POST /api/issues` with a non-empty `title` and non-empty `body` (after trimming), THE service SHALL append a new issue to the issue file and respond 201 with the issue object.

#### Scenario: POST /api/issues with valid title and body
- **WHEN** `POST /api/issues` is received with a non-empty `title` and non-empty `body`
- **THEN** the service appends a new issue to the issue file and responds 201 with the issue object

### Requirement: iss-9 — Creating and editing issues: issue id allocation
THE service SHALL allocate issue ids as `<id_prefix>-<NNNN>` — the workflow declaration's `id_prefix` plus a zero-padded 4-digit number one greater than the highest existing number in the file (starting at `0001`). Ids are never reused.

#### Scenario: First issue in file
- **WHEN** a new issue is created in an empty issue file
- **THEN** the allocated id is `<id_prefix>-0001`

#### Scenario: Subsequent issue
- **WHEN** a new issue is created and the highest existing number is N
- **THEN** the allocated id is `<id_prefix>-<N+1>` (zero-padded to 4 digits)

### Requirement: iss-10 — Creating and editing issues: owner_role recorded on creation
THE service SHALL record `owner_role` on each created issue: the request's `owner_role` (API) / `--owner` (CLI) when supplied, otherwise the `owner` of the matching workflow issue declaration.

#### Scenario: owner_role supplied in request
- **WHEN** a create request supplies `owner_role`
- **THEN** the issue is recorded with that `owner_role`

#### Scenario: owner_role not supplied
- **WHEN** a create request does not supply `owner_role`
- **THEN** the issue is recorded with the `owner` from the matching workflow issue declaration

### Requirement: iss-11 — Creating and editing issues: timestamps
THE service SHALL set `created_at` and `updated_at` to the current UTC time (`YYYY-MM-DDTHH:MM:SSZ`) on creation, and refresh `updated_at` on every edit.

#### Scenario: Issue created
- **WHEN** a new issue is created
- **THEN** `created_at` and `updated_at` are set to the current UTC time in `YYYY-MM-DDTHH:MM:SSZ` format

#### Scenario: Issue edited
- **WHEN** an issue is edited
- **THEN** `updated_at` is refreshed to the current UTC time

### Requirement: iss-12 — Creating and editing issues: PATCH /api/issues/<issue_id> applies partial update
WHEN it receives `PATCH /api/issues/<issue_id>`, THE service SHALL apply only the provided fields (`status`, `title`, `body`) to the issue and respond 200 with the updated issue object. Closing an issue is `PATCH` with `"status": "completed"`.

#### Scenario: PATCH with provided fields
- **WHEN** `PATCH /api/issues/<issue_id>` is received with any subset of `status`, `title`, `body`
- **THEN** the service applies only those fields and responds 200 with the updated issue object

#### Scenario: Closing an issue
- **WHEN** `PATCH /api/issues/<issue_id>` is received with `"status": "completed"`
- **THEN** the issue is closed

### Requirement: iss-13 — Creating and editing issues: validation on create or edit
IF a create or edit supplies `status` outside `{open, completed}`, or a `title`/`body` that is empty after trimming, THEN THE service SHALL respond 400 without modifying the file.

#### Scenario: Invalid status value on create or edit
- **WHEN** a create or edit request supplies `status` outside `{open, completed}`
- **THEN** the service responds 400 without modifying the file

#### Scenario: Empty title or body after trimming
- **WHEN** a create or edit request supplies a `title` or `body` that is empty after trimming
- **THEN** the service responds 400 without modifying the file

### Requirement: iss-14 — Responses: POST /api/issues/<issue_id>/responses appends response
WHEN it receives `POST /api/issues/<issue_id>/responses` with `outcome` in `{Fixed, NotFixed}` and a non-empty `explanation`, THE service SHALL append a response entry (with the current UTC timestamp) to the sibling responses file and respond 201 with `{"response": <response>, "issue": <issue>}`. Responding never changes the issue's `status`.

#### Scenario: POST /api/issues/<issue_id>/responses with valid outcome and explanation
- **WHEN** `POST /api/issues/<issue_id>/responses` is received with `outcome` in `{Fixed, NotFixed}` and a non-empty `explanation`
- **THEN** the service appends a response entry (with the current UTC timestamp) to the sibling responses file and responds 201 with `{"response": <response>, "issue": <issue>}`

#### Scenario: Issue status unchanged after response
- **WHEN** a response is posted to an issue
- **THEN** the issue's `status` is not changed

### Requirement: iss-15 — Responses: response file naming
THE service SHALL store responses in a file derived from the issue file name by replacing the `_issues.md` suffix with `_issue_responses.md` (e.g. `physicalplan_issues.md` → `physicalplan_issue_responses.md`), in the same directory.

#### Scenario: Response file derivation
- **WHEN** a response is stored for an issue file named `<name>_issues.md`
- **THEN** it is written to `<name>_issue_responses.md` in the same directory

### Requirement: iss-16 — Responses: GET /api/issues/<issue_id>/responses returns responses
WHEN it receives `GET /api/issues/<issue_id>/responses` for an existing issue, THE service SHALL respond 200 with `{"responses": [<response>, ...]}` filtered to that issue.

#### Scenario: GET /api/issues/<issue_id>/responses for existing issue
- **WHEN** `GET /api/issues/<issue_id>/responses` is received for an existing issue
- **THEN** the service responds 200 with `{"responses": [<response>, ...]}` filtered to that issue

### Requirement: iss-17 — Errors: issue_id format and existence checks
IF an `issue_id` does not match `<id_prefix>-NNNN` (exactly four digits) for the resolved issue file's prefix, THEN THE service SHALL respond 400; IF it is well-formed but not present in the file, THEN THE service SHALL respond 404 with `{"error": "Issue not found: <issue_id>"}`.

#### Scenario: Malformed issue_id
- **WHEN** an `issue_id` does not match `<id_prefix>-NNNN` (exactly four digits)
- **THEN** the service responds 400

#### Scenario: Well-formed but missing issue_id
- **WHEN** an `issue_id` is well-formed but not present in the file
- **THEN** the service responds 404 with `{"error": "Issue not found: <issue_id>"}`

### Requirement: iss-18 — Errors: missing or invalid scope fields in POST/PATCH
IF a POST/PATCH body omits any of `project`, `quest_type`, `quest_number`, or `issue_file`, THEN THE service SHALL respond 400 with `{"error": "Missing required fields: [...]", "fields": {...}}`; IF `quest_number` is not a non-negative integer, THEN THE service SHALL respond 400.

#### Scenario: Missing required scope field
- **WHEN** a POST/PATCH body omits any of `project`, `quest_type`, `quest_number`, or `issue_file`
- **THEN** the service responds 400 with `{"error": "Missing required fields: [...]", "fields": {...}}`

#### Scenario: quest_number not a non-negative integer
- **WHEN** a POST/PATCH body supplies `quest_number` as a value that is not a non-negative integer
- **THEN** the service responds 400

### Requirement: iss-19 — Errors: quest not found
IF the quest does not exist, THEN THE service SHALL respond 404 with `{"error": ...}`.

#### Scenario: Quest does not exist
- **WHEN** a request references a quest that does not exist
- **THEN** the service responds 404 with `{"error": ...}`

### Requirement: iss-20 — CLI: subcommands and required flags
THE CLI SHALL provide `issues list`, `issues read <issue_id>`, `issues create`, `issues edit <issue_id>`, `issues respond <issue_id>`, and `issues responses <issue_id>`, each requiring `--project`, `--type`, `--number`, and `--file`, and accepting `--experiment-id`; the commands map onto the endpoints above (see Contracts).

#### Scenario: CLI subcommand invoked with required flags
- **WHEN** any CLI issues subcommand is invoked with `--project`, `--type`, `--number`, and `--file`
- **THEN** the command maps to the corresponding API endpoint

#### Scenario: --experiment-id accepted
- **WHEN** a CLI issues subcommand is invoked with `--experiment-id`
- **THEN** it is passed through to the service

### Requirement: iss-21 — CLI: long text from files
THE CLI SHALL accept long text from files: `--body-file` (create/edit) and `--explanation-file` (respond) read the value from a file and are mutually exclusive with `--body`/`--explanation`.

#### Scenario: --body-file used on create or edit
- **WHEN** `issues create` or `issues edit` is invoked with `--body-file <path>`
- **THEN** the body is read from that file

#### Scenario: --explanation-file used on respond
- **WHEN** `issues respond` is invoked with `--explanation-file <path>`
- **THEN** the explanation is read from that file

#### Scenario: --body-file and --body mutually exclusive
- **WHEN** both `--body-file` and `--body` are supplied
- **THEN** the CLI treats them as mutually exclusive

### Requirement: iss-22 — CLI: client-side validation errors exit 2
IF CLI arguments fail client-side validation (invalid `--status`/`--outcome` value, missing or conflicting `--body`/`--body-file` or `--explanation`/`--explanation-file`, `issues edit` with none of `--status`/`--title`/`--body`/`--body-file`, unreadable `--*-file`), THEN THE CLI SHALL print `error: <message>` to stderr and exit 2 without sending a request.

#### Scenario: Invalid --status or --outcome value
- **WHEN** an invalid value is supplied for `--status` or `--outcome`
- **THEN** the CLI prints `error: <message>` to stderr and exits 2 without sending a request

#### Scenario: Missing or conflicting text-source flags
- **WHEN** `--body`/`--body-file` or `--explanation`/`--explanation-file` are missing or both supplied
- **THEN** the CLI prints `error: <message>` to stderr and exits 2 without sending a request

#### Scenario: issues edit with no change flag
- **WHEN** `issues edit` is invoked with none of `--status`/`--title`/`--body`/`--body-file`
- **THEN** the CLI prints `error: <message>` to stderr and exits 2 without sending a request

#### Scenario: Unreadable --*-file
- **WHEN** a `--*-file` path cannot be read
- **THEN** the CLI prints `error: <message>` to stderr and exits 2 without sending a request

### Requirement: iss-23 — CLI: success output and exit code
WHEN a request succeeds (2xx), THE CLI SHALL exit 0 and print a human-readable rendering (tables for `list`/`responses`, labeled fields for the rest), or the raw JSON body when `--json` is set.

#### Scenario: Successful request, human output
- **WHEN** a request succeeds and `--json` is not set
- **THEN** the CLI exits 0 and prints a human-readable rendering

#### Scenario: Successful request with --json
- **WHEN** a request succeeds and `--json` is set
- **THEN** the CLI exits 0 and prints the raw JSON body

### Requirement: iss-24 — CLI: error output and exit codes on failure
IF the service responds with a non-2xx status, THEN THE CLI SHALL print `HTTP <status> <endpoint>` and `error: <message>` to stderr (plus the JSON body when `--json` is set) and exit 1; IF the service is unreachable, THEN THE CLI SHALL print `transport error: ...` and exit 1.

#### Scenario: Service responds non-2xx
- **WHEN** the service responds with a non-2xx status
- **THEN** the CLI prints `HTTP <status> <endpoint>` and `error: <message>` to stderr and exits 1

#### Scenario: --json set on non-2xx
- **WHEN** the service responds non-2xx and `--json` is set
- **THEN** the CLI also prints the JSON body to stderr and exits 1

#### Scenario: Service unreachable
- **WHEN** the service is unreachable
- **THEN** the CLI prints `transport error: ...` and exits 1

## Contracts

### Issue object (JSON)

Returned by list entries, `GET`/`POST`/`PATCH` of a single issue, and the
`issue` member of a respond result:

```json
{
  "issue_id": "QP-0001",
  "status": "open",
  "owner_role": "physical_plan_reviewer",
  "created_at": "2026-06-09T12:00:00Z",
  "updated_at": "2026-06-09T12:00:00Z",
  "title": "Plan misses error handling",
  "body": "Details...",
  "details": "Details...",
  "resolution_notes": null
}
```

`body` and `details` always carry the same value (`details` is the legacy
key). `resolution_notes` is `null` unless present in the issue file. For the
on-disk markdown format of issue and response files, see
[runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md).

### Response object (JSON)

```json
{
  "issue_id": "QP-0001",
  "response_timestamp": "2026-06-09T12:05:00Z",
  "outcome": "Fixed",
  "explanation": "Reworked the plan section."
}
```

### Endpoints

Common scope — GET endpoints take query parameters, POST/PATCH endpoints take
the same keys in the JSON body: `project` (string), `quest_type`
(`main`|`side`), `quest_number` (integer), `issue_file` (quest-relative
string), `experiment_id` (optional string).

| Endpoint | Success | Body / extra parameters |
|---|---|---|
| `GET /api/issues` | 200 `{"issues": [...]}` | `status=open\|completed\|all` (default `all`) |
| `POST /api/issues` | 201 `<issue>` | `title` (required), `body` (or legacy `details`; required), `status` (default `"open"`), `owner_role` (optional) |
| `GET /api/issues/<issue_id>` | 200 `<issue>` + `"responses": [...]` | — |
| `PATCH /api/issues/<issue_id>` | 200 `<issue>` | any of `status`, `title`, `body` (or legacy `details`) |
| `POST /api/issues/<issue_id>/responses` | 201 `{"response": <response>, "issue": <issue>}` | `outcome` (`Fixed`\|`NotFixed`), `explanation` (required) |
| `GET /api/issues/<issue_id>/responses` | 200 `{"responses": [...]}` | — |

Error bodies: 400 → `{"error": "<message>", "fields": {"<field>": "required"|"invalid"|"undeclared"}}`
(`fields` omitted when empty); 404 → `{"error": "<message>"}`.

### CLI commands

Global flags (before the subcommand): `--base-url <url>` overrides the
service URL, `--json` prints raw JSON bodies. Shared per-command flags:
`--project <p> --type main|side --number <n> --file <quest-relative path>`
and optional `--experiment-id <id>`.

```text
issues list      [--status open|completed|all]      # default all
issues read      <issue_id>
issues create    --title <t> (--body <b> | --body-file <path>)
                 [--status open|completed] [--owner <role>]
issues edit      <issue_id> [--status open|completed] [--title <t>]
                 [--body <b> | --body-file <path>]    # at least one change flag
issues respond   <issue_id> --outcome Fixed|NotFixed
                 (--explanation <e> | --explanation-file <path>)
issues responses <issue_id>
```

Human output: `list` prints an `ID  STATUS  TITLE` table (`(none)` when
empty); `read`/`create`/`edit` print `issue_id`, `status`, `title`,
`owner_role`, `created_at`, `updated_at` field lines and an indented `body:`
block (`read` appends a `responses:` table when responses exist); `respond`
prints the response fields then the refreshed issue; `responses` prints a
`TIMESTAMP  OUTCOME  EXPLANATION` table. Exit codes: 0 success, 1 HTTP or
transport failure, 2 client-side validation/usage error.

### Ownership semantics

Each workflow issue declaration carries `path`, `owner`, and `id_prefix`
(two uppercase ASCII letters in workflow version 1 — see
[workflow-config](../quest-runner-workflow-config/spec.md)). The declaration determines which file
each id prefix lives in and which role owns the issue list. The division of
labor, enforced by role prompts rather than by the API:

- The owner (reviewer) role — e.g. `physical_plan_reviewer`,
  `polisher_reviewer`, `integration_tester` in the default workflow — creates
  issues and is the only role that closes them
  (`issues edit <id> --status completed`).
- Responder roles — e.g. `physical_planner`, `polisher`,
  `integration_test_polisher` — record `issues respond --outcome
  Fixed|NotFixed` and never change issue status.

The API itself performs no authentication or role-based authorization; any
caller may invoke any operation. `owner_role` is recorded attribution, not an
access-control check.

## Design

- `src/quest_runner_service/issue_service.py` — core module:
  `parse_issue_file` (path validation), `_match_issue_declaration` /
  `_find_matching_declaration` (workflow declaration matching, including the
  `$active_child/` pattern against collection path prefixes),
  `resolve_issue_context_by_file` (builds an `IssueContext` carrying resolved
  paths, `id_prefix`, `owner_role`, and lock key), `list_issues`, `get_issue`,
  `create_issue`, `edit_issue`, `respond_to_issue`, `list_responses`,
  `_next_issue_id`.
- `src/quest_runner_service/quest_service.py` — `QuestService.list_issues` /
  `get_issue` / `create_issue` / `edit_issue` / `respond_to_issue` /
  `list_issue_responses` wrap the core with project validation, experiment
  checkout resolution, and an in-process metadata mutation lock
  (`_acquire_issue_mutation_lock`) that serializes mutations against other
  metadata writes in the same service process; the lock is skipped when the
  quest worktree is missing.
- `src/quest_runner_service/api.py` — Flask routes (`/api/issues...`) and the
  error-handler mapping: `DashboardBadRequest` → 400, `IssueNotFound` /
  `QuestNotFound` / `DashboardNotFound` → 404.
- `src/quest_runner_service/cli.py` — argparse subcommands (`issues_*`
  handlers), `_read_text_source` for `--*-file` flags, `_format_issue` /
  `_format_issue_list` / `_format_responses_list` / `_format_respond`
  renderers, and `resolve_base_url` (precedence: `--base-url` >
  `QUEST_RUNNER_URL` env > `config/services.json` entry named `quest-runner`
  > fallback `http://localhost:9002` with a stderr warning).
- `src/quest_runner_service/quest_fs.py` — `read_issues`, `write_issues`,
  `read_issue_responses`, `append_issue_response` implement the markdown
  serialization specified in [runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md).
- `src/quest_runner_service/quest_types.py` — `IssueEntry`,
  `IssueResponseEntry`, `utc_now_iso`.
- Issue id validation runs before lookup, so a malformed id is a 400 even when
  no issue exists; a missing `responses` file reads as an empty list rather
  than an error.
- Tests: `tests/` under `projects/quest-runner` (e.g. issue service and CLI
  test modules) exercise these flows.

## Interactions

- [workflow-config](../quest-runner-workflow-config/spec.md) — issue declarations (`path`,
  `owner`, `id_prefix`) define which files this capability may operate on and
  the default owner role.
- [state-machine-engine](../quest-runner-state-machine-engine/spec.md) — `has_open_issues` /
  `no_open_issues` transition conditions read the same issue files; closing
  the last open issue is what lets review states advance.
- [experiments](../quest-runner-experiments/spec.md) — `experiment_id` redirects all operations to
  the experiment checkout; landing an experiment archives issue and response
  files.
- [agent-harness](../quest-runner-agent-harness/spec.md) — role prompts instruct agents to use this
  CLI instead of editing issue markdown directly.
- [dashboard](../quest-runner-dashboard/spec.md) — renders issue lists read from the same files.
- [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md) — quest creation scaffolds the
  quest-level issue files this capability writes to.
- [service-lifecycle](../quest-runner-service-lifecycle/spec.md) — the HTTP service hosting these
  endpoints; the CLI resolves its base URL from `config/services.json`.
- [Runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md) — on-disk markdown format of
  `*_issues.md` and `*_issue_responses.md`.
