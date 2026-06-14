## REMOVED Requirements

### Requirement: vshu-1 — Project scaffold and manifest
**Reason**: The standalone VS Code unstaged-hunk extension is being deleted.
**Migration**: Use Sheaf Chat Agent Review Mode for unstaged hunk review.

### Requirement: vshu-2 — Pane visibility follows active-file unstaged hunks
**Reason**: The standalone VS Code unstaged-hunk review surface is being deleted.
**Migration**: Use Sheaf Chat Agent Review Mode for hunk discovery and focus.

### Requirement: vshu-3 — Hunk model and current hunk
**Reason**: The VS Code extension no longer owns a hunk model.
**Migration**: Use the Sheaf Chat Agent Review Mode hunk model.

### Requirement: vshu-4 — Hunk and file navigation APIs
**Reason**: VS Code hunk navigation commands are being removed with the extension.
**Migration**: Use Agent Review Mode navigation commands.

### Requirement: vshu-5 — Stage, revert, and undo current hunk
**Reason**: VS Code hunk mutation commands are being removed with the extension.
**Migration**: Use Agent Review Mode stage, revert, and undo commands.

### Requirement: vshu-6 — Reactivity to editor, filesystem, and Git changes
**Reason**: The VS Code extension no longer reacts to editor or workspace events for hunk review.
**Migration**: Agent Review Mode refreshes Git hunk state for chat sessions.

### Requirement: vshu-7 — Dictator controller protocol
**Reason**: The Dictator controller protocol for VS Code hunk panes is being removed.
**Migration**: Use the remaining Dictator bridge exposed by Sheaf Chat Agent Review Mode.

### Requirement: vshu-8 — Inline diff rendering
**Reason**: The VS Code inline/virtual document hunk rendering surface is being removed.
**Migration**: Use the Sheaf Chat file viewer and Agent Review Mode hunk display.

### Requirement: vshu-9 — Virtual hunk document mapping
**Reason**: Virtual hunk documents are being removed with the VS Code extension.
**Migration**: Use Agent Review Mode hunk snapshots and file-viewer coordinates.

### Requirement: vshu-10 — Current hunk review context
**Reason**: The VS Code extension no longer publishes current hunk review context.
**Migration**: Sheaf Chat Agent Review Mode publishes provider-neutral hunk snapshots.

### Requirement: vshu-11 — Mutation result review facts
**Reason**: VS Code extension mutation results are being removed.
**Migration**: Sheaf Chat Agent Review Mode continues to provide reverted/restored hunk facts for Dictator voice review.
