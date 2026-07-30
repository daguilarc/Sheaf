# xagent Controller Stop Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install session-scoped Claude Code and Codex stop guards that give each new actionable xagent state one exact `xagent_await` continuation without polling or infinite stop loops.

**Architecture:** A packaged Python hook program normalizes captured Claude/Codex hook payloads, stores pending runs in one locked atomic JSON record per harness session, and emits a top-level block decision once per actionable record revision. The xagent installer owns canonical observer/guard groups in both global JSON files; the agents and Superpowers installers merge only their own entries into those shared files.

**Tech Stack:** Python 3 standard library (`argparse`, `fcntl`, `hashlib`, `json`, `os`, `pathlib`, `tempfile`, `time`, `unittest`), JSON command-hook configuration, existing xagent/agents Python installers and Make targets.

## Global Constraints

- OpenSpec change `openspec/changes/add-xagent-stop-hooks/` is the source of truth; do not invent behavior outside its proposal, design, delta specs, and tasks.
- Guard only top-level Claude Code and Codex controller sessions. Do not register `SubagentStop`; do not install guards for Cursor or Pi.
- Fixture capture must prove a reliable native-subagent discriminator for both harnesses before global installation work proceeds. If either discriminator cannot be established, stop and revise xhook-1/xhook-2.
- A state revision is rejected at most once within its persistent record incarnation, independent of `stop_hook_active`.
- A successful hook result increments revision only when pending membership or a stored cursor changes.
- Session state operations hold one per-session exclusive advisory lock; lock acquisition times out after exactly one second and fails open.
- State lives under the installer-resolved `<home>/.agents/plugins/data/xagent/controller-stop-hooks/`, not under the replaceable plugin directory and not under runtime-inferred `$HOME`.
- `turn.completed`, `run_terminal`, and phases `completed`, `failed`, `cancelled`, and `abandoned` clear a pending run. `await_deadline` with an unchanged cursor does not advance revision.
- Hook results marked `isError` or containing top-level `error` never create state; nested `details.run_id`/`details.agent_id` are ignored.
- Stop stdout is top-level `{"decision":"block","reason":"..."}` JSON. Claude may additionally receive a stderr guidance companion when its captured async-rewake contract requires it.
- The plugin must contain no plugin-root `hooks.json` or `hooks/` directory and no unsupported manifest `hooks` field.
- `$HOME/.claude/settings.json` and `$CODEX_HOME/hooks.json` merges preserve unrelated semantic values and relative hook-group order.
- Codex groups are appended when absent and updated in place when present. Any effective change that can affect command trust reports the `/hooks` re-approval boundary.
- Shared `$CODEX_HOME/hooks.json` is group-owned, never whole-file-owned. `--force` does not authorize replacing malformed shared JSON.
- Use no new third-party Python dependency.
- The SDD coordinator, not task workers, marks OpenSpec checkboxes only after the corresponding work is reviewed and verified.
- Model routing is fixed:
  - Task 1 implementer: Codex `gpt-5.5`; reviewer: Claude `opus`.
  - Task 2 implementer: Claude `opus`; reviewer: Codex `gpt-5.6-sol`.
  - Task 3 implementer: Codex `gpt-5.5`; reviewer: Claude `opus`.
  - Task 4 implementer: Cursor `cursor-grok-4.5-high`; reviewer: Claude `opus`.
  - Final whole-branch review: Codex `gpt-5.6-sol`.

---

### Task 1: Captured Hook Contracts and Locked State Machine

