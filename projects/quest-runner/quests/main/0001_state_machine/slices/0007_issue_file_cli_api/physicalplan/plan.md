# Slice 0007: Issue File CLI And API

## Objective

Remove workflow-specific issue scopes from the CLI, service, and issue resolver. Issue operations should address a quest-relative issue file declared by the workflow, with response files derived deterministically from that issue file path.

Expected outcome: `scripts/quest-runner issues ... --file <quest-relative path>` and REST API `issue_file` operate on workflow-declared issue files; `--scope`, `scope`, and `slice` are no longer compatibility paths in runner/service code.

## Key Files And Systems

- Modify `issue_service.py` to resolve issue context by file path and workflow declarations.
- Modify `quest_service.py` issue methods to accept `issue_file` and optional `owner_role`.
- Modify `api.py` issue endpoints to accept `issue_file` and `owner_role`.
- Modify `cli.py` issue subcommands to require `--file`.
- Update default workflow prompts and `preamble.md` if not already updated in slice 0001/0004.
- Tests:
  - `test_cli.py`
  - `test_issue_api.py`
  - `test_dashboard_api.py` only if API tests need payload updates; do not change dashboard UI code
  - new `test_issue_file_resolution.py`

## CLI Contract

All issue commands require `--file`:

```text
issues list --file physicalplan_issues.md
issues read QP-0001 --file physicalplan_issues.md
issues create --file physicalplan_issues.md --title ... --body ...
issues edit QP-0001 --file physicalplan_issues.md --status completed
issues respond QP-0001 --file slices/0001_foundation/polishing_issues.md --outcome Fixed --explanation ...
issues responses QP-0001 --file slices/0001_foundation/polishing_issues.md
```

`issues create` also accepts:

```text
--owner <name>
```

When omitted, owner defaults from the matching workflow issue declaration.

Remove `--scope` and `--slice` from the parser and help examples. They should not remain hidden aliases.

## API Contract

REST issue requests use:

```json
{
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 1,
  "issue_file": "physicalplan_issues.md",
  "owner_role": "physical_plan_reviewer"
}
```

`owner_role` is optional and only meaningful on create. When omitted, use declaration owner.

Remove legacy `scope` and `slice` request handling. Bad requests should mention `issue_file`, not scope.

## Issue File Path Rules

`issue_file` / `--file`:

- is required
- is interpreted relative to quest root
- must not be absolute
- must not escape quest root with `..`
- must resolve to a path matching a workflow-declared issue file
- may target any concrete child issue file matched by a declaration containing `$active_child`, regardless of which child is active

Matching examples for default workflow:

- Declaration `physicalplan_issues.md` matches exactly `physicalplan_issues.md`.
- Declaration `$active_child/polishing_issues.md` matches `slices/0001_foundation/polishing_issues.md`, `slices/0002_api/polishing_issues.md`, etc., for any child in the `slices` collection.

The resolver must not know the aliases `physical_plan` or `polishing` as built-in issue types. It may display workflow aliases as friendly metadata.

## Issue Entry And Response Behavior

Issue markdown format is unchanged.

`owner_role`:

- remains a field in each issue entry
- is attribution metadata only
- is written verbatim from `--owner` / `owner_role` when provided
- otherwise defaults from the matched workflow issue declaration's `owner`
- is not used for permission enforcement

Issue ids:

- Preserve current prefixes for default workflow files:
  - `QP` for `physicalplan_issues.md`
  - `PL` for `*/polishing_issues.md`
- Because prefixes are currently tied to removed issue scopes, store them as workflow issue declaration data:
  - `issues.physical_plan.id_prefix: QP`
  - `issues.polishing.id_prefix: PL`
- Validate `id_prefix` as two uppercase ASCII letters.
- Require `id_prefix` on every issue declaration in workflow version 1. This is the small schema addition needed to encode current issue ID behavior as data instead of Python scope logic.
- The default workflow must keep existing issue id formats byte-compatible.

Response files:

- Workflow does not declare them.
- Derive from issue file path in the same directory by replacing `_issues.md` with `_issue_responses.md`.
- Reject issue files not ending in `_issues.md` unless the workflow grammar is deliberately extended; the default workflow uses `_issues.md`.
- Store responses outside issue files as today.

## Existing APIs To Reuse

- Reuse issue markdown parsers/writers in `quest_fs.py`.
- Reuse lock acquisition in `quest_service._acquire_issue_mutation_lock()`.
- Reuse `DashboardCheckout` / experiment checkout resolution so issue operations still work in experiment worktrees with `--experiment-id`.
- Reuse existing issue response read/write functions.

## APIs To Extend Or Modify

- Replace `IssueScope`, `parse_scope()`, `parse_optional_slice()`, and scope-based `resolve_issue_context()` with:
  - `parse_issue_file(raw)`
  - `resolve_issue_context_by_file(source_root, project, quest_type, quest_number, issue_file, experiment_id, checkout)`
- Update `IssueContext` fields:
  - remove `scope` and `slice_number` as identity
  - add `issue_file`
  - add `workflow_issue_alias` if matched
  - keep `issues_path`, `responses_path`, `id_prefix`, `owner_role`, `lock_key`
- Service issue methods should accept `issue_file_raw` and optional `owner_role_raw`.
- CLI dispatch should send `issue_file` and `owner_role` to the service/API.

## Validation Expectations

- CLI parser tests assert all issue subcommands require `--file` and no longer mention `--scope` or `--slice`.
- Service/API tests cover:
  - physical plan issue list/read/create/edit/respond/responses by file
  - slice polishing issue operations by concrete slice file
  - `$active_child` declaration matches inactive slices
  - absolute path rejection
  - `..` escape rejection
  - undeclared issue file rejection
  - default owner from declaration
  - explicit owner override
  - response file derivation
  - default `QP` and `PL` id prefixes
- Prompt/preamble tests assert no remaining issue guidance tells agents to use `--scope`.
