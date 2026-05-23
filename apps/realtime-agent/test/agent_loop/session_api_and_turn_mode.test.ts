import assert from "node:assert/strict";
import test from "node:test";

import { startAgentSession, type RealtimeEvent } from "../../src/index.js";

import {
  BuildTestAgentConfig,
  CreateAgentLoopTestContext,
  OpenConnectedSocket,
  ParseSentEvents,
  SimulateResponseCreatedAndDone,
} from "./helpers.js";
import { CleanupPersistenceTestContext } from "../persistence/helpers.js";

function ExpectedDefaultSessionUpdateForTestTools(): RealtimeEvent
{
  return {
    type: "session.update",
    session: {
      type: "realtime",
      output_modalities: ["text"],
      audio: {
        input: {
          format: {
            type: "audio/pcm",
            rate: 24000,
          },
          transcription: {
            model: "gpt-4o-mini-transcribe",
          },
          turn_detection: {
            type: "server_vad",
            silence_duration_ms: 500,
            create_response: true,
            interrupt_response: true,
          },
        },
      },
      tools: [
        {
          type: "function",
          name: "echo",
          parameters: { type: "object" },
        },
      ],
    },
  };
}

test("default server_vad session.update matches stable snapshot for test tool set", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(BuildTestAgentConfig(), context.deps);
    const socket = await OpenConnectedSocket(context.sockets);
    await startPromise;

    const first = ParseSentEvents(socket)[0];
    assert.deepEqual(first, ExpectedDefaultSessionUpdateForTestTools());
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("default server_vad startup still ends with response.create regression guard", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(BuildTestAgentConfig(), context.deps);
    const socket = await OpenConnectedSocket(context.sockets);
    await startPromise;

    const sentTypes = ParseSentEvents(socket).map((event) => event.type);
    assert.deepEqual(sentTypes, [
      "session.update",
      "conversation.item.create",
      "conversation.item.create",
      "response.create",
    ]);
    assert.deepEqual(ParseSentEvents(socket).at(-1), { type: "response.create" });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("manual turnMode omits startup response.create and sets turn_detection null", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({
        turnMode: { type: "manual" },
      }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    await startPromise;

    const sentTypes = ParseSentEvents(socket).map((event) => event.type);
    assert.deepEqual(sentTypes, [
      "session.update",
      "conversation.item.create",
      "conversation.item.create",
    ]);

    const sessionUpdate = ParseSentEvents(socket)[0] as {
      session?: { audio?: { input?: { turn_detection?: unknown } } };
    };
    assert.equal(sessionUpdate.session?.audio?.input?.turn_detection, null);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("session API methods emit expected events and return sent status", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({ turnMode: { type: "manual" } }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    const baseline = socket.sentMessages.length;

    assert.deepEqual(await session.commitAudio(), { status: "sent" });
    assert.deepEqual(await session.clearAudioBuffer(), { status: "sent" });
    assert.deepEqual(await session.createResponse(), { status: "sent" });
    SimulateResponseCreatedAndDone(socket, "r1");
    assert.deepEqual(
      await session.createResponse({
        response: { instructions: "think briefly" },
      }),
      { status: "sent" },
    );
    SimulateResponseCreatedAndDone(socket, "r2");
    assert.deepEqual(await session.commitAudioAndCreateResponse(), { status: "sent" });
    SimulateResponseCreatedAndDone(socket, "r3");
    assert.deepEqual(
      await session.commitAudioAndCreateResponse({
        response: { instructions: "after commit" },
      }),
      { status: "sent" },
    );

    const after = socket.sentMessages.slice(baseline).map((message) => JSON.parse(message) as RealtimeEvent);

    const expectedTail: RealtimeEvent[] = [
      { type: "input_audio_buffer.commit" },
      { type: "input_audio_buffer.clear" },
      { type: "response.create" },
      {
        type: "response.create",
        response: { instructions: "think briefly" },
      },
      { type: "input_audio_buffer.commit" },
      { type: "response.create" },
      { type: "input_audio_buffer.commit" },
      {
        type: "response.create",
        response: { instructions: "after commit" },
      },
    ];

    assert.deepEqual(after, expectedTail);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("sendTextMessage emits conversation.item.create and optional response.create", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({ turnMode: { type: "manual" } }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    const baseline = socket.sentMessages.length;

    assert.deepEqual(await session.sendTextMessage("Hello model"), { status: "sent" });
    assert.deepEqual(
      await session.sendTextMessage("With response", { createResponse: true }),
      { status: "sent" },
    );

    const tail = socket.sentMessages.slice(baseline).map((message) => JSON.parse(message) as RealtimeEvent);

    assert.deepEqual(tail[0], {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello model" }],
      },
    });

    assert.deepEqual(tail[1], {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "With response" }],
      },
    });
    assert.deepEqual(tail[2], { type: "response.create" });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("sendTextMessage rejects empty text", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({ turnMode: { type: "manual" } }),
      context.deps,
    );
    await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    await assert.rejects(session.sendTextMessage(""), TypeError);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("sendStructuredContext serializes envelope JSON on input_text", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({ turnMode: { type: "manual" } }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    const baseline = socket.sentMessages.length;

    await session.sendStructuredContext(
      {
        kind: "structured_context",
        source: "language_server",
        payload: { activeFile: "src/example.ts", symbols: [] },
      },
      { createResponse: true },
    );

    const tail = socket.sentMessages.slice(baseline).map((message) => JSON.parse(message) as RealtimeEvent);

    const itemEvent = tail[0];
    assert.equal(itemEvent.type, "conversation.item.create");
    const text = (itemEvent.item as { content: Array<{ text: string }> }).content[0]?.text;
    assert.ok(typeof text === "string");
    assert.deepEqual(JSON.parse(text), {
      kind: "structured_context",
      source: "language_server",
      payload: { activeFile: "src/example.ts", symbols: [] },
    });
    assert.deepEqual(tail[1], { type: "response.create" });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("sendStructuredContext omits summary key when undefined", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({ turnMode: { type: "manual" } }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    await session.sendStructuredContext({
      kind: "k",
      source: "vscode",
      payload: {},
    });

    const last = JSON.parse(socket.sentMessages.at(-1) ?? "{}") as RealtimeEvent;
    const text = (last.item as { content: Array<{ text: string }> }).content[0]?.text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.equal("summary" in parsed, false);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("sendStructuredContext includes summary when provided", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({ turnMode: { type: "manual" } }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    await session.sendStructuredContext({
      kind: "k",
      source: "tool",
      payload: { n: 1 },
      summary: "short",
    });

    const last = JSON.parse(socket.sentMessages.at(-1) ?? "{}") as RealtimeEvent;
    const text = (last.item as { content: Array<{ text: string }> }).content[0]?.text;
    assert.deepEqual(JSON.parse(text), {
      kind: "k",
      source: "tool",
      payload: { n: 1 },
      summary: "short",
    });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("custom server_vad from AgentStartConfig flows into session.update", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({
        turnMode: {
          type: "server_vad",
          silenceDurationMs: 801,
          threshold: 0.11,
          prefixPaddingMs: 99,
          createResponse: false,
          interruptResponse: false,
        },
      }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    await startPromise;

    const sessionUpdate = ParseSentEvents(socket)[0] as {
      session?: { audio?: { input?: { turn_detection?: Record<string, unknown> } } };
    };
    const turnDetection = sessionUpdate.session?.audio?.input?.turn_detection;

    assert.deepEqual(turnDetection, {
      type: "server_vad",
      silence_duration_ms: 801,
      threshold: 0.11,
      prefix_padding_ms: 99,
      create_response: false,
      interrupt_response: false,
    });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("sendRealtimeEvent forwards arbitrary events and rejects empty type", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({ turnMode: { type: "manual" } }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    const baseline = socket.sentMessages.length;

    assert.deepEqual(
      await session.sendRealtimeEvent({
        type: "response.cancel",
        response_id: "resp_1",
      }),
      { status: "sent" },
    );

    const forwarded = JSON.parse(socket.sentMessages[baseline] ?? "{}") as RealtimeEvent;
    assert.deepEqual(forwarded, {
      type: "response.cancel",
      response_id: "resp_1",
    });

    await assert.rejects(session.sendRealtimeEvent({ type: "" } as RealtimeEvent), TypeError);
    await assert.rejects(
      session.sendRealtimeEvent({ notType: "x" } as unknown as RealtimeEvent),
      TypeError,
    );
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});