**Files:**
- Create: `plugins/xagent/scripts/controller_stop_hook.py`
- Create: `plugins/xagent/scripts/controller_stop_hook_test.py`
- Create: `plugins/xagent/scripts/fixtures/controller_stop_hooks/claude_post_tool_use_start.json`
- Create: `plugins/xagent/scripts/fixtures/controller_stop_hooks/claude_post_tool_use_subagent.json`
- Create: `plugins/xagent/scripts/fixtures/controller_stop_hooks/claude_stop.json`
- Create: `plugins/xagent/scripts/fixtures/controller_stop_hooks/codex_post_tool_use_start.json`
- Create: `plugins/xagent/scripts/fixtures/controller_stop_hooks/codex_post_tool_use_subagent.json`
- Create: `plugins/xagent/scripts/fixtures/controller_stop_hooks/codex_stop.json`
- Modify: `Makefile`

**Assigned agents:**
- Implement with xagent SDD on `harness: codex`, `agent: gpt-5.5`, `effort: high`.
- Review with xagent SDD on `harness: claude_code`, `agent: opus`, `effort: high`.

**Interfaces:**
- Produces CLI:

```text
python3 controller_stop_hook.py \
  --harness claude|codex \
  --state-root /absolute/path \
  observe|guard
```

- Consumes one hook payload JSON object from stdin.
- `observe` exits `0` without stdout on success, ignored input, or fail-open input.
- `guard` exits `0`; when blocking, stdout is one JSON object:

```json
{
  "decision": "block",
  "reason": "Call xagent_await with run_id=\"run-1\" and after_sequence=7 before stopping."
}
```

- State schema:

```json
{
  "schema_version": 1,
  "revision": 3,
  "last_rejected_revision": 2,
  "next_order": 2,
  "pending": [
    {"run_id": "run-1", "after_sequence": 7, "order": 1}
  ]
}
```

- Public testable functions:

```python
def normalize_tool_name(raw_name: object) -> str | None: ...
def extract_success_result(tool_response: object) -> dict[str, object] | None: ...
def is_native_subagent(payload: dict[str, object], harness: str) -> bool: ...
def observe(payload: dict[str, object], harness: str, state_root: Path) -> None: ...
def guard(payload: dict[str, object], harness: str, state_root: Path) -> dict[str, str] | None: ...
def main(argv: Sequence[str] | None = None) -> int: ...
```

- Task 2 consumes the CLI and state-root contract verbatim.

- [ ] **Step 1: Capture and sanitize real hook envelopes**

Use disposable harness settings only; never edit the user's live global hook
files. Create a temporary capture command that appends stdin JSON as one JSONL
record:

```python
#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

destination = Path(os.environ["XAGENT_HOOK_CAPTURE"])
with destination.open("a", encoding="utf-8") as stream:
    stream.write(json.dumps(json.load(sys.stdin), sort_keys=True) + "\n")
```

For Claude Code, pass a disposable settings file with `PostToolUse` and `Stop`
groups to `/Users/joyo/.local/bin/claude --settings <file> --print`; for Codex,
use a disposable `CODEX_HOME` containing copied non-secret configuration,
symlinked authentication, an xagent MCP entry, `bypass_hook_trust = true`, and
the capture groups. Trigger a top-level xagent tool, a native subagent tool
call, and a stop in each harness. Also attempt a failed xagent MCP call in the
disposable capture environment. If the failed call emits no `PostToolUse`, note
that evidence in the report and do not invent an error fixture; cover defensive
error rejection with inline unit payloads instead. Redact absolute home paths,
transcript paths, tool-use IDs, session IDs, and prompt text while preserving
field names, nesting, booleans, tool names, result envelopes, and agent
discriminators.

If either native-subagent capture lacks a reliable discriminator, return
`BLOCKED` without writing production code.

- [ ] **Step 2: Write failing payload and transition tests**

Create fixture-loading tests plus direct transition tests. The required test
names are:

```python
class PayloadContractTests(unittest.TestCase):
    def test_captured_claude_and_codex_fixtures_have_subagent_discriminators(self): ...
    def test_structured_content_is_preferred(self): ...
    def test_single_json_text_block_is_fallback(self): ...
    def test_error_envelope_never_uses_nested_identity(self): ...

class ObserverStateTests(unittest.TestCase):
    def test_start_followup_message_interrupt_await_and_close_transitions(self): ...
    def test_multiple_runs_preserve_insertion_order(self): ...
    def test_sessions_and_harnesses_are_isolated(self): ...
    def test_native_subagent_event_is_ignored(self): ...
    def test_await_deadline_with_same_cursor_is_noop(self): ...
    def test_terminal_events_and_phases_clear_only_matching_run(self): ...
```

