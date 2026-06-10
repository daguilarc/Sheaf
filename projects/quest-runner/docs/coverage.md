# Spec Coverage

Last audit: agent VM sandboxing update (agent-harness re-audited), 2026-06-10

| Capability | Status | Gaps |
|---|---|---|
| quest-lifecycle | partial | run result shape, paused_until enforcement, deferred-run restart |
| service-lifecycle | partial | shutdown/recovery, registry boot rule, server concurrency |
| state-machine-engine | partial | vestigial constructs, loader leniency |
| workflow-config | partial | legacy upgrade detail, thread.scope variants, version semantics |
| agent-harness | partial | dead fields, legacy v1 config format, golden-image/Xcode smoke coverage, shared-worktree artifact skew |
| issues | partial | cross-process concurrency, resolution_notes write path |
| slices | partial | checkout_kind enumeration |
| experiments | partial | unused statuses, no exclusivity rule, manual recovery only |
| dashboard | partial | button predicates, localStorage keys, markdown subset |
| chat-stream | partial | WS close codes, pi synthetic-id detail, client-side rendering |

## Known gaps

### quest-lifecycle
- The synchronous run result dict (`steps_executed`, `last_commit`,
  `captured_outputs`) is unspecified; run outcomes are only specified as
  observed via the run-status API and step logs.
- `paused_until.md` is reflected in scheduled-run status and the dashboard
  overlay but the run loop does not block on it; intended semantics
  unspecified.
- Deferred re-runs (billing/rate-limit, 3600s) are in-memory only and lost on
  service restart; restart/recovery behavior unspecified.
- Concurrent `create_quest` calls are not serialized; quest-number assignment
  races are possible and unspecified.
- `requested_by` on `/create_quest` has no CLI flag (raw API only).
- The set of advance-422 `reason` strings (pre-step validation predicates) is
  not enumerated.

### service-lifecycle
- The service does not read `config/services.json` on boot (port comes from
  `--port`/start script); this conflicts with the structure/services.md boot
  rule and the intended reconciliation is unspecified.
- `/exit` uses `os._exit(0)`: no graceful shutdown; recovery of a quest
  interrupted mid-step is unspecified.
- The Flask development server is the production server; concurrency and
  threading guarantees are unspecified.
- Duplication between `quest_runner_stdout.log` and `quest-runner.log` is not
  specified.

### state-machine-engine
- `workflow.yaml` `variables:` is parsed and validated but consumed nowhere at
  runtime (documented as sm-46); whether it should feed interpolation is
  unresolved.
- `special.completed_state` is parsed but has no runtime effect; completion is
  determined solely by `terminal` (sm-55).
- `state_history.md` is scaffolded and referenced by conditions but never
  appended by the v2 engine; whether it is intentionally vestigial (kept as a
  `global_step` recovery fallback) is unspecified.
- `WorkflowStateMachine.RunOneStep` exists but appears unused by the v2 path;
  purpose unspecified.
- `file_count_at_least.glob` is not interpolated; behavior with `..` or
  `$`-prefixed globs is unspecified.
- Stale persisted child id: child-step execution fails fatally, but
  `select_child` silently falls back to the first match; the interplay is only
  partially specified.

### workflow-config
- The legacy-upgrade surface (ported profile override keys,
  `_merge_legacy_harnesses`) is specified only at summary level.
- `thread.scope` values `machine` and `node` are accepted by validation but
  behaviorally unused; their intended semantics are unspecified (reuse is
  governed solely by `registry_key_template`).
- Workflow `version` has no documented version-2+ semantics.

### agent-harness
- `pass_id` is always written as 0 and never read; pass-counter semantics
  unspecified.
- The legacy v1 quest-local `state_execution_config.yaml` `harnesses` format
  is referenced but not specified.
- VM guest package inventory and Xcode/simulator readiness are environment
  prerequisites for the golden image; the living spec covers harness mounts
  (including the auto-injected worktree/`source-checkout`/`git-common`
  mounts), the `.sheaf-agent-vm.env` guest environment contract, path
  preservation, and host-port reachability, but does not pin exact installed
  package versions.
