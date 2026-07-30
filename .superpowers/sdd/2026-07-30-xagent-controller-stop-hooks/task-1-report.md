# Task 1 Report: Captured Hook Contracts and Locked State Machine

## What I Implemented

- Created `plugins/xagent/scripts/controller_stop_hook.py`.
- Added the CLI contract:

  ```text
  python3 controller_stop_hook.py --harness claude|codex --state-root /absolute/path observe|guard
  ```

- Implemented public testable functions:
  - `normalize_tool_name`
  - `extract_success_result`
  - `is_native_subagent`
  - `observe`
  - `guard`
  - `main`
- Added SHA-256 per-session state and lock paths keyed by `harness + session_id`.
- Added a one-second `fcntl.flock` per-session lock with fail-open behavior on timeout.
- Added atomic state writes via sibling staged file and `os.replace`.
- Implemented observer transitions for:
  - `xagent_start_non_sdd`
  - `xagent_sdd_start`
  - `xagent_sdd_followup`
  - `xagent_message`
  - `xagent_interrupt`
  - `xagent_await`
  - `xagent_close`
- Implemented guard behavior:
  - validates schema and pending entries;
  - selects the smallest `order`;
  - rejects a state revision at most once;
  - writes `last_rejected_revision`;
  - emits `{"decision":"block","reason":"..."}` on stdout only when blocking.
- Added fail-open CLI behavior for malformed stdin and invalid CLI arguments.
- Wired `python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py` into `xagent-plugin-test` before package validation.

## Hook Capture Summary

I used disposable hook settings only:

- Claude Code: disposable `--settings` and `--mcp-config` files with `PostToolUse` and `Stop` capture commands.
- Codex: disposable `CODEX_HOME` with auth symlink, local xagent MCP entry, hooks enabled, multi-agent enabled, and hook trust bypass for the capture invocation.

Captured discriminator result:

- Claude native subagent tool events include top-level `agent_id` and `agent_type`.
- Codex native subagent tool events include top-level `agent_id` and `agent_type`.

Because both harnesses provide a reliable top-level/native-subagent discriminator, implementation proceeded.

Committed sanitized fixtures:

- `claude_post_tool_use_start.json`
- `claude_post_tool_use_subagent.json`
- `claude_stop.json`
- `codex_post_tool_use_start.json`
- `codex_post_tool_use_subagent.json`
- `codex_stop.json`
- `mcp_error.json`

Fixture note: Claude Code v2.1.220 captured successful MCP JSON-text results as a bare JSON string in `tool_response`, so the implementation treats that as the captured single-text fallback form. Codex did not emit a `PostToolUse` hook for a failed MCP tool call during my error capture; `mcp_error.json` preserves the real xagent error content shape and includes the MCP `isError` protocol flag tested by the extractor.

## TDD Evidence

### RED: Initial Required Tests

Command:

```bash
python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py -v
```

Relevant failing output before implementation:

```text
ImportError: cannot import name 'controller_stop_hook' from 'plugins.xagent.scripts'
FAILED (errors=1)
```

Why expected: `controller_stop_hook.py` did not exist yet.

### GREEN: Initial Implementation

Command:

```bash
python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py -v
```

Relevant passing output:

```text
Ran 19 tests in 2.614s
OK
```

### RED: Review Fix Regression Tests

After external review, I added tests for fail-open CLI parsing/stdin behavior and one-field subagent discrimination.

Command:

```bash
python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py -v
```

Relevant failing output:

```text
FAIL: test_captured_claude_and_codex_fixtures_have_subagent_discriminators
AssertionError: False is not true

FAIL: test_cli_observe_is_silent_and_malformed_inputs_fail_open
AssertionError: 0 != 2

Ran 20 tests in 3.192s
FAILED (failures=2)
```

Why expected:

- `is_native_subagent()` still required both discriminator fields.
- argparse still exited 2 for invalid arguments.

### GREEN: Review Fixes

Command:

```bash
python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py -v
```

Relevant passing output:

```text
Ran 20 tests in 3.193s
OK
```

## Makefile Failure Probe

I temporarily inverted `test_lock_file_survives_empty_state_cleanup`, ran:

```bash
make xagent-plugin-test
```