Run:

```bash
python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py -v
```

Expected: FAIL because `controller_stop_hook.py` and its functions do not yet
exist.

- [ ] **Step 3: Implement safe identity, result extraction, and state paths**

Use a SHA-256 filename so untrusted session IDs never become paths:

```python
STATE_SCHEMA_VERSION = 1
LOCK_TIMEOUT_SECONDS = 1.0
TERMINAL_PHASES = frozenset({"completed", "failed", "cancelled", "abandoned"})
START_TOOLS = frozenset({
    "xagent_start_non_sdd",
    "xagent_sdd_start",
    "xagent_sdd_followup",
    "xagent_message",
})

def session_key(harness: str, session_id: str) -> str:
    raw = f"{harness}\\0{session_id}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()

def session_paths(state_root: Path, harness: str, session_id: str) -> tuple[Path, Path]:
    key = session_key(harness, session_id)
    return state_root / f"{key}.json", state_root / f"{key}.lock"
```

`extract_success_result()` must accept only:

1. a dictionary under `tool_response["structuredContent"]`; or
2. Claude Code's captured direct JSON-string `tool_response` whose decoded
   value is a dictionary; or
3. exactly one JSON text block whose decoded value is a dictionary.

Reject `tool_response["isError"] is True` when the outer envelope can carry it,
a decoded top-level `error`, malformed JSON, arrays, and nested-identity-only
errors.

- [ ] **Step 4: Implement the one-second per-session lock and atomic state writes**

Use `fcntl.flock(fd, LOCK_EX | LOCK_NB)` with a monotonic deadline and a short
bounded retry. Hold the lock across the complete read/transition/write or
read/decision/write operation. A timeout raises an internal
`LockUnavailable`; `observe()` and `guard()` catch it and fail open.

Atomic writes must:

```python
staged = state_path.with_name(f".{state_path.name}.stage-{os.getpid()}")
staged.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
os.replace(staged, state_path)
```

Remove the state JSON when `pending` becomes empty. Never unlink the lock file.

- [ ] **Step 5: Implement observer transitions**

Normalize both undecorated names and MCP names ending in the supported xagent
tool name. Require top-level identity/sequence fields per transition:

```python
START_FIELDS = {
    "xagent_start_non_sdd": ("run_id", "sequence"),
    "xagent_sdd_start": ("agent_id", "sequence"),
    "xagent_sdd_followup": ("agent_id", "sequence"),
    "xagent_message": ("run_id", "sequence"),
    "xagent_interrupt": ("run_id", "sequence"),
    "xagent_await": ("run_id", "sequence"),
    "xagent_close": ("run_id",),
}
```

For await:

- clear on `event == "turn.completed"`;
- clear on `reason == "run_terminal"`;
- clear on a phase in `TERMINAL_PHASES`;
- leave unchanged on `event == "supervision.deadline"`,
  `reason == "await_deadline"`, and equal cursor;
- otherwise update the matching cursor only when it differs.

Increment `revision` exactly once for a changed transition.

- [ ] **Step 6: Write failing guard and concurrency tests**

Add:

```python
class StopGuardTests(unittest.TestCase):
    def test_oldest_pending_run_blocks_with_exact_latest_cursor(self): ...
    def test_same_revision_is_rejected_only_once_across_active_field_variants(self): ...
    def test_new_revision_rearms_guard(self): ...
    def test_new_record_after_empty_state_can_block_once(self): ...
    def test_no_pending_malformed_or_unknown_schema_fails_open(self): ...
    def test_claude_and_codex_emit_captured_compatible_stop_output(self): ...

class ConcurrencyTests(unittest.TestCase):
    def test_overlapping_observer_and_guard_do_not_lose_updates(self): ...
    def test_lock_timeout_fails_open_within_bound(self): ...
    def test_lock_file_survives_empty_state_cleanup(self): ...
```

