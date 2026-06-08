# Issue responses

## Response PL-0001 2026-06-08T05:43:56Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Added a RUN_FINISHED reducer test that leaves text, tool call, and reasoning streams open until the finish event, then asserts the run is finished, all open stream tracking is cleared, tool call isOpen is false, text/reasoning messages stop streaming, and status recomputes to complete. Verified with: node --test projects/web/tests/agui-chat.test.mjs.
