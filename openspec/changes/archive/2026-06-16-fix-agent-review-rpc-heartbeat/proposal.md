## Why

Agent Review Mode can lose its Launchpad lights during otherwise healthy browser sessions because Sheaf Chat's Dictator RPC connection can exceed Dictator's heartbeat timeout during quiet review periods. Once Dictator expires the RPC session, it removes Sheaf Chat's owned cells while the WebSocket may remain open, so later cell updates can fail until the browser creates a fresh Agent Review session.

## What Changes

- Make Sheaf Chat keep its Dictator RPC client session alive while Agent Review Mode is active by sending periodic heartbeat RPCs below Dictator's configured timeout.
- Make Sheaf Chat recover from stale Dictator RPC sessions by reconnecting and repainting owned Launchpad cells when a cell update fails because Dictator no longer recognizes the client session.
- Keep the existing Launchpad color and focus semantics unchanged: cells still go dark when no attached browser client is focused and relight from Agent Review state on focus.
- Make Dictator's `rpc.ping` heartbeat method part of the documented WebSocket RPC contract.
- Add regression coverage for quiet Agent Review sessions so Launchpad ownership does not expire without recovery.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: Agent Review's Dictator bridge must keep the RPC session alive and recover/repaint after stale-session failures.
- `dictator-websocket-rpc`: The local RPC protocol must document `rpc.ping` as a heartbeat request that refreshes client liveness.

## Impact

- Affected code:
  - `projects/sheaf-chat/src/server/agentReview/service.ts`
  - `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`
  - `projects/dictator/src/Sources/DictatorService/DictatorRPCService.swift` only if current `rpc.ping` behavior needs adjustment
  - `projects/dictator/tests/DictatorServiceTests/DictatorRPCServiceTests.swift` for contract coverage if needed
- APIs/protocols:
  - Dictator WebSocket RPC keeps the existing `rpc.ping` method and response shape; this change documents and relies on it.
  - Sheaf Chat's browser-facing Agent Review WebSocket and REST contracts are unchanged.
- Systems:
  - Launchpad external cell ownership, Dictator WebSocket RPC, and Sheaf Chat Agent Review Mode.