Run the test file. Expected: the observer tests pass and guard/concurrency tests
fail until Step 7.

- [ ] **Step 7: Implement guard behavior**

Under the session lock:

1. validate schema and pending entries;
2. select the smallest `order`;
3. if `last_rejected_revision == revision`, return `None`;
4. persist `last_rejected_revision = revision`;
5. return the exact block object.

The captured Claude contract may require writing the same human-readable
guidance to stderr while keeping stdout JSON authoritative.

- [ ] **Step 8: Run focused tests and wire root test execution**

Run:

```bash
python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py -v
```

Expected: all tests PASS.

Add this exact command to `xagent-plugin-test` before package validation:

```make
	python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py
```

Temporarily make one local assertion fail, run `make xagent-plugin-test`, and
confirm the target exits non-zero at the new module. Restore the assertion and
rerun the focused module.

- [ ] **Step 9: Commit**

```bash
git add Makefile plugins/xagent/scripts/controller_stop_hook.py \
  plugins/xagent/scripts/controller_stop_hook_test.py \
  plugins/xagent/scripts/fixtures/controller_stop_hooks
git commit -m "feat: add xagent controller stop state machine"
```

---

### Task 2: xagent Global Hook Installation and Packaging

**Files:**
- Modify: `plugins/xagent/scripts/install_global.py`
- Modify: `plugins/xagent/scripts/install_global_test.py`
- Modify: `plugins/xagent/scripts/package_xagent.py`
- Verify unchanged schema: `plugins/xagent/.codex-plugin/plugin.json`

**Assigned agents:**
- Implement with xagent SDD on `harness: claude_code`, `agent: opus`, `effort: high`.
- Review with xagent SDD on `harness: codex`, `agent: gpt-5.6-sol`, `effort: high`.

**Interfaces:**
- Consumes Task 1 CLI and state-root contract.
- Produces:

```python
def register_harness_hooks(
    *,
    home: Path,
    codex_home: Path,
    installed_hook: Path,
) -> None: ...

def merge_xagent_hook_groups(
    payload: dict[str, object],
    *,
    harness: str,
    observe_command: str,
    guard_command: str,
) -> tuple[dict[str, object], bool]: ...
```

- Canonical ownership is a command containing the resolved installed
  `scripts/controller_stop_hook.py`, the matching `--harness`, and mode
  `observe` or `guard`.
- Task 3 imports or duplicates no xagent merge logic; it recognizes xagent
  groups only to preserve them.

- [ ] **Step 1: Write failing merge and installation tests**

Add tests to `AllHarnessDistributionTests` and `GlobalPluginInstallTests`:

```python
def test_hooks_are_registered_for_claude_and_codex(self): ...
def test_hook_registration_preserves_unrelated_values_and_group_order(self): ...
def test_hook_registration_updates_owned_groups_in_place(self): ...
def test_hook_registration_removes_only_owned_duplicates(self): ...
def test_hook_registration_is_idempotent(self): ...
def test_hook_registration_rejects_malformed_json_and_hooks_shapes(self): ...
def test_hook_registration_writes_atomic_backup(self): ...
def test_codex_effective_change_prints_trust_notice(self): ...
def test_legacy_agents_marker_is_tolerated(self): ...
def test_installed_package_contains_script_but_no_discoverable_plugin_hooks(self): ...
```

Run:

```bash
python3 -m unittest plugins/xagent/scripts/install_global_test.py -v
```

Expected: new tests FAIL because no hook merge exists.

- [ ] **Step 2: Define canonical hook groups**

Build commands with `shlex.quote`:

