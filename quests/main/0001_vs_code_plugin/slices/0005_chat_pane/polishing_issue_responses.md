# Issue responses

## Response POL-0001 2026-05-23T22:25:00Z

- issue_id: POL-0001
- outcome: Fixed
- explanation: Routed the three previously-missing user-visible failure paths
  through `ChatModel.recordError(...)` so the chat pane reliably surfaces an
  `error` bubble for session/command failures, while preserving the existing
  session-ended context bubble.

  Changes in `apps/vscode-extension/src/sessionController.ts`:

  - `CommitAndRespond()` now records a `Commit failed: <message>` error bubble
    when `commitAudioAndCreateResponse()` rejects, in addition to the existing
    log line.
  - The microphone capture `onError` callback now records a
    `Microphone error: <message>` error bubble before the existing
    `showErrorMessage` + `StopSession("audio_error")` calls. The session-ended
    context bubble produced by the subsequent stop still appears after it.
  - `HandleSessionEndedUnexpectedly` now records a
    `Connection to OpenAI was lost.` error bubble when the reason is
    `connection_lost`. Because `onSessionEnded` resets the chat model first,
    the resulting bubble order is the session-ended context bubble followed by
    the error bubble, so the original context behavior is preserved.

  Tests added in `apps/vscode-extension/test/sessionController.test.ts` (using
  a real `ChatModel` injected via `SessionControllerDeps.chatModel`):

  - `SessionController start failure records error bubble in chat model`
    verifies the start-failure path (already covered by the implementation,
    now also asserted through the chat model rather than only UI errors).
  - `SessionController commit failure records error bubble in chat model`
    forces `commitAudioAndCreateResponse` to reject and asserts a single
    `error` bubble whose message contains the underlying error.
  - `SessionController microphone capture failure records error bubble in
    chat model` triggers the captured `onError` callback and asserts a single
    `error` bubble mentioning "microphone" and the underlying message.
  - `SessionController connection lost records error bubble alongside session
    ended context` invokes the captured `onSessionEnded` with
    `reason: "connection_lost"` and asserts that the chat model ends up with
    both a `context_push` (session ended) bubble and a `connection`-themed
    `error` bubble, confirming the context behavior is not lost.

  All 47 tests in `apps/vscode-extension` pass (`npm test`) and `npm run build`
  still succeeds.
