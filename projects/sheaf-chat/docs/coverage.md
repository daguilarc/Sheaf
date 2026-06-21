# Spec Coverage

Last audit: repository/workspace chat apply, 2026-06-14

| Capability | Status | Gaps |
|---|---|---|
| service | partial | profiling points unenumerated, registry fields unused, shutdown race details not audited beyond `/exit` |
| repo-workspaces | partial | home discovery path is intentionally narrow, path-derived ids change after moves |
| workspace-chats | partial | list/create/read chat routes; legacy pile/session REST surface and storage removed |
| session-history | partial | external-writer cache staleness, no retention, `messageCount` unmaintained |
| chat-protocol | partial | WS close codes, hub lifetime, `client.hello` unused, `clientId` echo semantics |
| agent-runtime | partial | no LLM summarizer wired, `followUp` handle method unused, failed-state recovery loose |
| models | partial | one-shot fetch, OpenAI OAuth dir unused, no refresh surface |
| agui-mapping | partial | events carry no timestamps in practice, schema validator off hot path |
| scoped-tools | partial | path-escape activity wired to a no-op, audit log in-memory only |
| chat-ui | partial | fixed reconnect delay, unbounded outbound queue, shared renderer out of scope |
| file-browser | partial | chat-message Markdown delegated to shared renderer, no file/list size limits, fragment anchors limited |

## Known gaps

### service
- `POST /exit` provides the standard service shutdown path. Recovery after a
  kill mid-append relies on the history log's parse-skip behavior and is
  unspecified.
- The `command` and `home_path` fields of the `services.json` entry are not
  read by this service (boot uses only `host`/`port`).
- The full set of `SHEAF_CHAT_PROFILE_STREAM` checkpoint names is not
  enumerated (Design-level only; the format is specified in svc-12).
- The service writes no log files; whether it should follow the
  `logs/<service>/` convention in
  [structure/logs-and-data.md](../../../structure/logs-and-data.md) is
  unresolved.

### repo-workspaces
- Repository discovery intentionally inspects only direct children of the
  user's home directory. Nested repositories are invisible by design.
- `repoId` and `workspaceId` are path-derived. Moving a repository or
  worktree changes identity; no migration is provided.
- `editor-state.json` is last-writer-wins and has no per-device merge policy.

### workspace-chats
- The legacy pile/session API and storage layout are removed. Existing
  `data/sheaf-chat/sessions/...` data is not read or migrated; delete
  `data/sheaf-chat` when resetting to the new layout.

### session-history
- The in-process latest-sequence cache means envelopes appended to the log
  file by an external writer during process lifetime are not seen by
  sequence allocation; behavior is unspecified.
- Paging loads the entire log per request; no size/retention/compaction
  story exists for long sessions.
- `manifest.history.messageCount` is written as 0 and never incremented
  (also noted in the session-files contract).
- Appends are not fsynced; durability on crash is OS-default.

### chat-protocol
- WebSocket close codes are unspecified (`ws` defaults; nothing pinned).
- `SessionPersistenceHub`s are never released: after all clients detach,
  the hub keeps subscribing and persisting agent events for the session
  until process exit. Memory growth over many sessions is unaddressed.
- `client.hello` capabilities (`supportsSnapshots`, `supportsLazyHistory`,
  `lastSeenSequence`) are parsed and ignored; intended semantics
  unspecified.