After installing `projects/xagent` dependencies and building `projects/xagent/dist`, the target reached the newly inserted hook module and failed there:

```text
python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py
F..................
FAIL: test_lock_file_survives_empty_state_cleanup
AssertionError: True is not false
make[6]: *** [xagent-plugin-test] Error 1
```

I restored the assertion and reran the focused module successfully.

## What I Tested

Focused hook module:

```bash
python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py -v
```

Result:

```text
Ran 20 tests in 3.193s
OK
```

Python compile check:

```bash
python3 -m py_compile plugins/xagent/scripts/controller_stop_hook.py plugins/xagent/scripts/controller_stop_hook_test.py
```

Result: exit 0, no output.

Fixture JSON validation:

```bash
for f in plugins/xagent/scripts/fixtures/controller_stop_hooks/*.json; do python3 -m json.tool "$f" >/dev/null || exit 1; done; printf 'fixtures json valid\n'
```

Result:

```text
fixtures json valid
```

Full target:

```bash
make xagent-plugin-test
```

Result:

```text
python3 -m unittest plugins/xagent/scripts/install_global_test.py
Ran 29 tests in 65.496s
OK

python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py
Ran 20 tests in 3.184s
OK

python3 plugins/xagent/scripts/package_xagent.py --check
RuntimeError: tracked xagent plugin assets are stale; run `make xagent-plugin-build` and commit the regenerated assets
```

The failing asset drift list was limited to existing tracked xagent runtime assets under `plugins/xagent/assets/xagent/dist/...`; this Task 1 diff does not touch those generated assets.

## Files Changed

- `Makefile`
- `plugins/xagent/scripts/controller_stop_hook.py`
- `plugins/xagent/scripts/controller_stop_hook_test.py`
- `plugins/xagent/scripts/fixtures/controller_stop_hooks/claude_post_tool_use_start.json`
- `plugins/xagent/scripts/fixtures/controller_stop_hooks/claude_post_tool_use_subagent.json`
- `plugins/xagent/scripts/fixtures/controller_stop_hooks/claude_stop.json`
- `plugins/xagent/scripts/fixtures/controller_stop_hooks/codex_post_tool_use_start.json`
- `plugins/xagent/scripts/fixtures/controller_stop_hooks/codex_post_tool_use_subagent.json`
- `plugins/xagent/scripts/fixtures/controller_stop_hooks/codex_stop.json`
- `plugins/xagent/scripts/fixtures/controller_stop_hooks/mcp_error.json`
- `.superpowers/sdd/2026-07-30-xagent-controller-stop-hooks/task-1-report.md`

Ignored local verification artifacts:

- `projects/xagent/node_modules/`
- `projects/xagent/dist/`
- `plugins/xagent/scripts/__pycache__/`

## Self-Review Findings

External review found several actionable issues. I fixed:

- Invalid CLI arguments exiting 2 instead of fail-open exit 0.
- Malformed stdin coverage for CLI fail-open behavior.
- Missing CLI observe stdout/stderr silence coverage.
- Subagent discriminator requiring both fields instead of failing safer if either captured discriminator field appears.
- A vacuous concurrency assertion.
- `mcp_error.json` missing the MCP `isError` flag.
- Undocumented Claude bare-string result fallback.

I intentionally did not change:

- Namespace-agnostic `__xagent_tool` suffix normalization, because the brief explicitly says to normalize MCP names ending in the supported xagent tool name and Task 2 installer matchers further restrict hook registration.
- Await cursor update on any differing sequence, because the brief says to update when it differs.
- Lock file creation on empty Stop, because checking the state file before locking would weaken observer/guard serialization.
- Generated xagent runtime assets, because that is broad package drift outside Task 1's file list.

## Issues and Concerns

- `make xagent-plugin-test` does not complete because `package_xagent.py --check` reports pre-existing tracked runtime asset drift after `projects/xagent` is built. The newly inserted hook module runs and passes before that failure.
- `install_global_test.py` emits two `ResourceWarning: unclosed file` warnings during the full target; those warnings pre-exist this task and are outside the hook module.
- The Codex Stop output contract is tested at our CLI boundary against captured input, but I did not perform an interactive Codex `/hooks` activation check. That belongs to later installer/activation tasks.
