# Slice 0004 Implementation Accepted

Reviewed the implementation of slice `0004_profile_harness_preamble_threads`
(commit `46cdcf4` plus polisher fixes in steps 25–26) against the slice plan and
specs `05_workflow_yaml_grammar.md` / `08_agent_preamble.md`.

## Verified

- **Profile execution migration** — `quest_v2_nodes` resolves `run.profile` /
  `run.task` from workflow machines, with service harness config and workflow
  thread templates; no role-name inference remains in the live execution path.
- **Message assembly** — `workflow_profile_execution.build_workflow_message_body`
  / `build_workflow_first_round_message` reproduce the spec ordering exactly
  (first round: profile prompt → `---` → preamble → `Task:` → task; later rounds:
  preamble → `Task:` → task).
- **Preamble** — default `workflow/preamble.md` matches spec 08 verbatim, uses
  `--file` (not `--scope`), and all six profiles expose
  `include_current_child_path` + `include_reference_docs_path`. Unknown-variable
  and toggle-gated `$reference_docs` behaviors are covered by tests.
- **Thread identity** — quest- and child-scoped `name_template` /
  `registry_key_template` reproduce current thread names and registry keys;
  `thread_registry.json` shape preserved.
- **Harness config** — moved to repo-root `config/quest-runner.json` with
  validation and empty-config fallback.

## Issues raised and resolved

- **PL-0001** (completed) — Superseded role-name runner helpers
  (`build_runtime_context`, `_issue_workflow_cli_summary`, `_ROLE_MAP`,
  `resolve_role`, `reviewer_commit_context`, `build_task_instruction`,
  `build_role_prompt`, `resolve_or_create_thread_spec`,
  `build_spec_thread_name`) were removed from runner code, satisfying spec 08's
  "must not survive as runner code" clause; the legacy tests that pinned the old
  formatting were removed/retargeted. Verified: no remaining references in
  `src/` or `tests/`; the only surviving `--scope` text is the CLI's own
  argument interface and orphaned packaged `roles/*.md` (outside this slice's
  scope). `role_thread_key` is intentionally retained (still used by
  `dashboard_slice.py` and the slice-recovery path).
- **PL-0002** (completed) — The harness-config test now builds a temp-dir
  fixture with a known `config/quest-runner.json` and asserts the fixture value,
  instead of reading the live repo config and asserting a machine-specific
  absolute path.

No open issues remain. Implementation accepted.
