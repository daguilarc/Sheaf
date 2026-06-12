# Capability: Slices

Project: `projects/quest-runner`
ID prefix: `sl` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Slice initialization turns a physical plan into numbered child work
directories inside a quest checkout. The physical planner role (or a human)
calls `POST /api/slices/init` or `scripts/quest-runner slices init` with an
ordered list of slugs; the service creates `NNNN_slug` directories under the
workflow collection's path (default `slices/`) and runs the collection's
scaffold actions in each, so the state-machine engine can later iterate the
children in execution order.

## Requirements

### Requirement: sl-1 — Create slice directories on POST

WHEN it receives `POST /api/slices/init` with valid `project`, `quest_type`, `quest_number`, `count`, and `slugs`, THE service SHALL create one child directory per slug under the resolved collection's parent directory inside the quest checkout and respond 201 with the result body (see Contracts).

#### Scenario: Valid init request

- **WHEN** `POST /api/slices/init` is received with valid `project`, `quest_type`, `quest_number`, `count`, and `slugs`
- **THEN** the service creates one child directory per slug under the resolved collection's parent directory inside the quest checkout and responds 201 with the result body

### Requirement: sl-2 — Numbered directory naming

THE service SHALL name each created directory `<NNNN>_<slug>` where `NNNN` is a zero-padded 4-digit number; numbering starts at the highest existing numbered child directory plus one (or `0001` when none exist) and assigns consecutive numbers to the slugs in the order they were supplied, so lexical directory order equals the requested execution order. A child directory counts as numbered when its first four characters are digits, regardless of the rest of the name.

#### Scenario: No existing numbered children

- **WHEN** no existing numbered child directories are present
- **THEN** numbering starts at `0001` and each directory is named `<NNNN>_<slug>` in slug order

#### Scenario: Existing numbered children present

- **WHEN** existing numbered child directories are present
- **THEN** numbering starts at the highest existing number plus one and assigns consecutive numbers in slug order, preserving lexical execution order

### Requirement: sl-3 — Slug normalization

THE service SHALL normalize each slug before use: lowercase; whitespace and hyphens become underscores; characters outside `[a-z0-9_]` are dropped; underscore runs collapse; leading/trailing underscores are stripped.

#### Scenario: Slug normalization applied

- **WHEN** a slug is supplied in the request
- **THEN** it is lowercased, whitespace and hyphens become underscores, characters outside `[a-z0-9_]` are dropped, underscore runs collapse, and leading/trailing underscores are stripped before use

### Requirement: sl-4 — Scaffold actions executed per slice

THE service SHALL execute the resolved collection's `scaffold` actions inside each created directory and report the resulting slice-relative entries (no trailing slashes) as `created_files` in declaration order. With the default workflow this creates `physicalplan/`, `state.md` (state `NotStarted`), `state_history.md`, `polishing_issues.md`, and `notes/` (layout: [runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md)).

#### Scenario: Scaffold actions executed

- **WHEN** a slice directory is created
- **THEN** the collection's `scaffold` actions are executed inside it and the resulting slice-relative entries (no trailing slashes) are reported as `created_files` in declaration order

### Requirement: sl-5 — Collection resolution and 400 errors

WHERE the workflow declares exactly one collection, THE service SHALL use it when no `collection` is supplied; IF `collection` names an unknown collection, or is omitted while the workflow declares zero or several collections, THEN THE service SHALL respond 400 with the messages in the error catalogue (see Contracts).

#### Scenario: Single collection, none supplied

- **WHEN** the workflow declares exactly one collection and `collection` is not supplied
- **THEN** the service uses that single collection

#### Scenario: Unknown collection named

- **WHEN** `collection` names an unknown collection
- **THEN** the service responds 400 with the error catalogue message

#### Scenario: Collection omitted, zero or several declared

- **WHEN** `collection` is omitted and the workflow declares zero or several collections
- **THEN** the service responds 400 with the error catalogue message

