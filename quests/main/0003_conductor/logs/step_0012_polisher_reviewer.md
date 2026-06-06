# step 12 — polisher_reviewer

**thread:** Sheaf_quest_0003_slice_0003_polisher_reviewer

## output

I'll review this slice. Let me start by understanding the slice spec and the implementation changes.Let me read the slice spec, physical plan, and existing issues.The polishing_issues.md is essentially empty. Let me read the slice spec and the diff of the implementation.Now let me look at the implementation diff. Let me find the relevant changes for this slice.This slice introduces lifecycle.ts, process_runner.ts, logs.ts and extends server.ts/paths.ts. Let me read the core implementation files.Now let me read the server.ts routing and paths.ts changes, plus the tests.Now let me review the test files.Let me verify the exports in index.ts and the presenter/health helper used.I've reviewed the full slice implementation against the physical plan and spec. The implementation is clean and well-tested overall. I found one behavioral defect worth raising.

**Finding — restart of a stopped service:** In `lifecycle.ts:307-326`, `RestartService` computes `restart_requested = stop_requested && started`. When a service is currently down, the `POST /exit` call fails (`stop_requested = false`), but the subsequent `StartService` succeeds (`started = true`). This yields `restart_requested = false` with `error` set to the stop failure. The server (`server.ts:192-205`) then returns HTTP 500 even though a new process was actually spawned and `process`/`started:true` are present in the body. Restarting a down service is a normal user action, so reporting it as a 500 failure is misleading. This path is untested.

Let me record this issue.Review complete. The slice implementation is largely solid — start/stop/restart lifecycle, the `conductor` self-management path, log listing with traversal guards, and test coverage all closely match the physical plan and spec. Tests cover the required matrix (start success/invalid/spawn-failure, stop via `/exit`, unreachable `/exit`, owned-process-only kill, conductor self-stop URL, restart ordering, log missing/nested/404, path traversal).

I opened **one** issue and did **not** create `implementation_accepted.md`:

- **PI-0001 (open):** `RestartService` returns HTTP 500 when restarting a currently-down service even though the new process spawns successfully (`started:true`, `process` populated). Because `restart_requested` requires the stop phase to succeed, an unreachable `/exit` on a stopped service makes a normal restart look like a failure, and the 500 status contradicts the success-shaped body. This edge case is also untested.

The polisher should address PI-0001 (and record their response in `polishing_issue_responses.md`) before the slice can be accepted.

