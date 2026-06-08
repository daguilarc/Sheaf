# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T22:31:52Z
- updated_at: 2026-06-08T22:31:52Z
- title: Flush() emits RUN_FINISHED with threadId set to the run id instead of the thread id
- details: ## Problem

`PiToAguiMapper.Flush()` emits `RUN_FINISHED` events with `threadId` set to the **run id** instead of the thread id.

`src/agui/mapper.ts:358-365`:

```ts
for (const runId of [...this.m_openRuns].sort())
{
  output.push(this.Agui({
    type: "RUN_FINISHED",
    threadId: runId,   // <-- bug: should be context.threadId
    runId,
  }, context));
}
```

Compare with the correct `agent_end` path at `src/agui/mapper.ts:115-120`, which uses `threadId: context.threadId`.

## Why it is a problem

`Flush()` is the sole code path that closes dangling/unfinished runs (e.g. when a stream disconnects or terminates mid-run without an `agent_end`). For every such run it produces a `RUN_FINISHED` whose `threadId` equals the synthetic run id (`<thread>:step:<n>:run:<m>`) rather than the actual thread id. Any client or downstream consumer that reconciles run lifecycle by `threadId` will receive an inconsistent/incorrect thread association for the terminal event of an interrupted run. The event still passes JSON-schema validation (threadId is just a string), so the defect is silent.

## Test gap

This branch has zero coverage. Both `Flush` call sites in the tests (`tests/agui/mapper.test.ts:91`, `tests/agui/snapshots.test.ts:104`) run `Flush` only after `agent_end` has already drained `m_openRuns`, so the open-run loop never executes. The bug is therefore invisible to the current suite.

## Done when

1. `Flush()` emits `RUN_FINISHED` with `threadId: context.threadId` (matching the `agent_end` path), while still using the open run id for `runId`.
2. A regression test exercises `Flush()` with at least one open run (an `agent_start` with no matching `agent_end`) and asserts the flushed `RUN_FINISHED` carries `threadId === context.threadId` and the correct `runId`.
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T22:31:55Z
- updated_at: 2026-06-08T22:31:55Z
- title: mapPiEventToAgui defaults to a shared stateful singleton mapper (cross-session state leak)
- details: ## Problem

`mapPiEventToAgui()` defaults its `mapper` parameter to a module-level shared singleton, `x_defaultMapper`, which carries mutable streaming state.

`src/agui/mapper.ts:704-713`:

```ts
const x_defaultMapper = new PiToAguiMapper();

export function mapPiEventToAgui(
  event: PiMappableEvent,
  context: PiMapperContext,
  mapper: PiToAguiMapper = x_defaultMapper,
): AguiEvent[]
{
  return mapper.MapEvent(event, context);
}
```

`PiToAguiMapper` holds per-stream state (`m_openRuns`, `m_openTextMessages`, `m_openReasoningMessages`, `m_openTools`, `m_runCounter`, `m_fallbackEvents`, ...).

## Why it is a problem

Any caller that invokes `mapPiEventToAgui(event, context)` without supplying an explicit `mapper` shares one global stateful instance across unrelated threads / sessions. Because the instance accumulates open runs/messages/tools and an ever-incrementing `m_runCounter`, concurrent or sequential use of the default would cross-contaminate state between sessions: run ids keep climbing, an open text message from session A can suppress a `TEXT_MESSAGE_START` in session B (`message_start` early-returns when `m_openTextMessages.has(messageId)`), and `Errors()`/`Flush()` would mix entries from multiple sessions. This is a latent correctness footgun in a foundational library API: the type signature invites the no-mapper call, but that path is unsafe for the stateful event stream this class is built to handle. The existing tests always pass an explicit `CreatePiToAguiMapper()` instance, so the dangerous default is never exercised.

(Note: `mapSheafActivityToAgui` also references `x_defaultMapper`, but only to call the stateless `Agui()` helper, so it is not affected — this issue is specifically about the stateful streaming path through `mapPiEventToAgui`.)

## Done when

One of the following is true, and is covered/documented:

1. The shared stateful default is removed — e.g. `mapPiEventToAgui` requires an explicit mapper, or constructs a fresh `PiToAguiMapper` per call (only valid for genuinely stateless single-event mapping), OR
2. The stateful-sharing contract is made explicit and safe (clear documentation that the default singleton is single-session-only, plus guidance/tests demonstrating the intended per-session `CreatePiToAguiMapper()` usage), so a no-mapper caller cannot silently corrupt cross-session streaming state.
- resolution_notes: none