### Requirement: sl-6 — Missing required fields 400

IF the request body omits any of `project`, `quest_type`, `quest_number`, `count`, or `slugs`, THEN THE service SHALL respond 400 with `{"error": "Missing required fields: [...]"}`.

#### Scenario: Required field missing

- **WHEN** the request body omits any of `project`, `quest_type`, `quest_number`, `count`, or `slugs`
- **THEN** the service responds 400 with `{"error": "Missing required fields: [...]"}`

### Requirement: sl-7 — Invalid count/slugs 400

IF `count` is not a positive integer, `slugs` is not an array, `len(slugs) != count`, a slug is not a non-empty string, a slug normalizes to the empty string, or two slugs normalize to the same value, THEN THE service SHALL respond 400 without creating anything.

#### Scenario: Invalid count or slugs shape

- **WHEN** `count` is not a positive integer, `slugs` is not an array, `len(slugs) != count`, a slug is not a non-empty string, a slug normalizes to the empty string, or two slugs normalize to the same value
- **THEN** the service responds 400 without creating anything

### Requirement: sl-8 — Conflict and rollback on failure

IF a target directory name already exists, THEN THE service SHALL respond 409 with `{"error": "Slice directory already exists: <name>"}` and create nothing; IF any scaffold action fails partway, THEN THE service SHALL remove the directories it created in this request before propagating the error.

#### Scenario: Target directory already exists

- **WHEN** a target directory name already exists
- **THEN** the service responds 409 with `{"error": "Slice directory already exists: <name>"}` and creates nothing

#### Scenario: Scaffold action fails partway

- **WHEN** any scaffold action fails partway through execution
- **THEN** the service removes the directories it created in this request before propagating the error

### Requirement: sl-9 — Append when slices already exist

WHEN slices are initialized again on a quest that already has slice directories, THE service SHALL append the new directories after the existing ones (numbering continues; existing slices are never renamed or modified).

#### Scenario: Re-initialization on quest with existing slices

- **WHEN** slices are initialized again on a quest that already has slice directories
- **THEN** the new directories are appended after the existing ones with numbering continuing; existing slices are never renamed or modified

### Requirement: sl-10 — Quest not found and missing worktree errors

IF the quest does not exist, THEN THE service SHALL respond 404; IF the quest (or experiment) checkout worktree is missing, THEN THE service SHALL respond 409 with the missing-worktree body (see Contracts).

#### Scenario: Quest not found

- **WHEN** the quest does not exist
- **THEN** the service responds 404

#### Scenario: Checkout worktree missing

- **WHEN** the quest or experiment checkout worktree is missing
- **THEN** the service responds 409 with the missing-worktree body

### Requirement: sl-11 — Experiment-scoped initialization

WHERE `experiment_id` is supplied, THE service SHALL create the slices inside that experiment's checkout and require the experiment to be open (see [experiments](../quest-runner-experiments/spec.md)); the response then includes `"experiment_id"`.

#### Scenario: Experiment-scoped request

- **WHEN** `experiment_id` is supplied
- **THEN** the service creates slices inside that experiment's checkout, requires the experiment to be open, and includes `"experiment_id"` in the response

### Requirement: sl-12 — CLI slices init command

THE CLI SHALL provide `slices init --project <p> --type main|side --number <n> --count <c> --slug <s>...` (repeat `--slug` once per slice, in execution order) with optional `--collection <name>` and `--experiment-id <id>`; it posts to `/api/slices/init`.

#### Scenario: CLI slices init invoked

- **WHEN** `slices init` is invoked with the required flags
- **THEN** the CLI posts to `/api/slices/init` with optional `--collection` and `--experiment-id` when provided

### Requirement: sl-13 — CLI client-side validation

IF `--count` is less than 1, THEN THE CLI SHALL print an `error:` line containing `--count must be a positive integer` to stderr and exit 2 without sending a request; IF the number of `--slug` flags does not equal `--count`, THEN THE CLI SHALL print an `error:` line containing `--slug must be provided exactly --count times` to stderr and exit 2 without sending a request.

