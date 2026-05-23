# step 3 — implementer

**thread:** sheaf_quest_0000_slice_0001_implementer

## output

# Implementer Role

You are the implementer for the current quest slice. Your job is to execute the
slice physical plan and deliver working code for that slice.

## Primary Responsibilities

- Implement the current slice according to `slices/<slice>/physicalplan/*.md`.
- Use existing APIs and patterns where appropriate.
- Keep changes clean, maintainable, and idiomatic for this repository.
- Ensure the slice is fully implemented before signaling completion.

## Implementation Expectations

- Follow the spec and physical plan as written.
- Keep scope limited to the current slice unless an explicit prerequisite is required.
- Add/update tests and validations needed to support the slice.
- Run relevant tests for the slice changes before signaling completion.
- Avoid unnecessary duplication and avoid over-generalizing abstractions.
- Remove obsolete code tied to replaced behavior unless otherwise specified.

## Completion Protocol

- Continue implementing until the full current slice plan is complete.
- When prompted:
  - If the full slice plan is complete, create `implementation_done.md` in the
    current slice directory with a brief completion summary.
  - If the slice is not fully complete, continue implementation work and do not
    create `implementation_done.md`.

## Escalation Rules

- If the physical plan cannot be completed without changing the spec, making major
  unspecified decisions, or resolving ambiguous requirements, create/update quest-root
  `human_intervention_request.md` with rationale and exit.
- If there is a critical blocker requiring human input, create/update quest-root
  `human_intervention_request.md` with clear details and exit.

## Scope Limits

- Do not modify `physicalplan_issues.md`.
- Do not mark reviewer-owned issues as `completed`.
- Do not edit role files.
- Focus on implementation artifacts for the current slice; use
  `human_intervention_request.md` only for escalation.


---

Quest Runtime Context
- Quest: main/0000_real_time_agent (Real Time Agent)
- Quest directory: /Users/joyo/Sheaf/quests/main/0000_real_time_agent
- Role: implementer
- Current slice: 0001_node_typescript_scaffold
- Current slice directory: /Users/joyo/Sheaf/quests/main/0000_real_time_agent/slices/0001_node_typescript_scaffold
- Quest documentation directory: /Users/joyo/conductor/docs/quest

Use the quest's `specs/` directory as the implementation specification for this quest. Use the quest documentation directory above as the stable reference for quest schemas, file formats, and workflow rules.

Task:
Implement the plan described in `0001_node_typescript_scaffold/physicalplan/`. Keep working until the full plan is complete. When the full plan is complete, create `implementation_done.md` in this slice with a brief completion summary.The user requests implementation of a quest slice following the physical plan in the slice directory.Implementing slice `0001_node_typescript_scaffold` per the physical plan. Reading the plan, spec, and current repo state.
There is no existing Node.js application in the repository.I need to implement the complete scaffold.

Let me design the following components for the realtime-agent package:

1. Create `apps/realtime-agent/package.json` with ESM configuration, library entry point `realtime-agent-lib`, and binary `realtime-agent`
2. Set up `tsconfig.json` for TypeScript compilation
3. Implement `src/types.ts` containing all public contracts
4. Build `src/index.ts` for exports
5. Create `src/cli.ts` with a stub that throws an error message
6. Add test directory with contract/export tests
7. Update README.md documentation
8. Modify Makefile for build commands
9. Add `.gitignore` entries for node_modules and dist directories

This scaffolding establishes the foundational structure for the realtime-agent package.

npm install will create package-lock.json in the apps/realtime-agent directory. The types from the spec include ToolDefinition, ToolRuntimeContext with sessionId, toolCallId, and metadata/logger extensions, ToolCallSet, AgentStartConfig, RealtimeEvent as a generic shape, EventDirection, and Callback hook types. I need to review the spec further to understand the callback types fully.

Callback hook types should include model conversation events and tool lifecycle notifications. I'll define reasonable types for these based on the spec, including EventDirection, RealtimeEvent, and ToolRuntimeContext interfaces with sessionId, toolCallId, and optional metadata.I'll define callback hooks in AgentStartConfig based on the slice 0005 hints.

I'll define callback hooks in AgentStartConfig based on the slice 0005 hints, including onEvent, onConversationEvent, and tool lifecycle callbacks.

For slice 0001, I'll add ConversationEventCallback, ToolLifecycleCallback/ToolLifecyclePhase, and AgentStartConfig with optional callbacks and optional/defaultable model. The default model constant will be `gpt-realtime-2`.

For package setup, I'll use type: module (ESM), TypeScript with tsc for build, and node:test for tests (built-in, no extra deps). Common pattern for Node TS packages includes:
```json
{
  "name": "realtime-agent",
  "type": "module",
```

The package.json includes exports for the main module and CLI binary, with build and test scripts using tsc and node --test respectively. The library entry point is named `realtime-agent-lib` and the CLI binary is `realtime-agent`. The build process compiles TypeScript to JavaScript, and tests run on the compiled output using node's built-in test runner. Alternatively, `tsx` could be used for tests but requires an additional dependency. The physical plan specifies separate naming for the library and CLI components.

The package exports a library entry point named `realtime-agent-lib` with types and import paths pointing to the compiled JavaScript files, using either `./lib` or `realtime-agent-lib` as export names.

The package uses "realtime-agent-lib" as the export name with corresponding types and import paths pointing to the compiled JavaScript files. The exports configuration follows the standard format where the main library is exported as "." and package metadata is accessible via "./package.json". The physical plan keeps the library and CLI components within one package, using separate naming conventions for clarity.