```python
state_root = home / ".agents" / "plugins" / "data" / "xagent" / "controller-stop-hooks"
base = (
    f"python3 {shlex.quote(str(installed_hook.resolve()))} "
    f"--harness {harness} --state-root {shlex.quote(str(state_root.resolve()))}"
)
observe_command = f"{base} observe"
guard_command = f"{base} guard"
```

Use event keys `PostToolUse` and `Stop`; preserve the captured harness-specific
matcher and timeout values from Task 1 fixtures. Append absent groups and
replace the first canonical owned group at the same index. Remove only later
canonical duplicates. Never sort event arrays or unrelated keys.

- [ ] **Step 3: Implement validated shared-JSON loading and atomic writes**

Load absent files as `{}`. Require top-level object, `hooks` object when
present, and event arrays when present. Create parent directories before
calling existing `write_json_atomic()`.

For `$HOME/.claude/settings.json`, preserve `enabledPlugins` and every unrelated
key. For `$CODEX_HOME/hooks.json`, tolerate and preserve the legacy
`_sheaf_agents_managed` key until Task 3 migrates it.

Only print the Codex `/hooks` trust notice after an effective Codex change.

- [ ] **Step 4: Register hooks after the installed package is committed**

In `install_global()`, compute:

```python
installed_hook = destination / "scripts" / "controller_stop_hook.py"
```

Call `register_harness_hooks()` only after `replace_managed_destination()` and
`require_installed_plugin()` succeed, and before returning. Verify the installed
script exists before touching global JSON.

- [ ] **Step 5: Strengthen package validation**

Assert the staged package:

- contains `scripts/controller_stop_hook.py`;
- contains neither `hooks.json` nor a root `hooks/` directory;
- leaves `.codex-plugin/plugin.json` without a `hooks` key;
- passes the existing plugin validator unchanged.

Do not add a manifest field or a new package directory.

- [ ] **Step 6: Run focused and package tests**

```bash
python3 -m unittest plugins/xagent/scripts/install_global_test.py -v
python3 plugins/xagent/scripts/package_xagent.py --check
python3 /Users/joyo/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/xagent
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit**

```bash
git add plugins/xagent/scripts/install_global.py \
  plugins/xagent/scripts/install_global_test.py \
  plugins/xagent/scripts/package_xagent.py
git commit -m "feat: install xagent controller hooks globally"
```

---

### Task 3: Shared Codex Hook Ownership in the Agents Installer

**Files:**
- Modify: `projects/agents/scripts/install.py`
- Modify: `projects/agents/scripts/install_test.py`
- Modify: `projects/agents/global/codex/hooks/hooks.json` only if the canonical group template needs a group-only shape

**Assigned agents:**
- Implement with xagent SDD on `harness: codex`, `agent: gpt-5.5`, `effort: high`.
- Review with xagent SDD on `harness: claude_code`, `agent: opus`, `effort: high`.

**Interfaces:**
- Produces dedicated shared-output operations:

```python
@dataclass(frozen=True)
class CodexHookSharedOutput:
    config_path: Path
    script_output: Output
    desired_group: dict[str, object]

def merge_agents_codex_group(
    existing: dict[str, object],
    desired_group: dict[str, object],
    installed_script: Path,
) -> tuple[dict[str, object], bool]: ...

