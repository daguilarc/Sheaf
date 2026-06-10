# Implementation Accepted: Edit Change Broadcasts (Slice 2)

## Decision

Accepted. The slice implements edit-tool file-change broadcasts to connected
websocket clients correctly and completely against the slice spec and physical plan.
No polishing issues were opened.

## What was delivered

- The `edit` tool emits a file-change notification only after `writeFile` succeeds,
  canonicalizing the changed path with `realpath` (with a safe fallback to the
  resolved absolute path). Failed replacements, missing files, invalid input, path
  escapes, and aborts do not notify.
- `ScopedToolContext` / `CreateScopedToolsInput` extended with an optional
  `notifyFileChanged(event)` callback (omitted/inert unless wired or opted into).
- `x_fileChangedKind = "file.changed"` added to `protocol/envelopes.ts`.
- `SessionBroadcaster.BroadcastFileChanged` fans out a receiver-relative
  `file.changed` envelope (root-relative `path`/`fileId`, `changedAt`, `source`),
  gated by `IsPathWithinRoot` against the broadcaster's canonical root.
  `SessionBroadcasterRegistry.BroadcastFileChanged` re-canonicalizes the changed
  path once and iterates all live broadcasters, so overlapping roots each receive
  their own correctly-relativized payload.
- Each broadcaster's canonical root is stored on websocket attach via slice 1's
  `CreateSessionRootPolicy` (`canonicalRoot`), and refreshed on reconnect.
- Wiring: `server.ts` binds `AgentManager.SetNotifyFileChanged` →
  registry broadcast; `AgentManager` threads `notifyFileChanged` into
  `CreateSheafPiSession` → `CreateScopedToolsExtension` → scoped tool context.
- Shared path helpers `IsPathWithinRoot` and `ToRootRelativePathFromCanonical`
  exported from `pathPolicy.ts` (the former renamed from the private `IsWithinRoot`,
  now hardened with `path.resolve` on both operands).

## Review basis

- Reviewed the implementer diff (commit `cf31a86`, slice-2 implementation) primarily
  via `git show`, with targeted reads of `pathPolicy.ts` and `sessionBrowser.ts` to
  confirm `RootPolicy.canonicalRoot` is realpath-derived and
  `CreateSessionRootPolicy` resolves provisional/manifested roots without attaching
  the agent.
- Confirmed the notify call is inside the success path after `writeFile`, so the
  "broadcast only after content changed" requirement holds; the unit test reads back
  content and exercises success, ambiguity, missing file, empty edits, symlink
  escape, and abort cases (notification count stays at 1 throughout).
- Confirmed payloads carry no absolute path: `path`/`fileId` are computed via
  `ToRootRelativePathFromCanonical` and the websocket tests assert the repo root
  never appears in the serialized payload and that `path` is non-absolute, with
  `sequence` undefined (not appended to history).
- Confirmed overlapping-root semantics: parent/child test shows the child receives
  only in-child edits while the parent receives the same file at a deeper relative
  path (`demo/docs/readme.md`); the unrelated-root test confirms exclusion.
- Confirmed the notify wiring chain is complete and set before any session is
  created (`SetNotifyFileChanged` runs during server construction), and the
  production callback is fire-and-forget (`void ...BroadcastFileChanged`) so a
  broadcast error cannot fail a successful edit.

## Polishing issues

None. `slices/0002_edit_change_broadcasts/polishing_issues.md` has no open or
completed issues.

## Notes

- Implementer reported `npm test` in `projects/sheaf-chat` at 142/142 passing. Per
  reviewer policy, tests were not re-run; sufficiency was assessed from the changed
  test code, which covers the spec's validation list.
- The websocket tests construct scoped tools directly and bind `notifyFileChanged`
  to the registry, exercising the broadcast/fanout logic rather than the full
  `piAdapter`/`manager` plumbing end to end. This is sanctioned by the slice spec
  ("the callback should be omitted or inert in tests that construct tools directly
  unless the test opts in"), and the plumbing was verified by reading the diff; not
  treated as a defect.

No escalations or harness issues affecting the review outcome were encountered.
