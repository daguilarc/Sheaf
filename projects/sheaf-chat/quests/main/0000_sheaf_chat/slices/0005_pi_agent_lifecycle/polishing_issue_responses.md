# Issue responses

## Response PL-0002 2026-06-08T22:20:02Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Populated SessionRuntimeRecord.lastError through SessionRuntime.ReportError for delivery, manifest-write, and session-start failures. Startup failures now leave the failed runtime in the manager map so getStatus reports Failed plus the startup error. Added assertions for delivery and startup failure status errors. Verified with npm test in projects/sheaf-chat.

## Response PL-0001 2026-06-08T22:20:02Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Guarded LifecycleEmitter.EmitError so the reserved EventEmitter error event is not emitted when there are no subscribers. Added runtime error recording via SessionRuntime.ReportError and regression coverage for no-subscriber lifecycle errors, non-fatal user message delivery failures, and fire-and-forget manifest write failures. Verified with npm test in projects/sheaf-chat.