def install_codex_hook_shared(output: CodexHookSharedOutput) -> int: ...
def check_codex_hook_shared(output: CodexHookSharedOutput) -> int: ...
def clean_codex_hook_shared(output: CodexHookSharedOutput) -> int: ...
```

- Canonical agents ownership requires both matcher `^compact$` and command:

```text
python3 <resolved-CODEX_HOME>/hooks/sheaf/session_start_after_compact.py
```

- Generic `Output` handling remains unchanged for every other destination.

- [ ] **Step 1: Write failing ownership, migration, and lifecycle tests**

Replace whole-file assumptions in `CodexHookOutputTests` with:

```python
def test_install_appends_agents_group_and_preserves_unrelated_order(self): ...
def test_install_updates_canonical_agents_group_in_place(self): ...
def test_install_migrates_legacy_whole_file_marker(self): ...
def test_install_preserves_canonical_xagent_groups(self): ...
def test_check_compares_only_script_and_agents_group(self): ...
def test_clean_removes_only_agents_group_and_script(self): ...
def test_clean_deletes_hooks_json_only_when_no_foreign_content_remains(self): ...
def test_malformed_shared_json_fails_install_check_and_clean_even_with_force(self): ...
def test_install_and_clean_effective_changes_print_trust_notice(self): ...
def test_agents_and_xagent_install_order_converges(self): ...
```

Run:

```bash
python3 -m unittest projects/agents/scripts/install_test.py -v
```

Expected: new shared-file tests FAIL under generic whole-file `Output` handling.

- [ ] **Step 2: Separate the shared Codex config from generic outputs**

`build_global_outputs()` must continue returning the managed hook script as an
ordinary `Output`, but must not pass `$CODEX_HOME/hooks.json` through generic
whole-file install/check/clean.

Create the `CodexHookSharedOutput` descriptor from the repository-owned group
template, resolve the command placeholder, and route it explicitly from
`main()` for global/all scopes.

- [ ] **Step 3: Implement canonical group recognition and merge**

Recognition must match the compact matcher and exact installed-script command,
not the top-level marker and not a loose `session_start_after_compact.py`
substring.

On install:

1. validate shared JSON shape;
2. remove `_sheaf_agents_managed`;
3. append desired group when absent or update it in place;
4. preserve xagent and unrelated groups in relative order;
5. atomically write only when changed.

On check, compare only the script and canonical group. On clean, remove only
the group and script; rewrite shared JSON if foreign content remains, otherwise
remove the file. Never let `--force` replace malformed shared JSON.

- [ ] **Step 4: Add symmetric trust notices**

Print a concise `/hooks` re-approval notice after install or clean changes the
Codex group array. Check mode does not mutate or print activation success.

- [ ] **Step 5: Run focused agents tests**

```bash
python3 -m unittest projects/agents/scripts/install_test.py -v
make -C projects/agents test
```

Expected: both exit `0`.

- [ ] **Step 6: Commit**

```bash
git add projects/agents/scripts/install.py \
  projects/agents/scripts/install_test.py \
  projects/agents/global/codex/hooks/hooks.json
git commit -m "fix: merge shared Codex hooks by owner"
```

If the group template did not change, omit it from `git add`.

---

### Task 4: Claude Atomic Coexistence, Documentation, and Integrated Verification

**Files:**
- Modify: `projects/agents/scripts/install_superpowers.py`
- Modify: `projects/agents/scripts/install_superpowers_test.py`
- Modify: `plugins/xagent/README.md`
- Modify: `projects/agents/README.md`

**Assigned agents:**
- Implement with xagent SDD on `harness: cursor`, `agent: cursor-grok-4.5-high`, `effort: high`.
- Review with xagent SDD on `harness: claude_code`, `agent: opus`, `effort: high`.

**Interfaces:**
- `enable_claude_plugin(home: Path)` keeps its public signature.
- Add a settings-specific atomic writer:

```python
def write_claude_settings_atomic(path: Path, payload: object) -> None: ...
```

- Backup path is `<settings.json>.sheaf-backup`; stage path is a hidden sibling
  and is absent after success or handled failure.
- Do not broaden this change to unrelated registry writers.

- [ ] **Step 1: Write failing Claude settings coexistence tests**

Add:

```python
def test_claude_enable_preserves_xagent_hooks_and_unrelated_settings(self): ...
def test_claude_settings_write_is_atomic_and_backed_up(self): ...
def test_claude_settings_malformed_json_is_not_replaced(self): ...
def test_claude_enabled_plugins_wrong_shape_is_not_replaced(self): ...
```

Run:

```bash
python3 -m unittest projects/agents/scripts/install_superpowers_test.py -v
```

Expected: atomic/backup tests FAIL with the current plain `write_text`.

- [ ] **Step 2: Implement the settings-specific atomic writer**

Use the same stage/copy/replace discipline as xagent:

```python
serialized = json.dumps(payload, indent=2) + "\n"
staged = path.with_name(f".{path.name}.sheaf-stage")
backup = path.with_name(f"{path.name}.sheaf-backup")
path.parent.mkdir(parents=True, exist_ok=True)
staged.write_text(serialized, encoding="utf-8")
if path.exists():
    shutil.copy2(path, backup)