- Mocked coverage exercises VM config, metadata, lifecycle hooks, SSH command
  construction, path mapping, and log streaming. The Quest Runner unit lane
  has been run successfully inside a disposable VM. The broad repository
  smoke remains environment-blocked on the current golden image because
  Dictator's Swift tests cannot import XCTest; the golden image must include
  working Xcode/XCTest and simulator support before that lane can be green.
- Shared-worktree build artifacts (absolute-path shebangs, native ABI
  binaries) can skew between host and VM when both run builds in the same
  worktree. Mitigated today by the `.venv-vm` venv selection
  (`SHEAF_AGENT_VM=1`) and Realtime Agent's pre-test `npm rebuild
  better-sqlite3`; the stated strategy is golden-image toolchain parity with
  the host, but no general enforcement or detection mechanism exists.
- The `data/quest-runner/agent-vms.json` record schema (a versioned
  `{version, records}` map keyed by worktree path) is named but not shaped;
  it is untracked runtime metadata read and written only by `agent_vm.py`.
- Exact exit-code semantics after an idle-timeout SIGTERM are loosely
  specified.
- `HarnessResponse.thinking_tokens` (claude_code only) has no identified
  consumer; unspecified.

### issues
- Cross-process concurrent writes to issue files are unspecified (only the
  in-process metadata mutation lock exists).
- `resolution_notes` is readable via the API but no API write path is
  specified.

### slices
- The full `checkout_kind` enumeration in the init response is not
  specified (example shows `"worktree"`; the set belongs to
  quest-lifecycle/experiments).
- Numbering past 9999 is unspecified (`{n:04d}` widens; the 4-digit discovery
  rule diverges from a full-prefix parse at 10000).
- JSON type strictness for `count`/`quest_number` (booleans, string digits) is
  unspecified.
- The scaffold `content` templating mechanism (`{now}` substitution context,
  brace escaping) is named in Design but has no contract.
- TOCTOU between the conflict pre-check and `mkdir` is unaddressed.
- No slice deletion/rename surface exists — intentionally absent.
- Rebuild-tested 2026-06-10 (fresh-agent smoke test): verdict yes-with-gaps;
  the wording/lock/error-string findings were fixed in place (sl-2/4/5/10/13
  tightened, sl-15/16 added, error catalogue added).

### experiments
- `created` and `failed` are valid `experiment.json` statuses but no current
  code path writes them (legacy/read-only).
- The land remote is hardcoded to `origin`; not specified as configurable.
- No exclusivity rule for multiple simultaneously open experiments on one
  quest; allowed but not explicitly specified.
- Recovery after `ExperimentWorktreeCreationError` is a manual procedure; no
  automated cleanup command exists.

### dashboard
- Exact action-button show/hide predicates (`InferQuestDisplayStatus`) are
  summarized, not specified rule-by-rule.
- `localStorage` key names and collapse-state persistence are unspecified.
- The markdown subset of `render_dashboard_markdown` is described loosely.
- Step-history scanning caps at the 2500 most recent commits (Design note
  only).

### chat-stream
- Per-event AGUI field shapes are deferred to
  `structure/schemas/ag_ui_events.schema.json` (canonical, not restated).
- WebSocket close codes are unspecified (flask-sock defaults, untested).
- Pi-specific synthetic id derivation is summarized, not exhaustively
  specified; `structure/schemas/pi_events.schema.json` is not cross-linked.
- Browser-side chat rendering lives in `projects/web/src/agui-chat.js` and is
  outside this project's spec; no client reconnect/backoff exists.

## Observed code/spec mismatches (candidate fixes, not spec gaps)

- `tests/test_workflow_upgrade.py` and `tests/test_issue_file_resolution.py`
  exist but are missing from the Makefile `TEST_MODULES` list, so `make test`
  never runs them.
- No `integration-test` Make target exists despite the structure/testing.md
  Makefile contract.
- `sheaf.path_enforcement` events bypass `ChatEventBus`, so live chat
  subscribers never see them (file-only).
- Transition entries containing only `if` (no `to`/`stay`/`stop`) are silently
  skipped at load rather than rejected; `mode:` accepts any string and ignores
  unknown values.
- Old `docs/reference/workflow.md` (now deleted) claimed `variables:` feeds
  interpolation; the engine ignores it.
