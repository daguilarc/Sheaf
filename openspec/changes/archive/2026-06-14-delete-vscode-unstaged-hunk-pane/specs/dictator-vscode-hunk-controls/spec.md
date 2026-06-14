## REMOVED Requirements

### Requirement: dhc-1 — VS Code hunk state registry
**Reason**: Dictator no longer tracks VS Code hunk extension instances.
**Migration**: Use the remaining focused hunk provider bridge from Sheaf Chat Agent Review Mode.

### Requirement: dhc-2 — Focused instance selection
**Reason**: VS Code window instance selection is being removed with the VS Code hunk extension.
**Migration**: Dictator should select the remaining focused hunk provider without VS Code-specific instance state.

### Requirement: dhc-3 — Launchpad hunk-control coordinates
**Reason**: The VS Code-specific hunk-control layer is being removed.
**Migration**: Launchpad coordinates are no longer reserved for the deleted VS Code layer.

### Requirement: dhc-4 — LED action availability
**Reason**: VS Code pane action availability is being removed.
**Migration**: Remaining hunk-control rendering should use the active provider-neutral hunk target.

### Requirement: dhc-5 — Button gating and dispatch
**Reason**: VS Code command dispatch is being removed.
**Migration**: Remaining hunk-control dispatch should route only to the active supported hunk provider.

### Requirement: dhc-6 — State-driven render invalidation
**Reason**: VS Code snapshot, heartbeat, and disconnect invalidation is being removed.
**Migration**: Remaining render invalidation should follow the active supported hunk provider and voice review state.

### Requirement: dhc-7 — Protocol diagnostics
**Reason**: VS Code hunk protocol diagnostics are being removed.
**Migration**: Diagnostics should expose only remaining provider-neutral hunk review and Launchpad state.

### Requirement: dhc-8 — Current hunk patch context
**Reason**: Dictator no longer receives current hunk patch context from a VS Code hunk extension.
**Migration**: Sheaf Chat Agent Review Mode supplies provider-neutral hunk snapshots.

### Requirement: dhc-9 — Hunk mutation result facts
**Reason**: Dictator no longer receives VS Code hunk command results.
**Migration**: Sheaf Chat Agent Review Mode supplies reverted/restored hunk facts.

### Requirement: dhc-10 — Review state render invalidation
**Reason**: The VS Code hunk-control capability is being removed.
**Migration**: Keep review-state invalidation in the Launchpad/voice review implementation rather than a VS Code-specific capability.
