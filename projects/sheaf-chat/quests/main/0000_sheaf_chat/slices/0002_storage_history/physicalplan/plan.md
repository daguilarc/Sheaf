# Slice 2: Storage, Manifests, And History

## Objective

Implement the persistent data layer for piles, session manifests, Pi JSONL files, sequenced chat envelopes, and paged history reads.

Expected outcome:

- Runtime data is rooted at `data/sheaf-chat/`.
- Piles live under `data/sheaf-chat/sessions/piles/<pile>/`.
- Session JSONL and manifest files use the required sibling paths: `<sessionId>.jsonl` and `<sessionId>.manifest.json`.
- Pile names and session IDs are validated as safe single path segments.
- The initial manifest is explicitly deferred until after the first assistant message completes.
- History can be read by `before`, `after`, or latest-page semantics without blocking live appenders.

## Key Files And Systems

- `projects/sheaf-chat/src/storage/paths.ts`
- `projects/sheaf-chat/src/storage/validation.ts`
- `projects/sheaf-chat/src/storage/piles.ts`
- `projects/sheaf-chat/src/storage/manifests.ts`
- `projects/sheaf-chat/src/storage/history.ts`
- `projects/sheaf-chat/src/storage/sessionLog.ts`
- `projects/sheaf-chat/tests/storage/`
- Optional fixture directory: `projects/sheaf-chat/tests/fixtures/pi-sessions/`

## Existing APIs To Reuse

- Shared types and config from slice 1.
- Node `fs/promises`, `path`, `crypto`, and stream/readline APIs.
- Pi `SessionManager.open(path)` and `SessionManager.create(cwd, sessionDir?)` are planned consumers of these paths in slice 5; this slice should expose paths cleanly for that use.

## APIs To Extend Or Modify

- Extend shared types with concrete `SessionManifest`, `ProvisionalSession`, `HistoryPage`, and `SessionLogEntry` shapes.
- Add storage APIs:
  - `validatePileName(name): string`
  - `validateSessionId(id): string`
  - `createPile(pile)`
  - `listPiles()`
  - `allocateSessionShell(pile, rootDirectory, model)`
  - `writeInitialManifest(...)`
  - `updateManifest(...)`
  - `readManifest(pile, sessionId)`
  - `listSessionManifests(pile)`
  - `appendEnvelope(pile, sessionId, envelope)`
  - `readHistoryPage(pile, sessionId, request)`

## Implementation Notes

- Enforce the recommended pile regex `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and reject `.`, `..`, slashes, backslashes, empty names, and names that normalize differently. Apply equivalent safe-stem validation to session IDs.
- Generate server session IDs when possible; if clients ever supply IDs, route through the same validator.
- Store `rootDirectory` as an absolute path when possible. On resume, the manifest value is authoritative.
- Maintain monotonic `history.lastSequence` per session. The implementation can derive latest sequence by scanning the Sheaf Chat log initially, but expose a single allocator/append API so later slices do not assign sequences ad hoc.
- Store Sheaf Chat envelopes either in the Pi JSONL file with distinguishable metadata entries or in a companion history file if Pi JSONL semantics cannot safely carry service frames. The chosen shape must support replay of AGUI events, user messages, status frames, model changes, and history snapshots. Do not persist host-only absolute paths in user-visible payloads.
- Copy the spec's Pi session JSONL into `tests/fixtures/pi-sessions/` only if tests need a realistic cold-resume/history fixture.

## Validation

- Unit tests for path traversal rejection, Unicode normalization rejection, symlink/root path handling for data directories, pile creation/listing, session shell allocation, manifest deferral, manifest write/update, newest-first session listing, sequence allocation, and history pages for `before`, `after`, and latest page.
- `make sheaf-chat-test`