os.replace(staged, path)
```

Call it from `enable_claude_plugin()` only. Existing object and
`enabledPlugins` validation stays fail-before-write.

- [ ] **Step 3: Update xagent documentation**

Document in `plugins/xagent/README.md`:

- only top-level Claude/Codex controllers are guarded;
- Cursor/Pi are not guarded;
- exact global JSON paths and stable state-root path;
- one block per actionable record revision and fail-open lock/state behavior;
- Codex `/hooks` approval and activation verification;
- reinstall idempotence and manual rollback ownership;
- xagent-launched workers are separate top-level sessions.

- [ ] **Step 4: Update agents documentation**

Replace the whole-file Codex ownership and `--force` text in
`projects/agents/README.md` with group-level ownership, legacy-marker migration,
malformed shared-file failure, check/clean semantics, order preservation, and
the symmetric `/hooks` re-approval notice. Document that managed Superpowers
updates Claude settings atomically while preserving xagent hooks.

- [ ] **Step 5: Run focused and integrated verification**

Run:

```bash
python3 -m unittest plugins/xagent/scripts/controller_stop_hook_test.py -v
python3 -m unittest plugins/xagent/scripts/install_global_test.py -v
python3 -m unittest projects/agents/scripts/install_test.py -v
python3 -m unittest projects/agents/scripts/install_superpowers_test.py -v
make xagent-plugin-test
make -C projects/agents test
python3 -m unittest tests/openspec_requirement_ids_test.py -v
/Users/joyo/.local/share/sheaf/bin/openspec validate add-xagent-stop-hooks --strict
```

Expected: every command exits `0`.

For manual activation, use disposable Claude settings and a disposable
`CODEX_HOME`; Codex trust bypass is allowed only in that disposable home.
Exercise:

1. start/follow-up creates pending state;
2. first Stop blocks with exact run/cursor;
3. unchanged second Stop passes;
4. attention/cursor advance re-arms;
5. completion/close clears state;
6. native-subagent hook events do not mutate parent state.

Record the exact disposable commands and observed results in the implementer
report. Do not mutate the user's live global settings in this task.

- [ ] **Step 6: Commit**

```bash
git add projects/agents/scripts/install_superpowers.py \
  projects/agents/scripts/install_superpowers_test.py \
  plugins/xagent/README.md projects/agents/README.md
git commit -m "docs: verify xagent stop hook coexistence"
```

---

## Coordinator Completion Checklist

After each task passes its opposite-provider task review:

- Task 1 complete → mark OpenSpec 1.1–1.5 complete.
- Task 2 complete → mark OpenSpec 2.1–2.3 complete.
- Task 3 complete → mark OpenSpec 3.1–3.2 complete.
- Task 4 complete → mark OpenSpec 3.3 and 4.1–4.2 complete.

Then:

1. Run the full verification commands from Task 4 again in the controller.
2. Generate a whole-branch review package from the branch merge base.
3. Dispatch final whole-branch review through xagent SDD with Codex
   `gpt-5.6-sol`, `effort: high`.
4. If findings exist, use one fix wave and one scoped re-review as required by
   `superpowers:subagent-driven-development`.
5. Re-run verification, ensure all OpenSpec checkboxes are complete, and invoke
   `superpowers:finishing-a-development-branch`.
