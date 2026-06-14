## REMOVED Requirements

### Requirement: vdr-1 — Active diff review state
**Reason**: Dictator no longer owns active diff review state.
**Migration**: Sheaf Chat Agent Review Mode owns the active review draft, ordered entries, hunk comment text, reverted markers, and clearing semantics.

### Requirement: vdr-2 — Hunk-aware review comment recording
**Reason**: Review comments are no longer recorded through a Dictator-owned audio mode.
**Migration**: Sheaf Chat opens a focused hunk-local text box from the `(3,3)` Launchpad cell; users may dictate normally into that text box, and Sheaf Chat may push hunk context through `dictator-websocket-rpc`.

### Requirement: vdr-3 — Reverted hunk tracking
**Reason**: Reverted-hunk review markers are review-domain state and no longer belong to Dictator.
**Migration**: Sheaf Chat records and removes reverted markers as part of its Agent Review Mode state when its own hunk mutation commands succeed or are undone.

### Requirement: vdr-4 — Review serialization and clearing
**Reason**: Dictator no longer serializes or clears reviews.
**Migration**: Sheaf Chat serializes the active review and calls `cursor.insertText` over `dictator-websocket-rpc`; Sheaf Chat clears its review only after the RPC reports successful insertion and clipboard restoration.

### Requirement: vdr-5 — Review diagnostics
**Reason**: Dictator no longer has voice diff review state to diagnose.
**Migration**: Dictator diagnostics report generic WebSocket RPC clients, owned Launchpad cells, and pushed context blocks; Sheaf Chat diagnostics report Agent Review Mode state.
