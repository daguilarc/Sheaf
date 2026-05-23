import assert from "node:assert/strict";
import test from "node:test";

import {
  DuplicateToolNameError,
  startAgentSession,
  type RealtimeEvent,
  type ToolLifecycleNotification,
} from "../../src/index.js";

import {
  BuildTestAgentConfig,
  CreateAgentLoopTestContext,
  OpenConnectedSocket,
  ParseSentEvents,
} from "./helpers.js";
import { CleanupPersistenceTestContext } from "../persistence/helpers.js";

test("startAgentSession rejects duplicate tool names before connecting", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({
        toolCallSet: {
          tools: [
            { name: "dup", inputSchema: {}, callback: () => ({}) },
            { name: "dup", inputSchema: {}, callback: () => ({}) },
          ],
        },
      }),
      context.deps,
    );

    await assert.rejects(startPromise, DuplicateToolNameError);
    assert.equal(context.sockets.length, 0);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("startAgentSession persists session before socket connects and sends startup events in order", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(BuildTestAgentConfig(), context.deps);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sessionCount = context.database
      .getConnection()
      .prepare("SELECT COUNT(*) AS count FROM sessions")
      .get() as { count: number };

    assert.equal(sessionCount.count, 1);
    assert.equal(context.sockets.length, 1);

    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    const sentTypes = ParseSentEvents(socket).map((event) => event.type);
    assert.deepEqual(sentTypes, [
      "session.update",
      "conversation.item.create",
      "conversation.item.create",
      "response.create",
    ]);
    assert.deepEqual(ParseSentEvents(socket)[3], { type: "response.create" });

    assert.equal(session.sessionId.length > 0, true);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("startAgentSession stores session metadata from config", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const config = BuildTestAgentConfig({
      model: "gpt-realtime-2",
      systemPrompt: "System prompt text",
      initialContext: "Initial context text",
      toolCallSet: {
        name: "demo_set",
        tools: [
          {
            name: "alpha",
            inputSchema: { type: "object" },
            callback: () => ({ ok: true }),
          },
          {
            name: "beta",
            inputSchema: { type: "object" },
            callback: () => ({ ok: true }),
          },
        ],
      },
    });

    const startPromise = startAgentSession(config, context.deps);
    const session = await startAgentSessionAfterConnect(startPromise, context.sockets);

    const row = context.sessions.getSession(session.sessionId);
    assert.ok(row !== null);
    assert.equal(row.systemPrompt, "System prompt text");
    assert.equal(row.initialContext, "Initial context text");
    assert.equal(row.toolCallSetName, "demo_set");
    assert.equal(row.model, "gpt-realtime-2");
    assert.deepEqual(JSON.parse(row.toolNamesJson), ["alpha", "beta"]);

    const sessionConfig = JSON.parse(row.sessionConfigJson) as {
      type?: string;
      output_modalities?: string[];
    };

    assert.equal(sessionConfig.type, "realtime");
    assert.deepEqual(sessionConfig.output_modalities, ["text"]);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("incoming events continue routing while a tool callback is pending", async () =>
{
  const context = CreateAgentLoopTestContext();
  let releaseFirstTool: (() => void) | undefined;
  const firstToolGate = new Promise<void>((resolve) =>
  {
    releaseFirstTool = resolve;
  });

  try
  {
    const config = BuildTestAgentConfig({
      toolCallSet: {
        tools: [
          {
            name: "slow",
            inputSchema: {},
            callback: async () =>
            {
              await firstToolGate;
              return { done: true };
            },
          },
        ],
      },
    });

    const startPromise = startAgentSession(config, context.deps);
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    socket.receiveMessage(
      JSON.stringify({
        type: "response.function_call_arguments.done",
        call_id: "call_slow",
        name: "slow",
        arguments: "{}",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    socket.receiveMessage(
      JSON.stringify({
        type: "response.output_text.delta",
        delta: "still listening",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const events = context.events.listEvents(session.sessionId);
    const incomingTypes = events
      .filter((row) => row.direction === "incoming")
      .map((row) => row.eventType);

    assert.ok(incomingTypes.includes("response.function_call_arguments.done"));
    assert.ok(incomingTypes.includes("response.output_text.delta"));

    releaseFirstTool?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("successful tool callback emits and persists function_call_output", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(BuildTestAgentConfig(), context.deps);
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              call_id: "call_echo",
              name: "echo",
              arguments: JSON.stringify({ value: 7 }),
            },
          ],
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const outgoing = context.events
      .listEvents(session.sessionId)
      .filter((row) => row.direction === "outgoing");

    const toolOutput = outgoing.find((row) =>
    {
      const parsed = JSON.parse(row.eventJson) as RealtimeEvent;
      const item = parsed.item as { type?: string } | undefined;
      return item?.type === "function_call_output";
    });

    assert.ok(toolOutput !== undefined);

    const parsedOutput = JSON.parse(toolOutput.eventJson) as {
      item: { output: string; call_id: string };
    };

    assert.equal(parsedOutput.item.call_id, "call_echo");
    assert.deepEqual(JSON.parse(parsedOutput.item.output), { value: 7 });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("missing tool, malformed args, and thrown callback emit structured errors without ending session", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const config = BuildTestAgentConfig({
      toolCallSet: {
        tools: [
          {
            name: "boom",
            inputSchema: {},
            callback: () =>
            {
              throw new Error("boom");
            },
          },
        ],
      },
    });

    const startPromise = startAgentSession(config, context.deps);
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    const cases = [
      {
        callId: "call_missing",
        name: "missing",
        arguments: "{}",
        expectedCode: "tool_not_found",
      },
      {
        callId: "call_bad_json",
        name: "boom",
        arguments: "{",
        expectedCode: "invalid_arguments",
      },
      {
        callId: "call_throw",
        name: "boom",
        arguments: "{}",
        expectedCode: "callback_failed",
      },
    ];

    for (const testCase of cases)
    {
      socket.receiveMessage(
        JSON.stringify({
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                call_id: testCase.callId,
                name: testCase.name,
                arguments: testCase.arguments,
              },
            ],
          },
        }),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 20));

    const toolOutputs = context.events
      .listEvents(session.sessionId)
      .filter((row) => row.direction === "outgoing")
      .map((row) => JSON.parse(row.eventJson) as RealtimeEvent)
      .filter((event) => (event.item as { type?: string } | undefined)?.type === "function_call_output");

    assert.equal(toolOutputs.length, 3);

    for (const testCase of cases)
    {
      const matching = toolOutputs.find(
        (event) => (event.item as { call_id?: string }).call_id === testCase.callId,
      );
      assert.ok(matching !== undefined);
      const payload = JSON.parse((matching.item as { output: string }).output) as {
        code?: string;
      };
      assert.equal(payload.code, testCase.expectedCode);
    }

    const active = context.sessions.getSession(session.sessionId);
    assert.ok(active !== null);
    assert.equal(active.endedAt, null);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("unexpected socket close ends session with connection_lost", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(BuildTestAgentConfig(), context.deps);
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    socket.close(1006, "abnormal");

    await new Promise((resolve) => setTimeout(resolve, 0));

    const ended = context.sessions.getSession(session.sessionId);
    assert.ok(ended !== null);
    assert.ok(ended.endedAt !== null);
    assert.equal(ended.endedReason, "connection_lost");
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("stop marks ended_at with supplied reason", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(BuildTestAgentConfig(), context.deps);
    await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    const ended = await session.stop("operator_shutdown");

    assert.ok(ended.endedAt !== null);
    assert.equal(ended.endedReason, "operator_shutdown");
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("tool lifecycle callbacks report queued, started, succeeded, and failed phases", async () =>
{
  const context = CreateAgentLoopTestContext();
  const notifications: ToolLifecycleNotification[] = [];

  try
  {
    const config = BuildTestAgentConfig({
      onToolLifecycle: (notification) =>
      {
        notifications.push(notification);
      },
    });

    const startPromise = startAgentSession(config, context.deps);
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              call_id: "call_ok",
              name: "echo",
              arguments: JSON.stringify({ value: 1 }),
            },
            {
              type: "function_call",
              call_id: "call_missing",
              name: "missing",
              arguments: "{}",
            },
          ],
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const phasesForOk = notifications
      .filter((entry) => entry.toolCallId === "call_ok")
      .map((entry) => entry.phase);

    assert.deepEqual(phasesForOk, ["queued", "started", "succeeded"]);

    const phasesForMissing = notifications
      .filter((entry) => entry.toolCallId === "call_missing")
      .map((entry) => entry.phase);

    assert.deepEqual(phasesForMissing, ["queued", "started", "failed"]);
    assert.equal(notifications[0]?.sessionId, session.sessionId);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("sendAudioFrame sends input_audio_buffer.append without persisting", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(BuildTestAgentConfig(), context.deps);
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    session.sendAudioFrame(Buffer.from("abc"));

    const lastSent = JSON.parse(socket.sentMessages.at(-1) ?? "{}") as RealtimeEvent;
    assert.equal(lastSent.type, "input_audio_buffer.append");
    assert.equal(lastSent.audio, Buffer.from("abc").toString("base64"));

    const persistedAppend = context.events
      .listEvents(session.sessionId)
      .filter((row) => row.isAudioBufferAppend);

    assert.equal(persistedAppend.length, 0);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

async function startAgentSessionAfterConnect(
  startPromise: Promise<{ sessionId: string }>,
  sockets: import("../realtime/helpers.js").FakeWebSocket[],
): Promise<{ sessionId: string }>
{
  await OpenConnectedSocket(sockets);
  return startPromise;
}
