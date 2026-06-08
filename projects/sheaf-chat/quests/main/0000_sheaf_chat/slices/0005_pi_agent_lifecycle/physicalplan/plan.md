# Slice 5: Pi Agent Lifecycle

## Objective

Implement the in-memory `(pile, sessionId)` agent registry and Pi SDK adapter for new sessions, hot resume, cold resume, first-turn manifest creation, model switching, cancellation, and idle offload.

Expected outcome:

- Sessions transition through `cold`, `starting`, `active`, `idle`, `stopping`, and `failed`.
- New chats validate pile/root/model, allocate the session shell, create a scoped Pi agent, and accept the first user message without writing the manifest until the first assistant response completes.
- Cold resume loads manifest and Pi JSONL, rebuilds scoped tools from manifest root, and resumes with `SessionManager.open(sessionFile)`.
- Hot resume attaches callers to the existing registry entry.
- Idle offload flushes and disposes agents only when no clients are connected and no run/tool call is active.

## Key Files And Systems

- `projects/sheaf-chat/src/agents/manager.ts`
- `projects/sheaf-chat/src/agents/piAdapter.ts`
- `projects/sheaf-chat/src/agents/sessionRuntime.ts`
- `projects/sheaf-chat/src/agents/summarizer.ts`
- `projects/sheaf-chat/src/agents/lifecycle.ts`
- `projects/sheaf-chat/tests/agents/lifecycle/`

## Existing APIs To Reuse

- Pi SDK `createAgentSession`.
- Pi SDK `SessionManager.create(cwd, sessionDir?)` for new persistent sessions and `SessionManager.open(path)` for cold resume.
- Pi SDK `AuthStorage`, `ModelRegistry`, `DefaultResourceLoader`, and `SettingsManager` from slice 4.
- Pi session methods: `prompt`, `steer`, `followUp`, `setModel`, `abort`, `subscribe`, `dispose`, `isStreaming`, `sessionFile`, `sessionId`, `messages`.
- Scoped extension/tool factory from slice 3.
- Storage APIs from slice 2.

## APIs To Extend Or Modify

- Add `AgentManager` APIs:
  - `createBlankSession(pile, rootDirectory, model)`
  - `attachSession(pile, sessionId, clientId?)`
  - `submitUserMessage(key, message)`
  - `selectModel(key, model, applyTo)`
  - `cancelTurn(key)`
  - `markClientDetached(key, clientId)`
  - `getStatus(key)`
- Add a lifecycle event emitter for status, model, user-message acceptance, agent events, manifest updates, and errors. Slice 8 will bridge this to WebSockets.
- Add summarization path for first user message and deterministic fallback.

## Implementation Notes

- Use a single promise/lock per `(pile, sessionId)` to serialize startup and first-turn state changes. Multiple concurrent attachers should await the same startup.
- For first user message, start chat name/description generation immediately, but persist the initial manifest only after the first assistant message completed. If summarization fails, use a deterministic first-line truncated fallback.
- User messages accepted during streaming should call `steer` when `steer: true` and Pi supports it; otherwise call `prompt(..., { streamingBehavior: "followUp" })` or queue internally as next input. Broadcast acceptance is handled by slice 8, but the manager must report acceptance before Pi failure can drop it.
- Model switching validates through slice 4, updates future-turn model via `session.setModel`, updates manifest when present, and emits lifecycle/model events.
- Track active run/tool-call count from Pi events so offload never runs mid-turn or mid-tool.
- Offload timeout uses top-level `agent_idle_offload_seconds` from `global_config.json`; tests should use short fake timers.
- Do not expose any unscoped Pi tool list. Pass the scoped tool names and extension resource loader when creating each agent.

## Validation

- Unit tests with fake Pi sessions for state transitions, new session manifest deferral, initial manifest write after assistant completion, deterministic summary fallback, cold resume from manifest/JSONL, hot resume shared entry, queued/steered messages, model switch validation/update, cancellation, idle offload, and prevention of offload during active run/tool.
- Integration-style tests may use the copied Pi JSONL fixture for cold resume path validation.
