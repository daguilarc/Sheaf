# Decisions

- 2026-03-21: Side quest created.
- 2026-03-21: Legacy chat compatibility will be removed rather than preserved.
- 2026-03-21: All Chainlit-related code should be removed.
- 2026-03-21: `/chats` routes and per-thread REST history helpers are treated as dead contract and should be removed from all supported clients and docs.
- 2026-03-21: iOS compatibility decoding for `chat_id`, `chats`, and fallback `id` should be removed.
- 2026-03-21: Historical transcript handling for `read_note`, `write_note`, and `list_notes` should be removed.
- 2026-03-21: `repair_vault` should move from agent tool surface to REST API surface.
- 2026-03-21: Deferred unimplemented tools remain deferred with no implementation work in this side quest.
- 2026-03-21: `POST /debug/log` remains intentionally available.
- 2026-03-21: `repair_vault` is implemented as `POST /vaults/repair`, reusing the existing server-side repair logic instead of keeping a tool alias.
- 2026-03-21: Quest moved to `polishing`; reviewer issue about `status.md` still saying `planning` is closed by updating the documented stage and summary.
- 2026-03-21: `apps/obsidian-replica/.test-dist/` is treated as generated test output and should not remain tracked in git.
- 2026-03-21: Obsidian replica tests lazy-load `requestUrl` so Node-based unit tests can instantiate chat services without resolving the runtime-only `obsidian` package up front.
- 2026-03-21: Quest moved to `complete` with human approval after reviewer follow-ups were resolved and no `open` issues remained in `issues.md`.
