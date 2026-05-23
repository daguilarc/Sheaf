import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyIncomingEvent,
  classifyOutgoingEvent,
  DEFAULT_REALTIME_MODEL,
  EventRouter,
  type RealtimeEvent,
} from "../../src/index.js";

import {
  CleanupPersistenceTestContext,
  CreatePersistenceTestContext,
} from "../persistence/helpers.js";

test("classifyIncomingEvent maps known and unknown event types", () =>
{
  assert.equal(classifyIncomingEvent({ type: "session.created" }), "session_lifecycle");
  assert.equal(
    classifyIncomingEvent({ type: "input_audio_buffer.speech_started" }),
    "input_audio_turn",
  );
  assert.equal(
    classifyIncomingEvent({
      type: "conversation.item.input_audio_transcription.delta",
    }),
    "transcription",
  );
  assert.equal(
    classifyIncomingEvent({ type: "response.output_text.delta" }),
    "text_output",
  );
  assert.equal(
    classifyIncomingEvent({ type: "response.function_call_arguments.delta" }),
    "tool_call",
  );
  assert.equal(
    classifyIncomingEvent({
      type: "response.done",
      response: { output: [{ type: "message" }] },
    }),
    "unknown",
  );
  assert.equal(
    classifyIncomingEvent({
      type: "response.done",
      response: { output: [{ type: "function_call" }] },
    }),
    "tool_call",
  );
  assert.equal(classifyIncomingEvent({ type: "error" }), "error");
  assert.equal(classifyIncomingEvent({ type: "custom.vendor.event" }), "unknown");
});

test("classifyOutgoingEvent maps known and unknown event types", () =>
{
  assert.equal(classifyOutgoingEvent({ type: "session.update", session: {} }), "session_config");
  assert.equal(classifyOutgoingEvent({ type: "response.create" }), "response_trigger");
  assert.equal(
    classifyOutgoingEvent({
      type: "conversation.item.create",
      item: { type: "function_call_output" },
    }),
    "tool_output",
  );
  assert.equal(
    classifyOutgoingEvent({
      type: "conversation.item.create",
      item: { type: "message" },
    }),
    "conversation_input",
  );
  assert.equal(
    classifyOutgoingEvent({ type: "input_audio_buffer.append", audio: "abc" }),
    "audio_buffer_append",
  );
  assert.equal(classifyOutgoingEvent({ type: "custom.outgoing.event" }), "unknown");
});

test("routeIncomingEvent persists and surfaces generic and typed callbacks", () =>
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

    const genericEvents: RealtimeEvent[] = [];
    const unknownEvents: RealtimeEvent[] = [];
    const router = new EventRouter({
      sessionId: session.id,
      eventsRepo: context.events,
      onEvent: (event) =>
      {
        genericEvents.push(event);
      },
      onUnknownIncoming: (event) =>
      {
        unknownEvents.push(event);
      },
    });

    const event: RealtimeEvent = {
      type: "vendor.custom.incoming",
      payload: { ok: true },
    };

    const persisted = router.routeIncomingEvent(event);
    assert.equal(persisted.eventType, "vendor.custom.incoming");
    assert.equal(genericEvents.length, 1);
    assert.equal(unknownEvents.length, 1);
    assert.equal(context.events.listEvents(session.id).length, 1);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("routeIncomingEvent does not surface text-only response.done as a tool call", () =>
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

    const toolCallEvents: RealtimeEvent[] = [];
    const unknownEvents: RealtimeEvent[] = [];
    const router = new EventRouter({
      sessionId: session.id,
      eventsRepo: context.events,
      onToolCall: (event) =>
      {
        toolCallEvents.push(event);
      },
      onUnknownIncoming: (event) =>
      {
        unknownEvents.push(event);
      },
    });

    const event: RealtimeEvent = {
      type: "response.done",
      response: { output: [{ type: "message" }] },
    };

    const persisted = router.routeIncomingEvent(event);
    assert.equal(persisted.eventType, "response.done");
    assert.equal(toolCallEvents.length, 0);
    assert.equal(unknownEvents.length, 1);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("routeOutgoingEvent sends audio append through callbacks without persistence", () =>
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

    const audioEvents: RealtimeEvent[] = [];
    const router = new EventRouter({
      sessionId: session.id,
      eventsRepo: context.events,
      onAudioBufferAppend: (event) =>
      {
        audioEvents.push(event);
      },
    });

    const skipped = router.routeOutgoingEvent({
      type: "input_audio_buffer.append",
      audio: "chunk",
    });

    assert.equal(skipped, null);
    assert.equal(audioEvents.length, 1);
    assert.equal(context.events.listEvents(session.id).length, 0);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("routeOutgoingEvent persists non-audio outgoing events", () =>
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

    const router = new EventRouter({
      sessionId: session.id,
      eventsRepo: context.events,
    });

    const persisted = router.routeOutgoingEvent({
      type: "session.update",
      session: { type: "realtime" },
    });

    assert.ok(persisted !== null);
    assert.equal(persisted?.eventType, "session.update");
    assert.equal(context.events.listEvents(session.id).length, 1);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("fake transport integration persists incoming routed events", async () =>
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

    const router = new EventRouter({
      sessionId: session.id,
      eventsRepo: context.events,
    });

    const incoming: RealtimeEvent = {
      type: "response.output_text.delta",
      delta: "hello",
    };

    router.routeIncomingEvent(incoming);

    const stored = context.events.listEvents(session.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.direction, "incoming");
    assert.equal(stored[0]?.eventType, "response.output_text.delta");
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});
