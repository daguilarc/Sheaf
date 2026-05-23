# Physical Plan: Node TypeScript Scaffold

## Objective

Create the repository structure, package metadata, TypeScript configuration, and initial public contracts for a new Node application and reusable TypeScript library. This slice establishes a buildable foundation only; it does not open realtime connections, create SQLite tables, capture audio, or run an agent session.

Expected outcome:

- A new `apps/realtime-agent/` package exists for both the CLI executable and reusable library.
- TypeScript source and test directories are in place.
- Public type contracts from the spec are defined and exported.
- Build/test scripts are available for the implementation slices that follow.
- Root documentation and make targets mention the new app without changing existing Sheaf server behavior.

## Key Files and Systems

- Add `apps/realtime-agent/package.json`.
- Add `apps/realtime-agent/tsconfig.json`.
- Add `apps/realtime-agent/src/types.ts`.
- Add `apps/realtime-agent/src/index.ts`.
- Add `apps/realtime-agent/src/cli.ts` with the final binary name and command entry point wired to return a clear "CLI implementation is not available until slice 0005" error. This keeps package scripts executable while making the incomplete runtime behavior explicit.
- Add `apps/realtime-agent/test/` with a small contract/export test.
- Add or update package manager lockfile at repo root if the selected Node package manager creates one.
- Update root `README.md` with the new app entry.
- Update root `Makefile` with `build-realtime-agent` and `test-realtime-agent` targets, preserving existing `build-macos`, `test-macos`, and `ci` behavior.

## Existing APIs to Reuse As-Is

- Reuse existing prompt file locations under `prompts/system-prompts/`; do not copy prompts into the new app.
- Reuse the repository's current top-level `apps/` organization.
- Reuse existing README convention that describes each app and gives per-app quick-start commands.
- Reuse existing Makefile style of delegating to an app directory.

## APIs to Define or Extend

Define the library's public contracts in `src/types.ts`:

- `ToolDefinition<TArgs = unknown, TResult = unknown>` with `name`, optional `description`, `inputSchema`, and `callback`.
- `ToolRuntimeContext` with at least `sessionId`, `toolCallId`, and a logger/metadata extension point suitable for later observability.
- `ToolCallSet` with optional `name` and `tools`.
- `AgentStartConfig` with `systemPrompt`, `initialContext`, `toolCallSet`, and optional/defaultable `model`.
- Generic `RealtimeEvent` shape that permits any valid event by retaining arbitrary fields.
- Direction and persistence-related literal types such as `EventDirection = "incoming" | "outgoing"`.
- Callback hook types for model conversation events and tool lifecycle notifications, but no operational implementation yet.

Package metadata should expose:

- A library entry point for `realtime-agent-lib`.
- A CLI binary named `realtime-agent`.
- ESM TypeScript output unless implementation constraints require CommonJS; choose one module format and keep all slices consistent.

## Enabling Refactor

No refactor of existing Sheaf server code is needed. The only enabling work is establishing the new Node package boundary and build scripts before implementation slices depend on it.

## Validation

- `npm install` or equivalent package-manager install succeeds from `apps/realtime-agent`.
- `npm run build` succeeds in `apps/realtime-agent`.
- `npm test` succeeds for the initial public contract/export test.
- Root `make build-realtime-agent` delegates correctly.
- Root `make test-realtime-agent` delegates correctly.

## Sequencing Notes

This slice must be completed before all other realtime-agent slices. Subsequent slices should extend the files created here rather than creating a second package or parallel type system.
