# Slice 0002 implementation complete

## Summary

Implemented the **response queue** for `RealtimeAgentSessionImpl`: server-driven `m_serverResponseActive` / outbound `response.create` pending state, FIFO `SubmitResponseAffectingUnit` with policies `enqueue` (default), `reject`, and `cancel_current`, and draining on `response.created` / `response.done` / `response.cancelled` / matching `error`.

Session APIs route response-affecting work through the queue (`createResponse`, paired `commitAudioAndCreateResponse`, `sendTextMessage` / `sendStructuredContext` with `createResponse: true`, and `sendRealtimeEvent` for `response.create` only). `response.cancel` and non-response traffic (e.g. `commitAudio`, `clearAudioBuffer`, audio append) still transmit immediately. Documented empty-buffer behavior for `commitAudioAndCreateResponse` in a short comment.

**ToolDispatcher** now supports `responseAfterOutput: "never" | "always"` (default `"never"`), with `enqueueResponseCreate` on `ToolDispatcherSendContext` so follow-up `response.create` after `function_call_output` uses the same queue. **AgentStartConfig** adds optional `responseAfterToolOutput` (default false) mapped to the dispatcher.

Tests: new `test/agent_loop/response_queue.test.ts` (queue policies, pairing, FIFO, terminal error, cancel passthrough, tool follow-up paths), `SimulateResponseCreatedAndDone` helper for chained `sent` expectations in `session_api_and_turn_mode.test.ts`, and `enqueueResponseCreate` stubs in `tooling.test.ts`.

`npm test` in `apps/realtime-agent` passes.
