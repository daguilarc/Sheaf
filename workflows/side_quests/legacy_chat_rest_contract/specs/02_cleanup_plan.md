# Cleanup Plan

## Purpose

This file turns the scope decisions into a concrete implementation plan for the
 side quest. It does not perform the work. It defines what the implementation
 phase must remove, update, or relocate.

## Workstreams

### 1. Remove Chainlit

- Delete all Chainlit-specific application code.
- Delete browser helper code that exists only to support Chainlit chat list or
  chat switching behavior.
- Remove documentation or setup references that present Chainlit as a supported
  chat surface.

### 2. Remove legacy chat REST references

- Remove all code that calls `/chats`.
- Remove all code that assumes chat creation/listing happens through `/chats`
  rather than `/threads`.
- Remove all code that assumes message send/history retrieval happens through
  `/chats/{id}/messages` or `/chats/{id}/metadata`.
- Remove all code that assumes per-thread REST history exists at
  `/threads/{id}/metadata` or `/threads/{id}/messages`.

### 3. Simplify iOS to canonical decoding only

- Remove iOS client helper methods for dead REST history endpoints.
- Remove decoding support for `chat_id`.
- Remove decoding support for `chats`.
- Remove decoding support for fallback `id`.
- Keep only canonical thread-first request and response shapes.

### 4. Remove legacy transcript compatibility

- Remove transcript rendering branches that exist only for historical chats.
- Remove transcript rendering support for `read_note`.
- Remove transcript rendering support for `write_note`.
- Remove transcript rendering support for `list_notes`.
- Keep transcript rendering focused on canonical live tool names only.

### 5. Normalize tool inventory

- Remove `repair_vault` from the agent tool registry.
- Implement `POST /vaults/repair`.
- Update docs so the canonical tool list matches the live registry exactly.
- Do not implement deferred tools during this work.

### 6. Documentation cleanup

- Update `README.md` to remove obsolete tool names.
- Ensure the README lists only canonical current tool names.
- Update planning docs that still describe old note-style tools or old alias
  names as if they were current.
- Leave future or unimplemented tools documented as future work only where that
  remains intentional.

## Canonical Post-Cleanup Contract

### REST

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

### Agent tools

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

## Explicitly Removed

### Legacy routes

- `POST /chats`
- `GET /chats`
- `POST /chats/{id}/messages`
- `GET /chats/{id}/metadata`
- `GET /chats/{id}/messages`
- `GET /threads/{id}/metadata`
- `GET /threads/{id}/messages`

### Legacy payload aliases

- `chat_id`
- `chats`
- fallback `id` where it is used as a compatibility decode path for thread/chat
  identity

### Legacy tool names

- `read_note`
- `write_note`
- `list_notes`

## Explicitly Deferred

- graph creation tooling
- SQLite TV
- additional user SQLite query capabilities beyond the current contract
- any other tool that remains planned but unimplemented today

## Acceptance Criteria

- No supported client path in the repository calls `/chats`.
- No supported client path in the repository calls
  `/threads/{id}/metadata` or `/threads/{id}/messages`.
- No supported client decoder accepts `chat_id`, `chats`, or fallback `id` as
  live API contract.
- No supported transcript renderer recognizes `read_note`, `write_note`, or
  `list_notes`.
- `repair_vault` is absent from the agent tool registry and present on the REST
  side instead.
- `README.md` reflects only the canonical live tool names.
- `POST /debug/log` remains available.
