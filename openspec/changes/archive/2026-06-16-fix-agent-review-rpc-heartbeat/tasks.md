## 1. Sheaf Chat Dictator RPC Client

- [x] 1.1 Add a `rpc.ping` method to `DictatorRPCClient` using the existing request/response path.
- [x] 1.2 Start a keepalive timer when the Dictator RPC WebSocket opens and stop it on socket close, explicit disconnect, or session disposal.
- [x] 1.3 Route heartbeat failures through the existing Dictator bridge status update path so the Agent Review state reports disconnected/error status.
- [x] 1.4 Detect stale-session RPC errors such as `client session not found`, close the stale socket, reject pending requests, and allow the next call to reconnect.

## 2. Launchpad Cell Repaint Recovery

- [x] 2.1 Update Agent Review cell painting so a stale-session `launchpad.setCells` failure reconnects and retries the same cell update once.
- [x] 2.2 Preserve existing focus gating: while no browser client is focused, repaint recovery must send the all-off cell state rather than relighting available actions.
- [x] 2.3 Ensure failed reconnect or retry leaves browser Agent Review Mode usable and preserves the active review draft.

## 3. Contract Coverage

- [x] 3.1 Add or update Dictator RPC tests proving `rpc.ping` renews liveness and does not mutate cells, context, cursor state, or Launchpad actions.
- [x] 3.2 Add Sheaf Chat Agent Review tests proving a quiet active session sends heartbeat requests and retains Dictator-owned Launchpad cells past the timeout window.
- [x] 3.3 Add Sheaf Chat Agent Review tests proving an expired Dictator RPC session is reconnected and the current Launchpad cell colors are repainted without a browser refresh.
- [x] 3.4 Add Sheaf Chat Agent Review tests proving stale-session recovery failure preserves browser review state and draft entries.

## 4. Validation

- [x] 4.1 Run the Sheaf Chat Agent Review test suite.
- [x] 4.2 Run the Dictator service RPC tests.
- [x] 4.3 Run `openspec status --change "fix-agent-review-rpc-heartbeat"` and confirm the change is apply-ready.
