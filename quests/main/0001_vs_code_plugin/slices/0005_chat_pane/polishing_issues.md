# Issues

## Issue POL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-05-23T22:07:37Z
- updated_at: 2026-05-23T22:07:37Z
- title: Session and command failures do not consistently create chat error bubbles
- details: The spec requires the chat pane to show errors that affect the session or a user-visible command outcome, and the slice plan specifically calls for error bubbles for incoming `error` events and session-fatal failures. The current implementation only records incoming realtime `error` events in `ChatModel.ingestEvent()` and start failures in `SessionController.StartSession()`. Other user-visible failure paths are logged or shown outside the chat pane without a `ChatModel.recordError(...)` call: `CommitAndRespond()` catches `commitAudioAndCreateResponse()` failures and only logs them (`apps/vscode-extension/src/sessionController.ts:124`), microphone capture `onError` shows a VS Code error and stops the session with `audio_error` but only leaves a generic session-ended context bubble (`apps/vscode-extension/src/sessionController.ts:248`), and `connection_lost` is shown via VS Code error message after `onSessionEnded` has reset the chat model to a context bubble (`apps/vscode-extension/src/sessionController.ts:208`, `apps/vscode-extension/src/sessionController.ts:300`). This means the focused chat pane can miss exactly the failure context the user needs when a session or command fails.

  To mark this issue `completed`, session-fatal failures and user-visible command failures must produce `error` bubbles in the chat model without losing the existing session-ended context behavior. At minimum, cover `commitAudioAndCreateResponse()` rejection, microphone capture failure, and unexpected connection loss. Add or update focused tests so these paths are verified through `SessionController`/`ChatModel` behavior rather than only through log or UI message assertions.
- resolution_notes: none
