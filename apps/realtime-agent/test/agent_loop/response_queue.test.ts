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

test("default enqueue holds response.create until response.done", async () =>
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

    assert.deepEqual(await session.createResponse(), { status: "sent" });
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_hold" },
      }),
    );

    const queued = await session.createResponse();
    assert.deepEqual(queued, { status: "queued" });
    assert.equal(socket.sentMessages.length, baseline + 1);

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: { id: "resp_hold" },
      }),
    );

    assert.equal(socket.sentMessages.length, baseline + 2);
    assert.deepEqual(JSON.parse(socket.sentMessages.at(-1) ?? "{}"), { type: "response.create" });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("reject returns rejected without sending when response is active", async () =>
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

    await session.createResponse();
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_reject" },
      }),
    );

    const result = await session.createResponse({ queuePolicy: "reject" });
    assert.deepEqual(result, { status: "rejected", reason: "response_active" });
    assert.equal(socket.sentMessages.length, baseline + 1);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("cancel_current emits response.cancel then runs queued create after terminal", async () =>
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

    await session.createResponse();
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_cc" },
      }),
    );

    const q = await session.createResponse({ queuePolicy: "cancel_current" });
    assert.deepEqual(q, { status: "queued", reason: "cancelling_active" });

    const tail = socket.sentMessages.slice(baseline).map((m) => JSON.parse(m) as RealtimeEvent);
    assert.deepEqual(tail.at(-1), {
      type: "response.cancel",
      response_id: "resp_cc",
    });

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: { id: "resp_cc" },
      }),
    );

    assert.deepEqual(JSON.parse(socket.sentMessages.at(-1) ?? "{}"), { type: "response.create" });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("commitAudioAndCreateResponse sends commit and create as one atomic unit in the queue", async () =>
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

    await session.createResponse();
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_pair" },
      }),
    );

    const pairPromise = session.commitAudioAndCreateResponse();
    const interleavePromise = session.createResponse();

    assert.deepEqual(await pairPromise, { status: "queued" });
    assert.deepEqual(await interleavePromise, { status: "queued" });

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: { id: "resp_pair" },
      }),
    );

    SimulateResponseCreatedAndDone(socket, "resp_pair_follow");

    const slice = socket.sentMessages.slice(baseline).map((m) => JSON.parse(m) as RealtimeEvent);
    const types = slice.map((e) => e.type);
    const idxCommit = types.indexOf("input_audio_buffer.commit");
    const idxCreateAfterPair = types.indexOf("response.create", idxCommit);
    const idxSecondCreate = types.indexOf("response.create", idxCreateAfterPair + 1);
    assert.ok(idxCommit >= 0);
    assert.ok(idxCreateAfterPair > idxCommit);
    assert.equal(slice[idxCommit + 1]?.type, "response.create");
    assert.ok(idxSecondCreate > idxCreateAfterPair);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("sendTextMessage with createResponse true queues message and response as one unit under reject", async () =>
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

    await session.createResponse();
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_msg" },
      }),
    );

    const result = await session.sendTextMessage("x", {
      createResponse: true,
      queuePolicy: "reject",
    });
    assert.deepEqual(result, { status: "rejected", reason: "response_active" });
    assert.equal(socket.sentMessages.length, baseline + 1);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("naked commitAudio sends immediately while a response is active", async () =>
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

    await session.createResponse();
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_naked" },
      }),
    );

    assert.deepEqual(await session.commitAudio(), { status: "sent" });
    const last = JSON.parse(socket.sentMessages.at(-1) ?? "{}") as RealtimeEvent;
    assert.deepEqual(last, { type: "input_audio_buffer.commit" });
    assert.equal(socket.sentMessages.length, baseline + 2);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("sendRealtimeEvent response.cancel always sends immediately", async () =>
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

    await session.createResponse();
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_cancel_now" },
      }),
    );

    assert.deepEqual(
      await session.sendRealtimeEvent({
        type: "response.cancel",
        response_id: "resp_cancel_now",
      }),
      { status: "sent" },
    );

    const last = JSON.parse(socket.sentMessages.at(-1) ?? "{}") as RealtimeEvent;
    assert.deepEqual(last, {
      type: "response.cancel",
      response_id: "resp_cancel_now",
    });
    assert.equal(socket.sentMessages.length, baseline + 2);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("FIFO order for multiple queued response.create requests", async () =>
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

    await session.createResponse();
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_fifo" },
      }),
    );

    assert.deepEqual(await session.createResponse({ response: { instructions: "a" } }), { status: "queued" });
    assert.deepEqual(await session.createResponse({ response: { instructions: "b" } }), { status: "queued" });

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: { id: "resp_fifo" },
      }),
    );

    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_a" },
      }),
    );
    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: { id: "resp_a" },
      }),
    );

    const slice = socket.sentMessages.slice(baseline).map((m) => JSON.parse(m) as RealtimeEvent);
    const creates = slice.filter((e) => e.type === "response.create");
    assert.equal(creates.length, 3);
    assert.deepEqual(creates[1], { type: "response.create", response: { instructions: "a" } });
    assert.deepEqual(creates[2], { type: "response.create", response: { instructions: "b" } });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("terminal error referencing the active response drains the queue", async () =>
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

    await session.createResponse();
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_err" },
      }),
    );

    assert.deepEqual(await session.createResponse({ response: { instructions: "after_error" } }), {
      status: "queued",
    });

    socket.receiveMessage(
      JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "failed",
          response_id: "resp_err",
        },
      }),
    );

    assert.deepEqual(JSON.parse(socket.sentMessages.at(-1) ?? "{}"), {
      type: "response.create",
      response: { instructions: "after_error" },
    });
    assert.equal(socket.sentMessages.length, baseline + 2);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("responseAfterToolOutput false emits only function_call_output", async () =>
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

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              call_id: "call_only_out",
              name: "echo",
              arguments: JSON.stringify({ n: 1 }),
            },
          ],
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const tail = ParseSentEvents(socket).slice(baseline);
    const types = tail.map((e) => e.type);
    assert.ok(types.includes("conversation.item.create"));
    assert.equal(types.includes("response.create"), false);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("responseAfterToolOutput true emits function_call_output then response.create", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({
        turnMode: { type: "manual" },
        responseAfterToolOutput: true,
      }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    const baseline = socket.sentMessages.length;

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              call_id: "call_follow",
              name: "echo",
              arguments: JSON.stringify({ n: 2 }),
            },
          ],
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const tail = ParseSentEvents(socket).slice(baseline);
    assert.equal(tail[0]?.type, "conversation.item.create");
    assert.equal((tail[0]?.item as { type?: string } | undefined)?.type, "function_call_output");
    assert.deepEqual(tail[1], { type: "response.create" });
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("responseAfterToolOutput true defers follow-up response.create while a response is active", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({
        turnMode: { type: "manual" },
        responseAfterToolOutput: true,
      }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    await session.createResponse();
    socket.receiveMessage(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_tool_block" },
      }),
    );

    const baseline = socket.sentMessages.length;

    socket.receiveMessage(
      JSON.stringify({
        type: "response.function_call_arguments.done",
        call_id: "call_defer",
        name: "echo",
        arguments: "{}",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const mid = ParseSentEvents(socket).slice(baseline);
    const midCreates = mid.filter((e) => e.type === "response.create");
    assert.equal(midCreates.length, 0);

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: { id: "resp_tool_block" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(ParseSentEvents(socket).slice(baseline).some((e) => e.type === "response.create"));
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("responseAfterToolOutput true enqueues follow-up after structured tool errors", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({
        turnMode: { type: "manual" },
        responseAfterToolOutput: true,
        toolCallSet: {
          name: "errs",
          tools: [
            {
              name: "boom",
              inputSchema: {},
              callback: () =>
              {
                throw new Error("fail");
              },
            },
          ],
        },
      }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    const baseline = socket.sentMessages.length;

    const cases = [
      { callId: "c1", name: "missing", args: "{}" },
      { callId: "c2", name: "boom", args: "{" },
      { callId: "c3", name: "boom", args: "{}" },
    ];

    for (const c of cases)
    {
      socket.receiveMessage(
        JSON.stringify({
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                call_id: c.callId,
                name: c.name,
                arguments: c.args,
              },
            ],
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      SimulateResponseCreatedAndDone(socket, `ack_${c.callId}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    const tail = ParseSentEvents(socket).slice(baseline);
    const creates = tail.filter((e) => e.type === "response.create");
    const outputs = tail.filter(
      (e) => e.type === "conversation.item.create" && (e.item as { type?: string })?.type === "function_call_output",
    );
    assert.equal(outputs.length, 3);
    assert.equal(creates.length, 3);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("two rapid tool calls with responseAfterToolOutput true produce two follow-up creates in order", async () =>
{
  const context = CreateAgentLoopTestContext();

  try
  {
    const startPromise = startAgentSession(
      BuildTestAgentConfig({
        turnMode: { type: "manual" },
        responseAfterToolOutput: true,
      }),
      context.deps,
    );
    const socket = await OpenConnectedSocket(context.sockets);
    const session = await startPromise;

    SimulateResponseCreatedAndDone(socket, "r_pre");

    const baseline = socket.sentMessages.length;

    socket.receiveMessage(
      JSON.stringify({
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              call_id: "call_x",
              name: "echo",
              arguments: JSON.stringify({ a: 1 }),
            },
            {
              type: "function_call",
              call_id: "call_y",
              name: "echo",
              arguments: JSON.stringify({ b: 2 }),
            },
          ],
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 40));

    const tail1 = ParseSentEvents(socket).slice(baseline);
    const outputs = tail1.filter(
      (e) => e.type === "conversation.item.create" && (e.item as { type?: string })?.type === "function_call_output",
    );
    assert.equal(outputs.length, 2);
    const createsBeforeAck = tail1.filter((e) => e.type === "response.create");
    assert.equal(createsBeforeAck.length >= 1, true);
    SimulateResponseCreatedAndDone(socket, "r_chain_ack");
    await new Promise((resolve) => setTimeout(resolve, 5));

    const tail2 = ParseSentEvents(socket).slice(baseline);
    assert.equal(tail2.filter((e) => e.type === "response.create").length, 2);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});
