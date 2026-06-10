# Capability: Slices

ID prefix: `sl`

## Purpose

Slice initialization turns a physical plan into numbered child work
directories inside a quest checkout. The physical planner role (or a human)
calls `POST /api/slices/init` or `scripts/quest-runner slices init` with an
ordered list of slugs; the service creates `NNNN_slug` directories under the
workflow collection's path (default `slices/`) and runs the collection's
scaffold actions in each, so the state-machine engine can later iterate the
children in execution order.

## Requirements

- **[sl-1]** WHEN it receives `POST /api/slices/init` with valid `project`,
  `quest_type`, `quest_number`, `count`, and `slugs`, THE service SHALL create
  one child directory per slug under the resolved collection's parent
  directory inside the quest checkout and respond 201 with the result body
  (see Contracts).
- **[sl-2]** THE service SHALL name each created directory
  `<NNNN>_<slug>` where `NNNN` is a zero-padded 4-digit number; numbering
  starts at the highest existing numbered child directory plus one
  (or `0001` when none exist) and assigns consecutive numbers to the slugs in
  the order they were supplied, so lexical directory order equals the
  requested execution order. A child directory counts as numbered when its
  first four characters are digits, regardless of the rest of the name.
- **[sl-3]** THE service SHALL normalize each slug before use: lowercase;
  whitespace and hyphens become underscores; characters outside `[a-z0-9_]`
  are dropped; underscore runs collapse; leading/trailing underscores are
  stripped.
- **[sl-4]** THE service SHALL execute the resolved collection's `scaffold`
  actions inside each created directory and report the resulting
  slice-relative entries (no trailing slashes) as `created_files` in
  declaration order. With the
  default workflow this creates `physicalplan/`, `state.md` (state
  `NotStarted`), `state_history.md`, `polishing_issues.md`, and `notes/`
  (layout: [runtime files](../contracts/runtime-files.md)).
- **[sl-5]** WHERE the workflow declares exactly one collection, THE service
  SHALL use it when no `collection` is supplied; IF `collection` names an
  unknown collection, or is omitted while the workflow declares zero or
  several collections, THEN THE service SHALL respond 400 with the messages in
  the error catalogue (see Contracts).
- **[sl-6]** IF the request body omits any of `project`, `quest_type`,
  `quest_number`, `count`, or `slugs`, THEN THE service SHALL respond 400 with
  `{"error": "Missing required fields: [...]"}`.
- **[sl-7]** IF `count` is not a positive integer, `slugs` is not an array,
  `len(slugs) != count`, a slug is not a non-empty string, a slug normalizes
  to the empty string, or two slugs normalize to the same value, THEN THE
  service SHALL respond 400 without creating anything.
- **[sl-8]** IF a target directory name already exists, THEN THE service SHALL
  respond 409 with `{"error": "Slice directory already exists: <name>"}` and
  create nothing; IF any scaffold action fails partway, THEN THE service SHALL
  remove the directories it created in this request before propagating the
  error.
- **[sl-9]** WHEN slices are initialized again on a quest that already has
  slice directories, THE service SHALL append the new directories after the
  existing ones (numbering continues; existing slices are never renamed or
  modified).
- **[sl-10]** IF the quest does not exist, THEN THE service SHALL respond 404;
  IF the quest (or experiment) checkout worktree is missing, THEN THE service
  SHALL respond 409 with the missing-worktree body (see Contracts).
- **[sl-11]** WHERE `experiment_id` is supplied, THE service SHALL create the
  slices inside that experiment's checkout and require the experiment to be
  open (see [experiments](experiments.md)); the response then includes
  `"experiment_id"`.
- **[sl-12]** THE CLI SHALL provide `slices init --project <p> --type
  main|side --number <n> --count <c> --slug <s>...` (repeat `--slug` once per
  slice, in execution order) with optional `--collection <name>` and
  `--experiment-id <id>`; it posts to `/api/slices/init`.
- **[sl-13]** IF `--count` is less than 1, THEN THE CLI SHALL print an
  `error:` line containing `--count must be a positive integer` to stderr and
  exit 2 without sending a request; IF the number of `--slug` flags does not
  equal `--count`, THEN THE CLI SHALL print an `error:` line containing
  `--slug must be provided exactly --count times` to stderr and exit 2 without
  sending a request.
- **[sl-14]** WHEN the request succeeds, THE CLI SHALL exit 0 and print the
  quest identity fields followed by a `created_slices:` table with columns
  `NUMBER`, `DIRECTORY`, `PATH` (or the raw JSON body when `--json` is set);
  IF the service responds non-2xx, THEN THE CLI SHALL print `HTTP <status>
  /api/slices/init` and `error: <message>` to stderr and exit 1.
- **[sl-15]** WHILE a quest run is in progress (the run lock is held), THE
  service SHALL still accept and execute `slices/init` for that quest;
  slice-init mutations serialize on the metadata mutation lock, not the run
  lock.
- **[sl-16]** WHEN building the request body, THE CLI SHALL omit `collection`
  and `experiment_id` entirely when the flags are not supplied (they are
  never sent as null).

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
in [runtime files](../contracts/runtime-files.md).

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

- [workflow-config](workflow-config.md) — collections (`path`, `machine`,
  `order`, `scaffold`) define where slices live and what gets scaffolded.
- [state-machine-engine](state-machine-engine.md) — the `physical_planner`
  role initializes slices during planning; the engine iterates collection
  children in lexical order and drives each slice's machine using the
  scaffolded `state.md`.
- [experiments](experiments.md) — experiment-scoped initialization targets the
  experiment worktree.
- [issues](issues.md) — the scaffolded `polishing_issues.md` is a
  workflow-declared issue file operated on through the issues surface.
- [quest-lifecycle](quest-lifecycle.md) — slices are created inside the quest
  checkout established at quest creation.
- [dashboard](dashboard.md) — slice pages render the directories and files
  created here.
- [Runtime files](../contracts/runtime-files.md) — slice directory layout and
  scaffolded file formats.
