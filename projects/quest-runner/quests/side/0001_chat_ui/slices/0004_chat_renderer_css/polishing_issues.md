# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-07T00:00:00Z
- updated_at: 2026-06-07T00:00:00Z
- title: Streaming cursor and reasoning spinner persist after stream end
- details: In `RenderTranscript` (`projects/web/src/agui-chat.js:1120-1127`), an
  already-created message node is only re-rendered when `message.isStreaming ||
  state.openTextMessages.has(messageId) || state.openReasoning.has(messageId) ||
  message.role === "tool"`. For `assistant` and `reasoning` roles the terminal
  streaming -> not-streaming transition is therefore never rendered:
  `TEXT_MESSAGE_END` (`agui-chat.js:399-410`) sets `message.isStreaming = false`
  and removes the id from `openTextMessages`, and `REASONING_MESSAGE_END` /
  `REASONING_END` (`agui-chat.js:542-573`) do the same for `openReasoning`. When
  the END event is processed in a LATER animation frame than the last content
  delta — the normal streaming case, since deltas and the END event arrive in
  separate WebSocket batches and each batch triggers its own
  `requestAnimationFrame` render — the node-update gate evaluates false and
  `UpdateMessageNode` is skipped for that node. Consequences: (1) assistant
  bubbles keep the `<span class="agui-chat-streaming">` blinking cursor appended
  in `UpdateAssistantContent` (`agui-chat.js:999-1005`) permanently after the
  message finishes streaming, because nothing re-renders the node to drop the
  cursor; (2) reasoning panels keep their spinner visible forever, since
  `UpdateMessageNode` only hides the reasoning spinner (`agui-chat.js:1038-1047`)
  when the node is re-rendered, which never happens after END. This contradicts
  the slice plan/spec: assistant should "Add a blinking cursor element while
  `isStreaming`" (implying removal once not streaming) and reasoning should show a
  "spinner while streaming" only. Tool messages are unaffected because
  `message.role === "tool"` is always present in the update gate. Test gap: the
  existing renderer tests do not catch this. "text streaming reuses the same
  message DOM node" (`projects/web/tests/agui-chat.test.mjs:694-727`) never sends
  `TEXT_MESSAGE_END` in a separate render pass, and "tool and reasoning panels
  toggle expanded state" (`tests/agui-chat.test.mjs:729-780`) sends
  `START`+`CONTENT`+`END` in a single `applyServerMessage` followed by one
  `renderChat`, so each node is created fresh with `isStreaming` already false and
  the cross-frame END transition is never exercised.
- resolution_notes: To mark completed: after a streaming `assistant` or
  `reasoning` message ends in a render pass that is separate from its last content
  delta, the rendered DOM must no longer contain the `agui-chat-streaming` cursor
  (assistant) nor a visible spinner (reasoning). Add regression tests in
  `projects/web/tests/agui-chat.test.mjs` that, for each role, (a)
  `applyServerMessage` + `renderChat` with `START`+`CONTENT` (asserting the cursor
  / visible spinner is present), then (b) a second `applyServerMessage` with only
  the `END` event followed by `renderChat`, asserting the assistant content's
  `innerHTML` no longer includes `agui-chat-streaming` and the reasoning node's
  spinner is hidden (`display === "none"`).
- note: Recorded directly in this file because the `scripts/quest-runner issues`
  CLI was unavailable during this review (every invocation was blocked by the
  permission system and could not be approved). Please re-key/normalize this entry
  through the CLI if it becomes available.
