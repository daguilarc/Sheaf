# Slice 0002 Implementation Complete

## Summary

Implemented the persistent storage layer for piles, session manifests, sequenced chat envelopes, and paged history reads under `data/sheaf-chat/`.

## Delivered

- **Storage paths** (`src/storage/paths.ts`): data-root resolution, pile/session file paths, absolute `rootDirectory` resolution, and symlink-aware containment checks.
- **Validation** (`src/storage/validation.ts`): `ValidatePileName` and `ValidateSessionId` with traversal, reserved-name, and Unicode NFC rejection.
- **Piles** (`src/storage/piles.ts`): `CreatePile`, `ListPiles`, and pile existence helpers with session counts and latest manifest update times.
- **Manifests** (`src/storage/manifests.ts`): deferred initial manifest via `WriteInitialManifest`, `ReadManifest`, `UpdateManifest`, and newest-first `ListSessionManifests`.
- **Session log** (`src/storage/sessionLog.ts`): `AllocateSessionShell` (provisional sidecar, empty Pi JSONL, companion history file), monotonic `AppendEnvelope`, and sequence scanning.
- **History** (`src/storage/history.ts`): non-blocking `ReadHistoryPage` with `before`, `after`, and latest-page semantics.
- **Shared types**: `AllocatedSessionShell`, `HistoryPage`, `HistoryPageRequest`, `SessionLogEntry`, and manifest write/update inputs.
- **Tests** (`tests/storage/`): path traversal, Unicode normalization, symlink escape, pile CRUD/listing, manifest deferral/update, sequence allocation, and history pagination.

## Design Notes

- Sheaf Chat envelopes are stored in a companion `<sessionId>.sheaf-history.jsonl` file so Pi JSONL semantics stay isolated for slice 5.
- Provisional session metadata persists in `<sessionId>.provisional.json` until the first assistant turn writes the manifest.
- `AppendEnvelope` is the single sequence allocator; manifest `history.lastSequence` updates when a manifest exists.

## Validation

- `make sheaf-chat-test` — 23 unit tests pass
