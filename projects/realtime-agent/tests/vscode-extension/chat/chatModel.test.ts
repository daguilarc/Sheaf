import assert from "node:assert/strict";
import { test } from "node:test";

import type { RealtimeEvent } from "realtime-agent-lib";

import { ChatModel } from "../../../src/vscode-extension/src/chat/chatModel.js";

const x_incoming = { sessionId: "s1", direction: "incoming" as const };

test("ChatModel collapses transcript deltas then completes", () =>
{
  const model = new ChatModel();
  const itemId = "item_voice";

  model.ingestEvent(
    {
      type: "conversation.item.input_audio_transcription.delta",
      item_id: itemId,
      delta: "hel",
    } satisfies RealtimeEvent,
    x_incoming,
  );
  model.ingestEvent(
    {
      type: "conversation.item.input_audio_transcription.delta",
      item_id: itemId,
      delta: "lo",
    } satisfies RealtimeEvent,
    x_incoming,
  );

  let snap = model.getSnapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0]?.kind, "user_transcript");
  if (snap[0]?.kind === "user_transcript")
  {
    assert.equal(snap[0].text, "hello");
    assert.equal(snap[0].complete, false);
  }

  model.ingestEvent(
    {
      type: "conversation.item.input_audio_transcription.completed",
      item_id: itemId,
      transcript: "hello there",
    } satisfies RealtimeEvent,
    x_incoming,
  );

  snap = model.getSnapshot();
  assert.equal(snap.length, 1);
  if (snap[0]?.kind === "user_transcript")
  {
    assert.equal(snap[0].text, "hello there");
    assert.equal(snap[0].complete, true);
  }
});

test("ChatModel collapses assistant text by response id", () =>
{
  const model = new ChatModel();
  const responseId = "resp_abc";

  model.ingestEvent(
    {
      type: "response.output_text.delta",
      response_id: responseId,
      delta: "one",
    } satisfies RealtimeEvent,
    x_incoming,
  );
  model.ingestEvent(
    {
      type: "response.output_text.delta",
      response_id: responseId,
      delta: "two",
    } satisfies RealtimeEvent,
    x_incoming,
  );

  const mid = model.getSnapshot();
  assert.equal(mid.length, 1);
  if (mid[0]?.kind === "assistant_text")
  {
    assert.equal(mid[0].text, "onetwo");
    assert.equal(mid[0].complete, false);
  }

  model.ingestEvent(
    {
      type: "response.output_text.done",
      response_id: responseId,
      text: "onetwo three",
    } satisfies RealtimeEvent,
    x_incoming,
  );

  const done = model.getSnapshot();
  assert.equal(done.length, 1);
  if (done[0]?.kind === "assistant_text")
  {
    assert.equal(done[0].text, "onetwo three");
    assert.equal(done[0].complete, true);
  }
});

test("ChatModel tool lifecycle updates single bubble and clears args", () =>
{
  const model = new ChatModel();
  const callId = "call_1";

  model.ingestEvent(
    {
      type: "response.function_call_arguments.done",
      call_id: callId,
      name: "code_read",
      arguments: JSON.stringify({ file: "a.ts", startLine: 1, endLine: 2 }),
    } satisfies RealtimeEvent,
    x_incoming,
  );

  model.ingestToolLifecycle({
    sessionId: "s1",
    toolCallId: callId,
    toolName: "code_read",
    phase: "queued",
  });

  let snap = model.getSnapshot();
  assert.equal(snap.length, 1);
  if (snap[0]?.kind === "tool_call")
  {
    assert.equal(snap[0].phase, "queued");
    assert.ok(snap[0].summary.includes("a.ts"));
  }

  model.ingestToolLifecycle({
    sessionId: "s1",
    toolCallId: callId,
    toolName: "code_read",
    phase: "started",
  });
  model.ingestToolLifecycle({
    sessionId: "s1",
    toolCallId: callId,
    toolName: "code_read",
    phase: "succeeded",
  });

  snap = model.getSnapshot();
  assert.equal(snap.length, 1);
  if (snap[0]?.kind === "tool_call")
  {
    assert.equal(snap[0].phase, "succeeded");
  }
});

test("ChatModel reset clears and adds session ended context", () =>
{
  const model = new ChatModel();
  model.recordError("x");
  model.reset("user_stopped");
  const snap = model.getSnapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0]?.kind, "context_push");
  if (snap[0]?.kind === "context_push")
  {
    assert.ok(snap[0].summary.includes("user_stopped"));
  }
});

test("ChatModel clear removes all bubbles", () =>
{
  const model = new ChatModel();
  model.recordError("e");
  model.clear();
  assert.equal(model.getSnapshot().length, 0);
});

test("ChatModel ignores non-incoming events for bubbles", () =>
{
  const model = new ChatModel();
  model.ingestEvent(
    {
      type: "response.output_text.delta",
      response_id: "r",
      delta: "x",
    } satisfies RealtimeEvent,
    { sessionId: "s1", direction: "outgoing" },
  );
  assert.equal(model.getSnapshot().length, 0);
});