#### Scenario: --count less than 1

- **WHEN** `--count` is less than 1
- **THEN** the CLI prints an `error:` line containing `--count must be a positive integer` to stderr and exits 2 without sending a request

#### Scenario: --slug count mismatch

- **WHEN** the number of `--slug` flags does not equal `--count`
- **THEN** the CLI prints an `error:` line containing `--slug must be provided exactly --count times` to stderr and exits 2 without sending a request

### Requirement: sl-14 — CLI success and failure output

WHEN the request succeeds, THE CLI SHALL exit 0 and print the quest identity fields followed by a `created_slices:` table with columns `NUMBER`, `DIRECTORY`, `PATH` (or the raw JSON body when `--json` is set); IF the service responds non-2xx, THEN THE CLI SHALL print `HTTP <status> /api/slices/init` and `error: <message>` to stderr and exit 1.

#### Scenario: Request succeeds

- **WHEN** the request succeeds
- **THEN** the CLI exits 0 and prints the quest identity fields followed by a `created_slices:` table with columns `NUMBER`, `DIRECTORY`, `PATH` (or the raw JSON body when `--json` is set)

#### Scenario: Service responds non-2xx

- **WHEN** the service responds non-2xx
- **THEN** the CLI prints `HTTP <status> /api/slices/init` and `error: <message>` to stderr and exits 1

### Requirement: sl-15 — Init accepted while run lock held

WHILE a quest run is in progress (the run lock is held), THE service SHALL still accept and execute `slices/init` for that quest; slice-init mutations serialize on the metadata mutation lock, not the run lock.

#### Scenario: Quest run in progress

- **WHEN** a quest run is in progress and the run lock is held
- **THEN** the service still accepts and executes `slices/init` for that quest, serializing mutations on the metadata mutation lock

### Requirement: sl-16 — CLI omits unset optional flags from request body

WHEN building the request body, THE CLI SHALL omit `collection` and `experiment_id` entirely when the flags are not supplied (they are never sent as null).

#### Scenario: Optional flags not supplied

- **WHEN** `--collection` and `--experiment-id` are not supplied
- **THEN** `collection` and `experiment_id` are omitted entirely from the request body and never sent as null

## Contracts

### `POST /api/slices/init`

Request body:

```json
{
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 3,
  "count": 2,
  "slugs": ["rest_api", "cli"],
  "collection": "slices",
  "experiment_id": "experiment_quest-runner_main_3_0"
}
```

`collection` and `experiment_id` are optional. `count` must equal
`len(slugs)`.

Success response — 201:

```json
{
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 3,
  "quest_slug": "file_server",
  "quest_dir": "/abs/path/to/quest/dir",
  "checkout_kind": "worktree",
  "checkout_path": "/abs/path/to/checkout",
  "collection": "slices",
  "created_slices": [
    {
      "slice_number": 1,
      "slice_slug": "rest_api",
      "directory_name": "0001_rest_api",
      "slice_dir": "/abs/path/.../slices/0001_rest_api",
      "created_files": [
        "physicalplan",
        "state.md",
        "state_history.md",
        "polishing_issues.md",
        "notes"
      ]
    }
  ]
}
```

`experiment_id` is added when the request was experiment-scoped.

Missing-worktree response — 409:

```json
{
  "error": "<message>",
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 3,
  "expected_worktree": "/abs/path/to/expected/worktree"
}
```

### Error catalogue

