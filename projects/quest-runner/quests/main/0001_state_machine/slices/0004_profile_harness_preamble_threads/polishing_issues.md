# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T22:12:46Z
- updated_at: 2026-06-09T22:12:46Z
- title: Remove superseded role-name execution helpers (spec-08 'must not survive as runner code')
- details: ## What is wrong

The slice migrated the live execution path to workflow data, but left the
superseded role-name-based runner helpers in place as dead (or test-only) code.
Spec `08_agent_preamble.md` states explicitly: "The current
`build_runtime_context()` formatting (with labels like 'Current slice') must not
survive as runner code." The slice objective also states "No Python code should
infer behavior from role names." Both are only partially met.

Still present after this slice:

- `quest_thread.py:308 build_runtime_context()` and
  `quest_thread.py:286 _issue_workflow_cli_summary()` — still emit the old
  `- Role:` / `- Current slice:` / `- Current slice directory:` labels AND the
  REMOVED issue-CLI flags `--scope physicalplan` and
  `--scope polishing --slice <n>` (spec 04/08 replace these with `--file`).
  Directly violates the spec-08 "must not survive as runner code" clause and
  re-states issue-CLI guidance the quest is removing.
- `quest_runner.py:61 _ROLE_MAP` + `quest_runner.py:647 resolve_role()` — the
  state->role-name table the spec named for replacement. Now fully unused
  (no production or test caller) yet still present.
- `quest_runner.py:885 reviewer_commit_context()` — spec says "Keep reviewer
  commit-hash context removed; do not reintroduce it in Python." Call site was
  removed (good) but the function body remains as dead code.
- `quest_runner.py build_task_instruction()`,
  `quest_thread.py build_role_prompt()`,
  `quest_thread.py resolve_or_create_thread_spec()` (and the
  `build_spec_thread_name()` it calls) — dead in the production path.

The legacy text is also still validated by tests, keeping the removed behavior
alive:

- `tests/test_worktree_execution_path.py:365` calls `build_runtime_context(...)`
  and asserts the old `- Current slice directory:` formatting.
- `tests/test_quest_v2_predicates.py:34` exercises `build_task_instruction(...)`.

## Why it is a problem

- It is a direct, quotable violation of `08_agent_preamble.md` ("must not
  survive as runner code") and of the slice objective ("No Python code should
  infer behavior from role names").
- The dead `build_runtime_context()`/`_issue_workflow_cli_summary()` still carry
  the old `--scope` issue-CLI guidance this quest is explicitly removing; if
  anything re-wires to it, agents would again receive removed flags.
- `_ROLE_MAP`/`resolve_role` reintroduce exactly the role-name inference the
  workflow migration set out to eliminate; leaving them invites accidental reuse
  and confuses future readers about the source of truth.

## What must be true to mark completed

- The superseded helpers that encode role-name behavior or the old preamble
  text are removed from runner code (at minimum `build_runtime_context`,
  `_issue_workflow_cli_summary`, `_ROLE_MAP`, `resolve_role`,
  `reviewer_commit_context`, and the now-dead `build_task_instruction` /
  `build_role_prompt` / `resolve_or_create_thread_spec`), OR the implementer
  provides a concrete justification (e.g. a remaining production caller) for any
  kept function.
- No runner code emits the old `- Role:` / `- Current slice:` labels or the
  `--scope` issue-CLI guidance.
- The corresponding legacy assertions in `test_worktree_execution_path.py` and
  `test_quest_v2_predicates.py` are removed or retargeted to the new
  workflow-profile rendering, so the test suite no longer pins the removed
  formatting.
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T22:12:50Z
- updated_at: 2026-06-09T22:12:50Z
- title: Harness-config test asserts machine-specific absolute cli_path from live repo config
- details: ## What is wrong

`tests/test_workflow_profile_execution.py` ->
`HarnessConfigTests.test_service_harness_config_loads_from_repo_root` reads the
live, committed repo-root `config/quest-runner.json` and asserts an exact
developer-machine absolute path:

    self.assertEqual(
        harnesses["cursor"]["cli_path"],
        "/Users/joyo/.local/bin/cursor-agent",
    )

The test depends on (a) the real repo-root config file existing during the test
run and (b) its `cursor.cli_path` value being exactly that user-specific path.

## Why it is a problem

- The assertion is environment-specific: on CI, a fresh clone with a different
  configured path, or any other developer's machine, the value differs and the
  test fails for reasons unrelated to the code under test.
- It couples a unit test to mutable local configuration rather than to a
  controlled fixture. The sibling tests in the same class already demonstrate
  the correct pattern (build a `TemporaryDirectory`, write a known
  `config/quest-runner.json`, assert on that).
- It makes `config/quest-runner.json` effectively un-editable without breaking
  the test, even though that file holds machine-local paths.

## What must be true to mark completed

- The harness-config loader is verified against a controlled fixture (a
  temp-dir config the test writes) rather than the live repo-root file, OR the
  assertion is relaxed to check structure/keys (e.g. `cursor` present and
  `cli_path` is a non-empty string) instead of a hard-coded absolute path.
- The test no longer fails when run on a machine whose
  `config/quest-runner.json` differs from the original author's.
- resolution_notes: none
