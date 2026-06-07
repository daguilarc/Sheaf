# Turn Model

Realtime Agent supports two turn detection modes through `RealtimeAgentTurnMode`.

## Server VAD (CLI default)

The CLI configures server VAD with:

- 500 ms silence threshold
- Automatic response creation
- Response interruption enabled

Behavior:

1. Audio frames append continuously to `input_audio_buffer`.
2. The Realtime API detects end-of-speech from server VAD.
3. The API commits audio and creates responses without explicit caller action.
4. Startup sends an initial `response.create` after injecting prompt and context.

`session.update` sets `audio.input.turn_detection` to server VAD parameters. This
mode suits unattended microphone sessions where turn boundaries should be inferred
from silence.

## Manual turn (VS Code extension)

The extension always starts sessions in manual turn mode:

```ts
{ type: "manual" }
```

Behavior:

1. Audio frames stream continuously while the session is active.
2. The model does not answer from raw audio append events alone.
3. `F20` or **Sheaf: Commit Audio And Request Response** calls
   `commitAudioAndCreateResponse()`, which sends `input_audio_buffer.commit` and
   `response.create` as one ordered queued unit.

`session.update` sets `audio.input.turn_detection` to `null`. Startup does not
send an initial `response.create`.

Manual mode makes turn boundaries explicit in the editor. The user decides when
buffered speech is committed and when the model should respond.

## Response queue interaction

Both modes route response-affecting operations through the response queue:

- `commitAudio()`
- `createResponse()`
- `commitAudioAndCreateResponse()`
- Tool-triggered follow-up `response.create` when `responseAfterToolOutput` is enabled

Queue policies (`enqueue`, `reject`, `cancel_current`) apply to manual APIs. See
[Tool dispatch](tool-dispatch.md).

## Related docs

- [CLI reference](../reference/cli.md)
- [VS Code extension reference](../reference/vscode-extension.md)
- [Session lifecycle](session-lifecycle.md)