| Condition | Status / exit | Message (exact or pinned substring) |
|---|---|---|
| Required body field absent | 400 | `Missing required fields: [...]` |
| Invalid count/slugs shape, empty/duplicate normalized slug | 400 | `{"error": "<message>"}` |
| Unknown `collection` name | 400 | contains `Unknown workflow collection '<name>'` |
| `collection` omitted, several declared | 400 | contains `workflow declares multiple collections`, `pass --collection`, and the sorted collection names |
| `collection` omitted, none declared | 400 | contains `workflow declares no collections` |
| Quest not found | 404 | `{"error": "<message>"}` |
| Checkout worktree missing | 409 | missing-worktree body above |
| Target directory exists | 409 | `Slice directory already exists: <name>` |
| CLI: `--count` < 1 | exit 2 | `error:` line containing `--count must be a positive integer` |
| CLI: slug/count mismatch | exit 2 | `error:` line containing `--slug must be provided exactly --count times` |
| CLI: HTTP/transport failure | exit 1 | `HTTP <status> /api/slices/init` + `error: <message>` |

### CLI

```text
quest-runner [--base-url <url>] [--json] slices init
  --project <p> --type main|side --number <n>
  --count <c> --slug <s> [--slug <s> ...]
  [--collection <name>] [--experiment-id <id>]
```

Human output: `project`, `quest_type`, `quest_number`, `quest_dir` field
lines, then `created_slices:` and a `NUMBER  DIRECTORY  PATH` table. Exit
codes: 0 success, 1 HTTP/transport failure, 2 client-side validation error.

Slice directory layout and the meaning of the scaffolded files are specified
in [runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md).

## Design

- `src/quest_runner_service/quest_service.py` —
  `QuestService.initialize_slices`: input validation, slug normalization
  (`normalize_slug`), mutable-scope resolution
  (`_resolve_mutable_quest_scope`, which raises `QuestNotFound` /
  `MissingQuestWorktree` and requires an open experiment when
  `experiment_id` is set), a workflow auto-upgrade pass
  (`_ensure_quest_workflow_upgraded`), numbering, directory creation, and
  rollback (`shutil.rmtree` of created dirs on scaffold failure). Mutations
  run under the in-process metadata mutation lock.
- `src/quest_runner_service/workflow_scaffold.py` —
  `resolve_workflow_collection` (single-collection default, error text
  listing names when ambiguous), `collection_parent_dir` (the collection
  `path` prefix before `*`, e.g. `slices/* → <quest_dir>/slices`, created
  with `mkdir(parents=True)`), `build_child_scaffold_context`, and
  `execute_scaffold_actions` (runs each action via the state-machine action
  executor and reports `ensure_dir`/`ensure_file` paths as `created_files`).
- `src/quest_runner_service/api.py` — `initialize_slices_route` plus error
  handlers (`InvalidQuestInput` → 400, `QuestNotFound` → 404,
  `MissingQuestWorktree` and `SliceInitializationConflict` → 409).
- `src/quest_runner_service/cli.py` — `slices_init` handler (client-side
  count/slug validation) and `_format_slices_init` output renderer.
- Existing-child detection counts any subdirectory whose first four
  characters are digits, regardless of slug, so numbering is stable across
  collections that mix scaffolded and hand-created children.
- The conflict check for all target names happens before any directory is
  created, so a duplicate name fails the whole request atomically.

## Interactions

- [workflow-config](../quest-runner-workflow-config/spec.md) — collections (`path`, `machine`,
  `order`, `scaffold`) define where slices live and what gets scaffolded.
- [state-machine-engine](../quest-runner-state-machine-engine/spec.md) — the `physical_planner`
  role initializes slices during planning; the engine iterates collection
  children in lexical order and drives each slice's machine using the
  scaffolded `state.md`.
- [experiments](../quest-runner-experiments/spec.md) — experiment-scoped initialization targets the
  experiment worktree.
- [issues](../quest-runner-issues/spec.md) — the scaffolded `polishing_issues.md` is a
  workflow-declared issue file operated on through the issues surface.
- [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md) — slices are created inside the quest
  checkout established at quest creation.
- [dashboard](../quest-runner-dashboard/spec.md) — slice pages render the directories and files
  created here.
- [Runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md) — slice directory layout and
  scaffolded file formats.
