# Implementation complete

Slice 0003 updates agent and user documentation for the `sheaf VS Code` toolset and `modifyFile` workflow.

## Summary

- Expanded `BASELINE_VOICE_NAV_SYSTEM_PROMPT` to name `sheaf VS Code`, document `modifyFile` usage (buffer-only edits, exact text plus three-line context validation, mismatch recovery, freshness notifications, and spoken-code cursor insertion).
- Added `ResolveSystemPrompt` in `configCore.ts` (used by `getSystemPrompt`) and `test/prompts.test.ts` covering built-in content and custom-prompt override behavior.
- Updated `docs/architecture/VSCODE_EXTENSION.md`, `docs/architecture/ARCHITECTURE.md`, `apps/vscode-extension/README.md`, and the `sheaf.realtime.systemPrompt` setting description.

## Validation

- `npm run lint --prefix apps/vscode-extension` — pass
- `npm test --prefix apps/vscode-extension` — 90 tests pass
