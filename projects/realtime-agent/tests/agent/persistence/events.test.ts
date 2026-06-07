import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_REALTIME_MODEL, shouldPersistOutgoingEvent } from "../../../src/agent/src/index.js";

import {
  CleanupPersistenceTestContext,
  CreatePersistenceTestContext,
} from "./helpers.js";

test("shouldPersistOutgoingEvent skips only input_audio_buffer.append", () =>
{
  assert.equal(
    shouldPersistOutgoingEvent({ type: "input_audio_buffer.append", audio: "abc" }),
    false,
  );
  assert.equal(
    shouldPersistOutgoingEvent({ type: "response.create", response: {} }),
    true,
  );
});

test("incoming events persist regardless of type", () =>
{
  const context = CreatePersistenceTestContext();

  try
  {
    const session = context.sessions.createSession({
      systemPrompt: "system",
      initialContext: "context",
      toolNames: [],
      model: DEFAULT_REALTIME_MODEL,
      sessionConfig: {},
    });

    const incomingTypes = [
      "session.created",
      "conversation.item.input_audio_transcription.completed",
      "response.output_text.delta",
      "response.function_call_arguments.done",
      "error",
    ];

    for (const eventType of incomingTypes)
    {
      const persisted = context.events.persistIncomingEvent(session.id, {
        type: eventType,
        payload: { eventType },
      });

      assert.ok(persisted !== null);
      assert.equal(persisted?.direction, "incoming");
      assert.equal(persisted?.eventType, eventType);
      assert.equal(persisted?.isAudioBufferAppend, false);
    }

    assert.equal(context.events.listEvents(session.id).length, incomingTypes.length);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("outgoing non-audio events persist", () =>
{
  const context = CreatePersistenceTestContext();

  try
  {
    const session = context.sessions.createSession({
      systemPrompt: "system",
      initialContext: "context",
      toolNames: ["echo"],
      model: DEFAULT_REALTIME_MODEL,
      sessionConfig: {},
    });

    const persisted = context.events.persistEvent({
      sessionId: session.id,
      direction: "outgoing",
      event: {
        type: "conversation.item.create",
        item: { type: "function_call_output" },
      },
    });

    assert.ok(persisted !== null);
    assert.equal(persisted?.direction, "outgoing");
    assert.equal(persisted?.eventType, "conversation.item.create");
    assert.equal(context.events.listEvents(session.id).length, 1);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("outgoing input_audio_buffer.append is not persisted", () =>
{
  const context = CreatePersistenceTestContext();

  try
  {
    const session = context.sessions.createSession({
      systemPrompt: "system",
      initialContext: "context",
      toolNames: [],
      model: DEFAULT_REALTIME_MODEL,
      sessionConfig: {},
    });

    const skipped = context.events.persistEvent({
      sessionId: session.id,
      direction: "outgoing",
      event: {
        type: "input_audio_buffer.append",
        audio: "base64-chunk",
      },
    });

    assert.equal(skipped, null);
    assert.equal(context.events.listEvents(session.id).length, 0);
    assert.equal(
      context.events.shouldPersistOutgoingEvent({
        type: "input_audio_buffer.append",
      }),
      false,
    );
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});
