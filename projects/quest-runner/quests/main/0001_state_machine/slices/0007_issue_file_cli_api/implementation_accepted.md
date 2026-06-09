# Implementation Accepted: Slice 0007 Issue File CLI And API

## Verdict

Accepted. The slice implements `specs/04_issue_cli_changes.md` correctly and
completely. No open polishing issues.

## What was reviewed

Reviewed commit `0b5c781`, which contains the entire slice diff across
`issue_service.py`, `workflow_config.py`, `quest_service.py`, `api.py`,
`cli.py`, and the corresponding tests.

## Spec conformance

- **Issue addressed by file, not scope.** `parse_scope`, `parse_optional_slice`,
  `IssueScope`, and the scope-based `resolve_issue_context` are removed.
  `resolve_issue_context_by_file()` resolves a quest-relative `issue_file`
  against workflow-declared issue files.
- **Path rules enforced** (`parse_issue_file`): required, rejects absolute
  paths, rejects `..` escapes, and requires the `_issues.md` suffix.
- **Declaration matching.** Exact match for variable-free declarations;
  `$active_child/...` matches the file in any child of the collection,
  including inactive slices — preserving the old `--slice <n>` reach.
- **Undeclared files rejected** with field `issue_file: undeclared`.
- **Response file derivation** is deterministic: `_issues.md` →
  `_issue_responses.md` in the same directory; workflow does not declare
  response files.
- **id_prefix as workflow data.** `workflow_config.py` requires `id_prefix`
  on every issue declaration for workflow version 1 and validates it as two
  uppercase ASCII letters. Default workflow keeps `QP` / `PL`, so issue ids
  remain byte-compatible.
- **owner_role.** Optional `--owner` / `owner_role` recorded verbatim on
  create; otherwise defaults from the matched declaration's `owner`. Used as
  attribution metadata only, not for enforcement.
- **CLI/API surfaces.** All issue subcommands require `--file`; `--scope` and
  `--slice` are fully removed from the parser and help/examples (not hidden
  aliases). REST endpoints accept `issue_file` and optional `owner_role`;
  legacy `scope`/`slice` handling removed; bad requests mention `issue_file`.
- **Lock acquisition, experiment checkout, and markdown parsers reused** as
  specified.

## Test sufficiency

Coverage matches the spec's Validation Expectations:

- `test_issue_file_resolution.py` covers physical-plan and slice-polishing
  resolution, `$active_child` matching of an inactive slice, absolute-path and
  `..` rejection, undeclared and non-`_issues.md` rejection, default and
  override owner, `QP`/`PL` prefixes, response-file derivation, and the
  missing-`issue_file` 400.
- `test_cli.py` asserts every issue subcommand help advertises `--file` and no
  longer mentions `--scope`/`--slice`, plus request-encoding of `issue_file`.
- `test_experiment_scoped_operations.py` updated to the `issue_file` payloads.
- `test_workflow_profile_execution.py::test_default_preamble_uses_file_not_scope`
  guards the preamble against `--scope` regressions.

## Non-blocking observations (out of this slice's scope)

- The legacy `src/quest_runner_service/roles/*.md` files still contain
  `--scope` issue guidance. These files are **not loaded by any code path**
  (verified: no references in src/tests/config outside `dashboard_slice.py`,
  which uses unrelated role-name tuples). The spec scopes prompt updates to
  `default_workflow/prompts/` and `preamble.md`, both of which are correctly
  migrated to `--file`. The stale legacy copies are appropriately left for the
  legacy-runner cleanup work (slice 0008), not this slice.
- Environmental note (not a code defect): the running quest-runner HTTP service
  predates this slice and still expects `scope`, while the worktree CLI now
  sends `issue_file`, so the live issue CLI returns a 400 until the service is
  restarted with the new code. The slice's own CLI/API/service code is
  internally consistent.
