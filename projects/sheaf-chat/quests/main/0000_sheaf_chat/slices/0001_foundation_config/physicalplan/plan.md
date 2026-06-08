# Slice 1: Foundation And Configuration

## Objective

Create the Sheaf Chat service foundation so later slices have a typed Node.js project, service entry point, configuration loading, and shared protocol/data definitions to build on.

Expected outcome:

- `projects/sheaf-chat` becomes a real Node/TypeScript project using repo-local build/test conventions.
- `make sheaf-chat-build`, `make sheaf-chat-test`, and `make sheaf-chat-run` exist and are wired from the root Makefile.
- `config/services.json` registers `sheaf-chat` on port `9004` with command `make sheaf-chat-run`.
- `config/global_config.json`, `config/api_keys.json`, and `config/api_keys.example.json` contain non-secret Sheaf Chat config and secret placeholders required by the spec.
- Shared types exist for piles, sessions, manifests, model references, REST errors, WebSocket envelopes, lifecycle state, and AGUI wrapper events.

## Key Files And Systems

- `projects/sheaf-chat/package.json`, `package-lock.json`, `tsconfig.json`
- `projects/sheaf-chat/Makefile`
- `projects/sheaf-chat/src/server/`, especially app entry and config modules
- `projects/sheaf-chat/src/shared/` or equivalent for common types/errors
- `projects/sheaf-chat/tests/` test runner and first unit tests
- Root `Makefile`
- `config/services.json`, `config/global_config.json`, `config/api_keys.example.json`, and non-secret shape handling for `config/api_keys.json`

## Existing APIs To Reuse

- Existing root Makefile project pattern and `realtime-agent` TypeScript/test conventions: `tsc`, Node's built-in test runner, `dist`, `node >= 20`.
- Existing service registry format in `config/services.json`.
- Existing AGUI schema file at `structure/schemas/ag_ui_events.schema.json` as the canonical AGUI event contract.

## APIs To Extend Or Modify

- Extend root Makefile phony targets with `sheaf-chat-run`.
- Extend config loading with a `sheaf_chat` section in `global_config.json` for at least `local_inference_url` and `agent_idle_offload_seconds`.
- Extend `api_keys.example.json` with `local_inference_api_key`; runtime code must tolerate missing real keys and return unavailable model metadata rather than crashing.

## Implementation Notes

- Keep service-owned code under `projects/sheaf-chat/src/`; do not place Sheaf Chat-specific UI or backend logic in `projects/web`.
- Prefer a small dependency set: TypeScript, `@types/node`, `ws`, and `@earendil-works/pi-coding-agent` only when needed by later slices. If dependencies are introduced here, lock them in `projects/sheaf-chat/package-lock.json`.
- Define one stable REST error helper returning `{ error: { code, message } }`.
- Define shared validation constants for pile names and session IDs, but leave filesystem implementation to slice 2.
- Define `ChatEnvelope` exactly as in the spec with `v: 1`, `kind`, `id`, `(pile, sessionId)`, optional `clientId`, optional server `sequence`, ISO `timestamp`, and optional `payload`.
- Use `crypto.randomUUID()` for frame IDs unless later storage chooses ULIDs for session IDs.

## Validation

- `make sheaf-chat-build`
- `make sheaf-chat-test`
- Unit tests for config loading defaults, missing optional secrets, REST error formatting, and envelope construction.
- JSON validation by loading all edited config files.
