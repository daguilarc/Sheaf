# Issue responses

## Response PL-0001 2026-06-08T22:33:43Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Fixed Flush() so dangling RUN_FINISHED events use context.threadId while preserving the open runId. Added a regression test that starts a run without agent_end, flushes it, validates the event, and asserts threadId is the original thread id and runId remains the open run id. Verified with npm test in projects/sheaf-chat.

## Response PL-0002 2026-06-08T22:33:47Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Removed the shared stateful singleton as the default for mapPiEventToAgui by requiring an explicit PiToAguiMapper argument and adding a runtime TypeError for omitted JS calls. Added coverage that asserts the no-mapper path fails explicitly, keeping streaming callers on CreatePiToAguiMapper-owned state. Verified with npm test in projects/sheaf-chat.
