# Scope

## Quest

- Name: `legacy_chat_rest_contract`
- Main Quest: `obsidian_chat`
- Created: `2026-03-21`

## Summary

Finalize the chat REST and tool-call contract cleanup. This side quest no
longer evaluates whether to preserve legacy compatibility. The decision is to
remove obsolete chat APIs, remove legacy compatibility aliases, remove legacy
tool-name handling, and keep only one canonical way to express each public API
and each live tool.

## Contract Decisions

### Public chat contract

- The canonical chat REST surface remains thread-first.
- The canonical chat history contract is websocket handshake replay plus
  `committed_turn`.
- Legacy chat-first REST APIs are not supported and should be removed from the
  repository wherever referenced.
- Per-thread REST history helpers are not supported and should be removed from
  the repository wherever referenced.
- `POST /debug/log` stays and remains intentionally available because it is
  useful for bug logging and diagnosis.

### Public REST endpoints to keep

- `GET /health`
- `POST /debug/log`
- `GET /models`
- `POST /models/updateLocalModelList`
- `POST /threads`
- `GET /threads`
- `POST /threads/{thread_id}/archive`
- `POST /threads/{thread_id}/unarchive`
- `POST /threads/{thread_id}/enter-chat`
- `POST /vaults`
- `POST /vaults/repair`
- `POST /replica/sessions`
- `WS /ws/chat/{session_id}`
- `WS /ws/replica/{session_id}`

### Public REST endpoints to remove as dangling legacy contract

- `POST /chats`
- `GET /chats`
- `POST /chats/{id}/messages`
- `GET /chats/{id}/metadata`
- `GET /chats/{id}/messages`
- `GET /threads/{id}/metadata`
- `GET /threads/{id}/messages`

### Tool contract

- The live agent tool surface should use only the current canonical tool names.
- Legacy note-style tool names are not supported, should not be recognized, and
  should be removed from transcript rendering and compatibility code.
- `repair_vault` should stop being an agent tool and should move to a REST API.
- Unimplemented tools should remain unimplemented in this side quest.
- This side quest does not add new tools or implement deferred tools.

### Canonical live agent tools after cleanup

- `list_directory`
- `read_file`
- `create_file`
- `create_directory`
- `apply_patch`
- `move_path`
- `delete_path`
- `list_sqlite_databases`
- `create_sqlite_database`
- `run_sql`

### Tools and aliases to remove from live recognition

- `repair_vault` as an agent tool
- `read_note`
- `write_note`
- `list_notes`
- any historical tool-name mapping that treats old note-style names as current
- any duplicate naming layer that exposes the same tool capability under more
  than one supported name

### Compatibility and alias policy

- No legacy compatibility layer should remain for old chat APIs.
- No legacy compatibility layer should remain for old tool names.
- No response alias layer should remain for `chat_id`, `chats`, or fallback
  `id`.
- There should be only one supported field name for each payload field and only
  one supported route for each public action.
- Historical transcripts and legacy database data do not need compatibility
  support because they are being discarded for this cleanup.

## Scope of Removal

This side quest covers planning for removal of:

- all Chainlit-related code
- all code paths referencing `/chats`
- all iOS helpers for `/threads/{id}/metadata` and `/threads/{id}/messages`
- iOS decoding support for `chat_id`, `chats`, and fallback `id`
- transcript rendering branches that exist only for historical chats or legacy
  tool names in iOS and Obsidian
- README references to obsolete tool names
- stale tool-name references in planning docs where the names are no longer the
  intended contract

This side quest also covers planning for relocation of:

- `repair_vault` from agent tool surface to REST API surface

This side quest explicitly does not cover:

- implementing currently unimplemented tools such as graph creation, SQLite TV,
  or additional user SQLite operations
- redesigning the websocket protocol
- preserving support for old chats, old databases, or old transcript payloads

## Goals

- Define one authoritative public API catalog with no legacy duplicates.
- Define one authoritative live tool catalog with no legacy aliases.
- Remove all repository references to unsupported `/chats` and REST history
  helpers.
- Remove all repository references to legacy note-style tool names as supported
  commands.
- Remove stale iOS decoding aliases so the iOS client decodes only canonical
  field names.
- Move `repair_vault` out of the agent tool registry and document it as REST.
- Update top-level documentation so the README names only the real current
  tools.
- Preserve intentionally retained behavior only where explicitly approved, such
  as `POST /debug/log`.

## Required Outcomes

- The side quest must specify removal of all Chainlit code from the repository.
- The side quest must specify removal of all `/chats` client and helper usage.
- The side quest must specify removal of iOS helper methods for dead REST
  history endpoints.
- The side quest must specify removal of iOS compatibility decoding for
  `chat_id`, `chats`, and fallback `id`.
- The side quest must specify removal of transcript rendering support for old
  chats and for `read_note`, `write_note`, and `list_notes`.
- The side quest must specify README cleanup so only canonical tool names
  remain.
- The side quest must specify that dangling aliases are not replaced by new
  compatibility shims.
- The side quest must specify that `repair_vault` becomes REST, not a tool.
- The side quest must specify that deferred unimplemented tools remain deferred
  without further work here.

## Non-Goals

- Implement the cleanup in code during planning.
- Add compatibility layers for any retired route, field, or tool name.
- Implement graph creation, SQLite TV, or additional user SQLite query tools.
- Preserve rendering for deleted transcripts or legacy database content.
- Re-open the question of whether legacy support is worth keeping.

## Answered Questions

- `POST /debug/log` stays.
- `repair_vault` leaves the agent tool registry and moves to REST.
- iOS backward decoding for `chat_id`, `chats`, and fallback `id` should be
  removed.
- Historical mappings for `read_note`, `write_note`, and `list_notes` should be
  removed rather than retained.
