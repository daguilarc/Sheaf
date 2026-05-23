# Issue responses

## Response QP-0001 2026-05-23T04:05:56Z

- issue_id: QP-0001
- outcome: Fixed
- explanation: `apps/realtime-agent/src/event_router.ts` now classifies `response.done` as `tool_call` only when `response.output` contains an item with `type: "function_call"`; text-only `response.done` events fall through to `unknown`. `apps/realtime-agent/test/events/event_router.test.ts` now covers both classifier behavior and callback routing so text-only `response.done` no longer invokes `onToolCall`.