- Which server frames carry `clientId` is inconsistent (connection-local
  frames echo the connecting client's id; persisted broadcasts do not);
  not specified beyond the envelope schema marking it optional.
- The persisted `chat.user_message` payload records `steer: true` even when
  the client omitted `steer` (the runtime delivery uses the raw value);
  divergence is unspecified.

### agent-runtime
- No LLM-backed summarizer is wired; the `CreateSessionSummarizer.generate`
  hook is test-only. Chat names are always the deterministic fallback.
- `PiSessionHandle.followUp` exists but the runtime delivers non-steer
  messages during streaming via `prompt(text, {streamingBehavior:
  "followUp"})`; the unused method's purpose is unspecified.
- A runtime in `failed` state stays in the registry; the next attach
  retries startup, but there is no backoff or fail-fast policy.
- `AgentStatusSnapshot` is only partially surfaced (`server.hello`); fields
  like `isStreaming`, `activeRunCount`, `connectedClientCount` have no
  external consumer and are unspecified beyond Design.
- `lastOpenedAt` is never updated on attach.

### models
- The local model list is fetched once at process start; there is no
  refresh endpoint, timer, or cache invalidation.
- `data/sheaf-chat/auth/openai/` is resolved by `ResolveOpenAiAuthDir` and
  asserted in tests, but no runtime path reads or writes it; the OpenAI
  OAuth/subscription flow is not implemented in this service.
- OpenAI availability delegates to Pi's `hasConfiguredAuth`; the exact
  sources Pi consults (env vars, stored auth) are not specified here.
- `BuildLocalProviderRegistration` falls back to base URL
  `http://127.0.0.1/v1` when the config URL is null (registration always
  happens); the fallback is effectively dead because such models are
  unavailable, but it is unpinned.

### agui-mapping
- Mapped events carry `timestamp` only when the mapper context provides
  `timestampMs`, and the persistence hub never does — so persisted AGUI
  events have no timestamps and snapshot `timestamp` fields are absent in
  practice.
- `src/agui/schemaValidation.ts` (Ajv against the repository schema) is
  exercised by tests only; runtime events are not schema-validated before
  persistence.
- `mapSheafActivityToAgui` uses a module-global mapper instance; its only
  state use is event construction, but the sharing is unspecified.
- The `rawEvent` echo on every mapped event roughly doubles persisted
  payload size; intentionality is unspecified.

### scoped-tools
- The service binds the extension with a no-op `emitActivity`
  (`CreateDefaultBindings()` in `src/agents/piAdapter.ts`), so
  `sheaf_chat.path_escape_denied` activity never reaches the chat stream
  even though [agui-mapping](../../../openspec/specs/sheaf-chat-agui-mapping/spec.md) defines the
  mapping. Browser-visible escape reporting is currently aspirational.
- The audit logger accumulates escape events in memory with no read
  surface.
- `find_files`/`search_text` with no `maxDepth` walk the full tree;
  no time or size budget exists beyond match limits.
- Binary detection is NUL-in-first-8KB only; UTF-8 validity is not
  otherwise checked.

### chat-ui
- Reconnect is a fixed 1500 ms retry with no backoff or cap; the outbound
  queue is unbounded in memory.
- The shared transcript renderer (`projects/web/src/agui-chat.js`) is
  consumed via its API but specified outside this project; that includes the
  transcript-side Markdown/KaTeX rendering used by chat messages. Sheaf Chat
  now has browser integration coverage that verifies the shared renderer is
  loaded and produces Markdown/KaTeX DOM through the service-owned UI shell.
- The history "limit 5000" initial load means very long sessions transfer
  their whole recent log on open; no incremental initial strategy is
  specified.
- Browser support floor (e.g. `crypto.randomUUID` fallback path) is
  untested/unspecified.

### file-browser
- `GET /file` reads the entire file into memory and `GET /files` reads an
  entire directory with no documented size, entry-count, or latency budget.
- Browser integration coverage exercises read-only Emacs-style point
  movement, `C-g`, mark/region exchange, incremental search, find-file,
  buffer/tab switching, Markdown source-offset navigation, point/viewport
  synchronization, smart-case search, two-step search wrap behavior,
  Agent Review hunk point-following, and a deterministic mixed-command
  simulation through Playwright.
- Chat-message Markdown/KaTeX rendering is delegated to the shared web
  renderer; Sheaf Chat documents only the file-link handler it passes in.
- Fragment navigation preserves `#fragment` and attempts to scroll to an
  exact DOM id, but the current Markdown-it configuration does not generate
  heading ids, so ordinary Markdown heading fragments usually have no target.
- Permission-denied and other unexpected filesystem errors from file reads
  or directory listings fall through the generic service `internal_error`
  path with the thrown message; there is no file-browser-specific error code.
- Agent Review compatibility is covered by server/API tests, retained UI
  smoke coverage, and a Chromium flow that drives hunk navigation, comment
  placement, next-file review navigation, and focused-hunk staging.

#### Unified Source Rendering Coverage

Last audit: unified Agent Review source rendering, 2026-06-21

| Scenario | No-hunk coverage | Hunk-bearing coverage |
|---|---|---|
| Syntax highlighting | `browserChat.integration.test.ts` highlighted file navigation; `chatScreen.test.ts` mapped Highlight.js tests | `chatScreen.test.ts` Agent Review hunk Highlight.js test; `repoWorkspaceFlow.integration.test.ts` hunk-aware source rendering |
| Point/navigation | `browserChat.integration.test.ts` file view movement, line movement, page movement, viewport sync, deterministic simulation | `repoWorkspaceFlow.integration.test.ts` Agent Review hunk focus, point following, next-file focus, hunk-aware search/mark flow |
| Mark/region | `browserChat.integration.test.ts` mark, active region, `C-x C-x`, and `C-g` mark deactivation | `repoWorkspaceFlow.integration.test.ts` region on deleted virtual hunk text |
| Incremental search | `browserChat.integration.test.ts` forward/reverse search, smart case, cancellation, direction switch, and wrap behavior | `repoWorkspaceFlow.integration.test.ts` search in inserted text, deleted text, and both sides of an edit |
| Pure insertion | n/a | `repoWorkspaceFlow.integration.test.ts` separated pure insertion fixture and exact row/search assertions |
| Pure deletion | n/a | `repoWorkspaceFlow.integration.test.ts` separated pure deletion fixture, search, mark/region, and text stability assertions |
| Edit replacement | n/a | `repoWorkspaceFlow.integration.test.ts` old-side and new-side row, highlighting, and search assertions |
| Text stability | `browserChat.integration.test.ts` rendered file point/text stability | `repoWorkspaceFlow.integration.test.ts` hunk code-cell text stability after search and mark/region decoration |
| Agent Review behavior | n/a | `repoWorkspaceFlow.integration.test.ts` hunk reveal, focus survival after movement/search, comments, staging, next-file navigation |

Targeted validation passed on 2026-06-21:

- `npm run build`
- `node --test dist/tests/ui/chatScreen.test.js --test-name-pattern "Agent Review|Highlight|highlight|Emacs|search|mark"` (34/34)
- `node --test dist/tests/integration/browserChat.integration.test.js --test-name-pattern "file view|highlighted|search|mark|navigation"` (18/18)
- `node --test dist/tests/integration/repoWorkspaceFlow.integration.test.js --test-name-pattern "Agent Review|hunk-aware source rendering"` (3/3)

The full `npm test` command passed on 2026-06-21 when rerun with unsandboxed
Chromium process launch permissions. The earlier sandboxed attempt failed
before assertions because macOS denied Chromium's Mach bootstrap registration.

## Observed code/spec mismatches (candidate fixes, not spec gaps)

- The previous docs claimed the history page limit was capped at 200; the
  code caps at 5000 (`x_maxHistoryLimit`). Docs now follow the code.
- The previous docs claimed path-enforcement activity is visible to browser
  clients; the wiring is a no-op (see scoped-tools gap).
- The previous docs claimed session ids use the same pattern as pile names;
  generated repo/workspace/chat ids now use the shared identity-id pattern.
