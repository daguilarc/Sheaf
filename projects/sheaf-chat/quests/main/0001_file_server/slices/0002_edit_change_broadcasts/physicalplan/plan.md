# Slice 2: Edit Change Broadcasts

## Objective

Notify connected Sheaf clients when the controlled agent edit tool successfully changes a file inside the same or an overlapping root directory.

Expected outcome:

- The `edit` tool emits a file-change notification only after `writeFile` succeeds.
- The server compares the changed absolute file path against all currently open websocket session roots.
- Matching clients receive a `file.changed` envelope with root-relative identity for their own chat root.
- Failed edits, aborted edits, no-op validation failures, and path escape attempts do not broadcast.

## Key Files And Systems

- `projects/sheaf-chat/src/extensions/sheaf-chat/tools/edit.ts`
- `projects/sheaf-chat/src/extensions/sheaf-chat/types.ts`
- `projects/sheaf-chat/src/extensions/sheaf-chat/tools/createScopedTools.ts`
- `projects/sheaf-chat/src/agents/piAdapter.ts`
- `projects/sheaf-chat/src/agents/sessionRuntime.ts`
- `projects/sheaf-chat/src/agents/manager.ts`
- `projects/sheaf-chat/src/protocol/envelopes.ts`
- `projects/sheaf-chat/src/protocol/sessionBroadcaster.ts`
- `projects/sheaf-chat/src/server/websocket.ts`
- `projects/sheaf-chat/tests/extensions/tools.test.ts`
- `projects/sheaf-chat/tests/server/websocket/protocol.test.ts`

## Existing APIs To Reuse

- Reuse `RootPolicy.ToRootRelativePath` and `AssertWithinRoot` to compute receiver-relative paths safely.
- Reuse `CreateChatEnvelope` for websocket messages.
- Reuse `SessionBroadcasterRegistry` as the authoritative set of live websocket fanout targets.
- Reuse `AgentManager` session root data and lifecycle/runtime state rather than rereading manifests in the broadcaster hot path.
- Reuse existing scoped tool execution paths so only the controlled edit tool can trigger notifications.

## APIs To Extend Or Modify

- Extend `ScopedToolContext` with an optional callback:

```ts
notifyFileChanged?: (event: {
  absolutePath: string;
  rootDirectory: string;
  source: "edit_tool";
}) => void | Promise<void>;
```

- Pass that callback from the Pi/session tool setup to the server/runtime layer. The callback should be omitted or inert in tests that construct tools directly unless the test opts in.
- Add `x_fileChangedKind = "file.changed"` to `protocol/envelopes.ts`.
- Extend `SessionBroadcasterRegistry` with an iteration/broadcast method, for example `BroadcastFileChanged(event)`, that examines all active broadcasters.
- Store each broadcaster's canonical root directory when it is created in `AttachChatWebSocketConnection`. Use the helper added in slice 1 to resolve that root without duplicating manifest/provisional lookup.

## Broadcast Semantics

Broadcast payload:

```json
{
  "eventType": "fileChanged",
  "path": "docs/readme.md",
  "fileId": "docs/readme.md",
  "changedAt": "2026-06-10T00:00:00.000Z",
  "source": "edit_tool"
}
```

Implementation details:

- Do not include absolute paths in the websocket payload.
- `path` and `fileId` are root-relative for the receiving session. They may differ between receivers if roots overlap at different depths.
- A changed file matches a receiver when `path.relative(receiverCanonicalRoot, changedCanonicalPath)` is neither parent-traversing nor absolute.
- The "overlapping roots" requirement is satisfied by checking whether the changed file is inside each receiver's canonical root. If root A contains root B, edits in the shared scope will match whichever open connection root contains the changed file.
- Canonicalize the changed file path after the successful write using `realpath` where possible; fall back only for clearly existing written files if platform behavior requires it.
- Broadcasts are direct live websocket envelopes created with `CreateChatEnvelope` and no `sequence`. They are not appended to session history and do not replay on reconnect; a reconnecting client will refresh open files through normal file API behavior as needed.

## Enabling Refactor

Add a focused utility such as `IsPathWithinRoot(candidate, canonicalRoot)` in a shared file-browser/path helper if the implementation would otherwise duplicate path-relative checks in multiple modules.

## Validation

- Unit test the edit tool callback fires exactly once after a successful write and does not fire on failed replacements, missing files, permission/read errors, aborts, or path escapes.
- Websocket tests with two open sessions:
  - same root: both receive `file.changed`;
  - parent/child roots: the child receives events for files inside the child, while it does not receive events for sibling files outside its root;
  - unrelated roots: no event.
- Assert payloads are receiver-relative and contain no absolute path.
- Assert a completed edit broadcasts after the file contents have changed by reading the file in the notification test path.
- Run `npm test` in `projects/sheaf-chat`.
