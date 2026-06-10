# Implementation Complete: Server File Browser API

## Summary

Slice 1 delivers the read-only REST file browser for chat sessions.

- Added `GET /api/piles/:pile/sessions/:sessionId/file?path=<relative-path>` for whole-file retrieval.
- Added `GET /api/piles/:pile/sessions/:sessionId/files?path=<relative-directory>` for directory listing (`path` defaults to `.`).
- Implemented reusable server helpers in `src/server/files/sessionBrowser.ts` (`CreateSessionRootPolicy`, `ResolveBrowserRelativePath`, `ReadSessionFile`, `ListSessionDirectory`) plus shared file classification in `src/extensions/sheaf-chat/fileClassification.ts`.
- Added `AgentManager.resolveSessionRootDirectory()` for provisional and manifested sessions without attaching the agent.
- Enforced browser-only root-relative path rules, symlink-escape protection, ignored directories, stable sorting, and explicit errors for missing, unsupported, and mistyped paths.

## Tests

- `tests/server/rest/files.test.ts` — success paths, provisional/manifested sessions, and escape/validation cases.
- `tests/server/files/sessionBrowser.test.ts` — browser rejection of absolute paths.
- Full `npm test` in `projects/sheaf-chat` passes (137 tests).

## Docs

- Updated `docs/reference/api.md` with the new endpoints and error codes.
