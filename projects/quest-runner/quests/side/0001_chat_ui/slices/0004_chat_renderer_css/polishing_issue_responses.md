# Issue responses

## Response PL-0001 2026-06-08T06:02:01Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Updated RenderTranscript to re-render assistant/reasoning nodes once after they were previously rendered streaming, so separate END frames remove the assistant streaming cursor and hide the reasoning spinner. Added a regression test that renders START/CONTENT first, then END in a later render pass for both roles. Verified with: node --test projects/web/tests/agui-chat.test.mjs.