Consumers should import from `realtime-agent-lib`, using the package name `realtime-agent` with an export alias. The package exports a library entry point named `realtime-agent-lib` with corresponding types and import paths pointing to the compiled JavaScript files. In Node exports, the key `realtime-agent-lib` allows importing via `import ... from 'realtime-agent/realtime-agent-lib'` when the package name is `realtime-agent`. Alternatively, the package name could be `realtime-agent-lib` directly.

The package will be named "realtime-agent" with exports mapping the main entry point and library separately. The CLI executable will be accessible via the package name, while the library can be imported using the "realtime-agent-lib" export alias. The physical plan includes a single package containing both the CLI application and reusable library components under the apps/realtime-agent/ directory structure.

The library is imported using the package name `realtime-agent-lib`, with the CLI executable named `realtime-agent`. The package exports a main entry point at `./dist/index.js` and supports both `realtime-agent-lib` and `realtime-agent` as export names for clarity and compatibility.

The package exports a main entry point at `./dist/index.js` and includes a binary executable named `realtime-agent` located at `./dist/cli.js`. The library is imported using the package name `realtime-agent-lib`, with corresponding types and import paths pointing to the compiled JavaScript files. The physical plan maintains the library and CLI components within a single package under the apps/realtime-agent/ directory structure.

The types.ts file defines core contracts including `EventDirection` as either "incoming" or "outgoing", `DEFAULT_REALTIME_MODEL` set to "gpt-realtime-2", `RealtimeEvent` with a type string and arbitrary properties, and `ToolRuntimeContext` which includes session and tool call identifiers along with optional metadata and logging capabilities.

The `ToolDefinition` interface defines a tool with a name, optional description, input schema, and a callback function that takes arguments and context, returning a promise or value of a specified type.

The `ToolCallSet` interface represents a collection of tools, optionally grouped under a name.

`ConversationEventCallback` is a function type that handles real-time events with session and direction information.

`ToolLifecyclePhase` is a union type representing the phases of a tool's lifecycle: queued, started, succeeded, or failed.

`ToolLifecycleNotification` includes a session ID and other relevant information about a tool's lifecycle phase.

The `AgentStartConfig` interface now includes optional callback functions for handling conversation events, agent events, and tool lifecycle phases, alongside the required configuration such as `systemPrompt`, `initialContext`, and `toolCallSet`. These callbacks enable integration with external systems for real-time event handling and tool lifecycle management.

The `ToolLifecycleNotification` type defines the structure of notifications sent during tool lifecycle events, including the tool call ID, tool name, lifecycle phase, and an optional error message. This allows for detailed tracking and reporting of tool execution status.

index.ts re-exports all types from types.ts.

The CLI implementation is currently placeholder code that exits with an error message, as full implementation is pending until slice 0005.

Tests should verify that exports from the built dist directory are correctly exposed.

A minimal README file for the realtime-agent app is added in accordance with the root README convention, though the root README will be updated later to include a dedicated section for apps/realtime-agent.

The Makefile includes targets for building and testing the realtime-agent app, with build commands running npm install and npm run build inside the apps/realtime-agent directory.

The build and test processes for the realtime-agent app are executed within its directory using `npm install` and `npm test`. The CI pipeline retains existing Sheaf test targets without modifications. The `.gitignore` file excludes `node_modules` and `dist` directories for the realtime-agent app. A README.md file is added in the apps directory following the project's standard documentation convention. The tsconfig.json file sets compiler options targeting ES2022, using NodeNext module resolution, enabling strict mode, and generating declaration files.Creating the `apps/realtime-agent` package scaffold and updating root docs and Makefile.
Update README.md, Makefile, and .gitignore files, then run npm install and tests.Run npm install, build, test, and make targets.ToolCallSet uses ToolDefinition[] without generics, causing strict assignment issues.Use "unknown" for arguments in callbacks.The bin path in package.json incorrectly points to `./dist/cli.js` instead of the actual path `./dist/src/cli.js`.cli.js uses `export {}` to function as a module, which is acceptable for Node.js execution.All validations successful. The implementation_done.md file has been created in the slice directory.Validation passed. Creating the completion marker.
Slice **0001_node_typescript_scaffold** is implemented. Here is what was added.

### New package: `apps/realtime-agent/`

- **ESM TypeScript** package `realtime-agent-lib` with `npm run build` / `npm test`
- **Public contracts** in `src/types.ts`: `ToolDefinition`, `ToolRuntimeContext`, `ToolCallSet`, `AgentStartConfig`, `RealtimeEvent`, `EventDirection`, and conversation/tool lifecycle callback types
- **Library entry** `src/index.ts` re-exports all public types
- **CLI stub** `src/cli.ts` → binary `realtime-agent` exits with: `CLI implementation is not available until slice 0005`
- **Contract test** in `test/exports.test.ts`
- **Lockfile** `package-lock.json`, app **README**, `.gitignore` entries for `node_modules`, `dist`, and SQLite artifacts

### Root integration

- `README.md` lists the new app and quick-start commands
- `Makefile` adds `build-realtime-agent` and `test-realtime-agent` (existing `ci` target runs Sheaf tests)

### Validation run

- `npm install`, `npm run build`, `npm test` in `apps/realtime-agent`
- `make build-realtime-agent` and `make test-realtime-agent` from repo root

Completion marker: `quests/main/0000_real_time_agent/slices/0001_node_typescript_scaffold/implementation_done.md`

