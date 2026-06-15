## REMOVED Requirements

### Requirement: ps-10 — Workspace chats: list chats

**Reason**: The `sheaf-chat-piles-sessions` capability is renamed to `sheaf-chat-workspace-chats` so the spec id/title match its content (the requirements describe workspace chats, not piles). The capability still kept the legacy "piles-sessions" name only as a side effect of the earlier pile→workspace migration, which synced requirement deltas but never updated the capability prose.
**Migration**: Same behavior, re-homed as `wc-1 — Workspace chats: list chats` in `sheaf-chat-workspace-chats`.

### Requirement: ps-11 — Workspace chats: create chat shell

**Reason**: Capability renamed to `sheaf-chat-workspace-chats`; the `ps-` prefix is retired with the old name.
**Migration**: Same behavior, re-homed as `wc-2 — Workspace chats: create chat shell` in `sheaf-chat-workspace-chats`.

### Requirement: ps-12 — Workspace chats: read chat manifest

**Reason**: Capability renamed to `sheaf-chat-workspace-chats`; the `ps-` prefix is retired with the old name.
**Migration**: Same behavior, re-homed as `wc-3 — Workspace chats: read chat manifest` in `sheaf-chat-workspace-chats`.
